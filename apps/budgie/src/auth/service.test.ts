import { Deferred, Effect, Exit, Option, Scope, Stream } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { type AuthState, type Command, toAuthError, authError, identity } from "./model";
import { type AuthDriver, makeAuth } from "./service";

const run = Effect.runPromise;
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
const makeDiscovery = () => {
  const initial = Deferred.makeUnsafe<unknown, unknown>();
  const started = Deferred.makeUnsafe<void>();
  let discovery = initial;
  return {
    initial,
    started: Deferred.await(started),
    initialize: () =>
      Deferred.succeed(started, undefined).pipe(
        Effect.andThen(Deferred.await(discovery)),
        Effect.map(Option.fromNullishOr),
        Effect.mapError(toAuthError),
      ),
    nextDiscovery: () => {
      discovery = Deferred.makeUnsafe<unknown, unknown>();
      return discovery;
    },
  };
};
const makeSessionEvents = () => {
  let receive = Option.none<Parameters<AuthDriver["observe"]>[0]>();
  let unsubscribed = false;
  let disposed = false;
  return {
    observe: (callback: Parameters<AuthDriver["observe"]>[0]) => {
      receive = Option.some(callback);
      return () => {
        unsubscribed = true;
        receive = Option.none();
      };
    },
    dispose: () =>
      Effect.sync(() => {
        disposed = true;
      }),
    unsubscribed: () => unsubscribed,
    disposed: () => disposed,
    emit: (event: { user: unknown }) =>
      Option.match(receive, {
        onNone: () => {},
        onSome: (receive) => receive({ user: Option.fromNullishOr(event.user) }),
      }),
  };
};
const makeCommands = () => {
  let failure = Option.none<unknown>();
  const commands: Command[] = [];
  return {
    commands,
    execute: (command: Command) =>
      Effect.gen(function* () {
        commands.push(command);
        const pending = failure;
        failure = Option.none();
        yield* Option.match(pending, {
          onNone: () => Effect.void,
          onSome: (error) => Effect.fail(toAuthError(error)),
        });
      }),
    failNext: (error: unknown) => {
      failure = Option.some(error);
    },
  };
};
const harness = async () => {
  const discovery = makeDiscovery();
  const events = makeSessionEvents();
  const commands = makeCommands();
  const driver: AuthDriver = {
    initialize: discovery.initialize,
    observe: events.observe,
    execute: commands.execute,
    dispose: events.dispose,
  };
  const scope = await run(Scope.make());
  const close = () => run(Scope.close(scope, Exit.void));
  cleanup.push(close);
  const auth = await run(makeAuth({ driver }).pipe(Scope.provide(scope)));
  await run(discovery.started);
  return { auth, ...discovery, ...events, ...commands, close };
};
const waitFor = (options: {
  auth: Awaited<ReturnType<typeof harness>>["auth"];
  accept: (state: AuthState) => boolean;
}) => run(options.auth.states.pipe(Stream.filter(options.accept), Stream.take(1), Stream.runHead));
const externalUser = (id: string) => ({ id, email: `${id}@example.com` });

describe("auth lifetime", () => {
  it("keeps initialization explicit and prevents stale discovery overwriting newer events", async () => {
    const h = await harness();
    expect((await run(h.auth.current))._tag).toBe("Initializing");
    h.emit({ user: externalUser("B") });
    await run(Deferred.succeed(h.initial, externalUser("A")));
    await waitFor({ auth: h.auth, accept: (s) => s._tag === "Ready" });
    expect(await run(h.auth.current).then(identity)).toEqual(Option.some("B"));
    expect(await run(h.auth.sessions.pipe(Stream.take(1), Stream.runHead))).toEqual(
      Option.some(Option.some({ id: "B", email: Option.some("B@example.com") })),
    );
  });
  it("exposes discovery failure and supports retry without declaring logout", async () => {
    const h = await harness();
    await run(Deferred.fail(h.initial, new Error("offline")));
    const state = await waitFor({ auth: h.auth, accept: (s) => s._tag === "Failed" });
    expect(Option.map(state, (state) => state._tag)).toEqual(Option.some("Failed"));
    const next = h.nextDiscovery();
    await run(Deferred.succeed(next, externalUser("A")));
    await run(h.auth.retry());
    expect(identity(await run(h.auth.current))).toEqual(Option.some("A"));
  });
  it("unsubscribes and stops pending initialization when disposed", async () => {
    const h = await harness();
    await h.close();
    expect(h.unsubscribed()).toBe(true);
    expect(h.disposed()).toBe(true);
    h.emit({ user: externalUser("late") });
    expect((await run(h.auth.current))._tag).toBe("Initializing");
  });
  it("preserves a rapid logout event before a same-user sign-in", async () => {
    const h = await harness();
    await run(Deferred.succeed(h.initial, externalUser("A")));
    await waitFor({ auth: h.auth, accept: (state) => state._tag === "Ready" });
    const observed = run(h.auth.sessions.pipe(Stream.take(3), Stream.runCollect));
    h.emit({ user: null });
    h.emit({ user: externalUser("A") });
    expect((await observed).map((user) => Option.map(user, (user) => user.id))).toEqual([
      Option.some("A"),
      Option.none(),
      Option.some("A"),
    ]);
  });
  it("requests a code without inventing a session and maps expired-code failures", async () => {
    const h = await harness();
    await run(Deferred.succeed(h.initial, null));
    await waitFor({ auth: h.auth, accept: (s) => s._tag === "Ready" });
    await run(h.auth.execute({ _tag: "RequestOtp", email: "new@example.com" }));
    expect(h.commands).toEqual([{ _tag: "RequestOtp", email: "new@example.com" }]);
    expect(identity(await run(h.auth.current))).toEqual(Option.none());
    h.failNext({ code: "otp_expired", message: "Expired" });
    expect(
      await run(
        h.auth
          .execute({ _tag: "VerifyOtp", email: "new@example.com", code: "123456" })
          .pipe(Effect.flip),
      ),
    ).toMatchObject({ kind: "code" });
  });
  it("failed logout preserves identity until a signed-out event", async () => {
    const h = await harness();
    await run(Deferred.succeed(h.initial, externalUser("A")));
    await waitFor({ auth: h.auth, accept: (s) => s._tag === "Ready" });
    h.failNext(new Error("offline"));
    await run(h.auth.execute({ _tag: "Logout" }).pipe(Effect.exit));
    expect(identity(await run(h.auth.current))).toEqual(Option.some("A"));
    h.emit({ user: null });
    await waitFor({ auth: h.auth, accept: (s) => s._tag === "Ready" && Option.isNone(s.user) });
    expect(identity(await run(h.auth.current))).toEqual(Option.none());
  });
  it.each([
    { code: "invalid_credentials", message: "bad", expected: "credentials" },
    { status: 429, message: "limit", expected: "rate-limit" },
  ])("classifies $expected failures", ({ expected, ...error }) => {
    expect(authError(error).kind).toBe(expected);
  });
});
