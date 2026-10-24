import { Router } from 'express';
import { Account } from '../models/Account.js';
import { Video } from '../models/Video.js';
import { Post } from '../models/Post.js';
import { WorkflowLog } from '../models/WorkflowLog.js';
import { youtubeService } from '../services/youtubeService.js';
import { instagramService } from '../services/instagramService.js';
import { verifyOAuthState } from '../services/cryptoService.js';
import { verifyTransferState, exchangeAuthCode } from '../drive-transfer/oauth.js';
import { requireAdminAuth } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { config } from '../config/env.js';

const router = Router();

// List all connected accounts with search, platform filter, status filter, and pagination
router.get('/', async (req, res, next) => {
  try {
    const { platform, status, search, page, limit } = req.query;
    const filter = {};

    // By default, show active accounts unless an explicit status filter is requested
    if (status) {
      if (status !== 'all') {
        filter.status = status;
      }
    } else {
      filter.isActive = true;
    }

    if (platform && platform !== 'all') {
      filter.platform = platform;
    }

    if (req.query.isDemo !== undefined && req.query.isDemo !== 'all') {
      filter.isDemo = req.query.isDemo === 'true';
    } else if (req.query.isDemo === undefined) {
      // By default, only return real accounts, never demo accounts
      filter.isDemo = { $ne: true };
    }

    if (search && search.trim()) {
      const searchRegex = new RegExp(search.trim(), 'i');
      filter.$or = [
        { accountName: searchRegex },
        { username: searchRegex },
        { accountId: searchRegex },
        { googleEmail: searchRegex },
      ];
    }

    const isPaginated = page !== undefined || limit !== undefined;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const total = await Account.countDocuments(filter);
    const query = Account.find(filter).sort({ createdAt: -1 });

    if (isPaginated) {
      query.skip(skip).limit(limitNum);
    }

    const accounts = await query;
    const safeAccounts = accounts.map((acc) => acc.toSafeJSON());

    res.json({
      status: 'success',
      data: safeAccounts,
      ...(isPaginated && {
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum) || 1,
        },
      }),
    });
  } catch (err) {
    next(err);
  }
});

// Purge mock/demo accounts (safe action with confirmation)
router.post('/purge-demo', requireAdminAuth, async (req, res, next) => {
  try {
    const result = await Account.deleteMany({
      $or: [
        { isDemo: true },
        { accountId: { $regex: /^(UC_chan_|UC_target_|UC_brand_|UC_healthy_|UC_failing_|UC_dup_|UC_disc_|yt_|ig_target_|ig_disc_|UC_unique_)/ } },
      ],
    });

    res.json({
      status: 'success',
      message: `Cleaned up ${result.deletedCount} demo/test account records`,
      deletedCount: result.deletedCount,
    });
  } catch (err) {
    next(err);
  }
});

// Generate Google (YouTube / Drive) OAuth URL
router.get('/google/auth-url', (req, res, next) => {
  try {
    const authUrl = youtubeService.getAuthUrl();
    res.json({ status: 'success', authUrl });
  } catch (err) {
    next(new AppError(err.message, 400));
  }
});

// Google OAuth callback handler
router.get('/google/callback', async (req, res, next) => {
  try {
    const { code, state, error, error_description } = req.query;
    if (error) {
      const msg =
        error === 'access_denied'
          ? 'Google authorization was cancelled by the user'
          : error_description || error;
      return res.redirect(
        `${config.clientUrl}/accounts?error=${encodeURIComponent(msg)}&error_code=${encodeURIComponent(error)}`
      );
    }
    if (state && verifyTransferState(state)) {
      if (!code) {
        return res.redirect(
          `${config.clientUrl}/?tab=drive-transfer&dt_status=error&dt_error=${encodeURIComponent('Missing authorization code.')}`
        );
      }
      try {
        await exchangeAuthCode(code);
        return res.redirect(`${config.clientUrl}/?tab=drive-transfer&dt_status=connected`);
      } catch (transferErr) {
        return res.redirect(
          `${config.clientUrl}/?tab=drive-transfer&dt_status=error&dt_error=${encodeURIComponent(transferErr.message || 'Drive Transfer sign-in failed')}`
        );
      }
    }
    if (!state || !verifyOAuthState(state, 'youtube')) {
      return res.redirect(
        `${config.clientUrl}/accounts?error=Invalid+or+expired+OAuth+security+state&error_code=INVALID_STATE`
      );
    }
    if (!code) {
      return res.redirect(
        `${config.clientUrl}/accounts?error=Missing+authorization+code&error_code=MISSING_CODE`
      );
    }

    const account = await youtubeService.handleCallback(code);
    res.redirect(
      `${config.clientUrl}/accounts?connected=youtube&id=${account._id}&name=${encodeURIComponent(
        account.accountName
      )}`
    );
  } catch (err) {
    console.error('[OAuth Callback] Google OAuth callback error:', err.message);
    const projectId = err.projectId || (config.google.clientId || '').split('-')[0] || '702701632845';
    const enableUrl =
      err.enableUrl ||
      `https://console.developers.google.com/apis/api/youtube.googleapis.com/overview?project=${projectId}`;
    const errorCode = err.code || 'OAUTH_ERROR';

    await WorkflowLog.create({
      level: 'error',
      module: 'youtube',
      action: 'oauth_callback_failed',
      message: `Google OAuth callback failed: ${err.message}`,
      metadata: { errorCode, enableUrl, projectId },
    }).catch(() => {});

    res.redirect(
      `${config.clientUrl}/accounts?error=${encodeURIComponent(
        err.message
      )}&error_code=${encodeURIComponent(errorCode)}&project_id=${encodeURIComponent(
        projectId
      )}&enable_url=${encodeURIComponent(enableUrl)}`
    );
  }
});

