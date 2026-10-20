import { mounting } from "@charismaticalli/frappe";
import * as Query from "@charismaticalli/frappe/query";
import { Deferred, Effect, Exit, Option, Queue, Scope } from "effect";
import { afterEach, expect, it } from "vitest";
import type { AuthState } from "./model";
import { applyAuth } from "./partition";

const run = Effect.runPromise;
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
const session = (id: string): AuthState => ({
  _tag: "Ready",
  user: Option.some({ id, email: Option.none() }),
});
const harness = async () => {
  const scope = await run(Scope.make());
  const app = await run(
    mounting({
      scope,
      onError: (failure) => {
        throw failure;
      },
    }),
  );
  cleanup.push(() => run(Scope.close(scope, Exit.void)));
  const partition = await run(app.signal<Option.Option<string>>({ initial: Option.none() }));
  const client = await run(Query.configure({ context: app, partition, staleTime: Infinity }));
  const publish = (state: AuthState) =>
    run(applyAuth({ state, partition, admit: () => Effect.void }));
  return { app, client, partition, publish };
};
it("never executes without identity, invalidates A → B and logout, and preserves same-user refresh", async () => {
  const h = await harness();
  let calls = 0;
  const query = Query.define({ name: "fixture", load: () => Effect.sync(() => ++calls) });
  expect((await run(h.client.get({ query, input: "fixture" }).pipe(Effect.exit)))._tag).toBe(
    "Failure",
  );
  expect(calls).toBe(0);
  await h.publish(session("A"));
  expect(await run(h.client.get({ query, input: "fixture" }))).toBe(1);
  await h.publish({
    _tag: "Ready",
    user: Option.some({ id: "A", email: Option.some("updated@example.com") }),
  });
  expect(await run(h.client.get({ query, input: "fixture" }))).toBe(1);
  await h.publish(session("B"));
  expect(await run(h.client.get({ query, input: "fixture" }))).toBe(2);
  await h.publish({ _tag: "Ready", user: Option.none() });
  expect((await run(h.client.get({ query, input: "fixture" }).pipe(Effect.exit)))._tag).toBe(
    "Failure",
  );
  await h.publish(session("B"));
  expect(await run(h.client.get({ query, input: "fixture" }))).toBe(3);
});
it("clears old observers before route admission and never displays late A data to B", async () => {
  const h = await harness();
  const requests = await run(Queue.unbounded<Deferred.Deferred<string>>());
  const query = Query.define({
    name: "controlled",
    load: () =>
      Effect.gen(function* () {
        const result = yield* Deferred.make<string>();
        yield* Queue.offer(requests, result);
        return yield* Deferred.await(result);
      }),
  });
  const input = await run(h.app.signal({ initial: Option.some("same-key") }));
  const handle = await run(Query.observe({ context: h.app, query, input, retainPrevious: true }));
  expect(await run(handle.state.get)).toMatchObject({ _tag: "Initial", waiting: false });
  await h.publish(session("A"));
  const old = await run(Queue.take(requests));
  await run(
    applyAuth({
      state: session("B"),
      partition: h.partition,
      admit: () =>
        Effect.gen(function* () {
          expect(awaitState(yield* handle.state.get)).toBe("Initial");
        }),
    }),
  );
  const fresh = await run(Queue.take(requests));
  await run(Deferred.succeed(old, "private A data"));
  expect(await run(handle.state.get)).toMatchObject({
    _tag: "Initial",
    previousSuccess: Option.none(),
  });
  const read = run(h.client.get({ query, input: "same-key" }));
  await run(Deferred.succeed(fresh, "B data"));
  expect(await read).toBe("B data");
  expect(await run(handle.state.get)).toMatchObject({ _tag: "Success", value: "B data" });
  await h.publish({ _tag: "Initializing" });
  expect(await run(handle.state.get)).toMatchObject({
    _tag: "Initial",
    previousSuccess: Option.none(),
  });
});
const awaitState = (state: { readonly _tag: string }) => state._tag;
