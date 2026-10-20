import type { SupabaseClient } from "@supabase/supabase-js";
import { Effect, Match } from "effect";
import { AuthError, type Command } from "./model";
import type { AuthDriver } from "./service";
import { request } from "./supabase-request";

export const makeExecute = (options: {
  auth: SupabaseClient["auth"];
  callback: string;
  reset: string;
  githubAvailable: AuthDriver["githubAvailable"];
}) => {
  return Effect.fn("Supabase.execute")((command: Command) =>
    Match.value(command).pipe(
      Match.tag("Password", ({ credentials }) =>
        request(() => options.auth.signInWithPassword(credentials)).pipe(
          Effect.as({ confirmationPending: false }),
        ),
      ),
      Match.tag("Signup", ({ credentials }) =>
        request(() =>
          options.auth.signUp({ ...credentials, options: { emailRedirectTo: options.callback } }),
        ).pipe(Effect.map(({ data }) => ({ confirmationPending: data.session === null }))),
      ),
      Match.tag("RequestOtp", ({ email, intent }) =>
        request(() =>
          options.auth.signInWithOtp({
            email,
            options: { shouldCreateUser: intent === "signup", emailRedirectTo: options.callback },
          }),
        ).pipe(Effect.as({ confirmationPending: false })),
      ),
      Match.tag("VerifyOtp", ({ email, code }) =>
        request(() => options.auth.verifyOtp({ email, token: code, type: "email" })).pipe(
          Effect.as({ confirmationPending: false }),
        ),
      ),
      Match.tag("ResendConfirmation", ({ email }) =>
        request(() =>
          options.auth.resend({
            type: "signup",
            email,
            options: { emailRedirectTo: options.callback },
          }),
        ).pipe(Effect.as({ confirmationPending: true })),
      ),
      Match.tag("Github", () =>
        Effect.gen(function* () {
          const enabled = yield* options.githubAvailable();
          yield* Match.value(enabled).pipe(
            Match.when(false, () =>
              Effect.fail(
                new AuthError({
                  kind: "provider",
                  message:
                    "GitHub sign in is unavailable. Configure local GitHub OAuth credentials, or use email.",
                }),
              ),
            ),
            Match.orElse(() => Effect.void),
          );
          yield* request(() =>
            options.auth.signInWithOAuth({
              provider: "github",
              options: { redirectTo: options.callback },
            }),
          );
          return { confirmationPending: false };
        }),
      ),
      Match.tag("RequestRecovery", ({ email }) =>
        request(() =>
          options.auth.resetPasswordForEmail(email, { redirectTo: options.reset }),
        ).pipe(Effect.as({ confirmationPending: false })),
      ),
      Match.tag("UpdatePassword", ({ password }) =>
        request(() => options.auth.updateUser({ password })).pipe(
          Effect.as({ confirmationPending: false }),
        ),
      ),
      Match.tag("Logout", () =>
        request(() => options.auth.signOut()).pipe(Effect.as({ confirmationPending: false })),
      ),
      Match.exhaustive,
    ),
  );
};
