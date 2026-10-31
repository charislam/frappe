import type { SupabaseClient } from "@supabase/supabase-js";
import { Effect, Match } from "effect";
import type { Command } from "./model";
import { request } from "./supabase-request";

export const makeExecute = (auth: SupabaseClient["auth"]) =>
  Effect.fn("Supabase.execute")((command: Command) =>
    Match.value(command).pipe(
      Match.tag("RequestOtp", ({ email }) =>
        request(() => auth.signInWithOtp({ email, options: { shouldCreateUser: true } })),
      ),
      Match.tag("VerifyOtp", ({ email, code }) =>
        request(() => auth.verifyOtp({ email, token: code, type: "email" })),
      ),
      Match.tag("Logout", () => request(() => auth.signOut())),
      Match.exhaustive,
      Effect.asVoid,
    ),
  );
