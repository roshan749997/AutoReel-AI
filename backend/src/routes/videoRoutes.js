import { Router } from 'express';
import { Video } from '../models/Video.js';
import { Post } from '../models/Post.js';
import { Account } from '../models/Account.js';
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
    const { folderId, accountId, resume = false, maxPages = 500, pageSize = 100, recursive = true } = req.body;
    const result = await googleDriveService.startSyncJob({
      folderId,
      accountId,
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
    const { folderId, accountId, resume = false, maxPages = 500, pageSize = 100, recursive = true } = req.body;
    const result = await googleDriveService.startSyncJob({
      folderId,
      accountId,
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

/**
 * Helper to query active connected Google Drive accounts and construct the drive filter
 */
async function getConnectedDriveQuery(accountId = null) {
  const connectedAccounts = await Account.find({
    platform: 'youtube',
    status: 'connected',
    isDemo: { $ne: true },
  });

  if (connectedAccounts.length === 0) {
    return { hasConnected: false, connectedAccounts: [] };
  }

  const connectedIds = connectedAccounts.map((a) => a._id);
  const connectedEmails = connectedAccounts.map((a) => a.googleEmail).filter(Boolean);

  let accountFilter;
  if (accountId && accountId !== 'all') {
    accountFilter = { accountId };
  } else {
    accountFilter = {
      $or: [
        { accountId: { $in: connectedIds } },
        ...(connectedEmails.length > 0 ? [{ googleEmail: { $in: connectedEmails } }] : []),
      ],
    };
  }

  return { hasConnected: true, connectedAccounts, accountFilter };
}

// 6. List videos with server-side pagination, search, sorting, and multi-filters (20k+ video library)
router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(Math.max(1, parseInt(req.query.limit || '12', 10)), 100);
    const skip = (page - 1) * limit;

    const driveInfo = await getConnectedDriveQuery(req.query.accountId);
    if (!driveInfo.hasConnected) {
      return res.json({
        status: 'success',
        data: [],
        pagination: {
          total: 0,
          page: 1,
          limit,
          totalPages: 1,
        },
      });
    }

    // Fetch video IDs currently active in the publishing queue
    const activeQueuedPostVideoIds = await Post.distinct('videoId', {
      status: { $in: ['scheduled', 'queued', 'processing', 'retrying'] },
    });

    // Self-heal: If any video is marked 'queued' but has NO active posts in queue, release it back to library
    await Video.updateMany(
      {
        status: 'queued',
        _id: { $nin: activeQueuedPostVideoIds },
      },
      {
        $set: { status: 'metadata_ready' },
      }
    );

    const andConditions = [{ isArchived: false }, driveInfo.accountFilter];

    // Status filter:
    if (req.query.status) {
      if (req.query.status === 'all') {
        // Include queued and published videos. Used by the per-channel board.
      } else if (req.query.status === 'queued') {
        // User explicitly asked for Queued videos
        andConditions.push({
          $or: [
            { status: 'queued' },
            ...(activeQueuedPostVideoIds.length > 0 ? [{ _id: { $in: activeQueuedPostVideoIds } }] : []),
          ],
        });
      } else if (req.query.status === 'published') {
        // User explicitly asked for Published videos
        andConditions.push({ status: 'published' });
      } else {
        andConditions.push({ status: req.query.status });
        andConditions.push({ status: { $nin: ['queued', 'published'] } });
        if (activeQueuedPostVideoIds.length > 0) {
          andConditions.push({ _id: { $nin: activeQueuedPostVideoIds } });
        }
      }
    } else {
      // Default Video Library view: DO NOT SHOW videos that are queued or published!
      andConditions.push({ status: { $nin: ['queued', 'published'] } });
      if (activeQueuedPostVideoIds.length > 0) {
        andConditions.push({ _id: { $nin: activeQueuedPostVideoIds } });
      }
    }

    // Indexing status filter
    if (req.query.indexingStatus) {
      andConditions.push({ indexingStatus: req.query.indexingStatus });
    }

    // Aspect ratio vertical filter (Shorts/Reels 9:16)
    if (req.query.isVertical !== undefined && req.query.isVertical !== '') {
      andConditions.push({ 'resolution.isVertical': req.query.isVertical === 'true' });
    }

    // AI Approval Status filter
    if (req.query.approvalStatus) {
      if (req.query.approvalStatus === 'approved') {
        andConditions.push({ 'aiMetadata.approvalStatus': 'approved' });
      } else if (req.query.approvalStatus === 'draft') {
        andConditions.push({
          'aiMetadata.approvalStatus': 'draft',
          'aiMetadata.generatedTitle': { $exists: true, $ne: '' },
        });
      } else if (req.query.approvalStatus === 'none') {
        andConditions.push({
          $or: [
            { 'aiMetadata.generatedTitle': { $exists: false } },
            { 'aiMetadata.generatedTitle': '' },
            { 'aiMetadata.generatedTitle': null },
          ],
        });
      }
    }

    // File size filter range (in bytes)
    if (req.query.minSize || req.query.maxSize) {
      const sizeCond = {};
      if (req.query.minSize) sizeCond.$gte = parseInt(req.query.minSize, 10);
      if (req.query.maxSize) sizeCond.$lte = parseInt(req.query.maxSize, 10);
      andConditions.push({ fileSize: sizeCond });
    }

    // Target folder filter
    if (req.query.folderId) {
      andConditions.push({
        $or: [{ folderId: req.query.folderId }, { folderPathIds: req.query.folderId }],
      });
    }

    // Search query (clean title, original filename, or notes)
    if (req.query.search && req.query.search.trim()) {
      const searchRegex = new RegExp(req.query.search.trim(), 'i');
      andConditions.push({
        $or: [{ originalName: searchRegex }, { cleanTitle: searchRegex }, { notes: searchRegex }],
      });
    }

    const query = andConditions.length > 1 ? { $and: andConditions } : andConditions[0];

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
      case 'duration_desc':
        sortOptions = { duration: -1 };
        break;
      case 'duration_asc':
        sortOptions = { duration: 1 };
        break;
      case 'approval_status':
        sortOptions = { 'aiMetadata.approvalStatus': -1, driveModifiedAt: -1 };
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

// 6b. Summary of distinct folders containing videos
router.get('/folders/summary', async (req, res, next) => {
  try {
    const driveInfo = await getConnectedDriveQuery(req.query.accountId);
    if (!driveInfo.hasConnected) {
      return res.json({ status: 'success', data: [] });
    }

    const matchConditions = [
      { isArchived: false, folderName: { $exists: true, $ne: '' } },
      driveInfo.accountFilter,
    ];

    const folders = await Video.aggregate([
      { $match: { $and: matchConditions } },
      {
        $group: {
          _id: '$folderId',
          folderName: { $first: '$folderName' },
          folderPathIds: { $first: '$folderPathIds' },
          folderPathNames: { $first: '$folderPathNames' },
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
    ]);
    res.json({ status: 'success', data: folders });
  } catch (err) {
    next(err);
  }
});

// 6b2. Live Drive folder tree, including subfolders that have no videos yet
router.get('/folders/tree', async (req, res, next) => {
  try {
    const tree = await googleDriveService.listFolderTree();
    res.json({ status: 'success', data: tree });
  } catch (err) {
    next(err);
  }
});

// 6c. Summary statistics for library quick filtering
router.get('/stats', async (req, res, next) => {
  try {
    const driveInfo = await getConnectedDriveQuery(req.query.accountId);
    if (!driveInfo.hasConnected) {
      return res.json({
        status: 'success',
        data: {
          total: 0,
          approved: 0,
          draft: 0,
          needsAi: 0,
          vertical: 0,
          queued: 0,
          published: 0,
        },
      });
    }

    const activeQueuedPostVideoIds = await Post.distinct('videoId', {
      status: { $in: ['scheduled', 'queued', 'processing', 'retrying'] },
    });

    const notQueuedFilter = {
      status: { $nin: ['queued', 'published'] },
      ...(activeQueuedPostVideoIds.length > 0 ? { _id: { $nin: activeQueuedPostVideoIds } } : {}),
    };

    const queuedFilter = {
      $or: [
        { status: 'queued' },
        ...(activeQueuedPostVideoIds.length > 0 ? [{ _id: { $in: activeQueuedPostVideoIds } }] : []),
      ],
    };

    const baseFilter = { $and: [{ isArchived: false }, driveInfo.accountFilter, notQueuedFilter] };

    const [total, approved, draft, vertical, queued, published] = await Promise.all([
      Video.countDocuments(baseFilter),
      Video.countDocuments({
        $and: [{ isArchived: false }, driveInfo.accountFilter, notQueuedFilter, { 'aiMetadata.approvalStatus': 'approved' }],
      }),
      Video.countDocuments({
        $and: [
          { isArchived: false },
          driveInfo.accountFilter,
          notQueuedFilter,
          {
            'aiMetadata.approvalStatus': 'draft',
            'aiMetadata.generatedTitle': { $exists: true, $ne: '' },
          },
        ],
      }),
      Video.countDocuments({
        $and: [{ isArchived: false }, driveInfo.accountFilter, notQueuedFilter, { 'resolution.isVertical': true }],
      }),
      Video.countDocuments({
        $and: [{ isArchived: false }, driveInfo.accountFilter, queuedFilter],
      }),
      Video.countDocuments({
        $and: [{ isArchived: false }, driveInfo.accountFilter, { status: 'published' }],
      }),
    ]);

    const needsAi = Math.max(0, total - (approved + draft));

    res.json({
      status: 'success',
      data: {
        total,
        approved,
        draft,
        needsAi,
        vertical,
        queued,
        published,
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

// 8b. Stream video thumbnail proxy (solves Google Drive private/referrer blocked thumbnails)
router.get('/:id/thumbnail', async (req, res, next) => {
  try {
    const video = await Video.findById(req.params.id);
    if (!video || !video.driveFileId) {
      return res.status(404).send('Not found');
    }

    const { stream, contentType } = await googleDriveService.getThumbnailStream(
      video.driveFileId,
      video.accountId
    );
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    stream.pipe(res);
  } catch (err) {
    res.status(404).send('Thumbnail unavailable');
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
