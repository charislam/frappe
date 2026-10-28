# Budgie database design

Status: implemented in `supabase/schemas/` and the initial migration. See [DATABASE.md](../DATABASE.md) for RPC contracts, replay semantics, and local checks.

## Product rules

- A budget has many owners; a user can own many budgets. All members have the same owner permissions initially. There is no distinguished primary owner.
- Each budget uses one currency. All accounts and entries use its minor unit. Currency cannot change after financial history exists.
- Accounts describe where money is held; envelopes describe its purpose. Envelopes do not belong to cash accounts.
- Account kinds are cash (checking, savings, physical cash), credit (cards and lines of credit), and investment. Cash and credit participate in budgeting; investments are tracked outside the spendable budget.
- Envelopes persist across months. Both positive and negative balances always carry forward.
- Money can be assigned to future months, but only money already available can fund assignments. Scheduled transactions do not supply spendable money.
- All activity is entered manually. No bank synchronization is included.
- Investment tracking covers contributions, withdrawals, and manual value adjustments, not securities or trades.
- Past activity can be edited or deleted with an audit trail and recalculation. There are no locked months initially.
- Refunds are independent transactions with user-selected envelope splits. A credit-account refund moves money out of that card's payment reserve into the selected envelopes; no original-purchase link is required.
- Envelope groups, ordering, and archiving are included. Targets, recurring templates, exchange rates, and securities tracking are deferred. One-off scheduled transactions are included.

## Storage conventions

Use PostgreSQL with Supabase authentication. UUID primary keys identify entities. Store amounts as signed `bigint` minor units, never floating point; decode them losslessly at the application boundary. A budget records currency code and minor-unit scale. Use `date` for financial dates and month keys (always the first day), and `timestamptz` for audit timestamps. Optional database columns use NULL; application domain models use Option.

All budget-owned tables carry `budget_id`. Parent entities expose unique `(budget_id, id)` keys, and children use composite foreign keys so an account, envelope, transaction, or group from another budget cannot be attached accidentally. Financial relationships use restrictive deletion; deleting a transaction means voiding it, not cascading away history.

Amounts increase an account when positive. Cash and investments normally have positive balances; credit debt is negative and a credit overpayment is positive. Envelope amounts are positive for funding/inflows and negative for spending/removal.

## Authoritative tables

Columns below describe the logical schema; migrations must add concrete checks, foreign keys, indexes, and access controls.

### Budgets and ownership

| Table           | Columns and constraints                                                                                         |
| --------------- | --------------------------------------------------------------------------------------------------------------- |
| `budgets`       | `id`, `name`, `currency_code`, `minor_unit_scale`, `created_at`, `archived_at`                                  |
| `budget_owners` | `budget_id`, `user_id` referencing the authenticated identity, `created_at`; primary key `(budget_id, user_id)` |

Financial dates are explicitly selected calendar dates; no budget timezone is stored. The client supplies the current viewer’s IANA timezone, and the database derives that viewer’s current day from its own clock. Owners in different timezones may have different posting eligibility at the same instant. There is no caller-selected as-of date. Posting is a manual action, not a server-midnight job. No role column is needed until another permission level exists. Owner additions and removals are audited. Creating a budget and its first ownership row is atomic. Serialize membership changes on the budget row and reject removal of its final owner; deleting an identity must not silently orphan a budget. Adding another existing user grants full owner access. Invitation delivery is outside this design.

### Accounts and envelopes

| Table             | Columns and constraints                                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `accounts`        | `id`, `budget_id`, `name`, `kind` (`cash`, `credit`, `investment`), `sort_order`, `created_at`, `archived_at`                                                      |
| `envelope_groups` | `id`, `budget_id`, `name`, `sort_order`, `archived_at`                                                                                                             |
| `envelopes`       | `id`, `budget_id`, nullable `group_id`, `name`, `kind` (`regular`, `ready_to_assign`, `credit_payment`), nullable `credit_account_id`, `sort_order`, `archived_at` |

