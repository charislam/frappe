import { DateTime, Effect, Option, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  Account,
  Allocation,
  AllocationDraft,
  Budget,
  Envelope,
  FinancialDate,
  BudgetMonth,
  ViewerTimeZone,
  CurrencyScale,
  Natural,
  PositiveCounter,
  Snapshot,
  AccountId,
  BudgetId,
  EnvelopeId,
  TransactionId,
  CommandResult,
  MinorUnits,
  TransactionDraft,
} from "./model";

const accountId = "93585797-569d-408d-9140-78d513c8c55a";
const envelopeId = "70dae963-ec72-4f0a-b5ef-e7233bed1a5a";

describe("database boundary", () => {
  it("brands UUIDs without changing their RPC representation", () => {
    const id = Schema.decodeUnknownSync(BudgetId)(accountId);
    expect(Schema.encodeSync(BudgetId)(id)).toBe(accountId);
    expect(() => Schema.decodeUnknownSync(BudgetId)("not-a-uuid")).toThrow();
    expect(Schema.decodeUnknownSync(CommandResult(TransactionId))({ id: accountId }).id).toEqual(
      Option.some(TransactionId.make(accountId)),
    );
  });

  it("accepts signed safe integer amounts and rejects values that could round", () => {
    expect(Schema.decodeUnknownSync(MinorUnits)("9007199254740991")).toBe(Number.MAX_SAFE_INTEGER);
    expect(Schema.decodeUnknownSync(MinorUnits)("-9007199254740991")).toBe(Number.MIN_SAFE_INTEGER);
    for (const invalid of [
      "9007199254740992",
      "-9007199254740992",
      "1.5",
      "9007199254740991.1",
      "NaN",
      "Infinity",
      "1e3",
      42,
    ]) {
      expect(() => Schema.decodeUnknownSync(MinorUnits)(invalid)).toThrow();
    }
  });

  it("keeps currency scale, ordering, positions, and counters in their own ranges", () => {
    expect(Schema.decodeUnknownSync(CurrencyScale)(0)).toBe(0);
    expect(Schema.decodeUnknownSync(CurrencyScale)(6)).toBe(6);
    for (const value of [-1, 7, 1.5])
      expect(() => Schema.decodeUnknownSync(CurrencyScale)(value)).toThrow();
    const naturals = [
      Natural,
      Account.fields.sort_order,
      Envelope.cases.regular.fields.sort_order,
      Snapshot.fields.groups.value.fields.sort_order,
      Snapshot.fields.deficits.value.fields.position,
    ];
    for (const schema of naturals) {
      expect(Schema.decodeUnknownSync(schema)(0)).toBe(0);
      for (const value of [-1, 0.5])
        expect(() => Schema.decodeUnknownSync(schema)(value)).toThrow();
    }
    for (const schema of [
      PositiveCounter,
      Allocation.fields.sequence,
      Allocation.fields.version,
      Snapshot.fields.transactions.value.fields.sequence,
      Snapshot.fields.transactions.value.fields.version,
      Snapshot.fields.deficits.value.fields.ordinal,
    ]) {
      expect(Schema.decodeUnknownSync(schema)("1")).toBe(1);
      for (const value of ["0", "-1", "1.5", "9007199254740992"])
        expect(() => Schema.decodeUnknownSync(schema)(value)).toThrow();
    }
    expect(() =>
      Schema.decodeUnknownSync(CommandResult(TransactionId))({ id: null, version: "0" }),
    ).toThrow();
  });

  it("decodes every nullable timestamp into UTC DateTime and preserves null as None", () => {
    for (const schema of [
      Budget.fields.archived_at,
      Account.fields.archived_at,
      Envelope.cases.regular.fields.archived_at,
      Allocation.fields.voided_at,
      Snapshot.fields.groups.value.fields.archived_at,
      Snapshot.fields.payees.value.fields.archived_at,
    ]) {
      const value = Schema.decodeUnknownSync(schema)("2026-10-23T12:30:00+02:00");
      expect(DateTime.formatIso(Option.getOrThrow(value))).toBe("2026-10-23T10:30:00.000Z");
      expect(Schema.encodeSync(schema)(value)).toBe("2026-10-23T10:30:00.000Z");
      expect(Schema.decodeUnknownSync(schema)(null)).toEqual(Option.none());
      expect(() => Schema.decodeUnknownSync(schema)("not a timestamp")).toThrow();
    }
  });

  it("validates real calendar dates without turning date-only values into timestamps", () => {
    expect(Schema.decodeUnknownSync(FinancialDate)("2024-02-29")).toBe("2024-02-29");
    for (const value of [
      "2026-02-29",
      "2026-02-30",
      "2026-13-01",
      "2026-1-01",
      "2026-10-23T00:00:00Z",
    ]) {
      expect(() => Schema.decodeUnknownSync(FinancialDate)(value)).toThrow();
    }
  });

  it("represents viewer timezone context as a validated named zone", () => {
    const zone = Schema.decodeUnknownSync(ViewerTimeZone)("Australia/Brisbane");
    expect(Schema.encodeSync(ViewerTimeZone)(zone)).toBe("Australia/Brisbane");
    expect(() => Schema.decodeUnknownSync(ViewerTimeZone)("Mars/Olympus")).toThrow();
  });

  it("represents budget months as first-of-month calendar dates", () => {
    const month = Schema.decodeUnknownSync(BudgetMonth)("2026-10-01");
    expect(Schema.encodeSync(BudgetMonth)(month)).toBe("2026-10-01");
    expect(() => Schema.decodeUnknownSync(BudgetMonth)("2026-10-02")).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(AllocationDraft)({ month: "2026-10-02", memo: null, entries: [] }),
    ).toThrow();
  });

  it("requires a credit account precisely for credit-payment envelopes", () => {
    const fields = {
      id: envelopeId,
      budget_id: accountId,
      name: "Food",
      group_id: null,
      sort_order: 0,
      archived_at: null,
      month: "2026-10-01",
      opening_minor: "0",
      allocated_minor: "0",
      activity_minor: "-50",
      closing_minor: "-50",
    };
    for (const kind of ["regular", "ready_to_assign"]) {
      const envelope = Schema.decodeUnknownSync(Envelope)({
        ...fields,
        kind,
        credit_account_id: null,
      });
      expect(envelope.credit_account_id).toEqual(Option.none());
      expect(() =>
        Schema.decodeUnknownSync(Envelope)({ ...fields, kind, credit_account_id: accountId }),
      ).toThrow();
    }
    const payment = Schema.decodeUnknownSync(Envelope)({
      ...fields,
      kind: "credit_payment",
      credit_account_id: accountId,
    });
    expect(payment.credit_account_id).toBe(accountId);
    expect(() =>
      Schema.decodeUnknownSync(Envelope)({
        ...fields,
        kind: "credit_payment",
        credit_account_id: null,
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(Envelope)({ ...fields, kind: "credit_payment" }),
    ).toThrow();
    expect(Schema.encodeSync(Envelope)(payment).credit_account_id).toBe(accountId);
  });

  it("constrains deficit amounts and signed overview components consistently", () => {
    const deficits = Snapshot.fields.deficits.value.fields;
    for (const schema of [
      deficits.remaining_minor,
      deficits.eligible_minor,
      deficits.direct_covered_minor,
      Snapshot.fields.overview.fields.credit_debt_minor,
      Snapshot.fields.overview.fields.positive_credit_minor,
      Snapshot.fields.overview.fields.uncovered_debt_minor,
    ]) {
      expect(Schema.decodeUnknownSync(schema)("0")).toBe(0);
      expect(() => Schema.decodeUnknownSync(schema)("-1")).toThrow();
    }
    for (const schema of [
      Snapshot.fields.overview.fields.negative_payment_reserve_minor,
      Snapshot.fields.overview.fields.negative_spending_minor,
    ]) {
      expect(Schema.decodeUnknownSync(schema)("-1")).toBe(-1);
      expect(() => Schema.decodeUnknownSync(schema)("1")).toThrow();
    }
  });

  it("encodes domain Options and integer amounts into RPC data", async () => {
    const data: TransactionDraft = {
      kind: "expense",
      status: "posted",
      effective_date: FinancialDate.make("2026-10-21"),
      payee_id: Option.none(),
      memo: Option.some("Manually entered"),
      entries: [{ account_id: AccountId.make(accountId), amount_minor: -9007199254740991 }],
      splits: [{ envelope_id: EnvelopeId.make(envelopeId), amount_minor: -9007199254740991 }],
    };
    const encoded = await Effect.runPromise(Schema.encodeEffect(TransactionDraft)(data));
    expect(encoded.payee_id).toBeNull();
    expect(encoded.memo).toBe("Manually entered");
    expect(encoded.entries[0]?.amount_minor).toBe("-9007199254740991");
    expect(JSON.stringify(encoded)).toContain('"-9007199254740991"');
    expect(await Effect.runPromise(Schema.decodeUnknownEffect(TransactionDraft)(encoded))).toEqual(
      data,
    );
  });

  it("decodes absent versions and zero-difference reconciliation into Option", () => {
    const result = Schema.decodeUnknownSync(CommandResult(TransactionId))({
      id: null,
      difference_minor: "0",
    });
    expect(Option.isNone(result.id)).toBe(true);
    expect(Option.isNone(result.version)).toBe(true);
    expect(result.difference_minor).toEqual(Option.some(0));
  });
});
