import axios from 'axios';
import { config } from '../config/env.js';
import { Account } from '../models/Account.js';
import { WorkflowLog } from '../models/WorkflowLog.js';
import { generateOAuthState } from './cryptoService.js';

// Endpoints for Instagram API with Instagram Login
const INSTAGRAM_LOGIN_AUTH_URL = 'https://www.instagram.com/oauth/authorize';
const INSTAGRAM_LOGIN_TOKEN_URL = 'https://api.instagram.com/oauth/access_token';
const INSTAGRAM_LOGIN_EXCHANGE_URL = 'https://graph.instagram.com/access_token';
const INSTAGRAM_GRAPH_BASE = 'https://graph.instagram.com/v20.0';

// Endpoints for Instagram Graph API with Facebook Login (Legacy / Alternative)
const FACEBOOK_LOGIN_AUTH_URL = 'https://www.facebook.com/v20.0/dialog/oauth';
const FACEBOOK_LOGIN_TOKEN_URL = 'https://graph.facebook.com/v20.0/oauth/access_token';
const FACEBOOK_GRAPH_BASE = 'https://graph.facebook.com/v20.0';

// Scopes per flow — strictly separated to avoid mixing scopes
export const INSTAGRAM_LOGIN_SCOPES = [
  'instagram_business_basic',
  'instagram_business_content_publish',
];

export const FACEBOOK_LOGIN_SCOPES = [
  'instagram_basic',
  'instagram_content_publish',
  'pages_show_list',
  'pages_read_engagement',
];

export class InstagramService {
  /**
   * Determine the configured OAuth flow. Defaults to 'instagram_login'
   */
  getAuthFlow() {
    return (config.meta?.authFlow || 'instagram_login').toLowerCase();
  }

  /**
   * Generates official OAuth 2.0 Authorization URL for Instagram.
   * Strictly aligns URL and scopes to the selected flow (default: Instagram API with Instagram Login)
   * Uses URLSearchParams for strict standard parameter encoding (client_id, redirect_uri, response_type, scope, state).
   */
  getAuthUrl(state = null) {
    if (!config.meta.appId) {
      throw new Error('Meta App ID is not configured');
    }

    const stateToken = state || generateOAuthState('instagram');
    const flow = this.getAuthFlow();

    if (flow === 'facebook_login') {
      const scopes = FACEBOOK_LOGIN_SCOPES.join(',');
      const params = new URLSearchParams();
      params.set('client_id', config.meta.appId);
      params.set('redirect_uri', config.meta.redirectUri);
      params.set('scope', scopes);
      params.set('response_type', 'code');
      params.set('state', stateToken);

      this._logAuthDiagnostics({ flow, endpoint: FACEBOOK_LOGIN_AUTH_URL, params });
      return `${FACEBOOK_LOGIN_AUTH_URL}?${params.toString()}`;
    }

    // Default: Instagram API with Instagram Login
    const scopes = INSTAGRAM_LOGIN_SCOPES.join(',');
    const params = new URLSearchParams();
    params.set('client_id', config.meta.appId);
    params.set('redirect_uri', config.meta.redirectUri);
    params.set('response_type', 'code');
    params.set('scope', scopes);
    params.set('state', stateToken);
    // Instagram otherwise reuses the account already logged in, so Add Instagram
    // refreshes that account instead of saving a different one.
    params.set('force_reauth', 'true');

    this._logAuthDiagnostics({ flow, endpoint: INSTAGRAM_LOGIN_AUTH_URL, params });
    return `${INSTAGRAM_LOGIN_AUTH_URL}?${params.toString()}`;
  }

