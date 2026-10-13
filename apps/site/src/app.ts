import { Sync, branch, cases, component } from "@charismaticalli/frappe";
import {
  type Destination,
  History,
  type ParseResult,
  link,
  navigator,
  route,
  router,
} from "@charismaticalli/frappe/router";
import { NavigationMenu } from "@charismaticalli/ui";
import { Effect, Match, Option } from "effect";
import { RoutingDemo } from "~/routing-demo/app";
import { AccessExample } from "./access";
import { AccountExample } from "./account";
import { Counter } from "./counter";
import { type Example, type ExampleTag, examplePage, examples } from "./examples";
import { Home } from "./home";
import { LoadingExample } from "./loading";
import { QueryExample } from "./query-demo";
import { Tabs } from "./tabs";
import { TextInput } from "./text-input";
import { Todos } from "./todos";

const urls = router([
  route({ tag: "Home", path: [] }),
  route({ tag: "Counter", path: ["examples", "counter"] }),
  route({ tag: "TextInput", path: ["examples", "text-input"] }),
  route({ tag: "Account", path: ["examples", "account"] }),
  route({ tag: "Tabs", path: ["examples", "tabs"] }),
  route({ tag: "Access", path: ["examples", "auth"] }),
  route({ tag: "Loading", path: ["examples", "loading"] }),
  route({ tag: "Todos", path: ["examples", "todos"] }),
  route({ tag: "Examples", path: ["examples"] }),
  route({ tag: "Routing", path: ["routing"] }),
  route({ tag: "Queries", path: ["queries"] }),
]);
type Page =
  | { readonly _tag: "Home" }
  | { readonly _tag: ExampleTag }
  | { readonly _tag: "Routing" }
  | { readonly _tag: "Queries" }
  | { readonly _tag: "NotFound" };
const pageOf = (tag: Destination<typeof urls.definitions>["_tag"]): Page =>
  Match.value(tag).pipe(
    Match.when("Examples", (): Page => ({ _tag: "Counter" })),
    Match.orElse((tag): Page => ({ _tag: tag })),
  );
const page = (target: ParseResult<typeof urls.definitions>): Page =>
  Match.value(target).pipe(
    Match.tag("Matched", ({ destination }) => pageOf(destination._tag)),
    Match.orElse(({ ancestry }) =>
      Match.value(ancestry.some((route) => route._tag === "Routing")).pipe(
        Match.when(true, (): Page => ({ _tag: "Routing" })),
        Match.orElse((): Page => ({ _tag: "NotFound" })),
      ),
    ),
  );
const isCurrent = (tag: string, state: Page) =>
  Match.value(tag).pipe(
    Match.when("Examples", () => examples.some((example) => example.tag === state._tag)),
    Match.orElse(() => state._tag === tag),
  );
const HomePage = branch<Extract<Page, { _tag: "Home" }>>()(() =>
  Sync.succeed({ setup: () => Effect.succeed(Home) }),
);
const RoutingPage = branch<Extract<Page, { _tag: "Routing" }>>()(() =>
  Sync.succeed({ setup: () => Effect.succeed(RoutingDemo) }),
);
const QueriesPage = branch<Extract<Page, { _tag: "Queries" }>>()(() =>
  Sync.succeed({ setup: () => Effect.succeed(QueryExample) }),
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
        const history = yield* History;
        const state = yield* context.signal<Page>({ initial: { _tag: "Home" } });
        const navigation = yield* navigator<typeof urls.definitions, Page, never>({
          context,
          router: urls,
          state,
          history,
          transition: ({ state, event }) =>
            Match.value(event).pipe(
              Match.tag("Navigate", ({ destination, mode }) => ({
                state: pageOf(destination._tag),
                history: {
                  _tag: Match.value(mode).pipe(
                    Match.when("push", () => "Push" as const),
                    Match.when("replace", () => "Replace" as const),
                    Match.exhaustive,
                  ),
                  destination,
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
            for (const tag of ["Home", "Examples", "Routing", "Queries"] as const) {
              const destination: Destination<typeof urls.definitions> = {
                _tag: tag,
                params: {},
                query: {},
                fragment: Option.none(),
              };
              const active = yield* context.derive({
                sources: { state },
                compute: ({ state }) =>
                  Match.value(isCurrent(tag, state)).pipe(
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
            const exampleBranch = <T extends ExampleTag>(options: {
              readonly tag: T;
              readonly content: Example["content"];
            }) =>
              branch<Extract<Page, { _tag: T }>>()(({ context }) =>
                Sync.gen(function* () {
                  const links = [];
                  for (const example of examples) {
                    const active = yield* context.derive({
                      sources: { state },
                      compute: ({ state }) =>
                        Match.value(state._tag === example.tag).pipe(
                          Match.when(true, () => Option.some("page")),
                          Match.orElse(() => Option.none<string>()),
                        ),
                    });
                    links.push(
                      yield* link({
                        context,
                        router: urls,
                        navigator: navigation,
                        destination: {
                          _tag: example.tag,
                          params: {},
                          query: {},
                          fragment: Option.none(),
                        },
                        attrs: { "aria-current": active },
                        children: [example.title],
                      }),
                    );
                  }
                  const output = yield* examplePage({
                    context,
                    links,
                    content: options.content,
                  });
                  return { setup: () => Effect.succeed(output) };
                }),
              );
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
                    menuTrigger,
                    nav,
                  ],
                }),
                cases({
                  state,
                  branches: {
                    Home: { branch: HomePage },
                    Counter: { branch: exampleBranch({ tag: "Counter", content: Counter }) },
                    TextInput: { branch: exampleBranch({ tag: "TextInput", content: TextInput }) },
                    Account: { branch: exampleBranch({ tag: "Account", content: AccountExample }) },
                    Tabs: { branch: exampleBranch({ tag: "Tabs", content: Tabs }) },
                    Access: { branch: exampleBranch({ tag: "Access", content: AccessExample }) },
                    Loading: { branch: exampleBranch({ tag: "Loading", content: LoadingExample }) },
                    Todos: { branch: exampleBranch({ tag: "Todos", content: Todos }) },
                    Routing: { branch: RoutingPage },
                    Queries: { branch: QueriesPage },
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
