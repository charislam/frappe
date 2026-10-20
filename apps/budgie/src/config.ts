import { Config, Effect, Schema } from "effect";

const HttpUrl = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((value) => {
      try {
        return ["http:", "https:"].includes(new URL(value).protocol);
      } catch {
        return false;
      }
    }),
  ),
);
export const configuration = Effect.gen(function* () {
  const url = yield* Config.schema(HttpUrl, "VITE_SUPABASE_URL");
  const key = yield* Config.schema(Schema.NonEmptyString, "VITE_SUPABASE_PUBLISHABLE_KEY");
  return { url, key };
});
