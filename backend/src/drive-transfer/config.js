/**
 * Configuration for Drive Transfer only.
 * Prefers DRIVE_TRANSFER_* variables. If those are empty, it reads the existing
 * Google client id and secret for this separate sign-in. It does not change
 * the YouTube OAuth redirect or scopes.
 */

const DEFAULT_SCOPE = 'https://www.googleapis.com/auth/drive';

export function getDriveTransferConfig() {
  const ownClientId = String(process.env.DRIVE_TRANSFER_GOOGLE_CLIENT_ID || '').trim();
  const ownClientSecret = String(process.env.DRIVE_TRANSFER_GOOGLE_CLIENT_SECRET || '').trim();
  const clientId = ownClientId || String(process.env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = ownClientSecret || String(process.env.GOOGLE_CLIENT_SECRET || '').trim();
  const port = String(process.env.PORT || '5000').trim();
  const defaultRedirect = `http://localhost:${port}/api/drive-transfer/oauth/callback`;
  const sharedRedirect = String(process.env.GOOGLE_REDIRECT_URI || '').trim();
  const redirectUri = String(
    process.env.DRIVE_TRANSFER_REDIRECT_URI || (ownClientId ? defaultRedirect : sharedRedirect || defaultRedirect)
  ).trim();
  const scope = String(process.env.DRIVE_TRANSFER_OAUTH_SCOPE || DEFAULT_SCOPE).trim();
  const clientUrl = String(process.env.CLIENT_URL || 'http://localhost:5173').trim();
  const maxFiles = parseInt(process.env.DRIVE_TRANSFER_MAX_FILES || '50000', 10);

  const missingEnv = [];
  if (!clientId) missingEnv.push('GOOGLE_CLIENT_ID');
  if (!clientSecret) missingEnv.push('GOOGLE_CLIENT_SECRET');

  return {
    clientId,
    clientSecret,
    redirectUri,
    scopes: [scope, 'https://www.googleapis.com/auth/userinfo.email'],
    clientUrl,
    maxFiles: Number.isFinite(maxFiles) && maxFiles > 0 ? maxFiles : 50000,
    configured: missingEnv.length === 0,
    missingEnv,
  };
}
