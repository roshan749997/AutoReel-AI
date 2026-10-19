import axios from 'axios';
import { config } from '../config/env.js';
import { WorkflowLog } from '../models/WorkflowLog.js';
import { Video } from '../models/Video.js';
import { BulkAiJob } from '../models/BulkAiJob.js';

export class AiService {
  constructor() {
    this.provider = config.ai.provider;
    this.activeBulkJobId = null;
    this.cancelRequested = false;
  }

  /**
   * Health/Status check for the active AI provider
   */
  async testConnection() {
    const activeProvider = config.ai.provider;

    if (activeProvider === 'gemini') {
      if (!config.ai.geminiApiKey) {
        return {
          provider: 'gemini',
          configured: false,
          connected: false,
          model: config.ai.geminiModel,
          message: 'Gemini Free API Key not configured in .env (get one free at aistudio.google.com)',
        };
      }

      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.ai.geminiModel}:generateContent?key=${config.ai.geminiApiKey}`;
        const res = await axios.post(
          url,
          {
            contents: [{ parts: [{ text: 'Respond with the word OK if you receive this.' }] }],
          },
          { timeout: 10000 }
        );

        const responseText = res.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        return {
          provider: 'gemini',
          configured: true,
          connected: true,
          model: config.ai.geminiModel,
          sampleResponse: responseText.trim(),
          message: 'Google Gemini Free Tier connected successfully',
        };
      } catch (err) {
        const errMessage = err.response?.data?.error?.message || err.message;
        // Never log or return raw API key in diagnostics
        const safeError = errMessage.replace(/key=[a-zA-Z0-9_\-]+/gi, 'key=REDACTED');
        return {
          provider: 'gemini',
          configured: true,
          connected: false,
          error: safeError,
          message: `Gemini API connection error: ${safeError}`,
        };
      }
    }

    if (activeProvider === 'ollama') {
      try {
        const res = await axios.get(`${config.ai.ollamaBaseUrl}/api/tags`, { timeout: 3000 });
        const models = res.data?.models?.map((m) => m.name) || [];
        const hasModel = models.some((m) => m.includes(config.ai.ollamaModel));

        return {
          provider: 'ollama',
          configured: true,
          connected: true,
          availableModels: models,
          targetModel: config.ai.ollamaModel,
          hasTargetModel: hasModel,
          message: hasModel
            ? `Ollama running locally with model ${config.ai.ollamaModel}`
            : `Ollama connected, but model ${config.ai.ollamaModel} not found. Run 'ollama pull ${config.ai.ollamaModel}'`,
        };
      } catch (err) {
        return {
          provider: 'ollama',
          configured: true,
          connected: false,
          error: err.message,
          message: `Ollama not reachable at ${config.ai.ollamaBaseUrl}. Make sure 'ollama serve' is running.`,
        };
      }
    }

    return {
      provider: 'manual',
      configured: true,
      connected: true,
      message: 'Using built-in deterministic heuristic rule generator (0 API cost, 100% offline, multilingual)',
    };
  }

  /**
   * Generates video metadata: title, description, hook, hashtags, and CTA
   * @param {Object} videoData - Information about the video
   * @param {string} videoData.originalName - File name
   * @param {string} videoData.cleanTitle - Clean title
   * @param {string} videoData.folderName - Parent folder name
   * @param {number} videoData.duration - Video length in seconds
   * @param {string} videoData.notes - User notes or keywords
   * @param {string} [videoData.language='en'] - 'en' | 'hi' | 'mr'
   */
  async generateMetadata(videoData) {
    const language = ['en', 'hi', 'mr'].includes(videoData.language) ? videoData.language : 'en';
    const activeProvider = config.ai.provider;
    const prompt = this.buildPrompt(videoData, language);

    let rawMetadata = null;

    if (activeProvider === 'gemini' && config.ai.geminiApiKey) {
      try {
        rawMetadata = await this.callGeminiWithRetry(prompt, videoData, language);
      } catch (err) {
        const safeMsg = (err.response?.data?.error?.message || err.message).replace(/key=[a-zA-Z0-9_\-]+/gi, 'key=REDACTED');
        console.warn(`[AI Service] Gemini failed (${safeMsg}). Falling back to heuristic generator.`);
        await WorkflowLog.create({
          level: 'warn',
          module: 'ai',
          action: 'ai_fallback',
          message: `Gemini generation failed: ${safeMsg}. Using rule-based fallback.`,
        }).catch(() => {});
      }
    } else if (activeProvider === 'ollama') {
      try {
        rawMetadata = await this.callOllama(prompt, videoData, language);
      } catch (err) {
        console.warn(`[AI Service] Ollama failed (${err.message}). Falling back to heuristic generator.`);
        await WorkflowLog.create({
          level: 'warn',
          module: 'ai',
          action: 'ai_fallback',
          message: `Ollama generation failed: ${err.message}. Using rule-based fallback.`,
        }).catch(() => {});
      }
    }

    // Deterministic rule-based fallback if provider was not configured or call failed
    if (!rawMetadata) {
      rawMetadata = this.generateHeuristicMetadata(videoData, language);
    }

    // Apply strict platform validation & sanitization
    return this.validateAndSanitizeMetadata(rawMetadata, language);
  }

  /**
   * Builds prompt for LLMs in English, Hindi, or Marathi
   */
  buildPrompt(videoData, language = 'en') {
    const langInstructions = {
      en: 'Generate all titles, hooks, descriptions, and call-to-actions in natural, engaging English.',
      hi: 'Generate all titles, hooks, descriptions, and call-to-actions in natural, catchy Hindi (Devanagari script or conversational Hindi with standard English keywords) suitable for Indian YouTube Shorts and Instagram Reels audience.',
      mr: 'Generate all titles, hooks, descriptions, and call-to-actions in natural Marathi (मराठी) suitable for Maharashtra YouTube Shorts and Instagram Reels audience.',
    };

    return `You are an expert social media viral content strategist for YouTube Shorts and Instagram Reels.
${langInstructions[language] || langInstructions.en}

Strict Context Guidelines:
- Context is derived from the file name, parent folder, and user notes. Do NOT claim you have watched or visually analyzed the video.
- Do NOT invent fictional celebrities, fake breaking news, or false claims not in the context.

Video Context:
- File Name: "${videoData.cleanTitle || videoData.originalName}"
- Category/Folder: "${videoData.folderName || 'General'}"
- Duration: ${videoData.duration ? `${videoData.duration} seconds` : 'Short vertical reel'}
- User Notes: "${videoData.notes || 'None'}"

Platform Constraints:
- YouTube Shorts Title MUST be strictly under 90 characters so "#Shorts" fits comfortably within YouTube's 100 character limit.
- Instagram Reel Caption should be 200-500 characters, starting with the hook, followed by context, and ending with a CTA.
- Opening hook: the first 3-second spoken or on-screen text to stop scrolling.
- Hashtags: 5 to 10 relevant, non-repetitive tags starting with #.
- Call To Action (CTA): 1 concise closing sentence (e.g., "Follow for daily tips!" / "चॅनेलला सबस्क्राईब करा!").

You MUST return ONLY a valid JSON object matching this schema without any markdown formatting or commentary:
{
  "youtubeTitle": "Punchy YouTube Shorts title under 80 characters with emojis",
  "instagramCaption": "Engaging Instagram Reel caption with line breaks",
  "hook": "First 3-second attention hook",
  "description": "Short 1-2 sentence overview",
  "cta": "Clear call to action",
  "hashtags": ["#Shorts", "#Reels", "#Trending", "#Topic1", "#Topic2"],
  "tags": ["keyword1", "keyword2", "keyword3"],
  "category": "Education | Entertainment | Lifestyle | Tech | Business | Motivation"
}`;
  }

  /**
   * Call Gemini Free Tier with bounded exponential backoff retries for rate limits
   */
  async callGeminiWithRetry(prompt, videoData, language, maxRetries = 2) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.ai.geminiModel}:generateContent?key=${config.ai.geminiApiKey}`;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await axios.post(
          url,
          {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              temperature: 0.7,
            },
          },
          { timeout: 15000 }
        );

