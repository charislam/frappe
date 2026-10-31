import { Resource } from "@charismaticalli/frappe";
import * as Query from "@charismaticalli/frappe/query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Effect, Match, Option, Schema } from "effect";
import { BudgetError } from "./error";
import { Budget, type BudgetId, validateName } from "./model";

interface Response {
  readonly data: unknown;
  readonly error: unknown;
  readonly status: number;
}
const request = Effect.fn("Budgets.request")(
  (work: (signal: AbortSignal) => PromiseLike<Response>) =>
    Effect.tryPromise({
      try: (signal) => Promise.resolve(work(signal)),
      catch: () =>
        new BudgetError({
          message: "Unable to reach budgets. Check your connection and retry.",
          status: Option.none(),
        }),
    }).pipe(
      Effect.flatMap((response) =>
        Match.value(response.error === null).pipe(
          Match.when(true, () => Effect.succeed(response.data)),
          Match.orElse(() =>
            Effect.fail(
              new BudgetError({
                message: "Unable to load or save this budget. Please retry.",
                status: Option.some(response.status),
              }),
            ),
          ),
        ),
      ),
    ),
);
export interface BudgetCursor {
  readonly created_at_raw: string;
  readonly id: BudgetId;
}
export interface BudgetListInput {
  readonly userId: string;
  readonly cursor: Option.Option<BudgetCursor>;
}
export interface BudgetListPage {
  readonly budgets: ReadonlyArray<Budget>;
  readonly next: Option.Option<BudgetCursor>;
}
export const budgetPageSize = 50;
const decodeFailure = (error: BudgetError | Schema.SchemaError) =>
  Match.value(error).pipe(
    Match.when(
      (error): error is BudgetError => error instanceof BudgetError,
      (error) => error,
    ),
    Match.orElse(
      () => new BudgetError({ message: "Budgets returned invalid data.", status: Option.none() }),
    ),
  );
export const makeBudgets = (client: SupabaseClient) => {
  const list = Query.define({
    name: "Budgets.list",
    retry: Query.disabled(),
    load: (input: BudgetListInput): Effect.Effect<BudgetListPage, BudgetError> =>
      request((signal) => {
        const query = client
          .from("budgets")
          .select("*")
          .is("archived_at", null)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .limit(budgetPageSize + 1);
        return Option.match(input.cursor, {
          onNone: () => query,
          onSome: (cursor) =>
            query.or(
              `created_at.gt.${cursor.created_at_raw},and(created_at.eq.${cursor.created_at_raw},id.gt.${cursor.id})`,
            ),
        }).abortSignal(signal);
      }).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Budget))),
        Effect.map((rows) => {
          const budgets = rows.slice(0, budgetPageSize);
          return {
            budgets,
            next: Match.value(rows.length > budgetPageSize).pipe(
              Match.when(true, () =>
                Option.map(
                  Option.fromUndefinedOr(budgets[budgets.length - 1]),
                  ({ id, created_at_raw }) => ({ id, created_at_raw }),
                ),
              ),
              Match.orElse(() => Option.none<BudgetCursor>()),
            ),
          };
        }),
        Effect.mapError(decodeFailure),
      ),
  });
  const get = Query.define({
    name: "Budgets.get",
    retry: Query.disabled(),
    load: (input: {
      userId: string;
      id: BudgetId;
    }): Effect.Effect<Option.Option<Budget>, BudgetError> =>
      Match.value(Schema.is(Schema.String.check(Schema.isUUID()))(input.id)).pipe(
        Match.when(false, () => Effect.succeed(Option.none<Budget>())),
        Match.when(true, () =>
          request((signal) =>
            client.from("budgets").select("*").eq("id", input.id).abortSignal(signal).maybeSingle(),
          ).pipe(
            Effect.flatMap((value) =>
              Option.match(Option.fromNullishOr(value), {
                onNone: () => Effect.succeed(Option.none<Budget>()),
                onSome: (row) =>
                  Schema.decodeUnknownEffect(Budget)(row).pipe(Effect.map(Option.some)),
              }),
            ),
            Effect.mapError(decodeFailure),
          ),
        ),
        Match.exhaustive,
      ),
  });
  return {
    list,
    get,
    create: Effect.fn("Budgets.create")(function* (input: { id: BudgetId; name: string }) {
      const name = yield* validateName(input.name);
      return yield* request((signal) =>
        client
          .rpc("create_budget", { budget_id: input.id, budget_name: name })
          .retry(false)
          .abortSignal(signal),
      ).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Budget)));
    }),
  };
};
export class Budgets extends Resource.Service<Budgets, ReturnType<typeof makeBudgets>>()(
  "budgie/Budgets",
) {}
