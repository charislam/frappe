import { Deferred, Effect } from "effect";
import { expect, it, vi } from "vitest";
import { Counter } from "~/examples/counter/example";
import { harness } from "~/test-helpers";
import type { SourceSet } from "./model";
import { ExampleSources } from "./source";

const source: SourceSet = {
  files: [
    {
      id: "entry",
      path: "example.ts",
      language: "typescript",
      source: "export {};",
      html: "<pre><code>export {};</code></pre>",
    },
  ],
  subscribe: () => () => {},
};
it("shows a loading fallback while the live demo stays interactive and preserves its state", async () => {
  const pending = await Effect.runPromise(Deferred.make<SourceSet>());
  const h = await harness();
  await h.adopt(
    await Effect.runPromise(
      h.ctx.he("div", {
        children: [Counter, ExampleSources(() => Effect.runPromise(Deferred.await(pending)))],
      }),
    ),
  );
  await vi.waitFor(() => expect(h.parent.textContent).toContain("Loading example source"));
  await vi.waitFor(() => expect(h.parent.querySelector(".counter button")).not.toBeNull());
  h.parent.querySelector<HTMLButtonElement>(".counter button")?.click();
  await vi.waitFor(() => expect(h.parent.querySelector("output")?.textContent).toBe("1"));
  const demo = h.parent.querySelector(".counter");
  await Effect.runPromise(Deferred.succeed(pending, source));
  await vi.waitFor(() =>
    expect(h.parent.querySelector(".source-filename")?.textContent).toBe("example.ts"),
  );
  expect(h.parent.querySelector(".counter")).toBe(demo);
  expect(h.parent.querySelector("output")?.textContent).toBe("1");
  expect(h.failures).toEqual([]);
});
it("reports loading failures without failing or removing the demo", async () => {
  const h = await harness();
  await h.adopt(
    await Effect.runPromise(
      h.ctx.he("div", {
        children: [Counter, ExampleSources(() => Promise.reject(new Error("network")))],
      }),
    ),
  );
  await vi.waitFor(() =>
    expect(h.parent.querySelector('[role="alert"]')?.textContent).toContain("could not be loaded"),
  );
  expect(h.parent.querySelector(".counter")).not.toBeNull();
  expect(h.failures).toEqual([]);
});
