import { Effect, Schema } from "effect";
import { toAuthError } from "./model";

export const makeGithubAvailability = (options: { url: string; key: string }) =>
  Effect.fn("Supabase.githubAvailable")(function* () {
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(new URL("/auth/v1/settings", options.url), { headers: { apikey: options.key } }),
      catch: toAuthError,
    });
    const json = yield* Effect.tryPromise({ try: () => response.json(), catch: toAuthError });
    const settings = yield* Schema.decodeUnknownEffect(
      Schema.Struct({ external: Schema.Struct({ github: Schema.Boolean }) }),
    )(json).pipe(Effect.mapError(toAuthError));
    return settings.external.github;
  });
