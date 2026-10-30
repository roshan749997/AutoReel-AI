import mongoose from 'mongoose';
import { config } from '../src/config/env.js';
import { Video } from '../src/models/Video.js';
import { Post } from '../src/models/Post.js';
import { aiService, extractCleanTopic } from '../src/services/aiService.js';

async function runRepair() {
  console.log('[Repair] Connecting to MongoDB...');
  await mongoose.connect(config.mongoUri);

  const query = {
    $or: [
      { cleanTitle: /shdushj/i },
      { cleanTitle: /reel bundle/i },
      { cleanTitle: /digiproducthub/i },
      { 'aiMetadata.youtubeTitle': /Wait For The #Shorts/i },
      { 'aiMetadata.youtubeTitle': /shdushj/i },
    ],
  };

  const videos = await Video.find(query);
  console.log(`[Repair] Found ${videos.length} videos needing title repair.`);

  let videosUpdated = 0;
  let postsUpdated = 0;

  for (const v of videos) {
    const cleanMeta = extractCleanTopic({
      originalName: v.originalName,
      folderName: v.folderName,
      folderPathNames: v.folderPathNames,
    });

    const hadAiTitle = Boolean(v.aiMetadata?.youtubeTitle);
    v.cleanTitle = cleanMeta.cleanTitle;

    if (hadAiTitle) {
      const newMeta = aiService.generateHeuristicMetadata(
        {
          originalName: v.originalName,
          cleanTitle: cleanMeta.cleanTitle,
          folderName: v.folderName,
          folderPathNames: v.folderPathNames,
          duration: v.duration,
        },
        v.aiMetadata?.language || 'en'
      );

      const sanitized = aiService.validateAndSanitizeMetadata(newMeta, v.aiMetadata?.language || 'en');

      v.aiMetadata.youtubeTitle = sanitized.youtubeTitle;
      v.aiMetadata.generatedTitle = sanitized.youtubeTitle;
      v.aiMetadata.instagramCaption = sanitized.instagramCaption;
      v.aiMetadata.description = sanitized.description;
      v.aiMetadata.hook = sanitized.hook;
      v.aiMetadata.cta = sanitized.cta;
      v.aiMetadata.hashtags = sanitized.hashtags;
      v.aiMetadata.tags = sanitized.tags;
      v.aiMetadata.lastEditedAt = new Date();
    }

    await v.save();
    videosUpdated++;

    // Update any matching scheduled posts
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

  console.log(`[Repair] Primary loop complete: ${videosUpdated} videos, ${postsUpdated} posts.`);

  // Also clean any leftover posts that had shdushj in title
  const remainingPosts = await Post.find({ title: /shdushj/i }).populate('videoId');
  console.log(`[Repair] Leftover posts with shdushj: ${remainingPosts.length}`);
  for (const p of remainingPosts) {
    if (p.videoId) {
      p.title = p.videoId.aiMetadata?.youtubeTitle || p.videoId.cleanTitle;
      await p.save();
      postsUpdated++;
    }
  }

  // Verification counts
  const leftoverVideos = await Video.countDocuments({
    $or: [{ cleanTitle: /shdushj/i }, { 'aiMetadata.youtubeTitle': /Wait For The #Shorts/i }],
  });
  const leftoverPostCount = await Post.countDocuments({ title: /shdushj/i });

  console.log('[Verification Result]', {
    leftoverVideos,
    leftoverPostCount,
    videosUpdated,
    totalRepairedPosts: postsUpdated,
  });

  // Print sample repaired video and post
  const sampleVideo = await Video.findOne({ originalName: /3d-facts/i }).select('originalName cleanTitle aiMetadata');
  const samplePost = await Post.findOne({ videoId: sampleVideo?._id }).select('title platform');
  console.log('[Sample Repaired Video]:', {
    originalName: sampleVideo?.originalName,
    cleanTitle: sampleVideo?.cleanTitle,
    youtubeTitle: sampleVideo?.aiMetadata?.youtubeTitle,
  });
  console.log('[Sample Repaired Post]:', samplePost);

  await mongoose.disconnect();
}

runRepair().catch(console.error);
