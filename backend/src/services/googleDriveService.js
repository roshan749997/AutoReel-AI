import { google } from 'googleapis';
import axios from 'axios';
import { config } from '../config/env.js';
import { Account } from '../models/Account.js';
import { Video } from '../models/Video.js';
import { SyncJob } from '../models/SyncJob.js';
import { WorkflowLog } from '../models/WorkflowLog.js';

export function extractFolderId(input) {
  if (!input || typeof input !== 'string') return 'root';
  const trimmed = input.trim();
  if (!trimmed || trimmed === 'root') return 'root';

  // Match /folders/{id} e.g. https://drive.google.com/drive/folders/1tFYup0QoUlXgMeDkbPSgbmvnY72TxnGb
  const folderMatch = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folderMatch) return folderMatch[1];

  // Match ?id={id} e.g. https://drive.google.com/open?id=1tFYup0QoUlXgMeDkbPSgbmvnY72TxnGb
  const idParamMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idParamMatch) return idParamMatch[1];

  // Match /d/{id} e.g. https://drive.google.com/file/d/1tFYup0QoUlXgMeDkbPSgbmvnY72TxnGb
  const fileMatch = trimmed.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (fileMatch) return fileMatch[1];

  // Strip trailing query parameters if raw ID with query params
  return trimmed.split('?')[0].split('&')[0];
}

export class GoogleDriveService {
  constructor() {
    this.oauth2Client = null;
    this.drive = null;
    this.currentAccount = null;
    this.activeJobs = new Map(); // jobId -> { cancelled: boolean }
    this.initClient();
  }

  initClient() {
    if (config.google.clientId && config.google.clientSecret) {
      this.oauth2Client = new google.auth.OAuth2(
        config.google.clientId,
        config.google.clientSecret,
        config.google.redirectUri
      );
      this.drive = google.drive({ version: 'v3', auth: this.oauth2Client });
    }
  }

  setCredentials(tokens) {
    if (!this.oauth2Client) {
      this.initClient();
    }
    if (this.oauth2Client && tokens) {
      this.oauth2Client.setCredentials(tokens);
      this.drive = google.drive({ version: 'v3', auth: this.oauth2Client });
    }
  }

  /**
   * Retrieves an authenticated Google Drive client by checking active connected accounts
   */
  async getAuthenticatedClient(accountId = null) {
    if (!config.google.clientId || !config.google.clientSecret) {
      throw new Error('Google OAuth Client ID or Client Secret not configured in backend/.env');
    }

    if (!this.oauth2Client) {
      this.initClient();
    }

    // Lookup specified account, or any connected real Google account in DB
    let account = null;
    if (accountId) {
      account = await Account.findById(accountId);
    }
    if (!account) {
      account =
        (await Account.findOne({ platform: 'youtube', status: 'connected', isDemo: false })) ||
        (await Account.findOne({ platform: 'youtube', status: 'connected' }));
    }

    if (!account) {
      throw new Error('No authorized Google account found. Please connect your Google account in Social Accounts.');
    }

    const { accessToken, refreshToken } = account.getTokens();
    if (!accessToken && !refreshToken) {
      throw new Error('Connected Google account has no stored OAuth tokens.');
    }

    // Check if account has Drive permissions
    if (account.scopes && account.scopes.length > 0) {
      const hasDriveScope = account.scopes.some(
        (s) => s.includes('drive.readonly') || s.includes('drive.metadata.readonly') || s.includes('drive')
      );
      if (!hasDriveScope) {
        throw new Error(
          'Your connected Google account is missing Google Drive permissions. Please go to Social Accounts and click "Add Google Account" or "Reconnect" to grant Drive access.'
        );
      }
    }

    this.oauth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    // Check token expiration and refresh if necessary
    if (account.tokenExpiresAt && new Date() >= new Date(account.tokenExpiresAt)) {
      if (refreshToken) {
        try {
          const { credentials } = await this.oauth2Client.refreshAccessToken();
          account.setTokens(credentials.access_token, credentials.refresh_token || refreshToken);
          account.tokenExpiresAt = credentials.expiry_date ? new Date(credentials.expiry_date) : undefined;
          await account.save();
          this.oauth2Client.setCredentials(credentials);
        } catch (refreshErr) {
          account.status = 'expired';
          account.errorMessage = `Token refresh failed: ${refreshErr.message}`;
          await account.save();
          throw new Error(`Google authorization expired: ${refreshErr.message}. Please re-connect account.`);
        }
      }
    }

    this.drive = google.drive({ version: 'v3', auth: this.oauth2Client });
    this.currentAccount = account;
    return this.drive;
  }

