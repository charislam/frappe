import { createClient } from "@supabase/supabase-js";
import { Effect, Option } from "effect";
import type { AuthDriver } from "./service";
import { makeExecute } from "./supabase-commands";
import { request } from "./supabase-request";

export const supabaseDriver = (options: { url: string; key: string }): AuthDriver => {
  const client = createClient(options.url, options.key, {
    auth: {
      flowType: "pkce",
      detectSessionInUrl: false,
      persistSession: true,
      autoRefreshToken: true,
    },
  });
  return {
    initialize: Effect.fn("Supabase.initialize")(function* () {
      const { data } = yield* request(() => client.auth.getSession());
      return Option.map(Option.fromNullishOr(data.session), (session) => session.user);
    }),
    execute: makeExecute(client.auth),
    observe: (receive) => {
      const { data } = client.auth.onAuthStateChange((_event, session) =>
        receive({ user: Option.map(Option.fromNullishOr(session), (session) => session.user) }),
      );
      return () => data.subscription.unsubscribe();
    },
    dispose: () => Effect.promise(() => client.auth.dispose()),
  };
};
