import { type ComponentContext } from "@charismaticalli/frappe";
import { Effect, Match, Option } from "effect";
import { Auth } from "~/auth/service";
import { verificationDestination } from "~/routes";
import { type AuthNavigation, navigateAuth } from "./auth-navigation";
import { field } from "./field";
import { formActions } from "./forms";

type Actions = Effect.Success<ReturnType<typeof formActions>>;
export const emailCodeButton = Effect.fn("Auth.emailCodeButton")(function* (options: {
  context: ComponentContext;
  actions: Actions;
  email: Effect.Success<ReturnType<typeof field>>;
  intent: "signin" | "signup";
  navigation: AuthNavigation;
}) {
  const { context, actions, email, navigation, intent } = options;
  const auth = yield* Auth;
  const button = yield* context.he("button", {
    attrs: { class: Option.some("primary") },
    props: { type: "button", disabled: actions.pending },
    children: [
      Match.value(intent).pipe(
        Match.when("signin", () => "Email me a sign-in code"),
        Match.when("signup", () => "Sign up with an email code"),
        Match.exhaustive,
      ),
    ],
  });
  yield* context.subscribe(yield* context.events(button, "click"), () =>
    email.validate().pipe(
      Effect.flatMap((address) =>
        Option.match(address, {
          onSome: (address) =>
            actions.run(
              Effect.gen(function* () {
                yield* auth.execute({ _tag: "RequestOtp", email: address, intent });
                yield* navigateAuth({
                  mode: "push",
                  navigation,
                  destination: verificationDestination({ email: Option.some(address), intent }),
                });
                return Option.none();
              }),
            ),
          onNone: () => Effect.void,
        }),
      ),
    ),
  );
  return button;
});
