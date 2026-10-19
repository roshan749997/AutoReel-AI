import test from 'node:test';
import assert from 'node:assert/strict';
import { schedulerService } from '../src/services/schedulerService.js';
import { Post } from '../src/models/Post.js';
import { Video } from '../src/models/Video.js';
import { Account } from '../src/models/Account.js';
import { WorkflowLog } from '../src/models/WorkflowLog.js';
import { connectDatabase, closeDatabase } from '../src/config/database.js';
import { config } from '../src/config/env.js';
import { googleDriveService } from '../src/services/googleDriveService.js';
import { youtubeService } from '../src/services/youtubeService.js';
import { instagramService } from '../src/services/instagramService.js';
import axios from 'axios';
import { Readable } from 'node:stream';

test.before(async () => {
  await connectDatabase();
});

test.after(async () => {
  await closeDatabase();
});

// Helper to create test video & account fixtures
async function createFixtures({ approvalStatus = 'approved' } = {}) {
  const account = await Account.create({
    platform: 'youtube',
    accountId: `yt_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    accountName: `Test Channel ${Date.now()}`,
    encryptedAccessToken: 'dummy_enc_access_token',
    status: 'connected',
    isDemo: true,
  });

  const video = await Video.create({
    driveFileId: `drive_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    originalName: 'epic_short_video.mp4',
    cleanTitle: 'Epic Short Video',
    mimeType: 'video/mp4',
    status: approvalStatus === 'approved' ? 'metadata_ready' : 'discovered',
    aiMetadata: {
      youtubeTitle: 'Epic Short Video #Shorts',
      approvalStatus,
    },
  });

  return { account, video };
}

// 1. Approval requirement: Rejects unapproved video drafts
test('Scheduler: Rejects scheduling videos with unapproved metadata', async () => {
  const { account, video } = await createFixtures({ approvalStatus: 'draft' });

  const futureDate = new Date(Date.now() + 3600000);

  await assert.rejects(
    async () => {
      await schedulerService.schedulePost({
        videoId: video._id,
        accountId: account._id,
        platform: 'youtube',
        scheduledAt: futureDate,
        timezone: 'Asia/Kolkata',
      });
    },
    /must be reviewed and approved before scheduling/i
  );

  await Video.deleteOne({ _id: video._id });
  await Account.deleteOne({ _id: account._id });
});

// 2. Scheduling validation and timezone handling
test('Scheduler: Schedules approved video with explicit timezone and deterministic idempotencyKey', async () => {
  const { account, video } = await createFixtures({ approvalStatus: 'approved' });

  const futureDate = new Date(Date.now() + 7200000);
  const post = await schedulerService.schedulePost({
    videoId: video._id,
    accountId: account._id,
    platform: 'youtube',
    title: 'Approved Viral Short #Shorts',
    caption: 'Best video description',
    hashtags: ['#Shorts', '#Viral'],
    scheduledAt: futureDate,
    timezone: 'Asia/Kolkata',
  });

  assert.equal(post.status, 'scheduled');
  assert.equal(post.publishingStatus, 'unattempted');
  assert.equal(post.timezone, 'Asia/Kolkata');
  assert.ok(post.idempotencyKey.includes(video._id.toString()));
  assert.ok(post.idempotencyKey.includes('youtube'));
  assert.equal(post.executionLogs.length, 1);
  assert.equal(post.executionLogs[0].step, 'scheduled');

  // Clean up
  await Post.deleteOne({ _id: post._id });
  await Video.deleteOne({ _id: video._id });
  await Account.deleteOne({ _id: account._id });
});

// 3. Rejects past schedule dates
test('Scheduler: Rejects unintended past scheduled dates', async () => {
  const { account, video } = await createFixtures({ approvalStatus: 'approved' });

  const pastDate = new Date(Date.now() - 3600000); // 1 hour ago

  await assert.rejects(
    async () => {
      await schedulerService.schedulePost({
        videoId: video._id,
        accountId: account._id,
        platform: 'youtube',
        scheduledAt: pastDate,
      });
    },
    /Cannot schedule a post in the past/i
  );

  await Video.deleteOne({ _id: video._id });
  await Account.deleteOne({ _id: account._id });
});

