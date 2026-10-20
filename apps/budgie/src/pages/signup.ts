import { Sync, component } from "@charismaticalli/frappe";
import { Effect, Match, Option } from "effect";
import { Auth } from "~/auth/service";
import { confirmationDestination, destination } from "~/routes";
import { emailCodeButton, githubButton } from "./auth-controls";
import { type AuthNavigation, AuthLink, navigateAuth } from "./auth-navigation";
import { field } from "./field";
import { formActions } from "./forms";

export const Signup = (navigation: AuthNavigation) =>
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
            label: "Password (at least 8 characters)",
            type: "password",
            autocomplete: "new-password",
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
                    children: ["Create account"],
                  }),
                ],
              }),
            ],
          });
          yield* actions.submit({
            form,
            fields: { email, password },
            work: (values) =>
              Effect.gen(function* () {
                const address = values.email;
                const result = yield* auth.execute({
                  _tag: "Signup",
                  credentials: { email: address, password: values.password },
                });
                yield* Match.value(result.confirmationPending).pipe(
                  Match.when(true, () =>
                    navigateAuth({
                      mode: "push",
                      navigation,
                      destination: confirmationDestination(Option.some(address)),
                    }),
                  ),
                  Match.orElse(() => Effect.void),
                );
                return Option.none();
              }),
          });
          return yield* context.he("section", {
            attrs: { class: Option.some("signup-page auth-content") },
            children: [
              yield* context.he("h1", {
                attrs: { class: Option.some("page-heading") },
                children: ["Create your account"],
              }),
              form,
              yield* emailCodeButton({ context, actions, email, intent: "signup", navigation }),
              ...(yield* githubButton({ context, actions })),
              actions.errorOutput,
              actions.statusOutput,
              AuthLink({
                navigation,
                destination: destination("Login"),
                label: "Already have an account? Sign in",
              }),
            ],
          });
        }),
    }),
  );
