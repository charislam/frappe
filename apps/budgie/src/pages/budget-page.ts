import { type Signal, Sync, component } from "@charismaticalli/frappe";
import { Effect, Match, Option } from "effect";
import type { Budget } from "~/budget/model";
import { BudgetContent } from "./budget-content";
import { BudgetSelection } from "./budget-selection";
import { NewBudget } from "./new-budget";
import type { WorkspaceOptions } from "./workspace";

export const BudgetPage = (
  options: WorkspaceOptions & { budgets: Signal<ReadonlyArray<Budget>> },
) =>
  component(() =>
    Sync.succeed({
      setup: (context) =>
        Effect.gen(function* () {
          const content = Match.value(options.page).pipe(
            Match.tag("Home", () => BudgetSelection({ ...options, userId: options.user.id })),
            Match.tag("New", () => NewBudget(options)),
            Match.tag("Budget", ({ budgetId }) =>
              BudgetContent({ ...options, userId: options.user.id, budgetId }),
            ),
            Match.exhaustive,
          );
          return yield* context.he("section", {
            attrs: { class: Option.some("budget-page") },
            children: [content],
          });
        }),
    }),
  );
