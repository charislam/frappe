import {
  type ComponentContext,
  Sync,
  component,
  keyed,
  nativeNode,
  occurrenceId,
  row,
} from "@charismaticalli/frappe";
import { Array, Effect, Match, Option } from "effect";
import { type Budget } from "~/budget/model";
import { destination } from "~/routes";
import { AuthLink } from "./auth-navigation";
import { budgetList } from "./budget-list";
import { navigateBudget } from "./budget-navigation";

type Options = { userId: string };
type List = Effect.Success<ReturnType<typeof budgetList>>;
const selectControl = Effect.fn("Budget.selectControl")(function* (
  context: ComponentContext,
  list: Pick<List, "budgets" | "busy">,
) {
  const { budgets, busy } = list;
  const id = occurrenceId("budget-selection");
  const choices = keyed({
    items: budgets,
    key: (budget) => budget.id,
    row: () =>
      row<Budget>()(({ inputs }) =>
        Sync.succeed({
          setup: (context) =>
            Effect.gen(function* () {
              const budget = yield* inputs.item.get;
              return yield* context.he("option", {
                props: { value: budget.id },
                children: [budget.name],
              });
            }),
        }),
      ),
  });
  const select = yield* context.he("select", {
    attrs: { id: Option.some(id) },
    props: { disabled: busy },
    children: [
      yield* context.he("option", {
        props: { value: "", disabled: true, selected: true },
        children: ["Select a budget"],
      }),
      choices,
    ],
  });
  yield* context.subscribe(yield* context.events(select, "change"), () =>
    Effect.gen(function* () {
      const rows = yield* budgets.get;
      yield* Option.match(
        Array.findFirst(rows, (budget) => budget.id === nativeNode(select).value),
        {
          onNone: () => Effect.void,
          onSome: ({ id }) => navigateBudget(id),
        },
      );
    }),
  );
  return yield* context.he("div", {
    attrs: { class: Option.some("budget-selector") },
    children: [
      yield* context.he("label", {
        attrs: { for: Option.some(id) },
        children: ["Budget"],
      }),
      select,
    ],
  });
});
const BudgetSelector = (options: Options) =>
  component(() =>
    Sync.succeed({
      setup: (context) =>
        Effect.gen(function* () {
          const {
            budgets,
            busy,
            error,
            retryHidden,
            moreHidden,
            empty,
            createHidden,
            loadMore,
            refresh,
          } = yield* budgetList(context, options.userId);
          const select = component(() =>
            Sync.succeed({ setup: (context) => selectControl(context, { budgets, busy }) }),
          );
          const visibleSelect = yield* context.derive({
            sources: { empty },
            compute: ({ empty }) =>
              Match.value(empty).pipe(
                Match.when(true, () => Option.none<typeof select>()),
                Match.orElse(() => Option.some(select)),
              ),
          });
          const more = yield* context.he("button", {
            props: { type: "button", hidden: moreHidden, disabled: busy },
            children: ["Load more budgets"],
          });
          yield* context.subscribe(yield* context.events(more, "click"), () => loadMore);
          const retry = yield* context.he("button", {
            props: { type: "button", hidden: retryHidden, disabled: busy },
            children: ["Retry"],
          });
          yield* context.subscribe(yield* context.events(retry, "click"), () => refresh);
          return yield* context.he("div", {
            children: [
              visibleSelect,
              more,
              yield* context.he("p", { attrs: { role: Option.some("alert") }, children: [error] }),
              retry,
              yield* context.he("div", {
                props: { hidden: createHidden },
                children: [
                  AuthLink({
                    destination: destination("New"),
                    label: "Create budget",
                  }),
                ],
              }),
            ],
          });
        }),
    }),
  );
export const ArchivedBudget = (options: Options) =>
  component(() =>
    Sync.succeed({
      setup: (context) =>
        Effect.gen(function* () {
          return yield* context.he("div", {
            children: [
              yield* context.he("p", { children: ["This budget is archived."] }),
              BudgetSelector(options),
            ],
          });
        }),
    }),
  );
