import { createClient } from "@supabase/supabase-js";
import { Effect, Option, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { database, DatabaseError } from "./client";
import {
  ViewerTimeZone,
  BudgetMonth,
  AccountId,
  FinancialDate,
  BudgetId,
  EnvelopeId,
  RequestId,
  TransactionId,
} from "./model";

const id = "93585797-569d-408d-9140-78d513c8c55a";
const viewer = { timeZone: Schema.decodeUnknownSync(ViewerTimeZone)("Australia/Brisbane") };
const request = "70dae963-ec72-4f0a-b5ef-e7233bed1a5a";

describe("financial RPC adapter", () => {
  it("sends one request per execution and preserves identity on an explicit retry", async () => {
    const bodies: string[] = [];
    const client = createClient("https://example.supabase.co", "publishable-test-key", {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: {
        fetch: async (_input, init) => {
          bodies.push(String(init?.body));
          return new Response(JSON.stringify({ id, version: "42" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        },
      },
    });
    const api = database(client, viewer);
    const save = api.saveTransaction({
      intent: { budgetId: BudgetId.make(id), requestId: RequestId.make(request) },
      edit: {
        id: TransactionId.make(id),
        expectedVersion: Option.some(41),
      },
      transaction: {
        kind: "expense",
        status: "posted",
        effective_date: FinancialDate.make("2026-10-21"),
        payee_id: Option.none(),
        memo: Option.none(),
        entries: [{ account_id: AccountId.make(id), amount_minor: -9007199254740991 }],
        splits: [{ envelope_id: EnvelopeId.make(request), amount_minor: -9007199254740991 }],
      },
    });
    expect((await Effect.runPromise(save)).version).toEqual(Option.some(42));
    expect(bodies).toHaveLength(1);
    await Effect.runPromise(save);
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toBe(bodies[1]);
    expect(bodies[0]).toContain('"expected_version":"41"');
    expect(bodies[0]).toContain('"amount_minor":"-9007199254740991"');
    expect(bodies[0]).toContain(`"p_request":"${request}"`);
    expect(bodies[0]).toContain('"time_zone":"Australia/Brisbane"');
  });

  it("sends date-only RPC values and decodes reconciliation dates with their domain type", async () => {
    const bodies: string[] = [];
    const client = createClient("https://example.supabase.co", "publishable-test-key", {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: {
        fetch: async (_input, init) => {
          bodies.push(String(init?.body));
          return new Response(
            JSON.stringify({ account_id: id, effective_date: "2026-10-23", recorded_minor: "50" }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        },
      },
    });
    const day = FinancialDate.make("2026-10-23");
    const preview = await Effect.runPromise(
      database(client, viewer).reconciliationPreview({
        budgetId: BudgetId.make(id),
        accountId: AccountId.make(id),
        effectiveDate: day,
      }),
    );
    expect(preview.effective_date).toBe(day);
    expect(preview.recorded_minor).toBe(50);
    expect(bodies[0]).toContain('"p_date":"2026-10-23"');
  });

  it("retains database conflicts as typed failures", async () => {
    const client = createClient("https://example.supabase.co", "publishable-test-key", {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: {
        fetch: async () =>
          new Response(JSON.stringify({ code: "40001", message: "Stale transaction version" }), {
            status: 409,
            headers: { "Content-Type": "application/json" },
          }),
      },
    });
    const result = await Effect.runPromise(
      database(client, viewer)
        .command({
          intent: { budgetId: BudgetId.make(id), requestId: RequestId.make(request) },
          operation: "transaction_void",
          data: {},
          edit: {
            id: TransactionId.make(id),
            expectedVersion: Option.some(1),
          },
        })
        .pipe(Effect.flip),
    );
    expect(result).toBeInstanceOf(DatabaseError);
    expect(result).toMatchObject({
      cause: { code: "40001", message: "Stale transaction version" },
    });
  });
});
