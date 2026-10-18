import { Effect, Match, Option, Result, Schema, SchemaParser } from "effect";
import { type ReactiveOwner, ownerRuntime } from "~/reactive/owner";
import { type ReactiveError, type Transaction, accessibleSync, runBatch } from "~/reactive/runtime";
import {
  type Signal,
  type WritableSignal,
  makeCell,
  readTransaction,
  readonlySignal,
  signalData,
} from "~/reactive/signal";
import { lazy } from "~/synchronous";
import { ValidationState } from "./state";

export interface ValidationHandle<I, A> {
  readonly state: Signal<ValidationState<I, A>>;
  readonly validate: () => Effect.Effect<void, ReactiveError>;
  readonly clearValidation: () => Effect.Effect<void, ReactiveError>;
  readonly reset: () => Effect.Effect<void, ReactiveError>;
}

/** Synchronous schemas only. Decoder defects and async execution fail the operation. */
export const attach = <I, S extends Schema.ConstraintDecoder<unknown>>(options: {
  readonly context: ReactiveOwner;
  readonly source: WritableSignal<I>;
  readonly schema: S & ([I] extends [S["Encoded"]] ? unknown : never);
}): Effect.Effect<ValidationHandle<I, S["Type"]>, ReactiveError> =>
  Effect.gen(function* () {
    const runtime = ownerRuntime(options.context);
    const source = signalData(options.source);
    yield* lazy(() =>
      accessibleSync({ consumer: runtime.lifetime, producer: source.participant.lifetime }),
    );
    const original = yield* options.source.get;
    let committedToken: object = {};
    const edits = new WeakMap<Transaction, object>();
    const explicit = new WeakSet<Transaction>();
    const previousInputs = new WeakMap<Transaction, { readonly input: I }>();
    // Tokens distinguish validate→edit→restore from an edit that coalesces away.
    // They remain transaction-local until the derived state commits.
    const token = (tx: Option.Option<Transaction>): object =>
      Option.match(tx, {
        onNone: () => committedToken,
        onSome: (transaction) =>
          Match.value(
            !explicit.has(transaction) &&
              Result.match(source.candidate(tx), {
                onSuccess: (input) => Object.is(input, source.committed()),
                onFailure: () => false,
              }),
          ).pipe(
            Match.when(true, () => committedToken),
            Match.orElse(() => edits.get(transaction) ?? committedToken),
          ),
      });
    const check = (transaction: Transaction) => {
      Result.map(source.candidate(Option.some(transaction)), (input) => {
        const previous = previousInputs.get(transaction) ?? { input: source.committed() };
        Match.value(Object.is(input, previous.input)).pipe(
          Match.when(false, () => {
            edits.set(transaction, {});
          }),
          Match.orElse(() => {}),
        );
        previousInputs.set(transaction, { input });
      });
    };
    // Writable lenses share their root's staging hook, but only edits to this
    // projection invalidate validation.
    const checks = runtime.coordinator.stagedChecks.get(source.writableRoot) ?? new Set();
    checks.add(check);
    runtime.coordinator.stagedChecks.set(source.writableRoot, checks);
    runtime.lifetime.cleanups.add(() => {
      checks.delete(check);
      Match.value(checks.size).pipe(
        Match.when(0, () => runtime.coordinator.stagedChecks.delete(source.writableRoot)),
        Match.orElse(() => {}),
      );
    });
    const record = makeCell<{
      readonly token: object;
      readonly state: ValidationState<I, S["Type"]>;
    }>({
      runtime,
      initial: { token: committedToken, state: ValidationState.NotValidated({ input: original }) },
      dependencies: [],
      compute: Option.none(),
    });
    const state = makeCell<ValidationState<I, S["Type"]>>({
      runtime,
      initial: ValidationState.NotValidated({ input: original }),
      dependencies: [source.participant, signalData(record).participant],
      compute: Option.some((tx) =>
        Result.gen(function* () {
          const input = yield* source.candidate(tx);
          const saved = yield* signalData(record).candidate(tx);
          return Match.value(saved.token === token(tx)).pipe(
            Match.when(true, () => saved.state),
            Match.orElse(() => ValidationState.NotValidated<I, S["Type"]>({ input })),
          );
        }),
      ),
      onPrepare: ({ transaction }) => {
        const next = token(Option.some(transaction));
        transaction.publications.push(() => {
          committedToken = next;
        });
      },
    });
    const publish = (next: ValidationState<I, S["Type"]>) =>
      Effect.gen(function* () {
        const tx = yield* readTransaction(runtime);
        Option.map(tx, (transaction) => {
          explicit.add(transaction);
        });
        yield* record.set({ token: token(tx), state: next });
      });
    const decode = SchemaParser.decodeUnknownResult(options.schema, {
      errors: "all",
      reportInput: false,
    });
    const clearValidation = () =>
      runBatch({
        runtime,
        work: Effect.gen(function* () {
          yield* publish(ValidationState.NotValidated({ input: yield* options.source.get }));
        }),
      });
    return {
      state: readonlySignal(state),
      validate: () =>
        runBatch({
          runtime,
          work: Effect.gen(function* () {
            const input = yield* options.source.get;
            const result = yield* Effect.sync(() => decode(input));
            yield* publish(
              Result.match(result, {
                onSuccess: (value) => ValidationState.Validated({ input, value }),
                onFailure: (issue) => ValidationState.Invalid({ input, issue }),
              }),
            );
          }),
        }),
      clearValidation,
      reset: () =>
        runBatch({
          runtime,
          work: options.source.set(original).pipe(Effect.andThen(clearValidation)),
        }),
    };
  });