  /**
   * Safe diagnostic logging for OAuth parameters (masks sensitive values)
   */
  _logAuthDiagnostics({ flow, endpoint, params }) {
    const rawClientId = params.get('client_id') || '';
    const maskedClientId = rawClientId.length > 8
      ? `${rawClientId.slice(0, 4)}...${rawClientId.slice(-4)} (length: ${rawClientId.length})`
      : `${rawClientId.slice(0, 2)}***`;

    const rawState = params.get('state') || '';
    const maskedState = rawState ? `[HMAC token, length: ${rawState.length}]` : '[none]';

    console.log('[Instagram OAuth] Generated Authorization URL:');
    console.log(`  - Flow: ${flow}`);
    console.log(`  - Endpoint: ${endpoint}`);
    console.log(`  - client_id: ${maskedClientId}`);
    console.log(`  - redirect_uri: ${params.get('redirect_uri')}`);
    console.log(`  - scope: ${params.get('scope')}`);
    console.log(`  - response_type: ${params.get('response_type')}`);
    console.log(`  - state: ${maskedState}`);
    console.log(`  - App Secret: ${config.meta.appSecret ? `Present (length: ${config.meta.appSecret.length})` : 'MISSING'}`);
    console.log('  - Tip: For Instagram Login, client_id must be the Instagram App ID under Meta Dashboard -> Use cases -> Customize -> API setup with Instagram login.');
  }

