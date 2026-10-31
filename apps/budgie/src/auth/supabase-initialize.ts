import type { SupabaseClient } from "@supabase/supabase-js";
import { Effect, Match, Option } from "effect";
import { AuthError } from "./model";
import { request } from "./supabase-request";

type Auth = SupabaseClient["auth"];
const discoverUser = Effect.fn("Supabase.discoverUser")(function* (auth: Auth) {
  const { data } = yield* request(() => auth.getSession());
  return Option.map(Option.fromNullishOr(data.session), (session) => session.user);
});
const readCallback = (location: URL) => ({
  code: Option.fromNullishOr(location.searchParams.get("code")),
  error: Option.fromNullishOr(location.searchParams.get("error_description")).pipe(
    Option.orElse(() =>
      Option.fromNullishOr(new URLSearchParams(location.hash.slice(1)).get("error_description")),
    ),
  ),
});
const validateCallback = (error: Option.Option<string>) =>
  Option.match(error, {
    onNone: () => Effect.void,
    onSome: () =>
      Effect.fail(
        new AuthError({
          kind: "callback",
          message:
            "The authentication link was rejected or expired. Return to sign in and request a new link.",
        }),
      ),
  });
const exchangeCode = Effect.fn("Supabase.exchangeCode")((options: { auth: Auth; code: string }) =>
  request(() => options.auth.exchangeCodeForSession(options.code)).pipe(
    Effect.asVoid,
    Effect.mapError(
      () =>
        new AuthError({
          kind: "callback",
          message:
            "This link is expired, already used, or belongs to another browser. Restart sign in in this browser.",
        }),
    ),
  ),
);
const validateRestoredSession = Effect.fn("Supabase.validateRestoredSession")(function* (options: {
  auth: Auth;
  location: URL;
}) {
  const user = yield* discoverUser(options.auth);
  yield* Match.value(options.location.pathname === "/auth/callback" || Option.isNone(user)).pipe(
    Match.when(true, () =>
      Effect.fail(
        new AuthError({
          kind: "callback",
          message:
            "No usable authentication link was found. Return to sign in and request a new link.",
        }),
      ),
    ),
    Match.orElse(() => Effect.void),
  );
});
const processCallback = Effect.fn("Supabase.processCallback")(function* (options: {
  auth: Auth;
  location: URL;
  cleanCallback: () => void;
}) {
  const { code, error } = readCallback(options.location);
  yield* Effect.sync(options.cleanCallback);
  yield* validateCallback(error);
  yield* Option.match(code, {
    onSome: (code) => exchangeCode({ auth: options.auth, code }),
    onNone: () => validateRestoredSession(options),
  });
});
export const makeInitialize = (options: {
  auth: Auth;
  location: URL;
  cleanCallback: () => void;
}) => {
  const callbackPage = options.location.pathname === "/auth/callback";
  let exchanged = false;
  return Effect.fn("Supabase.initialize")(function* () {
    yield* Match.value(callbackPage && !exchanged).pipe(
      Match.when(true, () =>
        processCallback(options).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              exchanged = true;
            }),
          ),
        ),
      ),
      Match.orElse(() => Effect.void),
    );
    return yield* discoverUser(options.auth);
  });
};