  /**
   * Tests whether Drive credentials and connection are functional
   */
  async testConnection() {
    if (!config.google.clientId || !config.google.clientSecret) {
      return {
        configured: false,
        connected: false,
        message: 'Google OAuth Client ID or Client Secret not configured in .env',
      };
    }

    try {
      const drive = await this.getAuthenticatedClient();
      const res = await drive.about.get({
        fields: 'user, storageQuota',
      });

      return {
        configured: true,
        connected: true,
        user: res.data.user,
        storageQuota: res.data.storageQuota,
        message: `Google Drive connected: ${res.data.user?.emailAddress || 'Authorized'}`,
      };
    } catch (err) {
      return {
        configured: true,
        connected: false,
        error: err.message,
        message: err.message,
      };
    }
  }

  /**
   * Validates folder access and permissions before starting an indexing job
   */
  async validateFolder(folderId) {
    const targetFolderId = extractFolderId(folderId || config.google.driveFolderId || 'root');
    let drive;
    try {
      drive = await this.getAuthenticatedClient();
    } catch (authErr) {
      return {
        valid: false,
        folderId: targetFolderId,
        error: authErr.message,
        statusCode: 401,
      };
    }

    try {
      const res = await drive.files.get({
        fileId: targetFolderId,
        fields: 'id, name, mimeType, trashed, capabilities(canListChildren)',
        supportsAllDrives: true,
      });

      const file = res.data;
      if (file.trashed) {
        return {
          valid: false,
          folderId: targetFolderId,
          error: 'The specified folder is in the Google Drive trash.',
        };
      }

      if (targetFolderId !== 'root' && file.mimeType !== 'application/vnd.google-apps.folder') {
        return {
          valid: false,
          folderId: targetFolderId,
          error: `Selected item "${file.name}" is a ${file.mimeType}, not a Google Drive folder.`,
        };
      }

      return {
        valid: true,
        folderId: file.id,
        folderName: file.name || 'Google Drive Root',
        canListChildren: file.capabilities?.canListChildren !== false,
      };
    } catch (err) {
      const statusCode = err.code || err.status || 500;
      let errorMsg = err.message;
      const errDetails = JSON.stringify(err.response?.data || err.errors || '');
      const isScopeInsufficient =
        err.message?.includes('insufficient') ||
        errDetails.includes('ACCESS_TOKEN_SCOPE_INSUFFICIENT') ||
        errDetails.includes('insufficientPermissions');
      const isApiDisabled =
        err.message?.includes('has not been used in project') ||
        err.message?.includes('is disabled') ||
        errDetails.includes('Access Not Configured');

      if (isScopeInsufficient) {
        errorMsg = 'Your connected Google account is missing Google Drive permissions. Please reconnect your Google account in Social Accounts to grant Drive access.';
      } else if (isApiDisabled) {
        const projectId = (config.google.clientId || '').split('-')[0] || '702701632845';
        errorMsg = `Google Drive API is disabled in Google Cloud Project ${projectId}. Please enable it at https://console.developers.google.com/apis/api/drive.googleapis.com/overview?project=${projectId} then retry.`;
      } else if (statusCode === 404) {
        errorMsg = `Folder ID "${targetFolderId}" not found in your Google Drive.`;
      } else if (statusCode === 403) {
        errorMsg = `Permission denied accessing folder "${targetFolderId}". Ensure your Google account has read access to this folder.`;
      }

      return {
        valid: false,
        folderId: targetFolderId,
        error: errorMsg,
        statusCode,
      };
    }
  }

