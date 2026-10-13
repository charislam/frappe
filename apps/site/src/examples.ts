import {
  type Child,
  Sync,
  type SynchronousContext,
  branch,
  cases,
  focus,
} from "@charismaticalli/frappe";
import { type Navigator, link } from "@charismaticalli/frappe/router";
import { NavigationMenu } from "@charismaticalli/ui";
import { Effect, Match, Option } from "effect";
import { AccessExample } from "./access";
import { AccountExample } from "./account";
import { Counter } from "./counter";
import type { ExamplePage, ExampleTag, ExamplesState } from "./examples-routes";
import { LoadingExample } from "./loading";
import { urls } from "./routes";
import { Tabs } from "./tabs";
import { TextInput } from "./text-input";
import { Todos } from "./todos";

const examples = [
  { tag: "Counter", title: "Counter", content: Counter },
  { tag: "TextInput", title: "Text input", content: TextInput },
  { tag: "Account", title: "Account", content: AccountExample },
  { tag: "Tabs", title: "Tabs", content: Tabs },
  { tag: "Access", title: "Auth", content: AccessExample },
  { tag: "Loading", title: "Loading", content: LoadingExample },
  { tag: "Todos", title: "Todos", content: Todos },
] as const;

type Example = (typeof examples)[number];

const examplePage = <R>(options: {
  readonly context: SynchronousContext;
  readonly links: ReadonlyArray<Child>;
  readonly content: Child<R>;
}) =>
  Sync.gen(function* () {
    const { context } = options;
    const menu = yield* NavigationMenu.make({ context, initialOpen: false });
    const trigger = yield* context.he("button", {
      attrs: {
        class: Option.some("examples-menu-trigger"),
        "aria-label": Option.some("Examples menu"),
      },
      props: { type: "button" },
      children: ["Examples ▾"],
    });
    const nav = yield* context.he("nav", {
      attrs: { "aria-label": Option.some("Examples navigation") },
      children: options.links,
    });
    yield* menu.attach({ trigger, menu: nav });
    return yield* context.he("main", {
      attrs: { class: Option.some("examples-page") },
      children: [
        yield* context.he("div", {
          attrs: { class: Option.some("examples-sidebar") },
          children: [trigger, nav],
        }),
        yield* context.he("div", {
          attrs: { class: Option.some("example-cards") },
          children: [options.content],
        }),
      ],
    });
  });

const exampleBranch = <T extends ExampleTag>(options: {
  readonly tag: T;
  readonly content: Example["content"];
}) =>
  branch<Extract<ExamplePage, { _tag: T }>>()(() =>
    Sync.succeed({ setup: () => Effect.succeed(options.content) }),
  );

export const examplesBranch = (options: {
  readonly navigation: Navigator<typeof urls.definitions, never>;
}) =>
  branch<ExamplesState>()(({ context, inputs }) =>
    Sync.gen(function* () {
      const page = yield* focus({ context, source: inputs.state, key: "page" });
      const links = [];
      for (const example of examples) {
        const active = yield* context.derive({
          sources: { page },
          compute: ({ page }) =>
            Match.value(page._tag === example.tag).pipe(
              Match.when(true, () => Option.some("page")),
              Match.orElse(() => Option.none<string>()),
            ),
        });
        links.push(
          yield* link({
            context,
            router: urls,
            navigator: options.navigation,
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
        content: cases({
          state: page,
          branches: {
            Counter: { branch: exampleBranch({ tag: "Counter", content: Counter }) },
            TextInput: { branch: exampleBranch({ tag: "TextInput", content: TextInput }) },
            Account: { branch: exampleBranch({ tag: "Account", content: AccountExample }) },
            Tabs: { branch: exampleBranch({ tag: "Tabs", content: Tabs }) },
            Access: { branch: exampleBranch({ tag: "Access", content: AccessExample }) },
            Loading: { branch: exampleBranch({ tag: "Loading", content: LoadingExample }) },
            Todos: { branch: exampleBranch({ tag: "Todos", content: Todos }) },
          },
        }),
      });
      return { setup: () => Effect.succeed(output) };
    }),
  );
