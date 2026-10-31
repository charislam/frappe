import { Sync, component } from "@charismaticalli/frappe";
import { Effect, Option } from "effect";
import { Auth } from "~/auth/service";
import { Preferences } from "~/budget/preferences";
import { formActions } from "./forms";

export const LogoutControls = () =>
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
              auth
                .execute({ _tag: "Logout" })
                .pipe(Effect.andThen(preferences.clear), Effect.as(Option.none())),
            ),
          );
          return yield* context.he("div", {
            attrs: { class: Option.some("app-account-menu-controls") },
            children: [logout, actions.errorOutput, actions.statusOutput],
          });
        }),
    }),
  );
