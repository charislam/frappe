import assert from "node:assert/strict";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Crypto, Effect, Option } from "effect";
import { makeFixture, type Command, type Fixture } from "./fixture.ts";
import { makePsqlClient, type PsqlClient } from "./psql.ts";

const deficitPersistence = Effect.fn("Concurrency.deficitPersistence")(function* ({
  budget,
  checked,
  write,
}: Fixture) {
  assert.equal(
    yield* checked(`select remaining_minor from public.deficit_lots where budget_id = '${budget}'`),
    "50",
  );
  const query = `select jsonb_agg(to_jsonb(l) order by ordinal) from public.deficit_lots l where budget_id = '${budget}'`;
  const before = yield* checked(query);
  yield* write({ operation: "rebuild" });
  assert.equal(yield* checked(query), before);
  yield* Console.log("ok - deficit lots survive commit across connections and rebuild identically");
});

const simultaneousRetry = Effect.fn("Concurrency.simultaneousRetry")(function* ({
  budget,
  transaction,
  draft,
  race,
  checked,
}: Fixture) {
  const crypto = yield* Crypto.Crypto;
  const request = yield* crypto.randomUUIDv4;
  const edit = { ...draft, expected_version: "1", data: { ...draft.data, memo: "Applied once" } };
  const retry = yield* race({ first: edit, second: edit, request: Option.some(request) });
  assert.equal(retry.code, 0, retry.error);
  assert.equal(
    yield* checked(`select version from public.transactions where id = '${transaction}'`),
    "2",
  );
  assert.equal(
    yield* checked(
      `select count(*) from public.audit_events where budget_id = '${budget}' and request_id = '${request}'`,
    ),
    "1",
  );
  yield* Console.log("ok - simultaneous retry applies once and returns committed result");
});

const staleVersion = Effect.fn("Concurrency.staleVersion")(function* ({
  transaction,
  draft,
  race,
  checked,
}: Fixture) {
  const edit = {
    ...draft,
    expected_version: "1",
    data: { ...draft.data, memo: "Concurrent edit" },
  };
  const stale = yield* race({ first: edit, second: edit });
  assert.notEqual(stale.code, 0);
  assert.match(stale.error, /Stale transaction version/);
  assert.equal(
    yield* checked(`select version from public.transactions where id = '${transaction}'`),
    "2",
  );
  yield* Console.log("ok - concurrent forms reject the stale aggregate version");
});

const concurrentAllocations = Effect.fn("Concurrency.concurrentAllocations")(function* ({
  budget,
  ready,
  deficitEnvelope,
  race,
  checked,
}: Fixture) {
  const allocation = {
    operation: "allocation_save",
    data: {
      month: "2026-11-01",
      entries: [
        { envelope_id: ready, amount_minor: "-70" },
        { envelope_id: deficitEnvelope, amount_minor: "70" },
      ],
    },
  } satisfies Command;
  const assignments = yield* race({ first: allocation, second: allocation });
  assert.equal(assignments.code, 0, assignments.error);
  assert.equal(
    yield* checked(`select count(*) from public.allocation_batches where budget_id = '${budget}'`),
    "2",
  );
  assert.equal(
    yield* checked(
      `select closing_minor from public.envelope_month_balances where envelope_id = '${ready}' and month = '2026-11-01'`,
    ),
    "-40",
  );
  yield* Console.log("ok - concurrent allocations both commit and expose negative Ready to assign");
});

const normalizedPayee = Effect.fn("Concurrency.normalizedPayee")(function* ({
  budget,
  race,
  checked,
}: Fixture) {
  const payee = { operation: "payee_save", data: { name: "Concurrent Market" } } satisfies Command;
  const result = yield* race({ first: payee, second: payee });
  assert.equal(result.code, 0, result.error);
  assert.equal(
    yield* checked(`select count(*) from public.payees where budget_id = '${budget}'`),
    "1",
  );
  yield* Console.log("ok - concurrent normalized payee creation returns one record");
});

const ownerRevocation = Effect.fn("Concurrency.ownerRevocation")(function* ({
  budget,
  owner,
  other,
  write,
  race,
  checked,
}: Fixture) {
  yield* write({ operation: "owner_add", data: { user_id: other } });
  const removal = yield* race({
    first: { operation: "owner_remove", data: { user_id: other } },
    second: { operation: "owner_remove", data: { user_id: owner } },
    secondActor: Option.some(other),
  });
  assert.notEqual(removal.code, 0);
  assert.match(removal.error, /Budget access denied/);
  assert.equal(
    yield* checked(`select count(*) from public.budget_owners where budget_id = '${budget}'`),
    "1",
  );
  yield* Console.log("ok - owner access is rechecked after waiting and final owner survives");
});

const scenarios = [
  deficitPersistence,
  simultaneousRetry,
  staleVersion,
  concurrentAllocations,
  normalizedPayee,
  ownerRevocation,
];
const runScenario = Effect.fn("Concurrency.runScenario")(function* ({
  client,
  scenario,
}: {
  readonly client: PsqlClient;
  readonly scenario: (typeof scenarios)[number];
}) {
  const fixture = yield* makeFixture(client);
  yield* scenario(fixture);
}, Effect.scoped);

// Requires psql. Each scoped scenario cleans up its own committed fixtures.
const program = Effect.gen(function* () {
  const client = yield* makePsqlClient();
  yield* Effect.forEach(scenarios, (scenario) => runScenario({ client, scenario }), {
    discard: true,
  });
});

NodeRuntime.runMain(program.pipe(Effect.provide(NodeServices.layer)));
