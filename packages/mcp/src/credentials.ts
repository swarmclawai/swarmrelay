import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir, hostname } from 'node:os';
import { SwarmRelayClient } from '@swarmrelay/sdk';

const DEFAULT_API_BASE_URL = 'https://swarmrelay-api.onrender.com';
const DEFAULT_CONFIG_PATH = join(homedir(), '.config', 'swarmrelay', 'mcp.json');

export interface McpCredentials {
  apiKey: string;
  baseUrl: string;
  agentId?: string;
  publicKey?: string;
  privateKey?: string;
  ownerId?: string;
  claimToken?: string;
  claimUrl?: string;
}

export interface LoadOptions {
  configPath?: string;
  baseUrl?: string;
  agentName?: string;
}

export function resolveConfigPath(override?: string): string {
  return override ?? process.env.SWARMRELAY_MCP_CONFIG ?? DEFAULT_CONFIG_PATH;
}

export function readCredentials(configPath: string): McpCredentials | null {
  if (!existsSync(configPath)) return null;
  try {
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<McpCredentials>;
    if (!parsed.apiKey || !parsed.baseUrl) return null;
    return parsed as McpCredentials;
  } catch {
    return null;
  }
}

export function writeCredentials(configPath: string, creds: McpCredentials): void {
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(creds, null, 2));
  try {
    chmodSync(configPath, 0o600);
  } catch {
    // Best-effort on platforms that don't support chmod (Windows).
  }
}

function envCredentials(baseUrlOverride?: string): McpCredentials | null {
  const apiKey = process.env.SWARMRELAY_API_KEY;
  if (!apiKey) return null;
  const baseUrl = baseUrlOverride ?? process.env.SWARMRELAY_API_URL ?? DEFAULT_API_BASE_URL;
  const publicKey = process.env.SWARMRELAY_PUBLIC_KEY;
  const privateKey = process.env.SWARMRELAY_PRIVATE_KEY;
  return {
    apiKey,
    baseUrl,
    ...(publicKey ? { publicKey } : {}),
    ...(privateKey ? { privateKey } : {}),
  };
}

export async function loadOrRegister(options: LoadOptions = {}): Promise<McpCredentials> {
  const configPath = resolveConfigPath(options.configPath);
  const baseUrlOverride = options.baseUrl ?? process.env.SWARMRELAY_API_URL;

  const fromEnv = envCredentials(baseUrlOverride);
  if (fromEnv) {
    console.error(`[swarmrelay-mcp] Using credentials from environment (api: ${fromEnv.baseUrl}).`);
    return fromEnv;
  }

  const fromFile = readCredentials(configPath);
  if (fromFile) {
    const resolved = baseUrlOverride ? { ...fromFile, baseUrl: baseUrlOverride } : fromFile;
    console.error(`[swarmrelay-mcp] Loaded credentials from ${configPath} (agent: ${resolved.agentId ?? 'unknown'}).`);
    return resolved;
  }

  const baseUrl = baseUrlOverride ?? DEFAULT_API_BASE_URL;
  const name = options.agentName ?? `mcp-${hostname().toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 24)}`;
  console.error(`[swarmrelay-mcp] No credentials found. Auto-registering new agent "${name}" at ${baseUrl}...`);

  const response = await SwarmRelayClient.register({ name, baseUrl });

  const creds: McpCredentials = {
    apiKey: response.apiKey,
    baseUrl,
    agentId: response.agentId,
    publicKey: response.publicKey,
    ...(response.privateKey ? { privateKey: response.privateKey } : {}),
    ownerId: response.ownerId,
    claimToken: response.claimToken,
    claimUrl: response.claimUrl,
  };

  writeCredentials(configPath, creds);

  console.error(`[swarmrelay-mcp] Registered agent ${response.agentId}. Credentials saved to ${configPath}.`);
  console.error(`[swarmrelay-mcp] Claim this agent at: ${response.claimUrl}`);
  console.error(`[swarmrelay-mcp] Claim token: ${response.claimToken}`);

  return creds;
}

export function buildClient(creds: McpCredentials): SwarmRelayClient {
  return new SwarmRelayClient({
    apiKey: creds.apiKey,
    baseUrl: creds.baseUrl,
    publicKey: creds.publicKey,
    privateKey: creds.privateKey,
  });
}
