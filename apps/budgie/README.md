# Budgie

Browser-only budgeting app built with Vite, Effect v4, frappe, and Supabase Auth.

## Local setup

Use the repository's Node version (`.nvmrc`) and pnpm. A running Docker-compatible runtime (Docker Desktop or OrbStack) is required. The workspace includes Supabase CLI as a development dependency; this configuration was initialized and checked with CLI **2.120.0**. No hosted project is needed.

From the repository root:

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

Open **http://localhost:5174**. Vite uses a strict port so callbacks stay stable. Use this exact origin throughout a flow; `localhost` and `127.0.0.1` have separate browser storage. Missing configuration produces an actionable startup message.

Local services use the default Supabase ports: API `54321`, Postgres `54322`, Studio `54323`, email inbox `54324`, and shadow database `54320`. Stop another local Supabase stack before starting this one, or coordinate all ports and callback URLs if you change the configuration. Use the URLs printed by `status` as the authority.

From `apps/budgie`, inspect or stop services with:

```sh
pnpm exec supabase status
pnpm exec supabase stop
```

## Email authentication

Open the local **Mailpit inbox at http://127.0.0.1:54324**. No external SMTP credentials are needed; local email is captured rather than delivered.

- `/login` is the sign-in page. `/signup` is the separate account-creation page. Password signup leads to `/signup/confirmation`, where you can resend the confirmation email. Open the confirmation link in the same browser that initiated signup, then sign in.
- Request a sign-in code from `/login`, or a signup code from `/signup`. Each opens `/verify-code` for **six-digit code** entry and resend. Sign-in never silently creates users; signup explicitly permits it. Resend preserves that intent. The email and intent are carried in typed URL query parameters so the verification page survives reloads; passwords and codes are never placed in URLs. Codes expire after one hour; invalid/expired codes have a dedicated error.
- `/forgot-password` is a separate recovery-request page. Requests display the same email-sent message whether an account exists. Open the recovery link in the initiating browser. `/reset-password` lets you enter and confirm the new password, then explicitly continue to accounts. Reloading with a valid session opens a fresh form; the saved confirmation is not persisted.
- Logout follows SDK auth events. A failed logout retains the session and displays its error.

Supabase owns session persistence, refresh, and cross-tab synchronization. Budgie uses PKCE with SDK URL detection disabled. Its adapter explicitly exchanges callback codes once and removes consumed query/fragment parameters from history. PKCE links require the initiating browser's stored verifier; expired, reused, rejected, or cross-browser links require starting a new flow. `/auth/callback` handles OAuth and signup; `/reset-password` handles recovery before ordinary route guards.

## GitHub OAuth (optional)

Email development works with GitHub disabled. The UI shows that GitHub is unavailable until the provider is enabled and reported by local Auth.

1. Register a developer-owned GitHub OAuth App. Set its Homepage URL to `http://localhost:5174` and its **Authorization callback URL** to **http://127.0.0.1:54321/auth/v1/callback** (the local Supabase Auth endpoint).
2. Set `SUPABASE_AUTH_EXTERNAL_GITHUB_CLIENT_ID` and `SUPABASE_AUTH_EXTERNAL_GITHUB_SECRET` in the shell that starts Supabase, or in its ignored local `.env`. These are server-side credentials; never prefix them with `VITE_`.
3. Set `enabled = true` in `[auth.external.github]` in `supabase/config.toml` and restart local Supabase (`stop`, then `start`).
4. Use Continue with GitHub. Supabase redirects back to the frontend **http://localhost:5174/auth/callback**. This is distinct from the callback registered with GitHub.

GitHub requires internet access and your own OAuth credentials. If you change origins or ports, update the GitHub App, `site_url`, `additional_redirect_urls`, and the local API URL together.

## Architecture and checks

`src/auth/supabase.ts` is the SDK boundary; UI components depend on the scoped auth resource. Initialization, failed discovery, signed-out, and authenticated states belong to auth. Password recovery uses the ordinary authenticated `/reset-password` route. The page owns its submission and completion state; auth and routing retain no recovery metadata. Completion is not persisted in URLs or storage, and reloads open a fresh form. Supabase validates the session when updating the password; URL parameters never authorize an update. A replaying user stream exposes stable IDs with optional email. Auth identity changes retire frappe's query partition before protected routing is admitted. Same-ID refreshes keep the partition. This cache isolation does **not** replace database authorization.

Theme preference is stored under `budgie.theme`; system mode reacts to OS and cross-tab changes. An early Vite-injected script resolves the theme before application styles load. Storage denial falls back to an in-memory selection.

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

Budgie's deterministic Node tests cover SDK callback ownership, auth initialization/event ordering and disposal, confirmation-pending signup, OTP intent/errors, failed logout, recovery precedence, routing/traversal decisions, real frappe query cache isolation/in-flight retirement, and theme storage fallback.

References: [local Supabase](https://supabase.com/docs/guides/local-development), [email OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless), [password recovery](https://supabase.com/docs/guides/auth/passwords), [GitHub](https://supabase.com/docs/guides/auth/social-login/auth-github), [PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow).

## Financial database

The database schema, protected commands, credit replay, summaries, and application boundary implement [database design 0002](spec/0002_DATABASE_DESIGN.md). See [DATABASE.md](DATABASE.md) for local migration and test commands, RPC payloads, and calculation semantics.
