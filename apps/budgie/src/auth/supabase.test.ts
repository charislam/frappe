import { Effect, Option } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { supabaseDriver } from "./supabase";

const run = Effect.runPromise;

const sdk = vi.hoisted(() => ({
  getSession: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  signInWithOtp: vi.fn(),
  verifyOtp: vi.fn(),
  resend: vi.fn(),
  signInWithOAuth: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
  dispose: vi.fn(),
  onAuthStateChange: vi.fn(),
}));
const create = vi.hoisted(() => vi.fn());
vi.mock("@supabase/supabase-js", () => ({ createClient: create }));
beforeEach(() => {
  vi.resetAllMocks();
  create.mockReturnValue({ auth: sdk });
  sdk.dispose.mockResolvedValue(undefined);
  sdk.getSession.mockResolvedValue({ data: { session: null }, error: null });
  sdk.exchangeCodeForSession.mockResolvedValue({
    data: { session: { user: { id: "A" } } },
    error: null,
  });
  for (const method of [
    sdk.signInWithPassword,
    sdk.signInWithOtp,
    sdk.verifyOtp,
    sdk.resend,
    sdk.signInWithOAuth,
    sdk.resetPasswordForEmail,
    sdk.updateUser,
    sdk.signOut,
  ])
    method.mockResolvedValue({ error: null });
  sdk.signUp.mockResolvedValue({ data: { session: null }, error: null });
});
afterEach(() => vi.unstubAllGlobals());
const driver = (path = "/login") => {
  const cleanCallback = vi.fn();
  return {
    driver: supabaseDriver({
      url: "http://127.0.0.1:54321",
      key: "public-test-key",
      location: new URL(path, "http://localhost:5174"),
      cleanCallback,
    }),
    cleanCallback,
  };
};
describe("Supabase boundary", () => {
  it("owns one client and explicitly exchanges PKCE exactly once, cleaning callback history", async () => {
    const h = driver("/auth/callback?code=valid");
    await run(h.driver.initialize());
    await run(h.driver.initialize());
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(expect.any(String), expect.any(String), {
      auth: expect.objectContaining({
        flowType: "pkce",
        detectSessionInUrl: false,
        autoRefreshToken: true,
        persistSession: true,
      }),
    });
    expect(sdk.exchangeCodeForSession).toHaveBeenCalledExactlyOnceWith("valid");
    expect(h.cleanCallback).toHaveBeenCalledOnce();
  });
  it.each([
    "/auth/callback",
    "/auth/callback?error=access_denied&error_description=Denied",
    "/auth/callback#error_description=Expired",
  ])("reports an unusable callback at %s", async (path) => {
    const h = driver(path);
    await expect(run(h.driver.initialize().pipe(Effect.flip))).resolves.toMatchObject({
      kind: "callback",
    });
    expect(h.cleanCallback).toHaveBeenCalledOnce();
  });
  it("makes expired/already-used PKCE errors actionable", async () => {
    sdk.exchangeCodeForSession.mockResolvedValue({ error: { message: "expired" } });
    await expect(
      run(driver("/auth/callback?code=old").driver.initialize().pipe(Effect.flip)),
    ).resolves.toMatchObject({
      kind: "callback",
      message: expect.stringContaining("Restart sign in"),
    });
  });
  it("supports reloading recovery with an established session", async () => {
    sdk.getSession.mockResolvedValue({ data: { session: { user: { id: "A" } } }, error: null });
    expect(await run(driver("/reset-password").driver.initialize())).toEqual(
      Option.some({ id: "A" }),
    );
    expect(sdk.exchangeCodeForSession).not.toHaveBeenCalled();
  });
  it("never silently creates OTP sign-in users, but permits explicit signup", async () => {
    const h = driver();
    await run(h.driver.execute({ _tag: "RequestOtp", email: "a@example.com", intent: "signin" }));
    await run(h.driver.execute({ _tag: "RequestOtp", email: "a@example.com", intent: "signup" }));
    expect(sdk.signInWithOtp.mock.calls).toEqual([
      [
        {
          email: "a@example.com",
          options: {
            shouldCreateUser: false,
            emailRedirectTo: "http://localhost:5174/auth/callback",
          },
        },
      ],
      [
        {
          email: "a@example.com",
          options: {
            shouldCreateUser: true,
            emailRedirectTo: "http://localhost:5174/auth/callback",
          },
        },
      ],
    ]);
    await run(h.driver.execute({ _tag: "VerifyOtp", email: "a@example.com", code: "123456" }));
    expect(sdk.verifyOtp).toHaveBeenCalledWith({
      email: "a@example.com",
      token: "123456",
      type: "email",
    });
  });
  it("reports confirmation pending and uses distinct recovery/frontend callbacks", async () => {
    const h = driver();
    expect(
      await run(
        h.driver.execute({
          _tag: "Signup",
          credentials: { email: "a@example.com", password: "password123" },
        }),
      ),
    ).toEqual({ confirmationPending: true });
    expect(sdk.signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        options: { emailRedirectTo: "http://localhost:5174/auth/callback" },
      }),
    );
    await run(h.driver.execute({ _tag: "RequestRecovery", email: "a@example.com" }));
    expect(sdk.resetPasswordForEmail).toHaveBeenCalledWith("a@example.com", {
      redirectTo: "http://localhost:5174/reset-password",
    });
  });
  it("leaves email usable when GitHub credentials are unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ json: async () => ({ external: { github: false } }) }),
    );
    const h = driver();
    await expect(
      run(h.driver.execute({ _tag: "Github" }).pipe(Effect.flip)),
    ).resolves.toMatchObject({ kind: "provider" });
    expect(sdk.signInWithOAuth).not.toHaveBeenCalled();
    await expect(
      run(
        h.driver.execute({
          _tag: "Password",
          credentials: { email: "a@example.com", password: "password123" },
        }),
      ),
    ).resolves.toEqual({ confirmationPending: false });
  });
  it("unsubscribes the SDK listener and disposes background resources", async () => {
    const unsubscribe = vi.fn();
    sdk.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe } } });
    const h = driver();
    const close = h.driver.observe(() => {});
    close();
    await run(h.driver.dispose());
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(sdk.dispose).toHaveBeenCalledOnce();
  });
});

