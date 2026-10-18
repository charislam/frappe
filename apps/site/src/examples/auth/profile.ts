import { Sync, type WritableSignal, component, nativeNode } from "@charismaticalli/frappe";
import { Effect, Match, Option } from "effect";
import { LocalStorage } from "~/local-storage";
import { CurrentUser } from "./context";

export const Profile = (options: { name: WritableSignal<string> }) =>
  component(() =>
    Sync.succeed({
      setup: (context) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser;

          const email = yield* context.derive({
            sources: { user },
            compute: ({ user }) => user.email,
          });

          const draft = yield* context.signal({ initial: yield* options.name.get });
          const status = yield* context.signal({ initial: "" });

          const input = yield* context.he("input", {
            attrs: {
              "aria-label": Option.some("Display name"),
              autocomplete: Option.some("nickname"),
            },
            props: { type: "text", required: true, maxLength: 60 },
          });

          yield* context.bindValue({ element: input, signal: draft });

          const form = yield* context.he("form", {
            attrs: { "aria-label": Option.some("Edit profile") },
            children: [
              yield* context.he("h3", { children: ["Your profile"] }),
              yield* context.he("p", { children: ["Choose how you appear in your workspace."] }),
              yield* context.he("label", { children: ["Display name", input] }),
              yield* context.he("p", { children: ["Signed in as ", email] }),
              yield* context.he("button", {
                attrs: { class: Option.some("primary") },
                props: { type: "submit" },
                children: ["Save changes"],
              }),
              yield* context.he("p", {
                attrs: { role: Option.some("status") },
                children: [status],
              }),
            ],
          });

          const storage = yield* LocalStorage;

          yield* context.subscribe(
            yield* context.events(form, "submit", {
              synchronous: (event) => event.preventDefault(),
            }),
            () =>
              Effect.gen(function* () {
                const name = (yield* draft.get).trim();

                yield* Match.value(name.length > 0 && nativeNode(input).checkValidity()).pipe(
                  Match.when(false, () => status.set("Enter a display name.")),
                  Match.when(true, () =>
                    Effect.gen(function* () {
                      const current = yield* user.get;

                      yield* storage
                        .set({ key: `frappe.demo.profile:${current.email}`, value: name })
                        .pipe(
                          Effect.andThen(options.name.set(name)),
                          Effect.andThen(status.set("Profile saved.")),
                          Effect.catch(() =>
                            status.set("Your changes could not be saved. Please try again."),
                          ),
                        );
                    }),
                  ),
                  Match.exhaustive,
                );
              }),
          );
          return form;
        }),
    }),
  );
