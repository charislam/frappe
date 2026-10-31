// @vitest-environment happy-dom
import * as Query from "@charismaticalli/frappe/query";
import { Deferred, Effect, Match, Option, Schema } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthState } from "~/auth/model";
import { BudgetError } from "~/budget/error";
import { BudgetId, Budget, eligible, validateName } from "~/budget/model";
import { selectedBudgetStorageKey as key } from "~/budget/preferences";
import { type Budgets, type BudgetListInput, type BudgetListPage } from "~/budget/service";
import { storageKey } from "~/theme/model";
import { cleanupAuthPages, harness } from "./auth-page-harness.test-helper";

const run = Effect.runPromise;
const ready = (id: string): AuthState => ({
  _tag: "Ready",
  user: Option.some({ id, email: Option.some(`${id}@example.com`) }),
});
const budget = (id: string, archived = false): Budget =>
  Schema.decodeUnknownSync(Budget)({
    id: BudgetId.make(id),
    name: `Budget ${id}`,
    created_at: "2026-01-01T00:00:00Z",
    archived_at: Match.value(archived).pipe(
      Match.when(true, () => "2026-02-01T00:00:00Z"),
      Match.orElse(() => null),
    ),
  });
const fake = (initial: ReadonlyArray<Budget>) => {
  let rows = initial;
  const created: string[] = [];
  const service: Budgets["Service"] = {
    list: Query.define({
      name: "test.budgets",
      load: (_input: BudgetListInput): Effect.Effect<BudgetListPage, BudgetError> =>
        Effect.sync(() => ({ budgets: eligible(rows), next: Option.none() })),
    }),
    get: Query.define({
      name: "test.budget",
      load: ({
        id,
      }: {
        userId: string;
        id: BudgetId;
      }): Effect.Effect<Option.Option<Budget>, BudgetError> =>
        Effect.sync(() => Option.fromUndefinedOr(rows.find((budget) => budget.id === id))),
    }),
    create: ({ id, name }) =>
      validateName(name).pipe(
        Effect.map((name) => {
          created.push(name);
          const result = { ...budget(id), name };
          rows = [...rows, result];
          return result;
        }),
      ),
  };
  return { service, created };
};
afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupAuthPages();
});
describe("budget navigation", () => {
  it.each([
    { saved: Option.none<string>(), rows: [budget("b"), budget("a")], expected: "a" },
    { saved: Option.some("b"), rows: [budget("a"), budget("b")], expected: "b" },
    { saved: Option.some("missing"), rows: [budget("a")], expected: "a" },
    { saved: Option.some("invalid/id"), rows: [budget("a")], expected: "a" },
    {
      saved: Option.some("archived"),
      rows: [budget("a"), budget("archived", true)],
      expected: "archived",
    },
  ])(
    "resolves preferences and saves successful visits: $expected",
    async ({ saved, rows, expected }) => {
      Option.map(saved, (value) => localStorage.setItem(key, value));
      const h = await harness({ initial: "/", auth: Option.some(ready("A")) }, fake(rows).service);
      await h.page(`Budget ${expected}`);
      expect(h.history.location()).toBe(`/budget/${expected}`);
      expect(localStorage.getItem(key)).toBe(expected);
    },
  );
  it("clears stale preferences and creates when only archived budgets exist", async () => {
    localStorage.setItem(key, "missing");
    const h = await harness(
      { initial: "/", auth: Option.some(ready("A")) },
      fake([budget("old", true)]).service,
    );
    await h.page("Create budget");
    expect(h.history.location()).toBe("/new");
    expect(localStorage.getItem(key)).toBeNull();
  });
  it("preserves an explicit link through sign-in and disregards the saved selection", async () => {
    localStorage.setItem(key, "a");
    const h = await harness(
      { initial: "/budget/b", auth: Option.none() },
      fake([budget("a"), budget("b")]).service,
    );
    await h.page("Sign in");
    h.input("email").value = "a@example.com";
    h.submit();
    await h.page("Check your email");
    await h.publish(ready("A"));
    await h.page("Budget b");
    expect(localStorage.getItem(key)).toBe("b");
  });
  it("does not save or redirect an unavailable explicit budget", async () => {
    localStorage.setItem(key, "a");
    const h = await harness(
      { initial: "/budget/outsider", auth: Option.some(ready("A")) },
      fake([budget("a")]).service,
    );
    await expect.poll(() => h.root.textContent).toContain("This budget is unavailable.");
    expect(h.history.location()).toBe("/budget/outsider");
    expect(localStorage.getItem(key)).toBe("a");
  });
  it("offers a labeled native select for archived budgets and immediately visits the selection", async () => {
    const h = await harness(
      { initial: "/budget/old", auth: Option.some(ready("A")) },
      fake([budget("b"), budget("old", true), budget("a")]).service,
    );
    await h.page("Budget old");
    expect(h.root.textContent).toContain("This budget is archived.");
    const select = Option.getOrThrow(
      Option.fromNullishOr(h.root.querySelector<HTMLSelectElement>(".budget-selector select")),
    );
    expect(select).not.toBeNull();
    expect(h.root.querySelector(`label[for="${select?.id}"]`)?.textContent).toBe("Budget");
    expect(Array.from(select?.options ?? []).map((option) => option.textContent)).toEqual([
      "Select a budget",
      "Budget a",
      "Budget b",
    ]);
    select.value = "b";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await h.page("Budget b");
    expect(localStorage.getItem(key)).toBe("b");
  });
  it("offers creation for a saved archived budget with no alternatives", async () => {
    localStorage.setItem(key, "old");
    const h = await harness(
      { initial: "/", auth: Option.some(ready("A")) },
      fake([budget("old", true)]).service,
    );
    await h.page("Budget old");
    await h.follow("Create budget");
    await h.page("Create budget");
    expect(h.root.querySelector(".budget-selector")).toBeNull();
  });
  it("ignores pending requests belonging to an old user", async () => {
    const deferred = Deferred.makeUnsafe<ReadonlyArray<Budget>>();
    const entered = Deferred.makeUnsafe<void>();
    const service = fake([budget("b")]).service;
    const list = Query.define({
      name: "test.user-budgets",
      load: ({ userId }: BudgetListInput): Effect.Effect<BudgetListPage, BudgetError> =>
        Match.value(userId).pipe(
          Match.when("A", () =>
            Deferred.succeed(entered, undefined).pipe(
              Effect.andThen(Deferred.await(deferred)),
              Effect.map((budgets) => ({ budgets, next: Option.none() })),
            ),
          ),
          Match.orElse(() => Effect.succeed({ budgets: [budget("b")], next: Option.none() })),
        ),
    });
    const h = await harness({ initial: "/", auth: Option.some(ready("A")) }, { ...service, list });
    await run(Deferred.await(entered));
    await h.publish(ready("B"));
    await h.page("Budget b");
    await run(Deferred.succeed(deferred, [budget("a")]));
    expect(h.history.location()).toBe("/budget/b");
    expect(localStorage.getItem(key)).toBe("b");
  });
  it("clears only private keys on logout", async () => {
    localStorage.setItem(key, "a");
    localStorage.setItem("budgie.preferences.other", "private");
    localStorage.setItem(storageKey, "dark");
    localStorage.setItem("unrelated", "keep");
    const h = await harness(
      { initial: "/budget/a", auth: Option.some(ready("A")) },
      fake([budget("a")]).service,
    );
    await h.page("Budget a");
    h.button("☰").click();
    h.button("Log out").click();
    await expect.poll(() => h.commands.length).toBe(1);
    expect(localStorage.getItem(key)).toBeNull();
    expect(localStorage.getItem("budgie.preferences.other")).toBeNull();
    expect(localStorage.getItem(storageKey)).toBe("dark");
    expect(localStorage.getItem("unrelated")).toBe("keep");
  });
  it("shows the account menu only for authenticated workspace views", async () => {
    const unauthenticated = await harness({ initial: "/login", auth: Option.none() });
    await unauthenticated.page("Sign in");
    expect(unauthenticated.root.querySelector(".app-account-menu")).toBeNull();

    const authenticated = await harness(
      { initial: "/", auth: Option.some(ready("A")) },
      fake([budget("a")]).service,
    );
    await authenticated.page("Budget a");
    const trigger = authenticated.button("☰");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(authenticated.root.querySelector(".app-account-identity")?.textContent).toBe(
      "A@example.com",
    );
    trigger.click();
    await expect.poll(() => trigger.getAttribute("aria-expanded")).toBe("true");
    await expect
      .poll(() =>
        authenticated.root.querySelector(".app-account-menu-panel")?.getAttribute("data-state"),
      )
      .toBe("open");
  });
  it("creates from /new even when budgets exist, trims, invalidates and visits the result", async () => {
    const f = fake([budget("a")]);
    const h = await harness({ initial: "/new", auth: Option.some(ready("A")) }, f.service);
    await h.page("Create budget");
    h.input("budget-name").value = "  Trip  ";
    h.submit();
    await h.page("Trip");
    expect(f.created).toEqual(["Trip"]);
    expect(h.history.location()).toBe(`/budget/${localStorage.getItem(key)}`);
  });
});
it("shows lookup failures without treating them as an empty budget list and manually retries", async () => {
  let failed = true;
  let attempts = 0;
  const f = fake([budget("a")]);
  const list = Query.define({
    name: "test.lookup-failure",
    load: (_input: BudgetListInput) =>
      Effect.suspend(() => {
        attempts += 1;
        return Match.value(failed).pipe(
          Match.when(true, () =>
            Effect.fail(
              new BudgetError({
                message: "Forbidden",
                status: Option.some(403),
              }),
            ),
          ),
          Match.orElse(() => Effect.succeed({ budgets: [budget("a")], next: Option.none() })),
        );
      }),
  });
  const h = await harness({ initial: "/", auth: Option.some(ready("A")) }, { ...f.service, list });
  await expect.poll(() => h.root.textContent).toContain("Unable to load budgets.");
  expect(h.history.location()).toBe("/");
  expect(attempts).toBe(1);
  failed = false;
  h.button("Retry").click();
  await h.page("Budget a");
  expect(attempts).toBeGreaterThanOrEqual(2);
});
it("validates creation length, disables in-flight duplicates, and surfaces failures without retrying", async () => {
  const entered = Deferred.makeUnsafe<void>();
  const completion = Deferred.makeUnsafe<Budget, BudgetError>();
  let attempts = 0;
  const f = fake([]);
  const service: Budgets["Service"] = {
    ...f.service,
    create: (input) =>
      validateName(input.name).pipe(
        Effect.andThen(
          Effect.gen(function* () {
            attempts += 1;
            yield* Deferred.succeed(entered, undefined);
            return yield* Deferred.await(completion);
          }),
        ),
      ),
  };
  const h = await harness({ initial: "/new", auth: Option.some(ready("A")) }, service);
  await h.page("Create budget");
  h.input("budget-name").value = "x".repeat(201);
  h.submit();
  await expect.poll(() => h.root.textContent).toContain("Use at most 200 characters.");
  expect(attempts).toBe(0);
  h.input("budget-name").value = "x".repeat(200);
  h.submit();
  await run(Deferred.await(entered));
  await expect.poll(() => h.button("Create").disabled).toBe(true);
  h.submit();
  await run(
    Deferred.fail(
      completion,
      new BudgetError({
        message: "Try again later.",
        status: Option.some(503),
      }),
    ),
  );
  await expect.poll(() => h.root.textContent).toContain("Try again later.");
  expect(attempts).toBe(1);
  expect(h.history.location()).toBe("/new");
  expect(localStorage.getItem(key)).toBeNull();
});

