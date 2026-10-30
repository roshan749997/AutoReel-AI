import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { aiService, extractCleanTopic } from '../services/aiService.js';
import { Video } from '../models/Video.js';
import { Post } from '../models/Post.js';
import { AppError } from '../middleware/errorHandler.js';
import { config } from '../config/env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

// 1. Get AI provider diagnostic status
router.get('/status', async (req, res, next) => {
  try {
    const status = await aiService.testConnection();
    res.json({ status: 'success', data: status });
  } catch (err) {
    next(err);
  }
});

// Configure AI provider & API Key
router.post('/configure', async (req, res, next) => {
  try {
    const { geminiApiKey, geminiModel, provider = 'gemini' } = req.body;

    if (geminiApiKey !== undefined) {
      const cleanKey = String(geminiApiKey || '').trim();
      config.ai.geminiApiKey = cleanKey;
      config.ai.provider = cleanKey ? 'gemini' : 'manual';

      // Persist to .env
      try {
        const envPath = path.resolve(__dirname, '../../.env');
        if (fs.existsSync(envPath)) {
          let envContent = fs.readFileSync(envPath, 'utf8');
          if (envContent.includes('GEMINI_API_KEY=')) {
            envContent = envContent.replace(/GEMINI_API_KEY=.*/, `GEMINI_API_KEY=${cleanKey}`);
          } else {
            envContent += `\nGEMINI_API_KEY=${cleanKey}\n`;
          }
          if (cleanKey && envContent.includes('AI_PROVIDER=')) {
            envContent = envContent.replace(/AI_PROVIDER=.*/, `AI_PROVIDER=gemini`);
          }
          fs.writeFileSync(envPath, envContent, 'utf8');
        }
      } catch (err) {
        console.warn('[AI Config] Warning: Could not write to .env file:', err.message);
      }
    }

    if (geminiModel) {
      config.ai.geminiModel = geminiModel.trim();
    }

    const status = await aiService.testConnection();
    res.json({
      status: 'success',
      message: status.connected ? 'Gemini AI successfully connected!' : status.message,
      data: status,
    });
  } catch (err) {
    next(err);
  }
});

// 2. Generate metadata for a single video (with language selection)
router.post('/generate', async (req, res, next) => {
  try {
    const {
      videoId,
      originalName,
      cleanTitle,
      folderName,
      duration,
      notes,
      language = 'en',
      saveToVideo = true,
    } = req.body;

    let payload = { originalName, cleanTitle, folderName, duration, notes, language };
    let video = null;

    if (videoId) {
      video = await Video.findById(videoId);
      if (!video) {
        return next(new AppError('Video not found', 404));
      }
      payload = {
        originalName: video.originalName,
        cleanTitle: video.cleanTitle || video.originalName,
        folderName: video.folderName,
        folderPathNames: video.folderPathNames,
        duration: video.duration,
        notes: notes || video.notes,
        language: language || video.aiMetadata?.language || 'en',
      };
    }

    if (!payload.originalName && !payload.cleanTitle) {
      return next(new AppError('Please provide videoId or originalName/cleanTitle', 400));
    }

    const metadata = await aiService.generateMetadata(payload);

    if (video && saveToVideo) {
      video.aiMetadata = {
        generatedTitle: metadata.youtubeTitle,
        youtubeTitle: metadata.youtubeTitle,
        instagramCaption: metadata.instagramCaption,
        description: metadata.description,
        hook: metadata.hook,
        cta: metadata.cta,
        hashtags: metadata.hashtags,
        tags: metadata.tags,
        category: metadata.category,
        language: metadata.language,
        provider: metadata.provider,
        generatedAt: metadata.generatedAt,
        approvalStatus: 'draft',
      };
      if (video.status === 'discovered') {
        video.status = 'metadata_ready';
      }
      await video.save();
    }

    res.json({
      status: 'success',
      data: {
        metadata,
        video: video ? video._id : null,
      },
    });
  } catch (err) {
    next(err);
  }
});

// 3. Start Bulk AI metadata generation
router.post('/bulk/start', async (req, res, next) => {
  try {
    const { videoIds, language = 'en', concurrency = 2, retryFailedOnly = false } = req.body;

    if (!Array.isArray(videoIds) || videoIds.length === 0) {
      return next(new AppError('Please select at least one video for bulk generation', 400));
    }

    const result = await aiService.processBatch({
      videoIds,
      language,
      concurrency: Math.min(Math.max(parseInt(concurrency, 10) || 2, 1), 4),
      retryFailedOnly,
    });

    res.json({
      status: 'success',
      data: result,
    });
  } catch (err) {
    next(err);
  }
});

// 4. Get active or recent Bulk AI job progress
router.get('/bulk/progress', async (req, res, next) => {
  try {
    const { jobId } = req.query;
    const progress = await aiService.getBulkProgress(jobId);
    res.json({
      status: 'success',
      data: progress,
    });
  } catch (err) {
    next(err);
  }
});