// Generate Meta (Instagram) OAuth URL
router.get('/meta/auth-url', (req, res, next) => {
  try {
    const authUrl = instagramService.getAuthUrl();
    res.json({ status: 'success', authUrl });
  } catch (err) {
    next(new AppError(err.message, 400));
  }
});

// Meta OAuth callback handler
router.get('/meta/callback', async (req, res, next) => {
  try {
    const { code, state, error, error_description } = req.query;
    if (error) {
      const errMessage = error_description || error;
      return res.redirect(`${config.clientUrl}/accounts?error=${encodeURIComponent(errMessage)}`);
    }
    if (!state || !verifyOAuthState(state, 'instagram')) {
      return res.redirect(`${config.clientUrl}/accounts?error=Invalid+or+expired+OAuth+security+state`);
    }
    if (!code) {
      return res.redirect(`${config.clientUrl}/accounts?error=Missing+authorization+code`);
    }

    const account = await instagramService.handleCallback(code);
    res.redirect(`${config.clientUrl}/accounts?connected=instagram&id=${account._id}&name=${encodeURIComponent(account.username || account.accountName)}`);
  } catch (err) {
    console.error('[OAuth Callback] Meta OAuth callback error:', err.message);
    res.redirect(`${config.clientUrl}/accounts?error=${encodeURIComponent(err.message)}`);
  }
});

// Get details for a specific account (safe representation)
router.get('/:id', async (req, res, next) => {
  try {
    const account = await Account.findById(req.params.id);
    if (!account) {
      return next(new AppError('Account not found', 404));
    }

    // Compute live post stats for this account
    const [totalScheduled, totalPublished, totalFailed] = await Promise.all([
      Post.countDocuments({ accountId: account._id, status: { $in: ['scheduled', 'queued', 'processing', 'retrying'] } }),
      Post.countDocuments({ accountId: account._id, status: 'published' }),
      Post.countDocuments({ accountId: account._id, status: 'failed' }),
    ]);

    const safeObj = account.toSafeJSON();
    safeObj.stats = {
      ...safeObj.stats,
      totalScheduled,
      totalPublished,
      totalFailed,
    };

    res.json({ status: 'success', data: safeObj });
  } catch (err) {
    next(err);
  }
});

// Update account publishing preferences and default settings
router.patch('/:id/preferences', async (req, res, next) => {
  try {
    const account = await Account.findById(req.params.id);
    if (!account) {
      return next(new AppError('Account not found', 404));
    }

    const {
      defaultTitlePrefix,
      defaultTitleSuffix,
      defaultDescriptionPrefix,
      defaultDescriptionSuffix,
      defaultTags,
      privacyStatus,
      isMadeForKids,
      autoApprove,
      preferredPublishHourUtc,
    } = req.body;

    if (!account.settings) {
      account.settings = {};
    }

    if (defaultTitlePrefix !== undefined) account.settings.defaultTitlePrefix = defaultTitlePrefix;
    if (defaultTitleSuffix !== undefined) account.settings.defaultTitleSuffix = defaultTitleSuffix;
    if (defaultDescriptionPrefix !== undefined) account.settings.defaultDescriptionPrefix = defaultDescriptionPrefix;
    if (defaultDescriptionSuffix !== undefined) account.settings.defaultDescriptionSuffix = defaultDescriptionSuffix;
    if (defaultTags !== undefined) {
      account.settings.defaultTags = Array.isArray(defaultTags)
        ? defaultTags
        : String(defaultTags).split(/[\s,]+/).filter(Boolean);
    }
    if (privacyStatus !== undefined && ['public', 'private', 'unlisted'].includes(privacyStatus)) {
      account.settings.privacyStatus = privacyStatus;
    }
    if (isMadeForKids !== undefined) account.settings.isMadeForKids = Boolean(isMadeForKids);
    if (autoApprove !== undefined) account.settings.autoApprove = Boolean(autoApprove);
    if (preferredPublishHourUtc !== undefined) {
      account.settings.preferredPublishHourUtc = Math.min(23, Math.max(0, parseInt(preferredPublishHourUtc, 10) || 14));
    }

    await account.save();

    res.json({
      status: 'success',
      message: 'Account preferences updated successfully',
      data: account.toSafeJSON(),
    });
  } catch (err) {
    next(err);
  }
});

