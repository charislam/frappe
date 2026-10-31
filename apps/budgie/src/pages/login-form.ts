import type { ComponentContext } from "@charismaticalli/frappe";
import { Effect, Option } from "effect";
import { Auth } from "~/auth/service";
import { verificationDestination } from "~/routes";
import { type AuthNavigation, navigateAuth } from "./auth-navigation";
import { field } from "./field";
import { formActions } from "./forms";

export const loginForm = Effect.fn("Login.form")(function* (options: {
  context: ComponentContext;
  navigation: AuthNavigation;
}) {
  const { context, navigation } = options;
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
            children: ["Email me a sign-in code"],
          }),
        ],
      }),
    ],
  });
  yield* actions.submit({
    form,
    fields: { email },
    work: (values) =>
      Effect.gen(function* () {
        yield* auth.execute({ _tag: "RequestOtp", email: values.email });
        yield* navigateAuth({
          mode: "push",
          navigation,
          destination: verificationDestination({ email: Option.some(values.email) }),
        });
        return Option.none();
      }),
  });
  return { form, actions };
});
