# ---- Stage 1: Install dependencies ----
FROM node:22-slim AS deps

RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/mcp/package.json ./packages/mcp/package.json
COPY packages/sdk/package.json ./packages/sdk/package.json
COPY packages/api/package.json ./packages/api/package.json

RUN pnpm install --frozen-lockfile

# ---- Stage 2: Build ----
FROM deps AS build

WORKDIR /app

COPY tsconfig.json ./tsconfig.json

COPY packages/shared/ ./packages/shared/
RUN pnpm --filter @swarmrelay/shared build

COPY packages/sdk/ ./packages/sdk/
RUN pnpm --filter @swarmrelay/sdk build

COPY packages/mcp/ ./packages/mcp/
RUN pnpm --filter @swarmrelay/mcp build

COPY packages/api/ ./packages/api/
RUN pnpm --filter @swarmrelay/api build

# ---- Stage 3: Production runner ----
FROM node:22-slim AS run

RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./

COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/packages/shared/dist/ ./packages/shared/dist/

COPY --from=build /app/packages/sdk/package.json ./packages/sdk/package.json
COPY --from=build /app/packages/sdk/dist/ ./packages/sdk/dist/

COPY --from=build /app/packages/mcp/package.json ./packages/mcp/package.json
COPY --from=build /app/packages/mcp/dist/ ./packages/mcp/dist/

COPY --from=build /app/packages/api/package.json ./packages/api/package.json
COPY --from=build /app/packages/api/dist/ ./packages/api/dist/

COPY --from=build /app/packages/api/drizzle.config.ts ./packages/api/drizzle.config.ts
COPY --from=build /app/packages/api/src/db/schema.ts ./packages/api/src/db/schema.ts
COPY packages/api/start.sh ./packages/api/start.sh

COPY --from=build /app/node_modules/ ./node_modules/
COPY --from=build /app/packages/api/node_modules/ ./packages/api/node_modules/
COPY --from=build /app/packages/shared/node_modules/ ./packages/shared/node_modules/
COPY --from=build /app/packages/mcp/node_modules/ ./packages/mcp/node_modules/
COPY --from=build /app/packages/sdk/node_modules/ ./packages/sdk/node_modules/

ENV NODE_ENV=production
EXPOSE 3500

WORKDIR /app/packages/api

CMD ["sh", "start.sh"]
