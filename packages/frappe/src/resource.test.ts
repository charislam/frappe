import {
  type Component,
  Context,
  type MountFailure,
  Resource,
  Sync,
  component,
  keyed,
  mounting,
  provideContext,
  row,
} from "@charismaticalli/frappe";
import {
  Cause,
  Deferred,
  Effect,
  Context as EffectContext,
  Exit,
  Fiber,
  Layer,
  Match,
  Option,
  Queue,
  Scope,
  Stream,
} from "effect";
import { afterEach, expect, it } from "vitest";
import { rendered } from "./test-helpers";

class Probe extends Resource.Service<Probe, { readonly id: number }>()("test/Probe") {}
class Other extends Resource.Service<Other, { readonly probe: { readonly id: number } }>()(
  "test/Other",
) {}
class Infrastructure extends EffectContext.Service<Infrastructure, { readonly id: number }>()(
  "test/Infrastructure",
) {}
class Binding extends Context.Service<Binding, string>()("test/Binding") {}

const run = Effect.runPromise;
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});
const parentScope = async () => {
  const scope = await run(Scope.make());
  const close = () => run(Scope.close(scope, Exit.void));
  closers.push(close);
  return { scope, close };
};
const runtime = async <R extends Resource.Identifier>(resources: Layer.Layer<R>) => {
  const { scope, close } = await parentScope();
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

it("acquires shared dependencies once per graph, isolates caller memoization, and survives remounts", async () => {
  let acquired = 0;
  const released: number[] = [];
  const infrastructure = Layer.effect(
    Infrastructure,
    Effect.acquireRelease(
      Effect.sync(() => ({ id: ++acquired })),
      ({ id }) =>
        Effect.sync(() => {
          released.push(id);
        }),
    ),
  );
  const probe = Layer.effect(Probe, Infrastructure).pipe(Layer.provide(infrastructure));
  const other = Layer.effect(Other, Infrastructure.pipe(Effect.map((probe) => ({ probe })))).pipe(
    Layer.provide(infrastructure),
  );
  const graph = Layer.mergeAll(probe, other);
  const firstScope = await parentScope();
  const secondScope = await parentScope();
  const callerMemo = Layer.makeMemoMapUnsafe();
  const make = (scope: Scope.Scope) =>
    run(
      mounting({ scope, resources: graph, onError: () => {} }).pipe(
        Effect.provideService(Layer.CurrentMemoMap, callerMemo),
      ),
    );
  const first = await make(firstScope.scope);
  const second = await make(secondScope.scope);
  expect(acquired).toBe(2);
  const ids = await run(
    first.batch(
      Effect.gen(function* () {
        const p = yield* Probe;
        expect((yield* Other).probe).toBe(p);
        return p.id;
      }),
    ),
  );
  expect(ids).toBe(1);
  expect(await run(second.batch(Probe))).toEqual({ id: 2 });
  const parent = document.createElement("div");
  const Reader = component(() =>
    Sync.succeed({
      setup: ({ he }) =>
        Probe.pipe(Effect.flatMap(({ id }) => he("p", { children: [String(id)] }))),
    }),
  );
  Effect.runSync(first.h(parent, Reader));
  await rendered({ parent, check: () => parent.textContent === "1" });
  Effect.runSync(first.h(parent, Reader));
  await rendered({ parent, check: () => parent.textContent === "1" });
  expect(acquired).toBe(2);
  await firstScope.close();
  expect(released).toEqual([1]);
  expect(await run(second.batch(Probe))).toEqual({ id: 2 });
  await secondScope.close();
  expect(released).toEqual([1, 2]);
});

it("withholds the application until acquisition completes and preserves typed failures and rollback", async () => {
  const { scope, close } = await parentScope();
  const entered = Deferred.makeUnsafe<void>();
  const gate = Deferred.makeUnsafe<void>();
  const released = Deferred.makeUnsafe<void>();
  const layer = Layer.effect(
    Probe,
    Effect.gen(function* () {
      yield* Effect.acquireRelease(Effect.void, () => Deferred.succeed(released, undefined));
      yield* Deferred.succeed(entered, undefined);
      yield* Deferred.await(gate);
      return { id: 1 };
    }),
  );
  const fiber = Effect.runFork(
    mounting({
      scope,
      resources: layer,
      onError: () => {
        throw new Error("acquisition must not report");
      },
    }),
  );
  await run(Deferred.await(entered));
  expect(fiber.pollUnsafe()).toBeUndefined();
  await run(Deferred.succeed(gate, undefined));
  const app = await run(Fiber.join(fiber));
  expect(await run(app.batch(Probe))).toEqual({ id: 1 });
  await close();
  await run(Deferred.await(released));

  const failedScope = await parentScope();
  const order: string[] = [];
  const failing = Layer.effect(
    Probe,
    Effect.gen(function* () {
      yield* Effect.acquireRelease(Effect.void, () =>
        Effect.sync(() => {
          order.push("released");
        }),
      );
      return yield* Effect.fail("acquisition failed" as const);
    }),
  );
  const exit = await run(
    mounting({
      scope: failedScope.scope,
      resources: failing,
      onError: () => {
        order.push("reported");
      },
    }).pipe(Effect.exit),
  );
  expect(exit).toEqual(Exit.fail("acquisition failed"));
  expect(order).toEqual(["released"]);
});

it("cancels acquisition and releases partial resources when the caller or parent scope closes", async () => {
  for (const cancellation of ["caller", "parent"] as const) {
    const { scope, close } = await parentScope();
    const entered = Deferred.makeUnsafe<void>();
    let released = 0;
    const layer = Layer.effect(
      Probe,
      Effect.gen(function* () {
        yield* Effect.acquireRelease(Effect.void, () =>
          Effect.sync(() => {
            released += 1;
          }),
        );
        yield* Deferred.succeed(entered, undefined);
        return yield* Effect.never;
      }),
    );
    const fiber = Effect.runFork(
      mounting({
        scope,
        resources: layer,
        onError: () => {
          throw new Error("unexpected report");
        },
      }),
    );
    await run(Deferred.await(entered));
    await Match.value(cancellation).pipe(
      Match.when("caller", () => run(Fiber.interrupt(fiber))),
      Match.when("parent", close),
      Match.exhaustive,
    );
    const exit = await run(Fiber.await(fiber));
    expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true);
    expect(released).toBe(1);
    await close();
    expect(released).toBe(1);
  }
});