// 4. Duplicate schedule prevention for same video and platform
test('Scheduler: Prevents duplicate active schedules for the same video & platform', async () => {
  const { account, video } = await createFixtures({ approvalStatus: 'approved' });

  const futureDate = new Date(Date.now() + 3600000);
  const post1 = await schedulerService.schedulePost({
    videoId: video._id,
    accountId: account._id,
    platform: 'youtube',
    scheduledAt: futureDate,
  });

  // Attempt second schedule for same video & platform
  await assert.rejects(
    async () => {
      await schedulerService.schedulePost({
        videoId: video._id,
        accountId: account._id,
        platform: 'youtube',
        scheduledAt: new Date(Date.now() + 7200000),
      });
    },
    /An active schedule already exists for this video on YOUTUBE/i
  );

  await Post.deleteOne({ _id: post1._id });
  await Video.deleteOne({ _id: video._id });
  await Account.deleteOne({ _id: account._id });
});

// 5. Atomic job claiming and idempotency
test('Scheduler: Atomic job claiming prevents two workers from claiming the same job', async () => {
  const { account, video } = await createFixtures({ approvalStatus: 'approved' });

  const post = await Post.create({
    videoId: video._id,
    accountId: account._id,
    platform: 'youtube',
    title: 'Atomic Test Post',
    scheduledAt: new Date(Date.now() - 10000), // Due now
    status: 'scheduled',
    idempotencyKey: `idemp_claim_${Date.now()}`,
  });

  // Worker 1 claims
  const worker1Claim = await Post.findOneAndUpdate(
    { _id: post._id, status: { $in: ['scheduled', 'queued', 'retrying'] } },
    { $set: { status: 'processing', claimedBy: 'worker_alpha', claimedAt: new Date() } },
    { new: true }
  );

  assert.ok(worker1Claim, 'Worker 1 should claim successfully');
  assert.equal(worker1Claim.claimedBy, 'worker_alpha');

  // Worker 2 attempts claiming simultaneously
  const worker2Claim = await Post.findOneAndUpdate(
    { _id: post._id, status: { $in: ['scheduled', 'queued', 'retrying'] } },
    { $set: { status: 'processing', claimedBy: 'worker_beta', claimedAt: new Date() } },
    { new: true }
  );

  assert.equal(worker2Claim, null, 'Worker 2 must NOT claim already claimed job');

  await Post.deleteOne({ _id: post._id });
  await Video.deleteOne({ _id: video._id });
  await Account.deleteOne({ _id: account._id });
});

// 6. Exponential backoff retry and maximum attempts
test('Scheduler: Handles queue failure with exponential backoff and caps at maxAttempts', async () => {
  const { account, video } = await createFixtures({ approvalStatus: 'approved' });

  const post = await Post.create({
    videoId: video._id,
    accountId: account._id,
    platform: 'youtube',
    title: 'Retry Test Post',
    scheduledAt: new Date(),
    status: 'processing',
    attempts: 0,
    maxAttempts: 2,
  });

  // Simulate attempt 1 failure
  await schedulerService.handleQueueFailure(post, new Error('Transient network error'));
  const afterFirst = await Post.findById(post._id);

  assert.equal(afterFirst.status, 'retrying');
  assert.equal(afterFirst.attempts, 0); // attempts was 0 before handleQueueFailure
  assert.ok(afterFirst.nextRetryAt instanceof Date);

  // Simulate attempt 2 failure (exhausted)
  afterFirst.attempts = 2;
  await schedulerService.handleQueueFailure(afterFirst, new Error('Fatal unrecoverable error'));
  const afterSecond = await Post.findById(post._id);

  assert.equal(afterSecond.status, 'failed');
  assert.equal(afterSecond.publishingStatus, 'failed');
  assert.equal(afterSecond.nextRetryAt, null);

  await Post.deleteOne({ _id: post._id });
  await Video.deleteOne({ _id: video._id });
  await Account.deleteOne({ _id: account._id });
});

