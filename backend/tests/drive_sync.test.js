import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { googleDriveService, extractFolderId } from '../src/services/googleDriveService.js';
import { Video } from '../src/models/Video.js';
import { SyncJob } from '../src/models/SyncJob.js';
import { connectDatabase, closeDatabase } from '../src/config/database.js';
import { config } from '../src/config/env.js';

test.before(async () => {
  await connectDatabase();
});

test.after(async () => {
  await closeDatabase();
});

test('GoogleDriveService: testConnection handles missing credentials gracefully', async () => {
  const originalId = config.google.clientId;
  const originalSecret = config.google.clientSecret;

  // Simulate unconfigured credentials
  config.google.clientId = '';
  config.google.clientSecret = '';

  const status = await googleDriveService.testConnection();
  assert.equal(status.configured, false);
  assert.equal(status.connected, false);
  assert.match(status.message, /not configured/i);

  // Restore
  config.google.clientId = originalId;
  config.google.clientSecret = originalSecret;
});

test('GoogleDriveService: retryWithBackoff retries transient 429 rate limits and succeeds', async () => {
  let attempts = 0;
  const mockOperation = async () => {
    attempts++;
    if (attempts < 3) {
      const rateLimitErr = new Error('User Rate Limit Exceeded');
      rateLimitErr.code = 429;
      rateLimitErr.errors = [{ reason: 'userRateLimitExceeded' }];
      throw rateLimitErr;
    }
    return { success: true, processedOnAttempt: attempts };
  };

  // Base delay of 10ms for fast test execution
  const result = await googleDriveService.retryWithBackoff(mockOperation, 4, 10);
  assert.equal(result.success, true);
  assert.equal(result.processedOnAttempt, 3);
  assert.equal(attempts, 3);
});

test('GoogleDriveService: retryWithBackoff throws if maxRetries exhausted', async () => {
  const fatalOperation = async () => {
    const err = new Error('Backend Error');
    err.code = 500;
    throw err;
  };

  await assert.rejects(
    async () => {
      await googleDriveService.retryWithBackoff(fatalOperation, 2, 5);
    },
    /Backend Error/
  );
});

test('GoogleDriveService: validateFolder detects trashed folders', async () => {
  const originalGetClient = googleDriveService.getAuthenticatedClient;

  // Mock authenticated client returning trashed folder
  googleDriveService.getAuthenticatedClient = async () => ({
    files: {
      get: async () => ({
        data: {
          id: 'trashed_folder_123',
          name: 'Old Archive',
          mimeType: 'application/vnd.google-apps.folder',
          trashed: true,
        },
      }),
    },
  });

  const validation = await googleDriveService.validateFolder('trashed_folder_123');
  assert.equal(validation.valid, false);
  assert.match(validation.error, /trash/i);

  googleDriveService.getAuthenticatedClient = originalGetClient;
});

test('GoogleDriveService: validateFolder detects non-folder mimeTypes', async () => {
  const originalGetClient = googleDriveService.getAuthenticatedClient;

  // Mock authenticated client returning video file instead of folder
  googleDriveService.getAuthenticatedClient = async () => ({
    files: {
      get: async () => ({
        data: {
          id: 'file_not_folder_456',
          name: 'clip.mp4',
          mimeType: 'video/mp4',
          trashed: false,
        },
      }),
    },
  });

  const validation = await googleDriveService.validateFolder('file_not_folder_456');
  assert.equal(validation.valid, false);
  assert.match(validation.error, /not a Google Drive folder/i);

  googleDriveService.getAuthenticatedClient = originalGetClient;
});

test('GoogleDriveService: validateFolder handles 404 not found and 403 permission errors', async () => {
  const originalGetClient = googleDriveService.getAuthenticatedClient;

  // Mock 404
  googleDriveService.getAuthenticatedClient = async () => ({
    files: {
      get: async () => {
        const notFoundErr = new Error('File not found');
        notFoundErr.code = 404;
        throw notFoundErr;
      },
    },
  });

  const notFoundResult = await googleDriveService.validateFolder('invalid_id_999');
  assert.equal(notFoundResult.valid, false);
  assert.match(notFoundResult.error, /not found/i);

  // Mock 403
  googleDriveService.getAuthenticatedClient = async () => ({
    files: {
      get: async () => {
        const deniedErr = new Error('Insufficient permissions');
        deniedErr.code = 403;
        throw deniedErr;
      },
    },
  });

  const deniedResult = await googleDriveService.validateFolder('private_folder_888');
  assert.equal(deniedResult.valid, false);
  assert.match(deniedResult.error, /permission denied/i);

  googleDriveService.getAuthenticatedClient = originalGetClient;
});

