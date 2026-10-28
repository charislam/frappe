# Financial database

The implementation of [0002_DATABASE_DESIGN.md](spec/0002_DATABASE_DESIGN.md) uses Supabase declarative schemas with the `pg-delta` engine. `supabase/schemas/` is the source of truth; `supabase/migrations/` records the versioned changes used to deploy it. The existing initial migration is retained as the baseline.

## Local installation and checks

From `apps/budgie`, with the local Supabase stack running:

```sh
pnpm exec supabase db push --local
pnpm test:database
pnpm test:database:concurrency
pnpm test:database:lint
```

The concurrency check runs its TypeScript entry point with `node --experimental-strip-types`, requires `psql`, and defaults to the standard local Supabase database. Its sources are included in the app’s lint and TypeScript checks. Override `BUDGIE_TEST_DATABASE_URL` to use another **local test database** with the migration installed. SQL lint uses `supabase db lint --schema public,budgie_private --level warning --fail-on warning`; pass `--db-url` to that script to target another test database. pgTAP fixtures roll back. Each concurrency scenario owns an isolated fixture, generates its UUIDs through Effect’s Crypto service, commits to exercise real locks, and removes only its own fixtures afterward. No hosted database is needed.

`supabase test db` uses pgTAP for financial examples, authorization, and rebuild equivalence. The concurrency check uses `@effect/platform-node` process services and runtime, streams and queues for subprocess I/O, scoped process and fixture cleanup, Deferred for lock-holder readiness, and a bounded Schedule to wait for an actual blocked database connection before committing the competing write. All replay relations are declared in the schema, so standard Supabase database lint checks both schemas without a preparation script.

The application checks remain `pnpm fmt`, `pnpm lint`, `pnpm typecheck`, and `pnpm test:budgie` from the repository root. The client boundary is in `src/database/`: decoded amounts, versions, and sequences are safe integer `number` values; amounts remain signed, while versions and sequences must be positive. The RPC keeps PostgreSQL bigint values as decimal strings, and decoding rejects values outside JavaScript’s safe integer range rather than rounding them. Nullable timestamps decode to `Option<DateTime.Utc>`; other nullable fields use `Option`. Envelope kinds determine whether a credit account reference is required or absent.

## Changing the schema

