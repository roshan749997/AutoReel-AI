import test from 'node:test';
import assert from 'node:assert/strict';
import { connectDatabase, closeDatabase } from '../src/config/database.js';
import { Post } from '../src/models/Post.js';
import { Video } from '../src/models/Video.js';
import { Account } from '../src/models/Account.js';
import { WorkflowLog } from '../src/models/WorkflowLog.js';
import { schedulerService } from '../src/services/schedulerService.js';
import {
  ensurePlatformPublishingDefaults,
  getPlatformPublishingSettings,
  isPlatformPublishingEnabled,
  setPlatformPublishingEnabled,
  PLATFORM_DISABLED_PAUSE_REASON,
} from '../src/services/platformPublishingService.js';
import { requireAdminAuth } from '../src/middleware/auth.js';
import { AppError } from '../src/middleware/errorHandler.js';
import { config } from '../src/config/env.js';

test.before(async () => {
  await connectDatabase();
  await ensurePlatformPublishingDefaults();
});

async function createFixtures(platform = 'youtube') {
  const account = await Account.create({
    platform,
    accountId: `${platform}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    accountName: `Test ${platform} ${Date.now()}`,
    encryptedAccessToken: 'dummy_enc_access_token',
    status: 'connected',
    isDemo: true,
  });

  const video = await Video.create({
    driveFileId: `drive_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    originalName: 'control_test.mp4',
    cleanTitle: 'Control Test Video',
    mimeType: 'video/mp4',
    status: 'metadata_ready',
    aiMetadata: {
      youtubeTitle: 'Control Test Video #Shorts',
      approvalStatus: 'approved',
    },
  });

  return { account, video };
}

async function cleanup(ids = {}) {
  if (ids.video) await Video.deleteOne({ _id: ids.video });
  if (ids.account) await Account.deleteOne({ _id: ids.account });
  if (ids.post) await Post.deleteOne({ _id: ids.post });
  if (ids.posts?.length) await Post.deleteMany({ _id: { $in: ids.posts } });
}

test('Platform settings: defaults exist as ENABLED and persist independently', async () => {
  await ensurePlatformPublishingDefaults();
  const settings = await getPlatformPublishingSettings();
  assert.equal(settings.length, 2);
  assert.ok(settings.every((s) => typeof s.publishingEnabled === 'boolean'));

  // Force known state then toggle youtube only
  await setPlatformPublishingEnabled('youtube', true, 'test');
  await setPlatformPublishingEnabled('instagram', true, 'test');

  await setPlatformPublishingEnabled('youtube', false, 'test-admin');
  assert.equal(await isPlatformPublishingEnabled('youtube'), false);
  assert.equal(await isPlatformPublishingEnabled('instagram'), true);

  // Simulate "restart": ensureDefaults must NOT flip youtube back ON
  await ensurePlatformPublishingDefaults();
  assert.equal(await isPlatformPublishingEnabled('youtube'), false);
  assert.equal(await isPlatformPublishingEnabled('instagram'), true);

  await setPlatformPublishingEnabled('youtube', true, 'test');
});

test('YouTube OFF pauses pending YouTube posts but not Instagram', async () => {
  await setPlatformPublishingEnabled('youtube', true, 'test');
  await setPlatformPublishingEnabled('instagram', true, 'test');

  const yt = await createFixtures('youtube');
  const ig = await createFixtures('instagram');

  const future = new Date(Date.now() + 3_600_000);
  const ytPost = await schedulerService.schedulePost({
    videoId: yt.video._id,
    accountId: yt.account._id,
    platform: 'youtube',
    scheduledAt: future,
    timezone: 'UTC',
  });
  const igPost = await schedulerService.schedulePost({
    videoId: ig.video._id,
    accountId: ig.account._id,
    platform: 'instagram',
    scheduledAt: future,
    timezone: 'UTC',
  });

  assert.equal(ytPost.status, 'scheduled');
  assert.equal(igPost.status, 'scheduled');

  const result = await setPlatformPublishingEnabled('youtube', false, 'test-admin');
  assert.equal(result.changed, true);
  assert.ok(result.pausedCount >= 1);

  const ytAfter = await Post.findById(ytPost._id);
  const igAfter = await Post.findById(igPost._id);
  assert.equal(ytAfter.status, 'paused');
  assert.equal(ytAfter.pauseReason, PLATFORM_DISABLED_PAUSE_REASON);
  assert.equal(igAfter.status, 'scheduled');

  const log = await WorkflowLog.findOne({
    module: 'settings',
    action: 'platform_publishing_toggled',
    'metadata.platform': 'youtube',
    'metadata.publishingEnabled': false,
  }).sort({ createdAt: -1 });
  assert.ok(log, 'audit log should exist');
  assert.equal(log.metadata.previousEnabled, true);

  await setPlatformPublishingEnabled('youtube', true, 'test');
  const ytResumed = await Post.findById(ytPost._id);
  assert.equal(ytResumed.status, 'scheduled');
  assert.ok(!ytResumed.pauseReason);
  assert.equal(String(ytResumed.scheduledAt.toISOString()), String(ytPost.scheduledAt.toISOString()));

  await cleanup({
    video: yt.video._id,
    account: yt.account._id,
    posts: [ytPost._id, igPost._id],
  });
  await cleanup({ video: ig.video._id, account: ig.account._id });
  await WorkflowLog.deleteMany({ module: 'settings', action: 'platform_publishing_toggled' });
});

