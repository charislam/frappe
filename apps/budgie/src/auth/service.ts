import { Resource } from "@charismaticalli/frappe";
import { Effect, Layer, Option } from "effect";
import { type AuthError, type Command } from "./model";
import { type SessionEvent, makeSession } from "./session";
import { synchronizeSession } from "./session-sync";

export interface AuthDriver {
  readonly initialize: () => Effect.Effect<Option.Option<unknown>, AuthError>;
  readonly observe: (receive: (event: SessionEvent) => void) => () => void;
  readonly execute: (command: Command) => Effect.Effect<void, AuthError>;
  readonly dispose: () => Effect.Effect<void>;
}
export const makeAuth = Effect.fn("Auth.make")(function* (options: { driver: AuthDriver }) {
  const { driver } = options;
  const session = yield* makeSession();
  const retry = yield* synchronizeSession({ driver, session });
  return {
    states: session.states,
    sessions: session.sessions,
    current: session.current,
    retry,
    execute: Effect.fn("Auth.execute")((command: Command) => driver.execute(command)),
  };
});
export class Auth extends Resource.Service<Auth, Effect.Success<ReturnType<typeof makeAuth>>>()(
  "budgie/Auth",
) {}
export const authLayer = (options: { driver: AuthDriver }) => Layer.effect(Auth, makeAuth(options));
