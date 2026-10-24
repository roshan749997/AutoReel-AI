const FOLDER_ID_PATTERN = /^[a-zA-Z0-9_-]{10,}$/;

/**
 * Parse a Google Drive folder URL or raw folder id.
 * File links are rejected. Mime type is confirmed later with the Drive API.
 */
export function parseDriveFolderInput(input) {
  if (input == null || typeof input !== 'string') {
    return fail('Folder URL or ID is required.');
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return fail('Folder URL or ID is required.');
  }

  if (/\/file\/d\//i.test(trimmed) || /\/document\/d\//i.test(trimmed) || /docs\.google\.com/i.test(trimmed)) {
    return fail('That link points to a file, not a folder. Paste a Google Drive folder URL.');
  }

  if (trimmed === 'root') {
    return { ok: true, folderId: 'root' };
  }

  const folderMatch = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folderMatch) {
    return accept(folderMatch[1]);
  }

  const openId = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (openId) {
    return accept(openId[1]);
  }

  if (trimmed.includes('://') || trimmed.includes('/')) {
    return fail('Could not find a folder ID in that URL. Use a link like https://drive.google.com/drive/folders/…');
  }

  return accept(trimmed.split('?')[0].split('#')[0].split('&')[0]);
}

export function isSafeDriveId(value) {
  return value === 'root' || (typeof value === 'string' && FOLDER_ID_PATTERN.test(value));
}

function accept(folderId) {
  if (!isSafeDriveId(folderId)) {
    return fail('Folder ID looks invalid. Paste the full folder URL from Google Drive.');
  }
  return { ok: true, folderId };
}

function fail(message) {
  return { ok: false, code: 'INVALID_FOLDER', message };
}
