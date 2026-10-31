import { type MountFailure, mounting } from "@charismaticalli/frappe";
import * as Query from "@charismaticalli/frappe/query";
import { History, browserHistory } from "@charismaticalli/frappe/router";
import { Effect, Layer, Option } from "effect";
import { Auth, makeAuth } from "~/auth/service";
import { supabaseDriver } from "~/auth/supabase";
import { App } from "./app";
import { configuration } from "./config";

export const bootstrap = Effect.fn("Budgie.bootstrap")(function* (
  onError: (failure: MountFailure) => void,
) {
  const config = yield* configuration;
  const root = yield* Option.match(Option.fromNullishOr(document.getElementById("app")), {
    onNone: () => Effect.die(new Error("Budgie requires #app")),
    onSome: Effect.succeed,
  });
  const auth = yield* makeAuth({ driver: supabaseDriver(config) });
  const app = yield* mounting({
    scope: yield* Effect.scope,
    onError,
    resources: Layer.merge(
      Layer.succeed(Auth, auth),
      Layer.effect(History, browserHistory(window)),
    ),
  });
  const partition = yield* app.signal<Option.Option<string>>({ initial: Option.none() });
  yield* Query.configure({ context: app, partition });
  yield* app.h(root, App(partition));
  yield* Effect.never;
}, Effect.scoped);
