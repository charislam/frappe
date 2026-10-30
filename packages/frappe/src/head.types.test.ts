import { expectTypeOf, it } from "vitest";
import type { ReactiveError } from "~/reactive/runtime";
import type { ComponentContext, Signal } from "./framework";
import * as Head from "./head";
import type { Sync } from "./sync";

it("requires an explicit capability and accepts complete static or reactive metadata", () => {
  const proof = (options: {
    context: ComponentContext;
    parent: Head.Handle;
    signal: Signal<Head.Metadata>;
  }) => {
    expectTypeOf(
      Head.child({ context: options.context, parent: options.parent, metadata: options.signal }),
    ).toEqualTypeOf<Sync<Head.Handle, ReactiveError>>();
    Head.child({
      context: options.context,
      parent: options.parent,
      metadata: { title: Head.clear },
    });
    // @ts-expect-error Clearing requires the explicit public utility.
    Head.child({ context: options.context, parent: options.parent, metadata: { title: null } });
    // @ts-expect-error Widgets without a passed handle cannot declare child metadata.
    Head.child({ context: options.context, metadata: {} });
    // @ts-expect-error A structural copy cannot manufacture a capability.
    Head.child({ context: options.context, parent: {}, metadata: {} });
  };
  expectTypeOf(proof).toBeFunction();
});
