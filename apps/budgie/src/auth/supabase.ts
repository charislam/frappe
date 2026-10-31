import { createClient } from "@supabase/supabase-js";
import { Effect, Option } from "effect";
import type { AuthDriver } from "./service";
import { makeExecute } from "./supabase-commands";
import { makeInitialize } from "./supabase-initialize";

export const supabaseDriver = (options: {
  url: string;
  key: string;
  location: URL;
  cleanCallback: () => void;
}): AuthDriver => {
  const client = createClient(options.url, options.key, {
    auth: {
      flowType: "pkce",
      detectSessionInUrl: false,
      persistSession: true,
      autoRefreshToken: true,
    },
  });
  return {
    initialize: makeInitialize({
      auth: client.auth,
      location: options.location,
      cleanCallback: options.cleanCallback,
    }),
    execute: makeExecute({
      auth: client.auth,
      callback: new URL("/auth/callback", options.location.origin).href,
    }),
    observe: (receive) => {
      const { data } = client.auth.onAuthStateChange((_event, session) =>
        receive({ user: Option.map(Option.fromNullishOr(session), (session) => session.user) }),
      );
      return () => data.subscription.unsubscribe();
    },
    dispose: () => Effect.promise(() => client.auth.dispose()),
  };
};
