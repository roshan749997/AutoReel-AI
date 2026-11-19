import { config, resolveBackendPublicUrl } from '../config/env.js';

class KeepAliveService {
  constructor() {
    this.timer = null;
    this.intervalMs = config.keepAlive?.intervalMs || 14 * 60 * 1000;
  }

  start() {
    if (this.timer) return;

    if (config.keepAlive?.enabled === false) {
      console.log('[KeepAlive] Disabled via KEEP_ALIVE_ENABLED=false (saves bandwidth; Render may sleep after ~15m idle)');
      return;
    }

    const publicUrl = resolveBackendPublicUrl();

    // Only self-ping if deployed with a public HTTPS URL (e.g. Render production)
    if (!publicUrl || !publicUrl.startsWith('https://')) {
      console.log(`[KeepAlive] Public HTTPS URL not active (${publicUrl || 'local'}). Skipping self-ping in local dev.`);
      return;
    }

    const healthUrl = `${publicUrl}/api/health`;
    console.log(
      `[KeepAlive] Uptime worker started for ${healthUrl} (interval: ${Math.round(this.intervalMs / 60000)}m)`
    );

    // Initial ping shortly after server boot (after 25s)
    setTimeout(() => this.ping(healthUrl), 25000);

    this.timer = setInterval(() => this.ping(healthUrl), this.intervalMs);
  }

  async ping(url) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'AutoReel-24x7-KeepAlive/1.0' },
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) {
        console.log(`[KeepAlive] Self-ping OK (${res.status}) at ${new Date().toISOString()}`);
      } else {
        console.warn(`[KeepAlive] Self-ping returned status ${res.status}`);
      }
    } catch (err) {
      console.warn(`[KeepAlive] Self-ping notice (non-fatal): ${err.message}`);
    }
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('[KeepAlive] Stopped');
    }
  }
}

export const keepAliveService = new KeepAliveService();
