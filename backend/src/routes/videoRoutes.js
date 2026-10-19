import { Router } from 'express';
import { Video } from '../models/Video.js';
import { SyncJob } from '../models/SyncJob.js';
import { googleDriveService } from '../services/googleDriveService.js';
import { requireAdminAuth } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { config } from '../config/env.js';

const router = Router();

// 1. Google Drive connection and storage status
router.get('/drive/status', async (req, res, next) => {
  try {
    const status = await googleDriveService.testConnection();
    res.json({
      status: 'success',
      data: {
        ...status,
        defaultFolderId: config.google.driveFolderId || '',
      },
    });
  } catch (err) {
    next(err);
  }
});

// 2. Validate folder access and permissions
router.post('/drive/validate-folder', async (req, res, next) => {
  try {
    const { folderId } = req.body;
    const result = await googleDriveService.validateFolder(folderId);
    if (!result.valid) {
      return res.status(result.statusCode || 400).json({
        status: 'fail',
        message: result.error,
        data: result,
      });
    }

    res.json({ status: 'success', data: result });
  } catch (err) {
    next(new AppError(`Folder validation failed: ${err.message}`, 400));
  }
});

// 3. Start or resume background sync job
router.post('/sync/start', requireAdminAuth, async (req, res, next) => {
  try {
    const { folderId, resume = false, maxPages = 500, pageSize = 100, recursive = true } = req.body;
    const result = await googleDriveService.startSyncJob({
      folderId,
      resume,
      maxPages,
      pageSize,
      recursive,
    });
    res.json({ status: 'success', data: result });
  } catch (err) {
    next(new AppError(`Failed to start indexing: ${err.message}`, 400));
  }
});

// Legacy alias for /sync/start
router.post('/sync', requireAdminAuth, async (req, res, next) => {
  try {
    const { folderId, resume = false, maxPages = 500, pageSize = 100, recursive = true } = req.body;
    const result = await googleDriveService.startSyncJob({
      folderId,
      resume,
      maxPages,
      pageSize,
      recursive,
    });
    res.json({ status: 'success', data: result });
  } catch (err) {
    next(new AppError(`Drive sync failed: ${err.message}`, 500));
  }
});

// 4. Check sync progress metrics
router.get('/sync/progress', async (req, res, next) => {
  try {
    const { jobId } = req.query;
    const progress = await googleDriveService.getSyncProgress(jobId);
    res.json({ status: 'success', data: progress });
  } catch (err) {
    next(err);
  }
});

// 5. Cancel running sync job
router.post('/sync/cancel', requireAdminAuth, async (req, res, next) => {
  try {
    const { jobId } = req.body;
    if (!jobId) {
      // Find latest running job
      const activeJob = await SyncJob.findOne({ status: 'running' });
      if (!activeJob) {
        return res.json({ status: 'success', message: 'No indexing job is currently active.' });
      }
      const result = await googleDriveService.cancelSyncJob(activeJob.jobId);
      return res.json({ status: 'success', data: result });
    }

    const result = await googleDriveService.cancelSyncJob(jobId);
    res.json({ status: 'success', data: result });
  } catch (err) {
    next(err);
  }
});

