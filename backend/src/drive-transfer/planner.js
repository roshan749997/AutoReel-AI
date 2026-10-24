const FOLDER_MIME = 'application/vnd.google-apps.folder';

export function isFolderMime(mimeType) {
  return mimeType === FOLDER_MIME;
}

export function isVideoMime(mimeType) {
  return typeof mimeType === 'string' && mimeType.startsWith('video/');
}

export function findExistingFolder(name, destEntries) {
  if (!Array.isArray(destEntries)) return null;
  return destEntries.find((entry) => entry && isFolderMime(entry.mimeType) && entry.name === name) || null;
}

/**
 * Decide what to do with one source file. Never returns an overwrite or delete.
 * Same name plus the same checksum, size, or (for native Google files) mime type
 * is treated as a duplicate and left untouched.
 */
export function decideFileAction({ name, size, md5, mimeType, destEntries }) {
  const entries = Array.isArray(destEntries) ? destEntries : [];
  const existing = entries.find((entry) => entry && entry.name === name && !isFolderMime(entry.mimeType));

  if (!existing) {
    return { action: 'copy' };
  }

  if (isFolderMime(mimeType)) {
    return {
      action: 'fail',
      code: 'DEST_CONFLICT',
      message: `Destination already has an item named "${name}" that is not a folder. It was left unchanged.`,
    };
  }

  const sameMd5 = Boolean(md5 && existing.md5Checksum && md5 === existing.md5Checksum);
  const sameSize = size != null &&
    existing.size != null &&
    String(size) === String(existing.size) &&
    mimeType === existing.mimeType;
  const bothOpaque = !md5 && !existing.md5Checksum && (size == null || existing.size == null) && mimeType === existing.mimeType;

  if (sameMd5 || sameSize || bothOpaque) {
    return {
      action: 'skip_duplicate',
      message: `A file named "${name}" with the same content is already in the destination. It was left unchanged.`,
    };
  }

  return {
    action: 'fail',
    code: 'DEST_CONFLICT',
    message: `Destination already has a different file named "${name}". It was left unchanged.`,
  };
}

export function progressPercent({ completed = 0, skipped = 0, failed = 0, total = 0, copying = false }) {
  if (!copying || !total) return 0;
  const done = completed + skipped + failed;
  return Math.min(100, Math.round((done / total) * 100));
}

/**
 * Refuse to create or copy into any folder that is not the destination root
 * or a folder this job created or reused under that root.
 */
export function assertSafeParent(parentId, allowedParentIds) {
  if (!parentId || !allowedParentIds || !allowedParentIds.has(parentId)) {
    const error = new Error('Refusing to write outside the destination folder. Source files were not changed.');
    error.code = 'UNSAFE_PARENT';
    throw error;
  }
}
