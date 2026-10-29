import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from backend folder or root folder
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const cleanApiKey = (val) => {
  if (!val) return '';
  const match = String(val).match(/(?:X-goog-api-key|key)[:=]\s*([a-zA-Z0-9_\-\.]+)/i);
  if (match) return match[1].trim();
  return String(val).replace(/["']/g, '').trim();
};

export const resolveGoogleRedirectUri = () => {
  const envUri = (process.env.GOOGLE_REDIRECT_URI || '').trim();
  const clientUrl = (process.env.CLIENT_URL || '').trim().replace(/\/$/, '');
  const renderExternal = (process.env.RENDER_EXTERNAL_URL || '').trim().replace(/\/$/, '');
  const backendBase = renderExternal || (process.env.BACKEND_URL || '').trim().replace(/\/$/, '');

  // Guard against misconfiguration where GOOGLE_REDIRECT_URI was pointed at frontend static domain
  const isFrontendDomain = (uri) => {
    if (!uri) return false;
    if (clientUrl && (uri === clientUrl || uri.startsWith(`${clientUrl}/`))) return true;
    if (/autoreel-ai-1\.onrender\.com/i.test(uri)) return true;
    return false;
  };

  if (envUri && isFrontendDomain(envUri)) {
    const targetBase = backendBase || 'https://autoreel-ai-2.onrender.com';
    console.warn(`[OAuth Config] WARNING: GOOGLE_REDIRECT_URI (${envUri}) points to frontend domain. Overriding to backend callback: ${targetBase}/api/accounts/google/callback`);
    return `${targetBase}/api/accounts/google/callback`;
  }

  if (envUri) {
    return envUri;
  }

  if (backendBase) {
    return `${backendBase}/api/accounts/google/callback`;
  }

  const port = process.env.PORT || '5000';
  return `http://localhost:${port}/api/accounts/google/callback`;
};

export const config = {
  port: parseInt(process.env.PORT || '5000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',

  // Database
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/video_automation',

  // Encryption for tokens (32-byte key)
  encryptionKey: process.env.ENCRYPTION_KEY || 'default_insecure_key_must_change_in_production_32b!',

  // Dashboard API Key for sensitive administrative operations
  dashboardApiKey: process.env.DASHBOARD_API_KEY || '',

  // AI Configuration
  ai: {
    provider: process.env.AI_PROVIDER || 'gemini', // 'gemini' | 'ollama' | 'manual'
    geminiApiKey: cleanApiKey(process.env.GEMINI_API_KEY),
    geminiModel: process.env.GEMINI_MODEL || 'gemini-flash-latest',
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
    ollamaModel: process.env.OLLAMA_MODEL || 'llama3.2',
  },

  // Google APIs (Drive & YouTube)
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    redirectUri: resolveGoogleRedirectUri(),
    driveFolderId: process.env.GOOGLE_DRIVE_FOLDER_ID || '',
  },

  // Meta / Instagram Graph API & Instagram Login
  meta: {
    appId: process.env.INSTAGRAM_APP_ID || process.env.META_APP_ID || '',
    appSecret: process.env.INSTAGRAM_APP_SECRET || process.env.META_APP_SECRET || '',
    redirectUri: process.env.META_REDIRECT_URI || 'http://localhost:5000/api/accounts/meta/callback',
    authFlow: process.env.META_AUTH_FLOW || 'instagram_login', // 'instagram_login' | 'facebook_login'
  },

  // n8n
  n8n: {
    webhookUrl: process.env.N8N_WEBHOOK_URL || 'http://127.0.0.1:5678/webhook/video-pipeline',
    apiKey: process.env.N8N_API_KEY || '',
    webhookSecret: process.env.N8N_WEBHOOK_SECRET || 'video_automation_n8n_secret_default',
  },
};
