import { type ComponentContext, nativeNode, occurrenceId } from "@charismaticalli/frappe";
import { attach } from "@charismaticalli/frappe/validation";
import { Effect, Match, Option, Schema } from "effect";

const definition = (options: { type: "email" | "password" | "text"; name: string }) =>
  Match.value(options.type).pipe(
    Match.when("email", () => ({
      schema: Schema.Trim.check(Schema.isPattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)),
      message: "Enter a valid email address.",
    })),
    Match.when("password", () => ({
      schema: Schema.String.check(Schema.isMinLength(8)),
      message: "Use at least 8 characters for your password.",
    })),
    Match.when("text", () =>
      Match.value(options.name).pipe(
        Match.when("code", () => ({
          schema: Schema.String.check(Schema.isPattern(/^[0-9]{6}$/)),
          message: "Enter a six-digit email code.",
        })),
        Match.orElse(() => ({
          schema: Schema.Trim.check(Schema.isMinLength(1)),
          message: "Enter a value.",
        })),
      ),
    ),
    Match.exhaustive,
  );
export const field = Effect.fn("Form.field")(function* (options: {
  context: ComponentContext;
  label: string;
  type: "email" | "password" | "text";
  autocomplete: string;
  name: string;
}) {
  const { context } = options;
  const { schema, message } = definition(options);
  const source = yield* context.signal({ initial: "" });
  const validation = yield* attach({ context, source, schema });
  const id = occurrenceId(`budgie-${options.name}`);
  const invalid = yield* context.derive({
    sources: { state: validation.state },
    compute: ({ state }) => state._tag === "Invalid",
  });
  const ariaInvalid = yield* context.derive({
    sources: { invalid },
    compute: ({ invalid }) => Option.some(String(invalid)),
  });
  const feedback = yield* context.derive({
    sources: { invalid },
    compute: ({ invalid }) =>
      Match.value(invalid).pipe(
        Match.when(true, () => message),
        Match.orElse(() => ""),
      ),
  });
  const input = yield* context.he("input", {
    props: { type: options.type, required: true, name: options.name },
    attrs: {
      autocomplete: Option.some(options.autocomplete),
      "aria-invalid": ariaInvalid,
      "aria-describedby": Option.some(id),
    },
  });
  yield* context.bindValue({ element: input, signal: source });
  let touched = false;
  const validate = Effect.fn("Form.validateField")(function* () {
    touched = true;
    yield* source.set(nativeNode(input).value);
    yield* validation.validate();
    return Match.value(yield* validation.state.get).pipe(
      Match.tag("Validated", ({ value }) => Option.some(value)),
      Match.orElse(() => Option.none<string>()),
    );
  });
  yield* context.subscribe(yield* context.events(input, "blur"), validate);
  yield* context.subscribe(yield* context.events(input, "input"), (event) =>
    Match.value(touched && !event.isComposing).pipe(
      Match.when(true, validate),
      Match.orElse(() => Effect.void),
    ),
  );
  yield* context.subscribe(yield* context.events(input, "compositionend"), () =>
    Match.value(touched).pipe(
      Match.when(true, validate),
      Match.orElse(() => Effect.void),
    ),
  );
  const error = yield* context.he("small", {
    attrs: { id: Option.some(id), "aria-live": Option.some("polite") },
    children: [feedback],
  });
  const label = yield* context.he("label", { children: [options.label, input, error] });
  return { input, label, validate, setValue: source.set };
});
