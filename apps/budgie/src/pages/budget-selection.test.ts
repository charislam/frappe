// @vitest-environment happy-dom
import { mounting, provideContext } from "@charismaticalli/frappe";
import { Effect, Schema } from "effect";
import { expect, it } from "vitest";
import { Budget, BudgetId } from "~/budget/model";
import { preferencesLayer } from "~/budget/preferences";
import { Navigation } from "~/context";
import type { Destination } from "~/routes";
import { BudgetSelection } from "./budget-selection";

it("re-resolves selection when the mounted component's budgets change", async () => {
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
          onError: (failure) => failures.push(failure),
          resources: preferencesLayer(() => localStorage),
        });
        const budgets = yield* app.signal<ReadonlyArray<Budget>>({ initial: [] });
        const visits: Destination[] = [];
        const navigation = Navigation.of({
          navigate: (destination) =>
            Effect.sync(() => {
              visits.push(destination);
            }),
          dispatch: () => Effect.void,
          initial: Effect.void,
          committedLocation: () => "/",
        });
        yield* app.h(
          root,
          provideContext({
            key: Navigation,
            value: navigation,
            child: BudgetSelection({ userId: "A", budgets }),
          }),
        );
        yield* Effect.promise(() => expect.poll(() => visits.length).toBe(1));
        expect(visits[0]?._tag).toBe("New");
        const b = Schema.decodeUnknownSync(Budget)({
          id: "b",
          name: "B",
          created_at: "2026-01-01T00:00:00Z",
          archived_at: null,
        });
        yield* budgets.set([b]);
        yield* Effect.promise(() => expect.poll(() => visits.length).toBe(2));
        expect(visits[1]).toMatchObject({ _tag: "Budget", params: { id: "b" } });
        yield* budgets.set([{ ...b, id: BudgetId.make("a") }, b]);
        yield* Effect.promise(() => expect.poll(() => visits.length).toBe(3));
        expect(visits[2]).toMatchObject({ _tag: "Budget", params: { id: "a" } });
        expect(failures).toEqual([]);
      }),
    ),
  );
});
