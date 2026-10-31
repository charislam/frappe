import { Effect, Option } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { supabaseDriver, supabaseClient } from "./supabase";

const run = Effect.runPromise;

const sdk = vi.hoisted(() => ({
  getSession: vi.fn(),
  signInWithOtp: vi.fn(),
  verifyOtp: vi.fn(),
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
  for (const method of [sdk.signInWithOtp, sdk.verifyOtp, sdk.signOut])
    method.mockResolvedValue({ error: null });
});
afterEach(() => vi.unstubAllGlobals());
const driver = () => ({
  driver: supabaseDriver(supabaseClient({ url: "http://127.0.0.1:54321", key: "public-test-key" })),
});
describe("Supabase boundary", () => {
  it("persists sessions without detecting authentication links", async () => {
    const h = driver();
    await run(h.driver.initialize());
    expect(create).toHaveBeenCalledExactlyOnceWith(expect.any(String), expect.any(String), {
      auth: {
        flowType: "pkce",
        detectSessionInUrl: false,
        autoRefreshToken: true,
        persistSession: true,
      },
    });
  });
  it("always permits automatic account creation and verifies email codes", async () => {
    const h = driver();
    await run(h.driver.execute({ _tag: "RequestOtp", email: "new@example.com" }));
    await run(h.driver.execute({ _tag: "RequestOtp", email: "existing@example.com" }));
    expect(sdk.signInWithOtp.mock.calls).toEqual([
      [{ email: "new@example.com", options: { shouldCreateUser: true } }],
      [{ email: "existing@example.com", options: { shouldCreateUser: true } }],
    ]);
    await run(h.driver.execute({ _tag: "VerifyOtp", email: "new@example.com", code: "123456" }));
    expect(sdk.verifyOtp).toHaveBeenCalledExactlyOnceWith({
      email: "new@example.com",
      token: "123456",
      type: "email",
    });
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
  sdk.verifyOtp.mockResolvedValue({ error: { code: "invalid_credentials", message: "Denied" } });
  expect(
    await run(
      h.driver
        .execute({ _tag: "VerifyOtp", email: "a@example.com", code: "123456" })
        .pipe(Effect.flip),
    ),
  ).toMatchObject({ kind: "credentials" });
  sdk.signOut.mockRejectedValue(new Error("offline"));
  expect(await run(h.driver.execute({ _tag: "Logout" }).pipe(Effect.flip))).toMatchObject({
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
