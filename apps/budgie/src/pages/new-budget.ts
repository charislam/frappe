import { Sync, component } from "@charismaticalli/frappe";
import { Effect, Match, Option } from "effect";
import { BudgetId } from "~/budget/model";
import { Preferences } from "~/budget/preferences";
import { Budgets } from "~/budget/service";
import { Queries } from "~/context";
import { DataError } from "~/data-error";
import { navigateBudget } from "./budget-navigation";
import { field } from "./field";
import { formActions } from "./forms";
import type { WorkspaceOptions } from "./workspace";

type NewBudgetOptions = Pick<WorkspaceOptions, "user">;
type CreationOptions = NewBudgetOptions & {
  id: BudgetId;
  name: string;
};
const createAndVisit = Effect.fn("Budget.createAndVisit")(function* (options: CreationOptions) {
  const service = yield* Budgets;
  const preferences = yield* Preferences;
  const session = yield* preferences.session(options.user.id);
  const queries = yield* Queries;
  const budget = yield* service.create({ id: options.id, name: options.name }).pipe(
    Effect.mapError(
      (error) =>
        new DataError({
          cause: error,
          message: Match.value(error).pipe(
            Match.tag("InvalidBudgetName", "BudgetError", ({ message }) => message),
            Match.orElse(() => "Unable to create the budget. Please retry."),
          ),
        }),
    ),
  );
  yield* session.save(budget.id);
  yield* queries.invalidateDefinition({ query: service.list });
  return yield* navigateBudget(budget.id).pipe(Effect.as(Option.none()));
});
export const NewBudget = (options: NewBudgetOptions) =>
  component(() =>
    Sync.succeed({
      setup: (context) =>
        Effect.gen(function* () {
          const actions = yield* formActions(context);
          const name = yield* field({
            context,
            label: "Budget name",
            type: "text",
            autocomplete: "off",
            name: "budget-name",
          });
          const form = yield* context.he("form", {
            children: [
              name.label,
              yield* context.he("button", {
                attrs: { class: Option.some("primary") },
                props: { type: "submit", disabled: actions.pending },
                children: ["Create"],
              }),
            ],
          });
          const id = BudgetId.make(crypto.randomUUID());
          yield* actions.submit({
            form,
            fields: { name },
            work: ({ name }) => createAndVisit({ ...options, id, name }),
          });
          return yield* context.he("div", {
            children: [
              yield* context.he("h1", {
                attrs: { class: Option.some("page-heading") },
                children: ["Create budget"],
              }),
              form,
              actions.errorOutput,
              actions.statusOutput,
            ],
          });
        }),
    }),
  );
