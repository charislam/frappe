import { Crypto, Effect, Option, Schema } from "effect";
import type { Operation } from "../src/database/model.ts";
import type { PsqlClient } from "./psql.ts";

export type Command = { readonly operation: Operation; readonly [key: string]: Schema.Json };
type FixtureIds = Readonly<
  Record<"budget" | "owner" | "other" | "account" | "transaction" | "deficitEnvelope", string>
>;
interface FixtureContext {
  readonly client: PsqlClient;
  readonly ids: FixtureIds;
}

const literal = (value: Schema.Json) => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
const session = (actor: string) =>
  `set role authenticated; select set_config('request.jwt.claim.sub','${actor}',false);`;
const tables = [
  "replay_checkpoints",
  "deficit_lots",
  "account_balances",
  "envelope_month_balances",
  "account_entries",
  "transaction_splits",
  "allocation_entries",
  "transactions",
  "allocation_batches",
  "envelopes",
  "envelope_groups",
  "accounts",
  "payees",
  "audit_events",
  "write_requests",
  "budget_owners",
];

const cleanup = Effect.fn("Concurrency.cleanup")(function* ({ client, ids }: FixtureContext) {
  yield* client.checked(
    `begin; ${tables.map((table) => `delete from public.${table} where budget_id = '${ids.budget}';`).join("\n")}
     delete from public.budgets where id = '${ids.budget}';
     delete from auth.users where id in ('${ids.owner}','${ids.other}'); commit;`,
  );
});

const makeCommands = Effect.fn("Concurrency.makeCommands")(function* ({
  client,
  ids,
}: FixtureContext) {
  const crypto = yield* Crypto.Crypto;
  const command = Effect.fn("Concurrency.command")(function* (
    payload: Command,
    request: Option.Option<string> = Option.none(),
  ) {
    const id = yield* Option.match(request, {
      onNone: () => crypto.randomUUIDv4,
      onSome: Effect.succeed,
    });
    return `select public.budgie_command('${ids.budget}','${id}',${literal({ ...payload, time_zone: "UTC" })});`;
  });
  const write = Effect.fn("Concurrency.write")(function* (payload: Command) {
    return yield* client.checked(`${session(ids.owner)} ${yield* command(payload)}`);
  });
  const race = Effect.fn("Concurrency.commandRace")(function* ({
    first,
    second,
    request = Option.none(),
    secondActor = Option.none(),
  }: {
    readonly first: Command;
    readonly second: Command;
    readonly request?: Option.Option<string>;
    readonly secondActor?: Option.Option<string>;
  }) {
    return yield* client.race({
      first: `${session(ids.owner)} ${yield* command(first, request)}`,
      second: `${session(Option.getOrElse(secondActor, () => ids.owner))} ${yield* command(second, request)}`,
    });
  });
  return { write, race };
});

const bootstrap = Effect.fn("Concurrency.bootstrap")(function* ({ client, ids }: FixtureContext) {
  const crypto = yield* Crypto.Crypto;
  yield* client.checked(`insert into auth.users(id) values ('${ids.owner}'),('${ids.other}');`);
  const result = yield* client.checked(
    `${session(ids.owner)} select public.budgie_create_budget('${ids.budget}','${yield* crypto.randomUUIDv4}',
      ${literal({ name: "Concurrency fixture", time_zone: "UTC", currency_code: "CAD", minor_unit_scale: 2 })});`,
  );
  const { ready_to_assign_id } = yield* Schema.decodeUnknownEffect(
    Schema.fromJsonString(Schema.Struct({ ready_to_assign_id: Schema.String })),
  )(result);
  return ready_to_assign_id;
});

type Commands = Effect.Success<ReturnType<typeof makeCommands>>;

const seed = Effect.fn("Concurrency.seed")(function* ({
  ids,
  ready,
  write,
}: {
  readonly ids: FixtureIds;
  readonly ready: string;
  readonly write: Commands["write"];
}) {
  yield* write({
    operation: "account_create",
    id: ids.account,
    data: { name: "Cash", kind: "cash" },
  });
  yield* write({
    operation: "envelope_create",
    id: ids.deficitEnvelope,
    data: { name: "Unfunded spending" },
  });
  const draft = {
    operation: "transaction_save",
    id: ids.transaction,
    data: {
      kind: "income",
      effective_date: "2026-10-01",
      entries: [{ account_id: ids.account, amount_minor: "100" }],
      splits: [{ envelope_id: ready, amount_minor: "100" }],
    },
  } satisfies Command;
  yield* write(draft);
  yield* write({
    operation: "transaction_save",
    data: {
      kind: "expense",
      effective_date: "2026-10-02",
      entries: [{ account_id: ids.account, amount_minor: "-50" }],
      splits: [{ envelope_id: ids.deficitEnvelope, amount_minor: "-50" }],
    },
  });
  return draft;
});

// Each scenario owns an isolated fixture; register cleanup before the first write.
export const makeFixture = Effect.fn("Concurrency.makeFixture")(function* (client: PsqlClient) {
  const crypto = yield* Crypto.Crypto;
  const ids = yield* Effect.all({
    budget: crypto.randomUUIDv4,
    owner: crypto.randomUUIDv4,
    other: crypto.randomUUIDv4,
    account: crypto.randomUUIDv4,
    transaction: crypto.randomUUIDv4,
    deficitEnvelope: crypto.randomUUIDv4,
  });
  yield* Effect.addFinalizer(() => cleanup({ client, ids }).pipe(Effect.orDie));
  const commands = yield* makeCommands({ client, ids });
  const ready = yield* bootstrap({ client, ids });
  const draft = yield* seed({ ids, ready, write: commands.write });
  return { ...ids, ...commands, ready, draft, checked: client.checked };
});

export type Fixture = Effect.Success<ReturnType<typeof makeFixture>>;
