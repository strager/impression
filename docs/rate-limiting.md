# Anonymous Session and Proof-of-Work Design

This document defines Impression's anonymous session system using proof-of-work (PoW) challenges and server-side budget credits.

The same mechanism applies to:

- `POST /api/report-pdf`
- `POST /api/summarize`
- `POST /api/reflect-on-answer`
- `POST /api/infer-answers`
- other API endpoints that declare a non-zero budget cost

## Design Decisions

- Use an anonymous bearer token session (`Authorization: Bearer ...`), not cookies, for CSRF prevention.
- Enforce same-origin checks for all API endpoints.
- Do not expose budget totals to clients (no status endpoint).
- Client handles failures as they happen.
- No IP-based limiter.
- No global limiter.
- No concurrency limiter.
- No budget refunds for failed calls.
- Single-node deployment with SQLite.
- PoW credits are tied to the session budget and are not tied to a specific API operation.

## Goals

- Keep the app login-free while requiring anonymous session continuity.
- Make abuse more expensive by requiring PoW to obtain budget credits.
- Keep implementation simple: `429 challenge` + `session verify` + retry.

## Non-goals

- Perfect bot prevention.
- Network-level throttling controls.

## Threat Model

- Automated high-volume calls to expensive APIs.
- Sybil behavior (many anonymous sessions).
- Replay of solved challenge payloads.
- Parallel requests racing budget deduction.

## Terminology

- Session token: random bearer token representing an anonymous server-side session.
- Budget units: abstract server-side credits spent by API calls.
- Challenge-required response: `429` with a challenge payload the client can solve.
- PoW: Proof of Work, per ALTCHA protocol (altcha-lib library).

## API Surface

### Session endpoint

1. `POST /api/session/verify`

- Request:
  - solved challenge payload
  - optional `Authorization: Bearer <token>`
- Behavior:
  - if token is absent/invalid, create a new session and grant bootstrap credits
  - if token is valid, add refresh credits to that session
  - credits are capped; they cannot accumulate forever
- Response:
  - does not include budget totals
  - returns session token if a new session was created

### Business endpoints

- `POST /api/report-pdf`
- `POST /api/summarize`
- `POST /api/reflect-on-answer`
- `POST /api/infer-answers`
- others from the endpoint policy map

Business endpoints can return `429` with challenge payloads when proof is required.

## 429 Challenge Flow

For a budgeted API call:

1. Client calls business endpoint.
2. Server checks token + budget.
3. If token is missing/invalid or budget is insufficient:

- server returns `429 application/problem+json`
- response includes `code: "challenge_required"` and challenge payload

4. Client solves challenge.
5. Client calls `POST /api/session/verify` with solved challenge.
6. Server verifies solution and grants session credits.
   - Client remembers returned session ID for future API calls.
7. Client retries original business endpoint.

This is the same flow regardless of whether the client already had a session token.

## Session Model (Bearer Token, Not Cookie)

- Token format: opaque random string (at least 128 bits entropy, ASCII lowercase
  letters only).
- Transport: `Authorization: Bearer <token>`
- Storage:
  - token stored directly in SQLite (`session_token` primary key); no HMAC-obfuscated session IDs
- Lifetime:
  - update `budget_expires_at` when PoW verified (budget given)
    - on expiry, revoke budget (30 minute retention)
  - update `last_used_at` when session used
    - on expiry, delete session (24 hour retention)

CSRF posture:

- Bearer tokens are not sent automatically by browsers.
- Same-origin checks are still enforced for all API endpoints.

## Budget Model

- Every budgeted endpoint declares `costUnits` in the codebase (defined in .yml or .ts).
- Budget check + deduction is atomic.
- Deduct budget before handler execution.
- No refund on handler failure.
- Budget including `costUnits` is server-only data and is not returned to clients.

When budget is insufficient:

- return `429` with challenge payload and machine-readable code `challenge_required`.
- client solves PoW, verifies, and retries.

## Challenge Model

