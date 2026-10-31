import { type Signal, Sync, branch, cases, component } from "@charismaticalli/frappe";
import { Array, type Data, Effect, Match, Option } from "effect";
import type { Budget, BudgetId } from "~/budget/model";
import { Preferences } from "~/budget/preferences";
import { ArchivedBudget } from "./archived-budget";

type BudgetView = Data.TaggedEnum<{ Unavailable: {}; Available: { readonly budget: Budget } }>;
const AvailableBudget = (options: { userId: string; budget: Signal<Budget> }) =>
  component(() =>
    Sync.succeed({
      setup: (context) =>
        Effect.gen(function* () {
          const preferences = yield* Preferences;
          const session = yield* preferences.session(options.userId);
          yield* session.save((yield* options.budget.get).id);
          const name = yield* context.derive({
            sources: { budget: options.budget },
            compute: ({ budget }) => budget.name,
          });
          const archived = yield* context.derive({
            sources: { budget: options.budget },
            compute: ({ budget }) => budget.archived_at !== null,
          });
          const archivedContent = ArchivedBudget({ userId: options.userId });
          const content = yield* context.derive({
            sources: { archived },
            compute: ({ archived }) =>
              Match.value(archived).pipe(
                Match.when(true, () => Option.some(archivedContent)),
                Match.orElse(() => Option.none()),
              ),
          });
          return yield* context.he("div", {
            children: [
              yield* context.he("h1", {
                attrs: { class: Option.some("page-heading") },
                children: [name],
              }),
              content,
            ],
          });
        }),
    }),
  );
export const BudgetContent = (options: {
  userId: string;
  budgetId: BudgetId;
  budgets: Signal<ReadonlyArray<Budget>>;
}) =>
  component(() =>
    Sync.succeed({
      setup: (context) =>
        Effect.gen(function* () {
          const state = yield* context.derive({
            sources: { budgets: options.budgets },
            compute: ({ budgets }): BudgetView =>
              Option.match(
                Array.findFirst(budgets, (budget) => budget.id === options.budgetId),
                {
                  onNone: () => ({ _tag: "Unavailable" }),
                  onSome: (budget) => ({ _tag: "Available", budget }),
                },
              ),
          });
          const branches = {
            Unavailable: {
              branch: branch<
                Extract<BudgetView, { _tag: "Unavailable" }>,
                Signal<Extract<BudgetView, { _tag: "Unavailable" }>>
              >()(() =>
                Sync.succeed({
                  setup: (context) =>
                    context.he("div", { children: ["This budget is unavailable."] }),
                }),
              ),
            },
            Available: {
              branch: branch<
                Extract<BudgetView, { _tag: "Available" }>,
                Signal<Extract<BudgetView, { _tag: "Available" }>>
              >()(({ inputs }) =>
                Sync.succeed({
                  setup: (context) =>
                    Effect.gen(function* () {
                      const budget = yield* context.derive({
                        sources: { state: inputs.state },
                        compute: ({ state }) => state.budget,
                      });
                      return AvailableBudget({ userId: options.userId, budget });
                    }),
                }),
              ),
            },
          };
          return cases({ state, branches });
        }),
    }),
  );
