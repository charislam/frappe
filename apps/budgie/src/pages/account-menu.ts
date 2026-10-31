import { type Signal, Sync, component } from "@charismaticalli/frappe";
import { NavigationMenu } from "@charismaticalli/ui";
import { Effect, Option } from "effect";
import type { User } from "~/auth/model";
import { LogoutControls } from "./logout-controls";

export const AccountMenu = (user: Signal<Option.Option<User>>) =>
  component(() =>
    Sync.succeed({
      setup: (context) =>
        Effect.gen(function* () {
          return yield* context.derive({
            sources: { user },
            compute: ({ user }) => Option.map(user, AuthenticatedAccountMenu),
          });
        }),
    }),
  );

const AuthenticatedAccountMenu = (user: User) =>
  component((context) =>
    Sync.gen(function* () {
      const menu = yield* NavigationMenu.make({ context, initialOpen: false });
      const address = Option.getOrElse(user.email, () => "Signed in");
      const trigger = yield* context.he("button", {
        attrs: {
          class: Option.some("app-account-menu-trigger"),
          "aria-label": Option.some("Account menu"),
        },
        props: { type: "button" },
        children: ["☰"],
      });
      const panel = yield* context.he("div", {
        attrs: {
          class: Option.some("app-account-menu-panel"),
          "aria-label": Option.some("Account menu"),
          role: Option.some("group"),
        },
        children: [
          yield* context.he("p", {
            attrs: { class: Option.some("app-account-identity") },
            children: [address],
          }),
          LogoutControls(),
        ],
      });
      yield* menu.attach({ trigger, menu: panel });
      const output = yield* context.he("div", {
        attrs: { class: Option.some("app-account-menu") },
        children: [trigger, panel],
      });
      return { setup: () => Effect.succeed(output) };
    }),
  );
