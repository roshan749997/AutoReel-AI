import test from 'node:test';
import assert from 'node:assert/strict';
import { instagramService, INSTAGRAM_LOGIN_SCOPES, FACEBOOK_LOGIN_SCOPES } from '../src/services/instagramService.js';
import { config } from '../src/config/env.js';
import { verifyOAuthState } from '../src/services/cryptoService.js';

test('Instagram OAuth: Generates valid Instagram API with Instagram Login URL by default', () => {
  const origAppId = config.meta.appId;
  const origFlow = config.meta.authFlow;
  try {
    config.meta.appId = 'test_meta_app_12345';
    config.meta.authFlow = 'instagram_login';

    const authUrlString = instagramService.getAuthUrl();
    const parsed = new URL(authUrlString);

    // Host & Endpoint verification
    assert.equal(parsed.hostname, 'www.instagram.com', 'Must point to www.instagram.com for Instagram Login');
    assert.equal(parsed.pathname, '/oauth/authorize', 'Must use /oauth/authorize endpoint');

    // Query parameters verification
    assert.equal(parsed.searchParams.get('client_id'), 'test_meta_app_12345');
    assert.equal(parsed.searchParams.get('redirect_uri'), config.meta.redirectUri);
    assert.equal(parsed.searchParams.get('response_type'), 'code');

    // Security state parameter verification
    const state = parsed.searchParams.get('state');
    assert.ok(state, 'Must include HMAC state parameter');
    assert.equal(verifyOAuthState(state, 'instagram'), true, 'State token must be valid for instagram');

    // Strict scope verification — must NOT mix with Facebook Login scopes
    const scopeParam = parsed.searchParams.get('scope') || '';
    const scopes = scopeParam.split(',');

    assert.ok(scopes.includes('instagram_business_basic'), 'Must request instagram_business_basic');
    assert.ok(scopes.includes('instagram_business_content_publish'), 'Must request instagram_business_content_publish');

    // Assert NO legacy or Facebook Login scopes are present
    assert.equal(scopes.includes('pages_show_list'), false, 'Must not include pages_show_list');
    assert.equal(scopes.includes('pages_read_engagement'), false, 'Must not include pages_read_engagement');
    assert.equal(scopes.includes('instagram_basic'), false, 'Must not include instagram_basic');
    assert.equal(scopes.includes('instagram_content_publish'), false, 'Must not include instagram_content_publish without _business_');
  } finally {
    config.meta.appId = origAppId;
    config.meta.authFlow = origFlow;
  }
});

test('Instagram OAuth: Generates valid Facebook Login URL when explicitly configured', () => {
  const origAppId = config.meta.appId;
  const origFlow = config.meta.authFlow;
  try {
    config.meta.appId = 'test_meta_app_12345';
    config.meta.authFlow = 'facebook_login';

    const authUrlString = instagramService.getAuthUrl();
    const parsed = new URL(authUrlString);

    // Host & Endpoint verification
    assert.equal(parsed.hostname, 'www.facebook.com', 'Must point to www.facebook.com for Facebook Login');
    assert.equal(parsed.pathname, '/v20.0/dialog/oauth', 'Must use Facebook dialog/oauth endpoint');

    // Query parameters verification
    assert.equal(parsed.searchParams.get('client_id'), 'test_meta_app_12345');
    assert.equal(parsed.searchParams.get('redirect_uri'), config.meta.redirectUri);
    assert.equal(parsed.searchParams.get('response_type'), 'code');

    // Scopes verification
    const scopeParam = parsed.searchParams.get('scope') || '';
    const scopes = scopeParam.split(',');

    assert.ok(scopes.includes('instagram_basic'), 'Must request instagram_basic');
    assert.ok(scopes.includes('instagram_content_publish'), 'Must request instagram_content_publish');
    assert.ok(scopes.includes('pages_show_list'), 'Must request pages_show_list');
    assert.ok(scopes.includes('pages_read_engagement'), 'Must request pages_read_engagement');

    // Assert NO Instagram Login scopes are present
    assert.equal(scopes.includes('instagram_business_basic'), false, 'Must not include instagram_business_basic');
    assert.equal(scopes.includes('instagram_business_content_publish'), false, 'Must not include instagram_business_content_publish');
  } finally {
    config.meta.appId = origAppId;
    config.meta.authFlow = origFlow;
  }
});

test('Instagram OAuth: Strictly avoids mixing scopes between flows', () => {
  // Check scope constant definitions
  const intersection = INSTAGRAM_LOGIN_SCOPES.filter((s) => FACEBOOK_LOGIN_SCOPES.includes(s));
  assert.equal(intersection.length, 0, 'Instagram Login and Facebook Login scope sets must be mutually disjoint');
});

test('Instagram OAuth: Throws when META_APP_ID is not configured', () => {
  const origAppId = config.meta.appId;
  try {
    config.meta.appId = '';
    assert.throws(() => {
      instagramService.getAuthUrl();
    }, /Meta App ID is not configured/);
  } finally {
    config.meta.appId = origAppId;
  }
});

test('Instagram OAuth: Correctly routes Graph API base URL per account authFlow', () => {
  const igAccount = {
    metadata: { authFlow: 'instagram_login' },
  };
  const fbAccount = {
    metadata: { authFlow: 'facebook_login' },
  };
  const defaultAccount = {
    metadata: {},
  };

  assert.equal(instagramService._getGraphBase(igAccount), 'https://graph.instagram.com/v20.0');
  assert.equal(instagramService._getGraphBase(fbAccount), 'https://graph.facebook.com/v20.0');
  assert.equal(instagramService._getGraphBase(defaultAccount), 'https://graph.instagram.com/v20.0');
});
