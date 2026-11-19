import { Post } from '../models/Post.js';
import { Video } from '../models/Video.js';
import { Account } from '../models/Account.js';
import { WorkflowLog } from '../models/WorkflowLog.js';
import { googleDriveService } from './googleDriveService.js';
import { youtubeService } from './youtubeService.js';
import { instagramService } from './instagramService.js';
import {
  isPlatformPublishingEnabled,
  releasePostForDisabledPlatform,
  PLATFORM_DISABLED_PAUSE_REASON,
} from './platformPublishingService.js';
import { AppError } from '../middleware/errorHandler.js';
import { config, resolveBackendPublicUrl } from '../config/env.js';
import axios from 'axios';

export class SchedulerService {
  constructor() {
    this.timer = null;
    this.isProcessing = false;
    /** When > 0, auto queue ticks skip so Publish Now cannot race into other due posts */
    this.manualPublishDepth = 0;
    this.workerId = `worker_${process.pid}_${Math.random().toString(36).substring(2, 7)}`;
    this.concurrencyLimit = 2;
  }

  /**
   * Start periodic queue worker and recover any interrupted jobs from previous server restarts
   */
  async start(intervalMs = 15000) {
    if (this.timer) return;
    console.log(`[Scheduler] Publishing queue worker initialized (${this.workerId}, interval: ${intervalMs / 1000}s)`);

    // Recovery step: Unstick any jobs that were interrupted in 'processing' state during server restart
    await this.recoverInterruptedJobs();

    this.timer = setInterval(() => this.processDuePosts(), intervalMs);

    // Initial check shortly after start
    setTimeout(() => this.processDuePosts(), 2500);
  }

