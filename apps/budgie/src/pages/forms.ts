import {
  type ComponentContext,
  type ReactiveError,
  type ElementOutput,
  nativeNode,
} from "@charismaticalli/frappe";
import type { NavigationError } from "@charismaticalli/frappe/router";
import { Cause, Data, Effect, Exit, Match, Option, Record } from "effect";
import type { AuthError } from "~/auth/model";
import type { DataError } from "~/data-error";
import type { NonEmptyString } from "~/utils/non-empty-string";

type FormError = AuthError | DataError | NavigationError | ReactiveError;

type FormState = Data.TaggedEnum<{
  Idle: {};
  Pending: {};
  Failed: { readonly message: string };
  Succeeded: { readonly message: Option.Option<NonEmptyString> };
}>;
const FormState = Data.taggedEnum<FormState>();

export const formActions = Effect.fn("Form.actions")(function* (context: ComponentContext) {
  const state = yield* context.signal<FormState>({ initial: FormState.Idle() });
  const pending = yield* context.derive({
    sources: { state },
    compute: ({ state }) => state._tag === "Pending",
  });
  const error = yield* context.derive({
    sources: { state },
    compute: ({ state }) =>
      Match.value(state).pipe(
        Match.tag("Failed", ({ message }) => message),
        Match.orElse(() => ""),
      ),
  });
  const status = yield* context.derive({
    sources: { state },
    compute: ({ state }) =>
      Match.value(state).pipe(
        Match.tag("Succeeded", ({ message }) => Option.getOrElse(message, () => "")),
        Match.orElse(() => ""),
      ),
  });
  const errorOutput = yield* context.he("p", {
    attrs: { class: Option.some("form-feedback"), role: Option.some("alert") },
    children: [error],
  });
  const statusOutput = yield* context.he("p", {
    attrs: {
      class: Option.some("form-feedback"),
      role: Option.some("status"),
      "aria-live": Option.some("polite"),
    },
    children: [status],
  });
  const run = <R>(work: Effect.Effect<Option.Option<NonEmptyString>, FormError, R>) =>
    Effect.gen(function* () {
      yield* Match.value(yield* pending.get).pipe(
        Match.when(true, () => Effect.void),
        Match.orElse(() =>
          Effect.gen(function* () {
            yield* state.set(FormState.Pending());
            yield* work.pipe(
              Effect.flatMap((message) => state.set(FormState.Succeeded({ message }))),
              Effect.catchTag(["AuthError", "DataError", "NavigationError"], (failure) =>
                state.set(FormState.Failed({ message: failure.message })),
              ),
              Effect.onExit((exit) =>
                Exit.match(exit, {
                  onSuccess: () => Effect.void,
                  onFailure: (cause) =>
                    Match.value(Cause.hasInterruptsOnly(cause)).pipe(
                      Match.when(true, () => Effect.void),
                      Match.orElse(() => state.set(FormState.Idle()).pipe(Effect.orDie)),
                    ),
                }),
              ),
            );
          }),
        ),
      );
    });
  const submit = <K extends string, R>(options: {
    form: ElementOutput<HTMLFormElement>;
    fields: Readonly<
      Record<K, { validate: () => Effect.Effect<Option.Option<string>, ReactiveError> }>
    >;
    work: (values: Record<K, string>) => Effect.Effect<Option.Option<NonEmptyString>, FormError, R>;
  }) =>
    Effect.gen(function* () {
      yield* context.subscribe(
        yield* context.events(options.form, "submit", {
          synchronous: (event) => event.preventDefault(),
        }),
        () =>
          Effect.gen(function* () {
            const results = yield* context.batch(
              Effect.forEach(Record.toEntries(options.fields), ([key, field]) =>
                field.validate().pipe(Effect.map(Option.map((value) => [key, value] as const))),
              ),
            );
            yield* Option.match(Option.all(results), {
              onSome: (values) =>
                run(
                  Effect.suspend(() => {
                    const fields = Record.map(options.fields, () => "");
                    for (const [key, value] of values) fields[key] = value;
                    return options.work(fields);
                  }),
                ),
              onNone: () =>
                Effect.sync(() => {
                  Option.map(
                    Option.fromNullishOr(
                      nativeNode(options.form).querySelector<HTMLInputElement>(
                        '[aria-invalid="true"]',
                      ),
                    ),
                    (input) => input.focus(),
                  );
                }),
            });
          }),
      );
    });
  return { pending, errorOutput, statusOutput, run, submit };
});
