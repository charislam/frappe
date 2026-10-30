import { Cause, Effect, Match, Option, Result } from "effect";
import { type ReactiveOwner, ownerRuntime } from "~/reactive/owner";
import {
  type ComponentLifetime,
  ReactiveError,
  type ReactiveRuntime,
  type Transaction,
  activeInTransaction,
  calculate,
  reportFailure,
  requireValid,
  requireValidSync,
} from "~/reactive/runtime";
import { type Signal, isSignal, readSync, signalData } from "~/reactive/signal";
import { browser } from "./head-browser";
import { type Metadata, resolve } from "./head-resolver";
export type { Metadata, Image, Snapshot, Clear, Field } from "./head-resolver";
export { MetadataError, clear, resolve } from "./head-resolver";

const brand: unique symbol = Symbol("Head");
export interface Handle {
  readonly [brand]: true;
}
interface Entry {
  readonly id: number;
  readonly ownerRuntime: ReactiveRuntime;
  readonly parent: Option.Option<Entry>;
  readonly children: Set<Entry>;
  readonly source: Metadata | Signal<Metadata>;
  readonly manager: Manager;
  active: boolean;
}
interface Manager {
  readonly rootRuntime: ReactiveRuntime;
  readonly reconcile: () => void;
  readonly validate: (
    transaction: Option.Option<Transaction>,
  ) => Result.Result<void, ReactiveError>;
  disposed: boolean;
}
const entries = new WeakMap<Handle, Entry>();
const documents = new WeakSet<Document>();
let sequence = 0;
const within = (owner: ComponentLifetime, parent: ComponentLifetime): boolean =>
  owner === parent ||
  Option.match(owner.parent, {
    onNone: () => false,
    onSome: (ancestor) => within(ancestor, parent),
  });
const alive = (entry: Entry, transaction: Option.Option<Transaction>): boolean =>
  entry.active &&
  !entry.manager.disposed &&
  Option.match(transaction, {
    onNone: () => entry.ownerRuntime.lifetime.active(),
    onSome: (tx) => activeInTransaction({ lifetime: entry.ownerRuntime.lifetime, transaction: tx }),
  });
