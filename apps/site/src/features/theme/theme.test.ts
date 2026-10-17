import { Sync, component, provideContext } from "@charismaticalli/frappe";
import { Effect, Layer, Match, Option } from "effect";
import { KeyValueStoreError } from "effect/unstable/persistence/KeyValueStore";
import { afterEach, expect, it, vi } from "vitest";
import { LocalStorage, LocalStorageLive } from "~/local-storage";
import { harness } from "~/test-helpers";
import { browserTheme } from "./browser";
import { Theme, makeTheme } from "./controller";
import { initialize } from "./initialize";
import { ThemeSelector } from "./selector";

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  delete window.frappeTheme;
  document.body.className = "";
});

it("initializes synchronously from saved overrides and preserves body classes", () => {
  window.localStorage.setItem("frappe.theme", "dark");
  window.localStorage.setItem("demo-email", "existing@example.com");
  document.body.className = "existing";
  initialize();
  expect(document.body.className).toBe("existing dark");
  expect(window.frappeTheme).toBe("dark");
  expect(window.localStorage.getItem("demo-email")).toBe("existing@example.com");
});

it("survives a throwing storage getter at startup", () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
    throw new Error("denied");
  });
  expect(initialize).not.toThrow();
  expect(window.frappeTheme).toBe("system");
  expect(console.warn).toHaveBeenCalledOnce();
});

it("filters storage events and disposes both listeners", () => {
  const browser = browserTheme(window);
  const receive = vi.fn();
  const dispose = browser.observe(receive);
  const send = (options: StorageEventInit) =>
    window.dispatchEvent(new StorageEvent("storage", options));
  send({ key: "other", newValue: "dark", storageArea: window.localStorage });
  send({ key: "frappe.theme", newValue: "dark", storageArea: window.sessionStorage });
  expect(receive).not.toHaveBeenCalled();
  send({ key: "frappe.theme", newValue: "dark", storageArea: window.localStorage });
  expect(receive).toHaveBeenLastCalledWith(Option.some("dark"));
  send({ key: null, storageArea: window.localStorage });
  expect(receive).toHaveBeenLastCalledWith(Option.some("system"));
  dispose();
  send({ key: "frappe.theme", newValue: "light", storageArea: window.localStorage });
  expect(receive).toHaveBeenCalledTimes(2);
});

it("binds selection, follows System, synchronizes remotely without writeback, and cleans up", async () => {
  const f = await harness();
  let dark = false;
  let receive: (value: Option.Option<"light" | "dark" | "system">) => void = () => {};
  const dispose = vi.fn();
  const observe = vi.fn((listener: typeof receive) => {
    receive = listener;
    return dispose;
  });
  const project = vi.fn();
  const set = vi.fn(() => Effect.void);
  const storage = Layer.succeed(
    LocalStorage,
    LocalStorage.of({ persistent: true, get: () => Effect.succeed(Option.none()), set }),
  );
  const view = component(() =>
    Sync.succeed({
      setup: (context) =>
        Effect.gen(function* () {
          const theme = yield* makeTheme({
            context,
            startup: Option.none(),
            browser: {
              systemDark: () => dark,
              project,
              observe,
            },
          });
          return provideContext({ key: Theme, value: theme, child: ThemeSelector });
        }).pipe(Effect.provide(storage)),
    }),
  );
  Effect.runSync(f.h(f.target, view));
  await vi.waitFor(() => {
    expect(f.failures).toEqual([]);
    expect(f.parent.querySelector("select")).not.toBeNull();
  });
  const select = Option.getOrThrow(Option.fromNullishOr(f.parent.querySelector("select")));
  expect(select?.value).toBe("system");
  expect([...f.parent.querySelectorAll("option")].map((node) => node.textContent)).toEqual([
    "Light",
    "Dark",
    "System",
  ]);
  expect(f.parent.querySelector("label")?.htmlFor).toBe(select?.id);
  expect(f.parent.querySelector("label")?.textContent).toBe("Theme");
  const visibleIcon = () => f.parent.querySelector("[data-theme-icon]:not([hidden])");
  expect(visibleIcon()?.getAttribute("data-theme-icon")).toBe("system");
  expect(visibleIcon()?.getAttribute("aria-hidden")).toBe("true");
  expect(select.title).toBe("Theme: System");
  select.value = "dark";
  select.dispatchEvent(new Event("change"));
  await vi.waitFor(() => expect(set).toHaveBeenCalledWith({ key: "frappe.theme", value: "dark" }));
  expect(project).toHaveBeenLastCalledWith("dark");
  expect(visibleIcon()?.getAttribute("data-theme-icon")).toBe("dark");
  expect(select.title).toBe("Theme: Dark");
  receive(Option.some("light"));
  await vi.waitFor(() => expect(select.value).toBe("light"));
  expect(visibleIcon()?.getAttribute("data-theme-icon")).toBe("light");
  expect(select.title).toBe("Theme: Light");
  receive(Option.some("system"));
  await vi.waitFor(() => expect(select.value).toBe("system"));
  dark = true;
  receive(Option.none());
  await vi.waitFor(() => expect(project).toHaveBeenLastCalledWith("dark"));
  expect(set).toHaveBeenCalledTimes(1);
  expect(visibleIcon()?.getAttribute("data-theme-icon")).toBe("system");
  expect(select.title).toBe("Theme: System");
  Effect.runSync(f.h(f.target, []));
  await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce());
  Effect.runSync(f.h(f.target, view));
  await vi.waitFor(() => expect(observe).toHaveBeenCalledTimes(2));
  await f.close();
  expect(dispose).toHaveBeenCalledTimes(2);
});

