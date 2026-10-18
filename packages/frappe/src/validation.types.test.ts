import { Context, Effect, Schema, SchemaGetter } from "effect";
import { expectTypeOf, it } from "vitest";
import type { ReactiveContext } from "~/reactive/context";
import type { ReactiveError } from "~/reactive/runtime";
import type { WritableSignal } from "~/reactive/signal";
import { type ValidationState, attach, isValidated, match } from "./validation";

const proof = (context: ReactiveContext, source: WritableSignal<string>) => {
  const schema = Schema.FiniteFromString.pipe(Schema.brand("Count"));
  const handle = attach({ context, source, schema });
  handle.pipe(
    Effect.map((field) => {
      expectTypeOf(field.state.get).toEqualTypeOf<
        Effect.Effect<ValidationState<string, typeof schema.Type>, ReactiveError>
      >();
      // @ts-expect-error validation state is read-only
      field.state.set({ _tag: "NotValidated", input: "" });
    }),
  );
  // @ts-expect-error encoded numeric input is incompatible with string source
  attach({ context, source, schema: Schema.Number });
  // @ts-expect-error reset requires a writable source
  attach({ context, source: { get: source.get }, schema: Schema.String });
  class Required extends Context.Service<Required, { readonly value: string }>()("Required") {}
  const services = Schema.String.pipe(
    Schema.decodeTo(Schema.String, {
      decode: SchemaGetter.transformEffect(() => Required.pipe(Effect.map((s) => s.value))),
      encode: SchemaGetter.transform((s: string) => s),
    }),
  );
  // @ts-expect-error required decoder services are unsupported
  attach({ context, source, schema: services });
  const state: ValidationState<string, typeof schema.Type> = {
    _tag: "Validated",
    input: "1",
    value: schema.make(1),
  };
  expectTypeOf(isValidated(state)).toBeBoolean();
  match(state, {
    NotValidated: ({ input }) => input,
    Invalid: ({ issue }) => issue._tag,
    Validated: ({ value }) => {
      expectTypeOf(value).toEqualTypeOf<typeof schema.Type>();
      return value;
    },
  });
  // @ts-expect-error all handlers are required
  match(state, { Validated: () => "value" });
};
it("typechecks the validation surface", () => {
  expectTypeOf(proof).toBeFunction();
});
