import type { SupabaseClient } from "@supabase/supabase-js";
import { Effect, Option, Schema } from "effect";
import {
  AllocationDraft,
  AccountId,
  AllocationId,
  BudgetId,
  BudgetMonth,
  ViewerTimeZone,
  RequestId,
  EnvelopeId,
  TransactionId,
  CommandIds,
  CommandResult,
  CurrencyScale,
  PositiveCounter,
  FinancialDate,
  Snapshot,
  TransactionDraft,
  type Operation,
} from "./model";

export class DatabaseError extends Schema.TaggedError<DatabaseError>()("DatabaseError", {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {}

export interface Intent {
  readonly budgetId: BudgetId;
  // Generate once per user intent; reuse the same UUID and payload on retries.
  readonly requestId: RequestId;
}

export interface AggregateEdit<Id> {
  readonly id: Id;
  readonly expectedVersion: Option.Option<number>;
}

export type CommandOptions<Selected extends Operation = Operation> = {
  [Op in Selected]: {
    readonly intent: Intent;
    readonly operation: Op;
    readonly data: Schema.Json;
    readonly edit: AggregateEdit<(typeof CommandIds)[Op]["Type"]>;
  };
}[Selected];

// Bind the current viewer's IANA timezone once; the server supplies the clock.
export const database = (client: SupabaseClient, viewer: { readonly timeZone: ViewerTimeZone }) => {
  const rpc = Effect.fn("BudgieDatabase.rpc")(function* (options: {
    readonly name: string;
    readonly args: Record<string, unknown>;
  }) {
    const response = yield* Effect.tryPromise({
      try: () => client.rpc(options.name, options.args),
      catch: (cause) => new DatabaseError({ operation: options.name, cause }),
    });
    yield* Option.match(Option.fromNullOr(response.error), {
      onNone: () => Effect.void,
      onSome: (cause) => Effect.fail(new DatabaseError({ operation: options.name, cause })),
    });
    return response.data;
  });
  const command = Effect.fn("BudgieDatabase.command")(function* <Selected extends Operation>(
    options: CommandOptions<Selected>,
  ) {
    const expectedVersion = yield* Schema.encodeEffect(Schema.OptionFromNullOr(PositiveCounter))(
      options.edit.expectedVersion,
    );
    const payload = {
      operation: options.operation,
      time_zone: yield* Schema.encodeEffect(ViewerTimeZone)(viewer.timeZone),
      id: options.edit.id,
      expected_version: expectedVersion,
      data: options.data,
    };
    const value = yield* rpc({
      name: "budgie_command",
      args: {
        p_budget: options.intent.budgetId,
        p_request: options.intent.requestId,
        p_command: payload,
      },
    });
    return yield* Schema.decodeUnknownEffect(CommandResult(CommandIds[options.operation]))(value);
  });
  return {
    command,
    createBudget: Effect.fn("BudgieDatabase.createBudget")(function* (options: {
      readonly intent: Intent;
      readonly name: string;
      readonly currencyCode: string;
      readonly minorUnitScale: number;
    }) {
      const scale = yield* Schema.encodeEffect(CurrencyScale)(options.minorUnitScale);
      const value = yield* rpc({
        name: "budgie_create_budget",
        args: {
          p_budget: options.intent.budgetId,
          p_request: options.intent.requestId,
          p_data: {
            name: options.name,
            time_zone: yield* Schema.encodeEffect(ViewerTimeZone)(viewer.timeZone),
            currency_code: options.currencyCode,
            minor_unit_scale: scale,
          },
        },
      });
      return yield* Schema.decodeUnknownEffect(
        Schema.Struct({
          id: BudgetId,
          ready_to_assign_id: EnvelopeId,
        }),
      )(value);
    }),
    snapshot: Effect.fn("BudgieDatabase.snapshot")(function* (options: {
      readonly budgetId: BudgetId;
      readonly month: BudgetMonth;
    }) {
      const value = yield* rpc({
        name: "budgie_snapshot",
        args: {
          p_budget: options.budgetId,
          p_time_zone: yield* Schema.encodeEffect(ViewerTimeZone)(viewer.timeZone),
          p_month: yield* Schema.encodeEffect(BudgetMonth)(options.month),
        },
      });
      return yield* Schema.decodeUnknownEffect(Snapshot)(value);
    }),
    reconciliationPreview: Effect.fn("BudgieDatabase.reconciliationPreview")(function* (options: {
      readonly budgetId: BudgetId;
      readonly accountId: AccountId;
      // Compare recorded account activity through this calendar day, inclusive.
      readonly effectiveDate: FinancialDate;
    }) {
      const value = yield* rpc({
        name: "budgie_reconciliation_preview",
        args: {
          p_budget: options.budgetId,
          p_account: options.accountId,
          p_date: yield* Schema.encodeEffect(FinancialDate)(options.effectiveDate),
        },
      });
      return yield* Schema.decodeUnknownEffect(
        Schema.Struct({
          account_id: AccountId,
          effective_date: FinancialDate,
          recorded_minor: Snapshot.fields.ready_to_assign_minor,
        }),
      )(value);
    }),
    saveTransaction: Effect.fn("BudgieDatabase.saveTransaction")(function* (options: {
      readonly intent: Intent;
      readonly edit: AggregateEdit<TransactionId>;
      readonly transaction: TransactionDraft;
    }) {
      const data = yield* Schema.encodeEffect(TransactionDraft)(options.transaction);
      return yield* command({ ...options, operation: "transaction_save", data });
    }),
    saveAllocation: Effect.fn("BudgieDatabase.saveAllocation")(function* (options: {
      readonly intent: Intent;
      readonly edit: AggregateEdit<AllocationId>;
      readonly allocation: AllocationDraft;
    }) {
      const data = yield* Schema.encodeEffect(AllocationDraft)(options.allocation);
      return yield* command({ ...options, operation: "allocation_save", data });
    }),
  };
};
