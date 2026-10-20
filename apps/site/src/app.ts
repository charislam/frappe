import { Sync, branch, cases, component, provideContext } from "@charismaticalli/frappe";
import {
  type Destination,
  History,
  type ParseResult,
  link,
  navigator,
} from "@charismaticalli/frappe/router";
import { NavigationMenu } from "@charismaticalli/ui";
import { Effect, Match, Option } from "effect";
import { examplesBranch } from "~/examples/page";
import { type ExamplesState, examplesPageOf } from "~/examples/routes";
import { browserTheme } from "~/features/theme/browser";
import { Theme, makeTheme } from "~/features/theme/controller";
import { ThemeSelector } from "~/features/theme/selector";
import { Home } from "./home";
import { urls } from "./routes";

type Page = { readonly _tag: "Home" } | ExamplesState | { readonly _tag: "NotFound" };
const pageOf = (tag: Destination<typeof urls.definitions>["_tag"]): Page =>
  Match.value(tag).pipe(
    Match.when("Home", (tag): Page => ({ _tag: tag })),
    Match.orElse(examplesPageOf),
  );
const page = (target: ParseResult<typeof urls.definitions>): Page =>
  Match.value(target).pipe(
    Match.tag("Matched", ({ destination }) => pageOf(destination._tag)),
    Match.orElse(({ ancestry }) =>
      Match.value(ancestry.some((route) => route._tag === "Routing")).pipe(
        Match.when(true, (): Page => examplesPageOf("Routing")),
        Match.orElse((): Page => ({ _tag: "NotFound" })),
      ),
    ),
  );
const HomePage = branch<Extract<Page, { _tag: "Home" }>>()(() =>
  Sync.succeed({ setup: () => Effect.succeed(Home) }),
);
const NotFound = branch<Extract<Page, { _tag: "NotFound" }>>()(({ context }) =>
  Sync.gen(function* () {
    const output = yield* context.he("main", { children: ["Page not found"] });
    return { setup: () => Effect.succeed(output) };
  }),
);

export const App = component(() =>
  Sync.succeed({
    setup: (context) =>
      Effect.gen(function* () {
        const theme = yield* makeTheme({
          context,
          browser: browserTheme(window),
          startup: Option.fromUndefinedOr(window.frappeTheme),
        });
        const history = yield* History;
        const state = yield* context.signal<Page>({ initial: { _tag: "Home" } });
        const navigation = yield* navigator<typeof urls.definitions, Page, never>({
          context,
          router: urls,
          state,
          history,
          transition: ({ state, event }) =>
            Match.value(event).pipe(
              Match.tag("Navigate", ({ target, mode }) => ({
                state: pageOf(target.destination._tag),
                history: {
                  _tag: Match.value(mode).pipe(
                    Match.when("push", () => "Push" as const),
                    Match.when("replace", () => "Replace" as const),
                    Match.exhaustive,
                  ),
                  destination: target.destination,
                },
              })),
              Match.tag("Location", ({ target }) => ({
                state: page(target),
                history: { _tag: "Keep" as const },
              })),
              Match.tag("Application", () => ({ state, history: { _tag: "Keep" as const } })),
              Match.exhaustive,
            ),
          onError: (error) => console.error("App navigation failed", error),
        });
        yield* navigation.initial;
        return component((context) =>
          Sync.gen(function* () {
            const links = [];
            for (const tag of ["Home", "Examples"] as const) {
              const destination: Destination<typeof urls.definitions> = {
                _tag: tag,
                params: {},
                query: {},
                fragment: Option.none(),
              };
              const active = yield* context.derive({
                sources: { state },
                compute: ({ state }) =>
                  Match.value(state._tag === tag).pipe(
                    Match.when(true, () => Option.some("page")),
                    Match.orElse(() => Option.none<string>()),
                  ),
              });
              links.push(
                yield* link({
                  context,
                  router: urls,
                  navigator: navigation,
                  destination,
                  attrs: { "aria-current": active },
                  children: [tag],
                }),
              );
            }
            const menu = yield* NavigationMenu.make({ context, initialOpen: false });
            const menuTrigger = yield* context.he("button", {
              attrs: {
                class: Option.some("app-menu-trigger"),
                "aria-label": Option.some("Menu"),
              },
              props: { type: "button" },
              children: ["☰"],
            });
            const nav = yield* context.he("nav", {
              attrs: { "aria-label": Option.some("Main navigation") },
              children: links,
            });
            yield* menu.attach({ trigger: menuTrigger, menu: nav });
            const output = yield* context.he("div", {
              attrs: { class: Option.some("app-shell") },
              children: [
                yield* context.he("header", {
                  attrs: { class: Option.some("app-header") },
                  children: [
                    yield* context.he("span", {
                      attrs: { class: Option.some("app-header-title") },
                      children: ["frappé"],
                    }),
                    nav,
                    provideContext({ key: Theme, value: theme, child: ThemeSelector }),
                    menuTrigger,
                  ],
                }),
                cases({
                  state,
                  branches: {
                    Home: { branch: HomePage },
                    Examples: { branch: examplesBranch({ navigation }) },
                    NotFound: { branch: NotFound },
                  },
                }),
              ],
            });
            return { setup: () => Effect.succeed(output) };
          }),
        );
      }),
  }),
);
