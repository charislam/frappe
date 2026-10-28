import { createClient } from "@supabase/supabase-js";
import { type DateTime, Effect, Option, Schema } from "effect";
import { expectTypeOf, it } from "vitest";
import { database, type CommandOptions, type Intent, type AggregateEdit } from "./client";
import {
  ViewerTimeZone,
  AccountId,
  AllocationId,
  BudgetId,
  EnvelopeId,
  FinancialDate,
  type BudgetMonth,
  type Envelope,
  type Budget,
  RequestId,
  TransactionId,
  type Snapshot,
} from "./model";

it("narrows envelope references by kind and gives timestamps and money their domain types", () => {
  expectTypeOf<
    Extract<Envelope, { kind: "credit_payment" }>["credit_account_id"]
  >().toEqualTypeOf<AccountId>();
  expectTypeOf<Extract<Envelope, { kind: "regular" }>["credit_account_id"]>().toEqualTypeOf<
    Option.Option<never>
  >();
  expectTypeOf<Budget["archived_at"]>().toEqualTypeOf<Option.Option<DateTime.Utc>>();
  expectTypeOf<Snapshot["ready_to_assign_minor"]>().toEqualTypeOf<number>();
  expectTypeOf<Snapshot["transactions"][number]["version"]>().toEqualTypeOf<number>();
});

it("keeps entity IDs distinct throughout decoded models and client inputs", () => {
  expectTypeOf<keyof AggregateEdit<TransactionId>>().toEqualTypeOf<"id" | "expectedVersion">();
  expectTypeOf<string>().not.toExtend<FinancialDate>();
  expectTypeOf<Snapshot["envelopes"][number]["month"]>().toEqualTypeOf<BudgetMonth>();
  expectTypeOf<Snapshot["transactions"][number]["effective_date"]>().toEqualTypeOf<FinancialDate>();
  expectTypeOf<BudgetId>().not.toExtend<TransactionId>();
  expectTypeOf<TransactionId>().not.toExtend<BudgetId>();
  expectTypeOf<AccountId>().not.toExtend<EnvelopeId>();
  expectTypeOf<RequestId>().not.toExtend<BudgetId>();
  expectTypeOf<Snapshot["transactions"][number]["id"]>().toEqualTypeOf<TransactionId>();
  expectTypeOf<Snapshot["deficits"][number]["card_id"]>().toEqualTypeOf<Option.Option<AccountId>>();
  expectTypeOf<CommandOptions<"transaction_void">["edit"]["id"]>().toEqualTypeOf<TransactionId>();
  expectTypeOf<CommandOptions<"allocation_void">["edit"]["id"]>().toEqualTypeOf<AllocationId>();
  expectTypeOf<Intent["budgetId"]>().toEqualTypeOf<BudgetId>();
  const api = database(
    createClient("https://example.supabase.co", "test", {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    }),
    { timeZone: Schema.decodeUnknownSync(ViewerTimeZone)("UTC") },
  );
  expectTypeOf<Parameters<typeof api.snapshot>[0]["month"]>().toEqualTypeOf<BudgetMonth>();
  expectTypeOf<
    Parameters<typeof api.reconciliationPreview>[0]["effectiveDate"]
  >().toEqualTypeOf<FinancialDate>();
  const id = "93585797-569d-408d-9140-78d513c8c55a";
  const intent = { budgetId: BudgetId.make(id), requestId: RequestId.make(id) };
  api.command({
    intent,
    operation: "transaction_void",
    data: {},
    edit: {
      // @ts-expect-error A budget ID cannot identify a transaction command target.
      id: intent.budgetId,
      expectedVersion: Option.none(),
    },
  });
  api.command({
    intent,
    operation: "allocation_void",
    data: {},
    edit: {
      // @ts-expect-error A transaction ID cannot identify an allocation command target.
      id: TransactionId.make(id),
      expectedVersion: Option.none(),
    },
  });
  expectTypeOf<Effect.Success<ReturnType<typeof api.saveTransaction>>["id"]>().toEqualTypeOf<
    Option.Option<TransactionId>
  >();
  expectTypeOf<Effect.Success<ReturnType<typeof api.saveAllocation>>["id"]>().toEqualTypeOf<
    Option.Option<AllocationId>
  >();
});
