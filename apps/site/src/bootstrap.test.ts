import { Cause, Effect, Exit } from "effect";
import { expect, it } from "vitest";
import { bootstrap } from "./bootstrap";

it("fails clearly without the existing app root", async () => {
  document.body.replaceChildren();
  const exit = await Effect.runPromise(bootstrap(() => {}).pipe(Effect.exit));
  expect(Exit.isFailure(exit)).toBe(true);
  Exit.match(exit, {
    onSuccess: () => {
      throw new Error("Expected missing-root failure");
    },
    onFailure: (cause) => expect(Cause.pretty(cause)).toContain('id="app"'),
  });
  expect(document.getElementById("app")).toBeNull();
});
