import { Sync, component } from "@charismaticalli/frappe";
import { Effect, Match, Option } from "effect";
import { Auth } from "~/auth";
import { LocalStorage, storageDiagnostic } from "~/local-storage";
import { CurrentUser } from "./context";
import { Profile } from "./profile";

const tasks = [
  "Review the website brief",
  "Share the first design draft",
  "Plan next week’s priorities",
] as const;

export const Workspace = component(() =>
  Sync.succeed({
    setup: (context) =>
      Effect.gen(function* () {
        const auth = yield* Auth;
        const user = yield* CurrentUser;
        const storage = yield* LocalStorage;

        const initial = yield* user.get;

        const savedName = yield* storage
          .get(`frappe.demo.profile:${initial.email}`)
          .pipe(Effect.catch(() => storageDiagnostic().pipe(Effect.as(Option.none<string>()))));

        const name = yield* context.signal({
          initial: Option.getOrElse(savedName, () => initial.email.split("@")[0] ?? "Reader"),
        });

        const email = yield* context.derive({
          sources: { user },
          compute: ({ user }) => user.email,
        });

        const page = yield* context.signal<"Overview" | "Profile">({ initial: "Overview" });
        const completed = yield* context.signal<ReadonlySet<string>>({ initial: new Set() });

        const progress = yield* context.derive({
          sources: { completed },
          compute: ({ completed }) => `${completed.size} of ${tasks.length} completed`,
        });

        const error = yield* context.signal({ initial: "" });
        const busy = yield* context.signal({ initial: false });

        const links = [];

        for (const destination of ["Overview", "Profile"] as const) {
          const current = yield* context.derive({
            sources: { page },
            compute: ({ page }) =>
              Match.value(page === destination).pipe(
                Match.when(true, () => Option.some("page")),
                Match.orElse(() => Option.none<string>()),
              ),
          });

          const button = yield* context.he("button", {
            attrs: { "aria-current": current },
            props: { type: "button" },
            children: [destination],
          });

          yield* context.subscribe(yield* context.events(button, "click"), () =>
            page.set(destination),
          );

          links.push(button);
        }

        const signOut = yield* context.he("button", {
          props: { type: "button", disabled: busy },
          children: ["Sign out"],
        });

        yield* context.subscribe(yield* context.events(signOut, "click"), () =>
          Effect.gen(function* () {
            yield* busy.set(true);
            yield* error.set("");
            yield* auth.logout().pipe(
              Effect.catch(() => error.set("Unable to sign out. Please try again.")),
              Effect.andThen(busy.set(false)),
            );
          }),
        );

        const items = [];

        for (const task of tasks) {
          const checked = yield* context.derive({
            sources: { completed },
            compute: ({ completed }) => completed.has(task),
          });
          const checkbox = yield* context.he("input", { props: { type: "checkbox", checked } });
          yield* context.subscribe(yield* context.events(checkbox, "change"), () =>
            completed.update((current) => {
              const next = new Set(current);
              Match.value(next.has(task)).pipe(
                Match.when(true, () => next.delete(task)),
                Match.orElse(() => next.add(task)),
              );
              return next;
            }),
          );
          items.push(
            yield* context.he("li", {
              children: [yield* context.he("label", { children: [checkbox, task] })],
            }),
          );
        }

        const hideOverview = yield* context.derive({
          sources: { page },
          compute: ({ page }) => page !== "Overview",
        });

        const hideProfile = yield* context.derive({
          sources: { page },
          compute: ({ page }) => page !== "Profile",
        });

        return yield* context.he("div", {
          attrs: {
            class: Option.some("auth-workspace"),
            "aria-label": Option.some("Your workspace"),
          },
          children: [
            yield* context.he("header", {
              children: [
                yield* context.he("strong", {
                  attrs: { class: Option.some("auth-brand") },
                  children: ["Fieldnotes"],
                }),
                yield* context.he("span", { children: [email] }),
                signOut,
              ],
            }),
            yield* context.he("nav", {
              attrs: { "aria-label": Option.some("Workspace navigation") },
              children: links,
            }),
            yield* context.he("p", { attrs: { role: Option.some("alert") }, children: [error] }),
            yield* context.he("section", {
              attrs: {
                class: Option.some("auth-panel"),
                "aria-label": Option.some("Workspace overview"),
              },
              props: { hidden: hideOverview },
              children: [
                yield* context.he("h2", { children: ["Welcome back, ", name, "."] }),
                yield* context.he("p", { children: ["Here’s what’s on your list today."] }),
                yield* context.he("article", {
                  children: [
                    yield* context.he("h3", { children: ["Website launch"] }),
                    yield* context.he("p", {
                      children: ["Your personal checklist", " · ", progress],
                    }),
                    yield* context.he("ul", { children: items }),
                  ],
                }),
              ],
            }),
            yield* context.he("section", {
              attrs: {
                class: Option.some("auth-panel"),
                "aria-label": Option.some("Profile settings"),
              },
              props: { hidden: hideProfile },
              children: [Profile({ name })],
            }),
          ],
        });
      }),
  }),
);
