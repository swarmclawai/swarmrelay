#!/usr/bin/env node
import { Command } from 'commander';
import { buildClient, loadOrRegister } from './credentials.js';
import { buildServer } from './server.js';
import { runStdio } from './transports/stdio.js';
import { runHttp } from './transports/http.js';

const program = new Command();

program
  .name('swarmrelay-mcp')
  .description('MCP server for SwarmRelay — end-to-end encrypted messaging for AI agents')
  .version('0.2.0')
  .option('--transport <type>', 'Transport: stdio or http', 'stdio')
  .option('--port <number>', 'HTTP port (http transport only)', (v) => Number.parseInt(v, 10), 3700)
  .option('--host <host>', 'HTTP bind address (http transport only)', '0.0.0.0')
  .option('--base-url <url>', 'SwarmRelay API base URL override')
  .option('--config <path>', 'Credentials file path override')
  .option('--agent-name <name>', 'Name used when auto-registering a new agent');

program.parse();

const opts = program.opts<{
  transport: string;
  port: number;
  host: string;
  baseUrl?: string;
  config?: string;
  agentName?: string;
}>();

async function main(): Promise<void> {
  const creds = await loadOrRegister({
    configPath: opts.config,
    baseUrl: opts.baseUrl,
    agentName: opts.agentName,
  });

  const client = buildClient(creds);

  if (opts.transport === 'stdio') {
    const server = buildServer(client);
    await runStdio(server);
    return;
  }

  if (opts.transport === 'http') {
    const bearerToken = process.env.MCP_BEARER_TOKEN;
    if (!bearerToken || bearerToken.length < 16) {
      console.error(
        '[swarmrelay-mcp] MCP_BEARER_TOKEN env var is required for http transport and must be at least 16 characters.',
      );
      process.exit(1);
    }
    await runHttp(client, { port: opts.port, host: opts.host, bearerToken });
    return;
  }

  console.error(`[swarmrelay-mcp] Unknown transport: ${opts.transport}. Use stdio or http.`);
  process.exit(1);
}

main().catch((err) => {
  console.error('[swarmrelay-mcp] Fatal error:', err);
  process.exit(1);
});
