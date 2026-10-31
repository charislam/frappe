import { Sync, component } from "@charismaticalli/frappe";
import { Effect, Option } from "effect";
import { type AuthNavigation } from "./auth-navigation";
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
              yield* context.he("p", {
                children: [
                  "Enter your email to sign in. New here? We’ll create your account automatically.",
                ],
              }),
              form,
              actions.errorOutput,
              actions.statusOutput,
            ],
          });
        }),
    }),
  );
