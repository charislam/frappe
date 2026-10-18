import { Effect, Option } from "effect";
import { describe, expect, it, vi } from "vitest";
import { Counter } from "~/examples/counter/example";
import { harness } from "~/test-helpers";
import { type SourceFiles } from "./model";
import { CodeViewer, LiveCodeViewer } from "./view";

const files = [
  {
    id: "entry-file",
    path: "example.ts",
    language: "typescript",
    source: 'const html = "<script>alert(1)</script>";\n',
    html: '<pre><code><span class="line">const html = "&lt;script&gt;alert(1)&lt;/script&gt;";</span>\n</code></pre>',
  },
  {
    id: "shared-file",
    path: "shared/storage.ts",
    language: "typescript",
    source: "export const value = 2;\n",
    html: "<pre><code>export const value = 2;\n</code></pre>",
  },
] as const satisfies SourceFiles;
const shown = (_parent: Node, check: () => boolean) =>
  vi.waitFor(() => expect(check()).toBe(true), { timeout: 2000 });
describe("source viewer", () => {
  it("selects files, resets scrolling, copies exact source, and preserves the demo", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const h = await harness();
    await h.adopt(
      await Effect.runPromise(h.ctx.he("div", { children: [Counter, CodeViewer(files)] })),
    );
    const root = h.parent;
    await shown(root, () => root.querySelector(".counter") !== null);
    const counter = root.querySelector(".counter");
    [...root.querySelectorAll("button")]
      .find((button) => button.textContent === "Increment")
      ?.click();
    await shown(root, () => counter?.querySelector("output")?.textContent === "1");
    await shown(root, () => root.querySelector(".code-viewer") !== null);
    const code = root.querySelector<HTMLElement>(".source-code");
    expect(code?.querySelector("script")).toBeNull();
    expect(code?.textContent).toContain("<script>alert(1)</script>");
    code?.scrollTo({ left: 120, top: 120 });
    const select = Option.getOrThrow(Option.fromNullishOr(root.querySelector("select")));
    select.value = files[1].id;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await shown(root, () => root.querySelector("strong")?.textContent === files[1].path);
    await shown(root, () => code?.textContent === files[1].source);
    expect(code?.scrollTop).toBe(0);
    expect(code?.scrollLeft).toBe(0);
    expect(root.querySelector(".counter")).toBe(counter);
    expect(counter?.querySelector("output")?.textContent).toBe("1");
    [...root.querySelectorAll("button")]
      .find((button) => button.textContent === "Copy file")
      ?.click();
    expect(writeText).toHaveBeenCalledWith(files[1].source);
    await shown(root, () => root.querySelector('[role="status"]')?.textContent === "File copied.");
    expect(writeText).toHaveBeenCalledWith(files[1].source);
    writeText.mockRejectedValue(new Error("denied"));
    [...root.querySelectorAll("button")]
      .find((button) => button.textContent === "Copy file")
      ?.click();
    await shown(
      root,
      () => root.querySelector('[role="status"]')?.textContent?.includes("Copy failed") === true,
    );
    expect(root.querySelector("strong")?.textContent).toBe(files[1].path);
    expect(select.closest("label")?.textContent).toContain("Source file");
    expect(root.querySelector(".code-viewer")?.lastElementChild).toBe(select.closest("label"));
    expect(h.failures).toEqual([]);
  });
  it("retains selection through source updates and falls back when a file disappears", async () => {
    const listeners = new Set<(files: SourceFiles) => void>();
    const h = await harness();
    await h.adopt(
      await Effect.runPromise(
        h.ctx.he("div", {
          children: [
            LiveCodeViewer({
              files,
              subscribe: (listener) => {
                listeners.add(listener);
                return () => {
                  listeners.delete(listener);
                };
              },
            }),
          ],
        }),
      ),
    );
    await shown(h.parent, () => h.parent.querySelector("select") !== null);
    const select = Option.getOrThrow(Option.fromNullishOr(h.parent.querySelector("select")));
    select.value = files[1].id;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await shown(h.parent, () => h.parent.querySelector("strong")?.textContent === files[1].path);
    for (const listener of listeners) listener(files);
    await shown(
      h.parent,
      () =>
        h.parent.querySelector("select") !== null && h.parent.querySelector("select") !== select,
    );
    expect(h.parent.querySelector("strong")?.textContent).toBe(files[1].path);
    for (const listener of listeners) listener([files[0]]);
    await shown(h.parent, () => h.parent.querySelector("strong")?.textContent === files[0].path);
    await h.close();
    expect(listeners.size).toBe(0);
  });
});

it("calls the clipboard within the native click gesture and catches synchronous browser failures", async () => {
  let insideGesture = false;
  const writeText = vi.fn(() => {
    expect(insideGesture).toBe(true);
    return Promise.resolve();
  });
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  const h = await harness();
  await h.adopt(await Effect.runPromise(h.ctx.he("div", { children: [CodeViewer(files)] })));
  await shown(h.parent, () => h.parent.querySelector(".source-filename") !== null);
  const copy = Option.getOrThrow(
    Option.fromNullishOr(h.parent.querySelector<HTMLButtonElement>(".code-viewer header button")),
  );
  insideGesture = true;
  copy.click();
  insideGesture = false;
  expect(writeText).toHaveBeenCalledWith(files[0].source);
  await shown(
    h.parent,
    () => h.parent.querySelector('[role="status"]')?.textContent === "File copied.",
  );
  writeText.mockImplementationOnce(() => {
    throw new Error("clipboard unavailable");
  });
  copy.click();
  await shown(
    h.parent,
    () => h.parent.querySelector('[role="status"]')?.textContent?.includes("Copy failed") === true,
  );
  expect(h.failures).toEqual([]);
});
