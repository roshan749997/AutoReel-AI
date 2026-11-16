import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';

/**
 * Render / many cloud hosts advertise broken or partial IPv6 routes.
 * Meta/Google lookups often return AAAA first → ENETUNREACH / ETIMEDOUT.
 * Force IPv4-first DNS + IPv4-only agents for outbound HTTPS.
 */
try {
  dns.setDefaultResultOrder('ipv4first');
  console.log('[Network] DNS result order set to ipv4first');
} catch (err) {
  console.warn(`[Network] Could not set ipv4first DNS order: ${err.message}`);
}

export const ipv4HttpsAgent = new https.Agent({
  family: 4,
  keepAlive: true,
  maxSockets: 50,
  timeout: 30_000,
});

export const ipv4HttpAgent = new http.Agent({
  family: 4,
  keepAlive: true,
  maxSockets: 50,
});
