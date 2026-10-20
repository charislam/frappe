import { Sync, component } from "@charismaticalli/frappe";
import { Effect, Option } from "effect";
import { Auth } from "~/auth/service";
import { destination } from "~/routes";
import { emailCodeButton, githubButton } from "./auth-controls";
import { type AuthNavigation, AuthLink } from "./auth-navigation";
import { field } from "./field";
import { formActions } from "./forms";

export const Login = (navigation: AuthNavigation) =>
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
          const password = yield* field({
            context,
            label: "Password",
            type: "password",
            autocomplete: "current-password",
            name: "password",
          });
          const form = yield* context.he("form", {
            props: { noValidate: true },
            children: [
              yield* context.he("fieldset", {
                props: { disabled: actions.pending },
                children: [
                  email.label,
                  password.label,
                  yield* context.he("button", {
                    attrs: { class: Option.some("primary") },
                    props: { type: "submit" },
                    children: ["Sign in"],
                  }),
                ],
              }),
            ],
          });
          yield* actions.submit({
            form,
            fields: { email, password },
            work: (values) =>
              auth
                .execute({
                  _tag: "Password",
                  credentials: { email: values.email, password: values.password },
                })
                .pipe(Effect.as(Option.none())),
          });
          return yield* context.he("section", {
            attrs: { class: Option.some("login-page card") },
            children: [
              yield* context.he("h1", { children: ["Welcome back"] }),
              yield* context.he("p", { children: ["Sign in to your Budgie account."] }),
              form,
              yield* emailCodeButton({ context, actions, email, intent: "signin", navigation }),
              ...(yield* githubButton({ context, actions })),
              actions.errorOutput,
              actions.statusOutput,
              AuthLink({
                navigation,
                destination: destination("Signup"),
                label: "Create an account",
              }),
              AuthLink({
                navigation,
                destination: destination("ForgotPassword"),
                label: "Forgot password?",
              }),
            ],
          });
        }),
    }),
  );
