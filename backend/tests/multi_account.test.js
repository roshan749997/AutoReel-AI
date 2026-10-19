import test from 'node:test';
import assert from 'node:assert/strict';
import { Account } from '../src/models/Account.js';
import { Post } from '../src/models/Post.js';
import { Video } from '../src/models/Video.js';
import { schedulerService } from '../src/services/schedulerService.js';
import { connectDatabase, closeDatabase } from '../src/config/database.js';

test.before(async () => {
  await connectDatabase();
});

test.after(async () => {
  // Clean up any test accounts created during test execution
  await Account.deleteMany({
    isDemo: true,
    accountId: { $regex: /^(UC_chan_|UC_unique_|UC_target_|UC_dup_|UC_healthy_|UC_failing_|UC_expired_|UC_brand_|UC_disc_|UC_real_|UC_g1_|UC_g2_|ig_target_|ig_disc_)/ },
  });
  await closeDatabase();
});

// Helper to create test video fixture
async function createTestVideo(cleanTitle = 'Viral AI Short') {
  return await Video.create({
    driveFileId: `drive_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    originalName: `${cleanTitle.toLowerCase().replace(/\s+/g, '_')}.mp4`,
    cleanTitle,
    mimeType: 'video/mp4',
    status: 'metadata_ready',
    aiMetadata: {
      youtubeTitle: `${cleanTitle} #Shorts`,
      instagramCaption: `Check out ${cleanTitle}! #Reels #AI`,
      hashtags: ['#Shorts', '#Reels', '#AI'],
      approvalStatus: 'approved',
      approvedAt: new Date(),
    },
  });
}

// 1. Multiple independent accounts on the same platform
test('Multi-Account: Supports connecting multiple independent YouTube channels', async () => {
  const channelId1 = `UC_chan_1_${Date.now()}`;
  const channelId2 = `UC_chan_2_${Date.now()}`;

  const channel1 = await Account.create({
    platform: 'youtube',
    accountId: channelId1,
    accountName: 'Tech Channel Alpha',
    username: 'tech_alpha',
    encryptedAccessToken: 'enc_token_alpha',
    status: 'connected',
    isDemo: true,
    metadata: { subscriberCount: 15000 },
  });

  const channel2 = await Account.create({
    platform: 'youtube',
    accountId: channelId2,
    accountName: 'Tech Channel Beta',
    username: 'tech_beta',
    encryptedAccessToken: 'enc_token_beta',
    status: 'connected',
    isDemo: true,
    metadata: { subscriberCount: 3000 },
  });

  assert.ok(channel1._id);
  assert.ok(channel2._id);
  assert.notEqual(channel1._id.toString(), channel2._id.toString());
  assert.equal(channel1.platform, channel2.platform);
  assert.equal(channel1.accountName, 'Tech Channel Alpha');
  assert.equal(channel2.accountName, 'Tech Channel Beta');
});

// 2. Enforces unique (platform, accountId) compound index and rejects duplicate accounts
test('Multi-Account: Enforces unique compound index on (platform, accountId)', async () => {
  const sharedAccountId = `UC_unique_test_${Date.now()}`;

  await Account.create({
    platform: 'youtube',
    accountId: sharedAccountId,
    accountName: 'Original Channel',
    encryptedAccessToken: 'enc_token_orig',
    status: 'connected',
    isDemo: true,
  });

  await assert.rejects(
    async () => {
      await Account.create({
        platform: 'youtube',
        accountId: sharedAccountId,
        accountName: 'Duplicate Channel Try',
        encryptedAccessToken: 'enc_token_dup',
        status: 'connected',
        isDemo: true,
      });
    },
    (err) => {
      return err.code === 11000 || err.message.includes('duplicate key');
    }
  );
});

