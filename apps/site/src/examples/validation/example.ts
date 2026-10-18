import { Sync, component, nativeNode } from "@charismaticalli/frappe";
import { Effect, Match, Option } from "effect";
import { AccountHeading, WorkspaceIntro } from "./content";
import { makeField } from "./field";
import { fields } from "./fields";

export const ValidationDemo = component(() =>
  Sync.succeed({
    setup: (context) =>
      Effect.gen(function* () {
        const feedback = yield* context.signal({ initial: "" });
        const feedbackHidden = yield* context.derive({
          sources: { feedback },
          compute: ({ feedback }) => feedback.length === 0,
        });
        const controls = yield* Effect.forEach(fields, (definition) =>
          makeField({ context, definition, onEdit: feedback.set("") }),
        );
        const form = yield* context.he("form", {
          attrs: { "data-slot": Option.some("account-form") },
          props: { noValidate: true },
          children: [
            yield* context.he("h3", {
              attrs: { "data-slot": Option.some("section-title") },
              children: ["Your account"],
            }),
            yield* context.he("p", {
              attrs: { "data-slot": Option.some("description") },
              children: ["All fields are required."],
            }),
            ...controls.map((control) => control.output),
            yield* context.he("button", {
              attrs: { class: Option.some("primary"), "data-slot": Option.some("submit") },
              props: { type: "submit" },
              children: ["Continue"],
            }),
            yield* context.he("p", {
              attrs: { role: Option.some("status"), "data-slot": Option.some("feedback") },
              props: { hidden: feedbackHidden },
              children: [feedback],
            }),
          ],
        });
        yield* context.subscribe(
          yield* context.events(form, "submit", { synchronous: (event) => event.preventDefault() }),
          () =>
            Effect.gen(function* () {
              const results = yield* context.batch(
                Effect.forEach(controls, (control) => control.validate),
              );
              yield* Match.value(results.every(Boolean)).pipe(
                Match.when(true, () =>
                  feedback.set("Your details look good. You're ready for the next step."),
                ),
                Match.when(false, () =>
                  Effect.sync(() => {
                    Option.map(
                      Option.fromNullishOr(
                        nativeNode(form).querySelector<HTMLInputElement>(
                          '[data-slot="input"][aria-invalid="true"]',
                        ),
                      ),
                      (input) => input.focus(),
                    );
                  }),
                ),
                Match.exhaustive,
              );
            }),
        );
        return yield* context.he("section", {
          attrs: {
            class: Option.some("validation-page"),
            "aria-label": Option.some("Account setup"),
          },
          children: [
            AccountHeading,
            yield* context.he("div", {
              attrs: { "data-slot": Option.some("layout") },
              children: [form, WorkspaceIntro],
            }),
          ],
        });
      }),
  }),
);
