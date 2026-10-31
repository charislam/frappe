import type { NavigationDecision, NavigationEvent } from "@charismaticalli/frappe/router";
import { type Data, Match, Option } from "effect";
import type { AuthState, User } from "~/auth/model";
import type { BudgetId } from "~/budget/model";
import {
  type Destination,
  type Target,
  loginDestination,
  returnDestination,
  targetFor,
  urls,
} from "./routes";

export type WorkspacePage = Data.TaggedEnum<{
  Home: {};
  New: {};
  Budget: { readonly budgetId: BudgetId };
}>;

export type View =
  | { readonly _tag: "Loading" }
  | { readonly _tag: "Failed"; readonly message: string }
  | { readonly _tag: "Login"; readonly returnTo: Option.Option<string> }
  | {
      readonly _tag: "VerifyCode";
      readonly email: Option.Option<string>;
      readonly returnTo: Option.Option<string>;
    }
  | {
      readonly _tag: "Workspace";
      readonly user: User;
      readonly page: WorkspacePage;
    }
  | { readonly _tag: "NotFound"; readonly home: string };
export interface State {
  readonly auth: AuthState;
  readonly target: Target;
  readonly view: View;
}
export type AppEvent = { readonly _tag: "Auth"; readonly auth: AuthState };
type Decision = NavigationDecision<State, Destination>;
const admit = (options: {
  state: State;
  target: Target;
  history: Decision["history"];
}): Decision => {
  const { state, target, history } = options;
  const show = (view: View): Decision => ({
    state: {
      ...state,
      target,
      view,
    },
    history,
  });
  const redirect = (destination: Destination): Decision =>
    admit({ state, target: targetFor(destination), history: { _tag: "Replace", destination } });
  return Match.value(state.auth).pipe(
    Match.tag("Initializing", () => show({ _tag: "Loading" })),
    Match.tag("Failed", ({ error }) => show({ _tag: "Failed", message: error.message })),
    Match.tag("Ready", ({ user }) =>
      Match.value(target).pipe(
        Match.tag("Matched", ({ destination: requested, original }) =>
          Option.match(user, {
            onSome: (user) =>
              Match.value(requested).pipe(
                Match.tag("Home", "New", "Budget", (requested) =>
                  show({
                    _tag: "Workspace",
                    user,
                    page: Match.value(requested).pipe(
                      Match.tag("Home", "New", ({ _tag }): WorkspacePage => ({ _tag })),
                      Match.tag("Budget", ({ params }): WorkspacePage => ({
                        _tag: "Budget",
                        budgetId: params.id,
                      })),
                      Match.exhaustive,
                    ),
                  }),
                ),
                Match.tag("Login", "VerifyCode", ({ query }) =>
                  redirect(returnDestination(query.returnTo)),
                ),
                Match.exhaustive,
              ),
            onNone: () =>
              Match.value(requested).pipe(
                Match.tag("Login", ({ query }) => show({ _tag: "Login", ...query })),
                Match.tag("VerifyCode", ({ query }) => show({ _tag: "VerifyCode", ...query })),
                Match.orElse(() => redirect(loginDestination(Option.some(original)))),
              ),
          }),
        ),
        Match.orElse(() =>
          show({
            _tag: "NotFound",
            home: Option.match(user, { onNone: () => "/login", onSome: () => "/" }),
          }),
        ),
      ),
    ),
    Match.exhaustive,
  );
};
export const transition = (options: {
  state: State;
  event: NavigationEvent<typeof urls.definitions, AppEvent>;
}): Decision => {
  const { state, event } = options;
  return Match.value(event).pipe(
    Match.tag("Application", ({ event }) =>
      Match.value(event).pipe(
        Match.tag("Auth", ({ auth }) =>
          admit({
            state: {
              ...state,
              auth,
            },
            target: state.target,
            history: { _tag: "Keep" },
          }),
        ),
        Match.exhaustive,
      ),
    ),
    Match.tag("Location", ({ target }) => admit({ state, target, history: { _tag: "Keep" } })),
    Match.tag("Navigate", ({ target, mode }) =>
      admit({
        state,
        target,
        history: {
          _tag: Match.value(mode).pipe(
            Match.when("push", () => "Push" as const),
            Match.when("replace", () => "Replace" as const),
            Match.exhaustive,
          ),
          destination: target.destination,
        },
      }),
    ),
    Match.exhaustive,
  );
};