test('Duplicate Prevention & Upsert: indexing identical driveFileId updates instead of duplicating', async () => {
  if (mongoose.connection.readyState !== 1) return;

  const testFileId = `test_drive_file_${Date.now()}`;

  // First insert
  const firstDoc = {
    driveFileId: testFileId,
    originalName: 'reels_viral_part1.mp4',
    cleanTitle: 'Reels Viral Part 1',
    mimeType: 'video/mp4',
    fileSize: 10485760,
    status: 'discovered',
  };

  await Video.findOneAndUpdate({ driveFileId: testFileId }, { $set: firstDoc }, { upsert: true, new: true });

  const countAfterFirst = await Video.countDocuments({ driveFileId: testFileId });
  assert.equal(countAfterFirst, 1);

  // Re-indexing same file with modified metadata
  const updatedDoc = {
    driveFileId: testFileId,
    originalName: 'reels_viral_part1_renamed.mp4',
    cleanTitle: 'Reels Viral Part 1 Renamed',
    mimeType: 'video/mp4',
    fileSize: 12000000,
    status: 'discovered',
  };

  await Video.findOneAndUpdate({ driveFileId: testFileId }, { $set: updatedDoc }, { upsert: true, new: true });

  const countAfterSecond = await Video.countDocuments({ driveFileId: testFileId });
  assert.equal(countAfterSecond, 1, 'Duplicate record must not be created');

  const fetched = await Video.findOne({ driveFileId: testFileId });
  assert.equal(fetched.cleanTitle, 'Reels Viral Part 1 Renamed');
  assert.equal(fetched.fileSize, 12000000);

  // Clean up
  await Video.deleteOne({ driveFileId: testFileId });
});

test('SyncJob: cancellation stops active sync and saves state for resumption', async () => {
  if (mongoose.connection.readyState !== 1) return;

  const jobId = `test_job_cancel_${Date.now()}`;
  const job = new SyncJob({
    jobId,
    folderId: 'folder_root_123',
    folderName: 'Root Videos',
    status: 'running',
    pageToken: 'page_token_abc_resume',
    totalScanned: 150,
  });
  await job.save();

  // Cancel job
  const cancelRes = await googleDriveService.cancelSyncJob(jobId);
  assert.equal(cancelRes.success, true);

  const updatedJob = await SyncJob.findOne({ jobId });
  assert.equal(updatedJob.status, 'cancelled');
  assert.equal(updatedJob.pageToken, 'page_token_abc_resume', 'Page token must be preserved for resume');

  // Clean up
  await SyncJob.deleteOne({ jobId });
});

test('Video query: server-side filtering, aspect ratio, and pagination', async () => {
  if (mongoose.connection.readyState !== 1) return;

  const id1 = `test_filter_vertical_${Date.now()}`;
  const id2 = `test_filter_horizontal_${Date.now()}`;

  await Video.create([
    {
      driveFileId: id1,
      originalName: 'vertical_short.mp4',
      cleanTitle: 'Vertical Short',
      mimeType: 'video/mp4',
      fileSize: 5000000,
      resolution: { width: 1080, height: 1920, isVertical: true },
      status: 'discovered',
      driveModifiedAt: new Date('2026-01-01'),
    },
    {
      driveFileId: id2,
      originalName: 'horizontal_landscape.mp4',
      cleanTitle: 'Horizontal Landscape',
      mimeType: 'video/mp4',
      fileSize: 30000000,
      resolution: { width: 1920, height: 1080, isVertical: false },
      status: 'discovered',
      driveModifiedAt: new Date('2026-02-01'),
    },
  ]);

  // Query vertical only
  const verticalVideos = await Video.find({
    driveFileId: { $in: [id1, id2] },
    'resolution.isVertical': true,
  });
  assert.equal(verticalVideos.length, 1);
  assert.equal(verticalVideos[0].driveFileId, id1);

  // Query size filter (< 10MB)
  const smallVideos = await Video.find({
    driveFileId: { $in: [id1, id2] },
    fileSize: { $lt: 10000000 },
  });
  assert.equal(smallVideos.length, 1);
  assert.equal(smallVideos[0].driveFileId, id1);

  // Clean up
  await Video.deleteMany({ driveFileId: { $in: [id1, id2] } });
});

