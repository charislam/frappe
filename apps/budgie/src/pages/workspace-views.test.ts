// @vitest-environment happy-dom
import { Sync, cases, component, mounting, provideContext } from "@charismaticalli/frappe";
import * as Query from "@charismaticalli/frappe/query";
import { Effect, Layer, Option, Schema } from "effect";
import { expect, it } from "vitest";
import { Auth } from "~/auth/service";
import { Budget, BudgetId } from "~/budget/model";
import { preferencesLayer } from "~/budget/preferences";
import { Budgets } from "~/budget/service";
import { Navigation, Queries } from "~/context";
import { makePageAuth } from "./auth-page-driver.test-helper";
import { emptyBudgets } from "./auth-page-harness.test-helper";
import { type WorkspaceView, workspaceBranches } from "./workspace-views";

it("updates loaded budgets without replacing the page or its controls", async () => {
  const { auth } = await makePageAuth(Option.none());
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* Effect.acquireRelease(
          Effect.sync(() => {
            const root = document.createElement("div");
            document.body.append(root);
            return root;
          }),
          (root) =>
            Effect.sync(() => {
              root.remove();
              localStorage.clear();
            }),
        );
        const failures: unknown[] = [];
        const app = yield* mounting({
          scope: yield* Effect.scope,
          onError: (error) => failures.push(error),
          resources: Layer.mergeAll(
            Layer.succeed(Auth, auth),
            Layer.succeed(Budgets, emptyBudgets),
            preferencesLayer(() => localStorage),
          ),
        });
        const budget = Schema.decodeUnknownSync(Budget)({
          id: "a",
          name: "Original",
          created_at: "2026-01-01T00:00:00Z",
          archived_at: null,
        });
        const state = yield* app.signal<WorkspaceView>({
          initial: { _tag: "Loaded", budgets: [budget] },
        });
        const options = {
          user: { id: "A", email: Option.none<string>() },
          page: { _tag: "Budget" as const, budgetId: BudgetId.make("a") },
        };
        const branches = workspaceBranches(options, Effect.void);
        const view = component(() =>
          Sync.succeed({ setup: () => Effect.succeed(cases({ state, branches })) }),
        );
        const partition = yield* app.signal({ initial: Option.some("A") });
        const queries = yield* Query.configure({ context: app, partition });
        const navigation = Navigation.of({
          navigate: () => Effect.void,
          dispatch: () => Effect.void,
          initial: Effect.void,
          committedLocation: () => "/budget/a",
        });
        yield* app.h(
          root,
          provideContext({
            key: Queries,
            value: queries,
            child: provideContext({ key: Navigation, value: navigation, child: view }),
          }),
        );
        yield* Effect.promise(() =>
          expect.poll(() => root.querySelector("h1")?.textContent).toBe("Original"),
        );
        const heading = root.querySelector("h1");
        const logout = Option.getOrThrow(Option.fromNullishOr(root.querySelector("button")));
        logout.focus();
        yield* state.set({ _tag: "Loaded", budgets: [{ ...budget, name: "Updated" }] });
        yield* Effect.promise(() =>
          expect.poll(() => root.querySelector("h1")?.textContent).toBe("Updated"),
        );
        expect(root.querySelector("h1")).toBe(heading);
        expect(root.querySelector("button")).toBe(logout);
        expect(document.activeElement).toBe(logout);
        expect(failures).toEqual([]);
      }),
    ),
  );
});
