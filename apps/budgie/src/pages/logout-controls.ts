import { Sync, component } from "@charismaticalli/frappe";
import { Effect, Option } from "effect";
import { Auth } from "~/auth/service";
import { Preferences } from "~/budget/preferences";
import { formActions } from "./forms";

export const LogoutControls = (userId: string) =>
  component(() =>
    Sync.succeed({
      setup: (context) =>
        Effect.gen(function* () {
          const auth = yield* Auth;
          const preferences = yield* Preferences;
          const actions = yield* formActions(context);
          const logout = yield* context.he("button", {
            props: { type: "button", disabled: actions.pending },
            children: ["Log out"],
          });
          yield* context.subscribe(yield* context.events(logout, "click"), () =>
            actions.run(
              preferences.clear.pipe(
                Effect.andThen(auth.execute({ _tag: "Logout" })),
                Effect.tapError(() => preferences.identify(Option.some(userId))),
                Effect.as(Option.none()),
              ),
            ),
          );
          return yield* context.he("div", {
            children: [logout, actions.errorOutput, actions.statusOutput],
          });
        }),
    }),
  );
