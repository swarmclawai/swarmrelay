#!/usr/bin/env node
import { Command } from 'commander';
import { SwarmRelayClient } from '@swarmrelay/sdk';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const CONFIG_DIR = join(homedir(), '.config', 'swarmrelay');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

interface Config {
  apiKey?: string;
  baseUrl?: string;
}

function loadConfig(): Config {
  try {
    if (existsSync(CONFIG_FILE)) {
      return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
    }
  } catch {}
  return {};
}

function saveConfig(config: Config) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

function getClient(): SwarmRelayClient {
  const config = loadConfig();
  const apiKey = process.env.SWARMRELAY_API_KEY ?? config.apiKey;
  const baseUrl = process.env.SWARMRELAY_API_URL ?? config.baseUrl ?? 'http://localhost:3500';
  if (!apiKey) {
    console.error('No API key configured. Run: swarmrelay register --save');
    process.exit(1);
  }
  return new SwarmRelayClient({ apiKey, baseUrl });
}

function output(data: unknown) {
  console.log(JSON.stringify(data, null, 2));
}

const program = new Command();

program
  .name('swarmrelay')
  .description('SwarmRelay CLI — encrypted messaging for AI agents')
  .version('0.1.0');

// --- Register ---
program
  .command('register')
  .description('Register a new agent')
  .option('--name <name>', 'Agent name')
  .option('--save', 'Save API key to config')
  .option('--base-url <url>', 'API base URL', 'http://localhost:3500')
  .action(async (opts) => {
    try {
      const result = await SwarmRelayClient.register({
        name: opts.name,
        baseUrl: opts.baseUrl,
      });
      output(result);
      if (opts.save) {
        const config = loadConfig();
        config.apiKey = result.apiKey;
        config.baseUrl = opts.baseUrl;
        saveConfig(config);
        console.error('\nAPI key saved to config.');
      }
      console.error(`\nClaim your agent at: ${result.claimUrl}`);
    } catch (err) {
      console.error('Registration failed:', (err as Error).message);
      process.exit(1);
    }
  });

// --- Config ---
const configCmd = program.command('config').description('Manage configuration');

configCmd
  .command('set-key <key>')
  .description('Save API key to config')
  .action((key) => {
    const config = loadConfig();
    config.apiKey = key;
    saveConfig(config);
    console.log('API key saved.');
  });

configCmd
  .command('set-url <url>')
  .description('Save base URL to config')
  .action((url) => {
    const config = loadConfig();
    config.baseUrl = url;
    saveConfig(config);
    console.log('Base URL saved.');
  });

configCmd
  .command('show')
  .description('Show current config')
  .action(() => {
    const config = loadConfig();
    output({ ...config, apiKey: config.apiKey ? `${config.apiKey.slice(0, 16)}...` : undefined });
  });

// --- Login (alias for config set-key) ---
program
  .command('login')
  .description('Login with API key')
  .requiredOption('--api-key <key>', 'API key')
  .action((opts) => {
    const config = loadConfig();
    config.apiKey = opts.apiKey;
    saveConfig(config);
    console.log('Logged in. API key saved.');
  });

// --- Send ---
program
  .command('send')
  .description('Send a message')
  .requiredOption('--to <agentId>', 'Recipient agent ID')
  .argument('<message>', 'Message text')
  .action(async (message, opts) => {
    try {
      const client = getClient();
      // Create or find DM conversation
      const conv = await client.conversations.create({ type: 'dm', members: [opts.to] });
      // For now, send plaintext as ciphertext (proper encryption requires privateKey)
      const msg = await client.messages.send({
        conversationId: conv.id,
        ciphertext: Buffer.from(message).toString('base64'),
        nonce: Buffer.from('0'.repeat(48), 'hex').toString('base64'),
        signature: Buffer.from('0'.repeat(128), 'hex').toString('base64'),
      });
      output(msg);
    } catch (err) {
      console.error('Send failed:', (err as Error).message);
      process.exit(1);
    }
  });

// --- Conversations ---
program
  .command('conversations')
  .description('List conversations')
  .option('--limit <n>', 'Limit', '20')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.conversations.list({ limit: parseInt(opts.limit) });
      output(result);
    } catch (err) {
      console.error('Failed:', (err as Error).message);
      process.exit(1);
    }
  });

// --- Messages ---
program
  .command('messages')
  .description('List messages in a conversation')
  .requiredOption('--conversation <id>', 'Conversation ID')
  .option('--limit <n>', 'Limit', '20')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.messages.list(opts.conversation, { limit: parseInt(opts.limit) });
      output(result);
    } catch (err) {
      console.error('Failed:', (err as Error).message);
      process.exit(1);
    }
  });

// --- Group ---
const groupCmd = program.command('group').description('Group management');

groupCmd
  .command('create')
  .description('Create a group conversation')
  .requiredOption('--name <name>', 'Group name')
  .requiredOption('--members <ids>', 'Comma-separated agent IDs')
  .action(async (opts) => {
    try {
      const client = getClient();
      const members = opts.members.split(',').map((s: string) => s.trim());
      const group = await client.conversations.createGroup({ name: opts.name, members });
      output(group);
    } catch (err) {
      console.error('Failed:', (err as Error).message);
      process.exit(1);
    }
  });

// --- Presence ---
program
  .command('presence')
  .description('Check agent presence')
  .requiredOption('--contact <agentId>', 'Agent ID to check')
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.presence.get(opts.contact);
      output(result);
    } catch (err) {
      console.error('Failed:', (err as Error).message);
      process.exit(1);
    }
  });

// --- Contacts ---
const contactsCmd = program.command('contacts').description('Contact management');

contactsCmd
  .command('list')
  .description('List contacts')
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.contacts.list();
      output(result);
    } catch (err) {
      console.error('Failed:', (err as Error).message);
      process.exit(1);
    }
  });

contactsCmd
  .command('add <agentId>')
  .description('Add a contact')
  .action(async (agentId) => {
    try {
      const client = getClient();
      const result = await client.contacts.add({ agentId });
      output(result);
    } catch (err) {
      console.error('Failed:', (err as Error).message);
      process.exit(1);
    }
  });

// --- Directory ---
program
  .command('directory')
  .description('Search agent directory')
  .argument('<query>', 'Search query')
  .action(async (query) => {
    try {
      const client = getClient();
      const result = await client.request<{ data: unknown[] }>('GET', '/api/v1/directory', undefined, { q: query });
      output(result);
    } catch (err) {
      console.error('Failed:', (err as Error).message);
      process.exit(1);
    }
  });

program.parse();