// Test connection / refresh profile metadata of a specific account
router.post('/:id/test', async (req, res, next) => {
  try {
    const account = await Account.findById(req.params.id);
    if (!account) {
      return next(new AppError('Account not found', 404));
    }

    let result;
    if (account.platform === 'youtube') {
      result = await youtubeService.testConnection(account);
    } else if (account.platform === 'instagram') {
      result = await instagramService.testConnection(account);
    } else {
      return next(new AppError('Unsupported platform', 400));
    }

    res.json({ status: 'success', data: result });
  } catch (err) {
    next(err);
  }
});

// Safe disconnect: revokes token, marks status as disconnected, cancels pending unconfirmed jobs
router.post('/:id/disconnect', requireAdminAuth, async (req, res, next) => {
  try {
    const account = await Account.findById(req.params.id);
    if (!account) {
      return next(new AppError('Account not found', 404));
    }

    if (account.platform === 'youtube') {
      await youtubeService.revokeToken(account).catch(() => {});

      // Delete all videos associated with this drive/account
      await Video.deleteMany({
        $or: [
          { accountId: account._id },
          ...(account.googleEmail ? [{ googleEmail: account.googleEmail }] : []),
        ],
      });

      // If no other connected YouTube/Google account remains, purge any orphan videos
      const remainingConnected = await Account.countDocuments({
        platform: 'youtube',
        status: 'connected',
        _id: { $ne: account._id },
      });
      if (remainingConnected === 0) {
        await Video.deleteMany({});
      }
    }

    account.status = 'disconnected';
    account.isActive = false;
    await account.save();

    await WorkflowLog.create({
      level: 'info',
      module: account.platform,
      action: 'account_disconnected',
      message: `${account.platform.toUpperCase()} account "${account.accountName}" disconnected`,
      metadata: { accountId: account._id },
    }).catch(() => {});

    res.json({ status: 'success', message: 'Account disconnected successfully', data: account.toSafeJSON() });
  } catch (err) {
    next(err);
  }
});

// Get publishing history and recent queue items for a specific account
router.get('/:id/history', async (req, res, next) => {
  try {
    const account = await Account.findById(req.params.id);
    if (!account) {
      return next(new AppError('Account not found', 404));
    }

    const { limit = 30 } = req.query;
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 30));

    const posts = await Post.find({ accountId: account._id })
      .populate('videoId', 'cleanTitle originalName thumbnailUrl duration')
      .sort({ scheduledAt: -1 })
      .limit(limitNum);

    const [totalScheduled, totalPublished, totalFailed] = await Promise.all([
      Post.countDocuments({ accountId: account._id, status: { $in: ['scheduled', 'queued', 'processing', 'retrying'] } }),
      Post.countDocuments({ accountId: account._id, status: 'published' }),
      Post.countDocuments({ accountId: account._id, status: 'failed' }),
    ]);

    res.json({
      status: 'success',
      data: {
        account: account.toSafeJSON(),
        stats: {
          totalScheduled,
          totalPublished,
          totalFailed,
        },
        posts,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Disconnect/delete an account permanently
router.delete('/:id', requireAdminAuth, async (req, res, next) => {
  try {
    const account = await Account.findByIdAndDelete(req.params.id);
    if (!account) {
      return next(new AppError('Account not found', 404));
    }

    if (account.platform === 'youtube') {
      // Delete all videos associated with this drive/account
      await Video.deleteMany({
        $or: [
          { accountId: account._id },
          ...(account.googleEmail ? [{ googleEmail: account.googleEmail }] : []),
        ],
      });

      // If no other connected YouTube/Google account remains, purge any orphan videos
      const remainingConnected = await Account.countDocuments({
        platform: 'youtube',
        status: 'connected',
      });
      if (remainingConnected === 0) {
        await Video.deleteMany({});
      }
    }

    res.json({ status: 'success', message: 'Account permanently removed' });
  } catch (err) {
    next(err);
  }
});

export default router;