it("falls back after storage read denial and silently tolerates visit write denial", async () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("Read denied");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Write denied");
  });
  const h = await harness(
    { initial: "/", auth: Option.some(ready("A")) },
    fake([budget("b"), budget("a")]).service,
  );
  await h.page("Budget a");
  expect(h.history.location()).toBe("/budget/a");
  expect(h.failures).toEqual([]);
});
it("protects explicit budgets during auth initialization and admits restored sessions", async () => {
  const h = await harness(
    { initial: "/budget/a", auth: Option.some({ _tag: "Initializing" }) },
    fake([budget("a")]).service,
  );
  await expect.poll(() => h.root.textContent).toContain("Restoring your session");
  expect(h.root.textContent).not.toContain("Budget a");
  await h.publish(ready("A"));
  await h.page("Budget a");
  expect(h.history.location()).toBe("/budget/a");
});
it("keeps returnTo in auth URLs and restores it after a verification-page reload", async () => {
  const f = fake([budget("a"), budget("b")]);
  const first = await harness({ initial: "/budget/b", auth: Option.none() }, f.service);
  await first.page("Sign in");
  expect(first.history.location()).toBe("/login?returnTo=%2Fbudget%2Fb");
  first.input("email").value = "a@example.com";
  first.submit();
  await first.page("Check your email");
  const verificationUrl = first.history.location();
  expect(verificationUrl).toBe("/verify-code?email=a%40example.com&returnTo=%2Fbudget%2Fb");
  await cleanupAuthPages();
  const restored = await harness({ initial: verificationUrl, auth: Option.none() }, f.service);
  await restored.page("Check your email");
  await restored.follow("Back to sign in");
  await restored.page("Sign in");
  expect(restored.history.location()).toBe("/login?returnTo=%2Fbudget%2Fb");
  restored.input("email").value = "a@example.com";
  restored.submit();
  await restored.page("Check your email");
  await restored.publish(ready("A"));
  await restored.page("Budget b");
  expect(restored.history.location()).toBe("/budget/b");
});
it.each([
  "https://example.com/budget/b",
  "//example.com/budget/b",
  "/login",
  "/verify-code",
  "/missing",
])("falls back to normal selection for an invalid returnTo: %s", async (returnTo) => {
  const h = await harness(
    { initial: `/login?returnTo=${encodeURIComponent(returnTo)}`, auth: Option.some(ready("A")) },
    fake([budget("a")]).service,
  );
  await h.page("Budget a");
  expect(h.history.location()).toBe("/budget/a");
});
it("loads subsequent cursor pages only on demand and preserves options after a page failure", async () => {
  const f = fake([budget("old", true), budget("a"), budget("b")]);
  const requests: BudgetListInput[] = [];
  let failNext = true;
  const list = Query.define({
    name: "test.cursor-pages",
    load: (input: BudgetListInput): Effect.Effect<BudgetListPage, BudgetError> =>
      Effect.suspend(() => {
        requests.push(input);
        return Option.match(input.cursor, {
          onNone: () =>
            Effect.succeed({
              budgets: [budget("a")],
              next: Option.some({ id: budget("a").id, created_at_raw: budget("a").created_at_raw }),
            }),
          onSome: () =>
            Match.value(failNext).pipe(
              Match.when(true, () => {
                failNext = false;
                return Effect.fail(new BudgetError({ message: "Offline", status: Option.none() }));
              }),
              Match.orElse(() => Effect.succeed({ budgets: [budget("b")], next: Option.none() })),
            ),
        });
      }),
  });
  const h = await harness(
    { initial: "/budget/old", auth: Option.some(ready("A")) },
    { ...f.service, list },
  );
  await h.page("Budget old");
  await expect.poll(() => h.root.querySelectorAll(".budget-selector option").length).toBe(2);
  expect(requests).toHaveLength(1);
  h.button("Load more budgets").click();
  await expect.poll(() => h.root.textContent).toContain("Unable to load budgets. Please retry.");
  expect(h.root.querySelectorAll(".budget-selector option")).toHaveLength(2);
  h.button("Retry").click();
  await expect.poll(() => h.root.querySelectorAll(".budget-selector option").length).toBe(3);
  expect(requests).toHaveLength(3);
  expect(requests[1]?.cursor).toEqual(requests[2]?.cursor);
  expect(h.button("Load more budgets").hidden).toBe(true);
  const select = Option.getOrThrow(
    Option.fromNullishOr(h.root.querySelector<HTMLSelectElement>(".budget-selector select")),
  );
  select.value = "b";
  select.dispatchEvent(new Event("change", { bubbles: true }));
  await h.page("Budget b");
});
it("allows logout during creation and ignores the retired creation result", async () => {
  const entered = Deferred.makeUnsafe<void>();
  const completion = Deferred.makeUnsafe<Budget>();
  const f = fake([]);
  const h = await harness(
    { initial: "/new", auth: Option.some(ready("A")) },
    {
      ...f.service,
      create: () =>
        Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(completion))),
    },
  );
  await h.page("Create budget");
  h.input("budget-name").value = "Trip";
  h.submit();
  await run(Deferred.await(entered));
  await expect.poll(() => h.button("Create").disabled).toBe(true);
  expect(h.button("Log out").disabled).toBe(false);
  h.button("☰").click();
  h.button("Log out").click();
  await expect.poll(() => h.commands).toEqual([{ _tag: "Logout" }]);
  await h.publish({ _tag: "Ready", user: Option.none() });
  await h.page("Sign in");
  const signedOutLocation = h.history.location();
  await run(Deferred.succeed(completion, budget("late")));
  expect(h.history.location()).toBe(signedOutLocation);
  expect(localStorage.getItem(key)).toBeNull();
  expect(h.failures).toEqual([]);
});