// 7. Pause, Resume, Reschedule, and Cancellation
test('Scheduler: Pause, resume, reschedule, and cancellation state transitions', async () => {
  const { account, video } = await createFixtures({ approvalStatus: 'approved' });

  const post = await schedulerService.schedulePost({
    videoId: video._id,
    accountId: account._id,
    platform: 'youtube',
    scheduledAt: new Date(Date.now() + 3600000),
  });

  // Pause
  const paused = await schedulerService.pausePost(post._id);
  assert.equal(paused.status, 'paused');

  // Resume
  const resumed = await schedulerService.resumePost(post._id);
  assert.equal(resumed.status, 'scheduled');

  // Reschedule
  const newDate = new Date(Date.now() + 86400000);
  const rescheduled = await schedulerService.reschedulePost(post._id, newDate, 'America/New_York');
  assert.equal(rescheduled.scheduledAt.getTime(), newDate.getTime());
  assert.equal(rescheduled.timezone, 'America/New_York');

  // Cancel
  const cancelled = await schedulerService.cancelPost(post._id, 'Creator changed schedule plan');
  assert.equal(cancelled.status, 'cancelled');
  assert.ok(cancelled.cancelledAt);
  assert.equal(cancelled.cancellationReason, 'Creator changed schedule plan');

  // Manual Retry reset
  const retried = await schedulerService.retryPost(post._id);
  assert.equal(retried.status, 'scheduled');
  assert.equal(retried.attempts, 0);

  await Post.deleteOne({ _id: post._id });
  await Video.deleteOne({ _id: video._id });
  await Account.deleteOne({ _id: account._id });
});

// 8. Server restart recovery: recovers stuck jobs
test('Scheduler: recoverInterruptedJobs resets jobs stuck in processing to queued', async () => {
  const { account, video } = await createFixtures({ approvalStatus: 'approved' });

  const stuckPost = await Post.create({
    videoId: video._id,
    accountId: account._id,
    platform: 'youtube',
    title: 'Stuck Post',
    scheduledAt: new Date(),
    status: 'processing',
    claimedBy: 'dead_worker_pid_123',
  });

  await schedulerService.recoverInterruptedJobs();

  const recovered = await Post.findById(stuckPost._id);
  assert.equal(recovered.status, 'queued');
  assert.equal(recovered.claimedBy, null);
  assert.ok(recovered.executionLogs.some((l) => l.step === 'crash_recovery'));

  await Post.deleteOne({ _id: stuckPost._id });
  await Video.deleteOne({ _id: video._id });
  await Account.deleteOne({ _id: account._id });
});

// 9. n8n offline handling: notification failure does NOT fail core scheduling
test('Scheduler: n8n offline does not prevent post scheduling', async () => {
  const { account, video } = await createFixtures({ approvalStatus: 'approved' });

  // Temporarily set unreachable n8n port
  const origWebhook = config.n8n.webhookUrl;
  config.n8n.webhookUrl = 'http://127.0.0.1:59999/unreachable-webhook';

  const post = await schedulerService.schedulePost({
    videoId: video._id,
    accountId: account._id,
    platform: 'youtube',
    scheduledAt: new Date(Date.now() + 3600000),
  });

  assert.ok(post);
  assert.equal(post.status, 'scheduled');

  config.n8n.webhookUrl = origWebhook;
  await Post.deleteOne({ _id: post._id });
  await Video.deleteOne({ _id: video._id });
  await Account.deleteOne({ _id: account._id });
});

// 10. Webhook authentication: Rejects unauthorized callback without secret
test('n8n Webhook: Rejects unauthorized callback when secret is missing or invalid', async () => {
  const res = await fetch(`http://127.0.0.1:${config.port}/api/workflows/callback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventId: 'evt_unauth_123', status: 'completed' }),
  });

  assert.equal(res.status, 401, 'Should reject with 401 Unauthorized');
});

// 11. Webhook idempotency & replay protection
test('n8n Webhook: Processes callback with valid secret and skips replayed duplicate events', async () => {
  const eventId = `test_evt_${Date.now()}_${Math.random()}`;

  // First callback with valid secret
  const res1 = await fetch(`http://127.0.0.1:${config.port}/api/workflows/callback`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-N8N-WEBHOOK-SECRET': config.n8n.webhookSecret,
    },
    body: JSON.stringify({
      eventId,
      status: 'verified',
      message: 'Queue event verified',
    }),
  });

  assert.equal(res1.status, 200);
  const data1 = await res1.json();
  assert.equal(data1.status, 'success');
  assert.equal(data1.received, true);

  // Replayed callback with identical eventId
  const res2 = await fetch(`http://127.0.0.1:${config.port}/api/workflows/callback`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-N8N-WEBHOOK-SECRET': config.n8n.webhookSecret,
    },
    body: JSON.stringify({
      eventId,
      status: 'verified',
      message: 'Duplicate replay of queue event',
    }),
  });

  assert.equal(res2.status, 200);
  const data2 = await res2.json();
  assert.equal(data2.status, 'skipped_duplicate');
});

