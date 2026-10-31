import { Sync, component } from "@charismaticalli/frappe";
import { Effect, Option } from "effect";
import { destination } from "~/routes";
import { emailCodeButton } from "./auth-controls";
import { type AuthNavigation, AuthLink } from "./auth-navigation";
import { field } from "./field";
import { formActions } from "./forms";

export const Login = (navigation: AuthNavigation) =>
  component(() =>
    Sync.succeed({
      setup: (context) =>
        Effect.gen(function* () {
          const actions = yield* formActions(context);
          const email = yield* field({
            context,
            label: "Email address",
            type: "email",
            autocomplete: "email",
            name: "email",
          });
          const codeButton = yield* emailCodeButton({
            context,
            actions,
            email,
            intent: "signin",
            navigation,
          });
          const form = yield* context.he("form", {
            props: { noValidate: true },
            children: [
              yield* context.he("fieldset", {
                props: { disabled: actions.pending },
                children: [email.label, codeButton],
              }),
            ],
          });
          return yield* context.he("section", {
            attrs: { class: Option.some("login-page auth-content") },
            children: [
              yield* context.he("h1", {
                attrs: { class: Option.some("page-heading") },
                children: ["Sign in"],
              }),
              form,
              actions.errorOutput,
              actions.statusOutput,
              AuthLink({
                navigation,
                destination: destination("Signup"),
                label: "Create an account",
              }),
            ],
          });
        }),
    }),
  );
