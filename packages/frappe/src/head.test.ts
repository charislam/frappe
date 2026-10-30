import { Deferred, Effect, Match, Option, Result } from "effect";
import { describe, expect, it } from "vitest";
import { type ComponentContext, branch, cases } from "./framework";
import * as Head from "./head";
import { browser } from "./head-browser";
import { resolve as resolveResult } from "./head-resolver";
import * as Sync from "./sync";
import { harness, rendered } from "./test-helpers";

const resolve = (options: Parameters<typeof resolveResult>[0]) =>
  Result.getOrThrow(resolveResult(options));

describe("head resolver", () => {
  it("merges fields, formats once and blocks cleared fallbacks", () => {
    const result = resolve({
      chain: [
        {
          title: "App",
          titleTemplate: "%s · App",
          description: "default",
          openGraph: { type: "website" },
        },
        { title: "Page", description: Head.clear, openGraph: { title: Head.clear } },
      ],
    });
    expect(Option.getOrThrow(result.title)).toBe("Page · App");
    expect(result.tags).toEqual([
      { key: "og:type", element: "meta", attributes: { property: "og:type", content: "website" } },
    ]);
  });
  it("clears templates, URLs and image arrays with the public utility", () => {
    const snapshot = resolve({
      chain: [
        {
          title: "Parent",
          titleTemplate: "%s · App",
          canonical: "https://example.com",
          openGraph: { images: [{ url: "https://example.com/image" }] },
          twitter: { image: "https://example.com/twitter" },
        },
        {
          title: "Child",
          titleTemplate: Head.clear,
          canonical: Head.clear,
          openGraph: { images: Head.clear },
          twitter: { image: Head.clear },
        },
      ],
    });
    expect(Option.getOrThrow(snapshot.title)).toBe("Child");
    expect(snapshot.tags.map((tag) => tag.key)).toEqual(["og:title", "twitter:title"]);
  });
  it("validates the configured site URL even without URL metadata", () => {
    expect(
      Result.getFailure(resolveResult({ siteUrl: "/relative", chain: [{ title: "Page" }] })),
    ).toEqual(Option.some(new Head.MetadataError({ message: "siteUrl must be an absolute URL" })));
    expect(
      Option.getOrThrow(
        resolve({
          siteUrl: "https://example.com/base/",
          chain: [{ title: "Page", canonical: "detail" }],
        }).title,
      ),
    ).toBe("Page");
    expect(
      resolve({
        siteUrl: "https://example.com/base/",
        chain: [{ canonical: "detail" }],
      }).tags[0]?.attributes["href"],
    ).toBe("https://example.com/base/detail");
  });
  it("normalizes URLs and replaces image arrays in order", () => {
    const result = resolve({
      siteUrl: "https://example.com",
      chain: [
        { openGraph: { images: [{ url: "/old" }] } },
        {
          canonical: "/page",
          openGraph: { images: [{ url: "/a", alt: "a", width: 20 }, { url: "/b" }] },
        },
      ],
    });
    expect(result.tags.map((tag) => tag.attributes["content"] ?? tag.attributes["href"])).toEqual([
      "https://example.com/page",
      "https://example.com/a",
      "a",
      "20",
      "https://example.com/b",
    ]);
    expect(Result.isFailure(resolveResult({ chain: [{ canonical: "/relative" }] }))).toBe(true);
    expect(Result.getFailure(resolveResult({ chain: [{ titleTemplate: "%s %s" }] }))).toEqual(
      Option.some(new Head.MetadataError({ message: "titleTemplate requires exactly one %s" })),
    );
  });
});
describe("head browser", () => {
  it("adopts, reuses, removes trailing images and restores baseline nodes", () => {
    document.head.innerHTML =
      '<title data-frappe-head>Initial</title><meta name="other" content="keep">';
    const original = document.head.querySelector("title");
    const adapter = Result.getOrThrow(browser(document));
    Result.getOrThrow(
      adapter.write(
        resolve({
          chain: [
            {
              title: "Page",
              openGraph: {
                images: [{ url: "https://example.com/a" }, { url: "https://example.com/b" }],
              },
            },
          ],
        }),
      ),
    );
    expect(document.head.querySelector("title")).toBe(original);
    Result.getOrThrow(adapter.write(resolve({ chain: [{ title: "Next" }] })));
    expect(document.head.querySelectorAll('[property="og:image"]')).toHaveLength(0);
    expect(document.head.querySelector('[name="other"]')).not.toBeNull();
    adapter.dispose();
    expect(
      Option.getOrThrow(Result.getFailure(adapter.write(resolve({ chain: [{ title: "Late" }] }))))
        .message,
    ).toBe("Head adapter disposed");
    expect(document.title).toBe("Initial");
    expect(document.head.querySelector("title")).toBe(original);
    document.head.innerHTML = "";
  });
  it("rejects unmanaged singleton tags before mutation", () => {
    document.head.innerHTML = "<title>Unmanaged</title>";
    expect(Option.getOrThrow(Result.getFailure(browser(document))).message).toContain("bootstrap");
    expect(document.title).toBe("Unmanaged");
    document.head.innerHTML = "";
  });
});
describe("head lifecycle", () => {
  it("updates signals, rejects invalid snapshots and duplicate roots, and disposes", async () => {
    document.head.innerHTML = "";
    const h = await harness();
    const source = await Effect.runPromise(
      h.ctx.signal<Head.Metadata>({ initial: { title: "App" } }),
    );
    const root = await Effect.runPromise(Head.root({ context: h.ctx, document, defaults: source }));
    const invalidHandle = await Effect.runPromise(
      Head.child({
        context: h.ctx,
        parent: { ...root },
        metadata: {},
      }).pipe(Effect.flip),
    );
    expect(invalidHandle.message).toBe("Invalid Head handle");
    expect(document.title).toBe("App");
    await Effect.runPromise(source.set({ title: "Next" }));
    expect(document.title).toBe("Next");
    expect(
      await Effect.runPromise(
        source.set({ title: "Invalid", canonical: "/bad" }).pipe(Effect.flip),
      ),
    ).toBeDefined();
    expect(document.title).toBe("Next");
    expect(
      await Effect.runPromise(
        Head.root({ context: h.ctx, document, defaults: {} }).pipe(Effect.flip),
      ),
    ).toBeDefined();
    await Effect.runPromise(
      Head.child({ context: h.ctx, parent: root, metadata: { title: "Child" } }),
    );
    expect(document.title).toBe("Child");
    expect(
      await Effect.runPromise(
        Head.child({ context: h.ctx, parent: root, metadata: {} }).pipe(Effect.flip),
      ),
    ).toBeDefined();
    await h.close();
    expect(document.head.querySelector("[data-frappe-head]")).toBeNull();
  });
});