it("cannot expose a runtime from an already closed parent scope", async () => {
  const { scope, close } = await parentScope();
  await close();
  let acquired = 0;
  const resources = Layer.effect(
    Probe,
    Effect.sync(() => ({ id: ++acquired })),
  );
  const exit = await run(mounting({ scope, resources, onError: () => {} }).pipe(Effect.exit));
  expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true);
  expect(acquired).toBe(0);
});

it("makes resources available in factories, fallback, setup, structural children and captured work", async () => {
  const { app, parent, close, failures } = await runtime(Layer.succeed(Probe, { id: 1 }));
  const observations = await run(Queue.unbounded<string>());
  const ready = Deferred.makeUnsafe<void>();
  const fallbackWork = Deferred.makeUnsafe<void>();
  const signalChild = component(() =>
    Sync.succeed({
      setup: () =>
        Effect.gen(function* () {
          Queue.offerUnsafe(observations, `selection:${(yield* Probe).id}:${yield* Binding}`);
          return [];
        }),
    }),
  );
  const keyedChild = row<number>()(() =>
    Sync.gen(function* () {
      const probe = yield* Sync.service(Probe);
      const binding = yield* Sync.service(Binding);
      Queue.offerUnsafe(observations, `row:${probe.id}:${binding}`);
      return { setup: () => Effect.succeed([]) };
    }),
  );
  const imperativeChild = component(() =>
    Sync.succeed({
      setup: () =>
        Effect.gen(function* () {
          Queue.offerUnsafe(observations, `imperative:${(yield* Probe).id}:${yield* Binding}`);
          return [];
        }),
    }),
  );
  const Root = component(({ signal, fork, subscribeStream }) =>
    Sync.gen(function* () {
      const probe = yield* Sync.service(Probe);
      Queue.offerUnsafe(observations, `factory:${probe.id}:${yield* Sync.service(Binding)}`);
      yield* fork(
        Effect.gen(function* () {
          Queue.offerUnsafe(observations, `factory-fork:${(yield* Probe).id}:${yield* Binding}`);
        }),
      );
      yield* subscribeStream(Stream.fromEffect(Probe), (value) =>
        Effect.gen(function* () {
          Queue.offerUnsafe(observations, `factory-stream:${value.id}:${yield* Binding}`);
        }),
      );
      const selection = yield* signal<Option.Option<Component<Probe | Binding>>>({
        initial: Option.some(signalChild),
      });
      const items = yield* signal<ReadonlyArray<number>>({ initial: [1] });
      return {
        fallback: ({ he, fork }) =>
          Sync.gen(function* () {
            Queue.offerUnsafe(
              observations,
              `fallback:${(yield* Sync.service(Probe)).id}:${yield* Sync.service(Binding)}`,
            );
            yield* fork(
              Effect.gen(function* () {
                Queue.offerUnsafe(
                  observations,
                  `fallback-fork:${(yield* Probe).id}:${yield* Binding}`,
                );
                yield* Deferred.succeed(fallbackWork, undefined);
              }),
            );
            return yield* he("p", { children: ["pending"] });
          }),
        setup: ({ he, h, fork, subscribeStream, source, subscribe, batch }) =>
          Effect.gen(function* () {
            Queue.offerUnsafe(observations, `setup:${(yield* Probe).id}:${yield* Binding}`);
            yield* Deferred.await(fallbackWork);
            yield* Effect.addFinalizer(() =>
              Effect.gen(function* () {
                Queue.offerUnsafe(observations, `finalizer:${(yield* Probe).id}:${yield* Binding}`);
              }),
            );
            yield* fork(
              Effect.gen(function* () {
                Queue.offerUnsafe(observations, `fork:${(yield* Probe).id}:${yield* Binding}`);
              }),
            );
            yield* subscribeStream(Stream.fromEffect(Probe), (probe) =>
              Effect.gen(function* () {
                Queue.offerUnsafe(observations, `stream:${probe.id}:${yield* Binding}`);
              }),
            );
            const events = yield* source<void>();
            yield* subscribe(events.events, () =>
              Effect.gen(function* () {
                Queue.offerUnsafe(observations, `event:${(yield* Probe).id}:${yield* Binding}`);
              }),
            ).pipe(
              Effect.provideService(Probe, { id: 99 }),
              Effect.provideService(Binding, "captured"),
            );
            yield* fork(batch(events.emit(undefined)));
            const target = yield* he("section");
            yield* h(target, imperativeChild).pipe(
              Effect.provideService(Probe, { id: 100 }),
              Effect.provideService(Binding, "incidental"),
            );
            yield* Deferred.succeed(ready, undefined);
            return yield* he("div", {
              children: [
                target,
                selection,
                keyed({ items, key: (item) => item, row: () => keyedChild }),
              ],
            });
          }),
      };
    }),
  );
  Effect.runSync(app.h(parent, provideContext({ key: Binding, value: "ancestor", child: Root })));
  await run(Deferred.await(ready));
  const values = await run(
    Effect.forEach(Array.from({ length: 12 }), () => Queue.take(observations)),
  );
  expect(values.sort()).toEqual(
    [
      "factory:1:ancestor",
      "factory-fork:1:ancestor",
      "factory-stream:1:ancestor",
      "fallback:1:ancestor",
      "fallback-fork:1:ancestor",
      "setup:1:ancestor",
      "fork:1:ancestor",
      "stream:1:ancestor",
      "event:99:captured",
      "imperative:1:ancestor",
      "selection:1:ancestor",
      "row:1:ancestor",
    ].sort(),
  );
  await close();
  expect(await run(Queue.take(observations))).toBe("finalizer:1:ancestor");
  expect(Queue.sizeUnsafe(failures)).toBe(0);
});

