import type { ComponentContext } from "@charismaticalli/frappe";
import * as Query from "@charismaticalli/frappe/query";
import { Effect, Match, Option } from "effect";
import type { Budget } from "~/budget/model";
import { Budgets, type BudgetCursor, type BudgetListInput } from "~/budget/service";

export const budgetList = Effect.fn("Budget.listController")(function* (
  context: ComponentContext,
  userId: string,
) {
  const service = yield* Budgets;
  const input = yield* context.signal<Option.Option<BudgetListInput>>({
    initial: Option.some({ userId: userId, cursor: Option.none() }),
  });
  const query = yield* Query.observe({ context, query: service.list, input });
  const budgets = yield* context.signal<ReadonlyArray<Budget>>({ initial: [] });
  const next = yield* context.signal<Option.Option<BudgetCursor>>({ initial: Option.none() });
  yield* context.subscribeStream(yield* query.state.changes, (state) =>
    Match.value(state).pipe(
      Match.tag("Success", ({ value }) =>
        Effect.gen(function* () {
          const previous = yield* budgets.get;
          yield* budgets.set([
            ...new Map(
              [...previous, ...value.budgets].map((budget) => [budget.id, budget]),
            ).values(),
          ]);
          yield* next.set(value.next);
        }),
      ),
      Match.orElse(() => Effect.void),
    ),
  );
  const busy = yield* context.derive({
    sources: { state: query.state },
    compute: ({ state }) => state.waiting,
  });
  const error = yield* context.derive({
    sources: { state: query.state },
    compute: ({ state }) =>
      Match.value(state).pipe(
        Match.tag("Failure", () => "Unable to load budgets. Please retry."),
        Match.orElse(() => ""),
      ),
  });
  const retryHidden = yield* context.derive({
    sources: { state: query.state },
    compute: ({ state }) => state._tag !== "Failure",
  });
  const moreHidden = yield* context.derive({
    sources: { next, state: query.state },
    compute: ({ next, state }) => Option.isNone(next) || state._tag === "Failure",
  });
  const empty = yield* context.derive({
    sources: { budgets },
    compute: ({ budgets }) => budgets.length === 0,
  });
  const createHidden = yield* context.derive({
    sources: { budgets, state: query.state },
    compute: ({ budgets, state }) => budgets.length > 0 || state._tag !== "Success",
  });
  const loadMore = Effect.gen(function* () {
    const cursor = yield* next.get;
    yield* Match.value(yield* busy.get).pipe(
      Match.when(true, () => Effect.void),
      Match.orElse(() =>
        Option.match(cursor, {
          onNone: () => Effect.void,
          onSome: (cursor) => input.set(Option.some({ userId, cursor: Option.some(cursor) })),
        }),
      ),
    );
  });
  return {
    budgets,
    busy,
    error,
    retryHidden,
    moreHidden,
    empty,
    createHidden,
    loadMore,
    refresh: query.refresh,
  };
});
