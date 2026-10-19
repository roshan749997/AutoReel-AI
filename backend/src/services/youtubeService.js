import { google } from 'googleapis';
import { config } from '../config/env.js';
import { Account } from '../models/Account.js';
import { WorkflowLog } from '../models/WorkflowLog.js';
import { generateOAuthState } from './cryptoService.js';

export class YouTubeService {
  getOAuthClient() {
    if (!config.google.clientId || !config.google.clientSecret) {
      throw new Error('Google OAuth Client ID and Secret are not configured');
    }
    return new google.auth.OAuth2(
      config.google.clientId,
      config.google.clientSecret,
      config.google.redirectUri
    );
  }

  getAuthUrl(state = null) {
    const oauth2Client = this.getOAuthClient();
    const stateToken = state || generateOAuthState('youtube');
    const scopes = [
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube',
      'https://www.googleapis.com/auth/youtube.readonly',
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/drive.metadata.readonly',
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/userinfo.email',
    ];

    // select_account ensures users can choose between multiple Google accounts independently
    return oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'select_account consent',
      scope: scopes,
      state: stateToken,
    });
  }

  async handleCallback(code) {
    const oauth2Client = this.getOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Retrieve authorized user info (email)
    let googleEmail = null;
    try {
      const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
      const userInfo = await oauth2.userinfo.get();
      googleEmail = userInfo.data?.email || null;
    } catch {
      // Non-fatal if userinfo fails
    }

    // Retrieve all authorized channel(s) with pagination support
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
    const allChannels = [];
    let pageToken = undefined;

    try {
      do {
        const response = await youtube.channels.list({
          part: 'snippet,statistics,status',
          mine: true,
          maxResults: 50,
          pageToken,
        });

        const items = response.data.items || [];
        allChannels.push(...items);
        pageToken = response.data.nextPageToken;
      } while (pageToken);
    } catch (apiErr) {
      const errText = apiErr.message || '';
      const projectId = (config.google.clientId || '').split('-')[0] || '702701632845';
      const enableUrl = `https://console.developers.google.com/apis/api/youtube.googleapis.com/overview?project=${projectId}`;

      if (
        errText.includes('has not been used in project') ||
        errText.includes('is disabled') ||
        errText.includes('Access Not Configured') ||
        apiErr.code === 403
      ) {
        const customErr = new Error(
          `YouTube Data API v3 has not been enabled in Google Cloud Project ${projectId}. Please enable it at: ${enableUrl} then retry.`
        );
        customErr.code = 'API_NOT_ENABLED';
        customErr.projectId = projectId;
        customErr.enableUrl = enableUrl;
        throw customErr;
      }
      throw apiErr;
    }

    if (allChannels.length === 0) {
      const customErr = new Error(
        `No YouTube channel found for the authenticated Google account${
          googleEmail ? ` (${googleEmail})` : ''
        }. Please create a YouTube channel at https://www.youtube.com/create_channel then reconnect.`
      );
      customErr.code = 'NO_CHANNEL_FOUND';
      throw customErr;
    }

    const savedAccounts = [];

    // Save or update an Account record for each real channel returned by the official API
    for (const channel of allChannels) {
      let account = await Account.findOne({ platform: 'youtube', accountId: channel.id });
      if (!account) {
        account = new Account({
          platform: 'youtube',
          accountId: channel.id,
          accountName: channel.snippet.title,
          username: channel.snippet.customUrl || channel.snippet.title,
          profilePictureUrl:
            channel.snippet.thumbnails?.high?.url ||
            channel.snippet.thumbnails?.medium?.url ||
            channel.snippet.thumbnails?.default?.url,
          isDemo: false, // Verified Real Account
          googleEmail,
          metadata: {
            subscriberCount: parseInt(channel.statistics?.subscriberCount || '0', 10),
            videoCount: parseInt(channel.statistics?.videoCount || '0', 10),
          },
        });
      } else {
        account.accountName = channel.snippet.title;
        account.username = channel.snippet.customUrl || channel.snippet.title;
        account.profilePictureUrl =
          channel.snippet.thumbnails?.high?.url ||
          channel.snippet.thumbnails?.medium?.url ||
          channel.snippet.thumbnails?.default?.url;
        account.isDemo = false; // Verified Real Account
        account.googleEmail = googleEmail || account.googleEmail;
        account.metadata.subscriberCount = parseInt(channel.statistics?.subscriberCount || '0', 10);
        account.metadata.videoCount = parseInt(channel.statistics?.videoCount || '0', 10);
        account.status = 'connected';
        account.errorMessage = null;
        account.isActive = true;
      }

      account.setTokens(tokens.access_token, tokens.refresh_token);
      account.tokenExpiresAt = tokens.expiry_date ? new Date(tokens.expiry_date) : undefined;
      account.scopes = tokens.scope ? tokens.scope.split(' ') : [];
      account.lastSyncedAt = new Date();
      await account.save();

      await WorkflowLog.create({
        level: 'success',
        module: 'youtube',
        action: 'account_connected',
        message: `Real YouTube channel "${channel.snippet.title}" (${channel.id}) connected successfully for ${googleEmail || 'Google User'}`,
        metadata: { channelId: channel.id, googleEmail },
      }).catch(() => {});

      savedAccounts.push(account);
    }

    return savedAccounts[0]; // Primary account returned
  }

  async getAuthenticatedClient(account) {
    const oauth2Client = this.getOAuthClient();
    const { accessToken, refreshToken } = account.getTokens();

    oauth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    // Check if token expired and refresh if necessary
    if (account.tokenExpiresAt && new Date() >= new Date(account.tokenExpiresAt)) {
      if (refreshToken) {
        try {
          const { credentials } = await oauth2Client.refreshAccessToken();
          account.setTokens(credentials.access_token, credentials.refresh_token || refreshToken);
          account.tokenExpiresAt = credentials.expiry_date ? new Date(credentials.expiry_date) : undefined;
          account.status = 'connected';
          account.errorMessage = null;
          await account.save();
          oauth2Client.setCredentials(credentials);
        } catch (refreshErr) {
          account.status = 'expired';
          account.errorMessage = `Token refresh failed: ${refreshErr.message}. Reconnect required.`;
          await account.save();
          throw refreshErr;
        }
      } else {
        account.status = 'expired';
        account.errorMessage = 'Token expired and no refresh token available. Reconnect required.';
        await account.save();
        throw new Error(account.errorMessage);
      }
    }

    return google.youtube({ version: 'v3', auth: oauth2Client });
  }

  async testConnection(account = null) {
    if (!config.google.clientId || !config.google.clientSecret) {
      return {
        configured: false,
        connected: false,
        message: 'Google Client ID or Secret not configured in .env',
      };
    }

    if (!account) {
      const activeAccount = await Account.findOne({ platform: 'youtube', status: 'connected', isActive: true });
      if (!activeAccount) {
        return {
          configured: true,
          connected: false,
          message: 'Google credentials configured, but no YouTube account connected yet',
        };
      }
      account = activeAccount;
    }

    try {
      const youtube = await this.getAuthenticatedClient(account);
      const res = await youtube.channels.list({ part: 'snippet,statistics', id: [account.accountId] });
      const channel = res.data.items?.[0];

      if (channel) {
        account.accountName = channel.snippet.title;
        account.username = channel.snippet.customUrl || channel.snippet.title;
        account.profilePictureUrl = channel.snippet.thumbnails?.default?.url;
        account.metadata.subscriberCount = parseInt(channel.statistics?.subscriberCount || '0', 10);
        account.metadata.videoCount = parseInt(channel.statistics?.videoCount || '0', 10);
        account.status = 'connected';
        account.errorMessage = null;
        account.lastSyncedAt = new Date();
        await account.save();
      }

      return {
        configured: true,
        connected: true,
        channelId: channel?.id || account.accountId,
        title: channel?.snippet?.title || account.accountName,
        subscribers: channel?.statistics?.subscriberCount || account.metadata?.subscriberCount,
        message: `YouTube channel active: ${channel?.snippet?.title || account.accountName}`,
      };
    } catch (err) {
      const isAuthError = err.code === 401 || err.message?.includes('invalid_grant') || err.message?.includes('expired');
      account.status = isAuthError ? 'expired' : 'error';
      account.errorMessage = err.message;
      await account.save().catch(() => {});

      return {
        configured: true,
        connected: false,
        status: account.status,
        error: err.message,
        message: `YouTube connection error: ${err.message}`,
      };
    }
  }

  async revokeToken(account) {
    try {
      const { accessToken } = account.getTokens();
      if (accessToken) {
        const oauth2Client = this.getOAuthClient();
        await oauth2Client.revokeToken(accessToken).catch(() => {});
      }
      account.status = 'disconnected';
      account.isActive = false;
      await account.save();
      return true;
    } catch (err) {
      console.warn(`[YouTube] Token revocation notice: ${err.message}`);
      return false;
    }
  }

  /**
   * Uploads a video to YouTube using official Data API v3 resumable upload
   */
  async uploadVideo({ account, mediaStream, title, description, tags, isShort = true, scheduledAt = null }) {
    if (!account) throw new Error('Target account required for YouTube upload');
    if (!mediaStream) throw new Error('Media stream required for YouTube upload');

    const youtube = await this.getAuthenticatedClient(account);

    // 1. Title formatting & strict 100 char limit
    const rawTitle = (title || 'Untitled Video').trim();
    let finalTitle = rawTitle;
    if (isShort && !finalTitle.toLowerCase().includes('#shorts')) {
      if (finalTitle.length + 8 <= 100) {
        finalTitle = `${finalTitle} #Shorts`;
      }
    }
    if (finalTitle.length > 100) {
      finalTitle = finalTitle.substring(0, 97).trim() + '...';
    }

    // 2. Description formatting & fallback
    const rawDesc = (description || '').trim();
    let finalDescription = rawDesc;
    if (!finalDescription) {
      finalDescription = `${finalTitle}\n\n#Shorts #Reels #Viral`;
    } else if (isShort && !finalDescription.toLowerCase().includes('#shorts')) {
      finalDescription = `${finalDescription}\n\n#Shorts`;
    }

    // 3. Tags formatting
    const rawTags = Array.isArray(tags) ? tags : String(tags || '').split(/[\s,]+/).filter(Boolean);
    const finalTags = rawTags.length > 0 ? rawTags.map(t => t.replace(/^#/, '')) : ['Shorts', 'Reels', 'Viral'];

    const statusPayload = {
      privacyStatus: scheduledAt ? 'private' : 'public',
      selfDeclaredMadeForKids: false,
    };

    if (scheduledAt) {
      statusPayload.publishAt = new Date(scheduledAt).toISOString();
    }

    const snippetPayload = {
      title: finalTitle,
      description: finalDescription,
      tags: finalTags,
      categoryId: '24', // Entertainment
    };

    try {
      const res = await youtube.videos.insert(
        {
          part: 'snippet,status',
          notifySubscribers: true,
          requestBody: {
            snippet: snippetPayload,
            status: statusPayload,
          },
          media: {
            body: mediaStream,
          },
        },
        {
          // YouTube API handles streaming automatically
        }
      );

      const videoId = res.data?.id;
      if (!videoId) {
        throw new Error('YouTube API upload completed without returning a video ID');
      }

      return {
        externalPostId: videoId,
        externalUrl: `https://www.youtube.com/watch?v=${videoId}`,
        quotaUnitsUsed: 1600, // Standard video upload cost
      };
    } catch (err) {
      const apiErrorMsg = err.response?.data?.error?.message || err.message;
      const isQuota = apiErrorMsg.toLowerCase().includes('quota') || err.code === 403;
      const isAuth = err.code === 401 || apiErrorMsg.toLowerCase().includes('unauthorized') || apiErrorMsg.toLowerCase().includes('token');

      const customErr = new Error(`YouTube Upload Error: ${apiErrorMsg}`);
      customErr.code = isQuota ? 'QUOTA_EXCEEDED' : isAuth ? 'AUTH_ERROR' : (err.code || 'UPLOAD_FAILED');
      customErr.isPermanent = isQuota || isAuth || err.code === 400;
      throw customErr;
    }
  }

  /**
   * Check if a YouTube video exists, is active, or was rejected/removed
   */
  async checkVideoStatus(account, videoId) {
    if (!videoId) return null;
    try {
      const youtube = await this.getAuthenticatedClient(account);
      const res = await youtube.videos.list({
        part: 'snippet,status',
        id: videoId,
      });

      const item = res.data?.items?.[0];
      if (item) {
        const uploadStatus = item.status?.uploadStatus; // 'uploaded', 'processed', 'rejected', 'failed'
        const rejectionReason = item.status?.rejectionReason; // 'duplicate', 'copyright', 'inappropriate', etc.
        const isRejected = uploadStatus === 'rejected' || !!rejectionReason;

        return {
          exists: true,
          id: item.id,
          title: item.snippet?.title,
          uploadStatus,
          rejectionReason,
          isRejected,
          isRemoved: false,
          privacyStatus: item.status?.privacyStatus,
        };
      }

      // If not returned in videos.list, check channel's uploads playlist for Deleted video / removal indicator
      try {
        const chRes = await youtube.channels.list({ part: 'contentDetails', mine: true });
        const uploadsPlaylistId = chRes.data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
        if (uploadsPlaylistId) {
          const plRes = await youtube.playlistItems.list({
            part: 'snippet,status',
            playlistId: uploadsPlaylistId,
            maxResults: 50,
          });
          const plItem = plRes.data?.items?.find((i) => i.snippet?.resourceId?.videoId === videoId);
          if (plItem) {
            const isDeleted =
              plItem.snippet?.title === 'Deleted video' ||
              plItem.status?.privacyStatus === 'privacyStatusUnspecified';
            return {
              exists: true,
              id: videoId,
              title: plItem.snippet?.title,
              uploadStatus: isDeleted ? 'rejected' : 'unknown',
              rejectionReason: isDeleted ? 'duplicate_or_removed' : null,
              isRejected: isDeleted,
              isRemoved: isDeleted,
            };
          }
        }
      } catch {}

      return {
        exists: false,
        id: videoId,
        isRemoved: true,
        uploadStatus: 'not_found',
      };
    } catch {
      return null;
    }
  }
}

export const youtubeService = new YouTubeService();
