import { mounting } from "@charismaticalli/frappe";
import * as Query from "@charismaticalli/frappe/query";
import { History, type MemoryHistory, memoryHistory } from "@charismaticalli/frappe/router";
import { Cause, Effect, Exit, Layer, Option, Scope } from "effect";
import { App } from "~/app";
import type { AuthState } from "~/auth/model";
import { Auth } from "~/auth/service";
import { pageControls } from "./auth-page-dom.test-helper";
import { makePageAuth } from "./auth-page-driver.test-helper";

const run = Effect.runPromise;
const cleanups: Array<() => Promise<void>> = [];
export const cleanupAuthPages = async () => {
  for (const close of cleanups.splice(0)) await close();
  document.body.replaceChildren();
  localStorage.clear();
};
const mountPage = async (options: {
  scope: Scope.Scope;
  history: MemoryHistory;
  auth: Auth["Service"];
}) => {
  const { scope, history, auth } = options;
  const failures: string[] = [];
  const app = await run(
    mounting({
      scope,
      onError: (failure) => failures.push(`${failure.operation}: ${Cause.pretty(failure.cause)}`),
      resources: Layer.merge(Layer.succeed(Auth, auth), Layer.succeed(History, history)),
    }),
  );
  const partition = await run(app.signal<Option.Option<string>>({ initial: Option.none() }));
  await run(Query.configure({ context: app, partition }));
  const root = document.createElement("div");
  document.body.append(root);
  await run(app.h(root, App(partition)));
  return { root, failures };
};
export const harness = async (
  options: { initial: string; auth: Option.Option<AuthState> } = {
    initial: "/login",
    auth: Option.none(),
  },
) => {
  const scope = await run(Scope.make());
  cleanups.push(() => run(Scope.close(scope, Exit.void)));
  const history = await run(memoryHistory({ initial: options.initial }).pipe(Scope.provide(scope)));
  const { auth, ...controls } = await makePageAuth(options.auth);
  const page = await mountPage({ scope, history, auth });
  return { ...page, history, ...controls, ...pageControls(page) };
};
