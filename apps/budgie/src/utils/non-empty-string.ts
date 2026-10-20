import { Schema } from "effect";

export const NonEmptyString = Schema.NonEmptyString.pipe(Schema.brand("NonEmptyString"));
export type NonEmptyString = typeof NonEmptyString.Type;
