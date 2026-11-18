import {
  PlatformPublishingSetting,
  PLATFORM_PUBLISHING_PLATFORMS,
} from '../models/PlatformPublishingSetting.js';
import { Post } from '../models/Post.js';
import { WorkflowLog } from '../models/WorkflowLog.js';
import { AppError } from '../middleware/errorHandler.js';

export { PLATFORM_PUBLISHING_PLATFORMS };
export const PLATFORM_DISABLED_PAUSE_REASON = 'platform_disabled';

const PAUSABLE_STATUSES = ['scheduled', 'queued', 'retrying'];

function normalizePlatform(platform) {
  const value = String(platform || '')
    .trim()
    .toLowerCase();
  if (!PLATFORM_PUBLISHING_PLATFORMS.includes(value)) {
    throw new AppError(`Invalid platform. Allowed: ${PLATFORM_PUBLISHING_PLATFORMS.join(', ')}`, 400);
  }
  return value;
}

function toPublicSetting(doc) {
  return {
    platform: doc.platform,
    publishingEnabled: Boolean(doc.publishingEnabled),
    status: doc.publishingEnabled ? 'ACTIVE' : 'STOPPED',
    updatedAt: doc.updatedAt || null,
    updatedBy: doc.updatedBy || 'system',
  };
}

/**
 * Ensure youtube + instagram settings exist.
 * Defaults to ENABLED so existing deployments keep publishing.
 * Never overwrites an existing document (safe across restarts).
 */
export async function ensurePlatformPublishingDefaults() {
  const ops = PLATFORM_PUBLISHING_PLATFORMS.map((platform) =>
    PlatformPublishingSetting.updateOne(
      { platform },
      {
        $setOnInsert: {
          platform,
          publishingEnabled: true,
          updatedBy: 'system',
        },
      },
      { upsert: true }
    )
  );
  await Promise.all(ops);
}

export async function getPlatformPublishingSettings() {
  await ensurePlatformPublishingDefaults();
  const docs = await PlatformPublishingSetting.find({
    platform: { $in: PLATFORM_PUBLISHING_PLATFORMS },
  }).lean();

  const byPlatform = Object.fromEntries(docs.map((d) => [d.platform, d]));
  return PLATFORM_PUBLISHING_PLATFORMS.map((platform) =>
    toPublicSetting(
      byPlatform[platform] || {
        platform,
        publishingEnabled: true,
        updatedAt: null,
        updatedBy: 'system',
      }
    )
  );
}

export async function isPlatformPublishingEnabled(platform) {
  const normalized = normalizePlatform(platform);
  await ensurePlatformPublishingDefaults();
  const doc = await PlatformPublishingSetting.findOne({ platform: normalized }).lean();
  // Fail-closed only if explicitly false; missing doc treated as enabled after ensure
  return doc ? Boolean(doc.publishingEnabled) : true;
}

async function pauseEligiblePostsForPlatform(platform) {
  const now = new Date();
  const result = await Post.updateMany(
    {
      platform,
      status: { $in: PAUSABLE_STATUSES },
    },
    {
      $set: {
        status: 'paused',
        pauseReason: PLATFORM_DISABLED_PAUSE_REASON,
        nextRetryAt: null,
        claimedAt: null,
        claimedBy: null,
      },
      $push: {
        executionLogs: {
          timestamp: now,
          step: 'platform_publishing_paused',
          message: `${platform} publishing was disabled by admin. Post preserved and paused (not failed).`,
          level: 'warn',
        },
      },
    }
  );
  return result.modifiedCount || 0;
}

async function resumeEligiblePostsForPlatform(platform) {
  const now = new Date();
  const result = await Post.updateMany(
    {
      platform,
      status: 'paused',
      pauseReason: PLATFORM_DISABLED_PAUSE_REASON,
    },
    {
      $set: {
        status: 'scheduled',
        claimedAt: null,
        claimedBy: null,
      },
      $unset: { pauseReason: 1 },
      $push: {
        executionLogs: {
          timestamp: now,
          step: 'platform_publishing_resumed',
          message: `${platform} publishing was re-enabled. Post restored to scheduled (original scheduledAt preserved; not force-published).`,
          level: 'info',
        },
      },
    }
  );
  return result.modifiedCount || 0;
}

/**
 * Atomically toggle a platform. Uses findOneAndUpdate for concurrent safety.
 */
export async function setPlatformPublishingEnabled(platform, publishingEnabled, updatedBy = 'admin') {
  const normalized = normalizePlatform(platform);
  if (typeof publishingEnabled !== 'boolean') {
    throw new AppError('publishingEnabled must be a boolean', 400);
  }

  await ensurePlatformPublishingDefaults();

  const previous = await PlatformPublishingSetting.findOne({ platform: normalized }).lean();
  const previousEnabled = previous ? Boolean(previous.publishingEnabled) : true;

  if (previousEnabled === publishingEnabled) {
    const current = await PlatformPublishingSetting.findOne({ platform: normalized });
    return {
      setting: toPublicSetting(current),
      previousEnabled,
      changed: false,
      pausedCount: 0,
      resumedCount: 0,
    };
  }

  const updated = await PlatformPublishingSetting.findOneAndUpdate(
    { platform: normalized },
    {
      $set: {
        publishingEnabled,
        updatedBy: String(updatedBy || 'admin').slice(0, 120),
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  let pausedCount = 0;
  let resumedCount = 0;

  if (!publishingEnabled) {
    pausedCount = await pauseEligiblePostsForPlatform(normalized);
  } else {
    resumedCount = await resumeEligiblePostsForPlatform(normalized);
  }

  await WorkflowLog.create({
    level: publishingEnabled ? 'success' : 'warn',
    module: 'settings',
    action: 'platform_publishing_toggled',
    message: `${normalized} publishing ${publishingEnabled ? 'ENABLED' : 'DISABLED'} by ${updatedBy}`,
    metadata: {
      platform: normalized,
      previousEnabled,
      publishingEnabled,
      updatedBy: String(updatedBy || 'admin'),
      pausedCount,
      resumedCount,
      result: 'ok',
    },
  }).catch(() => {});

  return {
    setting: toPublicSetting(updated),
    previousEnabled,
    changed: true,
    pausedCount,
    resumedCount,
  };
}

/**
 * Release a claimed/processing post back to paused when platform was disabled mid-flight
 * before upload initiation. Does not mark as failed.
 * @param {object} post
 * @param {{ undoAttempt?: boolean }} [options] - set undoAttempt when attempts was already incremented
 */
export async function releasePostForDisabledPlatform(post, { undoAttempt = false } = {}) {
  if (!post) return null;
  if (undoAttempt) {
    post.attempts = Math.max(0, (post.attempts || 1) - 1);
  }
  post.status = 'paused';
  post.pauseReason = PLATFORM_DISABLED_PAUSE_REASON;
  post.nextRetryAt = null;
  post.claimedAt = null;
  post.claimedBy = null;
  if (post.publishingStatus !== 'published') {
    post.publishingStatus = 'unattempted';
  }
  post.executionLogs.push({
    step: 'platform_publishing_blocked',
    message: `${post.platform} publishing is STOPPED. Upload was not started; post paused safely.`,
    level: 'warn',
  });
  await post.save();
  return post;
}

export const platformPublishingService = {
  ensurePlatformPublishingDefaults,
  getPlatformPublishingSettings,
  isPlatformPublishingEnabled,
  setPlatformPublishingEnabled,
  releasePostForDisabledPlatform,
  PLATFORM_DISABLED_PAUSE_REASON,
  PLATFORM_PUBLISHING_PLATFORMS,
};
