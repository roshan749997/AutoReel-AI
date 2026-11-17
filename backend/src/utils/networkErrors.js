/**
 * Detect transient outbound network failures (common on Render ↔ Meta/Google).
 * These are NOT OAuth/token failures and must never force "Reconnect".
 */
export function isTransientNetworkError(err) {
  if (!err) return false;

  const chunks = [
    err.code,
    err.errno,
    err.syscall,
    err.message,
    err.cause?.code,
    err.cause?.message,
  ];

  if (Array.isArray(err.errors)) {
    for (const nested of err.errors) {
      chunks.push(nested?.code, nested?.message, nested?.errno);
    }
  }

  const haystack = chunks.filter(Boolean).join(' ');
  return /ETIMEDOUT|ENETUNREACH|ECONNRESET|EAI_AGAIN|ECONNREFUSED|EHOSTUNREACH|UND_ERR_CONNECT_TIMEOUT|socket hang up|network|timeout|connect /i.test(
    haystack
  );
}

export function looksLikeNetworkErrorMessage(message = '') {
  return /ETIMEDOUT|ENETUNREACH|ECONNRESET|EAI_AGAIN|ECONNREFUSED|EHOSTUNREACH|Temporary network|IPv4 retry|socket hang up|connect E/i.test(
    String(message || '')
  );
}
