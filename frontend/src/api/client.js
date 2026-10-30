const API_BASE = import.meta.env.VITE_API_URL || '/api';
const API_KEY = import.meta.env.VITE_DASHBOARD_API_KEY || '';

async function request(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const storedKey = typeof window !== 'undefined' ? localStorage.getItem('dashboard_api_key') : '';
  const apiKey = API_KEY || storedKey;
  const timeoutMs = options.timeoutMs || 25000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const config = {
    signal: options.signal || controller.signal,
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey && { 'x-api-key': apiKey }),
      ...options.headers,
    },
    ...options,
  };

  if (config.body && typeof config.body === 'object' && !(config.body instanceof FormData)) {
    config.body = JSON.stringify(config.body);
  }

  try {
    const res = await fetch(url, config);
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const errorMsg =
        data.message ||
        (Array.isArray(data.data?.errors) ? data.data.errors.map((e) => e.error).join('; ') : null) ||
        data.error ||
        `Request failed with status ${res.status}`;
      const apiErr = new Error(errorMsg);
      apiErr.data = data;
      apiErr.errors = data.data?.errors || data.errors;
      throw apiErr;
    }

    return data;
  } catch (err) {
    if (err.name === 'AbortError' || (err.message && err.message.includes('aborted'))) {
      console.warn(`[API Client Timeout] Request to ${endpoint} timed out after ${timeoutMs}ms`);
      const timeoutErr = new Error(
        `Request timed out after ${Math.round(timeoutMs / 1000)}s. Large batches continue processing in the background on the server.`
      );
      timeoutErr.name = 'TimeoutError';
      timeoutErr.isTimeout = true;
      throw timeoutErr;
    } else {
      console.error(`[API Client Error] ${endpoint}:`, err.message);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  // Health & System
  getHealth: () => request('/health'),
  getIntegrations: () => request('/health/integrations'),
  getSetupChecklist: () => request('/health/setup-checklist'),

  // Social Accounts
  getAccounts: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/accounts${query ? `?${query}` : ''}`);
  },
  getAccount: (id) => request(`/accounts/${id}`),
  updateAccountPreferences: (id, preferences) =>
    request(`/accounts/${id}/preferences`, { method: 'PATCH', body: preferences }),
  getGoogleAuthUrl: () => request('/accounts/google/auth-url'),
  getYouTubeAuthUrl: () => request('/accounts/google/auth-url'),
  getMetaAuthUrl: () => request('/accounts/meta/auth-url'),
  testAccount: (id) => request(`/accounts/${id}/test`, { method: 'POST' }),
  disconnectAccount: (id) => request(`/accounts/${id}/disconnect`, { method: 'POST' }),
  deleteAccount: (id) => request(`/accounts/${id}`, { method: 'DELETE' }),
  getAccountHistory: (id, params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/accounts/${id}/history${query ? `?${query}` : ''}`);
  },
  purgeDemoAccounts: () => request('/accounts/purge-demo', { method: 'POST' }),
  getChannelPairs: () => request('/channels'),
  saveChannelPair: (pair) => request(`/channels/${encodeURIComponent(pair.folderId)}`, {
    method: 'PUT',
    body: {
      folderName: pair.folderName || '',
      youtubeAccountId: pair.youtubeAccountId || '',
      instagramAccountId: pair.instagramAccountId || '',
    },
  }),
  deleteChannelPair: (folderId) => request(`/channels/${encodeURIComponent(folderId)}`, { method: 'DELETE' }),

  // Video Library (20k+ Google Drive library)
  getDriveStatus: () => request('/videos/drive/status'),
  validateFolder: (folderId) => request('/videos/drive/validate-folder', { method: 'POST', body: { folderId } }),
  startSyncJob: (options = {}) => request('/videos/sync/start', { method: 'POST', body: options }),
  getSyncProgress: (jobId) => request(`/videos/sync/progress${jobId ? `?jobId=${jobId}` : ''}`),
  cancelSyncJob: (jobId) => request('/videos/sync/cancel', { method: 'POST', body: { jobId } }),
  getVideoFoldersSummary: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/videos/folders/summary${query ? `?${query}` : ''}`);
  },
  getVideoFolderTree: () => request('/videos/folders/tree'),
  getVideoStats: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/videos/stats${query ? `?${query}` : ''}`);
  },
  getVideos: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/videos${query ? `?${query}` : ''}`);
  },
  getVideoIds: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/videos/ids${query ? `?${query}` : ''}`);
  },
  getVideosByIds: (ids = []) => request('/videos/by-ids', { method: 'POST', body: { ids } }),
  syncVideos: (options = {}) => request('/videos/sync/start', { method: 'POST', body: options }),
  retryVideo: (id) => request(`/videos/${id}/retry`, { method: 'POST' }),
  getVideo: (id) => request(`/videos/${id}`),
  updateVideo: (id, updates) => request(`/videos/${id}`, { method: 'PATCH', body: updates }),

  // AI Metadata Generation & Pipeline
  generateAiMetadata: (payload) => request('/ai/generate', { method: 'POST', body: payload }),
  getAiStatus: () => request('/ai/status'),
  configureAi: (payload) => request('/ai/configure', { method: 'POST', body: payload }),
  startBulkAi: (payload) => request('/ai/bulk/start', { method: 'POST', body: payload }),
  getBulkAiProgress: (jobId) => request(`/ai/bulk/progress${jobId ? `?jobId=${jobId}` : ''}`),
  cancelBulkAi: (jobId) => request('/ai/bulk/cancel', { method: 'POST', body: { jobId } }),
  updateAiDraft: (videoId, updates) => request(`/ai/draft/${videoId}`, { method: 'PATCH', body: updates }),

  // Publishing Queue & Posts
  getPosts: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/posts${query ? `?${query}` : ''}`);
  },
  createPost: (postData) => request('/posts', { method: 'POST', body: postData }),
  scheduleMultiPlatform: (postData) => request('/posts/multi-platform', { method: 'POST', body: postData }),
  batchSchedule: (items) => request('/posts/batch-schedule', { method: 'POST', body: { items }, timeoutMs: 120000 }),
  getPost: (id) => request(`/posts/${id}`),
  updatePost: (id, updates) => request(`/posts/${id}`, { method: 'PATCH', body: updates }),
  pausePost: (id) => request(`/posts/${id}/pause`, { method: 'POST' }),
  resumePost: (id) => request(`/posts/${id}/resume`, { method: 'POST' }),
  reschedulePost: (id, data) => request(`/posts/${id}/reschedule`, { method: 'POST', body: data }),
  cancelPost: (id, reason) => request(`/posts/${id}/cancel`, { method: 'POST', body: { reason } }),
  retryPost: (id) => request(`/posts/${id}/retry`, { method: 'POST' }),
  retryAllFailed: () => request('/posts/retry-all-failed', { method: 'POST' }),
  publishNow: (id) => request(`/posts/${id}/publish-now`, { method: 'POST' }),
  deletePost: (id) => request(`/posts/${id}`, { method: 'DELETE' }),
  purgePosts: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/posts/purge/all${query ? `?${query}` : ''}`, { method: 'DELETE' });
  },

  // Automation / n8n
  getWorkflowStatus: () => request('/workflows/status'),
  triggerWorkflow: (payload) => request('/workflows/trigger', { method: 'POST', body: payload }),

  // Audit Logs
  getLogs: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/logs${query ? `?${query}` : ''}`);
  },
  clearLogs: () => request('/logs', { method: 'DELETE' }),
};
