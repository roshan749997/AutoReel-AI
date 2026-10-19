import test from 'node:test';
import assert from 'node:assert/strict';
import { getDatabaseStatus } from '../src/config/database.js';
import { config } from '../src/config/env.js';

test('database status: returns diagnostic object', () => {
  const status = getDatabaseStatus();
  assert.ok(status !== null, 'Status object should exist');
  assert.ok(typeof status.connected === 'boolean', 'Status should include connected boolean');
  assert.ok(typeof status.state === 'string', 'Status should include state string');
});

test('config: defaults are properly defined', () => {
  assert.equal(typeof config.port, 'number');
  assert.ok(config.port > 0);
  assert.ok(config.ai.provider);
  assert.ok(config.mongoUri);
});
