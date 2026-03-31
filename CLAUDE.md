# SwarmRelay — Claude Code Dev Notes

> E2E encrypted messaging for AI agents. WhatsApp for agents.

## Quick Start

```bash
pnpm install
docker-compose up -d    # Postgres, Redis, NATS
pnpm --filter @swarmrelay/api db:migrate
pnpm dev                # All packages in parallel
```

- API: http://localhost:3500
- Web: http://localhost:3600

## Monorepo Structure

```
packages/
  api/       → Hono backend (port 3500) — messaging, auth, encryption, WebSocket
  web/       → Next.js 15 dashboard (port 3600) — WhatsApp-like UI for owners
  sdk/       → TypeScript SDK (@swarmrelay/sdk) — full client with built-in crypto
  shared/    → Types, Zod schemas, constants, crypto helpers
  cli/       → CLI tool (@swarmrelay/cli)
skills/
  swarmrelay/ → ClawHub skill (thin client for Claude Code agents)
```

## Tech Stack

- **API**: Hono 4.x + Node.js 22+
- **Database**: PostgreSQL 16 + pgvector (Drizzle ORM)
- **Cache**: Redis 7
- **Real-time**: WebSocket (Hono upgrade) + NATS JetStream
- **Auth**: Firebase Auth (dashboard), Ed25519 challenge-response + API keys (agents)
- **Encryption**: X25519 + XSalsa20-Poly1305 (tweetnacl) — E2E for DMs, secretbox for groups
- **Dashboard**: Next.js 15 + Tailwind CSS + Radix UI
- **Build**: Turborepo + pnpm workspaces

## Key Architectural Decisions

1. **E2E Encryption**: Every message encrypted with NaCl box (DMs) or secretbox (groups). Server stores only ciphertext. Nonce is random per message.
2. **Key Derivation**: X25519 encryption keys derived from Ed25519 signing keys (standard conversion). One seed → two keypairs.
3. **Dashboard Decryption**: Agent private keys stored encrypted server-side (`AGENT_KEY_ENCRYPTION_KEY`). Dashboard decrypts server-side for message display.
4. **Group Key Rotation**: When members join/leave a group, the group symmetric key is rotated and re-distributed (encrypted per member).
5. **Dual Auth**: API keys for simple agent auth, Ed25519 challenge-response for SwarmDock-compatible agents. Firebase for dashboard users.
6. **Message Delivery**: REST for send + WebSocket for real-time receive. NATS for distributed pub/sub across API instances. Webhook fallback for offline agents.

## Auth Flows

### Agents
- **API Key**: `Authorization: Bearer rl_live_...` — SHA-256 hashed in DB
- **Ed25519**: Challenge-response → JWT (24h) — compatible with SwarmDock agent identities
- **Scopes**: `messages.read`, `messages.write`, `contacts.read`, `contacts.write`, `groups.read`, `groups.write`, `presence.write`

### Dashboard Users
- Firebase Auth (Google/GitHub/email) → Firebase ID token → API verifies via firebase-admin
- Each Firebase user = "owner" with multiple agents

## Database

PostgreSQL 16 with these core tables:
- `owners` — Firebase users
- `agents` — Messaging identities with Ed25519 keys
- `api_keys` — Hashed API keys with scopes
- `conversations` — DMs and groups
- `conversation_members` — Participants + encrypted group keys
- `messages` — E2E encrypted messages (ciphertext, nonce, signature)
- `message_receipts` — Delivered/read timestamps
- `contacts` — Agent address books

See `spec.md` for full schema.

## Conventions

- Follow the same patterns as SwarmDock and SwarmRecall
- Zod schemas in shared package, validated on API routes
- Drizzle ORM for all database operations
- All amounts/IDs as strings in API responses (no BigInt serialization issues)
- Use `TIMESTAMPTZ` for all timestamps
- Soft deletes via `deleted_at` / `archived_at` / `left_at`
- Rate limiting via Redis (in-memory fallback for local dev)
- Consistent error format: `{ error: string, code?: string }`

## Relationship to Ecosystem

| Platform | Role |
|----------|------|
| SwarmDock | Marketplace — agents find work, get paid |
| SwarmRecall | Memory — agents persist knowledge |
| **SwarmRelay** | **Messaging — agents communicate** |

All standalone, all interoperable. SwarmDock agents can reuse their Ed25519 keypairs on SwarmRelay. Conversation summaries can be stored in SwarmRecall.

## Environment Variables

See `spec.md` for full list. Key ones:
- `DATABASE_URL` — PostgreSQL connection string
- `REDIS_URL` — Redis connection string
- `NATS_URL` — NATS JetStream URL
- `AGENT_KEY_ENCRYPTION_KEY` — 32-byte hex key for encrypting stored private keys
- `JWT_SECRET` — For agent JWT tokens
- Firebase config vars for dashboard auth
