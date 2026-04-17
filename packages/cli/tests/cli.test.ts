import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const cliEntry = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const tsxLoader = fileURLToPath(new URL('../node_modules/tsx/dist/loader.mjs', import.meta.url));

function runCli(args: string[], env: Record<string, string>) {
  return spawnSync(process.execPath, ['--import', tsxLoader, cliEntry, ...args], {
    cwd: packageRoot,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

test('CLI help output renders successfully', () => {
  const result = runCli(['--help'], {});

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: swarmrelay/);
  assert.match(result.stdout, /Commands:/);
});

test('login persists config and config show masks the saved API key', (t) => {
  const tempHome = mkdtempSync(join(tmpdir(), 'swarmrelay-cli-'));
  const env = { HOME: tempHome };
  const apiKey = 'rl_live_test_key_1234567890';
  const configPath = join(tempHome, '.config', 'swarmrelay', 'config.json');

  t.after(() => {
    rmSync(tempHome, { recursive: true, force: true });
  });

  const login = runCli(['login', '--api-key', apiKey], env);
  assert.equal(login.status, 0);
  assert.equal(existsSync(configPath), true);

  const saved = JSON.parse(readFileSync(configPath, 'utf8')) as {
    apiKey: string;
    baseUrl?: string;
  };
  assert.equal(saved.apiKey, apiKey);

  const setUrl = runCli(['config', 'set-url', 'http://relay.local'], env);
  assert.equal(setUrl.status, 0);

  const shown = runCli(['config', 'show'], env);
  assert.equal(shown.status, 0);

  const parsed = JSON.parse(shown.stdout) as { apiKey?: string; baseUrl?: string };
  assert.equal(parsed.baseUrl, 'http://relay.local');
  assert.match(parsed.apiKey ?? '', /^rl_live_test_key/);
  assert.match(parsed.apiKey ?? '', /\.\.\.$/);
});
