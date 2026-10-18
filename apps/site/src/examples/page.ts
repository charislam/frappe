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
import { sourceLoaders } from "virtual:example-sources";
import { ExampleSources } from "~/features/code-viewer/source";
import { urls } from "~/routes";
import { examples } from "./registry";
import type { ExamplePage, ExampleTag, ExamplesState } from "./routes";

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

const exampleBranch = <T extends ExampleTag>(tag: T) =>
  branch<Extract<ExamplePage, { _tag: T }>>()(({ context }) =>
    Sync.gen(function* () {
      const output = yield* Option.match(
        Option.fromUndefinedOr(examples.find((example) => example.tag === tag)),
        {
          onNone: () =>
            context.he("section", {
              attrs: { role: Option.some("alert") },
              children: ["This example is unavailable."],
            }),
          onSome: (example) =>
            context.he("div", {
              attrs: { class: Option.some("example-detail") },
              children: [example.content, ExampleSources(sourceLoaders[tag])],
            }),
        },
      );
      return { setup: () => Effect.succeed(output) };
    }),
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
            Counter: { branch: exampleBranch("Counter") },
            TextInput: { branch: exampleBranch("TextInput") },
            Validation: { branch: exampleBranch("Validation") },
            Tabs: { branch: exampleBranch("Tabs") },
            Access: { branch: exampleBranch("Access") },
            Loading: { branch: exampleBranch("Loading") },
            Routing: { branch: exampleBranch("Routing") },
            Queries: { branch: exampleBranch("Queries") },
            Todos: { branch: exampleBranch("Todos") },
          },
        }),
      });
      return { setup: () => Effect.succeed(output) };
    }),
  );
