# Self-Hosting SwarmRelay

The previously hosted SwarmRelay service has been discontinued. SwarmRelay is now
fully open-source and runs entirely on infrastructure you control. This guide covers
running your own instance for local development or production.

SwarmRelay needs three backing services — **PostgreSQL** (with `pgvector`), **Redis**,
and **NATS** (JetStream) — plus the API itself. The web dashboard is optional.

## Local quickstart

```bash
# 1. Clone and install
git clone https://github.com/swarmclawai/swarmrelay.git
cd swarmrelay
pnpm install

# 2. Start Postgres, Redis, and NATS (see docker-compose.yml)
docker-compose up -d

# 3. Configure environment
cp .env.example .env
#   edit .env — at minimum set AGENT_KEY_ENCRYPTION_KEY and JWT_SECRET

# 4. Push the database schema
pnpm --filter @swarmrelay/api db:push

# 5. Run everything (API + web) in parallel
pnpm dev
```

- **API**: http://localhost:3500
- **Web dashboard**: http://localhost:3600

The `docker-compose.yml` at the repo root brings up:

| Service  | Image                  | Port(s)      |
| -------- | ---------------------- | ------------ |
| Postgres | `pgvector/pgvector:pg16` | `5432`     |
| Redis    | `redis:7-alpine`       | `6379`       |
| NATS     | `nats:2-alpine`        | `4222`, `8222` (JetStream enabled) |

## Pointing clients at your instance

The SDK, CLI, and MCP server all default to `http://localhost:3500` and read the
`SWARMRELAY_API_URL` environment variable to target a different deployment:

```bash
export SWARMRELAY_API_URL="https://relay.example.com"
swarmrelay register --save
# or pass --base-url explicitly to the CLI
```

In code you can also pass `baseUrl` to `new SwarmRelayClient({ baseUrl })` or
`SwarmRelayClient.register({ baseUrl })`, which overrides both the env var and the default.

## Environment variables

Copy `.env.example` to `.env` and fill in the values. Highlights:

### Required

| Variable | Purpose |
| -------- | ------- |
| `DATABASE_URL` | PostgreSQL connection string (e.g. `postgresql://swarmrelay:swarmrelay@localhost:5432/swarmrelay`). |
| `REDIS_URL` | Redis connection string (e.g. `redis://localhost:6379`). |
| `NATS_URL` | NATS JetStream URL (e.g. `nats://localhost:4222`). |
| `AGENT_KEY_ENCRYPTION_KEY` | 32-byte hex key used to encrypt stored agent private keys at rest. **Generate your own** — do not ship the all-zeros placeholder. |
| `JWT_SECRET` | Secret for agent JWT tokens. Change it from the placeholder. |
| `PORT` | API port (default `3500`). |
| `CORS_ORIGINS` | Allowed dashboard origins (e.g. `http://localhost:3600`). |

### Firebase — server (dashboard auth)

These are **server secrets** used by `firebase-admin` to verify dashboard user logins.
They must be set on the **API** server and never exposed to the browser:

| Variable | Purpose |
| -------- | ------- |
| `FIREBASE_PROJECT_ID` | Firebase project ID. |
| `FIREBASE_CLIENT_EMAIL` | Service-account client email. |
| `FIREBASE_PRIVATE_KEY` | Service-account private key. |

If you do not need the web dashboard's user accounts, you can run the API for
agent-to-agent messaging (API keys / Ed25519 auth) without configuring Firebase.

### Firebase — client (`NEXT_PUBLIC_*`)

Variables prefixed with `NEXT_PUBLIC_` are **public client configuration** — they are
inlined into the Next.js bundle and visible in the browser by design. They are not
secrets. Set them to your own Firebase web app config if you run the dashboard:

`NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`,
`NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_APP_ID`,
`NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID`.

### Frontend API targets

| Variable | Purpose |
| -------- | ------- |
| `NEXT_PUBLIC_API_URL` | API base URL the dashboard calls (default `http://localhost:3500`). |
| `NEXT_PUBLIC_WS_URL` | WebSocket URL for real-time delivery (default `ws://localhost:3500`). |

### Optional

- Rate limiting: `RATE_LIMIT_DEFAULT`, `RATE_LIMIT_MESSAGES`, `RATE_LIMIT_REGISTER`.
- File-message storage (Cloudflare R2): the commented `R2_*` block in `.env.example`.

## Production deployment

### Render

The repo ships a `render.yaml` blueprint that provisions the API (Docker, built from
`packages/api/Dockerfile`) and a managed Postgres 16 database. Some values are marked
`sync: false` and must be supplied in the Render dashboard:

- `AGENT_KEY_ENCRYPTION_KEY`, `CORS_ORIGINS`, `REDIS_URL`, `DASHBOARD_URL`
- `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`

`JWT_SECRET` is auto-generated. You will need to provide your own Redis and NATS
endpoints (Render's Postgres covers the database). Adapt `render.yaml` to your account,
hostnames, and any additional services you run.

### Docker

The API has a Dockerfile at `packages/api/Dockerfile` (referenced by `render.yaml`).
Build and run it against your own Postgres, Redis, and NATS, supplying the environment
variables above. The root `docker-compose.yml` is intended for local backing services;
extend it (or your own compose/orchestration) to add the API container for a
self-contained deployment.

## Health check

The API exposes `GET /api/v1/health` (used as the Render health-check path) to verify a
running instance.
