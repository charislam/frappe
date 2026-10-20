import { Effect, Match } from "effect";
import { toAuthError } from "./model";

export const request = <T extends { error: unknown }>(work: () => PromiseLike<T>) =>
  Effect.tryPromise({ try: () => Promise.resolve(work()), catch: toAuthError }).pipe(
    Effect.flatMap((result) =>
      Match.value(result.error === null).pipe(
        Match.when(true, () => Effect.succeed(result)),
        Match.orElse(() => Effect.fail(toAuthError(result.error))),
      ),
    ),
  );
