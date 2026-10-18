import { type ComponentContext, type ReactiveError, occurrenceId } from "@charismaticalli/frappe";
import { attach } from "@charismaticalli/frappe/validation";
import { Effect, Match, Option } from "effect";
import type { FieldDefinition } from "./fields";

export const makeField = Effect.fn("ValidationDemo.makeField")(function* (options: {
  readonly context: ComponentContext;
  readonly definition: FieldDefinition;
  readonly onEdit: Effect.Effect<void, ReactiveError>;
}) {
  const { context, definition } = options;
  const id = occurrenceId(`validation-${definition.name}`);
  const source = yield* context.signal({ initial: "" });
  const field = yield* attach({ context, source, schema: definition.schema });
  let blurred = false;
  let composing = false;
  const invalid = yield* context.derive({
    sources: { state: field.state },
    compute: ({ state }) => Option.some(String(state._tag === "Invalid")),
  });
  const errorHidden = yield* context.derive({
    sources: { state: field.state },
    compute: ({ state }) => state._tag !== "Invalid",
  });
  const message = yield* context.derive({
    sources: { state: field.state },
    compute: ({ state }) =>
      Match.value(state._tag).pipe(
        Match.when("Invalid", () => definition.error),
        Match.orElse(() => ""),
      ),
  });
  const input = yield* context.he("input", {
    attrs: {
      "data-slot": Option.some("input"),
      id: Option.some(id),
      "aria-invalid": invalid,
      "aria-describedby": Option.some(`${id}-help ${id}-error`),
      inputmode: Option.some(definition.inputmode),
      autocomplete: Option.some(definition.autocomplete),
      placeholder: Option.some(definition.placeholder),
    },
    props: { type: definition.type, required: true },
  });
  yield* context.bindValue({ element: input, signal: source });
  const validateEdit = () =>
    Match.value(blurred && !composing).pipe(
      Match.when(true, field.validate),
      Match.orElse(() => Effect.void),
    );
  yield* context.subscribe(yield* context.events(input, "compositionstart"), () =>
    Effect.sync(() => {
      composing = true;
    }),
  );
  yield* context.subscribe(yield* context.events(input, "compositionend"), () =>
    Effect.gen(function* () {
      composing = false;
      yield* validateEdit();
    }),
  );
  yield* context.subscribe(yield* context.events(input, "input"), (event) =>
    Effect.gen(function* () {
      yield* options.onEdit;
      yield* Match.value(event.isComposing).pipe(
        Match.when(true, () => Effect.void),
        Match.orElse(validateEdit),
      );
    }),
  );
  yield* context.subscribe(yield* context.events(input, "blur"), () =>
    Effect.gen(function* () {
      blurred = true;
      yield* validateEdit();
    }),
  );
  const output = yield* context.he("fieldset", {
    attrs: { "data-slot": Option.some("field") },
    children: [
      yield* context.he("label", {
        attrs: { "data-slot": Option.some("label"), for: Option.some(id) },
        children: [definition.label],
      }),
      input,
      yield* context.he("p", {
        attrs: { "data-slot": Option.some("hint"), id: Option.some(`${id}-help`) },
        children: [definition.help],
      }),
      yield* context.he("p", {
        attrs: {
          "data-slot": Option.some("error"),
          id: Option.some(`${id}-error`),
          "aria-live": Option.some("polite"),
        },
        props: { hidden: errorHidden },
        children: [message],
      }),
    ],
  });
  return {
    output,
    validate: Effect.gen(function* () {
      blurred = true;
      yield* field.validate();
      return (yield* field.state.get)._tag === "Validated";
    }),
  };
});
