import test from 'node:test';
import assert from 'node:assert/strict';
import { aiService } from '../src/services/aiService.js';
import { Video } from '../src/models/Video.js';
import { BulkAiJob } from '../src/models/BulkAiJob.js';
import { connectDatabase, closeDatabase } from '../src/config/database.js';
import { config } from '../src/config/env.js';

test.before(async () => {
  await connectDatabase();
});

test.after(async () => {
  await closeDatabase();
});

// 1. Rule-based fallback generation for en, hi, mr
test('AI Service: Rule-based fallback generates structured metadata in English', () => {
  const result = aiService.generateHeuristicMetadata(
    {
      originalName: '10_mindblowing_ai_tools_2026.mp4',
      cleanTitle: '10 Mindblowing AI Tools 2026',
      folderName: 'Technology',
      duration: 45,
    },
    'en'
  );

  assert.ok(result.youtubeTitle.includes('#Shorts'));
  assert.ok(result.instagramCaption.length > 20);
  assert.ok(result.hook.length > 5);
  assert.ok(result.cta.length > 5);
  assert.ok(Array.isArray(result.hashtags));
  assert.ok(result.hashtags.length >= 3);
  assert.equal(result.provider, 'manual');
  assert.equal(result.language, 'en');
});

test('AI Service: Rule-based fallback generates Hindi metadata', () => {
  const result = aiService.generateHeuristicMetadata(
    {
      originalName: 'morning_yoga_routine_for_beginners.mp4',
      cleanTitle: 'Morning Yoga Routine',
      folderName: 'Fitness',
      duration: 30,
    },
    'hi'
  );

  assert.ok(result.youtubeTitle.includes('ज़रूर देखें'));
  assert.ok(result.instagramCaption.includes('क्या आपने यह देखा'));
  assert.ok(result.hook.includes('रुकिए'));
  assert.ok(result.hashtags.includes('#HindiReels'));
  assert.equal(result.language, 'hi');
});

test('AI Service: Rule-based fallback generates Marathi metadata', () => {
  const result = aiService.generateHeuristicMetadata(
    {
      originalName: 'top_street_food_pune.mp4',
      cleanTitle: 'Top Street Food Pune',
      folderName: 'Food',
      duration: 50,
    },
    'mr'
  );

  assert.ok(result.youtubeTitle.includes('नक्की बघा'));
  assert.ok(result.instagramCaption.includes('हे नक्की बघा'));
  assert.ok(result.hook.includes('थांबा'));
  assert.ok(result.hashtags.includes('#MarathiReels'));
  assert.equal(result.language, 'mr');
});

// 2. Safe error reporting when API key not configured
test('AI Service: Provider diagnostics handles unconfigured Gemini key safely without exposing secrets', async () => {
  const originalKey = config.ai.geminiApiKey;
  const originalProvider = config.ai.provider;

  config.ai.provider = 'gemini';
  config.ai.geminiApiKey = '';

  const status = await aiService.testConnection();
  assert.equal(status.provider, 'gemini');
  assert.equal(status.configured, false);
  assert.equal(status.connected, false);
  assert.match(status.message, /not configured/i);

  // Restore
  config.ai.geminiApiKey = originalKey;
  config.ai.provider = originalProvider;
});

// 3. Platform Validation: YouTube title <= 100 characters and Instagram caption
test('AI Service: validateAndSanitizeMetadata strictly enforces YouTube <= 100 chars and appends #Shorts', () => {
  const longTitle = 'Super Incredibly Long Viral Video Title That Keeps Going On And On Beyond Ordinary Limits For Social Media Testing Platforms';
  const validated = aiService.validateAndSanitizeMetadata({
    youtubeTitle: longTitle,
    instagramCaption: 'Short caption',
    hashtags: ['#Shorts', '#Reels', '#Testing'],
  });

  assert.ok(validated.youtubeTitle.length <= 100, `Expected title length <= 100 but was ${validated.youtubeTitle.length}`);
  assert.ok(validated.youtubeTitle.endsWith('...'));
  assert.equal(validated.approvalStatus, 'draft');
});

test('AI Service: validateAndSanitizeMetadata sanitizes and deduplicates hashtags', () => {
  const rawTags = ['#Shorts', 'shorts', '#Shorts!', '##Viral,', '#Tech', '#Tech', '#AI_Trends'];
  const validated = aiService.validateAndSanitizeMetadata({
    youtubeTitle: 'Test Video',
    instagramCaption: 'Test Caption',
    hashtags: rawTags,
  });

  const uniqueLower = new Set(validated.hashtags.map((h) => h.toLowerCase()));
  assert.equal(uniqueLower.size, validated.hashtags.length, 'Hashtags must not contain duplicate case variations');
  validated.hashtags.forEach((h) => {
    assert.ok(h.startsWith('#'), `Tag "${h}" must start with #`);
    assert.ok(!/[!,]/.test(h), `Tag "${h}" must not contain punctuation`);
  });
  assert.ok(validated.hashtags.length <= 15, 'Hashtags must not exceed 15');
});