Each budget has exactly one system Ready to assign envelope. Each credit account has exactly one payment envelope linked through `credit_account_id`; only payment envelopes may have that link, and the linked account must be credit. System envelopes cannot be removed or repurposed. Their entries remain visible even if the associated account is archived. Account kind is immutable after financial activity exists. Budget participation is derived from account kind initially rather than a separately editable flag.

Archiving prevents new activity without hiding historical entries or dropping their balances from totals. A nonzero account or envelope must be settled or explicitly retained in totals; archiving never writes off money.

### Ordering

Keep `sort_order` on the ordered entity: each has one shared ordering within its budget, so a separate ordering table adds no useful relationship. Use nonnegative integers, with deferrable uniqueness on `(budget_id, sort_order)` for accounts and groups. For envelopes, enforce uniqueness within `(budget_id, group_id, sort_order)`, treating NULL groups as the same ungrouped scope (`UNIQUE NULLS NOT DISTINCT`). Include archived rows in uniqueness; hiding them can leave harmless gaps.

A reorder command accepts the complete ordered list for the affected scope, validates membership and duplicates, and assigns consecutive positions under the budget lock. Deferring uniqueness until commit allows swapping positions. Moving an envelope between groups renumbers both scopes atomically. Inserts append to the scope. These rules prevent all accounts receiving position 1; contiguity is a command convention, while uniqueness is a database guarantee.

### Financial transactions

| Table                | Columns and constraints                                                                                                                                                                                                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `payees`             | `id`, `budget_id`, `name`, `created_at`, `archived_at`; unique normalized name within the budget (trimmed, case-insensitive)                                                                                                                                                                           |
| `transactions`       | `id`, `budget_id`, `kind` (`income`, `expense`, `refund`, `transfer`, `opening_balance`, `adjustment`, `valuation`), `status` (`scheduled`, `posted`, `voided`), `effective_date`, `payee_id` nullable, `memo` nullable, `sequence bigint`, `version bigint`, `created_by`, `created_at`, `updated_at` |
| `account_entries`    | `id`, `budget_id`, `transaction_id`, `account_id`, `amount_minor`, `position`; unique `(transaction_id, position)`                                                                                                                                                                                     |
| `transaction_splits` | `id`, `budget_id`, `transaction_id`, `envelope_id`, `amount_minor`, `position`; unique `(transaction_id, position)`                                                                                                                                                                                    |

Account entries and splits represent user intent, not automatically generated payment-reserve movements. Transactions have no duplicate authoritative total: derive it from the applicable account entries. Single-envelope purchases still have one split. A stable sequence is assigned by the database on creation and retained through edits.

Payees are reusable budget-owned records referenced through `(budget_id, payee_id)`. Archive rather than delete referenced payees. Renaming changes the label shown on historical transactions; the audit records the old label. Transfers and opening balances can omit a payee. Concurrent creation of the same normalized name returns the existing payee.

`version` starts at 1 and increments on every aggregate edit, including entries and splits. An edit supplies its expected version: if two owners load version 3, the first saves version 4 and the second must reload rather than overwrite it. The budget lock serializes writes but cannot detect that the second owner's form is stale.

`sequence` is an immutable, database-generated unique integer used to break ties between transactions on the same financial date. A timestamp alone can collide, especially within one database transaction. `(created_at, id)` could also provide stable ordering; sequence makes insertion order explicit and avoids a UUID tie-breaker. Gaps are harmless. It does not represent the time a purchase occurred.

`position` is the zero-based line order within one transaction, separately for account entries and envelope splits. It preserves display order and deterministic processing of split lines; it is not a chronological sequence. Validate nonnegative, unique positions and write consecutive positions when saving a transaction.

Validate the complete transaction at commit time, not with row-local CHECK constraints alone:

- Income, expenses, and refunds normally have one account entry. Their user splits sum to that entry's signed amount. Income normally targets Ready to assign; a refund can target any user-selected regular envelope.
- Cash-to-cash transfers have two equal and opposite entries and no splits.
- Cash-to-credit payments have two equal and opposite entries and no user splits. The reserve effect is derived from the source and destination account kinds.
- Cash-to-investment transfers have equal and opposite account entries and negative budget-envelope splits equal to the cash outflow. The reverse has positive splits equal to the cash inflow.
- Investment-to-investment transfers have equal and opposite entries and no splits. Investment valuations have one signed investment entry and no splits.
- Cash opening balances have one account entry and equal Ready to assign funding. Negative credit opening balances establish uncovered debt without an envelope debit. Positive credit opening balances establish available funds in Ready to assign. Investment opening balances have no budget effect.
- Adjustments are explicit signed corrections with a memo/reason. Cash corrections require matching envelope splits; investment corrections have no budget splits. Credit corrections must explicitly choose categorized activity or an opening-debt-style adjustment, rather than silently inventing a category.
- Initial support covers these transfer routes. Credit borrowing into cash, credit-to-credit balance transfers, and direct credit-to-investment transfers need explicit debt/reserve rules before being enabled; reject them rather than interpreting them as ordinary payments.

When posting, the effective date must be on or before the database’s current day in the requesting viewer’s validated IANA timezone. The viewer supplies a timezone, never a clock value or arbitrary posting cutoff; this is a scheduling rule rather than an authorization boundary. Scheduled transactions keep their proposed entries and splits but affect neither current accounts nor funded envelopes. Posting is an explicit, idempotent operation available on or after the effective date; automatic recurring generation is deferred. Voiding a schedule has no balance effect.

### Allocations

| Table                | Columns and constraints                                                                                                            |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `allocation_batches` | `id`, `budget_id`, `month`, `sequence`, `memo` nullable, `version`, `voided_at` nullable, `created_by`, `created_at`, `updated_at` |
| `allocation_entries` | `id`, `budget_id`, `batch_id`, `envelope_id`, `amount_minor`; unique `(batch_id, envelope_id)`                                     |

`sequence` and `version` have the same meanings as on transactions: stable creation order for batches in the same month, and stale-edit protection for the entire batch and its entries.

A batch is a balanced movement between envelopes: its entries sum to zero. Assigning 500 to Groceries means -500 Ready to assign and +500 Groceries. Moving money between spending envelopes uses the same structure. Direct funding of a payment envelope pays down opening or uncovered debt without pretending it was a new purchase.

Allocation month is the effective budgeting period; audit timestamps record when the change was entered. In monthly replay, allocations apply at the beginning of their month, in sequence order. This is an intentional monthly funding convention, so changing a month's assignment can recalculate that month's credit funding.

Future allocations reserve existing money immediately for assignment-capacity checks, while their destination balances appear in their chosen months. The displayed Ready to assign amount is the selected month's raw closing balance plus the signed Ready to assign entries in all later allocation months. Future assignments therefore reduce it, and future releases increase it. No separate `assignable_now` cache is needed. Never subtract a future allocation twice after navigating into its month.

For example, October's raw Ready to assign is 1,000 and November has a -300 Ready to assign allocation: October displays 700. November's raw balance already includes the -300, so November also displays 700, assuming no other activity. Historical views use this same current-plan convention; later allocation edits can change their displayed Ready to assign adjustment without changing their raw historical closing balances.

Allocations may make Ready to assign or source envelopes more negative, including future releases, edits, and voids of earlier assignments. Show the resulting overassignment or envelope shortage to the user; do not reject allocations based on available funds. Scheduled income remains excluded from actual account and envelope balances until posted. Historical corrections also remain recordable when they expose shortages.

### Reconciliation and audit

| Table            | Columns and constraints                                                                                                                                                      |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `audit_events`   | `id`, `budget_id`, `actor_user_id` nullable, `recorded_at`, `operation`, `entity_type`, `entity_id`, `before_data jsonb` nullable, `after_data jsonb` nullable, `request_id` |
| `write_requests` | `budget_id`, `request_id`, `actor_user_id`, `payload_hash`, `result jsonb`, `created_at`; primary key `(budget_id, request_id)`                                              |

Reconciliation is a regular `adjustment` transaction. The user supplies the observed account balance and a financial date; under the budget lock, calculate the recorded balance through that date and post the difference with the appropriate envelope splits and a reconciliation memo. The preview supplies the expected recorded balance so intervening account activity forces a refreshed preview rather than an unexpected adjustment. A zero difference needs no transaction. There are no statement records, cleared flags, reconciliation memberships, or invalidation workflows. Historical edits recalculate balances but leave later adjustments as originally entered; users can edit those transactions explicitly.