it("exposes operation errors rather than defects", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const storage = window.localStorage;
  vi.spyOn(storage, "setItem").mockImplementation(() => {
    throw new Error("full");
  });
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const storage = yield* LocalStorage;
      return yield* storage.set({ key: "frappe.theme", value: "dark" }).pipe(Effect.flip);
    }).pipe(Effect.provide(LocalStorageLive)),
  );
  expect(result).toBeInstanceOf(KeyValueStoreError);
  expect(warn).not.toHaveBeenCalled();
});

it.each(["failed-read", "memory-fallback", "failed-write"] as const)(
  "retains startup and new selections with %s",
  async (mode) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const f = await harness();
    const failure = new KeyValueStoreError({ method: "get", message: "unavailable" });
    const writes: string[] = [];
    const storage = Layer.succeed(
      LocalStorage,
      LocalStorage.of({
        persistent: false,
        get: () =>
          Match.value(mode).pipe(
            Match.when("failed-read", () => Effect.fail(failure)),
            Match.orElse(() => Effect.succeed(Option.none<string>())),
          ),
        set: ({ value }) =>
          Effect.gen(function* () {
            writes.push(value);
            yield* Match.value(mode).pipe(
              Match.when("failed-write", () => Effect.fail(failure)),
              Match.orElse(() => Effect.void),
            );
          }),
      }),
    );
    const project = vi.fn();
    const view = component(() =>
      Sync.succeed({
        setup: (context) =>
          Effect.gen(function* () {
            const theme = yield* makeTheme({
              context,
              startup: Option.some("dark"),
              browser: {
                systemDark: () => false,
                project,
                observe: () => () => {},
              },
            });
            return provideContext({ key: Theme, value: theme, child: ThemeSelector });
          }).pipe(Effect.provide(storage)),
      }),
    );
    Effect.runSync(f.h(f.target, view));
    await vi.waitFor(() => expect(f.parent.querySelector("select")?.value).toBe("dark"));
    const select = Option.getOrThrow(Option.fromNullishOr(f.parent.querySelector("select")));
    for (const value of ["light", "dark", "system"]) {
      select.value = value;
      select.dispatchEvent(new Event("change"));
    }
    await vi.waitFor(() => expect(project).toHaveBeenLastCalledWith("light"));
    expect(select.value).toBe("system");
    await vi.waitFor(() => expect(writes).toEqual(["light", "dark", "system"]));
    expect(select.value).toBe("system");
    expect(f.failures).toEqual([]);
  },
);

it("processes a remote preference after an earlier local save without writing it back", async () => {
  const f = await harness();
  let persisted = "system";
  let receive: (value: Option.Option<"light" | "dark" | "system">) => void = () => {};
  const set = vi.fn(({ value }: { key: string; value: string }) =>
    Effect.sync(() => {
      persisted = value;
      // Another tab changes storage immediately after this synchronous write.
      persisted = "light";
      receive(Option.some("light"));
    }),
  );
  const storage = Layer.succeed(
    LocalStorage,
    LocalStorage.of({
      persistent: true,
      get: () => Effect.succeed(Option.some(persisted)),
      set,
    }),
  );
  const view = component(() =>
    Sync.succeed({
      setup: (context) =>
        Effect.gen(function* () {
          const theme = yield* makeTheme({
            context,
            startup: Option.none(),
            browser: {
              systemDark: () => false,
              project: () => {},
              observe: (listener) => {
                receive = listener;
                return () => {};
              },
            },
          });
          return provideContext({ key: Theme, value: theme, child: ThemeSelector });
        }).pipe(Effect.provide(storage)),
    }),
  );
  Effect.runSync(f.h(f.target, view));
  await vi.waitFor(() => expect(f.parent.querySelector("select")).not.toBeNull());
  const select = Option.getOrThrow(Option.fromNullishOr(f.parent.querySelector("select")));
  select.value = "dark";
  select.dispatchEvent(new Event("change"));
  await vi.waitFor(() => expect(select.value).toBe("light"));
  expect(persisted).toBe("light");
  expect(set).toHaveBeenCalledTimes(1);
  expect(f.failures).toEqual([]);
});
