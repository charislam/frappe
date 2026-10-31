import { type Signal, Sync, component } from "@charismaticalli/frappe";
import { Effect, Match, Option } from "effect";
import type { Budget } from "~/budget/model";
import { BudgetContent } from "./budget-content";
import { BudgetSelection } from "./budget-selection";
import { LogoutControls } from "./logout-controls";
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
          const address: string = Option.getOrElse(options.user.email, () => "Signed in");
          return yield* context.he("section", {
            attrs: { class: Option.some("budget-page") },
            children: [
              content,
              yield* context.he("p", { children: [address] }),
              LogoutControls(options.user.id),
            ],
          });
        }),
    }),
  );