  /**
   * Executes an async operation with exponential backoff retry for transient API rate limits
   */
  async retryWithBackoff(fn, maxRetries = 4, baseDelay = 1000) {
    let attempt = 0;
    while (attempt <= maxRetries) {
      try {
        return await fn();
      } catch (err) {
        const isRateLimit =
          err.code === 429 ||
          err.status === 429 ||
          (err.errors && err.errors.some((e) => e.reason === 'rateLimitExceeded' || e.reason === 'userRateLimitExceeded'));
        const isTransient = err.code >= 500 && err.code < 600;

        if ((isRateLimit || isTransient) && attempt < maxRetries) {
          attempt++;
          const jitter = Math.random() * 200;
          const delay = baseDelay * Math.pow(2, attempt) + jitter;
          console.warn(`[GoogleDriveService] Transient error (${err.message}). Retrying in ${Math.round(delay)}ms (Attempt ${attempt}/${maxRetries})...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        } else {
          throw err;
        }
      }
    }
  }

  /**
   * Starts or resumes a background scalable indexing job for 20,000+ videos
   */
  async startSyncJob({ folderId = null, accountId = null, resume = false, maxPages = 500, pageSize = 100, recursive = true } = {}) {
    // Check if a job is already running
    const runningJob = await SyncJob.findOne({ status: 'running' });
    if (runningJob) {
      // If running job has had no heartbeat for > 5 minutes, consider it stale from a crash
      const staleThreshold = 5 * 60 * 1000;
      if (Date.now() - new Date(runningJob.lastHeartbeatAt).getTime() > staleThreshold) {
        runningJob.status = 'paused';
        runningJob.errorMessage = 'Job paused due to server interruption. Ready to resume.';
        await runningJob.save();
      } else {
        return {
          status: 'running',
          jobId: runningJob.jobId,
          message: 'An indexing job is already actively running.',
          job: runningJob,
        };
      }
    }

    const drive = await this.getAuthenticatedClient(accountId);

    // Validate folder
    const targetFolderId = folderId || config.google.driveFolderId || 'root';
    const folderValidation = await this.validateFolder(targetFolderId);
    if (!folderValidation.valid) {
      throw new Error(`Cannot start sync: ${folderValidation.error}`);
    }

    let job;
    if (resume) {
      job = await SyncJob.findOne({
        folderId: folderValidation.folderId,
        status: { $in: ['paused', 'cancelled', 'failed'] },
      }).sort({ updatedAt: -1 });
    }

    if (!job) {
      const jobId = `sync_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      job = new SyncJob({
        jobId,
        folderId: folderValidation.folderId,
        folderName: folderValidation.folderName,
        status: 'running',
        startedAt: new Date(),
        lastHeartbeatAt: new Date(),
        foldersDiscovered: [folderValidation.folderId],
      });
    } else {
      job.status = 'running';
      job.lastHeartbeatAt = new Date();
    }
    await job.save();

    this.activeJobs.set(job.jobId, { cancelled: false });

    await WorkflowLog.create({
      level: 'info',
      module: 'drive',
      action: 'sync_started',
      message: `Started Google Drive indexer for folder "${folderValidation.folderName}" (Job ID: ${job.jobId})`,
      metadata: { folderId: targetFolderId, resume: !!resume },
    });

    // Run execution in the background asynchronously
    const syncAccount = this.currentAccount;
    this.executeSyncLoop(job, drive, { maxPages, pageSize, recursive, syncAccount }).catch(async (err) => {
      console.error(`[GoogleDriveService] Fatal sync job error: ${err.message}`);
      job.status = 'failed';
      job.errorMessage = err.message;
      job.errorDetails = err.stack;
      await job.save();

      await WorkflowLog.create({
        level: 'error',
        module: 'drive',
        action: 'sync_fatal_error',
        message: `Sync job ${job.jobId} failed: ${err.message}`,
        metadata: { error: err.message },
      });
    });

    return {
      status: 'started',
      jobId: job.jobId,
      folderName: folderValidation.folderName,
      message: `Indexing started for folder "${folderValidation.folderName}". Progress is updating in background.`,
      job,
    };
  }

  /**
   * Background pagination worker loop
   */
  async executeSyncLoop(job, drive, { maxPages = 500, pageSize = 100, recursive = true, syncAccount = null }) {
    const jobId = job.jobId;
    let pageToken = job.pageToken || null;
    let pagesThisRun = 0;

    const folderQueue = job.foldersDiscovered.filter((f) => !job.foldersCompleted.includes(f));
    if (folderQueue.length === 0) {
      folderQueue.push(job.folderId);
    }

    const visitedFolders = new Set(job.foldersCompleted);

    try {
      while (folderQueue.length > 0 && pagesThisRun < maxPages) {
        const currentFolderId = folderQueue[0];

        // Check if cancellation requested
        if (this.isCancelled(jobId)) {
          job.status = 'cancelled';
          job.errorMessage = 'Sync cancelled by user request.';
          await job.save();
          return;
        }

        // Build search query for video files inside current folder
        let query = "mimeType contains 'video/' and trashed = false";
        if (currentFolderId && currentFolderId !== 'root') {
          query += ` and '${currentFolderId}' in parents`;
        }

        do {
          if (this.isCancelled(jobId)) {
            job.status = 'cancelled';
            job.pageToken = pageToken;
            await job.save();
            return;
          }

          // Fetch page of video files using backoff retry
          const response = await this.retryWithBackoff(async () => {
            return await drive.files.list({
              q: query,
              fields: 'nextPageToken, files(id, name, mimeType, size, createdTime, modifiedTime, webViewLink, thumbnailLink, videoMediaMetadata)',
              pageSize: Math.min(pageSize, 100),
              pageToken: pageToken || undefined,
              supportsAllDrives: true,
              includeItemsFromAllDrives: true,
            });
          });

          const files = response.data.files || [];
          if (files.length > 0) {
            // Bulk upsert to MongoDB in batch for memory efficiency
            const bulkOps = files.map((file) => {
              const isVertical = file.videoMediaMetadata
                ? (file.videoMediaMetadata.height || 0) > (file.videoMediaMetadata.width || 0)
                : true;

              return {
                updateOne: {
                  filter: { driveFileId: file.id },
                  update: {
                    $set: {
                      driveFileId: file.id,
                      originalName: file.name,
                      cleanTitle: file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' '),
                      mimeType: file.mimeType,
                      fileSize: parseInt(file.size || '0', 10),
                      duration: file.videoMediaMetadata ? Math.round((file.videoMediaMetadata.durationMillis || 0) / 1000) : 0,
                      resolution: {
                        width: file.videoMediaMetadata?.width || 1080,
                        height: file.videoMediaMetadata?.height || 1920,
                        isVertical,
                        aspectRatio: file.videoMediaMetadata ? `${file.videoMediaMetadata.width}:${file.videoMediaMetadata.height}` : '9:16',
                      },
                      driveCreatedAt: file.createdTime ? new Date(file.createdTime) : undefined,
                      driveModifiedAt: file.modifiedTime ? new Date(file.modifiedTime) : undefined,
                      thumbnailUrl: file.thumbnailLink || null,
                      driveWebViewLink: file.webViewLink || null,
                      folderId: currentFolderId || job.folderId,
                      folderName: job.folderName,
                      syncJobId: jobId,
                      indexingStatus: 'indexed',
                      ...(syncAccount?._id || this.currentAccount?._id
                        ? { accountId: syncAccount?._id || this.currentAccount?._id }
                        : {}),
                      ...(syncAccount?.googleEmail || syncAccount?.username || this.currentAccount?.googleEmail || this.currentAccount?.username
                        ? {
                            googleEmail:
                              syncAccount?.googleEmail ||
                              syncAccount?.username ||
                              this.currentAccount?.googleEmail ||
                              this.currentAccount?.username,
                          }
                        : {}),
                    },
                  },
                  upsert: true,
                },
              };
            });

            const bulkResult = await Video.bulkWrite(bulkOps, { ordered: false });

            job.totalScanned += files.length;
            job.totalIndexed += bulkResult.upsertedCount || 0;
            job.totalUpdated += bulkResult.modifiedCount || 0;
            job.lastSyncedFile = {
              id: files[files.length - 1].id,
              name: files[files.length - 1].name,
              timestamp: new Date(),
            };
          }

          pageToken = response.data.nextPageToken || null;
          job.pageToken = pageToken;
          job.pagesProcessed += 1;
          job.lastHeartbeatAt = new Date();
          pagesThisRun++;

          // Persist progress periodically
          await job.save();
        } while (pageToken && pagesThisRun < maxPages);

        // If recursive traversal requested, discover child folders
        if (recursive && currentFolderId) {
          const childFolderQuery = `mimeType = 'application/vnd.google-apps.folder' and trashed = false and '${currentFolderId}' in parents`;
          const childRes = await this.retryWithBackoff(async () => {
            return await drive.files.list({
              q: childFolderQuery,
              fields: 'files(id, name)',
              pageSize: 50,
              supportsAllDrives: true,
              includeItemsFromAllDrives: true,
            });
          });

          const subfolders = childRes.data.files || [];
          for (const sub of subfolders) {
            if (!visitedFolders.has(sub.id) && !folderQueue.includes(sub.id)) {
              folderQueue.push(sub.id);
              if (!job.foldersDiscovered.includes(sub.id)) {
                job.foldersDiscovered.push(sub.id);
              }
            }
          }
        }

        // Current folder completed
        visitedFolders.add(currentFolderId);
        job.foldersCompleted.push(currentFolderId);
        folderQueue.shift();
        pageToken = null; // Reset pageToken for next folder
        job.pageToken = null;
        await job.save();
      }

      // Check final state
      if (folderQueue.length === 0 && !pageToken) {
        job.status = 'completed';
        job.completedAt = new Date();
        await job.save();

        await WorkflowLog.create({
          level: 'success',
          module: 'drive',
          action: 'sync_completed',
          message: `Google Drive sync completed: ${job.totalIndexed} new indexed, ${job.totalUpdated} updated across ${job.pagesProcessed} pages.`,
          metadata: { totalScanned: job.totalScanned, totalIndexed: job.totalIndexed },
        });
      } else {
        // Paused because reached maxPages per batch
        job.status = 'paused';
        await job.save();
      }
    } catch (loopErr) {
      job.status = 'failed';
      job.errorMessage = loopErr.message;
      job.lastHeartbeatAt = new Date();
      await job.save();
      throw loopErr;
    } finally {
      this.activeJobs.delete(jobId);
    }
  }

  isCancelled(jobId) {
    const jobState = this.activeJobs.get(jobId);
    return jobState?.cancelled === true;
  }

  /**
   * Signals cancellation of an active indexing job
   */
  async cancelSyncJob(jobId) {
    if (this.activeJobs.has(jobId)) {
      this.activeJobs.set(jobId, { cancelled: true });
    }

    const job = await SyncJob.findOne({ jobId });
    if (job) {
      job.status = 'cancelled';
      job.errorMessage = 'Sync cancelled by user request.';
      await job.save();

      await WorkflowLog.create({
        level: 'warn',
        module: 'drive',
        action: 'sync_cancelled',
        message: `Sync job ${jobId} cancelled.`,
      });

      return { success: true, message: 'Sync job cancelled successfully.' };
    }

    return { success: false, message: 'Job not found.' };
  }

  /**
   * Retrieves status and progress for the current or most recent sync job
   */
  async getSyncProgress(jobId = null) {
    let job = null;
    if (jobId) {
      job = await SyncJob.findOne({ jobId });
    } else {
      // Find running job first, or latest completed/paused job
      job = await SyncJob.findOne().sort({ updatedAt: -1 });
    }

    const totalVideosInDb = await Video.countDocuments({ isArchived: false });

    return {
      hasActiveJob: job?.status === 'running',
      job,
      totalVideosInDb,
    };
  }

  /**
   * Retrieves a readable download stream for a Drive file by its file ID
   */
  async getFileStream(fileId) {
    const drive = await this.getAuthenticatedClient();
    const response = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'stream' }
    );
    return response.data;
  }

  /**
   * Alias for getFileStream for video streams
   */
  async getVideoStream(fileId) {
    return this.getFileStream(fileId);
  }

  /**
   * Retrieves fresh thumbnail stream for a Drive file by its file ID
   */
  async getThumbnailStream(fileId, accountId = null) {
    const drive = await this.getAuthenticatedClient(accountId);
    const fileRes = await drive.files.get({
      fileId,
      fields: 'thumbnailLink',
      supportsAllDrives: true,
    });
    const thumbUrl = fileRes.data?.thumbnailLink;
    if (!thumbUrl) {
      throw new Error('Thumbnail not available for file');
    }
    const axiosRes = await axios.get(thumbUrl, {
      responseType: 'stream',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      },
      timeout: 10000,
    });
    return {
      stream: axiosRes.data,
      contentType: axiosRes.headers['content-type'] || 'image/jpeg',
    };
  }
}

export const googleDriveService = new GoogleDriveService();
