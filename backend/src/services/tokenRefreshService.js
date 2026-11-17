import { Account } from '../models/Account.js';
import { youtubeService } from './youtubeService.js';
import { instagramService } from './instagramService.js';
import { ensureDriveCredentialFresh } from '../drive-transfer/driveClient.js';
import { looksLikeNetworkErrorMessage } from '../utils/networkErrors.js';

/**
 * Background worker that keeps ALL integrations auto-connected:
 * - YouTube access tokens (refresh_token)
 * - Instagram long-lived tokens
 * - Google Drive Transfer tokens
 *
 * Soft-heals `error` status accounts by re-testing / refreshing.
 * Cannot skip Google/Meta consent after a revoked grant (invalid_grant) —
 * user must click Reconnect once in that case.
 */
export class TokenRefreshService {
  constructor() {
    this.timer = null;
    this.isRunning = false;
    this.intervalMs = 15 * 60 * 1000; // every 15 minutes
    this.youtubeSkewMs = 30 * 60 * 1000;
  }

  start(intervalMs = this.intervalMs) {
    if (this.timer) return;
    this.intervalMs = intervalMs;
    console.log(`[TokenRefresh] Auto-connect worker started (interval: ${intervalMs / 60000}m) — YouTube + Instagram + Drive`);

    // Immediately undo false disconnects caused by Render↔Meta network blips
    setTimeout(() => this.healNetworkFalseDisconnects(), 5_000);
    setTimeout(() => this.refreshAllConnections(), 15_000);
    this.timer = setInterval(() => this.refreshAllConnections(), this.intervalMs);
  }

