import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseDriveFolderInput, isSafeDriveId } from '../src/drive-transfer/folderId.js';
import {
  decideFileAction,
  progressPercent,
  assertSafeParent,
  findExistingFolder,
} from '../src/drive-transfer/planner.js';
import { classifyDriveError } from '../src/drive-transfer/errors.js';
import { generateOAuthState, verifyOAuthState } from '../src/services/cryptoService.js';
import { DriveTransferCredential } from '../src/drive-transfer/models.js';

const here = path.dirname(fileURLToPath(import.meta.url));

test('Drive Transfer: extracts a folder id from a Drive folder URL', () => {
  const parsed = parseDriveFolderInput('https://drive.google.com/drive/folders/1tFYup0QoUlXgMeDkbPSgbmvnY72TxnGb?usp=sharing');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.folderId, '1tFYup0QoUlXgMeDkbPSgbmvnY72TxnGb');
});

test('Drive Transfer: accepts a raw folder id and the My Drive root alias', () => {
  assert.equal(parseDriveFolderInput('1AbCdEfGhIjKlMnOpQrSt').ok, true);
  assert.deepEqual(parseDriveFolderInput('root'), { ok: true, folderId: 'root' });
  assert.equal(isSafeDriveId("1AbCdEfGhIjKlMnOpQrSt' or name contains '"), false);
});

test('Drive Transfer: rejects file links and empty input', () => {
  const fileLink = parseDriveFolderInput('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrSt/view');
  assert.equal(fileLink.ok, false);
  assert.match(fileLink.message, /folder/i);
  assert.equal(parseDriveFolderInput('   ').ok, false);
  assert.equal(parseDriveFolderInput('https://drive.google.com/drive/u/0/search?q=type:folder').ok, false);
});

test('Drive Transfer: duplicate detection never overwrites or deletes', () => {
  const same = decideFileAction({
    name: 'clip.mp4',
    size: '10',
    md5: 'abc',
    mimeType: 'video/mp4',
    destEntries: [{ name: 'clip.mp4', mimeType: 'video/mp4', size: '10', md5Checksum: 'abc' }],
  });
  assert.equal(same.action, 'skip_duplicate');

  const different = decideFileAction({
    name: 'clip.mp4',
    size: '11',
    md5: 'zzz',
    mimeType: 'video/mp4',
    destEntries: [{ name: 'clip.mp4', mimeType: 'video/mp4', size: '10', md5Checksum: 'abc' }],
  });
  assert.equal(different.action, 'fail');
  assert.equal(different.code, 'DEST_CONFLICT');

  const fresh = decideFileAction({
    name: 'new.mp4',
    size: '4',
    md5: 'q',
    mimeType: 'video/mp4',
    destEntries: [],
  });
  assert.equal(fresh.action, 'copy');
  assert.equal(findExistingFolder('Cuts', [
    { name: 'Cuts', mimeType: 'application/vnd.google-apps.folder', id: 'folder-1' },
  ])?.id, 'folder-1');
});

test('Drive Transfer: progress counts copied, skipped, and failed files', () => {
  assert.equal(progressPercent({ completed: 1, skipped: 1, failed: 0, total: 4, copying: false }), 0);
  assert.equal(progressPercent({ completed: 1, skipped: 1, failed: 2, total: 4, copying: true }), 100);
  assert.equal(progressPercent({ completed: 1, skipped: 0, failed: 0, total: 4, copying: true }), 25);
});

test('Drive Transfer: writes are refused outside the destination allow-list', () => {
  const allowed = new Set(['dest-root']);
  assert.doesNotThrow(() => assertSafeParent('dest-root', allowed));
  assert.throws(() => assertSafeParent('source-root', allowed), /destination folder/);
});

test('Drive Transfer: classifies permission, quota, rate limit, and missing files', () => {
  assert.equal(classifyDriveError({ code: 403, errors: [{ reason: 'userRateLimitExceeded' }] }).code, 'RATE_LIMIT');
  assert.equal(classifyDriveError({ code: 403, errors: [{ reason: 'storageQuotaExceeded' }] }).code, 'QUOTA');
  assert.equal(classifyDriveError({ code: 403, errors: [{ reason: 'insufficientFilePermissions' }] }).code, 'PERMISSION');
  assert.equal(classifyDriveError({ code: 404, errors: [{ reason: 'notFound' }] }).code, 'INACCESSIBLE');
  assert.equal(classifyDriveError({ code: 403, errors: [{ reason: 'cannotCopyFile' }] }).code, 'UNSUPPORTED_COPY');
  assert.match(classifyDriveError({ code: 403, errors: [{ reason: 'insufficientFilePermissions' }] }).message, /not changed/i);
});

test('Drive Transfer: OAuth state is isolated from the YouTube state platform', () => {
  const state = generateOAuthState('drive-transfer');
  assert.equal(verifyOAuthState(state, 'drive-transfer'), true);
  assert.equal(verifyOAuthState(state, 'youtube'), false);
  const youtube = generateOAuthState('youtube');
  assert.equal(verifyOAuthState(youtube, 'drive-transfer'), false);
});

test('Drive Transfer: credential view does not include tokens', () => {
  const credential = new DriveTransferCredential({
    kind: 'operator',
    googleEmail: 'owner@example.com',
    status: 'connected',
  });
  credential.setTokens('access-secret', 'refresh-secret', Date.now() + 1000);
  const safe = credential.toSafeJSON();
  assert.equal(safe.email, 'owner@example.com');
  assert.equal(safe.connected, true);
  assert.equal(JSON.stringify(safe).includes('access-secret'), false);
  assert.equal(JSON.stringify(safe).includes('refresh-secret'), false);
  assert.equal(safe.encryptedAccessToken, undefined);
});

test('Drive Transfer: client code does not delete, update, or trash source files', () => {
  const files = ['driveClient.js', 'worker.js', 'oauth.js'];
  const combined = files.map((name) => fs.readFileSync(path.join(here, '../src/drive-transfer', name), 'utf8')).join('\n');
  assert.equal(/files\.delete/.test(combined), false);
  assert.equal(/files\.update/.test(combined), false);
  assert.equal(/files\.emptyTrash/.test(combined), false);
  assert.equal(/\.download\(/.test(combined), false);
  assert.match(combined, /files\.copy/);
  assert.match(combined, /files\.create/);
});
