import { Schema } from "effect";

export class BudgetError extends Schema.TaggedError<BudgetError>()("BudgetError", {
  message: Schema.String,
  status: Schema.Option(Schema.Number),
}) {}