it("application helpers supply resources, preserve local capture and retain residual services", async () => {
  const { app, failures, close } = await runtime(Layer.succeed(Probe, { id: 1 }));
  expect(await run(app.batch(Probe))).toEqual({ id: 1 });
  const observed = await run(Queue.unbounded<number>());
  const observe = Probe.pipe(Effect.flatMap(({ id }) => Queue.offer(observed, id)));
  await run(app.fork(observe));
  expect(await run(Queue.take(observed))).toBe(1);
  await run(app.fork(observe).pipe(Effect.provideService(Probe, { id: 2 })));
  expect(await run(Queue.take(observed))).toBe(2);
  await run(app.subscribeStream(Stream.fromEffect(Probe), ({ id }) => Queue.offer(observed, id)));
  expect(await run(Queue.take(observed))).toBe(1);
  await run(
    app
      .subscribeStream(Stream.fromEffect(Probe), ({ id }) => Queue.offer(observed, id))
      .pipe(Effect.provideService(Probe, { id: 3 })),
  );
  expect(await run(Queue.take(observed))).toBe(3);
  const events = await run(app.source<void>());
  await run(app.subscribe(events.events, () => observe));
  await run(app.batch(events.emit(undefined)));
  expect(await run(Queue.take(observed))).toBe(1);
  const folded = await run(
    app.foldStream({
      stream: Stream.fromEffect(Probe),
      initial: 0,
      reducer: ({ event }) => event.id,
    }),
  );
  const foldedValue = await run(
    folded.changes.pipe(
      Effect.flatMap((changes) =>
        changes.pipe(
          Stream.filter((value) => value === 1),
          Stream.take(1),
          Stream.runCollect,
        ),
      ),
    ),
  );
  expect(foldedValue).toEqual([1]);
  const residual = app.fork(
    Infrastructure.pipe(Effect.flatMap(({ id }) => Queue.offer(observed, id))),
  );
  await run(residual.pipe(Effect.provideService(Infrastructure, { id: 4 })));
  expect(await run(Queue.take(observed))).toBe(4);
  await close();
  expect(Queue.sizeUnsafe(failures)).toBe(0);
});

