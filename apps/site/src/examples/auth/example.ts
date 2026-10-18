import { Sync, branch, cases, component, focus, provideContext } from "@charismaticalli/frappe";
import { Effect, Option } from "effect";
import { Auth } from "~/auth";
import type { User } from "~/auth-model";
import { CurrentUser } from "./context";
import { SignIn } from "./sign-in";
import { Workspace } from "./workspace";

type Session =
  | { readonly _tag: "Restoring" }
  | { readonly _tag: "SignedOut" }
  | { readonly _tag: "SignedIn"; readonly user: User };

const Restoring = branch<Extract<Session, { _tag: "Restoring" }>>()(({ context }) =>
  Sync.gen(function* () {
    const output = yield* context.he("p", {
      attrs: { role: Option.some("status") },
      children: ["Restoring your session…"],
    });
    return { setup: () => Effect.succeed(output) };
  }),
);

const SignedOut = branch<Extract<Session, { _tag: "SignedOut" }>>()(() =>
  Sync.succeed({ setup: () => Effect.succeed(SignIn) }),
);

const SignedIn = branch<Extract<Session, { _tag: "SignedIn" }>>()(({ context, inputs }) =>
  Sync.gen(function* () {
    const user = yield* focus({ context, source: inputs.state, key: "user" });
    return {
      setup: () =>
        Effect.succeed(provideContext({ key: CurrentUser, value: user, child: Workspace })),
    };
  }),
);

export const AuthExample = component(() =>
  Sync.succeed({
    setup: (context) =>
      Effect.gen(function* () {
        const auth = yield* Auth;

        const session = yield* context.signal<Session>({ initial: { _tag: "Restoring" } });

        yield* context.subscribeStream(auth.sessions, (user) =>
          session.set(
            Option.match(user, {
              onNone: (): Session => ({ _tag: "SignedOut" }),
              onSome: (user): Session => ({ _tag: "SignedIn", user }),
            }),
          ),
        );

        return yield* context.he("section", {
          attrs: {
            class: Option.some("card auth-example"),
            "aria-label": Option.some("Fieldnotes demo app"),
          },
          children: [
            cases({
              state: session,
              branches: {
                Restoring: { branch: Restoring },
                SignedOut: { branch: SignedOut },
                SignedIn: { branch: SignedIn, key: (session) => session.user.email },
              },
            }),
          ],
        });
      }),
  }),
);