Audit events capture full before/after transaction aggregates, including entries and splits. They are append-only for clients. `write_requests` prevents a command from being applied twice when the database commits but the response is lost and the client retries. The client generates one UUID per intent and reuses it for retries. The composite primary key and budget lock ensure two concurrent copies of that request return the same result. Check the authenticated actor and command/payload hash before returning a stored result; reject reuse with different contents. Different request IDs represent different intents and are not deduplicated. This table does not prevent stale edits or unrelated write races: entity versions and the budget lock do that. Optimistic versions reject stale edits from another owner. Store audit actor identity without cascading deletion of historical audit events.

## Derived envelope ledger and caches

Credit calculations retain deficit lots during replay to track which unfunded spending belongs to which card (or cash), in oldest-first order. For example, a -50 envelope balance alone cannot tell us that 20 belongs to card A and 30 to card B. That detail is necessary to fund the correct payment reserves later.

Persist outstanding deficit lots in a budget-scoped `deficit_lots` derived cache. Store the source transaction and split position, a deterministic budget-local ordinal for oldest-first processing, envelope and optional credit account, remaining deficit, eligible unpaid debt, and direct coverage. Rebuild the cache from authoritative entries under the budget lock alongside account and monthly envelope summaries; remove settled lots at the end of replay. Deficit lots are not manually editable accounting inputs. Apply automatic payment-reserve effects directly to the running envelope balances; do not tabulate every effect or include effect traces in ordinary snapshots. Per-source tracing is deferred until an explanation endpoint or a concrete debugging need requires it.

| Table                     | Key and contents                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------ |
| `deficit_lots`            | Primary key `(budget_id, ordinal)`; outstanding spending deficits and reproducible debt coverage |
| `account_balances`        | Primary key `(budget_id, account_id)`; current posted balance                                    |
| `envelope_month_balances` | Primary key `(budget_id, envelope_id, month)`; opening, allocated, activity, closing amounts     |

`activity` includes both user transaction splits and generated payment-reserve effects. A separate reserve-transfer aggregate is unnecessary; future on-demand explanation tracing can identify automatic effects without another monthly balance column.

There are no budget/source revision columns or `budget_projection_state` table. Those were freshness markers for detecting mismatched cache generations, but synchronous atomic maintenance already ensures source/cache agreement. Read a combined budget screen in one database statement/snapshot. Separate requests can naturally observe different commits and should not be presented as a single snapshot. Entity `version` remains necessary for stale-edit protection; it serves a different purpose.

Expose these through authorized read views where useful. Use ordinary summary and deficit-lot tables maintained in the write transaction rather than periodically refreshed materialized views. Missing month rows mean not materialized, not zero; reads must generate the requested range or derive carry-forward from the preceding row. Materialize through the current month, latest allocation month, or requested view month, whichever is later. Scheduled activity belongs in a separate forecast view.

For each envelope and month:

```text
closing = opening + allocated + activity
next month's opening = this month's closing
```

For each account, current balance is the sum of posted, nonvoid account entries. Opening balances and valuation adjustments are ordinary authoritative entries.

The Ready to assign display applies the future-allocation adjustment described above to the raw monthly closing amount. This is a read calculation over existing allocations, not another stored balance.

## Credit and deficit calculations

Replay allocations at month start, then posted transactions by `(effective_date, sequence)`, and splits by position. Sequence is the explicit tie-breaker when financial dates match; timestamps alone are not unique. Replay preserves this order after edits; changing dates deliberately changes ordering.

### Purchases and subsequent funding

A funded credit purchase debits its spending envelope and credits the card's payment envelope by the funded portion. It reduces the account balance by the full purchase amount. An unfunded portion leaves the spending envelope negative and creates a credit deficit lot. Unfunded cash expenses create cash deficit lots, so mixed shortfalls can be covered in one deterministic order.

When funding covers a negative regular envelope, consume its outstanding deficit lots oldest first. Covering a cash lot requires no payment-reserve movement. Covering a credit lot generates a positive effect in the corresponding payment envelope, without a second debit to the spending envelope. The spending debit already occurred at purchase time. This is a liability-coverage effect, not a balanced allocation transfer. Track the generated amount against the debt that remains eligible for reservation.

