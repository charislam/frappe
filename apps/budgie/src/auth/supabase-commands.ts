import type { SupabaseClient } from "@supabase/supabase-js";
import { Effect, Match } from "effect";
import type { Command } from "./model";
import { request } from "./supabase-request";

export const makeExecute = (options: { auth: SupabaseClient["auth"]; callback: string }) => {
  return Effect.fn("Supabase.execute")((command: Command) =>
    Match.value(command).pipe(
      Match.tag("RequestOtp", ({ email, intent }) =>
        request(() =>
          options.auth.signInWithOtp({
            email,
            options: { shouldCreateUser: intent === "signup", emailRedirectTo: options.callback },
          }),
        ).pipe(Effect.asVoid),
      ),
      Match.tag("VerifyOtp", ({ email, code }) =>
        request(() => options.auth.verifyOtp({ email, token: code, type: "email" })).pipe(
          Effect.asVoid,
        ),
      ),
      Match.tag("Logout", () => request(() => options.auth.signOut()).pipe(Effect.asVoid)),
      Match.exhaustive,
    ),
  );
};
