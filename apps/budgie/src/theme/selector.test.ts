// @vitest-environment happy-dom
import { type MountFailure, mounting } from "@charismaticalli/frappe";
import { Effect, Exit, Option, Scope } from "effect";
import type { DetachedWindowAPI } from "happy-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Preference, storageKey } from "./model";
import { ThemeSelector } from "./selector";

const run = Effect.runPromise;
const cleanups: Array<() => Promise<void>> = [];
declare const window: Window & { readonly happyDOM: DetachedWindowAPI };

const systemTheme = (theme: "light" | "dark") => {
  window.happyDOM.settings.device.prefersColorScheme = theme;
  window.dispatchEvent(new Event("resize"));
};
const renderedTheme = () => document.documentElement.dataset["theme"];
const expectIcon = (preference: Preference) => {
  const visible = document.querySelectorAll("[data-theme-icon]:not([hidden])");
  expect(visible).toHaveLength(1);
  expect(visible[0]?.getAttribute("data-theme-icon")).toBe(preference);
  expect(visible[0]?.getAttribute("aria-hidden")).toBe("true");
  expect(visible[0]?.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  expect(visible[0]?.querySelector("svg")?.getAttribute("focusable")).toBe("false");
};
const remote = (options: StorageEventInit) =>
  window.dispatchEvent(new StorageEvent("storage", options));

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  document.body.replaceChildren();
  delete document.documentElement.dataset["theme"];
  systemTheme("light");
});
afterEach(async () => {
  for (const close of cleanups.splice(0)) await close();
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
  document.body.replaceChildren();
  delete document.documentElement.dataset["theme"];
  systemTheme("light");
});
const mount = async () => {
  const scope = await run(Scope.make());
  const close = () => run(Scope.close(scope, Exit.void));
  cleanups.push(close);
  const failures: MountFailure[] = [];
  const app = await run(mounting({ scope, onError: (failure) => failures.push(failure) }));
  const parent = document.createElement("main");
  document.body.append(parent);
  await run(app.h(parent, ThemeSelector));
  await vi.waitFor(() => {
    expect(failures).toEqual([]);
    expect(parent.querySelector("select")).not.toBeNull();
  });
  const select = Option.getOrThrow(Option.fromNullishOr(parent.querySelector("select")));
  const choose = async (preference: Preference) => {
    const projected = new Promise<void>((resolve) => {
      const observer = new MutationObserver(() => {
        observer.disconnect();
        resolve();
      });
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme"],
      });
      cleanups.push(async () => observer.disconnect());
    });
    select.value = preference;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await projected;
  };
  return { select, parent, choose, close, failures };
};