// 6. List videos with server-side pagination, search, sorting, and multi-filters (20k+ video library)
router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(Math.max(1, parseInt(req.query.limit || '12', 10)), 100);
    const skip = (page - 1) * limit;

    const query = { isArchived: false };

    // Status filter
    if (req.query.status) {
      query.status = req.query.status;
    }

    // Indexing status filter
    if (req.query.indexingStatus) {
      query.indexingStatus = req.query.indexingStatus;
    }

    // Aspect ratio vertical filter (Shorts/Reels 9:16)
    if (req.query.isVertical !== undefined && req.query.isVertical !== '') {
      query['resolution.isVertical'] = req.query.isVertical === 'true';
    }

    // File size filter range (in bytes)
    if (req.query.minSize || req.query.maxSize) {
      query.fileSize = {};
      if (req.query.minSize) query.fileSize.$gte = parseInt(req.query.minSize, 10);
      if (req.query.maxSize) query.fileSize.$lte = parseInt(req.query.maxSize, 10);
    }

    // Target folder filter
    if (req.query.folderId) {
      query.folderId = req.query.folderId;
    }

    // Search query (clean title, original filename, or notes)
    if (req.query.search && req.query.search.trim()) {
      const searchRegex = new RegExp(req.query.search.trim(), 'i');
      query.$or = [{ originalName: searchRegex }, { cleanTitle: searchRegex }, { notes: searchRegex }];
    }

    // Sorting
    let sortOptions = { driveModifiedAt: -1 };
    switch (req.query.sort) {
      case 'modified_asc':
        sortOptions = { driveModifiedAt: 1 };
        break;
      case 'created_desc':
        sortOptions = { driveCreatedAt: -1 };
        break;
      case 'created_asc':
        sortOptions = { driveCreatedAt: 1 };
        break;
      case 'name_asc':
        sortOptions = { cleanTitle: 1, originalName: 1 };
        break;
      case 'name_desc':
        sortOptions = { cleanTitle: -1, originalName: -1 };
        break;
      case 'size_desc':
        sortOptions = { fileSize: -1 };
        break;
      case 'size_asc':
        sortOptions = { fileSize: 1 };
        break;
      default:
        sortOptions = { driveModifiedAt: -1 };
    }

    const [videos, total] = await Promise.all([
      Video.find(query).sort(sortOptions).skip(skip).limit(limit),
      Video.countDocuments(query),
    ]);

    res.json({
      status: 'success',
      data: videos,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (err) {
    next(err);
  }
});

// 7. Retry a failed indexing item
router.post('/:id/retry', requireAdminAuth, async (req, res, next) => {
  try {
    const video = await Video.findById(req.params.id);
    if (!video) {
      return next(new AppError('Video not found', 404));
    }

    video.indexingStatus = 'indexed';
    video.indexingError = null;
    await video.save();

    res.json({ status: 'success', message: 'Item marked for re-indexing', data: video });
  } catch (err) {
    next(err);
  }
});

// 8. Get video by ID
router.get('/:id', async (req, res, next) => {
  try {
    const video = await Video.findById(req.params.id);
    if (!video) {
      return next(new AppError('Video not found', 404));
    }
    res.json({ status: 'success', data: video });
  } catch (err) {
    next(err);
  }
});

// 9. Update video metadata
router.patch('/:id', async (req, res, next) => {
  try {
    const allowedUpdates = ['cleanTitle', 'tags', 'notes', 'status', 'isArchived', 'aiMetadata'];
    const updateDoc = {};

    for (const key of allowedUpdates) {
      if (req.body[key] !== undefined) {
        updateDoc[key] = req.body[key];
      }
    }

    const video = await Video.findByIdAndUpdate(req.params.id, { $set: updateDoc }, { new: true });
    if (!video) {
      return next(new AppError('Video not found', 404));
    }

    res.json({ status: 'success', data: video });
  } catch (err) {
    next(err);
  }
});

// 10. Stream video file directly (Used by Meta Reels container publishing & preview)
router.get('/:id/stream', async (req, res, next) => {
  try {
    const video = await Video.findById(req.params.id);
    if (!video) {
      return next(new AppError('Video not found', 404));
    }

    if (!video.driveFileId) {
      return next(new AppError('Video has no linked Google Drive file ID', 400));
    }

    const mediaStream = await googleDriveService.getFileStream(video.driveFileId);

    res.setHeader('Content-Type', video.mimeType || 'video/mp4');
    if (video.fileSize) {
      res.setHeader('Content-Length', video.fileSize);
    }
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=3600');

    mediaStream.pipe(res);
  } catch (err) {
    next(err);
  }
});

export default router;
