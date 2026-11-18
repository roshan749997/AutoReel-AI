import { Router } from 'express';
import { requireAdminAuth } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import {
  getPlatformPublishingSettings,
  setPlatformPublishingEnabled,
  PLATFORM_PUBLISHING_PLATFORMS,
} from '../services/platformPublishingService.js';

const router = Router();

/**
 * GET /api/settings/platform-publishing
 * Public read of persisted platform publishing toggles (no secrets).
 */
router.get('/platform-publishing', async (req, res, next) => {
  try {
    const platforms = await getPlatformPublishingSettings();
    res.json({
      status: 'success',
      data: { platforms },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/settings/platform-publishing/:platform
 * Admin-only toggle. Body: { publishingEnabled: boolean, updatedBy?: string }
 */
router.patch('/platform-publishing/:platform', requireAdminAuth, async (req, res, next) => {
  try {
    const platform = String(req.params.platform || '')
      .trim()
      .toLowerCase();

    if (!PLATFORM_PUBLISHING_PLATFORMS.includes(platform)) {
      return next(
        new AppError(`Invalid platform "${req.params.platform}". Allowed: ${PLATFORM_PUBLISHING_PLATFORMS.join(', ')}`, 400)
      );
    }

    if (typeof req.body?.publishingEnabled !== 'boolean') {
      return next(new AppError('Body must include publishingEnabled as a boolean', 400));
    }

    const updatedBy =
      (typeof req.body.updatedBy === 'string' && req.body.updatedBy.trim()) ||
      req.headers['x-admin-id'] ||
      'admin';

    const result = await setPlatformPublishingEnabled(platform, req.body.publishingEnabled, updatedBy);

    res.json({
      status: 'success',
      message: result.changed
        ? `${platform} publishing is now ${result.setting.publishingEnabled ? 'ACTIVE' : 'STOPPED'}`
        : `${platform} publishing was already ${result.setting.publishingEnabled ? 'ACTIVE' : 'STOPPED'}`,
      data: result,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
