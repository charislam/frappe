import { type ComponentContext, nativeNode } from "@charismaticalli/frappe";
import { Effect, Option } from "effect";
import { emailCodeButton } from "./auth-controls";
import type { AuthNavigation } from "./auth-navigation";
import { field } from "./field";
import type { formActions } from "./forms";

export const loginFields = Effect.fn("Login.fields")(function* (options: {
  context: ComponentContext;
  navigation: AuthNavigation;
  actions: Effect.Success<ReturnType<typeof formActions>>;
}) {
  const { context, navigation, actions } = options;
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
  const passwordMode = yield* context.signal({ initial: false });
  const emailMode = yield* context.derive({
    sources: { passwordMode },
    compute: ({ passwordMode }) => !passwordMode,
  });
  yield* context.bind({ element: password.label, props: { hidden: emailMode } });
  yield* context.bind({ element: password.input, props: { disabled: emailMode } });
  const usePassword = yield* context.he("button", {
    attrs: { class: Option.some("secondary") },
    props: { type: "button", hidden: passwordMode, disabled: actions.pending },
    children: ["Use Password"],
  });
  yield* context.subscribe(yield* context.events(usePassword, "click"), () =>
    passwordMode
      .set(true)
      .pipe(Effect.tap(() => Effect.sync(() => nativeNode(password.input).focus()))),
  );
  const codeButton = yield* emailCodeButton({
    context,
    actions,
    email,
    intent: "signin",
    navigation,
  });
  yield* context.bind({
    element: codeButton,
    attrs: { class: Option.some("primary") },
    props: { hidden: passwordMode },
  });
  const form = yield* context.he("form", {
    props: { noValidate: true },
    children: [
      yield* context.he("fieldset", {
        props: { disabled: actions.pending },
        children: [
          email.label,
          codeButton,
          usePassword,
          password.label,
          yield* context.he("button", {
            attrs: { class: Option.some("primary") },
            props: { type: "submit", hidden: emailMode },
            children: ["Sign in"],
          }),
        ],
      }),
    ],
  });
  return { email, password, passwordMode, form };
});
