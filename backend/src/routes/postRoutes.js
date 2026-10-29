import { Router } from 'express';
import { Post } from '../models/Post.js';
import { Video } from '../models/Video.js';
import { Account } from '../models/Account.js';
import { schedulerService } from '../services/schedulerService.js';
import { validateBody } from '../middleware/validator.js';
import { requireAdminAuth } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();

// 1. List posts with granular queue status filters, platform, accountId, and date ranges
router.get('/', async (req, res, next) => {
  try {
    const query = {};

    if (req.query.status && req.query.status !== 'all') {
      query.status = req.query.status;
    }

    if (req.query.platform && req.query.platform !== 'all') {
      query.platform = req.query.platform;
    }

    if (req.query.accountId && req.query.accountId !== 'all') {
      query.accountId = req.query.accountId;
    }

    if (req.query.from || req.query.to) {
      query.scheduledAt = {};
      if (req.query.from) query.scheduledAt.$gte = new Date(req.query.from);
      if (req.query.to) query.scheduledAt.$lte = new Date(req.query.to);
    }

    const posts = await Post.find(query)
      .populate('videoId', 'cleanTitle originalName driveFileId thumbnailUrl duration resolution aiMetadata folderId folderName folderPathIds folderPathNames')
      .populate('accountId', 'accountName platform profilePictureUrl username status')
      .sort({ scheduledAt: 1 });

    res.json({ status: 'success', data: posts });
  } catch (err) {
    next(err);
  }
});

// 2. Schedule a post for an approved video
router.post(
  '/',
  validateBody(['videoId', 'accountId', 'platform', 'scheduledAt']),
  async (req, res, next) => {
    try {
      const {
        videoId,
        accountId,
        platform,
        title,
        caption,
        hashtags,
        scheduledAt,
        timezone = 'UTC',
        allowDuplicate = false,
        autoApprove = false,
      } = req.body;

      const post = await schedulerService.schedulePost({
        videoId,
        accountId,
        platform,
        title,
        caption,
        hashtags,
        scheduledAt,
        timezone,
        allowDuplicate,
        autoApprove,
      });

      res.status(201).json({ status: 'success', data: post });
    } catch (err) {
      next(err);
    }
  }
);

