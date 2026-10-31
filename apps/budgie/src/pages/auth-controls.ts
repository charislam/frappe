import { type ComponentContext } from "@charismaticalli/frappe";
import { Effect, Option } from "effect";
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
  navigation: AuthNavigation;
}) {
  const { context, actions, email, navigation } = options;
  const auth = yield* Auth;
  const button = yield* context.he("button", {
    attrs: { class: Option.some("primary") },
    props: { type: "button", disabled: actions.pending },
    children: ["Email me a code"],
  });
  yield* context.subscribe(yield* context.events(button, "click"), () =>
    email.validate().pipe(
      Effect.flatMap((address) =>
        Option.match(address, {
          onSome: (address) =>
            actions.run(
              Effect.gen(function* () {
                yield* auth.execute({ _tag: "RequestOtp", email: address });
                yield* navigateAuth({
                  mode: "push",
                  navigation,
                  destination: verificationDestination(Option.some(address)),
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
