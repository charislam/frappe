import { AuthExample } from "~/examples/auth/example";
import { Counter } from "~/examples/counter/example";
import { LoadingExample } from "~/examples/loading/example";
import { QueryExample } from "~/examples/queries/example";
import { RoutingDemo } from "~/examples/routing/example";
import { Tabs } from "~/examples/tabs/example";
import { TextInput } from "~/examples/text-input/example";
import { Todos } from "~/examples/todos/example";

export const examples = [
  { tag: "Counter", title: "Counter", content: Counter },
  { tag: "TextInput", title: "Text input", content: TextInput },
  { tag: "Tabs", title: "Tabs", content: Tabs },
  { tag: "Access", title: "Auth", content: AuthExample },
  { tag: "Loading", title: "Loading", content: LoadingExample },
  { tag: "Todos", title: "Todos", content: Todos },
  { tag: "Routing", title: "Routing", content: RoutingDemo },
  { tag: "Queries", title: "Queries", content: QueryExample },
] as const;

export type Example = (typeof examples)[number];
