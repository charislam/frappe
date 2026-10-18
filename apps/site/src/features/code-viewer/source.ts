import { Sync, component } from "@charismaticalli/frappe";
import { Effect, Option } from "effect";
import type { SourceSet } from "./model";
import { LiveCodeViewer } from "./view";

export const ExampleSources = (load: () => Promise<SourceSet>) =>
  component(() =>
    Sync.succeed({
      fallback: (context) =>
        context.he("section", {
          attrs: { class: Option.some("code-viewer"), role: Option.some("status") },
          children: ["Loading example source…"],
        }),
      setup: (context) =>
        Effect.tryPromise(load).pipe(
          Effect.matchEffect({
            onSuccess: (sources) => Effect.succeed(LiveCodeViewer(sources)),
            onFailure: () =>
              context.he("section", {
                attrs: { class: Option.some("code-viewer"), role: Option.some("alert") },
                children: ["Example source could not be loaded. Reload the page to try again."],
              }),
          }),
        ),
    }),
  );
