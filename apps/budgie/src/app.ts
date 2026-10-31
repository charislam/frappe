import {
  type Signal,
  type WritableSignal,
  Sync,
  branch,
  cases,
  component,
  provideContext,
} from "@charismaticalli/frappe";
import { History, navigator } from "@charismaticalli/frappe/router";
import { Effect, Match, Option } from "effect";
import { identity, type User } from "~/auth/model";
import { applyAuth } from "~/auth/partition";
import { Auth } from "~/auth/service";
import { Preferences } from "~/budget/preferences";
import { Navigation } from "~/context";
import { AccountMenu } from "~/pages/account-menu";
import { authBranches } from "~/pages/auth-branches";
import { Workspace } from "~/pages/workspace";
import { ThemeSelector } from "~/theme/selector";
import { targetOf, urls } from "./routes";
import { type AppEvent, type State, type View, transition } from "./transitions";

export const App = (partition: WritableSignal<Option.Option<string>>) =>
  component(() =>
    Sync.succeed({
      setup: (context) =>
        Effect.gen(function* () {
          const auth = yield* Auth;
          const preferences = yield* Preferences;
          const history = yield* History;
          const state = yield* context.signal<State>({
            initial: {
              auth: { _tag: "Initializing" },
              target: targetOf("Home"),
              view: { _tag: "Loading" },
            },
          });
          const navigation = yield* navigator<typeof urls.definitions, State, AppEvent>({
            context,
            history,
            router: urls,
            state,
            transition,
            onError: (e) => console.error("Budgie navigation failed", e),
          });
          yield* navigation.initial;
          yield* context.subscribeStream(auth.states, (auth) =>
            applyAuth({
              state: auth,
              partition,
              admit: () =>
                preferences
                  .identify(identity(auth))
                  .pipe(Effect.andThen(navigation.dispatch({ _tag: "Auth", auth }))),
            }),
          );
          const view = yield* context.derive({
            sources: { state },
            compute: ({ state }) => state.view,
          });
          const headerUser = yield* context.derive({
            sources: { state },
            compute: ({ state }): Option.Option<User> =>
              Match.value(state.auth).pipe(
                Match.tag("Ready", ({ user }) => user),
                Match.orElse(() => Option.none()),
              ),
          });
          const branches = {
            Loading: {
              branch: branch<
                Extract<View, { _tag: "Loading" }>,
                Signal<Extract<View, { _tag: "Loading" }>>
              >()(() =>
                Sync.succeed({
                  setup: (context) =>
                    context.he("p", {
                      attrs: { role: Option.some("status") },
                      children: ["Restoring your session…"],
                    }),
                }),
              ),
            },
            ...authBranches(),
            Workspace: {
              key: (view: Extract<View, { _tag: "Workspace" }>) =>
                `${view.user.id}:${Match.value(view.page).pipe(
                  Match.tag("Home", "New", ({ _tag }) => _tag),
                  Match.tag("Budget", ({ budgetId }) => `Budget:${budgetId}`),
                  Match.exhaustive,
                )}`,
              branch: branch<
                Extract<View, { _tag: "Workspace" }>,
                Signal<Extract<View, { _tag: "Workspace" }>>
              >()(({ inputs }) =>
                Sync.succeed({
                  setup: () => inputs.state.get.pipe(Effect.map((view) => Workspace(view))),
                }),
              ),
            },
            Failed: {
              branch: branch<
                Extract<View, { _tag: "Failed" }>,
                Signal<Extract<View, { _tag: "Failed" }>>
              >()(({ inputs }) =>
                Sync.succeed({
                  setup: (context) =>
                    Effect.gen(function* () {
                      const current = yield* inputs.state.get;
                      const retry = yield* context.he("button", {
                        attrs: { class: Option.some("primary") },
                        props: { type: "button" },
                        children: ["Retry"],
                      });
                      yield* context.subscribe(yield* context.events(retry, "click"), () =>
                        auth.retry(),
                      );
                      return yield* context.he("section", {
                        attrs: { class: Option.some("auth-content") },
                        children: [
                          yield* context.he("h1", {
                            attrs: { class: Option.some("page-heading") },
                            children: ["Unable to sign in"],
                          }),
                          yield* context.he("p", {
                            attrs: { role: Option.some("alert") },
                            children: [current.message],
                          }),
                          retry,
                          yield* context.he("a", {
                            attrs: { href: Option.some("/login"), class: Option.some("auth-link") },
                            children: ["Return to sign in"],
                          }),
                        ],
                      });
                    }),
                }),
              ),
            },
            NotFound: {
              branch: branch<
                Extract<View, { _tag: "NotFound" }>,
                Signal<Extract<View, { _tag: "NotFound" }>>
              >()(({ inputs }) =>
                Sync.succeed({
                  setup: (context) =>
                    Effect.gen(function* () {
                      const current = yield* inputs.state.get;
                      return yield* context.he("section", {
                        attrs: { class: Option.some("not-found-page") },
                        children: [
                          yield* context.he("h1", { children: ["Page not found"] }),
                          yield* context.he("a", {
                            attrs: { href: Option.some(current.home) },
                            children: ["Go home"],
                          }),
                        ],
                      });
                    }),
                }),
              ),
            },
          };
          const routedContent = component(() =>
            Sync.succeed({
              setup: () => Effect.succeed(cases({ state: view, branches })),
            }),
          );
          const content = provideContext({
            key: Navigation,
            value: navigation,
            child: routedContent,
          });
          return yield* context.he("div", {
            attrs: { class: Option.some("app-shell") },
            children: [
              yield* context.he("header", {
                attrs: { class: Option.some("app-header") },
                children: [
                  yield* context.he("a", {
                    attrs: { href: Option.some("/"), class: Option.some("app-brand") },
                    children: ["◒ budgie"],
                  }),
                  yield* context.he("div", {
                    attrs: { class: Option.some("app-header-actions") },
                    children: [ThemeSelector, AccountMenu(headerUser)],
                  }),
                ],
              }),
              yield* context.he("main", {
                attrs: { class: Option.some("app-main") },
                children: [content],
              }),
            ],
          });
        }),
    }),
  );
