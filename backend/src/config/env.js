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

/** Current Render production backend fallback (when RENDER_EXTERNAL_URL is unset). */
export const DEFAULT_RENDER_BACKEND_URL = 'https://autoreel-ai-fs3l.onrender.com';
const KNOWN_FRONTEND_HOST_RE =
  /autoreel-ai-1(?:-aevj)?\.onrender\.com|autoreel-ai-1-aevj\.onrender\.com/i;

export const resolveBackendPublicUrl = () => {
  const renderExternal = (process.env.RENDER_EXTERNAL_URL || '').trim().replace(/\/$/, '');
  const backendBase = (process.env.BACKEND_URL || '').trim().replace(/\/$/, '');
  const publicUrl = (process.env.PUBLIC_URL || '').trim().replace(/\/$/, '');
  const clientUrl = (process.env.CLIENT_URL || '').trim().replace(/\/$/, '');

  if (renderExternal) return renderExternal;
  if (backendBase && !isDeadTunnelOrLocalUrl(backendBase)) return backendBase;
  if (publicUrl && !isDeadTunnelOrLocalUrl(publicUrl)) return publicUrl;
  if (/onrender\.com/i.test(clientUrl) || process.env.NODE_ENV === 'production') {
    return DEFAULT_RENDER_BACKEND_URL;
  }

  const port = process.env.PORT || '5000';
  return `http://localhost:${port}`;
};

const isDeadTunnelOrLocalUrl = (url) => {
  if (!url) return true;
  if (/localhost|127\.0\.0\.1/i.test(url)) return true;
  if (/ngrok/i.test(url)) return true;
  return false;
};

const resolveProductionBackendBase = () => {
  const renderExternal = (process.env.RENDER_EXTERNAL_URL || '').trim().replace(/\/$/, '');
  const backendBase = (process.env.BACKEND_URL || '').trim().replace(/\/$/, '');
  const clientUrl = (process.env.CLIENT_URL || '').trim().replace(/\/$/, '');

  if (renderExternal) return renderExternal;
  if (backendBase && !isDeadTunnelOrLocalUrl(backendBase)) return backendBase;
  if (/onrender\.com/i.test(clientUrl) || process.env.NODE_ENV === 'production') {
    return DEFAULT_RENDER_BACKEND_URL;
  }
  return '';
};

export const resolveGoogleRedirectUri = () => {
  const envUri = (process.env.GOOGLE_REDIRECT_URI || '').trim();
  const clientUrl = (process.env.CLIENT_URL || '').trim().replace(/\/$/, '');
  const backendBase = resolveProductionBackendBase();

  // Guard against misconfiguration where GOOGLE_REDIRECT_URI was pointed at frontend static domain
  const isFrontendDomain = (uri) => {
    if (!uri) return false;
    if (clientUrl && (uri === clientUrl || uri.startsWith(`${clientUrl}/`))) return true;
    if (KNOWN_FRONTEND_HOST_RE.test(uri)) return true;
    return false;
  };

  if (envUri && isFrontendDomain(envUri)) {
    const targetBase = backendBase || DEFAULT_RENDER_BACKEND_URL;
    console.warn(`[OAuth Config] WARNING: GOOGLE_REDIRECT_URI (${envUri}) points to frontend domain. Overriding to backend callback: ${targetBase}/api/accounts/google/callback`);
    return `${targetBase}/api/accounts/google/callback`;
  }

  // Dead ngrok / localhost callbacks break production reconnects
  if (envUri && isDeadTunnelOrLocalUrl(envUri) && backendBase) {
    console.warn(`[OAuth Config] WARNING: GOOGLE_REDIRECT_URI (${envUri}) is ngrok/localhost. Overriding to ${backendBase}/api/accounts/google/callback`);
    return `${backendBase}/api/accounts/google/callback`;
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

export const resolveMetaRedirectUri = () => {
  const envUri = (process.env.META_REDIRECT_URI || '').trim();
  const backendBase = resolveProductionBackendBase();
  const productionCallback = `${backendBase || DEFAULT_RENDER_BACKEND_URL}/api/accounts/meta/callback`;

  // Production / Render must never send Instagram OAuth back to a dead ngrok tunnel
  if (envUri && isDeadTunnelOrLocalUrl(envUri) && (backendBase || process.env.NODE_ENV === 'production')) {
    console.warn(
      `[OAuth Config] WARNING: META_REDIRECT_URI (${envUri}) is ngrok/localhost. Overriding to ${productionCallback}`
    );
    return productionCallback;
  }

  if (envUri) {
    return envUri;
  }

  if (backendBase) {
    return `${backendBase}/api/accounts/meta/callback`;
  }

  const port = process.env.PORT || '5000';
  return `http://localhost:${port}/api/accounts/meta/callback`;
};

export const config = {
  port: parseInt(process.env.PORT || '5000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  publicUrl: resolveBackendPublicUrl(),

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
    geminiModel: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
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
    redirectUri: resolveMetaRedirectUri(),
    authFlow: process.env.META_AUTH_FLOW || 'instagram_login', // 'instagram_login' | 'facebook_login'
  },

  // n8n
  n8n: {
    webhookUrl: process.env.N8N_WEBHOOK_URL || 'http://127.0.0.1:5678/webhook/video-pipeline',
    apiKey: process.env.N8N_API_KEY || '',
    webhookSecret: process.env.N8N_WEBHOOK_SECRET || 'video_automation_n8n_secret_default',
  },
};
