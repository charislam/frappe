import { type ComponentContext } from "@charismaticalli/frappe";
import { Effect, Match, Option } from "effect";
import { Auth } from "~/auth/service";
import { verificationDestination } from "~/routes";
import { NonEmptyString } from "~/utils/non-empty-string";
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
export const githubButton = Effect.fn("Auth.githubButton")(function* (options: {
  context: ComponentContext;
  actions: Actions;
}) {
  const { context, actions } = options;
  const auth = yield* Auth;
  const available = yield* context.signal<Option.Option<boolean>>({ initial: Option.none() });
  yield* context.fork(
    auth.githubAvailable.pipe(
      Effect.flatMap((value) => available.set(Option.some(value))),
      Effect.catch(() => available.set(Option.some(false))),
    ),
  );
  const disabled = yield* context.derive({
    sources: { available, pending: actions.pending },
    compute: ({ available, pending }) => pending || !Option.contains(available, true),
  });
  const hint = yield* context.derive({
    sources: { available },
    compute: ({ available }) =>
      Option.match(available, {
        onNone: () => "Checking GitHub availability…",
        onSome: (value) =>
          Match.value(value).pipe(
            Match.when(true, () => "Sign in with your GitHub account."),
            Match.orElse(() => "GitHub is unavailable. Use email to continue."),
          ),
      }),
  });
  const button = yield* context.he("button", {
    props: { type: "button", disabled },
    children: ["Continue with GitHub"],
  });
  yield* context.subscribe(yield* context.events(button, "click"), () =>
    actions.run(
      auth
        .execute({ _tag: "Github" })
        .pipe(Effect.as(Option.some(NonEmptyString.make("Opening GitHub…")))),
    ),
  );
  return [button, yield* context.he("small", { children: [hint] })];
});
