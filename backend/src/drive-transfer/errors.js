const RATE_REASONS = new Set([
  'rateLimitExceeded',
  'userRateLimitExceeded',
  'rateLimitExceededUnreg',
]);

const QUOTA_REASONS = new Set([
  'storageQuotaExceeded',
  'quotaExceeded',
  'dailyLimitExceeded',
  'teamDriveFileLimitExceeded',
  'numChildrenInNonRootLimitExceeded',
  'sharingQuotaExceeded',
]);

const PERMISSION_REASONS = new Set([
  'insufficientFilePermissions',
  'insufficientPermissions',
  'cannotDownloadFile',
  'cannotCopyFile',
  'domainPolicy',
  'fileNotDownloadable',
  'forbidden',
  'appNotAuthorizedToFile',
  'authError',
]);

/**
 * Map a Google API error to a stable code and a message safe to show in the UI.
 */
export function classifyDriveError(err) {
  const status = Number(err?.code || err?.response?.status || err?.statusCode || 0);
  const apiErrors = err?.errors || err?.response?.data?.error?.errors || [];
  const reason = apiErrors[0]?.reason || err?.reason || '';
  const raw = err?.message || 'Google Drive request failed';

  if (status === 429 || RATE_REASONS.has(reason)) {
    return {
      code: 'RATE_LIMIT',
      retryable: true,
      message: 'Google Drive rate limit reached. The transfer waits and retries. Source files were not changed.',
    };
  }

  if (QUOTA_REASONS.has(reason) || /quota exceeded|storage quota/i.test(raw)) {
    return {
      code: 'QUOTA',
      retryable: true,
      message: 'Google Drive quota limit was reached. Free space in the destination account, or wait for the daily limit to reset. Source files were not changed.',
    };
  }

  if (status === 404 || reason === 'notFound') {
    return {
      code: 'INACCESSIBLE',
      retryable: false,
      message: 'This file or folder is inaccessible. It may be a shared item you cannot open, or it was removed. Source files were not changed.',
    };
  }

  if (reason === 'cannotCopyFile' || /cannot be copied|not supported for this file/i.test(raw)) {
    return {
      code: 'UNSUPPORTED_COPY',
      retryable: false,
      message: 'Google Drive cannot copy this file server-side. It was skipped. Source files were not changed.',
    };
  }

  if (status === 401 || reason === 'authError' || /invalid_grant|unauthorized/i.test(raw)) {
    return {
      code: 'AUTH',
      retryable: false,
      message: 'Drive Transfer authorization expired or was revoked. Reconnect Drive Transfer. Existing YouTube sign-in was not changed.',
    };
  }

  if (status === 403 || PERMISSION_REASONS.has(reason) || /permission|forbidden|access/i.test(raw)) {
    return {
      code: 'PERMISSION',
      retryable: true,
      message: 'Missing permission to read or copy this item. Shared files you cannot copy stay in place. Source files were not changed.',
    };
  }

  if (status >= 500) {
    return {
      code: 'DRIVE_UNAVAILABLE',
      retryable: true,
      message: 'Google Drive was temporarily unavailable. Retry the failed items. Source files were not changed.',
    };
  }

  return {
    code: 'DRIVE_ERROR',
    retryable: false,
    message: raw,
  };
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withDriveBackoff(fn, { maxAttempts = 6 } = {}) {
  let delay = 1000;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const classified = classifyDriveError(err);
      err.classified = classified;
      if (classified.code === 'RATE_LIMIT' && attempt < maxAttempts) {
        await sleep(delay);
        delay = Math.min(delay * 2, 32000);
        continue;
      }
      throw err;
    }
  }

  throw lastError;
}
