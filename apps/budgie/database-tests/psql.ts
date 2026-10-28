import assert from "node:assert/strict";
import {
  Array,
  type Cause,
  Config,
  Crypto,
  Deferred,
  Duration,
  Effect,
  Fiber,
  Match,
  Option,
  Queue,
  Schedule,
  Stream,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

const makeProcessClient = Effect.fn("Concurrency.makeProcessClient")(function* () {
  const url = yield* Config.String("BUDGIE_TEST_DATABASE_URL").pipe(
    Config.withDefault("postgresql://postgres:postgres@127.0.0.1:54322/postgres"),
  );
  const crypto = yield* Crypto.Crypto;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const psql = (options: ChildProcess.CommandOptions) =>
    ChildProcess.make("psql", [url, "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], {
      extendEnv: true,
      forceKillAfter: Duration.seconds(1),
      ...options,
    });
  const execute = Effect.fn("Concurrency.execute")(
    function* ({
      sql,
      application = Option.none(),
    }: {
      readonly sql: string;
      readonly application?: Option.Option<string>;
    }) {
      const name = yield* Option.match(application, {
        onNone: () => crypto.randomUUIDv4,
        onSome: Effect.succeed,
      });
      const handle = yield* spawner.spawn(
        psql({
          env: { PGAPPNAME: name },
          stdin: Stream.make(sql).pipe(Stream.encodeText),
        }),
      );
      return yield* Effect.all(
        {
          code: handle.exitCode,
          output: handle.stdout.pipe(Stream.decodeText, Stream.mkString),
          error: handle.stderr.pipe(Stream.decodeText, Stream.mkString),
        },
        { concurrency: "unbounded" },
      );
    },
    Effect.scoped,
    Effect.timeout("15 seconds"),
  );
  const checked = Effect.fn("Concurrency.checked")(function* (sql: string) {
    const result = yield* execute({ sql });
    assert.equal(result.code, 0, result.error);
    return Option.getOrThrow(Array.last(result.output.trim().split("\n")));
  });
  return { psql, execute, checked };
});
type ProcessClient = Effect.Success<ReturnType<typeof makeProcessClient>>;
interface SqlRace {
  readonly first: string;
  readonly second: string;
}
export const makePsqlClient = Effect.fn("Concurrency.makePsqlClient")(function* () {
  const client = yield* makeProcessClient();
  return { checked: client.checked, race: (options: SqlRace) => race({ ...options, client }) };
});
export type PsqlClient = Effect.Success<ReturnType<typeof makePsqlClient>>;

const startHolder = Effect.fn("Concurrency.startHolder")(function* ({
  client,
  first,
}: {
  readonly client: ProcessClient;
  readonly first: string;
}) {
  const crypto = yield* Crypto.Crypto;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const input = yield* Queue.unbounded<string, Cause.Done>();
  const ready = yield* Deferred.make<void>();
  const handle = yield* spawner.spawn(
    client.psql({
      env: { PGAPPNAME: `budgie-holder-${yield* crypto.randomUUIDv4}` },
      stdin: Stream.fromQueue(input).pipe(Stream.encodeText),
    }),
  );
  const output = yield* handle.stdout.pipe(
    Stream.decodeText,
    Stream.splitLines,
    Stream.runForEach((line) =>
      Match.value(line).pipe(
        Match.when("BUDGIE_LOCK_HELD", () => Deferred.succeed(ready, undefined)),
        Match.orElse(() => Effect.void),
      ),
    ),
    Effect.forkScoped,
  );
  const error = yield* handle.stderr.pipe(Stream.decodeText, Stream.mkString, Effect.forkScoped);
  yield* Queue.offer(input, `begin; ${first}\n\\echo BUDGIE_LOCK_HELD\n`);
  yield* Deferred.await(ready).pipe(
    Effect.raceFirst(
      Fiber.join(output).pipe(
        Effect.andThen(Fiber.join(error)),
        Effect.flatMap((message) => Effect.fail(new Error(message || "Lock holder exited early"))),
      ),
    ),
    Effect.timeout("10 seconds"),
  );
  return { input, handle, output, error };
});

type Holder = Effect.Success<ReturnType<typeof startHolder>>;

const commitHolder = Effect.fn("Concurrency.commitHolder")(function* (holder: Holder) {
  yield* Queue.offer(holder.input, "commit;\n");
  yield* Queue.end(holder.input);
  const result = yield* Effect.all(
    {
      code: holder.handle.exitCode,
      output: Fiber.join(holder.output),
      error: Fiber.join(holder.error),
    },
    { concurrency: "unbounded" },
  );
  assert.equal(result.code, 0, result.error);
});

// Observe an actual blocked backend before committing the lock holder.
const race = Effect.fn("Concurrency.race")(function* ({
  client,
  first,
  second,
}: SqlRace & { readonly client: ProcessClient }) {
  const crypto = yield* Crypto.Crypto;
  const holder = yield* startHolder({ client, first });
  const application = `budgie-race-${yield* crypto.randomUUIDv4}`;
  const competing = yield* client
    .execute({ sql: second, application: Option.some(application) })
    .pipe(Effect.forkScoped);
  yield* client
    .checked(
      `select count(*) from pg_stat_activity where application_name = '${application}' and wait_event_type = 'Lock'`,
    )
    .pipe(
      Effect.repeat({ while: (count) => count !== "1", schedule: Schedule.spaced("10 millis") }),
      Effect.timeout("10 seconds"),
    );
  yield* commitHolder(holder);
  return yield* Fiber.join(competing);
}, Effect.scoped);
