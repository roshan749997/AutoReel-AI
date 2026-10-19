import { Router } from 'express';
import axios from 'axios';
import { getDatabaseStatus } from '../config/database.js';
import { config } from '../config/env.js';
import { googleDriveService } from '../services/googleDriveService.js';
import { youtubeService } from '../services/youtubeService.js';
import { instagramService } from '../services/instagramService.js';
import { aiService } from '../services/aiService.js';
import { Account } from '../models/Account.js';
import { Video } from '../models/Video.js';
import { Post } from '../models/Post.js';

const router = Router();
const startTime = Date.now();

// Base health check
router.get('/', (req, res) => {
  const dbStatus = getDatabaseStatus();
  const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);

  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: `${uptimeSeconds}s`,
    environment: config.nodeEnv,
    database: dbStatus,
    memory: {
      rss: `${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB`,
      heapUsed: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB`,
    },
  });
});

// Comprehensive integration diagnostic check
router.get('/integrations', async (req, res) => {
  const dbStatus = getDatabaseStatus();

  // Test n8n localhost endpoint
  let n8nStatus = {
    configured: !!config.n8n.webhookUrl,
    connected: false,
    message: 'n8n not reachable at 127.0.0.1:5678',
  };
  try {
    const n8nRes = await axios.get('http://127.0.0.1:5678/healthz', { timeout: 1500 });
    n8nStatus = {
      configured: true,
      connected: n8nRes.status === 200,
      message: 'n8n Community Edition running on 127.0.0.1:5678',
    };
  } catch (err) {
    n8nStatus.error = err.message;
  }

  // Test AI Provider
  const aiStatus = await aiService.testConnection();

  // Test Google Drive
  const driveStatus = await googleDriveService.testConnection();

  // Test YouTube
  const ytStatus = await youtubeService.testConnection();

  // Test Instagram
  const igStatus = await instagramService.testConnection();

  res.json({
    timestamp: new Date().toISOString(),
    integrations: {
      database: {
        name: 'MongoDB Atlas',
        ...dbStatus,
      },
      googleDrive: {
        name: 'Google Drive API v3 (20k+ Library)',
        ...driveStatus,
      },
      youtube: {
        name: 'YouTube Data API v3',
        ...ytStatus,
      },
      instagram: {
        name: 'Meta Instagram Graph API',
        ...igStatus,
      },
      ai: {
        name: `AI Provider (${config.ai.provider})`,
        ...aiStatus,
      },
      n8n: {
        name: 'Local n8n Workflow Automation',
        ...n8nStatus,
      },
    },
  });
});

// Setup checklist and stats
router.get('/setup-checklist', async (req, res) => {
  const dbStatus = getDatabaseStatus();
  let accountsCount = 0;
  let videosCount = 0;
  let postsCount = 0;

  if (dbStatus.connected) {
    try {
      accountsCount = await Account.countDocuments({ status: 'connected' });
      videosCount = await Video.countDocuments();
      postsCount = await Post.countDocuments();
    } catch {
      // Ignore if collection not ready
    }
  }

  const checklist = [
    {
      id: 'mongodb',
      title: 'Database (MongoDB Atlas / Local)',
      description: 'Connect Mongoose using MONGODB_URI',
      isCompleted: dbStatus.connected,
      docsLink: 'README.md',
    },
    {
      id: 'drive_credentials',
      title: 'Google Drive API v3',
      description: 'Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET for 20k+ library indexing',
      isCompleted: !!config.google.clientId && !!config.google.clientSecret,
      docsLink: 'docs/GOOGLE_DRIVE_SETUP.md',
    },
    {
      id: 'drive_library',
      title: 'Index Google Drive Video Library',
      description: 'Run sync to index video files from your Drive folder',
      isCompleted: videosCount > 0,
      metadata: { indexedVideos: videosCount },
      docsLink: 'docs/GOOGLE_DRIVE_SETUP.md',
    },
    {
      id: 'social_accounts',
      title: 'Connect Official Social Channels',
      description: 'Connect at least one YouTube channel or Instagram business account via OAuth',
      isCompleted: accountsCount > 0,
      metadata: { connectedAccounts: accountsCount },
      docsLink: 'docs/YOUTUBE_API_SETUP.md',
    },
    {
      id: 'free_ai',
      title: 'Configure Free AI Provider',
      description: 'Set free Gemini API Key or run local Ollama model (fallback active)',
      isCompleted: !!config.ai.geminiApiKey || config.ai.provider === 'manual',
      docsLink: 'docs/FREE_AI_SETUP.md',
    },
    {
      id: 'n8n_docker',
      title: 'Local n8n Automation Engine',
      description: 'Start self-hosted n8n in Docker bound to 127.0.0.1:5678',
      isCompleted: false, // Updated dynamically via /integrations
      docsLink: 'automation/n8n/README.md',
    },
  ];

  res.json({
    overallProgress: Math.round(
      (checklist.filter((item) => item.isCompleted).length / checklist.length) * 100
    ),
    stats: {
      connectedAccounts: accountsCount,
      indexedVideos: videosCount,
      totalScheduledPosts: postsCount,
    },
    items: checklist,
  });
});

export default router;