describe("head branch commits", () => {
  it("retains metadata until delayed replacement presents and restores the parent on removal", async () => {
    document.head.innerHTML = "";
    const h = await harness();
    const root = await Effect.runPromise(
      Head.root({ context: h.ctx, document, defaults: { title: "App" } }),
    );
    const gate = Deferred.makeUnsafe<void>();
    const state = await Effect.runPromise(
      h.ctx.signal<{ _tag: "First" } | { _tag: "Second" } | { _tag: "Empty" }>({
        initial: { _tag: "First" },
      }),
    );
    const page = (title: string) =>
      Sync.succeed({
        setup: (context: ComponentContext) =>
          Effect.gen(function* () {
            yield* Head.child({ context, parent: root, metadata: { title } });
            yield* Match.value(String(title)).pipe(
              Match.when("Second", () => Deferred.await(gate)),
              Match.orElse(() => Effect.void),
            );
            return yield* context.he("span", { children: [String(title)] });
          }),
      });
    const First = branch<{ _tag: "First" }>()(() => page("First"));
    const Second = branch<{ _tag: "Second" }>()(() => page("Second"));
    const Empty = branch<{ _tag: "Empty" }>()(() =>
      Sync.succeed({ setup: () => Effect.succeed([]) }),
    );
    Effect.runSync(
      h.ctx.h(
        h.target,
        cases({
          state,
          branches: {
            First: { branch: First },
            Second: { branch: Second },
            Empty: { branch: Empty },
          },
        }),
      ),
    );
    await rendered({ parent: document.head, check: () => document.title === "First" });
    await Effect.runPromise(state.set({ _tag: "Second" }));
    expect(document.title).toBe("First");
    await Effect.runPromise(Deferred.succeed(gate, undefined));
    await rendered({ parent: document.head, check: () => document.title === "Second" });
    await Effect.runPromise(state.set({ _tag: "Empty" }));
    await rendered({ parent: document.head, check: () => document.title === "App" });
    await h.close();
  });
});
