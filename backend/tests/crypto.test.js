import test from 'node:test';
import assert from 'node:assert/strict';
import { encrypt, decrypt } from '../src/services/cryptoService.js';

test('cryptoService: encrypts and decrypts secret token correctly', () => {
  const sampleToken = 'ya29.a0AfH6SMBx_secret_oauth_token_example_12345';
  const encrypted = encrypt(sampleToken);

  assert.notEqual(encrypted, sampleToken, 'Encrypted output should not match plain text');
  assert.match(encrypted, /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/, 'Format should be iv:authTag:encryptedHex');

  const decrypted = decrypt(encrypted);
  assert.equal(decrypted, sampleToken, 'Decrypted token should match original plain text');
});

test('cryptoService: outputs different IVs for same input (probabilistic encryption)', () => {
  const secret = 'same_secret_token';
  const enc1 = encrypt(secret);
  const enc2 = encrypt(secret);

  assert.notEqual(enc1, enc2, 'Two encryptions of same secret must have different IVs');
  assert.equal(decrypt(enc1), secret);
  assert.equal(decrypt(enc2), secret);
});

test('cryptoService: fails gracefully on tampered payload', () => {
  const encrypted = encrypt('my-secret-key');
  const parts = encrypted.split(':');
  // Tamper with encrypted content
  const tampered = `${parts[0]}:${parts[1]}:${parts[2].slice(0, -2)}aa`;

  assert.throws(() => {
    decrypt(tampered);
  }, /Unsupported state or unable to authenticate data|bad decrypt/);
});
