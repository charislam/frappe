import { type Destination, route } from "@charismaticalli/frappe/router";
import { Match } from "effect";

export const examplesRoute = route({
  tag: "Examples",
  path: ["examples"],
  children: [
    route({ tag: "Counter", path: ["counter"] }),
    route({ tag: "TextInput", path: ["text-input"] }),
    route({ tag: "Tabs", path: ["tabs"] }),
    route({ tag: "Access", path: ["auth"] }),
    route({ tag: "Loading", path: ["loading"] }),
    route({ tag: "Todos", path: ["todos"] }),
    route({ tag: "Routing", path: ["routing"] }),
    route({ tag: "Queries", path: ["queries"] }),
  ],
});

type ExampleDestination = Destination<readonly [typeof examplesRoute]>;
export type ExampleTag = Exclude<ExampleDestination["_tag"], "Examples">;
export type ExamplePage = {
  [T in ExampleTag]: { readonly _tag: T };
}[ExampleTag];
export interface ExamplesState {
  readonly _tag: "Examples";
  readonly page: ExamplePage;
}

export const examplesPageOf = (tag: ExampleDestination["_tag"]): ExamplesState => ({
  _tag: "Examples",
  page: Match.value(tag).pipe(
    Match.when("Examples", (): ExamplePage => ({ _tag: "Counter" })),
    Match.orElse((tag): ExamplePage => ({ _tag: tag })),
  ),
});
