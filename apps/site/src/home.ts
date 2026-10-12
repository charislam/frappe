import { Sync, component } from "@charismaticalli/frappe";
import { Effect, Option } from "effect";

const benefits = [
  {
    title: "Signals-based",
    description:
      "Reactivity via signals designed to minimize work done on state changes. No virtual DOM.",
  },
  {
    title: "Fully-typed contexts",
    description:
      "Static compile-time checking that all contexts are provided. Components always nested correctly, by design.",
  },
  {
    title: "Effect v4",
    description:
      "Plugs into the Effect ecosystem with typed error channels and ergonomic finalizers for cleanup.",
  },
] as const;

const benefitsSection = component(() =>
  Sync.succeed({
    setup: ({ he }) =>
      Effect.gen(function* () {
        return yield* he("section", {
          attrs: {
            "aria-label": Option.some("Benefits"),
            class: Option.some("benefits"),
          },
          children: yield* Effect.forEach(benefits, (benefit) =>
            Effect.gen(function* () {
              return yield* he("article", {
                attrs: { class: Option.some("card") },
                children: [
                  yield* he("h2", { children: [benefit.title] }),
                  yield* he("p", { children: [benefit.description] }),
                ],
              });
            }),
          ),
        });
      }),
  }),
);

export const Home = component(() =>
  Sync.succeed({
    setup: ({ he }) =>
      Effect.gen(function* () {
        return yield* he("main", {
          attrs: { class: Option.some("home-page") },
          children: [
            yield* he("hgroup", {
              children: [
                yield* he("h1", { children: ["frappé"] }),
                yield* he("p", { children: ["Effect-based FRP for the frontend"] }),
              ],
            }),
            benefitsSection,
          ],
        });
      }),
  }),
);
