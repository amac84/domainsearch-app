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

## Simple Email Gate (No Login)

Use this for lightweight access control when sharing the app with a friend.

1. Add an allowlist to `domainsearch-app/.env`:

```bash
EMAIL_GATE_ALLOWED=you@example.com,friend@example.com
```

2. Restart the app.
3. Anyone opening the app will be sent to `/gate` and must enter an allowlisted email.
4. On success, the app sets an access cookie and allows normal app/API use.

Notes:
- This is intentionally simple and not a full authentication system.
- If `EMAIL_GATE_ALLOWED` is empty or missing, the gate is disabled.

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

## Notes

- Domain checks are cached in memory with TTL (`DOMAIN_CHECK_CACHE_TTL_SECONDS`).
- The domain check endpoint path is configurable with `AGENT_DOMAIN_SERVICE_CHECK_PATH` and supports query style (`/api/check`) or path placeholders (`/api/lookup/{base}`, `/api/lookup/{domain}`).
- Availability and pricing are sourced only from your configured domain service (`AGENT_DOMAIN_SERVICE_URL`).
- Server logs are written to `domainsearch-app/logs/app.log` (JSON lines).
- Set `LOG_TO_CONSOLE=1` if you also want logs echoed to the terminal.
- Override the log file location with `LOG_FILE_PATH=/absolute/path/to/file.log`.
- Refinement can be triggered from the UI with “Refine Based on Available”.