Example: Groceries 50, card purchase 80 => Groceries -30, payment reserve 50, debt 80. Allocating 100 => Groceries 70, reserve 80. The 100 allocation repairs 30 of deficit and leaves 70 spendable; only 30 additional reserve is generated.

Direct allocations to a payment envelope reduce uncovered debt but do not also repair a spending envelope's negative balance. Track coverage against outstanding debt so later deficit funding cannot reserve the same debt twice. At replay time, consume existing debt coverage before generating additional reserves and cap automatic reserve creation at remaining unreserved debt. Preserve the regular envelope arithmetic; any resulting excess cash remains available in its envelope.

### Payments and positive credit balances

A payment reduces cash and increases the credit account balance. Its derived envelope effect removes the payment amount from the card's reserve. Insufficient reserve is shown as a negative payment-envelope balance; do not reject actual account activity. This negative balance carries forward like other envelopes.

An overpayment can make a credit account positive. That positive balance is spendable credit held at the issuer: purchases consume it before creating new debt and do not create payment reserves for the portion paid from that positive balance. Keep reserve release and debt coverage rules consistent with this distinction.

### Independent refunds

The user enters a positive credit account entry and positive envelope splits, without linking an original purchase. Apply each chosen split to its envelope and debit the card's payment reserve by the total refund. A refund of 20 to Groceries yields Groceries +20 and reserve -20, whether or not the original purchase can be identified.

Do not silently cap the reserve debit or redirect the refund to Ready to assign. If the reserve is insufficient, it becomes negative and signals that money must be reassigned. If the refund covers a negative destination envelope, consume its deficit lots in the same oldest-first order and apply any warranted reserve funding independently of the reserve debit. Future explanation tracing must preserve both movements. A refund after payment may create a positive credit account balance and a negative payment envelope; both remain visible. The user can explicitly rebalance envelopes rather than having the system invent an original category.

### Accounting checks

Account entries must match the real asset/debt movement, and each supported transaction shape must satisfy its account/split constraints. Allocation batches always sum to zero. Automatic reserve effects are checked separately against funded credit spending, later deficit coverage, payments, and refunds; they are not assumed to sum to zero across envelopes.

Do not equate total envelopes with cash unconditionally: negative credit spending envelopes, uncovered opening debt, positive card balances, and negative payment reserves complicate that comparison. Expose those components explicitly in a budget overview. For a cash-only budget, the sum of all envelope balances equals cash balances. For credit budgets, verify the full derived-effect ledger against independent worked examples, including payments made before a deficit is covered. Investment balances never enter spendable envelope totals.

The replay state must distinguish purchase deficits, outstanding account debt, amounts directly reserved, and debt already paid. Keep that state reproducible from inputs rather than storing manual debt-coverage overrides. The exact internal lot-settlement algorithm is an implementation detail, but all listed behavior and acceptance examples are required before enabling credit accounts.

## Atomic writes, authorization, and recalculation

All financial commands execute in the database as a single transaction: authenticate owner access, lock the budget row, validate request/version, write authoritative aggregates and audit, replay derived effects, refresh summaries, and record the idempotent response. Safe new postings apply directly when they follow the complete financial timeline, including future allocations. Historical transaction changes restore the last month-end checkpoint before the earliest changed date and replay the affected tail; a missing checkpoint falls back to a full rebuild. Metadata and schedules leave financial caches untouched. Allocation creates, edits, month moves, and voids then replay from the checkpoint before the earliest affected old/new month; only a missing checkpoint requires a full canonical rebuild. Equivalence tests compare all caches and checkpoints with the full rebuild reference across financial scenarios.

The budget lock serializes concurrent owner writes, including membership changes. Obtain it before reading balances or permissions used for mutation, and recheck membership after locking. Keep external work outside the transaction. Backdated changes, changed allocation months, and voids replay all affected later credit decisions, not just the edited month.

