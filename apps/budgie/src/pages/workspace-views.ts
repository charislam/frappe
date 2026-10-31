import { type ReactiveError, type Signal, Sync, branch, component } from "@charismaticalli/frappe";
import { type Data, Effect, Option } from "effect";
import type { Budget } from "~/budget/model";
import { BudgetPage } from "./budget-page";
import type { WorkspaceOptions } from "./workspace";

export type WorkspaceView = Data.TaggedEnum<{
  Loading: {};
  Error: {};
  Loaded: { readonly budgets: ReadonlyArray<Budget> };
}>;
const WorkspaceLoading = component(() =>
  Sync.succeed({
    setup: (context) =>
      context.he("p", { attrs: { role: Option.some("status") }, children: ["Loading budgets…"] }),
  }),
);
const WorkspaceError = (refresh: Effect.Effect<void, ReactiveError>) =>
  component(() =>
    Sync.succeed({
      setup: (context) =>
        Effect.gen(function* () {
          const button = yield* context.he("button", {
            props: { type: "button" },
            children: ["Retry"],
          });
          yield* context.subscribe(yield* context.events(button, "click"), () => refresh);
          return yield* context.he("section", {
            children: [
              yield* context.he("p", {
                attrs: { role: Option.some("alert") },
                children: ["Unable to load budgets. Check your connection and retry."],
              }),
              button,
            ],
          });
        }),
    }),
  );
type Page<Tag extends WorkspaceView["_tag"]> = Extract<WorkspaceView, { _tag: Tag }>;
export const workspaceBranches = (
  options: WorkspaceOptions,
  refresh: Effect.Effect<void, ReactiveError>,
) => ({
  Loading: {
    branch: branch<Page<"Loading">, Signal<Page<"Loading">>>()(() =>
      Sync.succeed({ setup: () => Effect.succeed(WorkspaceLoading) }),
    ),
  },
  Error: {
    branch: branch<Page<"Error">, Signal<Page<"Error">>>()(() =>
      Sync.succeed({ setup: () => Effect.succeed(WorkspaceError(refresh)) }),
    ),
  },
  Loaded: {
    branch: branch<Page<"Loaded">, Signal<Page<"Loaded">>>()(({ inputs }) =>
      Sync.succeed({
        setup: (context) =>
          Effect.gen(function* () {
            const budgets = yield* context.derive({
              sources: { state: inputs.state },
              compute: ({ state }) => state.budgets,
            });
            return BudgetPage({ ...options, budgets });
          }),
      }),
    ),
  },
});
