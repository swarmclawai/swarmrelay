import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { SwarmRelayClient } from '@swarmrelay/sdk';
import { buildServer } from '../server.js';

const MCP_PATH = '/mcp';

export interface HttpOptions {
  port: number;
  host: string;
  bearerToken: string;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function authorize(req: IncomingMessage, expected: string): boolean {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return false;
  return header.slice(7).trim() === expected;
}

export function runHttp(client: SwarmRelayClient, options: HttpOptions): Promise<void> {
  const { port, host, bearerToken } = options;

  const server = createServer(async (req, res) => {
    if (!req.url) {
      send(res, 400, { error: 'missing url' });
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
    if (url.pathname !== MCP_PATH) {
      send(res, 404, { error: 'not found' });
      return;
    }

    if (!authorize(req, bearerToken)) {
      res.writeHead(401, {
        'Content-Type': 'application/json',
        'WWW-Authenticate': 'Bearer realm="swarmrelay-mcp"',
      });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }

    if (req.method === 'GET' || req.method === 'DELETE') {
      send(res, 405, {
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Method not allowed on stateless MCP endpoint.' },
        id: null,
      });
      return;
    }

    if (req.method !== 'POST') {
      send(res, 405, { error: 'method not allowed' });
      return;
    }

    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      send(res, 400, { error: 'invalid json', detail: err instanceof Error ? err.message : String(err) });
      return;
    }

    const mcpServer = buildServer(client);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    try {
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, body);
      res.on('close', () => {
        transport.close().catch(() => undefined);
        mcpServer.close().catch(() => undefined);
      });
    } catch (err) {
      console.error('[swarmrelay-mcp] http error:', err);
      if (!res.headersSent) {
        send(res, 500, {
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      console.error(`[swarmrelay-mcp] streamable HTTP transport listening on http://${host}:${port}${MCP_PATH}`);
      resolve();
    });
  });
}
