import { Schema } from "effect";

export class DataError extends Schema.TaggedError<DataError>()("DataError", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}
