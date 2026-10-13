import { mounting, provideContext } from "@charismaticalli/frappe";
import * as Query from "@charismaticalli/frappe/query";
import { History, memoryHistory } from "@charismaticalli/frappe/router";
import { Effect, Exit, Layer, Option, Result, Scope } from "effect";
import { expect, it } from "vitest";
import { mockResources } from "~/routing-demo/resources";
import { App } from "./app";
import { AuthLive } from "./auth";
import { LocalStorageMemory } from "./local-storage";
import { QueryDemoSession, queryDemoResources } from "./query-demo";
import { rendered } from "./test-helpers";

it.each([
  { location: "/", selector: "main h1", active: "Home" },
  { location: "/examples/counter", selector: ".counter", active: "Examples" },
  { location: "/examples/auth", selector: ".access-example", active: "Examples" },
])(
  "initializes $location, retains the examples shell, and traverses browser history",
  async ({ location, selector, active }) => {
    const scope = await Effect.runPromise(Scope.make());
    try {
      const history = await Effect.runPromise(
        memoryHistory({ initial: location }).pipe(Effect.provideService(Scope.Scope, scope)),
      );
      const failures: unknown[] = [];
      const app = await Effect.runPromise(
        mounting({
          scope,
          resources: Layer.mergeAll(
            Layer.succeed(History, history),
            AuthLive,
            queryDemoResources,
            LocalStorageMemory,
            mockResources,
          ),
          onError: (failure) => {
            failures.push(failure);
          },
        }),
      );
      const parent = document.createElement("div");
      const partition = await Effect.runPromise(app.signal({ initial: Option.some("guest") }));
      await Effect.runPromise(Query.configure({ context: app, partition }));
      Effect.runSync(
        app.h(parent, provideContext({ key: QueryDemoSession, value: partition, child: App })),
      );
      const shows = (check: () => boolean) => rendered({ parent, check });
      const press = (label: string) => {
        const node = [
          ...parent.querySelectorAll<HTMLAnchorElement>(
            'nav[aria-label="Main navigation"] a, nav[aria-label="Examples navigation"] a',
          ),
        ].find((node) => node.textContent === label);
        expect(node).toBeDefined();
        node?.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
        );
      };
      await shows(() => parent.querySelector(selector) !== null);
      expect(history.location()).toBe(location);
      expect(
        parent.querySelector('nav[aria-label="Main navigation"] [aria-current="page"]')
          ?.textContent,
      ).toBe(active);
      press("Home");
      await shows(() => parent.querySelector("main h1")?.textContent === "frappé");
      const header = parent.querySelector(".app-header");
      expect(parent.querySelector(".counter")).toBeNull();
      expect(parent.querySelector(".routing-page")).toBeNull();
      press("Examples");
      await shows(() => parent.querySelector(".counter") !== null);
      expect(history.location()).toBe("/examples");
      expect(parent.querySelector(".todos")).toBeNull();
      const sidebar = parent.querySelector(".examples-sidebar");
      const nav = parent.querySelector('nav[aria-label="Examples navigation"]');
      const trigger = parent.querySelector<HTMLButtonElement>(".examples-menu-trigger");
      const cards = parent.querySelector(".example-cards");
      const counter = parent.querySelector(".counter");
      const links = [...parent.querySelectorAll('nav[aria-label="Examples navigation"] a')];
      expect(sidebar).not.toBeNull();
      expect(nav?.querySelector('[aria-current="page"]')?.textContent).toBe("Counter");
      expect(
        parent.querySelector('nav[aria-label="Main navigation"] [aria-current="page"]')
          ?.textContent,
      ).toBe("Examples");
      const menuId = trigger?.getAttribute("aria-controls");
      expect(menuId).toBe(nav?.id);
      trigger?.click();
      await shows(() => trigger?.getAttribute("aria-expanded") === "true");
      press("Todos");
      await shows(() => parent.querySelector(".todos") !== null);
      await shows(() => trigger?.getAttribute("aria-expanded") === "false");
      expect(history.location()).toBe("/examples/todos");
      expect(parent.querySelector(".counter")).toBeNull();
      expect(parent.contains(counter)).toBe(false);
      expect(parent.querySelector(".routing-page")).toBeNull();
      const expectExamplesShell = () => {
        expect(parent.querySelector(".examples-sidebar")).toBe(sidebar);
        expect(parent.querySelector('nav[aria-label="Examples navigation"]')).toBe(nav);
        expect(parent.querySelector(".examples-menu-trigger")).toBe(trigger);
        expect(parent.querySelector(".example-cards")).toBe(cards);
        expect(trigger?.getAttribute("aria-controls")).toBe(menuId);
        const currentLinks = [
          ...parent.querySelectorAll('nav[aria-label="Examples navigation"] a'),
        ];
        expect(currentLinks).toHaveLength(links.length);
        for (const [index, node] of currentLinks.entries()) {
          expect(node).toBe(links[index]);
        }
        expect(
          parent.querySelector('nav[aria-label="Main navigation"] [aria-current="page"]')
            ?.textContent,
        ).toBe("Examples");
      };
      expectExamplesShell();
      expect(nav?.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
      expect(nav?.querySelector('[aria-current="page"]')?.textContent).toBe("Todos");
      trigger?.click();
      await shows(() => trigger?.getAttribute("aria-expanded") === "true");
      Result.getOrThrow(history.traverse(-1));
      await shows(() => parent.querySelector(".counter") !== null);
      expect(history.location()).toBe("/examples");
      expectExamplesShell();
      expect(parent.querySelector(".counter")).not.toBe(counter);
      expect(parent.querySelector(".todos")).toBeNull();
      expect(nav?.querySelector('[aria-current="page"]')?.textContent).toBe("Counter");
      expect(trigger?.getAttribute("aria-expanded")).toBe("true");
      Result.getOrThrow(history.traverse(1));
      await shows(() => parent.querySelector(".todos") !== null);
      expect(history.location()).toBe("/examples/todos");
      expectExamplesShell();
      expect(nav?.querySelector('[aria-current="page"]')?.textContent).toBe("Todos");
      expect(trigger?.getAttribute("aria-expanded")).toBe("true");
      press("Routing");
      await shows(() => parent.querySelector(".routing-controls") !== null);
      expect(history.location()).toBe("/routing");
      expect(parent.querySelector(".counter")).toBeNull();
      expect(parent.querySelector(".examples-sidebar")).toBeNull();
      expect(parent.contains(sidebar)).toBe(false);
      expect(parent.querySelector(".app-header")).toBe(header);
      expect(
        parent.querySelector('nav[aria-label="Main navigation"] [aria-current="page"]')
          ?.textContent,
      ).toBe("Routing");
      expect(parent.querySelectorAll(".routing-controls section")).toHaveLength(3);
      expect(parent.querySelector<HTMLElement>(".routing-controls")?.hidden).toBe(true);
      expect(parent.querySelector(".routing-heading button")?.getAttribute("aria-expanded")).toBe(
        "false",
      );
      expect(parent.querySelector(".routing-content nav")).not.toBeNull();
      Result.getOrThrow(history.traverse(-1));
      await shows(() => parent.querySelector(".todos") !== null);
      expect(parent.querySelector(".examples-sidebar")).not.toBe(sidebar);
      expect(parent.querySelector(".examples-sidebar")).not.toBeNull();
      expect(parent.querySelector(".examples-menu-trigger")?.getAttribute("aria-expanded")).toBe(
        "false",
      );
      expect(
        parent.querySelector('nav[aria-label="Examples navigation"] [aria-current="page"]')
          ?.textContent,
      ).toBe("Todos");
      Result.getOrThrow(history.traverse(1));
      await shows(() => parent.querySelector(".routing-controls") !== null);
      press("Queries");
      await shows(() => parent.textContent?.includes("Project sidebar") === true);
      expect(history.location()).toBe("/queries");
      expect(parent.textContent).toContain("Project overview");
      expect(parent.textContent).toContain("Project sidebar");
      expect(failures).toEqual([]);
    } finally {
      await Effect.runPromise(Scope.close(scope, Exit.void));
    }
  },
);