// 5. Cancel running Bulk AI job
router.post('/bulk/cancel', async (req, res, next) => {
  try {
    const { jobId } = req.body;
    const cancelledJob = await aiService.cancelBulkJob(jobId);
    res.json({
      status: 'success',
      message: 'Bulk AI generation job cancelled successfully',
      data: cancelledJob,
    });
  } catch (err) {
    next(err);
  }
});

// 6. Manual editing and draft approval workflow
router.patch('/draft/:videoId', async (req, res, next) => {
  try {
    const { videoId } = req.params;
    const {
      youtubeTitle,
      instagramCaption,
      hook,
      description,
      cta,
      hashtags,
      category,
      language,
      approvalStatus,
    } = req.body;

    const video = await Video.findById(videoId);
    if (!video) {
      return next(new AppError('Video not found', 404));
    }

    if (!video.aiMetadata) {
      video.aiMetadata = {};
    }

    if (youtubeTitle !== undefined) {
      video.aiMetadata.youtubeTitle = youtubeTitle;
      video.aiMetadata.generatedTitle = youtubeTitle;
    }
    if (instagramCaption !== undefined) video.aiMetadata.instagramCaption = instagramCaption;
    if (hook !== undefined) video.aiMetadata.hook = hook;
    if (description !== undefined) video.aiMetadata.description = description;
    if (cta !== undefined) video.aiMetadata.cta = cta;
    if (category !== undefined) video.aiMetadata.category = category;
    if (language !== undefined) video.aiMetadata.language = language;

    if (hashtags !== undefined) {
      video.aiMetadata.hashtags = Array.isArray(hashtags)
        ? hashtags
        : String(hashtags).split(/[\s,]+/).filter(Boolean);
    }

    if (approvalStatus && ['draft', 'approved', 'rejected'].includes(approvalStatus)) {
      video.aiMetadata.approvalStatus = approvalStatus;
      if (approvalStatus === 'approved') {
        video.aiMetadata.approvedAt = new Date();
      }
    }

    video.aiMetadata.lastEditedAt = new Date();
    await video.save();

    res.json({
      status: 'success',
      data: {
        videoId: video._id,
        aiMetadata: video.aiMetadata,
        status: video.status,
      },
    });
  } catch (err) {
    next(err);
  }
});

// 4. Batch repair corrupt/gibberish bundle titles in database
router.post('/repair-titles', async (req, res, next) => {
  try {
    const { dryRun = false, limit = 500 } = req.body || {};

    const query = {
      $or: [
        { cleanTitle: /shdushj/i },
        { cleanTitle: /reel bundle/i },
        { cleanTitle: /digiproducthub/i },
        { 'aiMetadata.youtubeTitle': /Wait For The #Shorts/i },
        { 'aiMetadata.youtubeTitle': /shdushj/i },
      ],
    };

    const videos = await Video.find(query).limit(Number(limit) || 500);
    const results = [];
    let postsUpdated = 0;

    for (const v of videos) {
      const cleanMeta = extractCleanTopic({
        originalName: v.originalName,
        folderName: v.folderName,
        folderPathNames: v.folderPathNames,
      });

      const oldClean = v.cleanTitle;
      const oldAiTitle = v.aiMetadata?.youtubeTitle;

      if (!dryRun) {
        v.cleanTitle = cleanMeta.cleanTitle;
        if (v.aiMetadata?.youtubeTitle) {
          const newMeta = await aiService.generateMetadata({
            originalName: v.originalName,
            cleanTitle: cleanMeta.cleanTitle,
            folderName: v.folderName,
            folderPathNames: v.folderPathNames,
            duration: v.duration,
            language: v.aiMetadata?.language || 'en',
          });

          v.aiMetadata.youtubeTitle = newMeta.youtubeTitle;
          v.aiMetadata.generatedTitle = newMeta.youtubeTitle;
          v.aiMetadata.instagramCaption = newMeta.instagramCaption;
          v.aiMetadata.description = newMeta.description;
          v.aiMetadata.hook = newMeta.hook;
          v.aiMetadata.cta = newMeta.cta;
          v.aiMetadata.hashtags = newMeta.hashtags;
          v.aiMetadata.tags = newMeta.tags;
          v.aiMetadata.lastEditedAt = new Date();
        }
        await v.save();

        // Also update any scheduled/failed posts referencing this video
        const postRes = await Post.updateMany(
          { videoId: v._id, title: /shdushj|Wait For The/i },
          {
            $set: {
              title: v.aiMetadata?.youtubeTitle || cleanMeta.cleanTitle,
              caption: v.aiMetadata?.instagramCaption || undefined,
            },
          }
        );
        postsUpdated += postRes.modifiedCount || 0;
      }

      results.push({
        id: v._id,
        before: { cleanTitle: oldClean, aiTitle: oldAiTitle },
        after: { cleanTitle: cleanMeta.cleanTitle, aiTitle: v.aiMetadata?.youtubeTitle },
      });
    }

    res.json({
      status: 'success',
      dryRun,
      totalFound: videos.length,
      repairedVideos: results.length,
      postsUpdated,
      sampleRepairs: results.slice(0, 5),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