  /**
   * Handles OAuth callback authorization code exchange.
   * Supports both Instagram Login and Facebook Login based on configuration.
   */
  async handleCallback(code) {
    if (!config.meta.appId || !config.meta.appSecret) {
      throw new Error('Meta App credentials are not configured');
    }

    const cleanCode = code ? String(code).replace(/#_$/, '') : '';
    if (!cleanCode) {
      throw new Error('Authorization code is missing');
    }

    const flow = this.getAuthFlow();

    if (flow === 'facebook_login') {
      return this._handleFacebookLoginCallback(cleanCode);
    }

    return this._handleInstagramLoginCallback(cleanCode);
  }

  /**
   * Instagram API with Instagram Login callback handler
   */
  async _handleInstagramLoginCallback(code) {
    // 1. Exchange authorization code for short-lived user token (POST to api.instagram.com)
    const formParams = new URLSearchParams();
    formParams.append('client_id', config.meta.appId);
    formParams.append('client_secret', config.meta.appSecret);
    formParams.append('grant_type', 'authorization_code');
    formParams.append('redirect_uri', config.meta.redirectUri);
    formParams.append('code', code);

    const tokenRes = await axios.post(INSTAGRAM_LOGIN_TOKEN_URL, formParams.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    const shortLivedToken = tokenRes.data?.access_token;
    const igUserId = tokenRes.data?.user_id;

    if (!shortLivedToken) {
      throw new Error('Failed to retrieve Instagram access token');
    }

    // 2. Exchange short-lived token for 60-day long-lived access token
    const longLivedRes = await axios.get(INSTAGRAM_LOGIN_EXCHANGE_URL, {
      params: {
        grant_type: 'ig_exchange_token',
        client_secret: config.meta.appSecret,
        access_token: shortLivedToken,
      },
    });

    const longLivedToken = longLivedRes.data?.access_token;
    const expiresIn = longLivedRes.data?.expires_in; // in seconds (e.g. 5184000)

    if (!longLivedToken) {
      throw new Error('Failed to exchange short-lived token for long-lived Instagram token');
    }

    // 3. Fetch authenticated user profile details from graph.instagram.com
    const profileRes = await axios.get(`${INSTAGRAM_GRAPH_BASE}/me`, {
      params: {
        fields: 'id,username,name,profile_picture_url',
        access_token: longLivedToken,
      },
    });

    const profile = profileRes.data || {};
    const accountId = String(profile.id || igUserId);
    const username = profile.username || `ig_user_${accountId}`;
    const accountName = profile.name || username;

    let created = false;
    let account = await Account.findOne({ platform: 'instagram', accountId });
    if (!account) {
      created = true;
      account = new Account({
        platform: 'instagram',
        accountId,
        accountName,
        username,
        profilePictureUrl: profile.profile_picture_url || null,
        metadata: {
          instagramBusinessId: accountId,
          authFlow: 'instagram_login',
        },
      });
    } else {
      account.accountName = accountName;
      account.username = username;
      if (profile.profile_picture_url) {
        account.profilePictureUrl = profile.profile_picture_url;
      }
      account.metadata = {
        ...account.metadata,
        instagramBusinessId: accountId,
        authFlow: 'instagram_login',
      };
      account.status = 'connected';
      account.errorMessage = null;
      account.isActive = true;
    }

    account.setTokens(longLivedToken);
    account.tokenExpiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : undefined;
    account.lastSyncedAt = new Date();
    await account.save();
    account.createdDuringConnect = created;

    await WorkflowLog.create({
      level: 'success',
      module: 'instagram',
      action: 'account_connected',
      message: created
        ? `Instagram account @${username} (${accountId}) added via Instagram Login`
        : `Instagram account @${username} (${accountId}) was already connected and was refreshed`,
      metadata: { instagramId: accountId, created },
    }).catch(() => {});

    return account;
  }

  /**
   * Legacy Facebook Login callback handler (with Facebook Pages traversal)
   */
  async _handleFacebookLoginCallback(code) {
    const tokenRes = await axios.get(FACEBOOK_LOGIN_TOKEN_URL, {
      params: {
        client_id: config.meta.appId,
        client_secret: config.meta.appSecret,
        redirect_uri: config.meta.redirectUri,
        code,
      },
    });

    const shortLivedToken = tokenRes.data.access_token;

    const longLivedRes = await axios.get(FACEBOOK_LOGIN_TOKEN_URL, {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: config.meta.appId,
        client_secret: config.meta.appSecret,
        fb_exchange_token: shortLivedToken,
      },
    });

    const longLivedToken = longLivedRes.data.access_token;
    const expiresIn = longLivedRes.data.expires_in;

    const pagesRes = await axios.get(`${FACEBOOK_GRAPH_BASE}/me/accounts`, {
      params: {
        access_token: longLivedToken,
        fields: 'id,name,instagram_business_account{id,username,name,profile_picture_url}',
      },
    });

    const pages = pagesRes.data.data || [];
    const pagesWithIg = pages.filter((p) => p.instagram_business_account);

    if (pagesWithIg.length === 0) {
      throw new Error(
        'No Instagram Professional/Business account found linked to your Facebook Pages. Please ensure: 1) Your Instagram account is switched to Professional/Business, 2) It is linked to a Facebook Page you manage, and 3) You granted pages_show_list and instagram_basic permissions.'
      );
    }

    const savedAccounts = [];
    for (const pageWithIg of pagesWithIg) {
      const igAccount = pageWithIg.instagram_business_account;

      let account = await Account.findOne({ platform: 'instagram', accountId: igAccount.id });
      if (!account) {
        account = new Account({
          platform: 'instagram',
          accountId: igAccount.id,
          accountName: igAccount.name || igAccount.username,
          username: igAccount.username,
          profilePictureUrl: igAccount.profile_picture_url,
          metadata: {
            instagramBusinessId: igAccount.id,
            facebookPageId: pageWithIg.id,
            authFlow: 'facebook_login',
          },
        });
      } else {
        account.accountName = igAccount.name || igAccount.username;
        account.username = igAccount.username;
        account.profilePictureUrl = igAccount.profile_picture_url;
        account.metadata = {
          ...account.metadata,
          instagramBusinessId: igAccount.id,
          facebookPageId: pageWithIg.id,
          authFlow: 'facebook_login',
        };
        account.status = 'connected';
        account.errorMessage = null;
        account.isActive = true;
      }

      account.setTokens(longLivedToken);
      account.tokenExpiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : undefined;
      account.lastSyncedAt = new Date();
      await account.save();

      await WorkflowLog.create({
        level: 'success',
        module: 'instagram',
        action: 'account_connected',
        message: `Instagram account @${igAccount.username} (${igAccount.id}) connected successfully via Facebook Login`,
        metadata: { instagramId: igAccount.id },
      }).catch(() => {});

      savedAccounts.push(account);
    }

    return savedAccounts[0];
  }

  /**
   * Helper to resolve the correct Graph API base URL for an account or default flow
   */
  _getGraphBase(account = null) {
    const flow = account?.metadata?.authFlow || this.getAuthFlow();
    return flow === 'facebook_login' ? FACEBOOK_GRAPH_BASE : INSTAGRAM_GRAPH_BASE;
  }

  async testConnection(account = null) {
    if (!config.meta.appId || !config.meta.appSecret) {
      return {
        configured: false,
        connected: false,
        message: 'Meta App ID or Secret not configured in .env',
      };
    }

    if (!account) {
      const activeAccount = await Account.findOne({ platform: 'instagram', status: 'connected', isActive: true });
      if (!activeAccount) {
        return {
          configured: true,
          connected: false,
          message: 'Meta credentials configured, but no Instagram account connected yet',
        };
      }
      account = activeAccount;
    }

    try {
      const { accessToken } = account.getTokens();
      if (!accessToken) {
        account.status = 'authorization_required';
        account.errorMessage = 'No access token available. Please reconnect your account.';
        await account.save();
        return {
          configured: true,
          connected: false,
          status: account.status,
          message: account.errorMessage,
        };
      }

      const graphBase = this._getGraphBase(account);
      const queryEndpoint = account.metadata?.authFlow === 'facebook_login'
        ? `${graphBase}/${account.accountId}`
        : `${graphBase}/me`;

      const res = await axios.get(queryEndpoint, {
        params: {
          fields: 'id,username,name,profile_picture_url',
          access_token: accessToken,
        },
      });

      if (res.data) {
        account.accountName = res.data.name || res.data.username;
        account.username = res.data.username;
        if (res.data.profile_picture_url) {
          account.profilePictureUrl = res.data.profile_picture_url;
        }
        account.status = 'connected';
        account.errorMessage = null;
        account.lastSyncedAt = new Date();
        await account.save();
      }

      return {
        configured: true,
        connected: true,
        username: res.data.username,
        id: res.data.id,
        message: `Instagram account active: @${res.data.username}`,
      };
    } catch (err) {
      const metaError = err.response?.data?.error;
      const isAuthError = metaError?.code === 190 || err.message?.includes('OAuthException');
      account.status = isAuthError ? 'expired' : 'error';
      account.errorMessage = metaError?.message || err.message;
      await account.save().catch(() => {});

      return {
        configured: true,
        connected: false,
        status: account.status,
        error: account.errorMessage,
        message: `Instagram connection error: ${account.errorMessage}`,
      };
    }
  }

  /**
   * Publishes an Instagram Reel using the official 2-step Container Publishing flow
   * Works seamlessly across both Instagram Login and Facebook Login endpoints.
   */
  async publishReel({ account, videoUrl, caption }) {
    const { accessToken } = account.getTokens();
    const igUserId = account.accountId;
    const graphBase = this._getGraphBase(account);

    try {
      // Step 1: Create media container
      const createRes = await axios.post(`${graphBase}/${igUserId}/media`, null, {
        params: {
          media_type: 'REELS',
          video_url: videoUrl,
          caption: caption || '',
          access_token: accessToken,
        },
      });

      const containerId = createRes.data?.id;
      if (!containerId) {
        throw new Error('Meta API did not return a valid container ID');
      }

      // Step 2: Poll container status until FINISHED
      let status = 'IN_PROGRESS';
      let attempts = 0;
      const maxAttempts = 30; // 30 * 5s = 150s

      while (status !== 'FINISHED' && attempts < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        attempts++;

        const statusRes = await axios.get(`${graphBase}/${containerId}`, {
          params: {
            fields: 'status_code,status',
            access_token: accessToken,
          },
        });

        status = statusRes.data?.status_code;
        if (status === 'ERROR') {
          const detail = statusRes.data?.status || 'Media container processing failed';
          throw new Error(`Meta Graph API video container processing failed with status ERROR: ${detail}`);
        }
      }

      if (status !== 'FINISHED') {
        throw new Error('Meta Graph API container processing timed out');
      }

      // Step 3: Publish media container
      const publishRes = await axios.post(`${graphBase}/${igUserId}/media_publish`, null, {
        params: {
          creation_id: containerId,
          access_token: accessToken,
        },
      });

      const publishedMediaId = publishRes.data?.id;
      return {
        externalPostId: publishedMediaId,
        externalUrl: `https://www.instagram.com/p/${publishedMediaId}/`,
        containerId,
      };
    } catch (err) {
      const metaMsg = err.response?.data?.error?.message;
      if (metaMsg) {
        throw new Error(`Meta API Error: ${metaMsg}`);
      }
      throw err;
    }
  }
}

export const instagramService = new InstagramService();