test('YouTube OFF blocks publish-now and retry; Instagram unaffected setting-wise', async () => {
  await setPlatformPublishingEnabled('youtube', false, 'test');
  await setPlatformPublishingEnabled('instagram', true, 'test');

  const yt = await createFixtures('youtube');
  const future = new Date(Date.now() + 3_600_000);
  // schedule while OFF → created as paused
  const ytPost = await schedulerService.schedulePost({
    videoId: yt.video._id,
    accountId: yt.account._id,
    platform: 'youtube',
    scheduledAt: future,
    timezone: 'UTC',
  });
  assert.equal(ytPost.status, 'paused');
  assert.equal(ytPost.pauseReason, PLATFORM_DISABLED_PAUSE_REASON);

  await assert.rejects(
    () => schedulerService.publishPostNow(ytPost._id),
    /STOPPED|publishing is STOPPED/i
  );

  // Craft a failed post and ensure retry is blocked
  ytPost.status = 'failed';
  ytPost.pauseReason = undefined;
  await ytPost.save();

  await assert.rejects(
    () => schedulerService.retryPost(ytPost._id),
    /STOPPED|publishing is STOPPED/i
  );

  assert.equal(await isPlatformPublishingEnabled('instagram'), true);

  await setPlatformPublishingEnabled('youtube', true, 'test');
  await cleanup({ video: yt.video._id, account: yt.account._id, post: ytPost._id });
});

test('Instagram OFF does not disable YouTube setting', async () => {
  await setPlatformPublishingEnabled('youtube', true, 'test');
  await setPlatformPublishingEnabled('instagram', false, 'test');
  assert.equal(await isPlatformPublishingEnabled('youtube'), true);
  assert.equal(await isPlatformPublishingEnabled('instagram'), false);
  await setPlatformPublishingEnabled('instagram', true, 'test');
});

test('Both platforms can be disabled independently', async () => {
  await setPlatformPublishingEnabled('youtube', false, 'test');
  await setPlatformPublishingEnabled('instagram', false, 'test');
  assert.equal(await isPlatformPublishingEnabled('youtube'), false);
  assert.equal(await isPlatformPublishingEnabled('instagram'), false);
  await setPlatformPublishingEnabled('youtube', true, 'test');
  await setPlatformPublishingEnabled('instagram', true, 'test');
});

test('Unauthorized users cannot change platform settings when API key configured', async () => {
  const originalKey = config.dashboardApiKey;
  const originalEnv = config.nodeEnv;
  config.dashboardApiKey = 'test-secret-key-platform-controls';
  config.nodeEnv = 'production';

  let captured = null;
  requireAdminAuth(
    { headers: {}, socket: { remoteAddress: '8.8.8.8' } },
    {},
    (err) => {
      captured = err;
    }
  );

  assert.ok(captured instanceof AppError);
  assert.equal(captured.statusCode, 401);

  let allowed = false;
  requireAdminAuth(
    { headers: { 'x-api-key': 'test-secret-key-platform-controls' }, socket: { remoteAddress: '8.8.8.8' } },
    {},
    (err) => {
      allowed = !err;
    }
  );
  assert.equal(allowed, true);

  config.dashboardApiKey = originalKey;
  config.nodeEnv = originalEnv;
});

test('processDuePosts skips disabled platform candidates (no claim)', async () => {
  await setPlatformPublishingEnabled('youtube', false, 'test');
  await setPlatformPublishingEnabled('instagram', true, 'test');

  const yt = await createFixtures('youtube');
  // Manually create a due scheduled post (bypass schedule helper pause-on-create)
  const duePost = await Post.create({
    videoId: yt.video._id,
    accountId: yt.account._id,
    platform: 'youtube',
    title: 'Due while disabled #Shorts',
    scheduledAt: new Date(Date.now() - 60_000),
    timezone: 'UTC',
    status: 'scheduled',
    publishingStatus: 'unattempted',
    idempotencyKey: `disabled_due_${Date.now()}`,
  });

  await schedulerService.processDuePosts();
  const after = await Post.findById(duePost._id);
  assert.notEqual(after.status, 'processing');
  assert.notEqual(after.status, 'published');
  // Still scheduled (filter excluded it) — disable path via toggle would pause; here we only assert no pickup
  assert.equal(after.status, 'scheduled');

  await setPlatformPublishingEnabled('youtube', true, 'test');
  await cleanup({ video: yt.video._id, account: yt.account._id, post: duePost._id });
});

test.after(async () => {
  try {
    await setPlatformPublishingEnabled('youtube', true, 'test-cleanup');
    await setPlatformPublishingEnabled('instagram', true, 'test-cleanup');
  } catch {
    /* ignore */
  }
  await closeDatabase();
});
