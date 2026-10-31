import { Match, Option } from "effect";
import { describe, expect, it } from "vitest";
import { type AuthState } from "~/auth/model";
import { type Destination, destination, targetFor, targetOf, urls } from "./routes";
import { type State, transition } from "./transitions";

const ready = (signedIn: boolean): AuthState => ({
  _tag: "Ready",
  user: Match.value(signedIn).pipe(
    Match.when(true, () => Option.some({ id: "A", email: Option.some("a@example.com") })),
    Match.orElse(() => Option.none()),
  ),
});
const initial: State = {
  auth: { _tag: "Initializing" },
  target: targetOf("Home"),
  view: { _tag: "Loading" },
};
const navigate = (options: { auth: AuthState; tag: Exclude<Destination["_tag"], "Budget"> }) =>
  transition({
    state: transition({
      state: initial,
      event: { _tag: "Application", event: { _tag: "Auth", auth: options.auth } },
    }).state,
    event: {
      _tag: "Navigate",
      target: targetFor(destination(options.tag)),
      mode: "push",
    },
  });
describe("auth-aware navigation", () => {
  it("waits for initialization on protected routes", () => {
    for (const tag of ["New"] as const)
      expect(navigate({ auth: initial.auth, tag }).state.view._tag).toBe("Loading");
  });
  it("replaces automatic redirects and never mounts protected content signed out", () => {
    expect(navigate({ auth: ready(false), tag: "New" })).toMatchObject({
      state: { view: { _tag: "Login" } },
      history: { _tag: "Replace", destination: { _tag: "Login" } },
    });
    expect(navigate({ auth: ready(true), tag: "Login" })).toMatchObject({
      state: { view: { _tag: "Workspace" } },
      history: { _tag: "Replace" },
    });
  });
  it("keeps unknown pages accessible and preserves browser traversal", () => {
    const result = transition({
      state: { ...initial, auth: ready(false) },
      event: {
        _tag: "Location",
        target: urls.parse("/missing"),
        observed: "/missing",
        initial: false,
      },
    });
    expect(result.state.view).toEqual({ _tag: "NotFound", home: "/login" });
    expect(result.history._tag).toBe("Keep");
    const traversal = transition({
      state: { ...initial, auth: ready(true) },
      event: {
        _tag: "Location",
        target: targetOf("New"),
        observed: "/new",
        initial: false,
      },
    });
    expect(traversal.history._tag).toBe("Keep");
    expect(traversal.state.view._tag).toBe("Workspace");
  });
  it.each(["Login", "VerifyCode"] as const)(
    "admits signed-out %s visits and applies authentication guards",
    (tag) => {
      expect(navigate({ auth: ready(false), tag }).state.view._tag).toBe(tag);
      expect(navigate({ auth: ready(true), tag }).state.view._tag).toBe("Workspace");
      expect(navigate({ auth: initial.auth, tag }).state.view._tag).toBe("Loading");
    },
  );
  it("auth changes re-evaluate the current route", () => {
    const state = navigate({
      auth: ready(true),
      tag: "New",
    }).state;
    expect(
      transition({
        state,
        event: {
          _tag: "Application",
          event: { _tag: "Auth", auth: ready(false) },
        },
      }).state.view._tag,
    ).toBe("Login");
  });
});
