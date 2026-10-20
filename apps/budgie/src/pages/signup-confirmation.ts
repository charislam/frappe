import { Sync, component } from "@charismaticalli/frappe";
import { Effect, Option } from "effect";
import { Auth } from "~/auth/service";
import { destination } from "~/routes";
import { NonEmptyString } from "~/utils/non-empty-string";
import { type AuthNavigation, AuthLink } from "./auth-navigation";
import { field } from "./field";
import { formActions } from "./forms";

export const SignupConfirmation = (options: {
  navigation: AuthNavigation;
  email: Option.Option<string>;
}) =>
  component(() =>
    Sync.succeed({
      setup: (context) =>
        Effect.gen(function* () {
          const auth = yield* Auth;
          const actions = yield* formActions(context);
          const email = yield* field({
            context,
            label: "Email address",
            type: "email",
            autocomplete: "email",
            name: "email",
          });
          yield* email.setValue(Option.getOrElse(options.email, () => ""));
          yield* context.bind({
            element: email.input,
            props: { readOnly: Option.isSome(options.email) },
          });
          const form = yield* context.he("form", {
            props: { noValidate: true },
            children: [
              yield* context.he("fieldset", {
                props: { disabled: actions.pending },
                children: [
                  email.label,
                  yield* context.he("button", {
                    attrs: { class: Option.some("primary") },
                    props: { type: "submit" },
                    children: ["Resend confirmation email"],
                  }),
                ],
              }),
            ],
          });
          yield* actions.submit({
            form,
            fields: { email },
            work: (values) =>
              auth
                .execute({ _tag: "ResendConfirmation", email: values.email })
                .pipe(
                  Effect.as(
                    Option.some(NonEmptyString.make("Confirmation sent. Check your email.")),
                  ),
                ),
          });
          return yield* context.he("section", {
            attrs: { class: Option.some("signup-confirmation-page auth-content") },
            children: [
              yield* context.he("h1", {
                attrs: { class: Option.some("page-heading") },
                children: ["Confirm your email"],
              }),
              form,
              actions.errorOutput,
              actions.statusOutput,
              AuthLink({
                navigation: options.navigation,
                destination: destination("Login"),
                label: "Back to sign in",
              }),
              AuthLink({
                navigation: options.navigation,
                destination: destination("Signup"),
                label: "Use a different email",
              }),
            ],
          });
        }),
    }),
  );
