import {
  type Signal,
  type WritableSignal,
  Sync,
  branch,
  cases,
  component,
} from "@charismaticalli/frappe";
import { History, navigator } from "@charismaticalli/frappe/router";
import { Effect, Option } from "effect";
import { applyAuth } from "~/auth/partition";
import { Auth } from "~/auth/service";
import { Accounts } from "~/pages/accounts";
import { authBranches } from "~/pages/auth-branches";
import { ThemeSelector } from "~/theme/selector";
import { targetOf, urls } from "./routes";
import { type AppEvent, type State, type View, transition } from "./transitions";

export const App = (partition: WritableSignal<Option.Option<string>>) =>
  component(() =>
    Sync.succeed({
      setup: (context) =>
        Effect.gen(function* () {
          const auth = yield* Auth;
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
              admit: () => navigation.dispatch({ _tag: "Auth", auth }),
            }),
          );
          const view = yield* context.derive({
            sources: { state },
            compute: ({ state }) => state.view,
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
            ...authBranches(navigation),
            Accounts: {
              key: (view: Extract<View, { _tag: "Accounts" }>) => view.user.id,
              branch: branch<
                Extract<View, { _tag: "Accounts" }>,
                Signal<Extract<View, { _tag: "Accounts" }>>
              >()(({ inputs }) =>
                Sync.succeed({
                  setup: () => inputs.state.get.pipe(Effect.map(({ user }) => Accounts(user))),
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
          const content = cases({ state: view, branches });
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
                  ThemeSelector,
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