it("reports SDK response errors and rejected requests through the typed error channel", async () => {
  const h = driver();
  sdk.updateUser.mockResolvedValue({ error: { code: "invalid_credentials", message: "Denied" } });
  expect(
    await run(
      h.driver.execute({ _tag: "UpdatePassword", password: "password123" }).pipe(Effect.flip),
    ),
  ).toMatchObject({ kind: "credentials" });
  sdk.signOut.mockRejectedValue(new Error("offline"));
  expect(await run(h.driver.execute({ _tag: "Logout" }).pipe(Effect.flip))).toMatchObject({
    _tag: "AuthError",
  });
});
it("reports malformed provider settings through the typed error channel", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: async () => ({ external: {} }) }));
  expect(await run(driver().driver.githubAvailable().pipe(Effect.flip))).toMatchObject({
    _tag: "AuthError",
  });
});

it("returns None when discovery has no session", async () => {
  expect(await run(driver().driver.initialize())).toEqual(Option.none());
});
it("normalizes SDK session events to Options", () => {
  sdk.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
  const receive = vi.fn();
  driver().driver.observe(receive);
  const callback = sdk.onAuthStateChange.mock.calls[0]?.[0];
  callback("SIGNED_IN", { user: { id: "A" } });
  callback("SIGNED_OUT", null);
  expect(receive.mock.calls).toEqual([
    [{ user: Option.some({ id: "A" }) }],
    [{ user: Option.none() }],
  ]);
});
