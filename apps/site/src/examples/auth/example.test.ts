import { mounting } from "@charismaticalli/frappe";
import { Deferred, Effect, Exit, Layer, Option, Scope, SubscriptionRef } from "effect";
import { afterEach, expect, it, vi } from "vitest";
import { Auth, AuthControl, authMock } from "~/auth";
import { AuthError } from "~/auth-model";
import { LocalStorage, LocalStorageMemory } from "~/local-storage";
import { AuthExample } from "./example";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanups.splice(0)) await close();
});
const fixture = async (
  resources: Layer.Layer<Auth | AuthControl | LocalStorage> = Layer.mergeAll(
    authMock({ initial: Option.none() }),
    LocalStorageMemory,
  ),
) => {
  const scope = await Effect.runPromise(Scope.make());
  cleanups.push(() => Effect.runPromise(Scope.close(scope, Exit.void)));
  const failures: unknown[] = [];
  const app = await Effect.runPromise(
    mounting({
      scope,
      resources,
      onError: (failure) => {
        failures.push(failure);
      },
    }),
  );
  const parent = document.createElement("div");
  Effect.runSync(app.h(parent, AuthExample));
  const press = (label: string) =>
    [...parent.querySelectorAll("button")].find((button) => button.textContent === label)?.click();
  const input = (options: { label: string; value: string }) => {
    const node = Option.getOrThrow(
      Option.fromNullishOr(
        parent.querySelector<HTMLInputElement>(`input[aria-label="${options.label}"]`),
      ),
    );
    node.value = options.value;
    node.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const submit = (label: string) =>
    parent
      .querySelector(`form[aria-label="${label}"]`)
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(parent.querySelector('form[aria-label="Sign in"]')).not.toBeNull());
  return { app, parent, failures, press, input, submit };
};
it("validates sign-in, protects the workspace, retains navigation state, and persists a per-account profile", async () => {
  const f = await fixture();
  expect(f.parent.querySelector(".auth-workspace")).toBeNull();
  f.input({ label: "Email address", value: "invalid" });
  f.submit("Sign in");
  await vi.waitFor(() =>
    expect(f.parent.querySelector('[role="alert"]')?.textContent).toContain("valid email"),
  );
  f.input({ label: "Email address", value: "ada@example.com" });
  f.submit("Sign in");
  await vi.waitFor(() => expect(f.parent.textContent).toContain("Welcome back, ada."));
  expect(f.parent.querySelector('form[aria-label="Sign in"]')).toBeNull();
  const workspace = f.parent.querySelector(".auth-workspace");
  await vi.waitFor(() => expect(f.parent.querySelector('input[type="checkbox"]')).not.toBeNull());
  f.parent
    .querySelector<HTMLInputElement>('input[type="checkbox"]')
    ?.dispatchEvent(new Event("change", { bubbles: true }));
  await vi.waitFor(() => expect(f.parent.textContent).toContain("1 of 3 completed"));
  f.press("Profile");
  await vi.waitFor(() =>
    expect(f.parent.querySelector<HTMLElement>('[aria-label="Profile settings"]')?.hidden).toBe(
      false,
    ),
  );
  f.input({ label: "Display name", value: "Ada Lovelace" });
  f.submit("Edit profile");
  await vi.waitFor(() => expect(f.parent.textContent).toContain("Profile saved."));
  f.press("Overview");
  await vi.waitFor(() =>
    expect(f.parent.querySelector<HTMLElement>('[aria-label="Workspace overview"]')?.hidden).toBe(
      false,
    ),
  );
  expect(f.parent.textContent).toContain("Welcome back, Ada Lovelace.");
  expect(f.parent.textContent).toContain("1 of 3 completed");
  expect(f.parent.querySelector(".auth-workspace")).toBe(workspace);
  f.press("Sign out");
  await vi.waitFor(() => expect(f.parent.querySelector(".auth-workspace")).toBeNull());
  f.submit("Sign in");
  await vi.waitFor(() => expect(f.parent.textContent).toContain("Welcome back, Ada Lovelace."));
  expect(f.parent.textContent).toContain("0 of 3 completed");
  await Effect.runPromise(
    f.app.batch(
      AuthControl.pipe(
        Effect.flatMap((auth) => auth.publish(Option.some({ email: "grace@example.com" }))),
      ),
    ),
  );
  await vi.waitFor(() => expect(f.parent.textContent).toContain("Welcome back, grace."));
  expect(f.parent.textContent).not.toContain("Ada Lovelace");
  await Effect.runPromise(
    f.app.batch(AuthControl.pipe(Effect.flatMap((auth) => auth.publish(Option.none())))),
  );
  await vi.waitFor(() => expect(f.parent.querySelector(".auth-workspace")).toBeNull());
  expect(f.failures).toEqual([]);
});
it("keeps the signed-in workspace and lets the user retry after logout failure", async () => {
  const f = await fixture();
  await Effect.runPromise(
    f.app.batch(Auth.pipe(Effect.flatMap((auth) => auth.signIn({ email: "reader@example.com" })))),
  );
  await vi.waitFor(() => expect(f.parent.querySelector(".auth-workspace")).not.toBeNull());
  const workspace = f.parent.querySelector(".auth-workspace");
  await Effect.runPromise(
    f.app.batch(
      AuthControl.pipe(
        Effect.flatMap((control) => control.failNextLogout(new AuthError({ message: "offline" }))),
      ),
    ),
  );
  f.press("Sign out");
  await vi.waitFor(() =>
    expect(f.parent.querySelector('[role="alert"]')?.textContent).toContain("Unable to sign out"),
  );
  expect(f.parent.querySelector(".auth-workspace")).toBe(workspace);
  f.press("Sign out");
  await vi.waitFor(() => expect(f.parent.querySelector(".auth-workspace")).toBeNull());
  expect(f.failures).toEqual([]);
});

