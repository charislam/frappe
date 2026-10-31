import { type Signal, Sync, component } from "@charismaticalli/frappe";
import { Effect, Match, Option } from "effect";
import { type Budget, selection } from "~/budget/model";
import { Preferences } from "~/budget/preferences";
import { destination } from "~/routes";
import { navigateAuth } from "./auth-navigation";
import { navigateBudget } from "./budget-navigation";

export const BudgetSelection = (options: {
  userId: string;
  budgets: Signal<ReadonlyArray<Budget>>;
}) =>
  component(() =>
    Sync.succeed({
      setup: (context) =>
        Effect.gen(function* () {
          const preferences = yield* Preferences;
          const session = yield* preferences.session(options.userId);
          yield* context.subscribeStream(yield* options.budgets.changes, (budgets) =>
            Effect.gen(function* () {
              const result = selection({ budgets, saved: yield* session.read });
              yield* Match.value(result.stale).pipe(
                Match.when(true, () => session.remove),
                Match.orElse(() => Effect.void),
              );
              yield* Option.match(result.budget, {
                onNone: () => navigateAuth({ destination: destination("New"), mode: "replace" }),
                onSome: ({ id }) => navigateBudget(id),
              }).pipe(Effect.ignore);
            }),
          );
          return yield* context.he("p", {
            attrs: { role: Option.some("status") },
            children: ["Opening your budget…"],
          });
        }),
    }),
  );
