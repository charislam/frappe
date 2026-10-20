import { Deferred, Effect, Option, Stream, SubscriptionRef } from "effect";
import { type AuthError, type AuthState, type Command } from "~/auth/model";
import { Auth } from "~/auth/service";

const run = Effect.runPromise;
export const makePageAuth = async (initial: Option.Option<AuthState>) => {
  const states = await run(
    SubscriptionRef.make<AuthState>(
      Option.getOrElse(initial, () => ({
        _tag: "Ready",
        user: Option.none(),
      })),
    ),
  );
  const commands: Command[] = [];
  let nextFailure = Option.none<AuthError>();
  let pending = Option.none<Deferred.Deferred<void>>();
  const auth = Auth.of({
    states: SubscriptionRef.changes(states),
    sessions: Stream.succeed(Option.none()),
    current: SubscriptionRef.get(states),
    retry: () => Effect.void,
    githubAvailable: Effect.succeed(false),
    execute: (command) =>
      Effect.gen(function* () {
        commands.push(command);
        const wait = pending;
        pending = Option.none();
        yield* Option.match(wait, { onNone: () => Effect.void, onSome: Deferred.await });
        const failure = nextFailure;
        nextFailure = Option.none();
        yield* Option.match(failure, { onNone: () => Effect.void, onSome: Effect.fail });
        return { confirmationPending: command._tag === "Signup" };
      }),
  });
  return {
    auth,
    commands,
    publish: (state: AuthState) => run(SubscriptionRef.set(states, state)),
    failNext: (error: AuthError) => {
      nextFailure = Option.some(error);
    },
    holdNext: () => {
      const deferred = Deferred.makeUnsafe<void>();
      pending = Option.some(deferred);
      return deferred;
    },
  };
};
