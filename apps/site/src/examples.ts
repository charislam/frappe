import { component } from "@charismaticalli/frappe";
import { Sync } from "@charismaticalli/frappe";
import { Effect, Option } from "effect";
import { AccessExample } from "./access";
import { AccountExample } from "./account";
import { Counter } from "./counter";
import { LoadingExample } from "./loading";
import { Tabs } from "./tabs";
import { TextInput } from "./text-input";
import { Todos } from "./todos";

export const Examples = component(() =>
  Sync.succeed({
    setup: ({ he }) =>
      Effect.gen(function* () {
        return yield* he("main", {
          attrs: { class: Option.some("examples-page") },
          children: [
            yield* he("hgroup", {
              children: [
                yield* he("h1", { children: ["Examples"] }),
                yield* he("p", {
                  children: [
                    "Small, interactive examples of reactive state and scoped components.",
                  ],
                }),
              ],
            }),
            yield* he("div", {
              attrs: { class: Option.some("example-cards") },
              children: [
                Counter,
                TextInput,
                AccountExample,
                Tabs,
                AccessExample,
                LoadingExample,
                Todos,
              ],
            }),
          ],
        });
      }),
  }),
);
