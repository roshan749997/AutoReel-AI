import { resolveBackendPublicUrl } from '../config/env.js';

class KeepAliveService {
  constructor() {
    this.timer = null;
    this.intervalMs = 10 * 60 * 1000; // 10 minutes (Render spins down after 15m idle)
  }

  start() {
    if (this.timer) return;
    const publicUrl = resolveBackendPublicUrl();

    // Only self-ping if deployed with a public HTTPS URL (e.g. Render production)
    if (!publicUrl || !publicUrl.startsWith('https://')) {
      console.log(`[KeepAlive] Public HTTPS URL not active (${publicUrl || 'local'}). Skipping self-ping in local dev.`);
      return;
    }

    const healthUrl = `${publicUrl}/api/health`;
    console.log(`[KeepAlive] 24/7 Uptime worker started for ${healthUrl} (interval: 10m)`);

    // Initial ping shortly after server boot (after 25s)
    setTimeout(() => this.ping(healthUrl), 25000);

    // Recurring ping every 10 minutes
    this.timer = setInterval(() => this.ping(healthUrl), this.intervalMs);
  }

  async ping(url) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'AutoReel-24x7-KeepAlive/1.0' },
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) {
        console.log(`[KeepAlive] 24/7 self-ping OK (${res.status}) - Render sleep prevented at ${new Date().toISOString()}`);
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
      console.log('[KeepAlive] Stopped 24/7 worker');
    }
  }
}

export const keepAliveService = new KeepAliveService();