// 4. Safe JSON parser recovery from code blocks or loose formatting
test('AI Service: safeJsonParse extracts valid JSON from markdown code fences', () => {
  const sampleMarkdown = '```json\n{\n  "youtubeTitle": "AI Revolution 2026 #Shorts",\n  "category": "Tech"\n}\n```';
  const parsed = aiService.safeJsonParse(sampleMarkdown);

  assert.equal(parsed.youtubeTitle, 'AI Revolution 2026 #Shorts');
  assert.equal(parsed.category, 'Tech');
});

// 5. Bulk Generation Engine with Bounded Concurrency
test('AI Service: Bulk processing generates draft metadata for multiple videos and avoids conflicting jobs', async () => {
  // Create 3 dummy test videos
  const v1 = await Video.create({
    driveFileId: `test_ai_bulk_1_${Date.now()}`,
    originalName: 'quick_life_hacks_vol1.mp4',
    cleanTitle: 'Quick Life Hacks Vol 1',
    mimeType: 'video/mp4',
    status: 'discovered',
  });

  const v2 = await Video.create({
    driveFileId: `test_ai_bulk_2_${Date.now()}`,
    originalName: 'quick_life_hacks_vol2.mp4',
    cleanTitle: 'Quick Life Hacks Vol 2',
    mimeType: 'video/mp4',
    status: 'discovered',
  });

  const videoIds = [v1._id.toString(), v2._id.toString()];

  const batchResult = await aiService.processBatch({
    videoIds,
    language: 'en',
    concurrency: 2,
  });

  assert.ok(batchResult.jobId);
  assert.equal(batchResult.totalVideos, 2);
  assert.equal(batchResult.status, 'running');

  // Attempt to start a second conflicting job immediately
  await assert.rejects(
    async () => {
      await aiService.processBatch({ videoIds, language: 'en', concurrency: 2 });
    },
    /Another bulk AI generation job is currently in progress/i
  );

  // Poll until batch worker finishes
  let completed = false;
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 400));
    const progress = await aiService.getBulkProgress(batchResult.jobId);
    if (progress.job?.status === 'completed') {
      completed = true;
      break;
    }
  }

  assert.ok(completed, 'Bulk processing worker should finish within reasonable time');

  // Verify persistence to videos
  const updatedV1 = await Video.findById(v1._id);
  const updatedV2 = await Video.findById(v2._id);

  assert.equal(updatedV1.status, 'metadata_ready');
  assert.equal(updatedV1.aiMetadata.approvalStatus, 'draft');
  assert.ok(updatedV1.aiMetadata.youtubeTitle.includes('Quick Life Hacks'));

  assert.equal(updatedV2.status, 'metadata_ready');
  assert.equal(updatedV2.aiMetadata.approvalStatus, 'draft');

  // Clean up
  await Video.deleteMany({ _id: { $in: [v1._id, v2._id] } });
  await BulkAiJob.deleteMany({ jobId: batchResult.jobId });
});

// 6. Bulk Generation Cancellation
test('AI Service: cancelBulkJob successfully cancels an active batch', async () => {
  const dummyJob = await BulkAiJob.create({
    jobId: `test_cancel_${Date.now()}`,
    status: 'running',
    totalVideos: 10,
    processedVideos: 2,
  });

  const cancelled = await aiService.cancelBulkJob(dummyJob.jobId);
  assert.equal(cancelled.status, 'cancelled');
  assert.ok(cancelled.completedAt);

  await BulkAiJob.deleteOne({ jobId: dummyJob.jobId });
});

// 7. Manual Draft Approval Workflow
test('AI Service: Draft approval workflow updates metadata and approvedAt date', async () => {
  const video = await Video.create({
    driveFileId: `test_approval_${Date.now()}`,
    originalName: 'draft_test.mp4',
    cleanTitle: 'Draft Test Video',
    mimeType: 'video/mp4',
    status: 'metadata_ready',
    aiMetadata: {
      youtubeTitle: 'Draft Title',
      approvalStatus: 'draft',
    },
  });

  // User edits and approves
  video.aiMetadata.youtubeTitle = 'Final Approved Viral Title #Shorts';
  video.aiMetadata.approvalStatus = 'approved';
  video.aiMetadata.approvedAt = new Date();
  await video.save();

  const refreshed = await Video.findById(video._id);
  assert.equal(refreshed.aiMetadata.approvalStatus, 'approved');
  assert.equal(refreshed.aiMetadata.youtubeTitle, 'Final Approved Viral Title #Shorts');
  assert.ok(refreshed.aiMetadata.approvedAt instanceof Date);

  await Video.deleteOne({ _id: video._id });
});