// 3. Multi-platform / Multi-account schedule helper (Schedule to multiple YouTube channels & Instagram accounts simultaneously)
router.post(
  '/multi-platform',
  validateBody(['videoId', 'scheduledAt']),
  async (req, res, next) => {
    try {
      const {
        videoId,
        platforms, // array of { platform, accountId }
        targets,   // alias array of { platform, accountId }
        title,
        caption,
        hashtags,
        scheduledAt,
        timezone = 'UTC',
        allowDuplicate = false,
        autoApprove = false,
      } = req.body;

      const rawTargets = targets || platforms;

      if (!Array.isArray(rawTargets) || rawTargets.length === 0) {
        return next(new AppError('At least one target account must be provided in targets or platforms array', 400));
      }

      // If autoApprove is set, ensure video metadata is approved upfront
      if (autoApprove) {
        const video = await Video.findById(videoId);
        if (video && video.aiMetadata?.approvalStatus !== 'approved') {
          if (!video.aiMetadata) video.aiMetadata = {};
          video.aiMetadata.approvalStatus = 'approved';
          video.aiMetadata.approvedAt = new Date();
          if (title) {
            video.aiMetadata.youtubeTitle = title;
            video.aiMetadata.generatedTitle = title;
          }
          if (caption) video.aiMetadata.instagramCaption = caption;
          if (hashtags) {
            video.aiMetadata.hashtags = Array.isArray(hashtags)
              ? hashtags
              : String(hashtags).split(/[\s,]+/).filter(Boolean);
          }
          await video.save();
        }
      }

      const createdPosts = [];
      const errors = [];

      for (const target of rawTargets) {
        try {
          // If platform is not explicitly passed, infer from account
          let targetPlatform = target.platform;
          if (!targetPlatform) {
            const acc = await Account.findById(target.accountId);
            if (!acc) throw new Error(`Account ${target.accountId} not found`);
            targetPlatform = acc.platform;
          }

          const post = await schedulerService.schedulePost({
            videoId,
            accountId: target.accountId,
            platform: targetPlatform,
            title: target.title || title,
            caption: target.caption || caption,
            hashtags: target.hashtags || hashtags,
            scheduledAt,
            timezone,
            allowDuplicate: target.allowDuplicate !== undefined ? Boolean(target.allowDuplicate) : Boolean(allowDuplicate),
            autoApprove,
          });
          createdPosts.push(post);
        } catch (err) {
          errors.push({
            accountId: target.accountId,
            platform: target.platform || 'unknown',
            error: err.message,
          });
        }
      }

      const isSuccess = createdPosts.length > 0;
      const failureMessage = errors.length > 0
        ? errors.map((e) => (e.platform && e.platform !== 'unknown' ? `${e.platform.toUpperCase()}: ${e.error}` : e.error)).join('; ')
        : 'Failed to schedule post';

      res.status(isSuccess ? 201 : 400).json({
        status: isSuccess ? 'success' : 'fail',
        message: isSuccess
          ? (errors.length > 0
              ? `Scheduled ${createdPosts.length} post(s) with ${errors.length} issue(s): ${failureMessage}`
              : `Successfully scheduled ${createdPosts.length} post(s)`)
          : failureMessage,
        data: {
          scheduledPosts: createdPosts,
          errors,
          totalRequested: rawTargets.length,
          totalScheduled: createdPosts.length,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// 4. Batch schedule multiple videos with per-video timing and channel targets
router.post(
  '/batch-schedule',
  validateBody(['items']),
  async (req, res, next) => {
    try {
      const { items } = req.body;
      if (!Array.isArray(items) || items.length === 0) {
        return next(new AppError('Items array cannot be empty', 400));
      }

      const results = [];
      const allCreatedPosts = [];
      const allErrors = [];

      // 1. Preload all referenced accounts in a single query to eliminate N+1 DB lookups
      const allAccountIds = new Set();
      for (const item of items) {
        const targets = item.targets || item.platforms || [];
        for (const t of targets) {
          if (t.accountId) allAccountIds.add(String(t.accountId));
        }
      }
      const accountsList = await Account.find({ _id: { $in: Array.from(allAccountIds) } }).lean();
      const accountMap = new Map(accountsList.map((a) => [String(a._id), a]));

      // 2. Helper to process a single video item
      const processItem = async (item) => {
        const {
          videoId,
          targets,
          platforms,
          title,
          caption,
          hashtags,
          scheduledAt,
          timezone = 'UTC',
          allowDuplicate = false,
          autoApprove = true,
        } = item;

        const rawTargets = targets || platforms || [];
        if (!videoId || !scheduledAt || rawTargets.length === 0) {
          allErrors.push({
            videoId,
            error: 'Missing required fields (videoId, scheduledAt, or targets)',
          });
          return;
        }

        // If autoApprove is set, ensure video metadata is approved
        if (autoApprove) {
          try {
            const video = await Video.findById(videoId);
            if (video && video.aiMetadata?.approvalStatus !== 'approved') {
              if (!video.aiMetadata) video.aiMetadata = {};
              video.aiMetadata.approvalStatus = 'approved';
              video.aiMetadata.approvedAt = new Date();
              if (title) {
                video.aiMetadata.youtubeTitle = title;
                video.aiMetadata.generatedTitle = title;
              }
              if (caption) video.aiMetadata.instagramCaption = caption;
              if (hashtags) {
                video.aiMetadata.hashtags = Array.isArray(hashtags)
                  ? hashtags
                  : String(hashtags).split(/[\s,]+/).filter(Boolean);
              }
              await video.save();
            }
          } catch {
            // Non-blocking metadata sync
          }
        }

        const itemCreated = [];
        const itemErrors = [];

        for (const target of rawTargets) {
          try {
            let targetPlatform = target.platform;
            if (!targetPlatform) {
              const acc = accountMap.get(String(target.accountId));
              if (!acc) throw new Error(`Account ${target.accountId} not found`);
              targetPlatform = acc.platform;
            }

            const post = await schedulerService.schedulePost({
              videoId,
              accountId: target.accountId,
              platform: targetPlatform,
              title: target.title || title,
              caption: target.caption || caption,
              hashtags: target.hashtags || hashtags,
              scheduledAt,
              timezone,
              allowDuplicate: target.allowDuplicate !== undefined ? Boolean(target.allowDuplicate) : Boolean(allowDuplicate),
              autoApprove,
            });

            itemCreated.push(post);
            allCreatedPosts.push(post);
          } catch (err) {
            const errObj = {
              videoId,
              accountId: target.accountId,
              platform: target.platform || 'unknown',
              error: err.message,
            };
            itemErrors.push(errObj);
            allErrors.push(errObj);
          }
        }

        results.push({
          videoId,
          scheduledCount: itemCreated.length,
          errors: itemErrors,
        });
      };

      // 3. Process items in concurrency chunks of 5
      const CHUNK_SIZE = 5;
      for (let i = 0; i < items.length; i += CHUNK_SIZE) {
        const chunk = items.slice(i, i + CHUNK_SIZE);
        await Promise.all(chunk.map((item) => processItem(item)));
      }

      const totalScheduled = allCreatedPosts.length;
      res.status(totalScheduled > 0 ? 201 : 400).json({
        status: totalScheduled > 0 ? 'success' : 'fail',
        message: `Batch scheduling completed: ${totalScheduled} post(s) scheduled across ${items.length} video(s)${allErrors.length > 0 ? ` with ${allErrors.length} failure(s)` : ''}`,
        data: {
          totalScheduled,
          totalVideos: items.length,
          scheduledPosts: allCreatedPosts,
          errors: allErrors,
          results,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// 5. Get post details
router.get('/:id', async (req, res, next) => {
  try {
    const post = await Post.findById(req.params.id)
      .populate('videoId')
      .populate('accountId');

    if (!post) return next(new AppError('Post not found', 404));
    res.json({ status: 'success', data: post });
  } catch (err) {
    next(err);
  }
});

// 5. Update post details
router.patch('/:id', async (req, res, next) => {
  try {
    const allowed = ['title', 'caption', 'hashtags', 'timezone'];
    const updateDoc = {};

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        updateDoc[key] = req.body[key];
      }
    }

    const post = await Post.findByIdAndUpdate(req.params.id, { $set: updateDoc }, { new: true });
    if (!post) return next(new AppError('Post not found', 404));

    res.json({ status: 'success', data: post });
  } catch (err) {
    next(err);
  }
});

// 6. Pause a post schedule
router.post('/:id/pause', async (req, res, next) => {
  try {
    const post = await schedulerService.pausePost(req.params.id);
    res.json({ status: 'success', message: 'Post schedule paused', data: post });
  } catch (err) {
    next(err);
  }
});

// 7. Resume a paused post schedule
router.post('/:id/resume', async (req, res, next) => {
  try {
    const post = await schedulerService.resumePost(req.params.id);
    res.json({ status: 'success', message: 'Post schedule resumed', data: post });
  } catch (err) {
    next(err);
  }
});

// 8. Reschedule post to new date & timezone
router.post(
  '/:id/reschedule',
  validateBody(['scheduledAt']),
  async (req, res, next) => {
    try {
      const { scheduledAt, timezone } = req.body;
      const post = await schedulerService.reschedulePost(req.params.id, scheduledAt, timezone);
      res.json({ status: 'success', message: 'Post rescheduled successfully', data: post });
    } catch (err) {
      next(err);
    }
  }
);

// 9. Cancel a scheduled post
router.post('/:id/cancel', async (req, res, next) => {
  try {
    const { reason = 'Cancelled by user' } = req.body;
    const post = await schedulerService.cancelPost(req.params.id, reason);
    res.json({ status: 'success', message: 'Post cancelled', data: post });
  } catch (err) {
    next(err);
  }
});

// 10. Retry a failed/cancelled post
router.post('/:id/retry', async (req, res, next) => {
  try {
    const post = await schedulerService.retryPost(req.params.id);
    res.json({ status: 'success', message: 'Post reset for retry', data: post });
  } catch (err) {
    next(err);
  }
});

// 11. Trigger publish execution / confirmed dispatch
router.post('/:id/publish-now', requireAdminAuth, async (req, res, next) => {
  try {
    const refreshed = await schedulerService.publishPostNow(req.params.id);

    const isPublished = refreshed.status === 'published';
    res.json({
      status: 'success',
      message: isPublished
        ? `Post successfully published to YouTube! Video ID: ${refreshed.publishDetails?.externalPostId}`
        : `Publish processing executed. Status: ${refreshed.status}`,
      data: refreshed,
    });
  } catch (err) {
    next(err);
  }
});

// 12. Purge old, failed, or all posts from queue (bulk delete)
router.delete('/purge/all', requireAdminAuth, async (req, res, next) => {
  try {
    const { status, all } = req.query;
    const filter = {};

    if (all === 'true') {
      // Delete all posts in queue
    } else if (status && status !== 'all') {
      filter.status = status;
    } else {
      // Default purge targets failed, cancelled, and published old posts
      filter.status = { $in: ['failed', 'cancelled', 'published'] };
    }

    const result = await Post.deleteMany(filter);

    // Sync any videos whose active queued posts were removed
    const activeQueuedPostVideoIds = await Post.distinct('videoId', {
      status: { $in: ['scheduled', 'queued', 'processing', 'retrying'] },
    });
    await Video.updateMany(
      {
        status: 'queued',
        _id: { $nin: activeQueuedPostVideoIds },
      },
      {
        $set: { status: 'metadata_ready' },
      }
    );

    res.json({
      status: 'success',
      message: `Successfully cleared ${result.deletedCount} post(s) from publishing queue`,
      deletedCount: result.deletedCount,
    });
  } catch (err) {
    next(err);
  }
});

// 13. Delete post completely from queue
router.delete('/:id', requireAdminAuth, async (req, res, next) => {
  try {
    const post = await Post.findByIdAndDelete(req.params.id);
    if (!post) return next(new AppError('Post not found', 404));

    // Check if video still has any active posts in queue
    const remainingActive = await Post.countDocuments({
      videoId: post.videoId,
      status: { $in: ['scheduled', 'queued', 'processing', 'retrying'] },
    });
    if (remainingActive === 0) {
      const video = await Video.findById(post.videoId);
      if (video && video.status === 'queued') {
        video.status = video.aiMetadata?.generatedTitle ? 'metadata_ready' : 'discovered';
        await video.save();
      }
    }

    res.json({ status: 'success', message: 'Post removed from publishing queue' });
  } catch (err) {
    next(err);
  }
});

export default router;