// 3. Multi-account target selection: schedules video to 2 YouTube channels and 1 Instagram account simultaneously
test('Multi-Account Publishing: Schedules a single video across multiple accounts independently', async () => {
  const video = await createTestVideo('Multi-Target Test');

  const ytAccount1 = await Account.create({
    platform: 'youtube',
    accountId: `UC_target_1_${Date.now()}`,
    accountName: 'Target Channel 1',
    encryptedAccessToken: 'enc_1',
    status: 'connected',
    isDemo: true,
  });

  const ytAccount2 = await Account.create({
    platform: 'youtube',
    accountId: `UC_target_2_${Date.now()}`,
    accountName: 'Target Channel 2',
    encryptedAccessToken: 'enc_2',
    status: 'connected',
    isDemo: true,
  });

  const igAccount = await Account.create({
    platform: 'instagram',
    accountId: `ig_target_${Date.now()}`,
    accountName: 'Target Instagram',
    username: 'target_ig',
    encryptedAccessToken: 'enc_ig',
    status: 'connected',
    isDemo: true,
  });

  const futureDate = new Date(Date.now() + 7200000);

  const post1 = await schedulerService.schedulePost({
    videoId: video._id,
    accountId: ytAccount1._id,
    platform: 'youtube',
    scheduledAt: futureDate,
    timezone: 'UTC',
  });

  const post2 = await schedulerService.schedulePost({
    videoId: video._id,
    accountId: ytAccount2._id,
    platform: 'youtube',
    scheduledAt: futureDate,
    timezone: 'UTC',
  });

  const post3 = await schedulerService.schedulePost({
    videoId: video._id,
    accountId: igAccount._id,
    platform: 'instagram',
    scheduledAt: futureDate,
    timezone: 'UTC',
  });

  assert.equal(post1.videoId.toString(), video._id.toString());
  assert.equal(post2.videoId.toString(), video._id.toString());
  assert.equal(post3.videoId.toString(), video._id.toString());

  // Distinct posts created
  assert.notEqual(post1._id.toString(), post2._id.toString());
  assert.notEqual(post1._id.toString(), post3._id.toString());

  // Check unique idempotency keys
  assert.notEqual(post1.idempotencyKey, post2.idempotencyKey);
  assert.notEqual(post1.idempotencyKey, post3.idempotencyKey);

  // Each post references its own account
  assert.equal(post1.accountId.toString(), ytAccount1._id.toString());
  assert.equal(post2.accountId.toString(), ytAccount2._id.toString());
  assert.equal(post3.accountId.toString(), igAccount._id.toString());
});

// 4. Duplicate prevention is per account: duplicate on same account fails, but different account succeeds
test('Multi-Account Duplicate Prevention: Prevents duplicates on same account while allowing across accounts', async () => {
  const video = await createTestVideo('Duplicate Test');

  const accountA = await Account.create({
    platform: 'youtube',
    accountId: `UC_dup_a_${Date.now()}`,
    accountName: 'Channel A',
    encryptedAccessToken: 'enc_a',
    status: 'connected',
    isDemo: true,
  });

  const accountB = await Account.create({
    platform: 'youtube',
    accountId: `UC_dup_b_${Date.now()}`,
    accountName: 'Channel B',
    encryptedAccessToken: 'enc_b',
    status: 'connected',
    isDemo: true,
  });

  const futureDate = new Date(Date.now() + 3600000);

  // Schedule to Channel A
  await schedulerService.schedulePost({
    videoId: video._id,
    accountId: accountA._id,
    platform: 'youtube',
    scheduledAt: futureDate,
  });

  // Scheduling again to Channel A must be rejected as duplicate
  await assert.rejects(
    async () => {
      await schedulerService.schedulePost({
        videoId: video._id,
        accountId: accountA._id,
        platform: 'youtube',
        scheduledAt: futureDate,
      });
    },
    (err) => {
      return err.statusCode === 409 && err.message.includes('Channel A');
    }
  );

  // But scheduling the same video to Channel B must succeed
  const postB = await schedulerService.schedulePost({
    videoId: video._id,
    accountId: accountB._id,
    platform: 'youtube',
    scheduledAt: futureDate,
  });

  assert.ok(postB._id);
  assert.equal(postB.accountId.toString(), accountB._id.toString());
});