  /**
   * Graceful shutdown of scheduler worker
   */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log(`[Scheduler] Publishing queue worker stopped (${this.workerId})`);
    }
  }

  /**
   * Crash & Restart Recovery:
   * Finds jobs left in 'processing' status and safely transitions them back to 'queued' with an audit log.
   */
  async recoverInterruptedJobs() {
    try {
      const stuckPosts = await Post.find({ status: 'processing' });
      if (stuckPosts.length > 0) {
        console.warn(`[Scheduler] Recovering ${stuckPosts.length} interrupted job(s) from previous backend run`);
        for (const post of stuckPosts) {
          // If the post already has an external YouTube video ID, it was already uploaded!
          // NEVER transition back to queued; mark published so it cannot re-upload.
          if (post.publishDetails?.externalPostId) {
            post.status = 'published';
            post.publishingStatus = 'published';
            post.claimedAt = null;
            post.claimedBy = null;
            post.executionLogs.push({
              step: 'crash_recovery_verified',
              message: `Job recovered after restart. YouTube video ID (${post.publishDetails.externalPostId}) already confirmed. Set to published.`,
              level: 'info',
            });
            await post.save();
            continue;
          }

          // If attempts were exhausted prior to restart, transition to failed
          if (post.attempts >= post.maxAttempts) {
            post.status = 'failed';
            post.publishingStatus = 'failed';
            post.claimedAt = null;
            post.claimedBy = null;
            post.executionLogs.push({
              step: 'crash_recovery_exhausted',
              message: `Job reached max attempts (${post.attempts}/${post.maxAttempts}) prior to restart. Marked failed.`,
              level: 'error',
            });
            await post.save();
            continue;
          }

          post.status = 'queued';
          post.claimedAt = null;
          post.claimedBy = null;
          post.executionLogs.push({
            step: 'crash_recovery',
            message: `Recovered job from 'processing' state after server restart`,
            level: 'warn',
          });
          await post.save();

          await WorkflowLog.create({
            level: 'warn',
            module: 'scheduler',
            action: 'crash_recovery',
            message: `Post "${post.title}" (${post._id}) recovered after server restart`,
            metadata: { postId: post._id },
          }).catch(() => {});
        }
      }
    } catch (err) {
      console.error(`[Scheduler] Error during crash recovery: ${err.message}`);
    }
  }

  /**
   * Schedule an approved video for publication
   * Strict validation:
   * 1. Requires approved video metadata (approvalStatus === 'approved')
   * 2. Requires connected social account
   * 3. Prevents duplicate active schedules for same video & platform
   * 4. Enforces valid date/time and timezone
   * 5. Generates deterministic idempotencyKey
   */
  async schedulePost({
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
    preloadedVideo = null,
    preloadedAccount = null,
    preloadedExistingPost = undefined,
  }) {
    // 1. Fetch & validate referenced video
    const video = preloadedVideo || (await Video.findById(videoId));
    if (!video) {
      const err = new Error('Referenced video record not found');
      err.statusCode = 404;
      throw err;
    }

    // Strict Rule: Schedule only videos with approved metadata
    let approvalStatus = video.aiMetadata?.approvalStatus;
    if (approvalStatus !== 'approved' && autoApprove) {
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
      approvalStatus = 'approved';
    }

    if (approvalStatus !== 'approved') {
      const err = new Error(
        `Video metadata must be reviewed and approved before scheduling (current status: '${approvalStatus || 'draft'}')`
      );
      err.statusCode = 400;
      throw err;
    }

    // 2. Fetch & validate referenced social account
    const account = preloadedAccount || (await Account.findById(accountId));
    if (!account) {
      const err = new Error('Target social account not found');
      err.statusCode = 404;
      throw err;
    }

    if (!account.isActive || account.status === 'disconnected') {
      const err = new Error(`Account "${account.accountName}" is disconnected and cannot be scheduled for publishing`);
      err.statusCode = 400;
      throw err;
    }

    if (account.status === 'expired' || account.status === 'authorization_required') {
      const err = new Error(
        `Account "${account.accountName}" authorization has expired. Please reconnect the account before scheduling.`
      );
      err.statusCode = 400;
      throw err;
    }

    if (account.platform !== platform) {
      const err = new Error(
        `Account platform mismatch: Selected account is for ${account.platform}, but post target is ${platform}`
      );
      err.statusCode = 400;
      throw err;
    }

    // 3. Date & Timezone validation
    const targetDate = new Date(scheduledAt);
    if (isNaN(targetDate.getTime())) {
      const err = new Error('Invalid scheduledAt timestamp');
      err.statusCode = 400;
      throw err;
    }

    // Reject past schedules (with a 2-minute grace window for clock skew)
    const now = new Date();
    if (targetDate.getTime() < now.getTime() - 120000) {
      const err = new Error('Cannot schedule a post in the past. Please choose a future date and time.');
      err.statusCode = 400;
      throw err;
    }

    // 4. Duplicate schedule prevention for same video and account
    if (!allowDuplicate) {
      const existingPost =
        preloadedExistingPost !== undefined
          ? preloadedExistingPost
          : await Post.findOne({
              videoId,
              accountId,
              status: { $in: ['scheduled', 'queued', 'processing', 'retrying', 'published', 'manual_review'] },
            });

      if (existingPost) {
        const isPublished = existingPost.status === 'published';
        const isReview = existingPost.status === 'manual_review';
        const err = new Error(
          isPublished
            ? `This video has already been published to ${platform.toUpperCase()} (account: "${account.accountName}", Post ID: ${existingPost._id}, Video ID: ${existingPost.publishDetails?.externalPostId || 'recorded'}). Duplicate uploads are blocked by policy unless explicitly overridden.`
            : isReview
            ? `This video was previously uploaded to ${platform.toUpperCase()} but is under manual review (account: "${account.accountName}", Post ID: ${existingPost._id}). Duplicate uploads are blocked.`
            : `An active schedule already exists for this video on ${platform.toUpperCase()} (account: "${account.accountName}", Post ID: ${existingPost._id}, scheduled for ${existingPost.scheduledAt?.toISOString()})`
        );
        err.statusCode = 409;
        err.isDuplicate = true;
        throw err;
      }

      // 4.1 Also check video's permanent publishedPlatforms tracking
      const publishedRecord = video.publishedPlatforms?.find(
        (p) => String(p.accountId) === String(accountId) || (p.platform === platform && p.accountName === account.accountName)
      );
      if (publishedRecord) {
        const err = new Error(
          `This video has already been published to ${platform.toUpperCase()} (account: "${account.accountName}", Video ID: ${publishedRecord.externalPostId || 'recorded'}). Duplicate uploads are blocked by policy.`
        );
        err.statusCode = 409;
        err.isDuplicate = true;
        throw err;
      }
    } else {
      // Overwrite/update existing scheduled post if still in queue
      const existingPost = await Post.findOne({
        videoId,
        accountId,
        status: { $in: ['scheduled', 'queued'] },
      });
      if (existingPost) {
        existingPost.scheduledAt = targetDate;
        existingPost.timezone = timezone;
        if (title) existingPost.title = title;
        if (caption) existingPost.caption = caption;
        existingPost.executionLogs.push({
          step: 'rescheduled',
          message: `Rescheduled to ${targetDate.toISOString()} via Batch Schedule overwrite`,
          level: 'info',
        });
        await existingPost.save();
        return existingPost;
      }
    }

    // 5. Deterministic Idempotency Key per video, platform, and account
    const timeEpochSeconds = Math.floor(targetDate.getTime() / 1000);
    const idempotencyKey = `post_${videoId}_${platform}_${accountId}_${timeEpochSeconds}`;

    // Clean tags and merge with account default tags if applicable
    const inputTags = Array.isArray(hashtags)
      ? hashtags
      : String(hashtags || '')
          .split(/[\s,]+/)
          .filter(Boolean);
    const defaultTags = account.settings?.defaultTags || [];
    const combinedTags = Array.from(new Set([...inputTags, ...defaultTags]));

    // Construct final title with account settings prefix/suffix if configured
    const prefix = account.settings?.defaultTitlePrefix || '';
    const suffix = account.settings?.defaultTitleSuffix || '';
    const baseTitle = title || video.aiMetadata?.youtubeTitle || video.cleanTitle || video.originalName;
    let finalTitle = `${prefix}${baseTitle}${suffix}`.trim();
    if (platform === 'youtube' && !finalTitle.toLowerCase().includes('#shorts')) {
      if (finalTitle.length + 8 <= 100) {
        finalTitle = `${finalTitle} #Shorts`;
      } else {
        finalTitle = `${finalTitle.substring(0, 91).trim()} #Shorts`;
      }
    }

    // 6. Create Post in MongoDB (paused if platform publishing kill-switch is OFF)
    const platformEnabled = await isPlatformPublishingEnabled(platform);
    const initialStatus = platformEnabled ? 'scheduled' : 'paused';
    const scheduleLogMessage = platformEnabled
      ? `Post scheduled for ${targetDate.toISOString()} (${timezone}) on account "${account.accountName}"`
      : `Post saved but paused: ${platform} publishing is STOPPED. Will resume when platform is re-enabled.`;

    const post = await Post.create({
      videoId,
      accountId,
      platform,
      title: finalTitle,
      caption: caption || video.aiMetadata?.instagramCaption || video.aiMetadata?.description || '',
      hashtags: combinedTags,
      scheduledAt: targetDate,
      timezone,
      status: initialStatus,
      pauseReason: platformEnabled ? undefined : PLATFORM_DISABLED_PAUSE_REASON,
      publishingStatus: 'unattempted',
      idempotencyKey,
      requiresConfirmation: true,
      executionLogs: [
        {
          step: platformEnabled ? 'scheduled' : 'platform_publishing_paused',
          message: scheduleLogMessage,
          level: platformEnabled ? 'info' : 'warn',
        },
      ],
    });

    // Update account stats
    await Account.findByIdAndUpdate(accountId, {
      $inc: { 'stats.totalScheduled': 1 },
    }).catch(() => {});

    // Update video status to queued
    if (video.status === 'discovered' || video.status === 'metadata_ready') {
      video.status = 'queued';
      await video.save();
    }

    // Audit Log
    await WorkflowLog.create({
      level: 'info',
      module: 'scheduler',
      action: 'post_scheduled',
      message: `Scheduled post "${post.title}" for ${platform} (${account.accountName}) at ${targetDate.toISOString()}`,
      metadata: { postId: post._id, videoId, accountId, platform, scheduledAt: targetDate, timezone },
    }).catch(() => {});

    // Notify n8n asynchronously (non-blocking)
    this.notifyN8n('post_scheduled', post).catch(() => {});

    return post;
  }

  /**
   * Main Queue Polling Loop with Bounded Concurrency & Atomic Claiming
   */
  async processDuePosts() {
    if (this.isProcessing) return;
    // Do not auto-claim other queue items while an admin Publish Now is running
    if (this.manualPublishDepth > 0) {
      console.log('[Scheduler] Skipping auto tick — manual Publish Now in progress');
      return;
    }
    this.isProcessing = true;

    try {
      const now = new Date();

      const [youtubeEnabled, instagramEnabled] = await Promise.all([
        isPlatformPublishingEnabled('youtube'),
        isPlatformPublishingEnabled('instagram'),
      ]);
      const enabledPlatforms = [
        youtubeEnabled ? 'youtube' : null,
        instagramEnabled ? 'instagram' : null,
      ].filter(Boolean);

      if (enabledPlatforms.length === 0) {
        return;
      }

      // Find due posts with backoff respected:
      // - scheduled/queued: due when scheduledAt <= now
      // - retrying: due ONLY when nextRetryAt <= now (do not match on stale scheduledAt)
      // - Exclude jobs where attempts >= maxAttempts
      // - Exclude platforms whose publishing kill-switch is OFF
      const candidatePosts = await Post.find({
        platform: { $in: enabledPlatforms },
        $expr: { $lt: ['$attempts', '$maxAttempts'] },
        $or: [
          {
            status: { $in: ['scheduled', 'queued'] },
            scheduledAt: { $lte: now },
          },
          {
            status: 'retrying',
            nextRetryAt: { $lte: now },
          },
        ],
      })
        .sort({ scheduledAt: 1 })
        .limit(this.concurrencyLimit);

      if (candidatePosts.length === 0) {
        return;
      }

      console.log(
        `[Scheduler] Found ${candidatePosts.length} due job(s) for dispatch at ${now.toISOString()} (${now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })} Asia/Kolkata):`,
        candidatePosts
          .map(
            (p) =>
              `[${p.platform.toUpperCase()}] ${p._id} "${p.title?.slice(0, 30)}" status:${p.status} attempts:${p.attempts}/${p.maxAttempts}`
          )
          .join(', ')
      );

      // Process up to concurrencyLimit jobs with atomic claiming
      const claimPromises = candidatePosts.map((candidate) => this.claimAndProcess(candidate));
      await Promise.all(claimPromises);
    } catch (err) {
      console.error(`[Scheduler] Queue tick error: ${err.message}`);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Atomic Claim:
   * Uses findOneAndUpdate with status and attempt filters so two workers can NEVER claim the same post.
   */
  async claimAndProcess(candidate) {
    const now = new Date();
    const claimFilter =
      candidate.status === 'retrying'
        ? {
            _id: candidate._id,
            status: 'retrying',
            nextRetryAt: { $lte: now },
            $expr: { $lt: ['$attempts', '$maxAttempts'] },
          }
        : {
            _id: candidate._id,
            status: { $in: ['scheduled', 'queued'] },
            scheduledAt: { $lte: now },
            $expr: { $lt: ['$attempts', '$maxAttempts'] },
          };

    const post = await Post.findOneAndUpdate(
      claimFilter,
      {
        $set: {
          status: 'processing',
          claimedAt: new Date(),
          claimedBy: this.workerId,
        },
        $push: {
          executionLogs: {
            step: 'claimed',
            message: `Claimed by worker ${this.workerId} (Attempt ${candidate.attempts + 1})`,
            level: 'info',
          },
        },
      },
      { new: true }
    )
      .populate('videoId')
      .populate('accountId');

    if (!post) {
      // Another worker claimed this post or attempts were exhausted
      return;
    }

    // Backend kill-switch: re-check persisted setting after claim (before any upload)
    const platformEnabled = await isPlatformPublishingEnabled(post.platform);
    if (!platformEnabled) {
      console.warn(
        `[Scheduler] ${post.platform} publishing is STOPPED — releasing claimed post ${post._id} without upload`
      );
      await releasePostForDisabledPlatform(post);
      return;
    }

    console.log(
      `[Scheduler] Worker ${this.workerId} claimed post ${post._id} (${post.platform.toUpperCase()}, Attempt ${post.attempts + 1}/${post.maxAttempts})`
    );

    await this.processClaimedPost(post);
  }

  /**
   * Process & Dispatch Claimed Post:
   * 1. Checks retry limits and increments attempts
   * 2. Runs pre-flight verification (Drive video stream, account authorization, title format)
   * 3. Checks existing upload history & idempotency to avoid duplicates
   * 4. Streams video from Google Drive and uploads to YouTube Data API
   * 5. Transitions to 'published' ONLY upon receiving confirmed video ID from YouTube API
   */
  async processClaimedPost(post) {
    // 0. Platform publishing kill-switch (latest MongoDB value — never env/frontend only)
    const platformEnabled = await isPlatformPublishingEnabled(post.platform);
    if (!platformEnabled) {
      await releasePostForDisabledPlatform(post);
      return;
    }

    // 1. Check maxAttempts guard before execution
    if (post.attempts >= post.maxAttempts) {
      const limitErr = new Error(`Max retry attempts (${post.maxAttempts}) exhausted.`);
      limitErr.isPermanent = true;
      await this.handleQueueFailure(post, limitErr);
      return;
    }

    post.attempts += 1;
    post.claimedAt = new Date();

    try {
      // Re-check immediately before Drive stream / platform upload initiation
      if (!(await isPlatformPublishingEnabled(post.platform))) {
        await releasePostForDisabledPlatform(post, { undoAttempt: true });
        return;
      }

      const video = post.videoId;
      const account = post.accountId;

      // 2. Existence & Association validation
      if (!video) {
        const err = new Error('Referenced video record has been deleted or cannot be resolved');
        err.isPermanent = true;
        throw err;
      }
      if (!account) {
        const err = new Error('Target social account has been deleted or unlinked');
        err.isPermanent = true;
        throw err;
      }

      // 3. Account status & authorization validation
      // Network-blip "error" accounts still have valid tokens — allow publish; only block real auth failures
      const networkBlip =
        account.status === 'error' &&
        /ETIMEDOUT|ENETUNREACH|ECONNRESET|Temporary network|connect E|timeout/i.test(account.errorMessage || '');
      if ((!account.isActive || (account.status !== 'connected' && !networkBlip))) {
        const err = new Error(`Target account "${account.accountName}" is disconnected (status: ${account.status})`);
        err.isPermanent = true;
        throw err;
      }

      if (account.platform !== post.platform) {
        const err = new Error(`Account platform mismatch: Target account is ${account.platform}, post is for ${post.platform}`);
        err.isPermanent = true;
        throw err;
      }

      // 4. Video metadata approval validation
      if (video.aiMetadata?.approvalStatus !== 'approved') {
        const err = new Error('Video metadata approval was revoked or is not in approved state');
        err.isPermanent = true;
        throw err;
      }

      // 5. Platform-specific pre-flight checks
      if (post.platform === 'youtube') {
        if (!video.driveFileId) {
          const err = new Error('Missing Google Drive file ID for YouTube upload. Please re-index video.');
          err.isPermanent = true;
          throw err;
        }

        if (account.scopes && account.scopes.length > 0) {
          const hasUploadScope = account.scopes.some(
            (s) => s.includes('youtube.upload') || s.includes('youtube')
          );
          if (!hasUploadScope) {
            const err = new Error('Google account is missing YouTube upload scope (https://www.googleapis.com/auth/youtube.upload). Reconnect required.');
            err.isPermanent = true;
            throw err;
          }
        }

        if (!post.title || post.title.trim().length === 0) {
          const err = new Error('YouTube Shorts title cannot be empty');
          err.isPermanent = true;
          throw err;
        }

        if (post.title.length > 100) {
          const err = new Error(`YouTube Shorts title length invalid (${post.title.length} chars, max 100)`);
          err.isPermanent = true;
          throw err;
        }
      } else if (post.platform === 'instagram') {
        if (!video.driveWebViewLink && !video.driveFileId) {
          const err = new Error('Video must have an accessible Google Drive ID or web view link for Instagram Reel publishing');
          err.isPermanent = true;
          throw err;
        }
      }

      // 6. Duplicate check / Persistent Idempotency verification
      if (post.publishDetails?.externalPostId) {
        const existingStatus = await youtubeService.checkVideoStatus(account, post.publishDetails.externalPostId);
        if (existingStatus) {
          if (existingStatus.isRejected || existingStatus.uploadStatus === 'rejected') {
            post.status = 'manual_review';
            post.publishingStatus = 'rejected';
            post.nextRetryAt = null;
            post.publishDetails.uploadStatus = 'rejected';
            post.publishDetails.rejectionReason = existingStatus.rejectionReason || 'duplicate_or_removed';
            post.lastError = {
              code: 'POLICY_REMOVAL_DUPLICATE',
              message: `YouTube rejected or removed this video (${existingStatus.rejectionReason || 'duplicate/policy'}). Automatic retries are disabled. Manual review required.`,
              timestamp: new Date(),
            };
            post.claimedAt = null;
            post.claimedBy = null;
            post.executionLogs.push({
              step: 'manual_review_required',
              message: `Video (ID: ${post.publishDetails.externalPostId}) was rejected or removed by YouTube (${existingStatus.rejectionReason || 'duplicate'}). Re-upload blocked.`,
              level: 'error',
            });
            await post.save();
            return;
          }

          if (existingStatus.exists && !existingStatus.isRejected) {
            post.status = 'published';
            post.publishingStatus = 'published';
            post.publishedAt = post.publishedAt || new Date();
            post.claimedAt = null;
            post.claimedBy = null;
            post.executionLogs.push({
              step: 'idempotency_verified',
              message: `Video already published on YouTube (ID: ${existingStatus.id}, title: "${existingStatus.title}"). Duplicate upload prevented.`,
              level: 'info',
            });
            await post.save();
            return;
          }
        }

        // If externalPostId is present but not verifiable, block duplicate upload
        post.status = 'manual_review';
        post.publishingStatus = 'rejected';
        post.lastError = {
          code: 'PREVIOUS_UPLOAD_UNKNOWN',
          message: `Job already had external video ID (${post.publishDetails.externalPostId}). Prevented second upload. Manual review required.`,
          timestamp: new Date(),
        };
        post.claimedAt = null;
        post.claimedBy = null;
        post.executionLogs.push({
          step: 'duplicate_upload_blocked',
          message: `Attempted retry on job with existing video ID (${post.publishDetails.externalPostId}). Second upload blocked.`,
          level: 'warn',
        });
        await post.save();
        return;
      }

      // 7. Queue Pre-flight Verified
      post.publishingStatus = 'ready_for_dispatch';
      post.executionLogs.push({
        step: 'preflight_verified',
        message: `Queue pre-flight verified successfully for ${post.platform.toUpperCase()}. Ready for publishing dispatch.`,
        level: 'info',
      });
      await post.save();

      // 8. DISPATCH EXECUTION
      if (post.platform === 'youtube') {
        post.executionLogs.push({
          step: 'upload_started',
          message: `Initiating YouTube Data API upload via Drive video stream for channel "${account.accountName}"...`,
          level: 'info',
        });
        await post.save();

        // Obtain readable video stream from Google Drive
        const mediaStream = await googleDriveService.getFileStream(video.driveFileId);

        // Fallback description when caption is blank
        const cleanDescription = (post.caption || '').trim() || `${post.title}\n\n#Shorts #Reels #Viral`;

        // Upload video to YouTube Data API
        const uploadResult = await youtubeService.uploadVideo({
          account,
          mediaStream,
          title: post.title,
          description: cleanDescription,
          tags: post.hashtags,
          isShort: true,
        });

        if (!uploadResult || !uploadResult.externalPostId) {
          throw new Error('YouTube Data API did not return a valid video ID');
        }

        // STEP 4: Track the returned YouTube video ID durably BEFORE marking published
        post.publishDetails = {
          externalPostId: uploadResult.externalPostId,
          externalUrl: uploadResult.externalUrl,
          quotaUnitsUsed: uploadResult.quotaUnitsUsed || 1600,
          uploadStatus: 'uploaded',
          verifiedAt: new Date(),
        };
        await post.save();

        // 9. Mark published ONLY upon confirmed YouTube video ID
        post.status = 'published';
        post.publishingStatus = 'published';
        post.publishedAt = new Date();
        post.claimedAt = null;
        post.claimedBy = null;
        post.lastError = null;

        post.executionLogs.push({
          step: 'published',
          message: `Successfully uploaded to YouTube! Video ID: ${uploadResult.externalPostId} (${uploadResult.externalUrl})`,
          level: 'info',
        });
        await post.save();

        // Update referenced video record status & permanent published platforms history
        video.status = 'published';
        if (!video.publishedPlatforms) video.publishedPlatforms = [];
        video.publishedPlatforms.push({
          platform: 'youtube',
          accountId: account._id,
          accountName: account.accountName,
          externalPostId: uploadResult.externalPostId,
          publishedAt: new Date(),
        });
        await video.save();

        await WorkflowLog.create({
          level: 'success',
          module: 'scheduler',
          action: 'youtube_upload_published',
          message: `Post "${post.title}" published to YouTube channel "${account.accountName}" (${uploadResult.externalPostId})`,
          metadata: { postId: post._id, videoId: video._id, externalPostId: uploadResult.externalPostId },
        }).catch(() => {});

      } else if (post.platform === 'instagram') {
        post.executionLogs.push({
          step: 'upload_started',
          message: `Initiating Instagram Reel publish via Meta Graph API for account "${account.accountName}"...`,
          level: 'info',
        });
        await post.save();

        // Format caption with hashtags
        const tagsString = Array.isArray(post.hashtags) && post.hashtags.length > 0
          ? '\n\n' + post.hashtags.map((t) => (t.startsWith('#') ? t : `#${t}`)).join(' ')
          : '';
        const fullCaption = (post.caption || post.title || '').trim() + tagsString;

        // Prefer temporary Drive public URL so Meta does NOT pull video through Render (5GB saver).
        // Optional fallback to Render /stream if Drive URL is rejected by Meta.
        const preferDrivePublic = (config.meta?.videoSource || 'drive_public') !== 'render';
        const allowRenderFallback = config.meta?.allowRenderStreamFallback !== false;
        const publicBaseUrl = resolveBackendPublicUrl();
        const renderStreamUrl = `${publicBaseUrl}/api/videos/${video._id}/stream`;

        let publishResult = null;
        let usedSource = 'render_stream';
        let driveAccess = null;

        try {
          if (preferDrivePublic && video.driveFileId) {
            try {
              driveAccess = await googleDriveService.createTemporaryPublicVideoAccess(
                video.driveFileId,
                video.accountId || account._id
              );
              const urlsToTry = driveAccess.candidateUrls?.length
                ? driveAccess.candidateUrls
                : [driveAccess.videoUrl];

              let lastDriveErr = null;
              for (const candidateUrl of urlsToTry) {
                try {
                  console.log(`[Instagram Publish] Trying Drive public URL (no Render video egress): ${candidateUrl.slice(0, 80)}...`);
                  post.executionLogs.push({
                    step: 'instagram_video_source',
                    message: 'Using temporary Google Drive public URL for Meta (avoids Render bandwidth)',
                    level: 'info',
                  });
                  await post.save();

                  publishResult = await instagramService.publishReel({
                    account,
                    videoUrl: candidateUrl,
                    caption: fullCaption,
                  });
                  usedSource = 'drive_public';
                  lastDriveErr = null;
                  break;
                } catch (drivePublishErr) {
                  lastDriveErr = drivePublishErr;
                  console.warn(
                    `[Instagram Publish] Drive URL rejected/failed: ${drivePublishErr.message}`
                  );
                }
              }

              if (!publishResult && !allowRenderFallback && lastDriveErr) {
                throw lastDriveErr;
              }
            } catch (driveSetupErr) {
              console.warn(`[Instagram Publish] Drive public URL setup failed: ${driveSetupErr.message}`);
              if (!allowRenderFallback) throw driveSetupErr;
            }
          }

          if (!publishResult) {
            if (!allowRenderFallback && preferDrivePublic) {
              throw new Error(
                'Instagram publish requires a Drive public URL, but it failed and Render stream fallback is disabled'
              );
            }
            console.warn(
              `[Instagram Publish] Falling back to Render stream URL (COUNTS AGAINST 5GB BANDWIDTH): ${renderStreamUrl}`
            );
            post.executionLogs.push({
              step: 'instagram_video_source',
              message: 'Fallback: Meta pulling video via Render /stream (uses outbound bandwidth)',
              level: 'warn',
            });
            await post.save();

            publishResult = await instagramService.publishReel({
              account,
              videoUrl: renderStreamUrl,
              caption: fullCaption,
            });
            usedSource = 'render_stream';
          }
        } finally {
          if (driveAccess?.release) {
            await driveAccess.release().catch(() => {});
          }
        }

        console.log(`[Instagram Publish] Completed via source=${usedSource}`);

        if (!publishResult || !publishResult.externalPostId) {
          throw new Error('Instagram Graph API did not return a valid media ID');
        }

        post.publishDetails = {
          externalPostId: publishResult.externalPostId,
          externalUrl: publishResult.externalUrl,
          containerId: publishResult.containerId,
          uploadStatus: 'uploaded',
          verifiedAt: new Date(),
        };
        await post.save();

        post.status = 'published';
        post.publishingStatus = 'published';
        post.publishedAt = new Date();
        post.claimedAt = null;
        post.claimedBy = null;
        post.lastError = null;

        post.executionLogs.push({
          step: 'published',
          message: `Successfully published Instagram Reel! Media ID: ${publishResult.externalPostId} (${publishResult.externalUrl})`,
          level: 'info',
        });
        await post.save();

        // Update referenced video record status & permanent published platforms history
        video.status = 'published';
        if (!video.publishedPlatforms) video.publishedPlatforms = [];
        video.publishedPlatforms.push({
          platform: 'instagram',
          accountId: account._id,
          accountName: account.accountName,
          externalPostId: publishResult.externalPostId,
          publishedAt: new Date(),
        });
        await video.save();

        await WorkflowLog.create({
          level: 'success',
          module: 'scheduler',
          action: 'instagram_reel_published',
          message: `Post "${post.title}" published to Instagram account "${account.accountName}" (${publishResult.externalPostId})`,
          metadata: { postId: post._id, videoId: video._id, externalPostId: publishResult.externalPostId },
        }).catch(() => {});

        this.notifyN8n('post_published', post).catch(() => {});
      }
    } catch (err) {
      await this.handleQueueFailure(post, err);
    }
  }

  /**
   * Direct Dispatch for Admin Trigger ("Publish Now")
   * Publishes ONLY the given post id — never batches siblings / due queue.
   */
  async publishPostNow(postId) {
    if (!postId) {
      throw new AppError('Post id is required for Publish Now', 400);
    }

    const existing = await Post.findById(postId).select('status platform title').lean();
    if (!existing) throw new AppError('Post not found', 404);
    if (existing.status === 'published') throw new AppError('Post is already published', 400);
    if (existing.status === 'processing') {
      throw new AppError('Post is currently being processed by queue worker', 409);
    }

    if (!(await isPlatformPublishingEnabled(existing.platform))) {
      throw new AppError(
        `${existing.platform.toUpperCase()} publishing is STOPPED. Enable it under Automation → Platform Publishing Controls before publishing.`,
        403,
        { code: 'PLATFORM_PUBLISHING_DISABLED', platform: existing.platform }
      );
    }

    // Pause auto-scheduler for the duration of this single manual upload
    this.manualPublishDepth += 1;

    try {
      // Atomic claim of THIS id only (prevents scheduler race on the same row)
      const claimed = await Post.findOneAndUpdate(
        {
          _id: postId,
          status: { $nin: ['published', 'processing', 'cancelled'] },
        },
        {
          $set: {
            status: 'processing',
            claimedAt: new Date(),
            claimedBy: `manual_${this.workerId}`,
            scheduledAt: new Date(),
          },
          $push: {
            executionLogs: {
              timestamp: new Date(),
              step: 'manual_dispatch',
              message: `Direct Publish Now for this post only ("${existing.title || postId}") — auto queue paused for other posts`,
              level: 'info',
            },
          },
        },
        { new: true }
      )
        .populate('videoId')
        .populate('accountId');

      if (!claimed) {
        throw new AppError('Could not claim post for Publish Now (already published, processing, or cancelled)', 409);
      }

      if (String(claimed._id) !== String(postId)) {
        throw new AppError('Publish Now safety check failed: claimed post id mismatch', 500);
      }

      console.log(`[Scheduler] Publish Now — single post ${claimed._id} (${claimed.platform})`);
      await this.processClaimedPost(claimed);
      return Post.findById(postId).populate('videoId').populate('accountId');
    } finally {
      this.manualPublishDepth = Math.max(0, this.manualPublishDepth - 1);
    }
  }

  /**
   * Exponential backoff and retry handling with jitter
   * Classifies permanent vs retryable errors and enforces maxAttempts
   */
  async handleQueueFailure(post, err) {
    const isPermanent = Boolean(err.isPermanent);
    const isExhausted = isPermanent || post.attempts >= post.maxAttempts;
    const safeError = err.message.replace(/key=[a-zA-Z0-9_\-]+/gi, 'key=REDACTED');

    post.lastError = {
      message: safeError,
      code: err.code || (isPermanent ? 'PERMANENT_ERROR' : 'QUEUE_ERROR'),
      timestamp: new Date(),
    };

    const isPolicyOrDuplicate =
      err.code === 'POLICY_REMOVAL_DUPLICATE' ||
      /duplicate|removed|policy|copyright/i.test(safeError);

    if (isPolicyOrDuplicate) {
      post.status = 'manual_review';
      post.publishingStatus = 'rejected';
      post.nextRetryAt = null;
      post.executionLogs.push({
        step: 'policy_removal',
        message: `YouTube rejected or removed video: ${safeError}. Automatic retries are disabled. Manual review required.`,
        level: 'error',
      });
      post.claimedAt = null;
      post.claimedBy = null;
      await post.save();
      return;
    }

    if (isExhausted) {
      // Dead-letter / Final Failed state
      post.status = 'failed';
      post.publishingStatus = 'failed';
      post.nextRetryAt = null;
      post.executionLogs.push({
        step: isPermanent ? 'permanent_failure' : 'max_attempts_exhausted',
        message: isPermanent
          ? `Failed permanently: ${safeError}. User action required.`
          : `Failed after ${post.attempts}/${post.maxAttempts} attempts: ${safeError}`,
        level: 'error',
      });
    } else {
      // Exponential backoff with jitter: delay = min(300s, 2^attempts * 10s + jitter)
      const baseDelayMs = Math.pow(2, post.attempts) * 10000;
      const jitterMs = Math.floor(Math.random() * 4000);
      const delayMs = Math.min(300000, baseDelayMs + jitterMs);

      post.status = 'retrying';
      post.nextRetryAt = new Date(Date.now() + delayMs);
      post.executionLogs.push({
        step: 'retry_scheduled',
        message: `Transient error (Attempt ${post.attempts}/${post.maxAttempts}): ${safeError}. Retrying in ${Math.round(
          delayMs / 1000
        )}s`,
        level: 'warn',
      });
    }

    post.claimedAt = null;
    post.claimedBy = null;
    await post.save();

    await WorkflowLog.create({
      level: isExhausted ? 'error' : 'warn',
      module: 'scheduler',
      action: isExhausted ? 'queue_job_failed' : 'queue_job_retry',
      message: `Post "${post.title}" ${isExhausted ? 'failed permanently' : 'scheduled for retry'}: ${safeError}`,
      metadata: { postId: post._id, attempts: post.attempts, maxAttempts: post.maxAttempts, isPermanent },
    }).catch(() => {});
  }

  /**
   * Pause a scheduled or queued post
   */
  async pausePost(postId) {
    const post = await Post.findById(postId);
    if (!post) throw new Error('Post not found');

    if (!['scheduled', 'queued', 'retrying'].includes(post.status)) {
      throw new Error(`Cannot pause post with status '${post.status}'`);
    }

    post.status = 'paused';
    post.pauseReason = 'user';
    post.executionLogs.push({
      step: 'paused',
      message: 'Schedule paused by user',
      level: 'info',
    });
    await post.save();

    await WorkflowLog.create({
      level: 'info',
      module: 'scheduler',
      action: 'post_paused',
      message: `Post "${post.title}" paused`,
      metadata: { postId },
    }).catch(() => {});

    return post;
  }

  /**
   * Resume a paused post
   */
  async resumePost(postId) {
    const post = await Post.findById(postId);
    if (!post) throw new Error('Post not found');

    if (post.status !== 'paused') {
      throw new Error(`Cannot resume post that is not paused (current status: '${post.status}')`);
    }

    if (
      post.pauseReason === PLATFORM_DISABLED_PAUSE_REASON &&
      !(await isPlatformPublishingEnabled(post.platform))
    ) {
      throw new AppError(
        `Cannot resume: ${post.platform.toUpperCase()} publishing is STOPPED. Re-enable the platform first.`,
        403,
        { code: 'PLATFORM_PUBLISHING_DISABLED', platform: post.platform }
      );
    }

    post.status = 'scheduled';
    post.set('pauseReason', undefined);
    post.executionLogs.push({
      step: 'resumed',
      message: 'Schedule resumed by user',
      level: 'info',
    });
    await post.save();

    await WorkflowLog.create({
      level: 'info',
      module: 'scheduler',
      action: 'post_resumed',
      message: `Post "${post.title}" resumed`,
      metadata: { postId },
    }).catch(() => {});

    return post;
  }

  /**
   * Cancel a scheduled post
   */
  async cancelPost(postId, reason = 'Cancelled by user') {
    const post = await Post.findById(postId);
    if (!post) throw new Error('Post not found');

    if (post.status === 'published') {
      throw new Error('Cannot cancel a post that has already been published');
    }

    post.status = 'cancelled';
    post.cancelledAt = new Date();
    post.cancellationReason = reason;
    post.executionLogs.push({
      step: 'cancelled',
      message: `Post cancelled: ${reason}`,
      level: 'warn',
    });
    await post.save();

    await WorkflowLog.create({
      level: 'info',
      module: 'scheduler',
      action: 'post_cancelled',
      message: `Post "${post.title}" cancelled (${reason})`,
      metadata: { postId, reason },
    }).catch(() => {});

    this.notifyN8n('post_cancelled', post).catch(() => {});
    return post;
  }

  /**
   * Reschedule an existing post to a new timestamp and timezone
   */
  async reschedulePost(postId, newScheduledAt, newTimezone) {
    const post = await Post.findById(postId);
    if (!post) throw new Error('Post not found');

    if (post.status === 'published') {
      throw new Error('Cannot reschedule an already published post');
    }

    const targetDate = new Date(newScheduledAt);
    if (isNaN(targetDate.getTime())) {
      throw new Error('Invalid new scheduled timestamp');
    }

    if (targetDate.getTime() < Date.now() - 120000) {
      throw new Error('Cannot reschedule a post into the past');
    }

    post.scheduledAt = targetDate;
    if (newTimezone) post.timezone = newTimezone;
    post.status = 'scheduled';
    post.attempts = 0;
    post.nextRetryAt = null;
    post.lastError = null;

    post.executionLogs.push({
      step: 'rescheduled',
      message: `Rescheduled to ${targetDate.toISOString()} (${post.timezone})`,
      level: 'info',
    });
    await post.save();

    await WorkflowLog.create({
      level: 'info',
      module: 'scheduler',
      action: 'post_rescheduled',
      message: `Post "${post.title}" rescheduled to ${targetDate.toISOString()}`,
      metadata: { postId, newScheduledAt: targetDate, timezone: post.timezone },
    }).catch(() => {});

    return post;
  }

  /**
   * Manual Retry of failed/cancelled post
   */
  async retryPost(postId, { scheduledAt = null } = {}) {
    const post = await Post.findById(postId).populate('accountId', 'accountName status platform');
    if (!post) throw new Error('Post not found');

    if (post.status === 'manual_review') {
      throw new Error(
        'This post is under manual review due to a YouTube duplicate/policy removal. Automatic re-upload is blocked. Please select another video or address the duplicate in YouTube Studio.'
      );
    }

    if (!['failed', 'cancelled', 'retrying'].includes(post.status)) {
      throw new Error(`Only failed or cancelled posts can be manually retried (status: '${post.status}')`);
    }

    const account = post.accountId;
    if (account && ['expired', 'disconnected', 'authorization_required'].includes(account.status)) {
      throw new Error(
        `Account "${account.accountName}" is ${account.status}. Reconnect the social account before retrying this post.`
      );
    }

    const platformEnabled = await isPlatformPublishingEnabled(post.platform);
    if (!platformEnabled) {
      throw new AppError(
        `${post.platform.toUpperCase()} publishing is STOPPED. Enable it under Platform Publishing Controls before retrying.`,
        403,
        { code: 'PLATFORM_PUBLISHING_DISABLED', platform: post.platform }
      );
    }

    const targetDate = scheduledAt ? new Date(scheduledAt) : new Date(Date.now() + 30_000);
    if (Number.isNaN(targetDate.getTime())) {
      throw new Error('Invalid scheduledAt for retry');
    }

    post.status = 'scheduled';
    post.set('pauseReason', undefined);
    post.publishingStatus = 'ready_for_dispatch';
    post.scheduledAt = targetDate;
    post.attempts = 0;
    post.nextRetryAt = null;
    post.set('lastError', undefined);
    post.claimedAt = null;
    post.claimedBy = null;
    post.executionLogs.push({
      step: 'manual_retry_reset',
      message: `Reset for retry by user — lined up at ${targetDate.toISOString()}`,
      level: 'info',
    });
    await post.save();

    await WorkflowLog.create({
      level: 'info',
      module: 'scheduler',
      action: 'post_retry_reset',
      message: `Post "${post.title}" reset for retry at ${targetDate.toISOString()}`,
      metadata: { postId, scheduledAt: targetDate },
    }).catch(() => {});

    return post;
  }

  /**
   * Detect the original publish interval (median gap) from timestamps.
   * Falls back to 120 minutes (same default as Video Library batch schedule).
   */
  detectScheduleIntervalMs(timestamps = [], fallbackMs = 120 * 60 * 1000) {
    const sorted = timestamps
      .map((t) => new Date(t).getTime())
      .filter((t) => Number.isFinite(t))
      .sort((a, b) => a - b);

    const gaps = [];
    for (let i = 1; i < sorted.length; i++) {
      const gap = sorted[i] - sorted[i - 1];
      // Ignore tiny/huge outliers (keep 5 min .. 7 days)
      if (gap >= 5 * 60 * 1000 && gap <= 7 * 24 * 60 * 60 * 1000) {
        gaps.push(gap);
      }
    }
    if (gaps.length === 0) return fallbackMs;
    gaps.sort((a, b) => a - b);
    return gaps[Math.floor(gaps.length / 2)];
  }

  /**
   * Line up failed posts using EACH ACCOUNT's original time interval.
   * - Start date = today (keeps original clock time when possible)
   * - End date extends automatically for the last video
   * - Skips expired/disconnected accounts
   */
  async relineFailedPosts({
    startAt = null,
    defaultIntervalMs = 120 * 60 * 1000,
  } = {}) {
    const failedPosts = await Post.find({ status: 'failed' })
      .populate('accountId', 'accountName platform status errorMessage settings')
      .sort({ scheduledAt: 1, createdAt: 1 });

    if (failedPosts.length === 0) {
      return {
        totalFailed: 0,
        linedUpCount: 0,
        blockedCount: 0,
        linedUp: [],
        blocked: [],
        window: null,
        intervals: [],
      };
    }

    const activePosts = await Post.find({
      status: { $in: ['scheduled', 'queued', 'retrying', 'processing', 'paused'] },
    })
      .select('accountId scheduledAt nextRetryAt status')
      .lean();

    const activeByAccount = new Map();
    for (const active of activePosts) {
      const accKey = String(active.accountId);
      const t =
        active.status === 'retrying' && active.nextRetryAt
          ? new Date(active.nextRetryAt)
          : active.scheduledAt
            ? new Date(active.scheduledAt)
            : null;
      if (!t || Number.isNaN(t.getTime())) continue;
      const list = activeByAccount.get(accKey) || [];
      list.push(t);
      activeByAccount.set(accKey, list);
    }

    const blocked = [];
    const eligibleByAccount = new Map();

    const [youtubeEnabled, instagramEnabled] = await Promise.all([
      isPlatformPublishingEnabled('youtube'),
      isPlatformPublishingEnabled('instagram'),
    ]);
    const platformEnabledMap = { youtube: youtubeEnabled, instagram: instagramEnabled };

    for (const post of failedPosts) {
      const account = post.accountId;
      const accountStatus = account?.status;
      const accountName = account?.accountName || 'Unknown account';

      if (!platformEnabledMap[post.platform]) {
        blocked.push({
          id: post._id,
          title: post.title,
          platform: post.platform,
          accountName,
          reason: `${String(post.platform).toUpperCase()} publishing is STOPPED. Re-enable Platform Publishing Controls first.`,
        });
        continue;
      }

      if (
        !account ||
        ['expired', 'disconnected', 'authorization_required', 'error'].includes(accountStatus)
      ) {
        blocked.push({
          id: post._id,
          title: post.title,
          platform: post.platform,
          accountName,
          reason: `Account is ${accountStatus || 'missing'}. Reconnect before lining up this post.`,
        });
        continue;
      }

      if (accountStatus && accountStatus !== 'connected') {
        blocked.push({
          id: post._id,
          title: post.title,
          platform: post.platform,
          accountName,
          reason: `Account status is "${accountStatus}". Fix the account first.`,
        });
        continue;
      }

      const accKey = String(account._id);
      const bucket = eligibleByAccount.get(accKey) || {
        account,
        accountName,
        posts: [],
      };
      bucket.posts.push(post);
      eligibleByAccount.set(accKey, bucket);
    }

    const linedUp = [];
    const intervals = [];
    let earliest = null;
    let latest = null;
    const nowMs = Date.now();
    const minStartMs = startAt ? new Date(startAt).getTime() : nowMs + 2 * 60 * 1000;

    for (const [accKey, bucket] of eligibleByAccount.entries()) {
      const posts = bucket.posts.sort(
        (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
      );

      const originalTimes = posts.map((p) => p.scheduledAt);
      const activeTimes = (activeByAccount.get(accKey) || []).map((d) => d.getTime());
      const intervalMs = this.detectScheduleIntervalMs(
        [...originalTimes, ...activeTimes],
        defaultIntervalMs
      );

      // Start today, keep original clock time from the first failed post
      const firstOriginal = new Date(posts[0].scheduledAt);
      let cursor = new Date();
      cursor.setHours(
        firstOriginal.getHours(),
        firstOriginal.getMinutes(),
        firstOriginal.getSeconds(),
        0
      );
      if (cursor.getTime() < minStartMs) {
        cursor = new Date(minStartMs);
      }

      // Continue after any still-active scheduled work for this account
      if (activeTimes.length > 0) {
        const lastActive = Math.max(...activeTimes);
        cursor = new Date(Math.max(cursor.getTime(), lastActive + intervalMs));
      }

      intervals.push({
        accountId: accKey,
        accountName: bucket.accountName,
        platform: bucket.account.platform,
        intervalMinutes: Math.round(intervalMs / 60000),
        count: posts.length,
        from: new Date(cursor),
        to: new Date(cursor.getTime() + (posts.length - 1) * intervalMs),
      });

      for (let i = 0; i < posts.length; i++) {
        const post = posts[i];
        const slot = new Date(cursor.getTime() + i * intervalMs);

        post.status = 'scheduled';
        post.publishingStatus = 'ready_for_dispatch';
        post.scheduledAt = slot;
        post.attempts = 0;
        post.nextRetryAt = null;
        post.set('lastError', undefined);
        post.claimedAt = null;
        post.claimedBy = null;
        post.executionLogs.push({
          step: 'failed_reline',
          message: `Rescheduled from today using original interval ${Math.round(intervalMs / 60000)}m → ${slot.toISOString()} (${post.timezone || 'UTC'})`,
          level: 'info',
        });
        await post.save();

        if (!earliest || slot < earliest) earliest = slot;
        if (!latest || slot > latest) latest = slot;

        linedUp.push({
          id: post._id,
          title: post.title,
          platform: post.platform,
          accountName: bucket.accountName,
          scheduledAt: slot,
          intervalMinutes: Math.round(intervalMs / 60000),
        });
      }
    }

    await WorkflowLog.create({
      level: 'info',
      module: 'scheduler',
      action: 'failed_posts_relined',
      message: `Lined up ${linedUp.length} failed post(s) from today using original intervals; blocked ${blocked.length}`,
      metadata: {
        linedUpCount: linedUp.length,
        blockedCount: blocked.length,
        windowStart: earliest,
        windowEnd: latest,
        intervals,
      },
    }).catch(() => {});

    return {
      totalFailed: failedPosts.length,
      linedUpCount: linedUp.length,
      blockedCount: blocked.length,
      linedUp,
      blocked,
      intervals,
      window:
        earliest && latest
          ? {
              from: earliest,
              to: latest,
            }
          : null,
    };
  }

  /**
   * Non-blocking n8n webhook notification
   * Keeps MongoDB as single source of truth and handles n8n offline gracefully
   */
  async notifyN8n(event, post) {
    try {
      if (!config.n8n.webhookUrl) return;

      const payload = {
        event,
        postId: post._id.toString(),
        idempotencyKey: post.idempotencyKey,
        platform: post.platform,
        title: post.title,
        scheduledAt: post.scheduledAt,
        status: post.status,
        publishingStatus: post.publishingStatus,
        timestamp: new Date().toISOString(),
      };

      await axios.post(config.n8n.webhookUrl, payload, {
        timeout: 3000,
        headers: {
          'Content-Type': 'application/json',
          'X-N8N-WEBHOOK-SECRET': config.n8n.webhookSecret,
          ...(config.n8n.apiKey && { 'X-N8N-API-KEY': config.n8n.apiKey }),
        },
      });
    } catch (err) {
      // n8n being offline does NOT fail core scheduling
      // Suppress connection errors gracefully
    }
  }
}

export const schedulerService = new SchedulerService();
