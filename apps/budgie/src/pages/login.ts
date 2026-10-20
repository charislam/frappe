import { Sync, component } from "@charismaticalli/frappe";
import { Effect, Option } from "effect";
import { destination } from "~/routes";
import { githubButton } from "./auth-controls";
import { type AuthNavigation, AuthLink } from "./auth-navigation";
import { loginForm } from "./login-form";

export const Login = (navigation: AuthNavigation) =>
  component(() =>
    Sync.succeed({
      setup: (context) =>
        Effect.gen(function* () {
          const { form, actions } = yield* loginForm({ context, navigation });
          return yield* context.he("section", {
            attrs: { class: Option.some("login-page auth-content") },
            children: [
              yield* context.he("h1", {
                attrs: { class: Option.some("page-heading") },
                children: ["Sign in"],
              }),
              form,
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