describe("theme selector in the DOM", () => {
  it.each([
    { saved: "light", system: "dark", selected: "light", resolved: "light" },
    { saved: "dark", system: "light", selected: "dark", resolved: "dark" },
    { saved: "system", system: "dark", selected: "system", resolved: "dark" },
    { saved: "invalid", system: "light", selected: "system", resolved: "light" },
  ] as const)(
    "restores $saved with a $system system theme",
    async ({ saved, system, selected, resolved }) => {
      window.localStorage.setItem(storageKey, saved);
      systemTheme(system);
      const { select } = await mount();
      expect(select.value).toBe(selected);
      expect(renderedTheme()).toBe(resolved);
      expectIcon(selected);
      expect(
        Array.from(select.options, (option) => ({ value: option.value, text: option.text })),
      ).toEqual([
        { value: "system", text: "System" },
        { value: "light", text: "Light" },
        { value: "dark", text: "Dark" },
      ]);
      expect(window.localStorage.getItem(storageKey)).toBe(saved);
    },
  );

  it("uses System when nothing is saved and persists each user selection", async () => {
    systemTheme("dark");
    const { select, choose } = await mount();
    expect(select.value).toBe("system");
    expect(renderedTheme()).toBe("dark");
    expect(window.localStorage.getItem(storageKey)).toBeNull();
    window.localStorage.setItem("unrelated", "keep");
    for (const { preference, resolved } of [
      { preference: "light", resolved: "light" },
      { preference: "dark", resolved: "dark" },
      { preference: "system", resolved: "dark" },
    ] as const) {
      await choose(preference);
      expect(renderedTheme()).toBe(resolved);
      expect(select.value).toBe(preference);
      expectIcon(preference);
      expect(window.localStorage.getItem(storageKey)).toBe(preference);
    }
    expect(window.localStorage.getItem("unrelated")).toBe("keep");
  });

  it("follows OS changes only while System is selected", async () => {
    const { select, choose } = await mount();
    systemTheme("dark");
    expect(renderedTheme()).toBe("dark");
    expect(select.value).toBe("system");
    expectIcon("system");
    systemTheme("light");
    expect(renderedTheme()).toBe("light");
    await choose("dark");
    systemTheme("dark");
    systemTheme("light");
    expect(renderedTheme()).toBe("dark");
    expect(select.value).toBe("dark");
    await choose("light");
    systemTheme("dark");
    expect(renderedTheme()).toBe("light");
    await choose("system");
    systemTheme("light");
    expect(renderedTheme()).toBe("light");
    expect(window.localStorage.getItem(storageKey)).toBe("system");
  });

  it("synchronizes remote changes, removal, and clear without writing them back", async () => {
    systemTheme("dark");
    const { select } = await mount();
    window.localStorage.setItem(storageKey, "sentinel");
    for (const change of [
      { newValue: "light", selected: "light", resolved: "light" },
      { newValue: "dark", selected: "dark", resolved: "dark" },
      { newValue: "invalid", selected: "system", resolved: "dark" },
      { newValue: null, selected: "system", resolved: "dark" },
    ] as const) {
      remote({ key: storageKey, newValue: change.newValue, storageArea: window.localStorage });
      expect(select.value).toBe(change.selected);
      expectIcon(change.selected);
      expect(renderedTheme()).toBe(change.resolved);
      expect(window.localStorage.getItem(storageKey)).toBe("sentinel");
    }
    remote({ key: storageKey, newValue: "light", storageArea: window.localStorage });
    remote({ key: null, storageArea: window.localStorage });
    expect(select.value).toBe("system");
    expect(renderedTheme()).toBe("dark");
    expect(window.localStorage.getItem(storageKey)).toBe("sentinel");
  });

  it("ignores unrelated keys, session storage, and events without a storage area", async () => {
    const { select, choose } = await mount();
    await choose("light");
    for (const event of [
      { key: "other", newValue: "dark", storageArea: window.localStorage },
      { key: storageKey, newValue: "dark", storageArea: window.sessionStorage },
      { key: storageKey, newValue: "dark" },
    ])
      remote(event);
    expect(select.value).toBe("light");
    expect(renderedTheme()).toBe("light");
    expect(window.localStorage.getItem(storageKey)).toBe("light");
  });

  it("keeps selection and OS updates usable when the storage getter is denied", async () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("Storage denied", "SecurityError");
    });
    const { select, choose, failures } = await mount();
    expect(select.value).toBe("system");
    await choose("dark");
    expect(select.value).toBe("dark");
    remote({ key: storageKey, newValue: "light" });
    expect(renderedTheme()).toBe("dark");
    await choose("system");
    systemTheme("dark");
    expect(renderedTheme()).toBe("dark");
    expect(failures).toEqual([]);
  });

  it("keeps an in-memory selection when persistence fails", async () => {
    window.localStorage.setItem(storageKey, "light");
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("Storage full", "QuotaExceededError");
    });
    const { select, choose, failures } = await mount();
    await choose("dark");
    expect(select.value).toBe("dark");
    expect(window.localStorage.getItem(storageKey)).toBe("light");
    expect(failures).toEqual([]);
  });

  it("gives independently mounted selectors distinct accessible labels", async () => {
    const first = await mount();
    const second = await mount();
    expect(first.select.id).not.toBe(second.select.id);
    expect(first.select.labels?.[0]?.htmlFor).toBe(first.select.id);
    expect(second.select.labels?.[0]?.htmlFor).toBe(second.select.id);
  });

  it("disposes OS and storage listeners with the application scope", async () => {
    const { close } = await mount();
    await close();
    document.documentElement.dataset["theme"] = "light";
    systemTheme("dark");
    remote({ key: storageKey, newValue: "dark", storageArea: window.localStorage });
    expect(renderedTheme()).toBe("light");
  });
});