it("disables sign-in while waiting and recovers from an authentication failure", async () => {
  const pending = await Effect.runPromise(Deferred.make<void, AuthError>());
  const session = await Effect.runPromise(
    SubscriptionRef.make(Option.none<{ readonly email: string }>()),
  );
  let requests = 0;
  const auth = Auth.of({
    sessions: SubscriptionRef.changes(session),
    signIn: ({ email }) =>
      Effect.gen(function* () {
        requests += 1;
        yield* Deferred.await(pending);
        yield* SubscriptionRef.set(session, Option.some({ email }));
      }),
    logout: () => SubscriptionRef.set(session, Option.none()),
  });
  const resources = Layer.mergeAll(
    Layer.succeed(Auth, auth),
    Layer.succeed(
      AuthControl,
      AuthControl.of({
        publish: (user) => SubscriptionRef.set(session, user),
        failNextLogout: () => Effect.void,
      }),
    ),
    LocalStorageMemory,
  );
  const f = await fixture(resources);
  f.submit("Sign in");
  await vi.waitFor(() =>
    expect(
      f.parent.querySelector<HTMLButtonElement>('form[aria-label="Sign in"] button')?.disabled,
    ).toBe(true),
  );
  expect(f.parent.textContent).toContain("Signing in…");
  expect(requests).toBe(1);
  await Effect.runPromise(
    Deferred.fail(pending, new AuthError({ message: "The service is unavailable." })),
  );
  await vi.waitFor(() =>
    expect(f.parent.querySelector('[role="alert"]')?.textContent).toContain("Unable to sign in"),
  );
  expect(f.parent.querySelector(".auth-workspace")).toBeNull();
  expect(
    f.parent.querySelector<HTMLButtonElement>('form[aria-label="Sign in"] button')?.disabled,
  ).toBe(false);
  expect(f.failures).toEqual([]);
});
