import { Data, SchemaIssue } from "effect";

export type ValidationState<Input, Value> = Data.TaggedEnum<{
  NotValidated: { readonly input: Input };
  Validated: { readonly input: Input; readonly value: Value };
  Invalid: { readonly input: Input; readonly issue: SchemaIssue.Issue };
}>;

interface Definition extends Data.TaggedEnum.WithGenerics<2> {
  readonly taggedEnum: ValidationState<this["A"], this["B"]>;
}
export const ValidationState = Data.taggedEnum<Definition>();
export const isNotValidated = ValidationState.$is("NotValidated");
export const isValidated = ValidationState.$is("Validated");
export const isInvalid = ValidationState.$is("Invalid");
export const match = ValidationState.$match;

/** Structured display messages. Input reporting is disabled by the decoder. */
export const formatIssues = SchemaIssue.makeFormatterStandardSchemaV1();
