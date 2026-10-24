import { google } from 'googleapis';
import { getDriveTransferConfig } from './config.js';
import { DriveTransferCredential } from './models.js';
import { isSafeDriveId } from './folderId.js';
import { assertSafeParent } from './planner.js';
import { withDriveBackoff } from './errors.js';

const FOLDER_MIME = 'application/vnd.google-apps.folder';

export function createOAuthClient() {
  const cfg = getDriveTransferConfig();
  if (!cfg.configured) {
    const error = new Error(
      `Drive Transfer OAuth is not configured. Set ${cfg.missingEnv.join(' and ')} in backend/.env. This is separate from GOOGLE_CLIENT_ID.`
    );
    error.statusCode = 400;
    error.code = 'TRANSFER_NOT_CONFIGURED';
    throw error;
  }
  return new google.auth.OAuth2(cfg.clientId, cfg.clientSecret, cfg.redirectUri);
}

export async function getAuthorizedDrive() {
  const credential = await DriveTransferCredential.findOne({ kind: 'operator', status: 'connected' });
  if (!credential) {
    const error = new Error('Connect Drive Transfer before copying. This does not use the YouTube account connection.');
    error.statusCode = 401;
    error.code = 'TRANSFER_AUTH_REQUIRED';
    throw error;
  }

  const oauth2 = createOAuthClient();
  const tokens = credential.getTokens();
  oauth2.setCredentials({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    expiry_date: credential.tokenExpiresAt ? new Date(credential.tokenExpiresAt).getTime() : undefined,
  });

  oauth2.on('tokens', (next) => {
    if (!next?.access_token) return;
    credential.setTokens(next.access_token, next.refresh_token || null, next.expiry_date || null);
    credential.status = 'connected';
    credential.save().catch(() => {});
  });

  return {
    drive: google.drive({ version: 'v3', auth: oauth2 }),
    oauth2,
    credential,
  };
}

export async function getFolderMetadata(drive, folderId) {
  assertDriveId(folderId);
  const res = await withDriveBackoff(() => drive.files.get({
    fileId: folderId,
    supportsAllDrives: true,
    fields: 'id, name, mimeType, trashed, capabilities, parents, shortcutDetails, driveId',
  }));
  return res.data;
}

export async function listChildrenPage(drive, folderId, pageToken) {
  assertDriveId(folderId);
  const res = await withDriveBackoff(() => drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    pageSize: 100,
    pageToken: pageToken || undefined,
    fields: 'nextPageToken, files(id, name, mimeType, size, md5Checksum, shortcutDetails, capabilities)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    spaces: 'drive',
  }));
  return {
    files: res.data.files || [],
    nextPageToken: res.data.nextPageToken || null,
  };
}

/**
 * Server-side copy. The file bytes stay on Google's servers.
 * parentId must already be in the destination allow-list.
 */
export async function copyFile(drive, { fileId, name, parentId, allowedParentIds }) {
  assertDriveId(fileId);
  assertSafeParent(parentId, allowedParentIds);
  const res = await withDriveBackoff(() => drive.files.copy({
    fileId,
    supportsAllDrives: true,
    fields: 'id, name, mimeType, size',
    requestBody: {
      name,
      parents: [parentId],
    },
  }));
  return res.data;
}

/**
 * Create a folder under a destination parent. Never called with a source folder id.
 */
export async function createFolder(drive, { name, parentId, allowedParentIds }) {
  assertSafeParent(parentId, allowedParentIds);
  const res = await withDriveBackoff(() => drive.files.create({
    supportsAllDrives: true,
    fields: 'id, name, mimeType',
    requestBody: {
      name,
      mimeType: FOLDER_MIME,
      parents: [parentId],
    },
  }));
  return res.data;
}

function assertDriveId(value) {
  if (!isSafeDriveId(value)) {
    const error = new Error('Refusing a Drive id that failed validation.');
    error.code = 'INVALID_FOLDER';
    throw error;
  }
}
