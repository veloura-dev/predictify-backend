# predictify-backend

[![CI](https://github.com/omosvico/predictify-backend/actions/workflows/ci.yml/badge.svg)](https://github.com/omosvico/predictify-backend/actions/workflows/ci.yml)

Backend API for **Predictify** — a Stellar/Soroban prediction-markets dApp.

This service indexes on-chain market state from the Predictify Soroban contract, exposes a REST API for the frontend, handles wallet-based authentication, and ships notifications + leaderboards.

## Stack

- **Node.js 20** + **TypeScript**
- **Express** for HTTP
- **Drizzle ORM** + **PostgreSQL** for persistence
- **zod** for env + request validation
- **pino** for structured logging
- **JWT (jsonwebtoken)** for wallet-based session auth
- **Stellar SDK** for Soroban RPC + Horizon
- **Jest** + **supertest** for tests

## Quick start

```bash
cp .env.example .env        # copy the template
# Edit .env — set JWT_SECRET, DATABASE_URL, and PREDICTIFY_CONTRACT_ID
# (all other keys have working testnet defaults)

npm install
npm run check-env           # validate .env before touching the DB
npm run db:migrate
npm run dev                  # predev hook re-runs check-env automatically
```

Once running:

- **Swagger UI** → http://localhost:3000/docs *(non-production only; set `ENABLE_DOCS=true` to enable in production)*
- **OpenAPI JSON** → http://localhost:3000/openapi.json *(always available)*

## Indexer gap scan

The gap-scan worker detects missing ledger ranges in `indexer_events` between the durable cursor and chain tip, emits `indexer_gap_detected_total{from,to}`, and self-heals via `backfillRange`:

```bash
npm run indexer:gap-scan
```

Configure via `INDEXER_GAP_SCAN_INTERVAL_MS`, `INDEXER_REWIND_LEDGERS`, and `INDEXER_BACKFILL_CHUNK_SIZE` in `.env`.

## Layout

```
src/
  config/      env + logger
  routes/      health, markets (more to come)
  services/    domain services
  workers/     indexer gap scan worker
  metrics/     in-process counters (indexer_gap_detected_total)
  middleware/  errorHandler, auth (planned)
  workers/     long-running processes (Soroban indexer)
  db/          drizzle schema, client, repositories
tests/         jest tests
drizzle/       generated migrations + meta
scripts/       dev helpers (check-drizzle-drift.ts)
.github/
  workflows/   CI pipeline (lint, test, drift check, migrate)
```

## Roadmap

This starter is intentionally minimal. The full backlog is tracked in GitHub Issues under the **OFFICIAL CAMPAIGN** label. Major themes:

- Wallet-based auth (Stellar address challenge/signature → JWT)
- Market CRUD + caching layer
- Soroban-RPC indexer with reorg/gap handling
- Predictions + claims endpoints
- Leaderboards & user profiles
- Webhook delivery + DLQ
- Observability (metrics, tracing, /readyz with deep checks)
- OpenAPI spec + contract tests

## Auth Refresh Flow

- `POST /api/auth/refresh` accepts `{ "refreshToken": "<opaque token>" }`, revokes the presented refresh token, and returns a fresh `accessToken` plus a rotated `refreshToken`.
- Refresh tokens are stored only as SHA-256 hashes in the `refresh_tokens` table. The raw bearer token is generated once and is never persisted.
- If a revoked refresh token is presented again, the service treats it as suspected theft and revokes every still-active token in the same `familyId`.
- `POST /api/auth/logout` accepts the same body and revokes the remaining active tokens in that refresh-token family.

## Refresh Token Tests

```bash
npm test -- tests/refreshToken.test.ts
```

The refresh-token test suite covers rotation, expiry handling, reuse detection, logout family revocation, and hash-only storage.

## Social graph

Follow graph mutations are exposed at:

- `POST /api/users/:addr/follow`
- `DELETE /api/users/:addr/follow`

These endpoints require authentication, enforce `users.is_private`, update
cached `followers_count` and `following_count` values transactionally, and
write structured audit entries with the request correlation ID.

## License

MIT
