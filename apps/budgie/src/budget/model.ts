import { Array as Arr, DateTime, Effect, Match, Option, Schema, SchemaGetter } from "effect";

export const BudgetId = Schema.NonEmptyString.pipe(Schema.brand("budgie/BudgetId"));
export type BudgetId = typeof BudgetId.Type;

const BudgetRow = Schema.Struct({
  id: BudgetId,
  name: Schema.String,
  created_at: Schema.String,
  archived_at: Schema.NullOr(Schema.String),
});
export const Budget = BudgetRow.pipe(
  Schema.decodeTo(
    Schema.Struct({
      ...BudgetRow.fields,
      id: Schema.toType(BudgetId),
      created_at_raw: Schema.String,
      created_at: Schema.DateTimeUtcFromString,
      archived_at_raw: Schema.NullOr(Schema.String),
      archived_at: Schema.NullOr(Schema.DateTimeUtcFromString),
    }),
    {
      decode: SchemaGetter.transform((row) => ({
        ...row,
        created_at_raw: row.created_at,
        archived_at_raw: row.archived_at,
      })),
      encode: SchemaGetter.transform((budget) => ({
        id: budget.id,
        name: budget.name,
        created_at: budget.created_at_raw,
        archived_at: budget.archived_at_raw,
      })),
    },
  ),
);
export interface Budget extends Schema.Schema.Type<typeof Budget> {}
export class InvalidBudgetName extends Schema.TaggedError<InvalidBudgetName>()(
  "InvalidBudgetName",
  { message: Schema.String },
) {}
export const validateName = Effect.fn("Budget.validateName")((input: string) => {
  const name = input.trim();
  return Match.value(Array.from(name).length).pipe(
    Match.when(0, () => Effect.fail(new InvalidBudgetName({ message: "Enter a budget name." }))),
    Match.when(
      (length) => length > 200,
      () => Effect.fail(new InvalidBudgetName({ message: "Use at most 200 characters." })),
    ),
    Match.orElse(() => Effect.succeed(name)),
  );
});
const submillisecond = (timestamp: string) =>
  Option.getOrElse(Option.fromUndefinedOr(/\.(\d+)/.exec(timestamp)?.[1]), () => "")
    .slice(3)
    .padEnd(6, "0");
export const ordered = (budgets: ReadonlyArray<Budget>): ReadonlyArray<Budget> =>
  [...budgets].sort(
    (left, right) =>
      DateTime.toEpochMillis(left.created_at) - DateTime.toEpochMillis(right.created_at) ||
      submillisecond(left.created_at_raw).localeCompare(submillisecond(right.created_at_raw)) ||
      left.id.localeCompare(right.id),
  );
export const eligible = (budgets: ReadonlyArray<Budget>) =>
  ordered(budgets).filter((budget) => budget.archived_at === null);
export const selection = (options: {
  budgets: ReadonlyArray<Budget>;
  saved: Option.Option<BudgetId>;
}) => {
  const saved = Option.flatMap(options.saved, (id) =>
    Arr.findFirst(options.budgets, (budget) => budget.id === id),
  );
  return {
    stale: Option.isSome(options.saved) && Option.isNone(saved),
    budget: Option.orElse(saved, () => Arr.head(eligible(options.budgets))),
  };
};
