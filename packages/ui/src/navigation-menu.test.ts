import { Sync, component } from "@charismaticalli/frappe";
import { Effect, Option } from "effect";
import { describe, expect, it } from "vitest";
import * as NavigationMenu from "./navigation-menu";
import { harness, rendered } from "./test-helpers";

const fixture = async () => {
  const h = await harness();
  document.body.append(h.parent);
  const demo = component((context) =>
    Sync.gen(function* () {
      const menu = yield* NavigationMenu.make({ context, initialOpen: false });
      const trigger = yield* context.he("button", { children: ["Menu"] });
      const nav = yield* context.he("nav", {
        attrs: { "aria-label": Option.some("Main") },
        children: [yield* context.he("a", { children: ["Home"] })],
      });
      yield* menu.attach({ trigger, menu: nav });
      return { setup: () => Effect.succeed([trigger, nav]) };
    }),
  );
  Effect.runSync(h.ctx.h(h.target, [demo]));
  await rendered({ parent: h.parent, check: () => h.parent.querySelector("nav") !== null });
  const trigger = h.parent.querySelector("button") ?? document.createElement("button");
  const nav = h.parent.querySelector("nav") ?? document.createElement("nav");
  const link = nav.querySelector("a") ?? document.createElement("a");
  return { ...h, trigger, nav, link };
};

describe("headless navigation menu", () => {
  it("wires aria and data-state and toggles from the trigger", async () => {
    const { parent, trigger, nav } = await fixture();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.getAttribute("aria-controls")).toBe(nav.id);
    expect(nav.dataset["state"]).toBe("closed");
    trigger.click();
    await rendered({ parent, check: () => nav.dataset["state"] === "open" });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    trigger.click();
    await rendered({ parent, check: () => nav.dataset["state"] === "closed" });
  });

  it("closes on Escape with focus restore, on selection and on outside pointer", async () => {
    const { parent, trigger, nav, link } = await fixture();
    trigger.click();
    await rendered({ parent, check: () => nav.dataset["state"] === "open" });
    link.focus();
    link.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
    await rendered({ parent, check: () => nav.dataset["state"] === "closed" });
    expect(document.activeElement).toBe(trigger);
    trigger.click();
    await rendered({ parent, check: () => nav.dataset["state"] === "open" });
    link.addEventListener("click", (event) => event.preventDefault());
    link.click();
    await rendered({ parent, check: () => nav.dataset["state"] === "closed" });
    trigger.click();
    await rendered({ parent, check: () => nav.dataset["state"] === "open" });
    const outside = document.createElement("button");
    parent.append(outside);
    outside.dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true }));
    await rendered({ parent, check: () => nav.dataset["state"] === "closed" });
  });
});
