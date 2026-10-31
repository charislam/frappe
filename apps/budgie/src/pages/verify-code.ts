import { Sync, component, nativeNode } from "@charismaticalli/frappe";
import { Effect, Option } from "effect";
import { Auth } from "~/auth/service";
import { destination } from "~/routes";
import { NonEmptyString } from "~/utils/non-empty-string";
import { type AuthNavigation, AuthLink } from "./auth-navigation";
import { field } from "./field";
import { formActions } from "./forms";

export const VerifyCode = (options: {
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
          const code = yield* field({
            context,
            label: "Six-digit email code",
            type: "text",
            autocomplete: "one-time-code",
            name: "code",
          });
          nativeNode(code.input).inputMode = "numeric";
          nativeNode(code.input).pattern = "[0-9]{6}";
          nativeNode(code.input).maxLength = 6;
          const resend = yield* context.he("button", {
            attrs: { class: Option.some("secondary") },
            props: { type: "button", disabled: actions.pending },
            children: ["Resend code"],
          });
          yield* context.subscribe(yield* context.events(resend, "click"), () =>
            Effect.gen(function* () {
              const address = yield* email.validate();
              yield* Option.match(address, {
                onSome: (address) =>
                  actions.run(
                    auth
                      .execute({
                        _tag: "RequestOtp",
                        email: address,
                      })
                      .pipe(
                        Effect.as(
                          Option.some(
                            NonEmptyString.make("A new code has been sent. Check your email."),
                          ),
                        ),
                      ),
                  ),
                onNone: () => Effect.void,
              });
            }),
          );
          const form = yield* context.he("form", {
            props: { noValidate: true },
            children: [
              yield* context.he("fieldset", {
                props: { disabled: actions.pending },
                children: [
                  email.label,
                  code.label,
                  yield* context.he("button", {
                    attrs: { class: Option.some("primary") },
                    props: { type: "submit" },
                    children: ["Verify code"],
                  }),
                ],
              }),
            ],
          });
          yield* actions.submit({
            form,
            fields: { email, code },
            work: (values) =>
              auth
                .execute({ _tag: "VerifyOtp", email: values.email, code: values.code })
                .pipe(Effect.as(Option.none())),
          });
          return yield* context.he("section", {
            attrs: { class: Option.some("verify-code-page auth-content") },
            children: [
              yield* context.he("h1", {
                attrs: { class: Option.some("page-heading") },
                children: ["Check your email"],
              }),
              form,
              resend,
              actions.errorOutput,
              actions.statusOutput,
              AuthLink({
                navigation: options.navigation,
                destination: destination("Login"),
                label: "Back to sign in",
              }),
            ],
          });
        }),
    }),
  );
