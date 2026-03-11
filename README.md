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
- **GoDaddy pricing:** Availability always comes from your domain service (`AGENT_DOMAIN_SERVICE_URL`). To show dollar amounts, this app can use GoDaddy in either of two ways:
  - **Option A – Standard API** ([developer.godaddy.com/doc](https://developer.godaddy.com/doc)): Set `GODADDY_API_KEY` and `GODADDY_API_SECRET` in `.env`. The app calls the [Domain Availability API](https://developer.godaddy.com/doc/endpoint/domains#/availability/available) for each domain your service marks as **available** and merges in the price (and treats price ≥ $20 as premium). Use `GODADDY_OTE=1` for the OTE (sandbox) API. **403 Forbidden** usually means the API requires a GoDaddy account with **50+ domains** or an API/Reseller plan—see [developer.godaddy.com/getstarted](https://developer.godaddy.com/getstarted).
  - **Option B – GoDaddy MCP Server** ([developer.godaddy.com/mcp](https://developer.godaddy.com/mcp)): Public **Domain Search** and **Availability Check** with **no authentication**. Rate limited and read-only; useful if you don’t have API keys or hit 403. This app does not yet call the MCP endpoint (it uses the standard API when keys are set); MCP integration would require implementing the [StreamableHTTP](https://developer.godaddy.com/mcp) transport.
- Server logs are written to `domainsearch-app/logs/app.log` (JSON lines).
- Set `LOG_TO_CONSOLE=1` if you also want logs echoed to the terminal.
- Override the log file location with `LOG_FILE_PATH=/absolute/path/to/file.log`.
- Refinement can be triggered from the UI with “Refine Based on Available”.

