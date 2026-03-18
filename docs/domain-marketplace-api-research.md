# Domain Marketplace API Research

This research focuses on whether each API can provide currently listed domains (or auctions), whether price data is available, and how practical each source is for an aggregator.

## Comparison Table

| API | Data available | Price data | Auth | Documentation |
| --- | --- | --- | --- | --- |
| GoDaddy Aftermarket / Auctions API | Partner-facing aftermarket actions and auction bid placement (not a broad public listing search endpoint in public swagger) | Yes for bid amounts and listing actions; listing-browse pricing is limited in public docs | `Authorization: sso-key KEY:SECRET` | https://developer.godaddy.com/doc/endpoint/aftermarkets, https://developer.godaddy.com/doc/endpoint/auctions |
| Sedo API | Current domains for sale via `DomainSearch` | Yes (`price`, `currency`) | SOAP/XML credentials (`partnerid`, `signkey`, and account credentials depending on function) | https://api.sedo.com/apidocs/v1/Basic/ |
| Dynadot API | Aftermarket listings, open/closed auctions, backorder auctions (`get_listings`, `get_open_auctions`, etc.) | Yes (listing and auction details include pricing fields) | API key + signature flow (RESTful docs), legacy `key=` for API3 commands | https://www.dynadot.com/domain/api-document, https://www.dynadot.com/domain/api-commands |
| NameSilo API | Marketplace operations are documented at capability level (list/add/modify marketplace sales) | Yes for marketplace sale operations | API key via query params (`/api/OPERATION?...&key=...`) | https://www.namesilo.com/api-reference, https://www.namesilo.com/support/v2/articles/account-options/api-manager |
| Domainr API (deprecated; now Fastly Domain Research) | Domain search + availability/status; can surface aftermarket-like statuses but not a dedicated priced listing feed | Usually no direct listing price in standard status/search responses | `client_id` (enterprise) or RapidAPI key (`mashape-key`) | https://domainr.com/docs/api |
| WhoisXML API | Domain intelligence (availability, WHOIS, reverse lookups, discovery), not a dedicated marketplace listing feed | Not marketplace listing prices; mostly intel/availability data | `apiKey` query parameter | https://domain-availability.whoisxmlapi.com/api/documentation/making-requests |
| NameBio API | Historical domain sales and comps (`checkdomain`, `comps`, `topsales`) | Yes (historical sale price) | POST body auth (`email`, `key`) | https://api.namebio.com/docs/ |

## Per-API Notes

### 1) GoDaddy Aftermarket / Auctions API
- **Currently listed for sale**: public docs primarily expose actions such as adding/removing aftermarket listings and placing bids, not a complete public "search all listings" endpoint in the public swagger snapshots.
- **Price**: available in auction bid/listing-related fields and via separate GoDaddy valuation products.
- **Auth**: `Authorization: sso-key KEY:SECRET`.
- **Rate limits**: 429 is explicitly documented; exact per-minute values are plan-dependent.
- **Example endpoints**:
  - `POST /v1/customers/{customerId}/aftermarket/listings/bids` (auctions swagger)
  - `DELETE /v1/aftermarket/listings?domains=...` (aftermarket swagger/openapi)

### 2) Sedo API
- **Currently listed for sale**: yes, via `DomainSearch`.
- **Price**: yes (`price`, `currency`) in `DomainSearch` result rows.
- **Auth**: SOAP/XML credentials (`partnerid`, `signkey`; fault codes also show username/password validation).
- **Rate limits**: no fixed number published in the fetched docs; throttling/service unavailability appears as `E11`.
- **Example endpoint/function**:
  - `DomainSearch` via `https://api.sedo.com/api/v1/` (SOAP) or XML GET/POST style shown in docs.

### 3) Dynadot API
- **Currently listed for sale**: yes, via aftermarket commands.
- **Price**: yes (listing/auction detail commands provide pricing fields).
- **Auth**: API key and signed headers in RESTful docs; API3 legacy command interface also documented.
- **Rate limits**: documented by tier (for example, Regular: 60/min; Bulk: 600/min; Super Bulk: 6000/min).
- **Example commands/endpoints**:
  - `https://api.dynadot.com/api3.json?key=...&command=get_listings`
  - `https://api.dynadot.com/api3.json?key=...&command=get_open_auctions`

### 4) NameSilo API
- **Currently listed for sale**: marketplace operations are listed (list/add/modify marketplace sales), indicating support.
- **Price**: yes for marketplace sale operations.
- **Auth**: API key in query string.
- **Rate limits**: no explicit global RPM figure in fetched public docs.
- **Example endpoint format**:
  - `https://www.namesilo.com/api/OPERATION?version=1&type=json&key=...`
  - Marketplace operation names are documented in API Manager descriptions (verify exact operation slug in current API reference UI).

### 5) Domainr API (deprecated)
- **Currently listed for sale**: partially (status intelligence can show aftermarket-related states).
- **Price**: not typically exposed by standard `/v2/search` and `/v2/status`.
- **Auth**: `client_id` or RapidAPI key.
- **Rate limits**: plan/provider dependent.
- **Example endpoints**:
  - `GET /v2/search?query=...`
  - `GET /v2/status?domain=...`

### 6) WhoisXML API
- **Currently listed for sale**: no dedicated sale listing feed in the inspected docs.
- **Price**: no marketplace listing price feed in the domain availability product.
- **Auth**: `apiKey` query parameter.
- **Rate limits**: product docs include throttling (for Domain Availability API: max 30 requests/second).
- **Example endpoint**:
  - `GET https://domain-availability.whoisxmlapi.com/api/v1?apiKey=...&domainName=...`

### 7) NameBio API (historical sales)
- **Currently listed for sale**: no (historical sales/comps, not live listings).
- **Price**: yes (historical sale prices and comps).
- **Auth**: POST `email` + `key`.
- **Rate limits**: documented at 30 requests/minute and no multithreading.
- **Example endpoints**:
  - `POST https://api.namebio.com/checkdomain/`
  - `POST https://api.namebio.com/comps/`

## Practical Recommendation for Aggregation

- **Best live listing candidates**: Sedo + Dynadot (+ NameSilo if operation-level docs are accessible in your account context).
- **Best valuation enrichment**: GoDaddy GoValue.
- **Best historical comparable sales**: NameBio.
- **Best intelligence (not pricing/listing)**: Domainr/Fastly + WhoisXML.

## Prototype Provider Env Vars

Use these in `domainsearch-app/.env` for the prototype runner:

- `GODADDY_API_KEY=...`
- `GODADDY_API_SECRET=...`
- `GODADDY_OTE=0` (optional)
- `DYNADOT_API_KEY=...`
- `DYNADOT_API_SECRET=...` (for RESTful API signing if you add that path)
- `DYNADOT_SANDBOX=0` (optional)
- `DYNADOT_CURRENCY=usd` (optional)
- `DOMAINR_CLIENT_ID=...` or `DOMAINR_RAPIDAPI_KEY=...`
- `SEDO_PARTNER_ID=...`
- `SEDO_SIGN_KEY=...`
- `SEDO_API_ENDPOINT=https://api.sedo.com/api/v1/DomainSearch` (optional override)
- `SEDO_TLD=com` (optional)
- `SEDO_KWTYPE=C` (optional; B|C|E)
- `SEDO_LANGUAGE=en` (optional)
- `SEDO_RESULTSIZE=50` (optional)