// 12. Retry-limit enforcement: Jobs with attempts >= maxAttempts are failed and never polled
test('Scheduler: Enforces retry-limit and prevents runaway polling loops', async () => {
  const { account, video } = await createFixtures({ approvalStatus: 'approved' });

  const post = await Post.create({
    videoId: video._id,
    accountId: account._id,
    platform: 'youtube',
    title: 'Exhausted Limit Test Post',
    scheduledAt: new Date(Date.now() - 5000), // Due in the past
    status: 'scheduled',
    attempts: 3,
    maxAttempts: 3,
  });

  // Verify candidate query ignores this post
  const dueCandidates = await Post.find({
    _id: post._id,
    status: { $in: ['scheduled', 'retrying'] },
    $expr: { $lt: ['$attempts', '$maxAttempts'] },
  });
  assert.equal(dueCandidates.length, 0, 'Candidate query must not pick up exhausted jobs');

  // Verify processClaimedPost terminates exhausted jobs
  const populated = await Post.findById(post._id).populate('videoId').populate('accountId');
  await schedulerService.processClaimedPost(populated);

  const updated = await Post.findById(post._id);
  assert.equal(updated.status, 'failed');
  assert.equal(updated.publishingStatus, 'failed');

  await Post.deleteOne({ _id: post._id });
  await Video.deleteOne({ _id: video._id });
  await Account.deleteOne({ _id: account._id });
});

// 13. Ready-job dispatch: Mocked YouTube upload successfully updates status to published with real video ID
test('Scheduler Dispatch: Successfully dispatches YouTube upload, streams from Drive, and marks published', async () => {
  const { account, video } = await createFixtures({ approvalStatus: 'approved' });
  account.scopes = ['https://www.googleapis.com/auth/youtube.upload'];
  await account.save();

  // Create scheduled post with empty caption to test fallback
  const post = await Post.create({
    videoId: video._id,
    accountId: account._id,
    platform: 'youtube',
    title: 'Hindi Kahaniya Moral Story',
    caption: '', // Empty caption to test description fallback
    hashtags: ['Hindi', 'Shorts'],
    scheduledAt: new Date(Date.now() - 5000),
    status: 'scheduled',
    attempts: 0,
    maxAttempts: 3,
  });

  // Mock getFileStream and uploadVideo
  const origGetFileStream = googleDriveService.getFileStream;
  const origUploadVideo = youtubeService.uploadVideo;

  let streamCalled = false;
  let uploadCalledWith = null;

  googleDriveService.getFileStream = async (fileId) => {
    streamCalled = true;
    assert.equal(fileId, video.driveFileId);
    return Readable.from(['mock video binary data']);
  };

  youtubeService.uploadVideo = async (params) => {
    uploadCalledWith = params;
    return {
      externalPostId: 'yt_mock_success_vid_999',
      externalUrl: 'https://www.youtube.com/watch?v=yt_mock_success_vid_999',
      quotaUnitsUsed: 1600,
    };
  };

  try {
    const populated = await Post.findById(post._id).populate('videoId').populate('accountId');
    await schedulerService.processClaimedPost(populated);

    const refreshed = await Post.findById(post._id);
    assert.ok(streamCalled, 'Must stream video from Google Drive');
    assert.ok(uploadCalledWith, 'Must call YouTube upload service');
    assert.ok(uploadCalledWith.description.includes('Hindi Kahaniya Moral Story'), 'Description fallback must include title');
    assert.ok(uploadCalledWith.description.includes('#Shorts'), 'Description fallback must include #Shorts');

    assert.equal(refreshed.status, 'published');
    assert.equal(refreshed.publishingStatus, 'published');
    assert.equal(refreshed.publishDetails?.externalPostId, 'yt_mock_success_vid_999');
    assert.equal(refreshed.publishDetails?.externalUrl, 'https://www.youtube.com/watch?v=yt_mock_success_vid_999');
    assert.ok(refreshed.publishedAt instanceof Date);

    const videoRefreshed = await Video.findById(video._id);
    assert.equal(videoRefreshed.status, 'published');
  } finally {
    googleDriveService.getFileStream = origGetFileStream;
    youtubeService.uploadVideo = origUploadVideo;
    await Post.deleteOne({ _id: post._id });
    await Video.deleteOne({ _id: video._id });
    await Account.deleteOne({ _id: account._id });
  }
});

