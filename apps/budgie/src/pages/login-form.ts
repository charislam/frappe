import type { ComponentContext } from "@charismaticalli/frappe";
import { Effect, Match, Option } from "effect";
import { Auth } from "~/auth/service";
import { verificationDestination } from "~/routes";
import { type AuthNavigation, navigateAuth } from "./auth-navigation";
import { formActions } from "./forms";
import { loginFields } from "./login-fields";

export const loginForm = Effect.fn("Login.form")(function* (options: {
  context: ComponentContext;
  navigation: AuthNavigation;
}) {
  const { context, navigation } = options;
  const auth = yield* Auth;
  const actions = yield* formActions(context);
  const { email, password, passwordMode, form } = yield* loginFields({
    context,
    navigation,
    actions,
  });
  yield* actions.submit({
    form,
    fields: {
      email,
      password: {
        validate: () =>
          passwordMode.get.pipe(
            Effect.flatMap((mode) =>
              Match.value(mode).pipe(
                Match.when(true, () => password.validate()),
                Match.when(false, () => Effect.succeed(Option.some(""))),
                Match.exhaustive,
              ),
            ),
          ),
      },
    },
    work: (values) =>
      passwordMode.get.pipe(
        Effect.flatMap((mode) =>
          Match.value(mode).pipe(
            Match.when(true, () =>
              auth
                .execute({
                  _tag: "Password",
                  credentials: { email: values.email, password: values.password },
                })
                .pipe(Effect.as(Option.none())),
            ),
            Match.when(false, () =>
              Effect.gen(function* () {
                yield* auth.execute({
                  _tag: "RequestOtp",
                  email: values.email,
                  intent: "signin",
                });
                yield* navigateAuth({
                  mode: "push",
                  navigation,
                  destination: verificationDestination({
                    email: Option.some(values.email),
                    intent: "signin",
                  }),
                });
                return Option.none();
              }),
            ),
            Match.exhaustive,
          ),
        ),
      ),
  });
  return { form, actions };
});
