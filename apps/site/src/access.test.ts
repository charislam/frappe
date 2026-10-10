import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { AccessExample } from "./access";
import { harness, rendered } from "./test-helpers";

describe("access example", () => {
  it("demonstrates all access states and preserves reachable controls", async () => {
    const { ctx, parent } = await harness();
    Effect.runSync(ctx.h(parent, AccessExample));
    await rendered({ parent, check: () => parent.querySelectorAll("button").length === 3 });
    const controls = Array.from(
      parent.querySelectorAll<HTMLButtonElement>(".access-controls > button"),
    );
    expect(controls.map((button) => button.textContent)).toEqual(["Unknown", "Denied", "Allowed"]);
    const click = (label: string) =>
      Array.from(parent.querySelectorAll("button"))
        .find((button) => button.textContent === label)
        ?.click();
    expect(parent.querySelector("article")).toBeNull();
    click("Denied");
    await rendered({ parent, check: () => parent.querySelector('[role="alert"]') !== null });
    click("Allowed");
    await rendered({ parent, check: () => parent.querySelector("output")?.textContent === "0" });
    click("Increment page counter");
    await rendered({ parent, check: () => parent.querySelector("output")?.textContent === "1" });
    const article = parent.querySelector("article");
    click("Allowed");
    expect(parent.querySelector("article")).toBe(article);
    click("Unknown");
    await rendered({ parent, check: () => parent.querySelector("article") === null });
    click("Allowed");
    await rendered({ parent, check: () => parent.querySelector("output")?.textContent === "0" });
    expect(Array.from(parent.querySelectorAll('.access-controls > button[type="button"]'))).toEqual(
      controls,
    );
  });
});