        const rawText = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!rawText) throw new Error('Empty response from Gemini');

        const parsed = this.safeJsonParse(rawText);
        return {
          ...parsed,
          provider: 'gemini',
          language,
          generatedAt: new Date(),
        };
      } catch (err) {
        const status = err.response?.status;
        const isRateLimit = status === 429;
        const isTransient = status === 503 || status === 500 || err.code === 'ECONNABORTED';

        if ((isRateLimit || isTransient) && attempt < maxRetries) {
          const delayMs = (attempt + 1) * 1500;
          console.warn(`[AI Service] Gemini transient error (${status || err.message}). Retrying in ${delayMs}ms (Attempt ${attempt + 1}/${maxRetries})...`);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }

        throw err;
      }
    }
  }

  /**
   * Call Ollama local server
   */
  async callOllama(prompt, videoData, language) {
    const res = await axios.post(
      `${config.ai.ollamaBaseUrl}/api/generate`,
      {
        model: config.ai.ollamaModel,
        prompt: prompt,
        stream: false,
        format: 'json',
      },
      { timeout: 30000 }
    );

    const rawText = res.data?.response;
    if (!rawText) throw new Error('Empty response from Ollama');

    const parsed = this.safeJsonParse(rawText);
    return {
      ...parsed,
      provider: 'ollama',
      language,
      generatedAt: new Date(),
    };
  }

  /**
   * Safe JSON parse with regex fallback for LLM code fences
   */
  safeJsonParse(raw) {
    try {
      const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
      return JSON.parse(cleaned);
    } catch {
      // Find outermost JSON object
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        return JSON.parse(match[0]);
      }
      throw new Error('Could not parse valid JSON from AI output');
    }
  }

  /**
   * Deterministic rule-based heuristic metadata generator
   * 100% offline, $0 cost, supports en, hi, mr
   */
  generateHeuristicMetadata(videoData, language = 'en') {
    const base = (videoData.cleanTitle || videoData.originalName || 'Trending Video')
      .replace(/[_-]/g, ' ')
      .replace(/\.[^/.]+$/, '')
      .replace(/\b(mp4|mov|avi|mkv|wmv)\b/gi, '')
      .trim();

    // Capitalize words
    const capitalized = base
      .split(' ')
      .filter(Boolean)
      .map((w) => (w.length > 2 ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w))
      .join(' ') || 'Must Watch';

    const words = base.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    const customTags = words.slice(0, 4).map((t) => `#${t.charAt(0).toUpperCase() + t.slice(1)}`);

    if (language === 'hi') {
      return {
        youtubeTitle: `${capitalized} - ज़रूर देखें! 🚀 #Shorts`,
        instagramCaption: `क्या आपने यह देखा? 👀\n\n${capitalized}\n\nयह वीडियो अंत तक देखें और अपनी राय कमेंट में बताएं! ऐसे और बेहतरीन वीडियो देखने के लिए हमें अभी फॉलो करें।`,
        hook: `रुकिए! यह देखने से पहले स्क्रोल मत कीजिए...`,
        description: `${capitalized} - इस शानदार वीडियो को देखें और शेयर करें।`,
        cta: `ऐसे और वीडियो के लिए लाइक और सब्सक्राइब करें!`,
        hashtags: ['#Shorts', '#Reels', '#Trending', '#HindiReels', '#ViralVideo', ...customTags].slice(0, 7),
        tags: ['shorts', 'reels', 'hindi', 'viral', ...words.slice(0, 3)],
        category: 'Entertainment',
        provider: 'manual',
        language: 'hi',
        generatedAt: new Date(),
      };
    }

    if (language === 'mr') {
      return {
        youtubeTitle: `${capitalized} - नक्की बघा! 🚀 #Shorts`,
        instagramCaption: `हे नक्की बघा! 💥\n\n${capitalized}\n\nहा व्हिडिओ शेवटपर्यंत पहा आणि मित्रांना शेअर करा! अशाच नवनवीन व्हिडिओंसाठी आजच फॉलो करा.`,
        hook: `एक मिनिट थांबा! हा व्हिडिओ चुकवू नका...`,
        description: `${capitalized} - हा व्हिडिओ पूर्ण पहा आणि आवडल्यास शेअर करा.`,
        cta: `नवीन व्हिडिओंसाठी लाईक आणि फॉलो करायला विसरू नका!`,
        hashtags: ['#Shorts', '#Reels', '#MarathiReels', '#Trending', '#Maharashtra', ...customTags].slice(0, 7),
        tags: ['shorts', 'reels', 'marathi', 'viral', ...words.slice(0, 3)],
        category: 'Entertainment',
        provider: 'manual',
        language: 'mr',
        generatedAt: new Date(),
      };
    }

    // Default English
    return {
      youtubeTitle: `${capitalized} 🚀 #Shorts`,
      instagramCaption: `Wait until you see this! 👀\n\n${capitalized}\n\nWatch till the end and let us know your thoughts in the comments. Don't forget to share with a friend who needs to see this!`,
      hook: `Wait until you see what happens next...`,
      description: `Watch what happens in this clip! Don't forget to like, share, and follow for daily videos.`,
      cta: `Subscribe and hit the bell icon for daily shorts!`,
      hashtags: ['#Shorts', '#Reels', '#Viral', '#Trending', ...customTags].slice(0, 7),
      tags: ['shorts', 'reels', 'viral', ...words.slice(0, 3)],
      category: 'Entertainment',
      provider: 'manual',
      language: 'en',
      generatedAt: new Date(),
    };
  }

  /**
   * Validate and enforce platform-specific constraints
   */
  validateAndSanitizeMetadata(raw, language = 'en') {
    // 1. YouTube Shorts Title: Max 100 characters, single line
    let ytTitle = (raw.youtubeTitle || raw.title || 'Must Watch Short').replace(/[\r\n]+/g, ' ').trim();
    if (!ytTitle.toLowerCase().includes('#shorts')) {
      if (ytTitle.length <= 91) {
        ytTitle = `${ytTitle} #Shorts`;
      }
    }
    if (ytTitle.length > 100) {
      ytTitle = ytTitle.slice(0, 96).trim() + '...';
    }

    // 2. Instagram Reel Caption: Max 2200 characters
    let igCaption = (raw.instagramCaption || raw.description || ytTitle).trim();
    if (raw.cta && !igCaption.includes(raw.cta)) {
      igCaption = `${igCaption}\n\n👉 ${raw.cta}`;
    }
    if (igCaption.length > 2200) {
      igCaption = igCaption.slice(0, 2190).trim() + '...';
    }

    // 3. Opening Hook: 1-2 punchy lines
    const hook = (raw.hook || 'Watch this...').replace(/[\r\n]+/g, ' ').slice(0, 200).trim();

    // 4. Description: Core 1-2 sentences
    const description = (raw.description || igCaption.slice(0, 150)).trim();

    // 5. CTA
    const cta = (raw.cta || 'Follow and subscribe for more!').replace(/[\r\n]+/g, ' ').slice(0, 150).trim();

    // 6. Hashtags: deduplicate, normalize, ensure # prefix, enforce 3 to 15 limit
    let rawTags = Array.isArray(raw.hashtags) ? raw.hashtags : [];
    if (typeof raw.hashtags === 'string') {
      rawTags = raw.hashtags.split(/[\s,]+/);
    }

    const seen = new Set();
    const cleanTags = [];

    for (let tag of rawTags) {
      if (!tag) continue;
      // Strip invalid characters: keep alphanumeric, underscore, and leading #
      let cleaned = tag.replace(/[^a-zA-Z0-9_#]/g, '');
      if (!cleaned) continue;
      if (!cleaned.startsWith('#')) {
        cleaned = `#${cleaned}`;
      }
      const lower = cleaned.toLowerCase();
      if (!seen.has(lower) && cleaned.length > 1 && cleaned.length <= 35) {
        seen.add(lower);
        cleanTags.push(cleaned);
      }
    }

    // Ensure at least 3 standard tags
    const fallbackTags = language === 'hi'
      ? ['#Shorts', '#Reels', '#Trending', '#HindiReels']
      : language === 'mr'
      ? ['#Shorts', '#Reels', '#Trending', '#MarathiReels']
      : ['#Shorts', '#Reels', '#Trending', '#Viral'];

    for (const f of fallbackTags) {
      if (cleanTags.length >= 3) break;
      if (!seen.has(f.toLowerCase())) {
        seen.add(f.toLowerCase());
        cleanTags.push(f);
      }
    }

    // Cap at 15 tags for Instagram best practices
    const hashtags = cleanTags.slice(0, 15);

    // 7. Tags (keywords without #)
    const tags = Array.isArray(raw.tags) && raw.tags.length > 0
      ? raw.tags.map((t) => String(t).replace(/#/g, '').trim().toLowerCase()).filter(Boolean).slice(0, 10)
      : hashtags.map((h) => h.replace('#', '').toLowerCase()).slice(0, 8);

    const category = raw.category || 'Entertainment';

    return {
      title: ytTitle, // Backward compatibility
      generatedTitle: ytTitle, // Backward compatibility with Video model
      youtubeTitle: ytTitle,
      instagramCaption: igCaption,
      hook,
      description,
      cta,
      hashtags,
      tags,
      category,
      language,
      provider: raw.provider || 'manual',
      generatedAt: raw.generatedAt || new Date(),
      approvalStatus: 'draft',
    };
  }

  /**
   * Process a batch of videos with bounded concurrency (default 2 workers)
   * Respects free-tier rate limits and local resources
   */
  async processBatch({ videoIds, language = 'en', concurrency = 2, retryFailedOnly = false }) {
    if (!videoIds || videoIds.length === 0) {
      throw new Error('No videos provided for bulk generation');
    }

    // Check if an existing bulk job is currently running
    const existingJob = await BulkAiJob.findOne({ status: 'running' });
    if (existingJob) {
      // Check if it's stale (no heartbeat in 2 minutes)
      const isStale = Date.now() - new Date(existingJob.lastHeartbeatAt).getTime() > 120000;
      if (!isStale) {
        throw new Error('Another bulk AI generation job is currently in progress');
      }
      existingJob.status = 'failed';
      existingJob.errorMessage = 'Job stalled (heartbeat timeout)';
      await existingJob.save();
    }

    // Create unique jobId
    const jobId = `bulk_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    this.activeBulkJobId = jobId;
    this.cancelRequested = false;

    // Filter target videos
    let targetVideos = await Video.find({ _id: { $in: videoIds } });
    if (retryFailedOnly) {
      targetVideos = targetVideos.filter((v) => !v.aiMetadata?.youtubeTitle || v.status === 'discovered');
    }

    const job = await BulkAiJob.create({
      jobId,
      status: 'running',
      totalVideos: targetVideos.length,
      processedVideos: 0,
      successfulVideos: 0,
      failedVideos: 0,
      language,
      provider: config.ai.provider,
      videoIds: targetVideos.map((v) => v._id.toString()),
      startedAt: new Date(),
      lastHeartbeatAt: new Date(),
    });

    // Run async in background without blocking caller
    this.runBatchWorker(job, targetVideos, language, concurrency).catch(async (err) => {
      console.error('[AI Service] Fatal batch worker error:', err);
      await BulkAiJob.updateOne(
        { jobId },
        { status: 'failed', errorMessage: err.message, completedAt: new Date() }
      );
    });

    return {
      jobId,
      totalVideos: targetVideos.length,
      status: 'running',
      message: `Bulk AI generation started for ${targetVideos.length} videos with concurrency ${concurrency}`,
    };
  }

  /**
   * Async worker pool with bounded concurrency
   */
  async runBatchWorker(job, videos, language, concurrency = 2) {
    const queue = [...videos];
    const total = videos.length;
    let processed = 0;
    let successful = 0;
    let failed = 0;

    const worker = async () => {
      while (queue.length > 0) {
        // Check cancellation
        const freshJob = await BulkAiJob.findOne({ jobId: job.jobId });
        if (this.cancelRequested || freshJob?.status === 'cancelled') {
          return;
        }

        const video = queue.shift();
        if (!video) break;

        try {
          await BulkAiJob.updateOne(
            { jobId: job.jobId },
            {
              currentVideoTitle: video.cleanTitle || video.originalName,
              lastHeartbeatAt: new Date(),
            }
          );

          const payload = {
            originalName: video.originalName,
            cleanTitle: video.cleanTitle || video.originalName,
            folderName: video.folderName,
            duration: video.duration,
            notes: video.notes,
            language,
          };

          const metadata = await this.generateMetadata(payload);

          // Persist to video as draft
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

          successful++;
        } catch (err) {
          failed++;
          console.error(`[AI Batch] Error on video ${video._id}:`, err.message);
          await BulkAiJob.updateOne(
            { jobId: job.jobId },
            {
              $push: {
                errors: {
                  videoId: video._id.toString(),
                  title: video.cleanTitle || video.originalName,
                  error: err.message,
                },
              },
            }
          );
        } finally {
          processed++;
          await BulkAiJob.updateOne(
            { jobId: job.jobId },
            {
              processedVideos: processed,
              successfulVideos: successful,
              failedVideos: failed,
              lastHeartbeatAt: new Date(),
            }
          );

          // Pacing delay (500ms) to respect provider quotas
          await new Promise((r) => setTimeout(r, 500));
        }
      }
    };

    // Spawn bounded concurrent workers
    const workers = [];
    const poolSize = Math.min(concurrency, videos.length);
    for (let i = 0; i < poolSize; i++) {
      workers.push(worker());
    }

    await Promise.all(workers);

    // Finalize job status
    const finalCheck = await BulkAiJob.findOne({ jobId: job.jobId });
    if (finalCheck?.status !== 'cancelled') {
      const finalStatus = failed > 0 && successful === 0 ? 'failed' : 'completed';
      await BulkAiJob.updateOne(
        { jobId: job.jobId },
        {
          status: finalStatus,
          completedAt: new Date(),
          currentVideoTitle: '',
        }
      );
    }
    this.activeBulkJobId = null;
  }

  /**
   * Request cancellation of active bulk job
   */
  async cancelBulkJob(jobId) {
    this.cancelRequested = true;
    const query = jobId ? { jobId } : { status: 'running' };
    const job = await BulkAiJob.findOneAndUpdate(
      query,
      { status: 'cancelled', completedAt: new Date() },
      { new: true }
    );
    return job;
  }

  /**
   * Get progress of active or specified bulk job
   */
  async getBulkProgress(jobId) {
    let job = null;
    if (jobId) {
      job = await BulkAiJob.findOne({ jobId });
    } else {
      job = await BulkAiJob.findOne().sort({ createdAt: -1 });
    }

    return {
      hasActiveJob: job?.status === 'running',
      job,
    };
  }
}

export const aiService = new AiService();