Enable RLS on every exposed table. Reads require membership in `budget_owners`, including caches and audit records. Membership checks must avoid recursive policies. Revoke direct financial-table and cache mutations from client roles; expose narrowly scoped commands. If privileged functions are needed to write protected tables, use a fixed safe search path, explicit authenticated-owner checks, fully qualified relations, and restricted execution grants. Do not use user-editable JWT metadata for authorization. Read views must preserve underlying access controls. Bootstrap membership through a dedicated create-budget command.

Rebuild caches from authoritative current records, not audit JSON or old projections. A rebuild uses the same budget lock and replaces summaries atomically. Deployments that change calculation rules must rebuild affected summaries before exposing the new calculations. Month-end `replay_checkpoints` store reproducible account balances, outstanding deficit lots, and the lot ordinal high-water mark for suffix recalculation. Protect them with the same ownership and client-write restrictions as summaries. Snapshots lock and read a consistent aggregate, materializing only missing empty months without replaying history.

## Indexes and integrity

- Membership primary key `(budget_id, user_id)` plus `(user_id, budget_id)` for a user's budgets.
- Accounts, groups, and envelopes indexed by budget and display order; partial unique indexes for the single Ready to assign envelope and each card's payment envelope.
- Transactions indexed by `(budget_id, effective_date, sequence)` for posted activity, and by budget/date for scheduled activity.
- Account entries indexed by `(budget_id, account_id, transaction_id)`; all transaction children indexed by their parent FK.
- Splits and allocation entries indexed by budget/envelope and by their parent; allocation batches indexed by `(budget_id, month, sequence)`.
- Payee foreign keys and audit entity lookups have supporting indexes; normalized payee names have budget-scoped uniqueness.
- Summary primary keys support account lookups and envelope/month ranges; add `(budget_id, month, envelope_id)` for an entire monthly budget screen.
- Check normalized month dates, nonzero entry amounts, allowed kinds/statuses, valid system-envelope links, and unique child positions.
- Cross-row balanced sums, required counts, transfer shapes, final-owner protection, and account-kind compatibility need command validation plus deferred constraint triggers where appropriate. A plain CHECK cannot enforce an aggregate.

## Required acceptance scenarios

1. Positive and negative balances carry through empty months; the monthly equation remains exact.
2. A split supermarket purchase updates one account and multiple envelopes atomically.
3. Cash-to-cash transfers change account balances without changing envelopes.
4. Investment contributions reduce the selected envelope; valuation changes affect only investments.
5. Funded and unfunded card purchases produce correct reserve and deficit amounts, including the 50/80/100 example.
6. Mixed cash and multiple-card deficits are covered oldest first, including same-date ties.
7. Direct debt funding followed by deficit coverage does not reserve debt twice.
8. Card payments before deficit coverage, payments exceeding reserves, and positive card balances remain consistent.
9. Independent refunds restore user-selected splits and debit reserves, including insufficient reserves, already-paid cards, and refunds to negative envelopes.
10. Future allocations adjust displayed Ready to assign even when they overassign it. Scheduled income stays out of actual balances until posted; posting twice has one effect.
11. Backdated edits, split changes, date changes, and voids yield exactly the same result as a full rebuild.
12. Historical corrections can expose overassignment without losing the real transaction.
13. Reconciliation writes an ordinary adjustment for the observed difference, writes nothing for zero difference, and rejects a stale preview. Historical edits do not silently change that adjustment.
14. Concurrent owners cannot lose updates, double-post retries, access another budget, or remove the final owner.
15. All cached amounts match a full rebuild; missing monthly rows never display a false zero.
16. Reordering cannot produce duplicate positions within a scope; swaps and group moves succeed atomically.
17. Reusable payees remain budget-scoped and archived payees retain historical references.
18. Ready to assign deducts future reservations exactly once when navigating months; unfunded releases remain recordable and their source-envelope shortages remain visible.

## Implementation sequence

Implement ownership and protected commands first, then cash accounts, envelopes, allocations, and authoritative entries. Add the deterministic credit/deficit calculation engine with the edge-case fixtures above before exposing credit workflows. Add monthly/current summaries, reconciliation adjustments, and scheduled posting. Ship migrations only after database authorization and replay-equivalence tests cover the complete model.