it("awaits component cleanup before resource release, including retired branches and cleanup defects", async () => {
  const order: string[] = [];
  const cleanupStarted = Deferred.makeUnsafe<void>();
  const finishCleanup = Deferred.makeUnsafe<void>();
  const ready = Deferred.makeUnsafe<void>();
  const resources = Layer.effect(
    Probe,
    Effect.acquireRelease(Effect.succeed({ id: 1 }), () =>
      Effect.sync(() => {
        order.push("resource");
      }),
    ),
  );
  const { app, parent, close, failures } = await runtime(resources);
  const Child = component(() =>
    Sync.succeed({
      setup: () =>
        Effect.gen(function* () {
          yield* Effect.addFinalizer(() =>
            Effect.gen(function* () {
              expect((yield* Probe).id).toBe(1);
              yield* Deferred.succeed(cleanupStarted, undefined);
              yield* Deferred.await(finishCleanup);
              order.push("child");
              yield* Effect.die("cleanup defect");
            }),
          );
          yield* Deferred.succeed(ready, undefined);
          return [];
        }),
    }),
  );
  Effect.runSync(app.h(parent, Child));
  await run(Deferred.await(ready));
  Effect.runSync(app.h(parent, []));
  await run(Deferred.await(cleanupStarted));
  const closing = close();
  expect(order).toEqual([]);
  await run(Deferred.succeed(finishCleanup, undefined));
  await closing;
  expect(order).toEqual(["child", "resource"]);
  const failure = await run(Queue.take(failures));
  expect(failure.operation).toBe("cleanup");
  expect(Cause.hasDies(failure.cause)).toBe(true);
  await close();
  expect(order).toEqual(["child", "resource"]);
});

it("rejects malformed providers with useful defects and keeps equal names in separate namespaces", () => {
  class SameResource extends Resource.Service<SameResource, string>()("same") {}
  class SameContext extends Context.Service<SameContext, string>()("same") {}
  expect(SameResource.key).not.toBe(SameContext.key);
  const Empty = component(() => Sync.succeed({ setup: () => Effect.succeed([]) }));
  expect(() => {
    // @ts-expect-error Deliberately malformed untyped input.
    provideContext({ key: SameResource, value: "resource", child: Empty });
  }).toThrow("frappé context token");
  expect(() => {
    // @ts-expect-error Deliberately malformed untyped input.
    provideContext({ key: undefined, value: "missing", child: Empty });
  }).toThrow("frappé context token");
});

it("retains acquisition and release causes without reporting an acquisition failure twice", async () => {
  const { scope, close } = await parentScope();
  let reports = 0;
  let releases = 0;
  const resources = Layer.effect(
    Probe,
    Effect.gen(function* () {
      yield* Effect.acquireRelease(Effect.void, () =>
        Effect.sync(() => {
          releases += 1;
        }).pipe(Effect.andThen(Effect.die("release defect"))),
      );
      return yield* Effect.fail("acquisition failure");
    }),
  );
  const exit = await run(
    mounting({
      scope,
      resources,
      onError: () => {
        reports += 1;
      },
    }).pipe(Effect.exit),
  );
  expect(Exit.isFailure(exit)).toBe(true);
  expect(Exit.isFailure(exit) && Cause.hasFails(exit.cause)).toBe(true);
  expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
  expect(releases).toBe(1);
  expect(reports).toBe(0);
  await close();
  expect(releases).toBe(1);
});

it("keeps resource-free acquisition synchronous and rejects erased non-resource exports", async () => {
  const { scope } = await parentScope();
  const application = Effect.runSync(mounting({ scope, onError: () => {} }));
  expect(application.addFinalizer).toBeDefined();
  expect("scope" in application).toBe(false);
  expect(
    Effect.runSync(mounting({ scope, resources: Layer.empty, onError: () => {} })).addFinalizer,
  ).toBeDefined();
  const invalid = await run(
    mounting({
      scope,
      // @ts-expect-error Deliberately exercise an erased ordinary service layer.
      resources: Layer.succeed(Infrastructure, { id: 1 }),
      onError: () => {
        throw new Error("acquisition must not report");
      },
    }).pipe(Effect.exit),
  );
  expect(Exit.isFailure(invalid) && Cause.pretty(invalid.cause)).toContain("use Resource.Service");
});

it("releases partial acquisition when a layer closes the parent scope itself", async () => {
  const { scope } = await parentScope();
  let released = 0;
  const resources = Layer.effect(
    Probe,
    Effect.gen(function* () {
      yield* Effect.acquireRelease(Effect.void, () =>
        Effect.sync(() => {
          released += 1;
        }),
      );
      yield* Scope.close(scope, Exit.void);
      return { id: 1 };
    }),
  );
  const exit = await run(mounting({ scope, resources, onError: () => {} }).pipe(Effect.exit));
  expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true);
  expect(released).toBe(1);
});
