import { Cause, Effect, Exit, Layer, Scope } from "effect";
import { expect, it, vi } from "vitest";
import { mounting } from "./framework";
import * as Reactive from "./reactive";
import * as Resource from "./resource";

it("preserves defects and releases resources when initialization fails after acquisition", async () => {
  const scope = await Effect.runPromise(Scope.make());
  let released = 0;
  class Probe extends Resource.Service<Probe, { readonly id: number }>()(
    "resource-runtime-test/Probe",
  ) {}
  const resources = Layer.effect(
    Probe,
    Effect.acquireRelease(Effect.succeed({ id: 1 }), () =>
      Effect.sync(() => {
        released += 1;
      }),
    ),
  );
  const initialization = vi
    .spyOn(Reactive, "makeReactiveRuntime")
    .mockReturnValueOnce(Effect.die("initialization defect"));
  try {
    const exit = await Effect.runPromise(
      mounting({ scope, resources, onError: () => {} }).pipe(Effect.exit),
    );
    expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
    expect(released).toBe(1);
  } finally {
    initialization.mockRestore();
    await Effect.runPromise(Scope.close(scope, Exit.void));
  }
});
