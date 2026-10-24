const API_BASE = import.meta.env.VITE_API_URL || '/api';

async function request(endpoint, options = {}) {
  const storedKey = typeof window !== 'undefined' ? localStorage.getItem('dashboard_api_key') : '';
  const apiKey = import.meta.env.VITE_DASHBOARD_API_KEY || storedKey || '';
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { 'x-api-key': apiKey } : {}),
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || `Request failed with status ${response.status}`);
  }
  return data;
}

export const driveTransferApi = {
  getStatus: () => request('/drive-transfer/oauth/status'),
  getAuthUrl: () => request('/drive-transfer/oauth/url'),
  disconnect: () => request('/drive-transfer/oauth/disconnect', { method: 'POST', body: {} }),
  validate: (sourceUrl, destinationUrl) => request('/drive-transfer/validate', {
    method: 'POST',
    body: { sourceUrl, destinationUrl },
  }),
  preview: (sourceUrl, destinationUrl) => request('/drive-transfer/preview', {
    method: 'POST',
    body: { sourceUrl, destinationUrl },
  }),
  listJobs: () => request('/drive-transfer/jobs'),
  getJob: (jobId) => request(`/drive-transfer/jobs/${jobId}`),
  getFailures: (jobId) => request(`/drive-transfer/jobs/${jobId}/failures`),
  startCopy: (jobId, parallelCopies) => request(`/drive-transfer/jobs/${jobId}/copy`, { method: 'POST', body: { parallelCopies } }),
  setSpeed: (jobId, parallelCopies) => request(`/drive-transfer/jobs/${jobId}/speed`, { method: 'POST', body: { parallelCopies } }),
  resume: (jobId, parallelCopies) => request(`/drive-transfer/jobs/${jobId}/resume`, { method: 'POST', body: { parallelCopies } }),
  retry: (jobId, parallelCopies) => request(`/drive-transfer/jobs/${jobId}/retry`, { method: 'POST', body: { parallelCopies } }),
  cancel: (jobId) => request(`/drive-transfer/jobs/${jobId}/cancel`, { method: 'POST', body: {} }),
  queueFolders: (pairs, parallelCopies) => request('/drive-transfer/batches', {
    method: 'POST',
    body: { pairs, parallelCopies },
  }),
  cancelQueued: () => request('/drive-transfer/batches/cancel', { method: 'POST', body: {} }),
};
