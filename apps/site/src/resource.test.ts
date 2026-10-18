import { type MountFailure, Resource, mounting } from "@charismaticalli/frappe";
import {
  Effect,
  Context as EffectContext,
  Exit,
  Layer,
  Option,
  Queue,
  Scope,
  Stream,
  SubscriptionRef,
} from "effect";
import { KeyValueStoreError } from "effect/unstable/persistence/KeyValueStore";
import { afterEach, expect, it, vi } from "vitest";
import { AuthExample } from "~/examples/auth/example";
import { Auth, AuthControl, authMock } from "./auth";
import { AuthError } from "./auth-model";
import { LocalStorage, LocalStorageMemory } from "./local-storage";
import { rendered } from "./test-helpers";

const run = Effect.runPromise;
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});
const runtime = async <R extends Resource.Identifier>(resources: Layer.Layer<R>) => {
  const scope = await run(Scope.make());
  const close = () => run(Scope.close(scope, Exit.void));
  closers.push(close);
  const failures = await run(Queue.unbounded<MountFailure>());
  const app = await run(
    mounting({
      scope,
      resources,
      onError: (failure) => {
        Queue.offerUnsafe(failures, failure);
      },
    }),
  );
  return { app, close, failures, parent: document.createElement("main") };
};

it("seeds AuthExample from Auth and preserves the session when logout fails", async () => {
  const { app, parent, close, failures } = await runtime(
    Layer.mergeAll(
      authMock({ initial: Option.some({ email: "initial@example.com" }) }),
      LocalStorageMemory,
    ),
  );
  Effect.runSync(app.h(parent, AuthExample));
  await rendered({
    parent,
    check: () => parent.textContent?.includes("initial@example.com") === true,
  });
  await run(
    app.batch(
      AuthControl.pipe(
        Effect.flatMap((control) =>
          control.publish(Option.some({ email: "external@example.com" })),
        ),
      ),
    ),
  );
  await rendered({
    parent,
    check: () => parent.textContent?.includes("external@example.com") === true,
  });
  await run(
    app.batch(
      AuthControl.pipe(
        Effect.flatMap((control) =>
          control.failNextLogout(new AuthError({ message: "logout failed" })),
        ),
      ),
    ),
  );
  const logout =
    [...parent.querySelectorAll("button")].find((button) => button.textContent === "Sign out") ??
    document.createElement("button");
  (logout as HTMLButtonElement).click();
  await vi.waitFor(() =>
    expect(parent.querySelector('[role="alert"]')?.textContent).toContain("Unable to sign out"),
  );
  expect(parent.textContent).toContain("external@example.com");
  (logout as HTMLButtonElement).click();
  await rendered({
    parent,
    check: () => parent.querySelector('form[aria-label="Sign in"]') !== null,
  });
  expect(Queue.sizeUnsafe(failures)).toBe(0);
  await close();
});

it("isolates mock Auth sessions and LocalStorage memory between runtimes", async () => {
  const graph = Layer.mergeAll(authMock({ initial: Option.none() }), LocalStorageMemory);
  const first = await runtime(graph);
  const second = await runtime(graph);
  await Effect.runPromise(
    first.app.batch(
      Effect.gen(function* () {
        yield* (yield* Auth).signIn({ email: "first@example.com" });
        yield* (yield* LocalStorage).set({ key: "key", value: "first" });
      }),
    ),
  );
  expect(
    await Effect.runPromise(
      second.app.batch(LocalStorage.pipe(Effect.flatMap((storage) => storage.get("key")))),
    ),
  ).toEqual(Option.none());
  const sessions = await Effect.runPromise(
    second.app.batch(
      Auth.pipe(Effect.flatMap((auth) => auth.sessions.pipe(Stream.take(1), Stream.runCollect))),
    ),
  );
  expect(sessions).toEqual([Option.none()]);
  await first.close();
  await Effect.runPromise(
    second.app.batch(
      Auth.pipe(Effect.flatMap((auth) => auth.signIn({ email: "second@example.com" }))),
    ),
  );
  await second.close();
});

it("unmount cancels Auth session consumption while retaining the runtime listener", async () => {
  let listenersReleased = 0;
  let subscribers = 0;
  const stopped = await run(Queue.unbounded<void>());
  const resources = Layer.effectContext(
    Effect.gen(function* () {
      const session = yield* SubscriptionRef.make(Option.none<{ readonly email: string }>());
      yield* Effect.acquireRelease(Effect.void, () =>
        Effect.sync(() => {
          listenersReleased += 1;
        }),
      );
      const sessions = Stream.unwrap(
        Effect.acquireRelease(
          Effect.sync(() => {
            subscribers += 1;
          }),
          () => Queue.offer(stopped, undefined),
        ).pipe(Effect.as(SubscriptionRef.changes(session))),
      );
      const auth = Auth.of({
        sessions,
        signIn: ({ email }) => SubscriptionRef.set(session, Option.some({ email })),
        logout: () => SubscriptionRef.set(session, Option.none()),
      });
      const controls = AuthControl.of({
        publish: (value) => SubscriptionRef.set(session, value),
        failNextLogout: () => Effect.void,
      });
      return Auth.context(auth).pipe(EffectContext.add(AuthControl, controls));
    }),
  );
  const { app, parent, close } = await runtime(Layer.mergeAll(resources, LocalStorageMemory));
  Effect.runSync(app.h(parent, AuthExample));
  await rendered({
    parent,
    check: () => parent.querySelector('form[aria-label="Sign in"]') !== null,
  });
  await run(
    app.batch(
      AuthControl.pipe(
        Effect.flatMap((control) => control.publish(Option.some({ email: "first@example.com" }))),
      ),
    ),
  );
  await rendered({
    parent,
    check: () => parent.textContent?.includes("first@example.com") === true,
  });
  expect(subscribers).toBe(1);
  Effect.runSync(app.h(parent, []));
  await run(Queue.take(stopped));
  expect(listenersReleased).toBe(0);
  await run(
    app.batch(
      AuthControl.pipe(
        Effect.flatMap((control) =>
          control.publish(Option.some({ email: "while-unmounted@example.com" })),
        ),
      ),
    ),
  );
  Effect.runSync(app.h(parent, AuthExample));
  await rendered({
    parent,
    check: () => parent.textContent?.includes("while-unmounted@example.com") === true,
  });
  expect(subscribers).toBe(2);
  await close();
  await run(Queue.take(stopped));
  expect(listenersReleased).toBe(1);
});

it("signs in with the default email when persistence reads and writes fail", async () => {
  const diagnostic = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const failure = new KeyValueStoreError({ method: "get", message: "denied" });
    const { app, parent, failures } = await runtime(
      Layer.mergeAll(
        authMock({ initial: Option.none() }),
        Layer.succeed(
          LocalStorage,
          LocalStorage.of({
            persistent: true,
            get: () => Effect.fail(failure),
            set: () => Effect.fail(failure),
          }),
        ),
      ),
    );
    Effect.runSync(app.h(parent, AuthExample));
    await rendered({
      parent,
      check: () => parent.querySelector('form[aria-label="Sign in"]') !== null,
    });
    parent
      .querySelector('form[aria-label="Sign in"]')
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await rendered({
      parent,
      check: () => parent.textContent?.includes("reader@example.com") === true,
    });
    await vi.waitFor(() => expect(diagnostic.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(Queue.sizeUnsafe(failures)).toBe(0);
  } finally {
    diagnostic.mockRestore();
  }
});
