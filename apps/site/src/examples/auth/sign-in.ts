import { Sync, component, nativeNode } from "@charismaticalli/frappe";
import { Effect, Match, Option } from "effect";
import { Auth } from "~/auth";
import { LocalStorage, storageDiagnostic } from "~/local-storage";

export const SignIn = component(() =>
  Sync.succeed({
    setup: (context) =>
      Effect.gen(function* () {
        const auth = yield* Auth;
        const storage = yield* LocalStorage;

        const remembered = yield* storage
          .get("frappe.demo.profile")
          .pipe(Effect.catch(() => storageDiagnostic().pipe(Effect.as(Option.none<string>()))));

        const email = yield* context.signal({
          initial: Option.getOrElse(remembered, () => "reader@example.com"),
        });

        const busy = yield* context.signal({ initial: false });
        const error = yield* context.signal({ initial: "" });

        const label = yield* context.derive({
          sources: { busy },
          compute: ({ busy }) =>
            Match.value(busy).pipe(
              Match.when(true, () => "Signing in…"),
              Match.orElse(() => "Sign in"),
            ),
        });

        const input = yield* context.he("input", {
          attrs: { "aria-label": Option.some("Email address"), autocomplete: Option.some("email") },
          props: { type: "email", required: true, disabled: busy },
        });
        yield* context.bindValue({ element: input, signal: email });

        const form = yield* context.he("form", {
          attrs: { class: Option.some("auth-sign-in"), "aria-label": Option.some("Sign in") },
          children: [
            yield* context.he("p", {
              attrs: { class: Option.some("auth-brand") },
              children: ["Fieldnotes"],
            }),
            yield* context.he("h2", { children: ["Your work, all in one place."] }),
            yield* context.he("p", {
              children: ["Sign in to see your workspace and manage your profile."],
            }),
            yield* context.he("label", { children: ["Email address", input] }),
            yield* context.he("button", {
              attrs: { class: Option.some("primary") },
              props: { type: "submit", disabled: busy },
              children: [label],
            }),
            yield* context.he("p", { attrs: { role: Option.some("alert") }, children: [error] }),
            yield* context.he("small", {
              children: ["Demo workspace: use any email address. No password is required."],
            }),
          ],
        });

        const submit = Effect.fn("AuthExample.signIn")(function* () {
          yield* Match.value({
            busy: yield* busy.get,
            valid: nativeNode(input).checkValidity(),
          }).pipe(
            Match.when({ busy: true }, () => Effect.void),
            Match.when({ valid: false }, () => error.set("Enter a valid email address.")),
            Match.orElse(() =>
              Effect.gen(function* () {
                yield* busy.set(true);
                yield* error.set("");

                const address = (yield* email.get).trim();
                yield* auth.signIn({ email: address }).pipe(
                  Effect.tap(() =>
                    storage
                      .set({ key: "frappe.demo.profile", value: address })
                      .pipe(Effect.catch(storageDiagnostic)),
                  ),
                  Effect.catch((failure) => error.set(`Unable to sign in. ${failure.message}`)),
                  Effect.andThen(busy.set(false)),
                );
              }),
            ),
          );
        });

        yield* context.subscribe(
          yield* context.events(form, "submit", { synchronous: (event) => event.preventDefault() }),
          submit,
        );

        return form;
      }),
  }),
);
