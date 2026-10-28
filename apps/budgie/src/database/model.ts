import { DateTime, Option, Schema } from "effect";

const IntegerFromString = Schema.String.check(Schema.isPattern(/^-?(0|[1-9]\d*)$/))
  .pipe(Schema.decodeTo(Schema.NumberFromString))
  .check(Schema.isInt());
export const MinorUnits = IntegerFromString;
export const Natural = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
export const PositiveCounter = IntegerFromString.check(Schema.isGreaterThan(0));
export const CurrencyScale = Natural.check(Schema.isLessThanOrEqualTo(6));
const NonNegativeMinorUnits = MinorUnits.check(Schema.isGreaterThanOrEqualTo(0));
const NonPositiveMinorUnits = MinorUnits.check(Schema.isLessThanOrEqualTo(0));
const OptionalDateTime = Schema.OptionFromNullOr(Schema.DateTimeUtcFromString);
const Id = Schema.String.check(Schema.isUUID());
export const BudgetId = Id.pipe(Schema.brand("BudgetId"));
export type BudgetId = typeof BudgetId.Type;
export const AccountId = Id.pipe(Schema.brand("AccountId"));
export type AccountId = typeof AccountId.Type;
export const EnvelopeId = Id.pipe(Schema.brand("EnvelopeId"));
export type EnvelopeId = typeof EnvelopeId.Type;
export const EnvelopeGroupId = Id.pipe(Schema.brand("EnvelopeGroupId"));
export type EnvelopeGroupId = typeof EnvelopeGroupId.Type;
export const PayeeId = Id.pipe(Schema.brand("PayeeId"));
export type PayeeId = typeof PayeeId.Type;
export const TransactionId = Id.pipe(Schema.brand("TransactionId"));
export type TransactionId = typeof TransactionId.Type;
export const AllocationId = Id.pipe(Schema.brand("AllocationId"));
export type AllocationId = typeof AllocationId.Type;
export const UserId = Id.pipe(Schema.brand("UserId"));
export type UserId = typeof UserId.Type;
export const RequestId = Id.pipe(Schema.brand("RequestId"));
export type RequestId = typeof RequestId.Type;
export const ReorderId = Id.pipe(Schema.brand("ReorderId"));
export type ReorderId = typeof ReorderId.Type;

const OptionalText = Schema.OptionFromNullOr(Schema.String);
// A bookkeeping calendar day, not a timezone-dependent instant.
export const FinancialDate = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/),
  Schema.makeFilter((value: string) =>
    Option.exists(DateTime.make(value), (date) => DateTime.formatIsoDateUtc(date) === value),
  ),
).pipe(Schema.brand("FinancialDate"));
export type FinancialDate = typeof FinancialDate.Type;
export const BudgetMonth = FinancialDate.check(Schema.isPattern(/-01$/)).pipe(
  Schema.brand("BudgetMonth"),
);
export type BudgetMonth = typeof BudgetMonth.Type;
// Viewer context, not a persisted budget setting or a caller-selected date.
export const ViewerTimeZone = Schema.TimeZoneNamedFromString;
export type ViewerTimeZone = typeof ViewerTimeZone.Type;
const AccountKind = Schema.Literals(["cash", "credit", "investment"]);
const TransactionKind = Schema.Literals([
  "income",
  "expense",
  "refund",
  "transfer",
  "opening_balance",
  "adjustment",
  "valuation",
]);
const TransactionStatus = Schema.Literals(["scheduled", "posted", "voided"]);

export const Budget = Schema.Struct({
  id: BudgetId,
  name: Schema.String,
  currency_code: Schema.String,
  minor_unit_scale: CurrencyScale,
  archived_at: OptionalDateTime,
});
export interface Budget extends Schema.Schema.Type<typeof Budget> {}

export const Account = Schema.Struct({
  id: AccountId,
  budget_id: BudgetId,
  name: Schema.String,
  kind: AccountKind,
  sort_order: Natural,
  archived_at: OptionalDateTime,
  // Current balance across all posted activity, independent of the selected month.
  balance_minor: MinorUnits,
});
export interface Account extends Schema.Schema.Type<typeof Account> {}