  /**
   * Accounts were wrongly marked error/disconnected when Meta was unreachable.
   * If a token still exists and the error looks like ETIMEDOUT/ENETUNREACH, restore connected.
   */
  async healNetworkFalseDisconnects() {
    try {
      const candidates = await Account.find({
        isActive: true,
        encryptedAccessToken: { $exists: true, $nin: [null, ''] },
        status: { $in: ['error', 'disconnected', 'authorization_required'] },
      });

      let healed = 0;
      for (const account of candidates) {
        const msg = account.errorMessage || '';
        const realAuthFail =
          /invalid_grant|OAuthException|session.*(expired|invalid)|no (access|refresh) token/i.test(msg) &&
          !looksLikeNetworkErrorMessage(msg);
        if (realAuthFail) continue;
        if (!looksLikeNetworkErrorMessage(msg) && account.status !== 'error') continue;
        if (account.status === 'error' && msg && !looksLikeNetworkErrorMessage(msg)) continue;

        account.status = 'connected';
        account.errorMessage = null;
        await account.save();
        healed += 1;
      }

      if (healed > 0) {
        console.log(`[TokenRefresh] Healed ${healed} false disconnect(s) caused by network blips`);
      }
      return { healed };
    } catch (err) {
      console.warn(`[TokenRefresh] healNetworkFalseDisconnects failed: ${err.message}`);
      return { healed: 0, error: err.message };
    }
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('[TokenRefresh] Auto-connect worker stopped');
    }
  }

  async refreshAllConnections({ force = false } = {}) {
    if (this.isRunning) {
      return { skipped: true, reason: 'already_running' };
    }

    this.isRunning = true;
    const summary = {
      checked: 0,
      refreshed: 0,
      healed: 0,
      skipped: 0,
      failed: 0,
      needsReconnect: [],
      drive: null,
      details: [],
    };

    try {
      const falseDisconnectHeal = await this.healNetworkFalseDisconnects();
      summary.healed += falseDisconnectHeal.healed || 0;

      // 1) Drive Transfer — separate from Social Accounts
      try {
        const driveResult = await ensureDriveCredentialFresh({ force, skewMs: this.youtubeSkewMs });
        summary.drive = driveResult;
        if (driveResult.refreshed) summary.refreshed += 1;
        else if (driveResult.connected) summary.skipped += 1;
        else if (driveResult.needsReconnect) {
          summary.failed += 1;
          summary.needsReconnect.push({
            id: 'drive-transfer',
            platform: 'drive',
            name: 'Google Drive Transfer',
            error: driveResult.error || driveResult.reason,
          });
        }
        summary.details.push({ platform: 'drive', ...driveResult });
      } catch (err) {
        summary.failed += 1;
        summary.drive = { connected: false, error: err.message };
        console.warn(`[TokenRefresh] Drive: ${err.message}`);
      }

      // 2) YouTube + Instagram social accounts
      const accounts = await Account.find({
        isActive: true,
        platform: { $in: ['youtube', 'instagram'] },
        status: { $in: ['connected', 'error', 'expired'] },
      });

      summary.checked = accounts.length + 1; // + drive

      for (const account of accounts) {
        try {
          if (account.platform === 'youtube') {
            const result = await youtubeService.refreshAccessTokenIfNeeded(account, {
              skewMs: this.youtubeSkewMs,
              force: force || account.status !== 'connected',
            });

            if (account.status !== 'connected' && result) {
              account.status = 'connected';
              account.errorMessage = null;
              await account.save();
              summary.healed += 1;
              summary.details.push({
                id: account._id,
                platform: 'youtube',
                name: account.accountName,
                status: 'healed',
              });
            } else if (result.refreshed) {
              summary.refreshed += 1;
              summary.details.push({
                id: account._id,
                platform: 'youtube',
                name: account.accountName,
                status: 'refreshed',
              });
            } else {
              summary.skipped += 1;
              summary.details.push({
                id: account._id,
                platform: 'youtube',
                name: account.accountName,
                status: 'ok',
              });
            }
          } else if (account.platform === 'instagram') {
            const beforeStatus = account.status;
            const beforeExpiry = account.tokenExpiresAt ? new Date(account.tokenExpiresAt).getTime() : null;

            // Soft-heal error accounts with a live Graph check
            if (account.status === 'error' || account.status === 'connected') {
              try {
                await instagramService.ensureFreshAccessToken(account);
                const test = await instagramService.testConnection(account);
                if (test.connected) {
                  if (beforeStatus !== 'connected') summary.healed += 1;
                  else {
                    const afterExpiry = account.tokenExpiresAt ? new Date(account.tokenExpiresAt).getTime() : null;
                    if (beforeExpiry && afterExpiry && afterExpiry > beforeExpiry + 60_000) summary.refreshed += 1;
                    else summary.skipped += 1;
                  }
                  summary.details.push({
                    id: account._id,
                    platform: 'instagram',
                    name: account.accountName,
                    status: beforeStatus !== 'connected' ? 'healed' : 'ok',
                  });
                  continue;
                }
              } catch (innerErr) {
                // fall through to failure handling
                throw innerErr;
              }
            }

            // Expired IG: try refresh once; if token already dead, needsReconnect
            await instagramService.ensureFreshAccessToken(account);
            account.status = 'connected';
            account.errorMessage = null;
            await account.save();
            summary.healed += 1;
            summary.details.push({
              id: account._id,
              platform: 'instagram',
              name: account.accountName,
              status: 'healed',
            });
          }
        } catch (err) {
          summary.failed += 1;
          const message = err.message || 'refresh failed';
          const needsReconnect = /invalid_grant|Reconnect|expired|revoked|190|no refresh token|authorization/i.test(
            message
          );
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
        `[TokenRefresh] Auto-connect done — checked:${summary.checked} refreshed:${summary.refreshed} healed:${summary.healed} skipped:${summary.skipped} failed:${summary.failed}`
      );
      return summary;
    } catch (err) {
      console.error(`[TokenRefresh] Worker error: ${err.message}`);
      return { ...summary, error: err.message };
    } finally {
      this.isRunning = false;
    }
  }

  // Back-compat alias used by routes
  async refreshDueAccounts(options = {}) {
    return this.refreshAllConnections(options);
  }
}

export const tokenRefreshService = new TokenRefreshService();
