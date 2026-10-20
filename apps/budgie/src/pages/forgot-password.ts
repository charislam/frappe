import { Sync, component } from "@charismaticalli/frappe";
import { Effect, Option } from "effect";
import { Auth } from "~/auth/service";
import { destination } from "~/routes";
import { NonEmptyString } from "~/utils/non-empty-string";
import { type AuthNavigation, AuthLink } from "./auth-navigation";
import { field } from "./field";
import { formActions } from "./forms";

export const ForgotPassword = (navigation: AuthNavigation) =>
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
                    children: ["Send reset link"],
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
                .execute({ _tag: "RequestRecovery", email: values.email })
                .pipe(
                  Effect.as(
                    Option.some(
                      NonEmptyString.make(
                        "If an account exists for this email, a reset link has been sent. Check your email.",
                      ),
                    ),
                  ),
                ),
          });
          return yield* context.he("section", {
            attrs: { class: Option.some("forgot-password-page card") },
            children: [
              yield* context.he("h1", { children: ["Forgot your password?"] }),
              yield* context.he("p", {
                children: ["We’ll email you a link to choose a new password."],
              }),
              form,
              actions.errorOutput,
              actions.statusOutput,
              AuthLink({ navigation, destination: destination("Login"), label: "Back to sign in" }),
            ],
          });
        }),
    }),
  );
