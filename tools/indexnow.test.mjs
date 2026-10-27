import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { INDEXNOW_KEY, DEFAULT_HOST, submitUrlsToIndexNow } from './indexnow.mjs';

test('IndexNow Key Verification File', () => {
  const keyFilePath = path.resolve(process.cwd(), `public/${INDEXNOW_KEY}.txt`);
  assert.ok(fs.existsSync(keyFilePath), `Verification file public/${INDEXNOW_KEY}.txt must exist`);
  const content = fs.readFileSync(keyFilePath, 'utf8').trim();
  assert.equal(content, INDEXNOW_KEY, 'Verification file content must match INDEXNOW_KEY');
});

test('IndexNow Client Contract', async () => {
  assert.equal(typeof submitUrlsToIndexNow, 'function');
  assert.equal(DEFAULT_HOST, 'anihubstream.com');

  await assert.rejects(
    async () => {
      await submitUrlsToIndexNow([]);
    },
    /No URLs provided/,
    'Must throw error when empty URL list is provided'
  );
});