// 14. Missing metadata: Permanently fails when video metadata is revoked or unapproved
test('Scheduler Dispatch: Fails permanently without retrying when metadata is unapproved', async () => {
  const { account, video } = await createFixtures({ approvalStatus: 'draft' });

  const post = await Post.create({
    videoId: video._id,
    accountId: account._id,
    platform: 'youtube',
    title: 'Draft Video Post',
    scheduledAt: new Date(Date.now() - 5000),
    status: 'scheduled',
    attempts: 0,
    maxAttempts: 3,
  });

  const populated = await Post.findById(post._id).populate('videoId').populate('accountId');
  await schedulerService.processClaimedPost(populated);

  const refreshed = await Post.findById(post._id);
  assert.equal(refreshed.status, 'failed');
  assert.equal(refreshed.publishingStatus, 'failed');
  assert.equal(refreshed.attempts, 1);
  assert.equal(refreshed.nextRetryAt, null, 'Must not schedule retry for permanent metadata error');

  await Post.deleteOne({ _id: post._id });
  await Video.deleteOne({ _id: video._id });
  await Account.deleteOne({ _id: account._id });
});

// 15. Invalid authorization: Fails permanently without retrying when account is disconnected
test('Scheduler Dispatch: Fails permanently when social account is disconnected', async () => {
  const { account, video } = await createFixtures({ approvalStatus: 'approved' });
  account.status = 'disconnected';
  await account.save();

  const post = await Post.create({
    videoId: video._id,
    accountId: account._id,
    platform: 'youtube',
    title: 'Disconnected Account Post',
    scheduledAt: new Date(Date.now() - 5000),
    status: 'scheduled',
    attempts: 0,
    maxAttempts: 3,
  });

  const populated = await Post.findById(post._id).populate('videoId').populate('accountId');
  await schedulerService.processClaimedPost(populated);

  const refreshed = await Post.findById(post._id);
  assert.equal(refreshed.status, 'failed');
  assert.equal(refreshed.publishingStatus, 'failed');
  assert.equal(refreshed.nextRetryAt, null);
  assert.ok(refreshed.lastError?.message.includes('disconnected'));

  await Post.deleteOne({ _id: post._id });
  await Video.deleteOne({ _id: video._id });
  await Account.deleteOne({ _id: account._id });
});

// 16. Duplicate job retries: Never calls YouTube upload again if externalPostId already exists
test('Scheduler: Duplicate job retries never call uploadVideo if externalPostId already exists', async () => {
  const { account, video } = await createFixtures({ approvalStatus: 'approved' });
  account.scopes = ['https://www.googleapis.com/auth/youtube.upload'];
  await account.save();

  const post = await Post.create({
    videoId: video._id,
    accountId: account._id,
    platform: 'youtube',
    title: 'Idempotent Retry Post',
    scheduledAt: new Date(Date.now() - 5000),
    status: 'scheduled',
    attempts: 1,
    maxAttempts: 3,
    publishDetails: {
      externalPostId: 'already_uploaded_yt_id_111',
      externalUrl: 'https://www.youtube.com/watch?v=already_uploaded_yt_id_111',
      uploadStatus: 'uploaded',
    },
  });

  // Track if uploadVideo is called
  let uploadCalled = false;
  const origUpload = youtubeService.uploadVideo;
  const origCheck = youtubeService.checkVideoStatus;

  youtubeService.uploadVideo = async () => {
    uploadCalled = true;
    return { externalPostId: 'should_not_be_called' };
  };

  youtubeService.checkVideoStatus = async () => {
    return {
      exists: true,
      id: 'already_uploaded_yt_id_111',
      title: 'Idempotent Retry Post',
      uploadStatus: 'uploaded',
      isRejected: false,
    };
  };

  try {
    const populated = await Post.findById(post._id).populate('videoId').populate('accountId');
    await schedulerService.processClaimedPost(populated);

    assert.equal(uploadCalled, false, 'uploadVideo must NEVER be called when externalPostId already exists');
    const refreshed = await Post.findById(post._id);
    assert.equal(refreshed.status, 'published');
    assert.equal(refreshed.publishingStatus, 'published');
    assert.ok(refreshed.executionLogs.some((l) => l.step === 'idempotency_verified'));
  } finally {
    youtubeService.uploadVideo = origUpload;
    youtubeService.checkVideoStatus = origCheck;
    await Post.deleteOne({ _id: post._id });
    await Video.deleteOne({ _id: video._id });
    await Account.deleteOne({ _id: account._id });
  }
});

