import { type Child, Sync, type SynchronousContext } from "@charismaticalli/frappe";
import { NavigationMenu } from "@charismaticalli/ui";
import { Option } from "effect";
import { AccessExample } from "./access";
import { AccountExample } from "./account";
import { Counter } from "./counter";
import { LoadingExample } from "./loading";
import { Tabs } from "./tabs";
import { TextInput } from "./text-input";
import { Todos } from "./todos";

export const examples = [
  { tag: "Counter", path: "counter", title: "Counter", content: Counter },
  { tag: "TextInput", path: "text-input", title: "Text input", content: TextInput },
  { tag: "Account", path: "account", title: "Account", content: AccountExample },
  { tag: "Tabs", path: "tabs", title: "Tabs", content: Tabs },
  { tag: "Access", path: "auth", title: "Auth", content: AccessExample },
  { tag: "Loading", path: "loading", title: "Loading", content: LoadingExample },
  { tag: "Todos", path: "todos", title: "Todos", content: Todos },
] as const;

export type Example = (typeof examples)[number];
export type ExampleTag = Example["tag"];

export const examplePage = (options: {
  readonly context: SynchronousContext;
  readonly links: ReadonlyArray<Child>;
  readonly content: Example["content"];
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
