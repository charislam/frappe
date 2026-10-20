import type { WritableSignal } from "@charismaticalli/frappe";
import { Effect, type Option } from "effect";
import { type AuthState, identity } from "./model";

export const applyAuth = Effect.fn("Auth.applyPartition")(function* <E>(options: {
  state: AuthState;
  partition: WritableSignal<Option.Option<string>>;
  admit: () => Effect.Effect<void, E>;
}) {
  yield* options.partition.set(identity(options.state));
  yield* options.admit();
});