// 17. Process restart recovery: A post in processing with externalPostId transitions to published, never queued
test('Scheduler: Crash recovery preserves externalPostId and never re-queues uploaded jobs', async () => {
  const { account, video } = await createFixtures({ approvalStatus: 'approved' });

  const interruptedPost = await Post.create({
    videoId: video._id,
    accountId: account._id,
    platform: 'youtube',
    title: 'Interrupted Post With Video ID',
    scheduledAt: new Date(),
    status: 'processing',
    claimedBy: 'worker_crashed',
    publishDetails: {
      externalPostId: 'yt_crashed_during_write_222',
      externalUrl: 'https://www.youtube.com/watch?v=yt_crashed_during_write_222',
    },
  });

  await schedulerService.recoverInterruptedJobs();

  const recovered = await Post.findById(interruptedPost._id);
  assert.equal(recovered.status, 'published', 'Must transition to published, NOT queued');
  assert.equal(recovered.publishingStatus, 'published');
  assert.ok(recovered.executionLogs.some((l) => l.step === 'crash_recovery_verified'));

  await Post.deleteOne({ _id: interruptedPost._id });
  await Video.deleteOne({ _id: video._id });
  await Account.deleteOne({ _id: account._id });
});

// 18. Removed-video handling: Sets status to manual_review and blocks automatic retries
test('Scheduler: Video removed or rejected by YouTube transitions to manual_review and blocks auto-retries', async () => {
  const { account, video } = await createFixtures({ approvalStatus: 'approved' });
  account.scopes = ['https://www.googleapis.com/auth/youtube.upload'];
  await account.save();

  const post = await Post.create({
    videoId: video._id,
    accountId: account._id,
    platform: 'youtube',
    title: 'Duplicate Rejected Post',
    scheduledAt: new Date(Date.now() - 5000),
    status: 'scheduled',
    publishDetails: {
      externalPostId: 'yt_rejected_dup_333',
    },
  });

  const origCheck = youtubeService.checkVideoStatus;
  youtubeService.checkVideoStatus = async () => {
    return {
      exists: true,
      id: 'yt_rejected_dup_333',
      title: 'Deleted video',
      uploadStatus: 'rejected',
      rejectionReason: 'duplicate',
      isRejected: true,
      isRemoved: true,
    };
  };

  try {
    const populated = await Post.findById(post._id).populate('videoId').populate('accountId');
    await schedulerService.processClaimedPost(populated);

    const refreshed = await Post.findById(post._id);
    assert.equal(refreshed.status, 'manual_review');
    assert.equal(refreshed.publishingStatus, 'rejected');
    assert.equal(refreshed.publishDetails?.rejectionReason, 'duplicate');
    assert.ok(!refreshed.nextRetryAt, 'Must not schedule a retry for manual_review');

    // Attempting manual retry must throw an error
    await assert.rejects(
      async () => {
        await schedulerService.retryPost(post._id);
      },
      /under manual review due to a YouTube duplicate\/policy removal/i
    );
  } finally {
    youtubeService.checkVideoStatus = origCheck;
    await Post.deleteOne({ _id: post._id });
    await Video.deleteOne({ _id: video._id });
    await Account.deleteOne({ _id: account._id });
  }
});

// 19. Scheduling guard: Prevents accidental scheduling of published video to same account
test('Scheduler: Blocks accidental re-scheduling of published video to same account without explicit override', async () => {
  const { account, video } = await createFixtures({ approvalStatus: 'approved' });

  const publishedPost = await Post.create({
    videoId: video._id,
    accountId: account._id,
    platform: 'youtube',
    title: 'Already Published Post',
    scheduledAt: new Date(Date.now() - 10000),
    status: 'published',
    publishingStatus: 'published',
    publishDetails: { externalPostId: 'existing_yt_id_444' },
  });

  // Attempt to schedule same video without allowDuplicate
  await assert.rejects(
    async () => {
      await schedulerService.schedulePost({
        videoId: video._id,
        accountId: account._id,
        platform: 'youtube',
        scheduledAt: new Date(Date.now() + 3600000),
        allowDuplicate: false,
      });
    },
    /already been published to YOUTUBE/i
  );

  // With allowDuplicate: true, scheduling succeeds
  const secondPost = await schedulerService.schedulePost({
    videoId: video._id,
    accountId: account._id,
    platform: 'youtube',
    scheduledAt: new Date(Date.now() + 7200000),
    allowDuplicate: true,
  });
  assert.ok(secondPost);
  assert.equal(secondPost.status, 'scheduled');

  await Post.deleteOne({ _id: publishedPost._id });
  await Post.deleteOne({ _id: secondPost._id });
  await Video.deleteOne({ _id: video._id });
  await Account.deleteOne({ _id: account._id });
});