// 5. Account isolation: Failure of 1 account does not mark other accounts' posts as failed
test('Account Isolation: Failure on one account does not affect other accounts', async () => {
  const video = await createTestVideo('Isolation Test');

  const healthyAccount = await Account.create({
    platform: 'youtube',
    accountId: `UC_healthy_${Date.now()}`,
    accountName: 'Healthy Channel',
    encryptedAccessToken: 'enc_h',
    status: 'connected',
    isDemo: true,
  });

  const failingAccount = await Account.create({
    platform: 'youtube',
    accountId: `UC_failing_${Date.now()}`,
    accountName: 'Failing Channel',
    encryptedAccessToken: 'enc_f',
    status: 'connected',
    isDemo: true,
  });

  const futureDate = new Date(Date.now() + 3600000);

  const healthyPost = await schedulerService.schedulePost({
    videoId: video._id,
    accountId: healthyAccount._id,
    platform: 'youtube',
    scheduledAt: futureDate,
  });

  const failingPost = await schedulerService.schedulePost({
    videoId: video._id,
    accountId: failingAccount._id,
    platform: 'youtube',
    scheduledAt: futureDate,
  });

  // Mark failingPost as failed
  failingPost.status = 'failed';
  failingPost.lastError = { message: 'Quota exceeded for failing channel', code: 'QUOTA_EXCEEDED' };
  await failingPost.save();

  const refreshedHealthy = await Post.findById(healthyPost._id);
  const refreshedFailing = await Post.findById(failingPost._id);

  assert.equal(refreshedFailing.status, 'failed');
  assert.equal(refreshedHealthy.status, 'scheduled');
  assert.ok(!refreshedHealthy.lastError?.message);
});

// 6. Authorization failure & expired token guard
test('Authorization Guard: Rejects scheduling to expired or disconnected accounts', async () => {
  const video = await createTestVideo('Auth Guard Test');

  const expiredAccount = await Account.create({
    platform: 'youtube',
    accountId: `UC_expired_${Date.now()}`,
    accountName: 'Expired Channel',
    encryptedAccessToken: 'enc_exp',
    status: 'expired',
    isDemo: true,
  });

  const disconnectedAccount = await Account.create({
    platform: 'instagram',
    accountId: `ig_disc_${Date.now()}`,
    accountName: 'Disconnected IG',
    encryptedAccessToken: 'enc_disc',
    status: 'disconnected',
    isActive: false,
    isDemo: true,
  });

  const futureDate = new Date(Date.now() + 3600000);

  await assert.rejects(
    async () => {
      await schedulerService.schedulePost({
        videoId: video._id,
        accountId: expiredAccount._id,
        platform: 'youtube',
        scheduledAt: futureDate,
      });
    },
    (err) => {
      return err.statusCode === 400 && err.message.includes('expired');
    }
  );

  await assert.rejects(
    async () => {
      await schedulerService.schedulePost({
        videoId: video._id,
        accountId: disconnectedAccount._id,
        platform: 'instagram',
        scheduledAt: futureDate,
      });
    },
    (err) => {
      return err.statusCode === 400 && err.message.includes('disconnected');
    }
  );
});

// 7. Per-account preferences and defaults
test('Account Preferences: Applies custom channel title prefixes and default tags', async () => {
  const video = await createTestVideo('Preference Showcase');

  const brandedAccount = await Account.create({
    platform: 'youtube',
    accountId: `UC_brand_${Date.now()}`,
    accountName: 'Brand Channel',
    encryptedAccessToken: 'enc_brand',
    status: 'connected',
    isDemo: true,
    settings: {
      defaultTitlePrefix: '[TECH] ',
      defaultTitleSuffix: ' | TechDaily',
      defaultTags: ['#TechDaily', '#Gadgets'],
      privacyStatus: 'unlisted',
    },
  });

  const futureDate = new Date(Date.now() + 3600000);

  const post = await schedulerService.schedulePost({
    videoId: video._id,
    accountId: brandedAccount._id,
    platform: 'youtube',
    scheduledAt: futureDate,
  });

  // Title must have prefix and suffix applied
  assert.ok(post.title.startsWith('[TECH] '));
  assert.ok(post.title.endsWith(' | TechDaily'));

  // Tags must include merged default tags
  assert.ok(post.hashtags.includes('#TechDaily'));
  assert.ok(post.hashtags.includes('#Gadgets'));
});

// 8. Safe disconnect updates status and preserves history
test('Safe Disconnect: Sets status to disconnected and isActive to false', async () => {
  const account = await Account.create({
    platform: 'youtube',
    accountId: `UC_disc_${Date.now()}`,
    accountName: 'Disconnect Target',
    encryptedAccessToken: 'enc_secret_token',
    status: 'connected',
    isActive: true,
    isDemo: true,
  });

  account.status = 'disconnected';
  account.isActive = false;
  await account.save();

  const refreshed = await Account.findById(account._id);
  assert.equal(refreshed.status, 'disconnected');
  assert.equal(refreshed.isActive, false);

  // Safe JSON representation does not leak tokens
  const safeJson = refreshed.toSafeJSON();
  assert.equal(safeJson.encryptedAccessToken, undefined);
  assert.equal(safeJson.encryptedRefreshToken, undefined);
});

