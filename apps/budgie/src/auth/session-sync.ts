import { Effect, Match, Option, Queue, Stream } from "effect";
import type { AuthDriver } from "./service";
import type { Session, SessionEvent } from "./session";

const observeSessions = Effect.fn("Auth.observeSessions")(function* (driver: AuthDriver) {
  const events = yield* Queue.unbounded<SessionEvent & { readonly revision: number }>();
  let revision = 0;
  let latest = Option.none<SessionEvent>();
  const unsubscribe = driver.observe((event) => {
    revision += 1;
    latest = Option.some(event);
    Queue.offerUnsafe(events, { ...event, revision });
  });
  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      unsubscribe();
      yield* driver.dispose();
    }),
  );
  return {
    events: Stream.fromQueue(events),
    snapshot: () => ({ revision, latest }),
  };
});

export const synchronizeSession = Effect.fn("Auth.synchronizeSession")(function* (options: {
  driver: AuthDriver;
  session: Session;
}) {
  const { driver, session } = options;
  const source = yield* observeSessions(driver);
  let initialized = false;
  let acceptedRevision = 0;
  const retry = Effect.fn("Auth.initialize")(function* () {
    initialized = false;
    yield* session.initializing;
    const started = source.snapshot().revision;
    yield* driver.initialize().pipe(
      Effect.flatMap((user) => {
        const { revision, latest } = source.snapshot();
        acceptedRevision = revision;
        const discovered = Match.value(started === revision).pipe(
          Match.when(true, () => user),
          Match.orElse(() =>
            Option.match(latest, { onNone: () => user, onSome: (event) => event.user }),
          ),
        );
        return session.accept(discovered);
      }),
      Effect.tap(() =>
        Effect.sync(() => {
          initialized = true;
        }),
      ),
      Effect.catch(session.fail),
    );
  });
  yield* Effect.forkScoped(
    Stream.runForEach(source.events, (event) =>
      Match.value(initialized && event.revision > acceptedRevision).pipe(
        Match.when(true, () => {
          acceptedRevision = event.revision;
          return session.accept(event.user).pipe(Effect.catch(session.fail));
        }),
        Match.orElse(() => Effect.void),
      ),
    ),
  );
  yield* Effect.forkScoped(retry());
  return retry;
});
