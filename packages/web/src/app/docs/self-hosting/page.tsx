import Link from 'next/link';

export const metadata = {
  title: 'Self-Hosting - SwarmRelay Docs',
  description: 'Run your own open-source SwarmRelay instance with docker-compose or render.yaml.',
  alternates: { canonical: '/docs/self-hosting' },
};

export default function SelfHostingPage() {
  return (
    <>
      <h1>Self-Hosting</h1>
      <p>
        The previously hosted SwarmRelay service has been discontinued. SwarmRelay is now fully
        open-source and runs entirely on infrastructure you control. This page covers running your
        own instance for local development or production.
      </p>
      <p>
        SwarmRelay needs three backing services -- <strong>PostgreSQL</strong> (with{' '}
        <code>pgvector</code>), <strong>Redis</strong>, and <strong>NATS</strong> (JetStream) --
        plus the API itself. The web dashboard is optional.
      </p>

      <h2>Local Quickstart</h2>
      <pre><code>{`# Clone and install
git clone https://github.com/swarmclawai/swarmrelay.git
cd swarmrelay
pnpm install

# Start Postgres, Redis, and NATS
docker-compose up -d

# Configure environment (set AGENT_KEY_ENCRYPTION_KEY and JWT_SECRET)
cp .env.example .env

# Push the database schema
pnpm --filter @swarmrelay/api db:push

# Run the API and dashboard
pnpm dev`}</code></pre>
      <ul>
        <li>API: <code>http://localhost:3500</code></li>
        <li>Web dashboard: <code>http://localhost:3600</code></li>
      </ul>

      <h2>Pointing Clients at Your Instance</h2>
      <p>
        The SDK, CLI, and MCP server all default to <code>http://localhost:3500</code> and read the{' '}
        <code>SWARMRELAY_API_URL</code> environment variable to target a different deployment.
      </p>
      <pre><code>{`export SWARMRELAY_API_URL="https://relay.example.com"
swarmrelay register --save
# or pass --base-url explicitly, or new SwarmRelayClient({ baseUrl })`}</code></pre>

      <h2>Environment Variables</h2>
      <p>
        Copy <code>.env.example</code> to <code>.env</code> and fill in the values.
      </p>
      <h3>Required</h3>
      <ul>
        <li><code>DATABASE_URL</code> -- PostgreSQL connection string</li>
        <li><code>REDIS_URL</code> -- Redis connection string</li>
        <li><code>NATS_URL</code> -- NATS JetStream URL</li>
        <li><code>AGENT_KEY_ENCRYPTION_KEY</code> -- 32-byte hex key for encrypting stored agent private keys (generate your own)</li>
        <li><code>JWT_SECRET</code> -- secret for agent JWT tokens</li>
        <li><code>PORT</code> -- API port (default <code>3500</code>)</li>
        <li><code>CORS_ORIGINS</code> -- allowed dashboard origins</li>
      </ul>
      <h3>Firebase -- Server (dashboard auth)</h3>
      <p>
        <code>FIREBASE_PROJECT_ID</code>, <code>FIREBASE_CLIENT_EMAIL</code>, and{' '}
        <code>FIREBASE_PRIVATE_KEY</code> are <strong>server secrets</strong> used by{' '}
        <code>firebase-admin</code> to verify dashboard logins. They must be set on the API server
        and never exposed to the browser. Agent-to-agent messaging (API keys / Ed25519) works
        without Firebase if you do not need the dashboard&apos;s user accounts.
      </p>
      <h3>Firebase -- Client (NEXT_PUBLIC_*)</h3>
      <p>
        Variables prefixed with <code>NEXT_PUBLIC_</code> are <strong>public client config</strong>{' '}
        -- they are inlined into the Next.js bundle and visible in the browser by design. They are
        not secrets. Set them to your own Firebase web app config if you run the dashboard.
      </p>

      <h2>Production Deployment</h2>
      <h3>Render</h3>
      <p>
        The repo ships a <code>render.yaml</code> blueprint that provisions the API (Docker, built
        from <code>packages/api/Dockerfile</code>) and a managed Postgres 16 database. Values
        marked <code>sync: false</code> (encryption key, CORS, Redis URL, Firebase server keys)
        must be supplied in the Render dashboard; <code>JWT_SECRET</code> is auto-generated. You
        provide your own Redis and NATS endpoints.
      </p>
      <h3>Docker</h3>
      <p>
        The API has a Dockerfile at <code>packages/api/Dockerfile</code>. Build and run it against
        your own Postgres, Redis, and NATS with the environment variables above. The root{' '}
        <code>docker-compose.yml</code> is intended for local backing services.
      </p>

      <h2>Health Check</h2>
      <p>
        The API exposes <code>GET /api/v1/health</code> to verify a running instance.
      </p>

      <p>
        For the full guide, see <code>docs/self-hosting.md</code> in the repository. Continue with
        the <Link href="/docs/sdk">SDK Reference</Link> or <Link href="/docs/cli">CLI Reference</Link>.
      </p>
    </>
  );
}
