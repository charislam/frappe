import { DateTime, Effect, Exit, Match, Option, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { BudgetId, Budget, selection, validateName } from "./model";

const budget = (id: string, archived = false): Budget =>
  Schema.decodeUnknownSync(Budget)({
    id: BudgetId.make(id),
    name: id,
    created_at: "2026-01-01T00:00:00Z",
    archived_at: Match.value(archived).pipe(
      Match.when(true, () => "2026-02-01T00:00:00Z"),
      Match.orElse(() => null),
    ),
  });
describe("budget selection", () => {
  it("orders creation ties by ID and excludes archived fallback candidates", () => {
    expect(
      selection({ budgets: [budget("z"), budget("a", true), budget("b")], saved: Option.none() })
        .budget,
    ).toEqual(Option.some(budget("b")));
  });
  it("orders timestamps chronologically without losing Postgres microseconds", () => {
    const earlier = Schema.decodeUnknownSync(Budget)({
      id: "z",
      name: "z",
      created_at: "2026-01-01T00:00:00.000001Z",
      archived_at: null,
    });
    const later = Schema.decodeUnknownSync(Budget)({
      id: "a",
      name: "a",
      created_at: "2026-01-01T00:00:00.000002Z",
      archived_at: null,
    });
    expect(selection({ budgets: [later, earlier], saved: Option.none() }).budget).toEqual(
      Option.some(earlier),
    );
  });
  it("honors saved archived budgets", () => {
    for (const budgets of [[budget("a", true)], [budget("a", true), budget("b")]]) {
      expect(selection({ budgets, saved: Option.some(BudgetId.make("a")) })).toEqual({
        stale: false,
        budget: Option.some(budget("a", true)),
      });
    }
  });
  it("marks inaccessible preferences stale and falls back", () => {
    expect(
      selection({ budgets: [budget("b")], saved: Option.some(BudgetId.make("missing")) }),
    ).toEqual({
      stale: true,
      budget: Option.some(budget("b")),
    });
  });
  it("returns no selection when only archived budgets remain", () => {
    expect(
      Option.isNone(selection({ budgets: [budget("a", true)], saved: Option.none() }).budget),
    ).toBe(true);
  });
});
describe("budget names", () => {
  it("trims without changing casing", () => {
    expect(Effect.runSync(validateName("  My Budget  "))).toBe("My Budget");
  });
  it("counts Unicode code points", () => {
    expect(Effect.runSync(validateName("🐦".repeat(200)))).toBe("🐦".repeat(200));
    expect(Exit.isFailure(Effect.runSyncExit(validateName("🐦".repeat(201))))).toBe(true);
  });
  it("rejects whitespace-only names", () => {
    expect(Exit.isFailure(Effect.runSyncExit(validateName(" \t\n")))).toBe(true);
  });
});

describe("budget timestamps", () => {
  it("decodes DateTime values and preserves original strings when encoding", () => {
    const row = {
      id: "budget",
      name: "Budget",
      created_at: "2026-01-01T05:30:00.123456+05:30",
      archived_at: "2026-02-01T00:00:00.987654Z",
    };
    const decoded = Schema.decodeUnknownSync(Budget)(row);
    expect(decoded.created_at_raw).toBe(row.created_at);
    expect(decoded.archived_at_raw).toBe(row.archived_at);
    expect(DateTime.toEpochMillis(decoded.created_at)).toBe(Date.parse(row.created_at));
    expect(Option.map(Option.fromNullishOr(decoded.archived_at), DateTime.toEpochMillis)).toEqual(
      Option.some(Date.parse(row.archived_at)),
    );
    expect(Schema.encodeSync(Budget)(decoded)).toEqual(row);
  });
  it("keeps both archive fields null for an unarchived budget", () => {
    const decoded = budget("budget");
    expect(decoded.archived_at).toBeNull();
    expect(decoded.archived_at_raw).toBeNull();
  });
  it.each(["created_at", "archived_at"] as const)(
    "rejects invalid %s at the decoding boundary",
    (field) => {
      const row = {
        id: "budget",
        name: "Budget",
        created_at: "2026-01-01T00:00:00Z",
        archived_at: null,
        [field]: "invalid",
      };
      expect(Exit.isFailure(Effect.runSyncExit(Schema.decodeUnknownEffect(Budget)(row)))).toBe(
        true,
      );
    },
  );
});
