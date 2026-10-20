import { Sync, component } from "@charismaticalli/frappe";
import { Effect, Option } from "effect";
import type { User } from "~/auth/model";
import { Auth } from "~/auth/service";
import { field } from "./field";
import { formActions } from "./forms";

export const Accounts = (user: User) =>
  component(() =>
    Sync.succeed({
      setup: (context) =>
        Effect.gen(function* () {
          const auth = yield* Auth;
          const address: string = Option.getOrElse(user.email, () => "Signed in");
          const actions = yield* formActions(context);
          const name = yield* field({
            context,
            label: "Account name",
            type: "text",
            autocomplete: "off",
            name: "account-name",
          });
          const form = yield* context.he("form", {
            children: [
              name.label,
              yield* context.he("button", {
                props: { type: "submit" },
                children: ["Create account"],
              }),
              yield* context.he("small", {
                children: ["Account creation is coming soon. Nothing is saved yet."],
              }),
            ],
          });
          yield* context.subscribe(
            yield* context.events(form, "submit", {
              synchronous: (event) => event.preventDefault(),
            }),
            () => Effect.void,
          );
          const logout = yield* context.he("button", {
            props: { type: "button", disabled: actions.pending },
            children: ["Log out"],
          });
          yield* context.subscribe(yield* context.events(logout, "click"), () =>
            actions.run(auth.execute({ _tag: "Logout" }).pipe(Effect.as(Option.none()))),
          );
          return yield* context.he("section", {
            attrs: { class: Option.some("accounts-page card") },
            children: [
              yield* context.he("p", {
                attrs: { class: Option.some("eyebrow") },
                children: ["YOUR MONEY, AT A GLANCE"],
              }),
              yield* context.he("h1", { children: ["Accounts"] }),
              yield* context.he("p", { children: [address] }),
              yield* context.he("div", {
                attrs: { class: Option.some("empty-state") },
                children: [
                  yield* context.he("h2", { children: ["A fresh start"] }),
                  yield* context.he("p", {
                    children: [
                      "Your accounts will live here. Start with a name for the account you have in mind.",
                    ],
                  }),
                ],
              }),
              form,
              logout,
              actions.errorOutput,
              actions.statusOutput,
            ],
          });
        }),
    }),
  );
