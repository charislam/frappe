import { Sync, cases, component, provideContext } from "@charismaticalli/frappe";
import { History, type HistoryAdapter, navigator } from "@charismaticalli/frappe/router";
import { Effect, Match, Option } from "effect";
import { Anonymous, Authenticated, Resolving } from "./app-views";
import { Navigation } from "./context";
import type { AppState } from "./model";
import { MockAuth } from "./resources";
import { urls } from "./routes";
import { transition } from "./transitions";

export const RoutingDemo = component(() =>
  Sync.succeed({
    setup: (context) =>
      Effect.gen(function* () {
        const transport = yield* History;
        const history: HistoryAdapter = {
          ...transport,
          identity: {},
          observe: (listener) =>
            transport.observe((location) => {
              Match.value(new URL(location, transport.origin).pathname).pipe(
                Match.when(
                  (path) => path === "/examples/routing" || path.startsWith("/examples/routing/"),
                  () => listener(location),
                ),
                Match.orElse(() => {}),
              );
            }),
        };
        const auth = yield* MockAuth;

        const state = yield* context.signal<AppState>({
          initial: {
            _tag: "ResolvingSession",
            requested: urls.parse("/examples/routing"),
            revision: 0,
          },
        });
        const error = yield* context.signal({ initial: "" });

        const navigation = yield* navigator({
          context,
          router: urls,
          state,
          history,
          transition,
          onError: () => {
            Effect.runSync(error.set("Navigation failed. Your previous page is still available."));
          },
        });
        yield* navigation.initial;

        yield* context.subscribeStream(auth.sessions, (event) =>
          navigation.dispatch({ _tag: "Auth", event }),
        );

        const noError = yield* context.derive({
          sources: { error },
          compute: ({ error }) => error.length === 0,
        });
        const recover = navigation
          .dispatch({ _tag: "Reconcile" })
          .pipe(Effect.andThen(error.set("")));

        const root = component((context) =>
          Sync.gen(function* () {
            const restore = yield* context.he("button", {
              props: { type: "button", hidden: noError },
              children: ["Restore previous page"],
            });
            yield* context.subscribe(yield* context.events(restore, "click"), () => recover);
            const output = yield* context.he("section", {
              attrs: {
                class: Option.some("routing-page"),
                "aria-label": Option.some("Typed routing demo"),
              },
              children: [
                yield* context.he("header", {
                  attrs: { class: Option.some("routing-heading") },
                  children: [yield* context.he("h1", { children: ["Waypoint"] })],
                }),
                yield* context.he("p", {
                  attrs: { class: Option.some("routing-description") },
                  children: ["A home for your team’s projects. Demo workspace with sample data."],
                }),
                yield* context.he("div", {
                  attrs: { class: Option.some("routing-content") },
                  children: [
                    yield* context.he("p", {
                      attrs: { role: Option.some("alert") },
                      children: [error],
                    }),
                    restore,
                    cases({
                      state,
                      branches: {
                        ResolvingSession: { branch: Resolving },
                        Anonymous: { branch: Anonymous },
                        Authenticated: {
                          branch: Authenticated,
                          key: (state) => state.sessionId,
                        },
                      },
                    }),
                  ],
                }),
              ],
            });
            return { setup: () => Effect.succeed(output) };
          }),
        );
        return provideContext({ key: Navigation, value: navigation, child: root });
      }),
  }),
);
