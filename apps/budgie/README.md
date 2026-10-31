# Budgie

Browser-only budgeting app built with Vite, Effect v4, frappe, and Supabase Auth.

## Local setup

Use the repository's Node version (`.nvmrc`) and pnpm. A running Docker-compatible runtime (Docker Desktop or OrbStack) is required. The workspace includes Supabase CLI as a development dependency; this configuration was initialized and checked with CLI **2.120.0**. No hosted project is needed.

From the repository root:

Use `pnpm supabase:budgie:start`, `pnpm supabase:budgie:status`, and `pnpm supabase:budgie:stop` to manage Budgie's stack without changing directories. These commands explicitly select `apps/budgie/supabase/config.toml`.

```sh
pnpm install
cd apps/budgie
pnpm exec supabase --version
# Already initialized in this checkout; for a fresh, uninitialized directory:
# pnpm exec supabase init
pnpm exec supabase start
pnpm exec supabase status
cp .env.example .env.local
```

Copy the **Publishable key** reported by `status` into `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env.local`. If your local CLI reports only an **anon key**, use that public equivalent. Keep `VITE_SUPABASE_URL=http://127.0.0.1:54321`. Never use the secret/service-role key in Vite. Environment files are ignored; `.env.example` is tracked. Restart Vite after changing values.

Then, from the repository root:

```sh
pnpm dev:budgie
```

Open **http://localhost:5174**. Vite uses a strict port. Use this exact origin throughout a flow; `localhost` and `127.0.0.1` have separate browser storage. Missing configuration produces an actionable startup message.

Local services use the default Supabase ports: API `54321`, Postgres `54322`, Studio `54323`, email inbox `54324`, and shadow database `54320`. Stop another local Supabase stack before starting this one, or coordinate all ports if you change the configuration. Use the URLs printed by `status` as the authority.

From `apps/budgie`, inspect or stop services with:

```sh
pnpm exec supabase status
pnpm exec supabase stop
```

## Email authentication

Open the local **Mailpit inbox at http://127.0.0.1:54324**. No external SMTP credentials are needed; local email is captured rather than delivered.

- `/login` sends a six-digit email code for both new and existing users. New users automatically get an account.
- `/verify-code` accepts the code and offers resend. The email is carried in a typed URL query parameter so verification survives reloads; codes are never placed in URLs. Codes expire after one hour.
- Both Supabase's confirmation and magic-link email templates send codes. For a hosted deployment, configure both templates with `{{ .Token }}` as in `supabase/templates/code.html`.
- Logout follows SDK auth events. A failed logout retains the session and displays its error.

Supabase owns session persistence, refresh, and cross-tab synchronization. Budgie disables SDK URL detection and signs in by verifying the email code.

## Architecture and checks

`src/auth/supabase.ts` is the SDK boundary; UI components depend on the scoped auth resource. Initialization, failed discovery, signed-out, and authenticated states belong to auth. A replaying user stream exposes stable IDs with optional email. Auth identity changes retire frappe's query partition before protected routing is admitted. Same-ID refreshes keep the partition. Navigation and the configured query client are provided through Frappe contexts, so pages read them without forwarding props. This cache isolation does **not** replace database authorization.

Theme preference is stored under `budgie.public_preferences.theme`; system mode reacts to OS and cross-tab changes. An early Vite-injected script resolves the theme before application styles load. Storage denial falls back to an in-memory selection.

```sh
# From repository root
pnpm fmt
pnpm lint
pnpm typecheck
pnpm test:budgie
pnpm test:frappe
pnpm build:budgie
# All workspace tests, including Budgie:
pnpm test
```

Budgie's deterministic tests cover email-code requests and verification, automatic account creation options, typed failures, duplicate submissions, auth initialization/event ordering and disposal, failed logout, routing/traversal decisions, query cache isolation, and theme storage fallback.

References: [local Supabase](https://supabase.com/docs/guides/local-development), [email OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless).

## Budgets

Apply `supabase/migrations` before using budgets. `/` resolves the saved accessible budget or the oldest unarchived budget; `/new` creates a budget; `/budget/<id>` preserves explicit destinations through sign-in. Archived budgets remain readable and offer an unarchived-budget selector or creation link. `/accounts` has been removed.

The pinned Effect release calls its browser storage API `KeyValueStore.layerStorage`. The preferences layer uses it for `budgie.preferences.selected_budget`, serializes writes and logout cleanup, and clears only the private namespace. Public theme preferences survive logout. Budget reads use the Supabase SDK’s default retries, with additional Frappe Query retries disabled; creation is never automatically retried. A client-generated UUID makes manual retries of uncertain creation responses idempotent.

Database authorization and name validation use pgTAP. From the repository root, run them against the local Budgie stack after applying migrations:

```sh
pnpm supabase test db --workdir apps/budgie
```

This script uses two authenticated users plus anonymous requests and rolls back its fixtures. It verifies member/outsider reads and mutations, atomic idempotent creation, duplicate names, trimming, and Unicode code-point length limits.

Budget lists load 50 unarchived budgets at a time. The archived-budget selector exposes a **Load more budgets** button. Each request uses a cursor containing the last budget’s original creation timestamp and ID, ordered by `(created_at, id)`; the adapter never recursively fetches subsequent pages. Saved and explicit budget destinations are looked up directly, and root fallback needs only the first page.