const EnvelopeFields = {
  id: EnvelopeId,
  budget_id: BudgetId,
  name: Schema.String,
  group_id: Schema.OptionFromNullOr(EnvelopeGroupId),
  sort_order: Natural,
  archived_at: OptionalDateTime,
  month: BudgetMonth,
  // Previous month’s closing balance; both surpluses and shortages carry forward.
  opening_minor: MinorUnits,
  // Net assignments into this envelope during the month; withdrawals are negative.
  allocated_minor: MinorUnits,
  // Posted transaction splits plus automatic card-payment reserve adjustments.
  activity_minor: MinorUnits,
  // opening + allocated + activity; a negative result is a visible shortage.
  closing_minor: MinorUnits,
};
export const Envelope = Schema.Union([
  Schema.Struct({
    ...EnvelopeFields,
    kind: Schema.Literal("regular"),
    credit_account_id: Schema.OptionFromNullOr(Schema.Never),
  }),
  Schema.Struct({
    ...EnvelopeFields,
    kind: Schema.Literal("ready_to_assign"),
    credit_account_id: Schema.OptionFromNullOr(Schema.Never),
  }),
  Schema.Struct({
    ...EnvelopeFields,
    kind: Schema.Literal("credit_payment"),
    credit_account_id: AccountId,
  }),
]).pipe(Schema.toTaggedUnion("kind"));
export type Envelope = typeof Envelope.Type;

const AccountEntry = Schema.Struct({ account_id: AccountId, amount_minor: MinorUnits });
const EnvelopeEntry = Schema.Struct({ envelope_id: EnvelopeId, amount_minor: MinorUnits });
export const TransactionDraft = Schema.Struct({
  kind: TransactionKind,
  status: TransactionStatus,
  effective_date: FinancialDate,
  payee_id: Schema.OptionFromNullOr(PayeeId),
  memo: OptionalText,
  entries: Schema.Array(AccountEntry),
  splits: Schema.Array(EnvelopeEntry),
});
export interface TransactionDraft extends Schema.Schema.Type<typeof TransactionDraft> {}
export const Transaction = TransactionDraft.pipe(
  Schema.fieldsAssign({
    id: TransactionId,
    // Stable entry order; breaks ties between transactions on the same financial date.
    sequence: PositiveCounter,
    // Increments on aggregate edits so stale forms cannot overwrite newer changes.
    version: PositiveCounter,
  }),
);
export interface Transaction extends Schema.Schema.Type<typeof Transaction> {}

export const AllocationDraft = Schema.Struct({
  month: BudgetMonth,
  memo: OptionalText,
  entries: Schema.Array(EnvelopeEntry),
});
export interface AllocationDraft extends Schema.Schema.Type<typeof AllocationDraft> {}
export const Allocation = AllocationDraft.pipe(
  Schema.fieldsAssign({
    id: AllocationId,
    /** Stable order among allocation batches applying at the start of the same month. */
    sequence: PositiveCounter,
    /** Increments when the batch is edited or voided; used for stale-edit protection. */
    version: PositiveCounter,
    voided_at: OptionalDateTime,
  }),
);
export interface Allocation extends Schema.Schema.Type<typeof Allocation> {}

