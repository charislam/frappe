import * as Query from "@charismaticalli/frappe/query";
import { Effect, Match, Option } from "effect";
import type { Budget } from "~/budget/model";
import { Preferences } from "~/budget/preferences";
import { Budgets } from "~/budget/service";
import type { WorkspacePage } from "~/transitions";

const resolveHome = Effect.fn("Workspace.resolveHome")(function* (userId: string) {
  const service = yield* Budgets;
  const preferences = yield* Preferences;
  const session = yield* preferences.session(userId);
  const saved = yield* session.read;
  const budget = yield* Option.match(saved, {
    onNone: () => Effect.succeed(Option.none<Budget>()),
    onSome: (id) => service.get.load({ userId, id }),
  });
  return yield* Option.match(budget, {
    onSome: (budget) => Effect.succeed([budget]),
    onNone: () =>
      Effect.gen(function* () {
        yield* Option.match(saved, { onNone: () => Effect.void, onSome: () => session.remove });
        return (yield* service.list.load({ userId, cursor: Option.none() })).budgets;
      }),
  });
});
const resolveWorkspace = Effect.fn("Workspace.resolve")(function* (options: {
  userId: string;
  page: WorkspacePage;
}) {
  const service = yield* Budgets;
  return yield* Match.value(options.page).pipe(
    Match.tag("Budget", ({ budgetId }) =>
      service.get.load({ userId: options.userId, id: budgetId }).pipe(Effect.map(Option.toArray)),
    ),
    Match.tag("Home", () => resolveHome(options.userId)),
    Match.tag("New", () => Effect.succeed<ReadonlyArray<Budget>>([])),
    Match.exhaustive,
  );
});
export const workspaceQuery = (page: WorkspacePage) =>
  Query.define({
    name: "Budgets.workspace",
    retry: Query.disabled(),
    load: (userId: string) => resolveWorkspace({ userId, page }),
  });
