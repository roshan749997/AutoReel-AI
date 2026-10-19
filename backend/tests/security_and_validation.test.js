import test from 'node:test';
import assert from 'node:assert/strict';
import { generateOAuthState, verifyOAuthState } from '../src/services/cryptoService.js';
import { validateBody } from '../src/middleware/validator.js';
import { AppError } from '../src/middleware/errorHandler.js';
import { Account } from '../src/models/Account.js';
import { requireAdminAuth } from '../src/middleware/auth.js';
import { config } from '../src/config/env.js';

test('OAuth state: HMAC token generates and verifies successfully', () => {
  const state = generateOAuthState('youtube');
  assert.ok(typeof state === 'string');
  assert.ok(state.length > 20);

  const isValid = verifyOAuthState(state, 'youtube');
  assert.equal(isValid, true, 'Valid state for matching platform should verify');
});

test('OAuth state: rejects mismatched platform', () => {
  const state = generateOAuthState('youtube');
  const isValid = verifyOAuthState(state, 'instagram');
  assert.equal(isValid, false, 'Should reject state generated for different platform');
});

test('OAuth state: rejects tampered state payload', () => {
  const state = generateOAuthState('youtube');
  const tampered = state.slice(0, -4) + 'abcd';
  const isValid = verifyOAuthState(tampered, 'youtube');
  assert.equal(isValid, false, 'Should reject tampered signature');
});

test('OAuth state: rejects expired state timestamp', () => {
  const state = generateOAuthState('youtube');
  // Verify with maxAgeMs = -1 (immediate expiration)
  const isValid = verifyOAuthState(state, 'youtube', -1);
  assert.equal(isValid, false, 'Should reject expired state');
});

test('Account model: toSafeJSON() strips encrypted tokens completely', () => {
  const account = new Account({
    platform: 'youtube',
    accountId: 'UC1234567890',
    accountName: 'My Channel',
    username: 'mychannel',
    encryptedAccessToken: 'iv:tag:secret_encrypted_data',
    encryptedRefreshToken: 'iv:tag:refresh_secret_data',
  });

  const safe = account.toSafeJSON();
  assert.equal(safe.encryptedAccessToken, undefined, 'Must not contain encryptedAccessToken');
  assert.equal(safe.encryptedRefreshToken, undefined, 'Must not contain encryptedRefreshToken');
  assert.equal(safe.accountName, 'My Channel');
  assert.equal(safe.accountId, 'UC1234567890');
});

test('Validator middleware: rejects missing required fields with 400', () => {
  const validator = validateBody(['videoId', 'accountId', 'platform', 'title', 'scheduledAt']);
  
  let capturedError = null;
  const mockReq = { body: { videoId: 'vid123', title: 'Test Title' } };
  const mockRes = {};
  const mockNext = (err) => {
    capturedError = err;
  };

  validator(mockReq, mockRes, mockNext);

  assert.ok(capturedError instanceof AppError);
  assert.equal(capturedError.statusCode, 400);
  assert.ok(capturedError.details?.missingFields?.includes('accountId'));
  assert.ok(capturedError.details?.missingFields?.includes('platform'));
  assert.ok(capturedError.details?.missingFields?.includes('scheduledAt'));
});

test('Validator middleware: rejects empty/null request body with 400', () => {
  const validator = validateBody(['title']);
  let capturedError = null;

  validator({ body: null }, {}, (err) => {
    capturedError = err;
  });

  assert.ok(capturedError instanceof AppError);
  assert.equal(capturedError.statusCode, 400);
});

test('Validator middleware: passes valid payload to next()', () => {
  const validator = validateBody(['title', 'category']);
  let nextCalled = false;

  validator(
    { body: { title: 'My Video', category: 'Tech' } },
    {},
    () => {
      nextCalled = true;
    }
  );

  assert.equal(nextCalled, true);
});

test('requireAdminAuth: enforces DASHBOARD_API_KEY when configured', () => {
  const originalKey = config.dashboardApiKey;
  config.dashboardApiKey = 'test_secret_api_key_4444';

  let capturedError = null;
  const mockReq = { headers: { 'x-api-key': 'wrong_key' } };

  requireAdminAuth(mockReq, {}, (err) => {
    capturedError = err;
  });

  assert.ok(capturedError instanceof AppError);
  assert.equal(capturedError.statusCode, 401);

  // Valid key
  let successNextCalled = false;
  const validReq = { headers: { 'x-api-key': 'test_secret_api_key_4444' } };
  requireAdminAuth(validReq, {}, () => {
    successNextCalled = true;
  });

  assert.equal(successNextCalled, true);

  // Restore
  config.dashboardApiKey = originalKey;
});
