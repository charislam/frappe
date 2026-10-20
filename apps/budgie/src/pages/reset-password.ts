import { Sync, component } from "@charismaticalli/frappe";
import { Effect, Match, Option } from "effect";
import { AuthError } from "~/auth/model";
import { Auth } from "~/auth/service";
import { NonEmptyString } from "~/utils/non-empty-string";
import { field } from "./field";
import { formActions } from "./forms";

export const ResetPassword = (continueToAccounts: Effect.Effect<void, AuthError>) =>
  component(() =>
    Sync.succeed({
      setup: (context) =>
        Effect.gen(function* () {
          const auth = yield* Auth;
          const actions = yield* formActions(context);
          const complete = yield* context.signal({ initial: false });
          const password = yield* field({
            context,
            label: "New password (at least 8 characters)",
            type: "password",
            autocomplete: "new-password",
            name: "password",
          });
          const confirmation = yield* field({
            context,
            label: "Confirm new password",
            type: "password",
            autocomplete: "new-password",
            name: "confirmation",
          });
          const form = yield* context.he("form", {
            props: { noValidate: true },
            children: [
              yield* context.he("fieldset", {
                props: { disabled: actions.pending },
                children: [
                  password.label,
                  confirmation.label,
                  yield* context.he("button", {
                    attrs: { class: Option.some("primary") },
                    props: { type: "submit" },
                    children: ["Save password"],
                  }),
                ],
              }),
            ],
          });
          yield* actions.submit({
            form,
            fields: { password, confirmation },
            work: (values) =>
              Effect.gen(function* () {
                yield* Match.value(values.password === values.confirmation).pipe(
                  Match.when(true, () => Effect.void),
                  Match.orElse(() =>
                    Effect.fail(
                      new AuthError({ kind: "credentials", message: "Passwords must match." }),
                    ),
                  ),
                );
                yield* auth.execute({ _tag: "UpdatePassword", password: values.password });
                yield* complete.set(true);
                return Option.some(
                  NonEmptyString.make("Your password has been updated. You can now continue."),
                );
              }),
          });
          const continueButton = yield* context.he("button", {
            props: {
              type: "button",
              disabled: actions.pending,
              hidden: yield* context.derive({
                sources: { complete },
                compute: ({ complete }) => !complete,
              }),
            },
            children: ["Continue to accounts"],
          });
          yield* context.subscribe(yield* context.events(continueButton, "click"), () =>
            actions.run(continueToAccounts.pipe(Effect.as(Option.none()))),
          );
          return yield* context.he("section", {
            attrs: { class: Option.some("reset-page auth-content") },
            children: [
              yield* context.he("h1", {
                attrs: { class: Option.some("page-heading") },
                children: ["Choose a new password"],
              }),
              form,
              actions.errorOutput,
              actions.statusOutput,
              continueButton,
            ],
          });
        }),
    }),
  );
