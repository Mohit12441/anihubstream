import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();

function checkWranglerObservability(relPath) {
  const filePath = path.join(rootDir, relPath);
  assert.ok(fs.existsSync(filePath), `${relPath} must exist`);
  const content = fs.readFileSync(filePath, 'utf8');

  assert.match(
    content,
    /\[observability\.logs\][\s\S]*?enabled\s*=\s*true/,
    `${relPath} must have [observability.logs] with enabled = true`
  );
  assert.match(
    content,
    /\[observability\.logs\][\s\S]*?invocation_logs\s*=\s*true/,
    `${relPath} must have invocation_logs = true`
  );
  assert.match(
    content,
    /\[observability\.traces\][\s\S]*?enabled\s*=\s*false/,
    `${relPath} must have [observability.traces] with enabled = false`
  );
}

test('Wrangler Observability: root wrangler.toml is Pages valid without unsupported observability', () => {
  const filePath = path.join(rootDir, 'wrangler.toml');
  assert.ok(fs.existsSync(filePath), 'wrangler.toml must exist');
  const content = fs.readFileSync(filePath, 'utf8');
  assert.ok(!content.includes('[observability'), 'root wrangler.toml is a Pages project config and must not contain unsupported observability section');
});

test('Wrangler Observability: sync-worker/wrangler.toml configures logs and traces', () => {
  checkWranglerObservability(path.join('sync-worker', 'wrangler.toml'));
});

test('Wrangler Observability: ops/github-sync-dispatcher/wrangler.toml configures logs and traces', () => {
  checkWranglerObservability(path.join('ops', 'github-sync-dispatcher', 'wrangler.toml'));
});