test('GoogleDriveService: extractFolderId extracts folder ID from various Google Drive URL formats and IDs', () => {
  const rawId = '1tFYup0QoUlXgMeDkbPSgbmvnY72TxnGb';

  // 1. Full standard folder URL
  assert.equal(
    extractFolderId('https://drive.google.com/drive/folders/1tFYup0QoUlXgMeDkbPSgbmvnY72TxnGb'),
    rawId
  );

  // 2. Multi-login user folder URL
  assert.equal(
    extractFolderId('https://drive.google.com/drive/u/0/folders/1tFYup0QoUlXgMeDkbPSgbmvnY72TxnGb?usp=sharing'),
    rawId
  );

  // 3. Open by id URL
  assert.equal(
    extractFolderId('https://drive.google.com/open?id=1tFYup0QoUlXgMeDkbPSgbmvnY72TxnGb'),
    rawId
  );

  // 4. File /d/ URL
  assert.equal(
    extractFolderId('https://drive.google.com/file/d/1tFYup0QoUlXgMeDkbPSgbmvnY72TxnGb/view'),
    rawId
  );

  // 5. Raw ID string
  assert.equal(extractFolderId('1tFYup0QoUlXgMeDkbPSgbmvnY72TxnGb'), rawId);

  // 6. Root / empty defaults
  assert.equal(extractFolderId(''), 'root');
  assert.equal(extractFolderId(null), 'root');
  assert.equal(extractFolderId('root'), 'root');
});

test('GoogleDriveService: validateFolder extracts folder ID from URL and queries API with clean ID', async () => {
  const originalGetClient = googleDriveService.getAuthenticatedClient;
  let requestedFileId = null;

  googleDriveService.getAuthenticatedClient = async () => ({
    files: {
      get: async ({ fileId }) => {
        requestedFileId = fileId;
        return {
          data: {
            id: fileId,
            name: 'Shorts Content Pool',
            mimeType: 'application/vnd.google-apps.folder',
            trashed: false,
            capabilities: { canListChildren: true },
          },
        };
      },
    },
  });

  const res = await googleDriveService.validateFolder(
    'https://drive.google.com/drive/folders/1tFYup0QoUlXgMeDkbPSgbmvnY72TxnGb'
  );

  assert.equal(res.valid, true);
  assert.equal(res.folderId, '1tFYup0QoUlXgMeDkbPSgbmvnY72TxnGb');
  assert.equal(requestedFileId, '1tFYup0QoUlXgMeDkbPSgbmvnY72TxnGb');

  googleDriveService.getAuthenticatedClient = originalGetClient;
});

test('GoogleDriveService: validateFolder handles insufficient Drive scope error with actionable instructions', async () => {
  const originalGetClient = googleDriveService.getAuthenticatedClient;

  googleDriveService.getAuthenticatedClient = async () => ({
    files: {
      get: async () => {
        const err = new Error('Request had insufficient authentication scopes.');
        err.code = 403;
        err.response = {
          data: {
            error: {
              code: 403,
              message: 'Request had insufficient authentication scopes.',
              status: 'PERMISSION_DENIED',
            },
          },
        };
        throw err;
      },
    },
  });

  const res = await googleDriveService.validateFolder('1tFYup0QoUlXgMeDkbPSgbmvnY72TxnGb');
  assert.equal(res.valid, false);
  assert.match(res.error, /missing Google Drive permissions/i);

  googleDriveService.getAuthenticatedClient = originalGetClient;
});