Follow [Supabase’s declarative schema workflow](https://supabase.com/docs/guides/local-development/declarative-database-schemas). Edit the declarations under `supabase/schemas/`, then generate an incremental migration:

```sh
pnpm db:sync --file describe_the_change
# Review the new file in supabase/migrations/, then apply locally:
pnpm exec supabase migration up
pnpm test:database
pnpm test:database:concurrency
pnpm test:database:lint
```

`db:sync` runs `supabase db schema declarative sync --no-apply --strict-coverage`. It compares the complete schema tree against migration history, generates a migration for review, and leaves the local database unchanged. Running it again after the migration is generated should report no schema changes. Commit both the edited declarations and generated migration. Calculation changes also need a locked data rebuild in the migration; schema diffs do not generate data changes.

The engine resolves dependencies automatically. Files are organized by database schema and object: tables carry their indexes, constraints, triggers, policies, and grants; functions and views have their own files. The exported default-privilege declarations preserve Supabase’s existing permission defaults. Keep grants and RLS in the declarative tree so generated changes retain the access model.

Do not concatenate these files or compare them byte-for-byte with migrations. Migrations contain incremental changes; declarations describe the current state. Do not use `supabase db diff` for this workflow: on `pg-delta`, that command compares a live database with migrations and ignores the declarative source. Studio and SQL-editor edits are likewise not captured by declarative sync.

The tree was adopted with `supabase db schema declarative generate --db-url ... --schema public,budgie_private`. Export is a one-time adoption tool, not the daily editing workflow; refreshing it from an outdated database would overwrite pending declarations. `config.toml` explicitly selects `./schemas` under `[experimental.pgdelta]`; the legacy `schema_paths` option is unused.

## RPC contract

All RPCs authenticate using `auth.uid()`. A shared owner has full access. Table reads are protected by RLS, and direct client writes to authoritative tables, summaries, requests, and audit are revoked. Only the membership predicate is executable in the private schema.

| RPC                             | Inputs                                               | Result                                                                                                                   |
| ------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `budgie_create_budget`          | `p_budget uuid`, `p_request uuid`, `p_data jsonb`    | Budget ID and Ready to assign ID                                                                                         |
| `budgie_command`                | `p_budget uuid`, `p_request uuid`, `p_command jsonb` | Entity ID and optional version; zero reconciliation returns null ID and `difference_minor: "0"`                          |
| `budgie_snapshot`               | `p_budget uuid`, `p_month date`, `p_time_zone text`  | Combined budget, current accounts, selected-month envelopes/overview, transactions, allocations, payees and deficit lots |
| `budgie_reconciliation_preview` | `p_budget uuid`, `p_account uuid`, `p_date date`     | Recorded balance through that financial date, as `recorded_minor`                                                        |

Bootstrap data contains `name`, `currency_code`, `minor_unit_scale`, and the viewer’s `time_zone` (an IANA name such as `Australia/Brisbane`). The timezone is request context, not a budget setting. Generate the budget and request UUIDs once and retain them through retries. Bootstrap locks the proposed UUID, then creates the budget, first owner, system envelope, audit, and request atomically.

Commands have this envelope:

```json
{
  "operation": "transaction_save",
  "id": "entity-uuid-generated-once",
  "expected_version": null,
  "time_zone": "Australia/Brisbane",
  "data": {
    "kind": "expense",
    "status": "posted",
    "effective_date": "2026-10-20",
    "payee_id": null,
    "memo": null,
    "entries": [{ "account_id": "cash-account-uuid", "amount_minor": "-1200" }],
    "splits": [{ "envelope_id": "regular-envelope-uuid", "amount_minor": "-1200" }]
  }
}
```

Use valid UUIDs in place of the labels. Entries and splits receive consecutive positions in array order. New aggregates have version `"1"`; editing, posting, or voiding an existing aggregate requires its loaded `expected_version`. A stale version raises SQLSTATE `40001`; reload the aggregate before attempting a new intent. Retry a lost response with the **same request UUID and identical command**, not a fresh request. Reusing a request with another actor or payload is rejected.

| Operations                                          | Data                                                                                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `owner_add`, `owner_remove`                         | `user_id` of an existing authenticated identity                                                                                 |
| `budget_update`                                     | Optional `name`, `currency_code`, `minor_unit_scale`, `archived`                                                                |
| `account_create`                                    | `name`, `kind`: cash, credit, or investment                                                                                     |
| `group_create`                                      | `name`                                                                                                                          |
| `envelope_create`                                   | `name`, optional nullable `group_id`; creates a regular envelope                                                                |
| `account_update`, `group_update`, `envelope_update` | Entity `id`; optional `name`, `archived`; account kind changes remain subject to history/system-envelope constraints            |
| `payee_save`                                        | `name`, optional entity `id` for renaming; normalized duplicate creation returns the existing payee                             |
| `payee_archive`                                     | Entity `id`, optional `archived` (defaults true)                                                                                |
| `reorder`                                           | `entity`: account/group/envelope, complete `ids` array; envelopes also accept nullable `group_id`                               |
| `envelope_move`                                     | Envelope `id`, destination nullable `group_id`; both scopes are renumbered                                                      |
| `transaction_save`                                  | Full aggregate as above; adjustment requires a memo. Explicit empty splits on a credit adjustment select opening-debt semantics |
| `transaction_post`, `transaction_void`              | Existing `id` and expected version; posting requires the effective date to have arrived in the viewer’s timezone                |
| `allocation_save`                                   | `month` (first day), nullable `memo`, balanced `entries` containing `envelope_id` and `amount_minor`                            |
| `allocation_void`                                   | Existing `id` and expected version                                                                                              |
| `reconcile`                                         | `account_id`, `effective_date`, `expected_recorded_minor` from preview, `observed_minor`, appropriate `splits`, optional memo   |
| `rebuild`                                           | Regenerates summaries from current authoritative records using the viewer’s local day                                           |

Bind the current viewer’s timezone once when constructing the client: `database(client, { timeZone })`, where `timeZone` is decoded by `ViewerTimeZone`. The adapter sends the IANA name as `time_zone` on commands/bootstrap and `p_time_zone` on snapshots. The server validates it against PostgreSQL’s timezone names and derives today from its own timestamp, applying daylight-saving rules. Viewers may therefore have different posting dates at the same instant. There is no caller-selected date limit. Financial/effective dates still use validated `FinancialDate` values, while the displayed snapshot month uses first-of-month `BudgetMonth`; both serialize as `YYYY-MM-DD` without timezone conversion. Schedules remain proposed until explicitly posted; `budgie_scheduled_forecast` provides an RLS-preserving view of them.

## Replay and reads

Writes acquire the budget row lock before checking owner access, request IDs, versions, or balances. The same transaction validates and writes the aggregate, updates affected summaries, appends audit, and stores the retry response. Reconciliation compares the preview under this lock. Membership changes use it too; the final owner cannot be removed.

Replay orders allocations at month start, then posted transactions by date and stable sequence, then splits by position. Replay builds running totals directly in `account_balances` and `envelope_month_balances`. Outstanding spending deficits persist in `deficit_lots`, including their source transaction/split position, deterministic budget-local ordinal, remaining amount, eligible unpaid debt, and direct coverage. Settled lots are removed after calculation. Month-end `replay_checkpoints` retain account balances, outstanding lots, and the last allocated lot ordinal. All derived caches update atomically under the budget lock and can always be rebuilt from authoritative transactions and allocations. Reads on other connections see the previous committed results until the write commits. All rows are budget-scoped, owner-readable through RLS, and protected from direct client writes. Automatic reserve changes update envelope totals directly; replay does not collect per-source effect records or persist freshness revisions. Direct coverage can be released; paid debt cannot become eligible again. Negative reserves and real overassignments remain visible.

Newly posted transactions update the existing state directly when they follow every posted transaction in `(effective_date, sequence)` order and precede no active future allocation. Changes propagate through any later empty cached months. Historical transaction corrections, allocation changes, voids, and older scheduled postings restore the last checkpoint before the earliest affected month and replay the remaining timeline. Moving an allocation uses the earlier of its old and new months. If no unaffected checkpoint exists, calculation starts from zero. Full rebuilds use the same event helpers and remain the reference implementation. Metadata edits, unchanged financial transaction data, and schedules do not recalculate balances. New accounts and envelopes seed zero balances in existing caches.

A snapshot takes the budget lock and returns one consistent aggregate without replaying financial history. It extends missing empty months before or after the cached range through the requested month and viewer’s current month. Financial writes already materialize through the latest allocation and posted activity, retaining any previously materialized horizon. Monthly `closing = opening + allocated + activity`; empty months carry both signs. Current account balances include all posted activity. Overview account totals read the selected month's checkpoint, alongside that month's envelope balances, without rescanning transaction history. Bootstrap, financial writes, and account creation maintain checkpoints under the budget lock; extending empty months creates their checkpoints. A missing checkpoint for a materialized month is an invariant error. Ready to assign applies all later signed allocations once. The returned deficit lots describe the complete replay through the materialized horizon, including planned future allocations. Per-source explanation tracing is deferred until an explanation feature needs it.

Allocations may make Ready to assign and source envelopes more negative. Creates, edits, month moves, and voids remain recordable even when they introduce or worsen a shortage; snapshots expose the resulting signed balances. There are no allocation funding checks or cutoff projections. Scheduled income affects actual balances only when posted. Allocation changes replay from the last checkpoint before the earliest affected old/new month, falling back to a full rebuild only when none exists. Archived rows retain balances and display positions but reject new financial activity.

Read summaries through the snapshot RPC when presenting a combined screen. Separate REST requests can observe separate commits. Audit records contain full before/after financial aggregates with decimal-string bigint fields. Renamed payees intentionally update labels on historical transactions; the audit retains the previous label.
