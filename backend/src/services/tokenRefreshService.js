import { Account } from '../models/Account.js';
import { youtubeService } from './youtubeService.js';
import { instagramService } from './instagramService.js';

/**
 * Background worker that keeps social OAuth access tokens fresh.
 *
 * What it CAN do:
 * - YouTube: refresh access tokens with the stored refresh_token before expiry
 * - Instagram: renew long-lived tokens before the ~60-day cliff
 *
 * What it CANNOT do:
 * - Silently recover after Google/Meta `invalid_grant` / revoked consent
 *   (user must click Reconnect once for a new OAuth grant)
 */
export class TokenRefreshService {
  constructor() {
    this.timer = null;
    this.isRunning = false;
    this.intervalMs = 30 * 60 * 1000; // every 30 minutes
    this.youtubeSkewMs = 30 * 60 * 1000; // refresh YT access token 30m early
  }

  start(intervalMs = this.intervalMs) {
    if (this.timer) return;
    this.intervalMs = intervalMs;
    console.log(`[TokenRefresh] Auto token refresh worker started (interval: ${intervalMs / 60000}m)`);

    // First pass shortly after boot
    setTimeout(() => this.refreshDueAccounts(), 20_000);
    this.timer = setInterval(() => this.refreshDueAccounts(), this.intervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('[TokenRefresh] Auto token refresh worker stopped');
    }
  }

  async refreshDueAccounts({ force = false } = {}) {
    if (this.isRunning) {
      return { skipped: true, reason: 'already_running' };
    }

    this.isRunning = true;
    const summary = {
      checked: 0,
      refreshed: 0,
      skipped: 0,
      failed: 0,
      needsReconnect: [],
      details: [],
    };

    try {
      const accounts = await Account.find({
        isActive: true,
        status: { $in: ['connected', 'error'] },
        platform: { $in: ['youtube', 'instagram'] },
      });

      summary.checked = accounts.length;

      for (const account of accounts) {
        try {
          if (account.platform === 'youtube') {
            const result = await youtubeService.refreshAccessTokenIfNeeded(account, {
              skewMs: this.youtubeSkewMs,
              force,
            });
            if (result.refreshed) {
              summary.refreshed += 1;
              summary.details.push({ id: account._id, platform: 'youtube', name: account.accountName, status: 'refreshed' });
            } else {
              summary.skipped += 1;
              summary.details.push({ id: account._id, platform: 'youtube', name: account.accountName, status: 'ok' });
            }
          } else if (account.platform === 'instagram') {
            const before = account.tokenExpiresAt ? new Date(account.tokenExpiresAt).getTime() : null;
            await instagramService.ensureFreshAccessToken(account);
            await account.save().catch(() => {});
            const after = account.tokenExpiresAt ? new Date(account.tokenExpiresAt).getTime() : null;
            if (before && after && after > before + 60_000) {
              summary.refreshed += 1;
              summary.details.push({ id: account._id, platform: 'instagram', name: account.accountName, status: 'refreshed' });
            } else {
              summary.skipped += 1;
              summary.details.push({ id: account._id, platform: 'instagram', name: account.accountName, status: 'ok' });
            }
          }
        } catch (err) {
          summary.failed += 1;
          const message = err.message || 'refresh failed';
          const needsReconnect = /invalid_grant|Reconnect|expired|revoked|190/i.test(message);
          if (needsReconnect) {
            summary.needsReconnect.push({
              id: account._id,
              platform: account.platform,
              name: account.accountName,
              error: message,
            });
          }
          summary.details.push({
            id: account._id,
            platform: account.platform,
            name: account.accountName,
            status: 'failed',
            error: message,
          });
          console.warn(`[TokenRefresh] ${account.platform} ${account.accountName}: ${message}`);
        }
      }

      console.log(
        `[TokenRefresh] Done — checked:${summary.checked} refreshed:${summary.refreshed} skipped:${summary.skipped} failed:${summary.failed}`
      );
      return summary;
    } catch (err) {
      console.error(`[TokenRefresh] Worker error: ${err.message}`);
      return { ...summary, error: err.message };
    } finally {
      this.isRunning = false;
    }
  }
}

export const tokenRefreshService = new TokenRefreshService();
