import { Effect, Match, Option, Stream, SubscriptionRef } from "effect";
import { AuthError, type AuthState, type User, decodeUser } from "./model";

export interface SessionEvent {
  readonly user: Option.Option<unknown>;
}
const userFrom = Effect.fn("Auth.decodeUser")(function* (value: Option.Option<unknown>) {
  return yield* Option.match(value, {
    onNone: () => Effect.succeed(Option.none<User>()),
    onSome: (value) =>
      decodeUser(value).pipe(
        Effect.map((user) =>
          Option.some({ id: user.id, email: Option.fromUndefinedOr(user.email) }),
        ),
        Effect.mapError(
          () =>
            new AuthError({ kind: "other", message: "Authentication returned an invalid user." }),
        ),
      ),
  });
});
const userOf = (state: AuthState) =>
  Match.value(state).pipe(
    Match.tag("Ready", ({ user }) => user),
    Match.orElse(() => Option.none<User>()),
  );

export const makeSession = Effect.fn("Auth.makeSession")(function* () {
  const state = yield* SubscriptionRef.make<AuthState>({ _tag: "Initializing" });
  const accept = Effect.fn("Auth.accept")(function* (value: Option.Option<unknown>) {
    const user = yield* userFrom(value);
    yield* SubscriptionRef.set(state, { _tag: "Ready", user });
  });
  return {
    states: SubscriptionRef.changes(state),
    sessions: SubscriptionRef.changes(state).pipe(Stream.map(userOf)),
    current: SubscriptionRef.get(state),
    initializing: SubscriptionRef.set(state, { _tag: "Initializing" }),
    fail: (error: AuthError) => SubscriptionRef.set(state, { _tag: "Failed", error }),
    accept,
  };
});
export type Session = Effect.Success<ReturnType<typeof makeSession>>;