- Use `altcha-lib >= 1.4.1`.
- Issue short-lived challenges (e.g. 120 seconds) inside 429 responses.
- Persist challenge IDs to prevent replay.
- Reject replayed proofs with `challenge_replayed`.

Challenge scope:

- challenge is for session crediting, not for a specific business endpoint.
- session verification grants credits from server policy:
  - bootstrap credits when creating a session
  - refresh credits when topping up an existing session

## Report Page Behavior

1. Show informational text: "PDF downloads are limited to 3 per day." After a download, show "N of 3 PDF downloads remaining today."
2. User clicks download.
3. Server checks the rolling 24-hour daily limit (max 3 successful PDF downloads). If exceeded, returns `429` with `code: "daily_limit_exceeded"` and a `Retry-After` header (seconds). The UI shows "You've reached the daily download limit. Try again in X hours." and disables the button.
4. If the daily limit has not been reached, the normal budget check runs. If the endpoint returns `429 challenge_required`, run solve -> `/api/session/verify` -> retry once.
5. On success, the `X-Impression-PDF-Downloads-Remaining` header indicates remaining downloads.
6. Do not display numeric budget values.

## PDF Daily Limit

PDF downloads are limited to 3 per rolling 24-hour window per session.

- **Storage:** `pdf_downloads` table (separate from budget model).
- **Check order:** Daily limit is checked **before** the budget check. This avoids wasting budget credits or forcing a PoW challenge when the limit is already hit.
- **Counting rule:** The daily limit increments only after a successful PDF generation (`200`). Failed attempts (`400`/`500`/`502`) do not consume the daily download quota.
- **Headers:** `X-Impression-PDF-Downloads-Remaining` is included on 200, 429 (daily limit), 500, and 502 responses from `/api/report-pdf`. `Retry-After` is included on `daily_limit_exceeded` 429 responses.
- **Circumvention:** Creating a new session resets the daily limit. This is acceptable — the limit prevents casual misuse, not denial-of-service attacks. PoW challenges still provide the DoS protection layer.

## SQLite Schema (Proposed)

```sql
CREATE TABLE session_tokens (
  session_token TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  budget_units INTEGER NOT NULL,
  budget_expires_at INTEGER NOT NULL
);

CREATE TABLE issued_challenges (
  challenge_id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);

CREATE TABLE pdf_downloads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_token TEXT NOT NULL,
  downloaded_at INTEGER NOT NULL
);
CREATE INDEX idx_pdf_downloads_session_time
  ON pdf_downloads (session_token, downloaded_at);
```

Retention:

- purge expired challenge and session rows periodically per inline expiration
  columns

## Request Pipeline

For protected `/api/*` endpoints (excludes `/api/a/*`):

1. Same-origin validation.
2. Determine endpoint policy key.
3. If endpoint is `POST /api/session/verify`:

- verify PoW payload
- create session or refresh credits
- return success (and token if newly created)

4. For business endpoints:

- read bearer token (if present)
- if token missing/invalid or budget insufficient:
  - issue challenge
  - return `429 challenge_required`
- atomically deduct `costUnits`
- execute handler

## Error Contract

Use `application/problem+json` consistently.

Suggested machine-readable codes:

- `origin_not_allowed`
- `challenge_required`
- `challenge_invalid`
- `challenge_replayed`
- `daily_limit_exceeded`
- `session_invalid`
- `internal_error`

## Credits

- initial challenge: +100 credits, high challenge difficulty
- refresh challenge: +100 credits, high challenge difficulty
- session has upper limit of 150 credits
- `/api/report-pdf`: -100 credits (max 3 downloads per rolling 24 hours)
- `/api/summarize`, `/api/reflect-on-answer`, `/api/infer-answers`: -5 credits

## Risks and Tradeoffs

- PoW-only control is weaker than adding IP/global/concurrency limits.
- Distributed attackers can still scale by spending more compute.
- Without network-level throttles, incident response may require temporarily
  raising challenge difficulty or disabling expensive endpoints.
- Scheme complicates debuggability of API calls.
