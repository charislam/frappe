import { type MountFailure, mounting, provideContext } from "@charismaticalli/frappe";
import * as Query from "@charismaticalli/frappe/query";
import { History, browserHistory } from "@charismaticalli/frappe/router";
import { Effect, Layer, Option } from "effect";
import { mockResources } from "~/routing-demo/resources";
import { App } from "./app";
import { AuthLive } from "./auth";
import { LocalStorageLive } from "./local-storage";
import { QueryDemoSession, queryDemoResources } from "./query-demo";

/** Remains alive until interrupted, then awaits disposal of the application. */
export const bootstrap = Effect.fn("frappe.bootstrap")(function* (
  onError: (failure: MountFailure) => void,
) {
  const root = yield* Option.match(Option.fromNullishOr(document.getElementById("app")), {
    onNone: () => Effect.die(new Error('frappé requires an existing root element with id="app"')),
    onSome: Effect.succeed,
  });
  const scope = yield* Effect.scope;
  const app = yield* mounting({
    scope,
    onError,
    resources: Layer.mergeAll(
      AuthLive,
      queryDemoResources,
      LocalStorageLive,
      mockResources,
      Layer.effect(History, browserHistory(window)),
    ),
  });
  const partition = yield* app.signal({ initial: Option.some("guest") });
  yield* Query.configure({ context: app, partition });
  yield* app.h(root, provideContext({ key: QueryDemoSession, value: partition, child: App }));
  yield* Effect.never;
}, Effect.scoped);
