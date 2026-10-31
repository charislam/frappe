# Budgets, selection, and preferences

Status: agreed requirements and implementation plan. Implementation is not part of this planning task.

## Scope

Persist budgets and user memberships; implement authenticated budget selection, working creation at `/new`, and a minimal `/budget/<budget_id>` page displaying the budget name and account/logout controls. Do not add sharing, archive, or unarchive controls. Retain existing account functionality.

## Data and authorization

- Budgets have an ID, name, creation timestamp, and nullable archive timestamp. Users and budgets have a many-to-many membership relationship. All members have equal permissions.
- Trim names; reject empty or whitespace-only names and names longer than 200 characters. Enforce validation in the database as well as the form, using consistent character-count semantics.
- Duplicate budget names are allowed, including among budgets belonging to the same user. Preserve display casing after trimming. Do not perform name-availability checks or enforce name uniqueness: membership-scoped uniqueness could expose other users' budget names through shared budgets. Identify budgets by ID.
- Create the budget and creator membership atomically. Use authenticated database authorization; members can access their budgets, and outsiders cannot read or mutate them. Archived membership remains visible for selection resolution.
- Index membership lookups and budget ordering as appropriate. Use server-generated creation timestamps and order by creation time ascending, then ID ascending.

## Selection and routing

Resolve the authenticated user's budgets after sign-in, session restoration, and visits to `/`. Preserve explicit authenticated `/budget/<id>` links instead of overriding them with preferences. Keep `/new` directly accessible even when budgets exist. Remove the `/accounts` page.

| Selection input                                           | Outcome                                                                             |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Saved accessible unarchived budget                        | Navigate to that budget                                                             |
| Saved accessible archived budget                          | Navigate to that budget and show the archived message                               |
| No readable preference and at least one unarchived budget | Navigate to the oldest eligible budget                                              |
| No readable preference and no unarchived budgets          | Navigate to `/new`                                                                  |
| Saved missing, malformed, or inaccessible ID              | Clear stale preference and apply the no-preference rules                            |
| Budget lookup fails                                       | Show retryable error after Query retries; do not interpret failure as an empty list |

Use replacement navigation for automatic redirects. Protect routes while auth initializes; unauthenticated users go through the existing login flow. Preserve an explicit budget destination through authentication. Cancel or disregard stale work when the authenticated user changes.

Every successfully resolved budget visit saves its ID, including visits to archived budgets and automatic oldest-budget selection. Do not save an unauthorized or nonexistent requested ID. Explicit invalid/inaccessible budget URLs show an unavailable page without revealing another user's budget data; only stale preference resolution automatically falls back.

## Archived budgets

At `/budget/<archived_id>`, show a message that the budget is archived instead of the normal budget content. Archived budgets are never eligible for automatic oldest-budget selection, but a saved archived selection remains authoritative.

- With no unarchived budgets: show a Create budget link to `/new`.
- With unarchived budgets: show a labeled native select styled like the existing theme selector, with an initial “Select a budget” placeholder. List only unarchived budgets, oldest first, then ID. Selecting an option immediately navigates and saves the newly visited budget.
- Direct visits to archived budgets use the same message.

## Pagination

The frontend controls pagination using a “Load more budgets” button on the archived-budget selector. Fetch one page per request with a `(created_at, id)` cursor, preserving the raw timestamp’s full precision; do not use offsets or recursively fetch all pages. Preserve loaded choices on failure and offer a retry of the failed cursor. Resolve saved and explicit budget IDs directly rather than requiring their list page to load. Root fallback uses the first unarchived page.

## Creation

`/new` contains a labeled name field and Create button. Show actionable validation errors. Disable duplicate in-flight submissions. On success, navigate to the new budget, invalidate the user's budget query, and save the visited budget preference.

Do not automatically retry creation mutations.

## Preferences and theme migration

Use Effect's KeyValueStorage backed by browser local storage, exposed through a preferences service/layer with prefix `budgie.preferences.`. The logical key `selected_budget` stores a single budget ID at `budgie.preferences.selected_budget`; it is not a per-user map.

Treat absent values as Option. Read failures silently fall back to oldest eligible selection. Write failures are silent and do not undo navigation or change the displayed budget. Clear only the private `budgie.preferences.` namespace on logout, preserving unrelated keys. Coordinate clearing with in-flight writes so a stale visit cannot repopulate preferences after logout; reset in-memory preference state as well. Storage failures must not prevent logout.

The current theme key is `budgie.theme` in `src/theme/model.ts`. Change it to `budgie.public_preferences.theme`, which survives logout. Do not migrate the old key; there are no public users of it.

## Query retries and errors

Use the Supabase SDK for reads and creation. Let the SDK handle read retries with its default policy. Disable Frappe Query retries for budget queries to avoid multiplying attempts. Do not automatically retry creation mutations.

Pass Effect cancellation signals through the SDK’s `abortSignal` API. After SDK retries are exhausted, show an error with a manual Retry action. Represent recoverable failures in Effect’s typed error channel. Custom retry schedules, Retry-After handling, and response-header preservation are no longer required.

## Implementation sequence

1. Inspect local database setup, authorization patterns, pinned Effect KeyValueStorage APIs, and Frappe Query execution. Follow applicable Effect, Supabase, Postgres, and CSS skills during implementation.
2. Add database migrations, budget/member authorization, atomic idempotent creation, and name length/whitespace validation. Verify with multiple authenticated users.
3. Add budget schemas/services and Query integration, using SDK-managed read retries and typed errors.
4. Introduce private preferences storage and logout cleanup; change theme storage key.
5. Extend routing and application state for selection/loading/failure, explicit destinations, creation, budget content, and archived messages.
6. Add the creation form and styled native budget select using existing UI conventions.
7. Run focused tests and repository checks: `pnpm fmt`, `pnpm lint`, and `pnpm typecheck`.

## Acceptance checks

- Cover every selection-table row, deterministic ordering ties, and saved archived budgets with and without alternatives.
- Verify sign-in, restored sessions, root visits, explicit budget links, logout, and user changes during pending requests.
- Verify private-only logout clearing, silent storage failures, and successful-visit writes.
- Validate trimmed names, whitespace-only names, and 200/201-character boundaries.
- Verify membership authorization across users.
- Verify native-select accessibility and immediate navigation, creation success/error states, and archived direct visits.
- Verify SDK-managed read retries, disabled creation retries, cancellation, and manual retry after exhaustion.