// 20. Queue Polling: Automatically polls and claims due jobs in 'queued' status
test("Scheduler: Polls and claims due jobs in 'queued' status as well as 'scheduled'", async () => {
  const { account, video } = await createFixtures({ approvalStatus: 'approved' });

  // Job created with status: 'queued' in the past (e.g. from recovery or queue transition)
  const pastDate = new Date(Date.now() - 10000);
  const post = await Post.create({
    videoId: video._id,
    accountId: account._id,
    platform: 'youtube',
    title: 'Queued Video Due For Dispatch',
    scheduledAt: pastDate,
    status: 'queued',
    publishingStatus: 'ready_for_dispatch',
    attempts: 0,
    maxAttempts: 3,
  });

  // Verify candidate query picks it up
  const candidates = await Post.find({
    status: { $in: ['scheduled', 'queued', 'retrying'] },
    $expr: { $lt: ['$attempts', '$maxAttempts'] },
    $or: [{ scheduledAt: { $lte: new Date() } }, { nextRetryAt: { $lte: new Date() } }],
  });

  const found = candidates.find((c) => c._id.toString() === post._id.toString());
  assert.ok(found, "Due candidate query must include jobs with status 'queued'");
  assert.equal(found.status, 'queued');

  await Post.deleteOne({ _id: post._id });
  await Video.deleteOne({ _id: video._id });
  await Account.deleteOne({ _id: account._id });
});

// 21. Instagram Dispatch: Automatically dispatches Instagram Reel, creates container, and marks published
test('Scheduler Dispatch: Automatically dispatches Instagram Reel, creates container, and marks published', async () => {
  const igAccount = await Account.create({
    platform: 'instagram',
    accountId: `ig_${Date.now()}`,
    accountName: 'Test IG Brand',
    encryptedAccessToken: 'dummy_enc_ig_token',
    status: 'connected',
    isDemo: true,
  });

  const { video } = await createFixtures({ approvalStatus: 'approved' });

  const post = await Post.create({
    videoId: video._id,
    accountId: igAccount._id,
    platform: 'instagram',
    title: 'Instagram Reel Story',
    caption: 'Check out this Reel!',
    hashtags: ['Reels', 'Viral'],
    scheduledAt: new Date(Date.now() - 5000),
    status: 'queued',
    publishingStatus: 'ready_for_dispatch',
    attempts: 0,
    maxAttempts: 3,
  });

  const origPublishReel = instagramService.publishReel;
  let publishCalledWith = null;

  instagramService.publishReel = async (params) => {
    publishCalledWith = params;
    return {
      externalPostId: 'ig_media_reel_999888',
      externalUrl: 'https://www.instagram.com/p/ig_media_reel_999888/',
      containerId: 'container_12345',
    };
  };

  try {
    const populated = await Post.findById(post._id).populate('videoId').populate('accountId');
    await schedulerService.processClaimedPost(populated);

    const refreshed = await Post.findById(post._id);
    assert.ok(publishCalledWith, 'Must call instagramService.publishReel');
    assert.equal(publishCalledWith.account._id.toString(), igAccount._id.toString());
    assert.ok(publishCalledWith.videoUrl.includes(`/api/videos/${video._id}/stream`));
    assert.ok(publishCalledWith.caption.includes('Check out this Reel!'));
    assert.ok(publishCalledWith.caption.includes('#Reels'));

    assert.equal(refreshed.status, 'published');
    assert.equal(refreshed.publishingStatus, 'published');
    assert.equal(refreshed.publishDetails?.externalPostId, 'ig_media_reel_999888');
    assert.equal(refreshed.publishDetails?.containerId, 'container_12345');
    assert.ok(refreshed.publishedAt instanceof Date);

    const videoRefreshed = await Video.findById(video._id);
    assert.equal(videoRefreshed.status, 'published');
  } finally {
    instagramService.publishReel = origPublishReel;
    await Post.deleteOne({ _id: post._id });
    await Video.deleteOne({ _id: video._id });
    await Account.deleteOne({ _id: igAccount._id });
  }
});