export const Snapshot = Schema.Struct({
  budget: Budget,
  /** Totals at the selected month end; accounts below include all posted activity. */
  overview: Schema.Struct({
    /** Net cash-account balances, including any negative cash balances. */
    cash_minor: MinorUnits,
    /** Net investment-account balances, including recorded valuations. */
    investment_minor: MinorUnits,
    /** Total owed on cards, shown positive; overpaid cards are excluded. */
    credit_debt_minor: NonNegativeMinorUnits,
    /** Positive card balances (overpayments); debt on other cards is not subtracted. */
    positive_credit_minor: NonNegativeMinorUnits,
    /** Sum of card-payment envelope shortages, kept negative; positive reserves do not offset them. */
    negative_payment_reserve_minor: NonPositiveMinorUnits,
    /** Sum of regular-envelope shortages, kept negative; funded envelopes do not offset them. */
    negative_spending_minor: NonPositiveMinorUnits,
    /** Debt minus positive payment reserves, floored at zero per card before summing. */
    uncovered_debt_minor: NonNegativeMinorUnits,
  }),
  accounts: Schema.Array(Account),
  groups: Schema.Array(
    Schema.Struct({
      id: EnvelopeGroupId,
      name: Schema.String,
      sort_order: Natural,
      archived_at: OptionalDateTime,
    }),
  ),
  envelopes: Schema.Array(Envelope),
  /** Selected month’s unassigned amount, less future assignments plus future releases; may be negative. */
  ready_to_assign_minor: MinorUnits,
  transactions: Schema.Array(Transaction),
  allocations: Schema.Array(Allocation),
  payees: Schema.Array(
    Schema.Struct({ id: PayeeId, name: Schema.String, archived_at: OptionalDateTime }),
  ),
  /** Outstanding deficits after the full current plan, including future allocations. */
  deficits: Schema.Array(
    Schema.Struct({
      budget_id: BudgetId,
      /** Budget-wide replay order, starting at 1; older lots receive funding first. */
      ordinal: PositiveCounter,
      transaction_id: TransactionId,
      /** Zero-based split index within the source transaction; multiple lots may share it. */
      position: Natural,
      envelope_id: EnvelopeId,
      /** None for cash deficits, including spending a positive card balance. */
      card_id: Schema.OptionFromNullOr(AccountId),
      /** Spending still unfunded in its envelope, even if the associated card debt was paid. */
      remaining_minor: NonNegativeMinorUnits,
      /** Unpaid, unreserved debt that can gain a payment reserve when this deficit is funded. */
      eligible_minor: NonNegativeMinorUnits,
      /** Unpaid debt already reserved by direct assignment to the payment envelope; avoid reserving twice. */
      direct_covered_minor: NonNegativeMinorUnits,
    }),
  ),
});
export interface Snapshot extends Schema.Schema.Type<typeof Snapshot> {}

export const CommandResult = <IdSchema extends Schema.Constraint>(id: IdSchema) =>
  Schema.Struct({
    id: Schema.OptionFromNullOr(id),
    version: Schema.OptionFromOptionalNullOr(PositiveCounter),
    /** Reconciliation’s observed balance minus its recorded balance; zero creates no transaction. */
    difference_minor: Schema.OptionFromOptionalNullOr(MinorUnits),
  });

export const Operation = Schema.Literals([
  "owner_add",
  "owner_remove",
  "budget_update",
  "account_create",
  "account_update",
  "group_create",
  "group_update",
  "envelope_create",
  "envelope_update",
  "envelope_move",
  "payee_save",
  "payee_archive",
  "reorder",
  "transaction_save",
  "transaction_post",
  "transaction_void",
  "allocation_save",
  "allocation_void",
  "reconcile",
  "rebuild",
]);
export type Operation = typeof Operation.Type;

// The command determines which entity its target/result UUID identifies.
export const CommandIds = {
  owner_add: UserId,
  owner_remove: UserId,
  budget_update: BudgetId,
  account_create: AccountId,
  account_update: AccountId,
  group_create: EnvelopeGroupId,
  group_update: EnvelopeGroupId,
  envelope_create: EnvelopeId,
  envelope_update: EnvelopeId,
  envelope_move: EnvelopeId,
  payee_save: PayeeId,
  payee_archive: PayeeId,
  reorder: ReorderId,
  transaction_save: TransactionId,
  transaction_post: TransactionId,
  transaction_void: TransactionId,
  allocation_save: AllocationId,
  allocation_void: AllocationId,
  reconcile: TransactionId,
  rebuild: BudgetId,
} satisfies Record<Operation, Schema.Constraint>;