const install = Effect.fn("Head.install")(function* (options: {
  context: ReactiveOwner;
  source: Metadata | Signal<Metadata>;
  parent: Option.Option<Entry>;
  manager: Manager;
}) {
  const runtime = yield* calculate(() => ownerRuntime(options.context));
  yield* requireValid(runtime.lifetime.active(), "Head owner is disposed");
  const entry: Entry = {
    id: ++sequence,
    ownerRuntime: runtime,
    parent: options.parent,
    children: new Set(),
    source: options.source,
    manager: options.manager,
    active: true,
  };
  yield* Match.value(options.source).pipe(
    Match.when(isSignal, (signal) => Effect.fromResult(readSync({ runtime, signal }))),
    Match.orElse(Effect.succeed),
  );
  const handle: Handle = { [brand]: true };
  entries.set(handle, entry);
  Option.map(entry.parent, (parent) => parent.children.add(entry));
  let disconnect = () => {};
  const cleanup = () => {
    entry.active = false;
    disconnect();
    runtime.lifetime.cleanups.delete(cleanup);
    Option.map(entry.parent, (parent) => parent.children.delete(entry));
    entry.manager.reconcile();
  };
  runtime.lifetime.cleanups.add(cleanup);
  Match.value(options.source).pipe(
    Match.when(isSignal, (signal) => {
      disconnect = signalData(signal).bind({
        validate: () => Result.succeed(undefined),
        flush: () => Effect.sync(entry.manager.reconcile),
      });
    }),
    Match.orElse(() => {}),
  );
  return { handle, entry, cleanup };
});
export const root = Effect.fn("Head.root")(function* (options: {
  context: ReactiveOwner;
  document: Document;
  defaults: Metadata | Signal<Metadata>;
  siteUrl?: string;
}) {
  const runtime = yield* calculate(() => ownerRuntime(options.context));
  yield* requireValid(runtime.lifetime.active(), "Head owner is disposed");
  yield* requireValid(!documents.has(options.document), "Document already has a Head root");
  const adapter = yield* Effect.fromResult(browser(options.document));
  let top = Option.none<Entry>();
  const snapshot = (transaction: Option.Option<Transaction>, includePending = false) =>
    Result.gen(function* () {
      const chain: Metadata[] = [];
      const visit = (entry: Entry): Result.Result<void, ReactiveError> =>
        Result.gen(function* () {
          yield* requireValidSync(alive(entry, transaction), "Inactive Head scope");
          const value = yield* Match.value(entry.source).pipe(
            Match.when(
              (source): source is Signal<Metadata> => isSignal(source),
              (signal) => signalData(signal).candidate(transaction),
            ),
            Match.orElse((value: Metadata) => Result.succeed(value)),
          );
          Match.value(includePending || entry.ownerRuntime.lifetime.presented).pipe(
            Match.when(true, () => {
              chain.push(value);
            }),
            Match.orElse(() => {}),
          );
          const children = [...entry.children].filter((child) => alive(child, transaction));
          yield* requireValidSync(
            children.length <= 1,
            `Head scope ${entry.id} has conflicting children: ${children.map((child) => child.id).join(", ")}`,
          );
          for (const child of children) yield* visit(child);
        });
      yield* Option.match(top, { onNone: () => Result.succeed(undefined), onSome: visit });
      return yield* resolve({
        chain,
        ...(options.siteUrl === undefined ? {} : { siteUrl: options.siteUrl }),
      }).pipe(
        Result.mapError((error) => new ReactiveError({ message: error.message, cause: error })),
      );
    });
  const ready = () => {
    const presented: Entry[] = [];
    const visit = (entry: Entry): void => {
      Match.value(alive(entry, Option.none())).pipe(
        Match.when(true, () => {
          Match.value(entry.ownerRuntime.lifetime.presented).pipe(
            Match.when(true, () => {
              presented.push(entry);
            }),
            Match.orElse(() => {}),
          );
          entry.children.forEach(visit);
        }),
        Match.orElse(() => {}),
      );
    };
    Option.map(top, visit);
    return [...runtime.coordinator.pendingPresentation]
      .filter((owner) => owner.active() && within(owner, runtime.lifetime))
      .every((owner) => presented.some((entry) => within(entry.ownerRuntime.lifetime, owner)));
  };
  const manager: Manager = {
    rootRuntime: runtime,
    disposed: false,
    validate: (transaction) => snapshot(transaction, true).pipe(Result.map(() => undefined)),
    reconcile: () => {
      Match.value(
        !manager.disposed &&
          !runtime.coordinator.committing &&
          runtime.lifetime.active() &&
          ready(),
      ).pipe(
        Match.when(true, () => {
          const result = snapshot(Option.none()).pipe(Result.flatMap(adapter.write));
          Result.match(result, {
            onSuccess: () => {},
            onFailure: (error) =>
              Effect.runSync(
                reportFailure({
                  runtime,
                  resource: adapter,
                  cause: Cause.fail(error),
                }),
              ),
          });
        }),
        Match.orElse(() => {}),
      );
    },
  };
  const observer = {
    validate: (transaction: Transaction) =>
      Effect.fromResult(manager.validate(Option.some(transaction))),
    flush: manager.reconcile,
  };
  const result = yield* install({
    context: options.context,
    source: options.defaults,
    parent: Option.none(),
    manager,
  });
  top = Option.some(result.entry);
  yield* Effect.fromResult(manager.validate(Option.none())).pipe(
    Effect.onError(() =>
      Effect.sync(() => {
        manager.disposed = true;
        result.cleanup();
        adapter.dispose();
      }),
    ),
  );
  yield* calculate(manager.reconcile);
  documents.add(options.document);
  runtime.coordinator.commitObservers.add(observer);
  runtime.lifetime.cleanups.add(() => {
    manager.disposed = true;
    runtime.coordinator.commitObservers.delete(observer);
    adapter.dispose();
    documents.delete(options.document);
  });
  return result.handle;
});
export const child = Effect.fn("Head.child")(function* (options: {
  context: ReactiveOwner;
  parent: Handle;
  metadata: Metadata | Signal<Metadata>;
}) {
  const parent = yield* Option.match(Option.fromUndefinedOr(entries.get(options.parent)), {
    onNone: () => Effect.fail(new ReactiveError({ message: "Invalid Head handle" })),
    onSome: Effect.succeed,
  });
  const runtime = yield* calculate(() => ownerRuntime(options.context));
  yield* requireValid(
    alive(parent, Option.none()) &&
      runtime.coordinator === parent.ownerRuntime.coordinator &&
      within(runtime.lifetime, parent.ownerRuntime.lifetime),
    "Head parent is disposed or belongs to an unrelated owner",
  );
  yield* requireValid(
    [...parent.children].every((child) => !alive(child, Option.none())),
    `Conflicting child of Head scope ${parent.id}`,
  );
  const result = yield* install({
    context: options.context,
    source: options.metadata,
    parent: Option.some(parent),
    manager: parent.manager,
  });
  yield* Effect.fromResult(parent.manager.validate(Option.none())).pipe(
    Effect.onError(() => Effect.sync(result.cleanup)),
  );
  yield* calculate(parent.manager.reconcile);
  return result.handle;
});
