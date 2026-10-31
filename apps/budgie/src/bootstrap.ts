import { type MountFailure, mounting, provideContext } from "@charismaticalli/frappe";
import * as Query from "@charismaticalli/frappe/query";
import { History, browserHistory } from "@charismaticalli/frappe/router";
import { Effect, Layer, Option } from "effect";
import { Auth, makeAuth } from "~/auth/service";
import { supabaseClient, supabaseDriver } from "~/auth/supabase";
import { Queries } from "~/context";
import { App } from "./app";
import { preferencesLayer } from "./budget/preferences";
import { Budgets, makeBudgets } from "./budget/service";
import { configuration } from "./config";

export const bootstrap = Effect.fn("Budgie.bootstrap")(function* (
  onError: (failure: MountFailure) => void,
) {
  const config = yield* configuration;
  const root = yield* Option.match(Option.fromNullishOr(document.getElementById("app")), {
    onNone: () => Effect.die(new Error("Budgie requires #app")),
    onSome: Effect.succeed,
  });
  const client = supabaseClient(config);
  const auth = yield* makeAuth({ driver: supabaseDriver(client) });
  const app = yield* mounting({
    scope: yield* Effect.scope,
    onError,
    resources: Layer.mergeAll(
      Layer.succeed(Budgets, makeBudgets(client)),
      preferencesLayer(() => window.localStorage),
      Layer.succeed(Auth, auth),
      Layer.effect(History, browserHistory(window)),
    ),
  });
  const partition = yield* app.signal<Option.Option<string>>({ initial: Option.none() });
  const queries = yield* Query.configure({ context: app, partition });
  yield* app.h(root, provideContext({ key: Queries, value: queries, child: App(partition) }));
  yield* Effect.never;
}, Effect.scoped);
