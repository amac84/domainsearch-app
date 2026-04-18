## Domainsearch Naming Lab

AI-powered brand name generator with live domain availability checks and iterative refinement.

## Getting Started

1. Install dependencies:

```bash
npm install
```

2. Create local environment file in `domainsearch-app`:

```bash
cd domainsearch-app
cp .env.example .env
# or: copy .env.example .env   (Windows)
```

3. Edit `domainsearch-app/.env` and set `OPENAI_API_KEY` to your real API key from [platform.openai.com/api-keys](https://platform.openai.com/account/api-keys). Use the full key (starts with `sk-...`); do not leave a placeholder like `your_openai_key_here`. No quotes or spaces around `=`.

4. Run the dev server (from repo root or from `domainsearch-app`):

```bash
npm run dev
```

Next.js loads `.env` from the `domainsearch-app` folder. If you run from the repo root, the script changes into `domainsearch-app` first so the correct `.env` is used. Restart the dev server after changing `.env`.

Open `http://localhost:3000`.

## Deploying to Vercel

This folder is the Next.js app. If the Vercel project root is the **repo** root, builds fail with a missing `.next/routes-manifest.json`. Set **Root Directory** to `domainsearch-app` in the Vercel project settings, or run the CLI from this folder. See [`../VERCEL.md`](../VERCEL.md).

## Suggestion Box -> Linear

The left sidebar includes a suggestion box that opens issues directly in a Linear project.

Required environment variables:

```bash
LINEAR_API_KEY=lin_api_...
LINEAR_PROJECT_ID=<project-id>
```

Optional:

```bash
LINEAR_SUGGESTION_STATE_ID=<state-id>
LINEAR_SUGGESTION_LABEL_IDS=<label-id-1>,<label-id-2>
LINEAR_WEBHOOK_SECRET=<long-random-secret>
```

Notes:
- The API route resolves the project team automatically from `LINEAR_PROJECT_ID`.
- Each suggestion includes authenticated user context (ID/email) in the issue body.
- Feedback submissions are stored per user in `feedback_submissions`.
- The API reuses an existing open linked issue when users submit the same normalized title, so multiple users can be tied to one issue.
- Configure a Linear webhook to `POST /api/webhooks/linear` to sync completed/fixed status back into the app.
- The webhook endpoint verifies `Linear-Signature` using `LINEAR_WEBHOOK_SECRET` (from the webhook's signing secret).

## Supabase Authentication + Account Data

This app now requires sign-in and supports:
- Google login
- Email magic-link login
- Account-scoped saved names and search history

### Required environment variables

Add these to `domainsearch-app/.env`:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SUPABASE_SERVICE_ROLE_KEY
```

### Required Supabase setup

1. In Supabase Auth providers, enable:
   - Google
   - Email (magic link)
2. In Supabase URL configuration, add these redirect URLs:
   - `http://localhost:3000/auth/callback`
   - your production callback URL (for deployment)
3. Run the SQL in `docs/supabase-schema.sql` (or `docs/supabase-feedback-loop-migration.sql` if you're upgrading) in Supabase SQL Editor to create tables + RLS policies.

After setup, users sign in at `/auth`, and saved ideas/history sync to their own account.

## API

### `POST /api/generate`

Request body:

```json
{
  "description": "AI finance copilot for freelancers",
  "industry": "fintech",
  "tone": "premium",
  "maxLength": 10,
  "maxSyllables": 3,
  "avoidDictionaryWords": true,
  "avoidWords": ["mint", "ledger"],
  "tlds": ["com", "io", "co"],
  "temperature": 0.7,
  "count": 100,
  "includePrefixVariants": false
}
```

Response:

```json
{
  "names": [
    {
      "base": "zorvia",
      "domains": [
        { "domain": "zorvia.com", "available": true, "status": "available", "source": "api" }
      ],
      "score": 115
    }
  ],
  "meta": {
    "generatedCount": 100,
    "checkedDomains": 300,
    "availabilityRate": 0.17,
    "refined": false
  }
}

```

## Push `.env` to Vercel (CLI)

Vercel does not read your local `.env` in production. To sync variables without using the dashboard:

1. From `domainsearch-app`, run `npx vercel login` and `npx vercel link` once (pick your team and project).
2. Dry run: `npm run vercel:push-env:dry`
3. Push to **Production** only (default): `npm run vercel:push-env`
4. Push to all environments: `npm run vercel:push-env -- --all`

Options are documented in `scripts/push-env-to-vercel.mjs` (`--file`, `--env`, `--dry-run`, `--no-force`, etc.). Values containing `#` are preserved (split on the first `=` only).

**Security:** This uploads every line in the file to Vercel. Do not run it from a machine you don’t trust; rotate any keys that may have leaked.

## Notes

- Domain checks are cached in memory with TTL (`DOMAIN_CHECK_CACHE_TTL_SECONDS`). Optional speed tuning: `DOMAIN_CHECK_CONCURRENCY` (default 20, max 40) and `DOMAIN_CHECK_CHUNK_DELAY_MS` (default 10 ms between chunks).
- **Provider:** set `DOMAIN_CHECK_PROVIDER=whoisxml` and `WHOISXML_API_KEY` to use [WhoisXML Domain Availability API](https://domain-availability.whoisxmlapi.com/api/documentation/making-requests) instead of a custom HTTP lookup (free tier includes a small number of lookups). Otherwise leave unset or `http` and configure `AGENT_DOMAIN_SERVICE_URL` / `AGENT_DOMAIN_SERVICE_CHECK_PATH`.
- For `http`, the check path is configurable with `AGENT_DOMAIN_SERVICE_CHECK_PATH` and supports query style (`/api/check`) or path placeholders (`/api/lookup/{base}`, `/api/lookup/{domain}`).
- Availability (and optional price fields when present) come from the active provider. WhoisXML returns registration availability only, not retail price.
- **Local dev without a live agent host:** with `npm run dev` (`NODE_ENV=development`), set `DOMAIN_CHECK_DEV_STUB=available` (or `1` / `true`) or `DOMAIN_CHECK_DEV_STUB=taken` in `.env` to skip HTTP checks and use synthetic availability. This is ignored in production builds; do not set it on Vercel.
- Server logs are written to `domainsearch-app/logs/app.log` (JSON lines).
- Set `LOG_TO_CONSOLE=1` if you also want logs echoed to the terminal.
- Override the log file location with `LOG_FILE_PATH=/absolute/path/to/file.log`.
- Refinement can be triggered from the UI with “Refine Based on Available”.

