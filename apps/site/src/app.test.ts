import { mounting, provideContext } from "@charismaticalli/frappe";
import * as Query from "@charismaticalli/frappe/query";
import { History, memoryHistory } from "@charismaticalli/frappe/router";
import { Effect, Exit, Layer, Match, Option, Result, Scope } from "effect";
import { expect, it, vi } from "vitest";
import { QueryDemoSession } from "~/examples/queries/context";
import { queryDemoResources } from "~/examples/queries/resources";
import { mockResources } from "~/examples/routing/resources";
import { App } from "./app";
import { AuthLive } from "./auth";
import { LocalStorageMemory } from "./local-storage";

it.each([
  { location: "/", selector: "main h1", active: "Home" },
  { location: "/examples/counter", selector: ".counter", active: "Examples" },
  { location: "/examples/auth", selector: ".auth-example", active: "Examples" },
  { location: "/examples", selector: ".counter", active: "Examples" },
  { location: "/examples/text-input", selector: ".example-detail input", active: "Examples" },
  { location: "/examples/tabs", selector: '[role="tablist"]', active: "Examples" },
  { location: "/examples/loading", selector: ".example-detail section", active: "Examples" },
  { location: "/examples/todos", selector: ".todos", active: "Examples" },
  { location: "/examples/routing", selector: ".routing-page", active: "Examples" },
  { location: "/examples/queries", selector: ".example-detail section", active: "Examples" },
  {
    location: "/examples/routing/projects/123/settings",
    selector: ".routing-page",
    active: "Examples",
  },
  {
    location: "/examples/routing/projects/wrong-id",
    selector: ".routing-page",
    active: "Examples",
  },
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
      const shows = (check: () => boolean) =>
        vi.waitFor(
          () =>
            expect(
              check(),
              `${check.toString()} failures: ${failures.length} DOM: ${parent.textContent?.slice(0, 300)}`,
            ).toBe(true),
          { timeout: 2000 },
        );
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
      const initialLocation = Match.value(location.startsWith("/examples/routing")).pipe(
        Match.when(true, () => "/examples/routing/login"),
        Match.orElse(() => location),
      );
      await shows(() => history.location() === initialLocation);
      await shows(() => parent.querySelector(".code-viewer") !== null || location === "/");
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
      await shows(() => history.location() === "/examples/routing/login");
      expect(parent.querySelector('[aria-label="Authenticated shell"]')).toBeNull();
      const signIn = [...parent.querySelectorAll<HTMLButtonElement>(".routing-page button")].find(
        (button) => button.textContent === "Continue as Ada",
      );
      expect(signIn).toBeDefined();
      signIn?.click();
      await shows(() => history.location() === "/examples/routing");
      expect(parent.querySelector(".counter")).toBeNull();
      expect(parent.querySelector(".examples-sidebar")).toBe(sidebar);
      expect(parent.contains(sidebar)).toBe(true);
      expect(parent.querySelector(".app-header")).toBe(header);
      expect(
        parent.querySelector('nav[aria-label="Main navigation"] [aria-current="page"]')
          ?.textContent,
      ).toBe("Examples");
      await shows(
        () =>
          parent.querySelector(
            '.routing-content a[href="/examples/routing/projects/123/settings"]',
          ) !== null && parent.querySelector(".code-viewer .source-filename") !== null,
      );
      const viewer = parent.querySelector(".code-viewer");
      const routeDemo = parent.querySelector(".routing-page");
      const fileSelect = parent.querySelector(".code-viewer select");
      expect(viewer).not.toBeNull();
      const routingLink = parent.querySelector<HTMLAnchorElement>(
        '.routing-content a[href="/examples/routing/projects/123/settings"]',
      );
      routingLink?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
      );
      await shows(() => history.location() === "/examples/routing/projects/123/settings");
      expect(parent.querySelector(".code-viewer")).toBe(viewer);
      expect(parent.querySelector(".routing-page")).toBe(routeDemo);
      expect(parent.querySelector(".code-viewer select")).toBe(fileSelect);
      Result.getOrThrow(history.traverse(-1));
      await shows(() => history.location() === "/examples/routing");
      expect(parent.querySelector(".code-viewer")).toBe(viewer);
      expect(parent.querySelector(".routing-controls")).toBeNull();
      expect(parent.querySelector(".routing-content nav")).not.toBeNull();
      Result.getOrThrow(history.traverse(-1));
      await shows(() => parent.querySelector(".todos") !== null);
      expect(parent.querySelector(".examples-sidebar")).toBe(sidebar);
      expect(parent.querySelector(".examples-sidebar")).not.toBeNull();
      expect(parent.querySelector(".examples-menu-trigger")?.getAttribute("aria-expanded")).toBe(
        "false",
      );
      expect(
        parent.querySelector('nav[aria-label="Examples navigation"] [aria-current="page"]')
          ?.textContent,
      ).toBe("Todos");
      Result.getOrThrow(history.traverse(1));
      await shows(() => parent.querySelector(".routing-page") !== null);
      press("Queries");
      await shows(() => parent.textContent?.includes("Customer details") === true);
      expect(history.location()).toBe("/examples/queries");
      expect(parent.textContent).toContain("Inbox");
      expect(parent.textContent).toContain("Customer details");
      expect(failures).toEqual([]);
    } finally {
      await Effect.runPromise(Scope.close(scope, Exit.void));
    }
  },
);
