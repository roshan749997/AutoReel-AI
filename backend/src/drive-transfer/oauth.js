import { google } from 'googleapis';
import { generateOAuthState, verifyOAuthState } from '../services/cryptoService.js';
import { getDriveTransferConfig } from './config.js';
import { DriveTransferCredential } from './models.js';
import { createOAuthClient } from './driveClient.js';

const STATE_PLATFORM = 'drive-transfer';

export function buildAuthUrl() {
  const cfg = getDriveTransferConfig();
  const oauth2 = createOAuthClient();
  const state = generateOAuthState(STATE_PLATFORM);
  const authUrl = oauth2.generateAuthUrl({
    access_type: 'offline',
    prompt: 'select_account consent',
    scope: cfg.scopes,
    state,
    include_granted_scopes: false,
  });
  return { authUrl, redirectUri: cfg.redirectUri, scopes: cfg.scopes };
}

export function verifyTransferState(state) {
  return verifyOAuthState(state, STATE_PLATFORM);
}

export async function exchangeAuthCode(code) {
  const oauth2 = createOAuthClient();
  const { tokens } = await oauth2.getToken(code);
  oauth2.setCredentials(tokens);

  let email = null;
  let userId = null;
  try {
    const oauth2Api = google.oauth2({ version: 'v2', auth: oauth2 });
    const profile = await oauth2Api.userinfo.get();
    email = profile.data?.email || null;
    userId = profile.data?.id || null;
  } catch {
    email = null;
  }

  let credential = await DriveTransferCredential.findOne({ kind: 'operator' });
  if (!credential) {
    credential = new DriveTransferCredential({ kind: 'operator' });
  }

  credential.setTokens(tokens.access_token, tokens.refresh_token || null, tokens.expiry_date || null);
  credential.googleEmail = email;
  credential.googleUserId = userId;
  credential.scopes = tokens.scope ? String(tokens.scope).split(' ') : getDriveTransferConfig().scopes;
  credential.status = 'connected';
  credential.errorMessage = null;
  await credential.save();
  return credential.toSafeJSON();
}

export async function disconnectTransferAccount() {
  const credential = await DriveTransferCredential.findOne({ kind: 'operator' });
  if (!credential) return { connected: false, status: 'disconnected', email: null };
  credential.encryptedAccessToken = undefined;
  credential.encryptedRefreshToken = undefined;
  credential.tokenExpiresAt = undefined;
  credential.status = 'disconnected';
  credential.errorMessage = null;
  await credential.save();
  return credential.toSafeJSON();
}

export async function getTransferAuthStatus() {
  const cfg = getDriveTransferConfig();
  const credential = await DriveTransferCredential.findOne({ kind: 'operator', status: 'connected' });
  const safe = credential ? credential.toSafeJSON() : { connected: false, status: 'disconnected', email: null, scopes: [] };
  return {
    configured: cfg.configured,
    missingEnv: cfg.missingEnv,
    redirectUri: cfg.redirectUri,
    requestedScopes: cfg.scopes,
    ...safe,
  };
}
