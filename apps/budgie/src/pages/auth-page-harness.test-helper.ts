import { mounting, provideContext } from "@charismaticalli/frappe";
import * as Query from "@charismaticalli/frappe/query";
import { History, type MemoryHistory, memoryHistory } from "@charismaticalli/frappe/router";
import { Cause, Effect, Exit, Layer, Option, Scope } from "effect";
import { App } from "~/app";
import type { AuthState } from "~/auth/model";
import { Auth } from "~/auth/service";
import type { BudgetError } from "~/budget/error";
import type { Budget } from "~/budget/model";
import { preferencesLayer } from "~/budget/preferences";
import { Budgets, type BudgetListInput, type BudgetListPage } from "~/budget/service";
import { Queries } from "~/context";
import { pageControls } from "./auth-page-dom.test-helper";
import { makePageAuth } from "./auth-page-driver.test-helper";

const run = Effect.runPromise;
export const emptyBudgets: Budgets["Service"] = {
  list: Query.define({
    name: "test.budgets",
    load: (_input: BudgetListInput): Effect.Effect<BudgetListPage, BudgetError> =>
      Effect.succeed({ budgets: [], next: Option.none() }),
  }),
  get: Query.define({
    name: "test.budget",
    load: (_input: {
      userId: string;
      id: Budget["id"];
    }): Effect.Effect<Option.Option<Budget>, BudgetError> => Effect.succeed(Option.none()),
  }),
  create: () => Effect.die("Unexpected creation"),
};
const cleanups: Array<() => Promise<void>> = [];
export const cleanupAuthPages = async () => {
  for (const close of cleanups.splice(0)) await close();
  document.body.replaceChildren();
  localStorage.clear();
};
const mountPage = async (options: {
  scope: Scope.Scope;
  history: MemoryHistory;
  auth: Auth["Service"];
  budgets: Budgets["Service"];
}) => {
  const { scope, history, auth } = options;
  const failures: string[] = [];
  const app = await run(
    mounting({
      scope,
      onError: (failure) => failures.push(`${failure.operation}: ${Cause.pretty(failure.cause)}`),
      resources: Layer.mergeAll(
        Layer.succeed(Auth, auth),
        Layer.succeed(History, history),
        preferencesLayer(() => localStorage),
        Layer.succeed(Budgets, options.budgets),
      ),
    }),
  );
  const partition = await run(app.signal<Option.Option<string>>({ initial: Option.none() }));
  const queries = await run(Query.configure({ context: app, partition }));
  const root = document.createElement("div");
  document.body.append(root);
  await run(app.h(root, provideContext({ key: Queries, value: queries, child: App(partition) })));
  return { root, failures };
};
export const harness = async (
  options: { initial: string; auth: Option.Option<AuthState> } = {
    initial: "/login",
    auth: Option.none(),
  },
  budgets: Budgets["Service"] = emptyBudgets,
) => {
  const scope = await run(Scope.make());
  cleanups.push(() => run(Scope.close(scope, Exit.void)));
  const history = await run(memoryHistory({ initial: options.initial }).pipe(Scope.provide(scope)));
  const { auth, ...controls } = await makePageAuth(options.auth);
  const page = await mountPage({ scope, history, auth, budgets });
  return { ...page, history, ...controls, ...pageControls(page) };
};
