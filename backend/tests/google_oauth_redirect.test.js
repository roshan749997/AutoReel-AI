import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveGoogleRedirectUri, config } from '../src/config/env.js';
import { youtubeService } from '../src/services/youtubeService.js';

test('OAuth Config: resolveGoogleRedirectUri overrides frontend URL to backend callback', () => {
  const origEnv = process.env.GOOGLE_REDIRECT_URI;
  const origClient = process.env.CLIENT_URL;
  const origRender = process.env.RENDER_EXTERNAL_URL;

  try {
    // Case 1: Misconfigured with new frontend domain
    process.env.CLIENT_URL = 'https://autoreel-ai-1-aevj.onrender.com';
    process.env.GOOGLE_REDIRECT_URI = 'https://autoreel-ai-1-aevj.onrender.com/api/accounts/google/callback';
    process.env.RENDER_EXTERNAL_URL = 'https://autoreel-ai-fs3l.onrender.com';

    const resolved = resolveGoogleRedirectUri();
    assert.equal(resolved, 'https://autoreel-ai-fs3l.onrender.com/api/accounts/google/callback');

    // Case 2: Correct backend URL
    process.env.GOOGLE_REDIRECT_URI = 'https://autoreel-ai-fs3l.onrender.com/api/accounts/google/callback';
    assert.equal(resolveGoogleRedirectUri(), 'https://autoreel-ai-fs3l.onrender.com/api/accounts/google/callback');

    // Case 3: Legacy frontend hostname still rewritten
    process.env.CLIENT_URL = 'https://autoreel-ai-1.onrender.com';
    process.env.GOOGLE_REDIRECT_URI = 'https://autoreel-ai-1.onrender.com/api/accounts/google/callback';
    assert.equal(resolveGoogleRedirectUri(), 'https://autoreel-ai-fs3l.onrender.com/api/accounts/google/callback');

    // Case 4: Localhost URL
    delete process.env.RENDER_EXTERNAL_URL;
    process.env.CLIENT_URL = 'http://localhost:5173';
    process.env.GOOGLE_REDIRECT_URI = 'http://localhost:5000/api/accounts/google/callback';
    assert.equal(resolveGoogleRedirectUri(), 'http://localhost:5000/api/accounts/google/callback');
  } finally {
    process.env.GOOGLE_REDIRECT_URI = origEnv;
    process.env.CLIENT_URL = origClient;
    if (origRender) process.env.RENDER_EXTERNAL_URL = origRender;
    else delete process.env.RENDER_EXTERNAL_URL;
  }
});

test('YouTube Service: Auth URL contains only YouTube scopes and correct redirect_uri', () => {
  const authUrl = youtubeService.getAuthUrl('test_state_token');
  const urlObj = new URL(authUrl);

  // Scopes check
  const scopes = (urlObj.searchParams.get('scope') || '').split(' ');
  assert.ok(scopes.includes('https://www.googleapis.com/auth/youtube.upload'));
  assert.ok(scopes.includes('https://www.googleapis.com/auth/youtube'));
  assert.ok(scopes.includes('https://www.googleapis.com/auth/youtube.readonly'));

  // Ensure Drive and personal profile scopes are NOT present
  assert.ok(!scopes.some((s) => s.includes('/auth/drive')));
  assert.ok(!scopes.some((s) => s.includes('/auth/userinfo')));
  assert.ok(!scopes.includes('openid'));

  // Redirect URI check
  assert.equal(urlObj.searchParams.get('redirect_uri'), config.google.redirectUri);
  assert.equal(urlObj.searchParams.get('state'), 'test_state_token');
});
