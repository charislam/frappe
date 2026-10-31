import { Sync, cases, component } from "@charismaticalli/frappe";
import * as Query from "@charismaticalli/frappe/query";
import { Effect, Match, Option } from "effect";
import type { User } from "~/auth/model";
import type { Budget } from "~/budget/model";
import type { WorkspacePage } from "~/transitions";
import { BudgetPage } from "./budget-page";
import { workspaceQuery } from "./workspace-query";
import { type WorkspaceView, workspaceBranches } from "./workspace-views";

export type WorkspaceOptions = { user: User; page: WorkspacePage };
export const Workspace = (options: WorkspaceOptions) =>
  Match.value(options.page).pipe(
    Match.tag("New", () =>
      component(() =>
        Sync.succeed({
          setup: (context) =>
            Effect.gen(function* () {
              const budgets = yield* context.signal<ReadonlyArray<Budget>>({ initial: [] });
              return BudgetPage({ ...options, budgets });
            }),
        }),
      ),
    ),
    Match.orElse(() => BudgetWorkspace(options)),
  );
const BudgetWorkspace = (options: WorkspaceOptions) =>
  component(() =>
    Sync.succeed({
      setup: (context) =>
        Effect.gen(function* () {
          const input = yield* context.signal({ initial: Option.some(options.user.id) });
          const query = yield* Query.observe({
            context,
            query: workspaceQuery(options.page),
            input,
          });
          const state = yield* context.derive({
            sources: { query: query.state },
            compute: ({ query }): WorkspaceView =>
              Match.value(query).pipe(
                Match.tag("Success", ({ value }) => ({ _tag: "Loaded" as const, budgets: value })),
                Match.tag("Failure", () => ({ _tag: "Error" as const })),
                Match.tag("Initial", () => ({ _tag: "Loading" as const })),
                Match.exhaustive,
              ),
          });
          const branches = workspaceBranches(options, query.refresh);
          return cases({ state, branches });
        }),
    }),
  );