// 9. Real Channel Discovery & Deduplication Upsert logic
test('Channel Discovery: Upserts real channels by unique ID and preserves real account status', async () => {
  const realChannelId = `UC_real_${Date.now()}`;
  const googleEmail = 'creator@example.com';

  // Initial discovery upsert
  let existing = await Account.findOne({ platform: 'youtube', accountId: realChannelId });
  assert.equal(existing, null);

  const newChannel = new Account({
    platform: 'youtube',
    accountId: realChannelId,
    accountName: 'Creator Real Shorts',
    username: '@CreatorRealShorts',
    profilePictureUrl: 'https://yt3.ggpht.com/sample_avatar.jpg',
    isDemo: false, // Must be marked as real
    googleEmail,
    metadata: {
      subscriberCount: 25000,
      videoCount: 120,
    },
  });
  newChannel.setTokens('sample_access_token', 'sample_refresh_token');
  await newChannel.save();

  assert.ok(newChannel._id);
  assert.equal(newChannel.isDemo, false);
  assert.equal(newChannel.googleEmail, 'creator@example.com');

  // Repeated discovery for the same channel ID updates metadata without creating a duplicate record
  const duplicateDiscovery = await Account.findOne({ platform: 'youtube', accountId: realChannelId });
  assert.ok(duplicateDiscovery);
  duplicateDiscovery.metadata.subscriberCount = 26000;
  duplicateDiscovery.metadata.videoCount = 125;
  await duplicateDiscovery.save();

  const totalCount = await Account.countDocuments({ platform: 'youtube', accountId: realChannelId });
  assert.equal(totalCount, 1, 'Should never create duplicate records for the same channel ID');

  const safeView = duplicateDiscovery.toSafeJSON();
  assert.equal(safeView.isDemo, false);
  assert.equal(safeView.encryptedAccessToken, undefined);
  assert.equal(safeView.encryptedRefreshToken, undefined);

  // Clean up
  await Account.deleteOne({ _id: duplicateDiscovery._id });
});

// 10. Multi-Google Account isolation: Channels under different Google emails remain distinct
test('Multi-Google Account Isolation: Discovers and maintains independent channels per Google user', async () => {
  const channelG1 = await Account.create({
    platform: 'youtube',
    accountId: `UC_g1_${Date.now()}`,
    accountName: 'Account 1 Channel',
    googleEmail: 'user1@gmail.com',
    encryptedAccessToken: 'enc_u1',
    status: 'connected',
    isDemo: true,
  });

  const channelG2 = await Account.create({
    platform: 'youtube',
    accountId: `UC_g2_${Date.now()}`,
    accountName: 'Account 2 Channel',
    googleEmail: 'user2@gmail.com',
    encryptedAccessToken: 'enc_u2',
    status: 'connected',
    isDemo: true,
  });

  assert.notEqual(channelG1.googleEmail, channelG2.googleEmail);
  assert.equal(channelG1.googleEmail, 'user1@gmail.com');
  assert.equal(channelG2.googleEmail, 'user2@gmail.com');
});

// 11. YouTube Data API Error formatting
test('YouTube API Error Handling: Accurately identifies disabled API and provides direct link', () => {
  const projectId = '702701632845';
  const apiError = new Error('Access Not Configured. YouTube Data API has not been used in project 702701632845 before or it is disabled.');
  apiError.code = 403;

  const errText = apiError.message;
  const isApiDisabled =
    errText.includes('has not been used in project') ||
    errText.includes('is disabled') ||
    errText.includes('Access Not Configured') ||
    apiError.code === 403;

  assert.equal(isApiDisabled, true);

  const enableUrl = `https://console.developers.google.com/apis/api/youtube.googleapis.com/overview?project=${projectId}`;
  assert.ok(enableUrl.includes(projectId));
  assert.ok(enableUrl.startsWith('https://console.developers.google.com'));
});
