import { Match, Option, Schema } from "effect";

export const User = Schema.Struct({ id: Schema.String, email: Schema.Option(Schema.String) });
export interface User extends Schema.Schema.Type<typeof User> {}
export const ExternalUser = Schema.Struct({
  id: Schema.NonEmptyString,
  email: Schema.optionalKey(Schema.String),
});
export const decodeUser = (value: unknown) => Schema.decodeUnknownEffect(ExternalUser)(value);
export class AuthError extends Schema.TaggedError<AuthError>()("AuthError", {
  kind: Schema.Literals([
    "code",
    "rate-limit",
    "transport",
    "callback",
    "other",
  ]),
  message: Schema.String,
}) {}
export const authError = (cause: unknown): AuthError => {
  const detail = Schema.decodeUnknownOption(
    Schema.Struct({
      message: Schema.String,
      code: Schema.optionalKey(Schema.String),
      status: Schema.optionalKey(Schema.Number),
    }),
  )(cause);
  return Option.match(detail, {
    onNone: () =>
      new AuthError({
        kind: "transport",
        message: "Unable to reach authentication. Check your connection, then retry.",
      }),
    onSome: ({ code, status, message }) =>
      Match.value({ code, status }).pipe(
        Match.when(
          { code: "invalid_credentials" },
          () =>
            new AuthError({
              kind: "code",
              message: "This code is invalid or expired. Request a new code.",
            }),
        ),
        Match.when(
          { code: "otp_expired" },
          () =>
            new AuthError({
              kind: "code",
              message: "This code is invalid or expired. Request a new code.",
            }),
        ),
        Match.when(
          { status: 429 },
          () =>
            new AuthError({
              kind: "rate-limit",
              message: "Too many attempts. Wait before trying again.",
            }),
        ),
        Match.when(
          ({ status }) => status === 0,
          () =>
            new AuthError({
              kind: "transport",
              message: "Authentication is unavailable. Check your connection and retry.",
            }),
        ),
        Match.orElse(() => new AuthError({ kind: "other", message })),
      ),
  });
};
export type AuthState =
  | { readonly _tag: "Initializing" }
  | { readonly _tag: "Failed"; readonly error: AuthError }
  | {
      readonly _tag: "Ready";
      readonly user: Option.Option<User>;
    };
export const identity = (state: AuthState): Option.Option<string> =>
  Match.value(state).pipe(
    Match.tag("Ready", ({ user }) => Option.map(user, (user) => user.id)),
    Match.orElse(() => Option.none()),
  );
export type Command =
  | { readonly _tag: "RequestOtp"; readonly email: string; readonly intent: "signin" | "signup" }
  | { readonly _tag: "VerifyOtp"; readonly email: string; readonly code: string }
  | { readonly _tag: "Logout" };

export const toAuthError = (cause: unknown): AuthError =>
  Match.value(cause).pipe(
    Match.when(
      (cause: unknown): cause is AuthError => cause instanceof AuthError,
      (cause) => cause,
    ),
    Match.orElse(authError),
  );
