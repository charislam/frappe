import { Schema, SchemaGetter } from "effect";

export const text = Schema.Trim.check(Schema.isMinLength(1));
export const password = Schema.String.check(Schema.isMinLength(8));
export const email = Schema.Trim.check(Schema.isPattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/));
export const natural = Schema.Trim.check(Schema.isPattern(/^[0-9]+$/)).pipe(
  Schema.decodeTo(
    Schema.Number.check(
      Schema.isInt(),
      Schema.isGreaterThanOrEqualTo(0),
      Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
    ),
    {
      decode: SchemaGetter.transform(Number),
      encode: SchemaGetter.transform(String),
    },
  ),
);
