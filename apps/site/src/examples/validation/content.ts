import { Sync, component } from "@charismaticalli/frappe";
import { Effect, Option } from "effect";

export const AccountHeading = component(() =>
  Sync.succeed({
    setup: ({ he }) =>
      Effect.gen(function* () {
        return yield* he("header", {
          attrs: { "data-slot": Option.some("heading") },
          children: [
            yield* he("p", {
              attrs: { "data-slot": Option.some("eyebrow") },
              children: ["WORKSPACE / GETTING STARTED"],
            }),
            yield* he("h2", {
              attrs: { "data-slot": Option.some("title") },
              children: ["Set up your account"],
            }),
            yield* he("p", {
              attrs: { "data-slot": Option.some("description") },
              children: ["Your next project starts here. Let’s get your workspace ready."],
            }),
          ],
        });
      }),
  }),
);

export const WorkspaceIntro = component(() =>
  Sync.succeed({
    setup: ({ he }) =>
      Effect.gen(function* () {
        return yield* he("aside", {
          attrs: { "data-slot": Option.some("intro") },
          children: [
            yield* he("p", {
              attrs: { "data-slot": Option.some("eyebrow") },
              children: ["A LITTLE SPACE TO DO GREAT WORK"],
            }),
            yield* he("h3", {
              attrs: { "data-slot": Option.some("section-title") },
              children: ["Good things start with a team."],
            }),
            yield* he("p", {
              attrs: { "data-slot": Option.some("description") },
              children: [
                "One place for your plans, projects, and the people who make them happen.",
              ],
            }),
            yield* he("ul", {
              attrs: { "data-slot": Option.some("benefits") },
              children: yield* Effect.forEach(
                [
                  "Keep every project in view",
                  "Bring your whole team together",
                  "Grow at your own pace",
                ],
                (benefit) => he("li", { children: [benefit] }),
              ),
            }),
          ],
        });
      }),
  }),
);
