import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Sidebar } from './components/layout/Sidebar.jsx';
import { Header } from './components/layout/Header.jsx';
import { StatusBanner } from './components/layout/StatusBanner.jsx';
import { OverviewModule } from './components/modules/OverviewModule.jsx';
import { SocialAccountsModule } from './components/modules/SocialAccountsModule.jsx';
import { ChannelsModule } from './components/modules/ChannelsModule.jsx';
import { VideoLibraryModule } from './components/modules/VideoLibraryModule.jsx';
import { PublishedVideosModule } from './components/modules/PublishedVideosModule.jsx';
import { PublishingQueueModule } from './components/modules/PublishingQueueModule.jsx';
import { CalendarModule } from './components/modules/CalendarModule.jsx';
import { AutomationModule } from './components/modules/AutomationModule.jsx';
import { LogsModule } from './components/modules/LogsModule.jsx';
import { DriveTransferModule } from './components/modules/DriveTransferModule.jsx';
import { api } from './api/client.js';
import { AlertTriangle, Loader2 } from 'lucide-react';

const BOOT_CACHE_KEY = 'autoreel_boot_cache_v1';
const BOOT_CACHE_TTL_MS = 60_000;

const getInitialTab = () => {
  if (typeof window !== 'undefined') {
    if (window.location.pathname.startsWith('/api/accounts/google/callback')) {
      const backendBase = (import.meta.env.VITE_API_URL || 'https://autoreel-ai-fs3l.onrender.com/api').replace(/\/api\/?$/, '');
      window.location.replace(`${backendBase}/api/accounts/google/callback${window.location.search}`);
      return 'accounts';
    }

    const params = new URLSearchParams(window.location.search);
    if (params.get('tab') === 'drive-transfer') return 'drive-transfer';
    if (params.get('tab') === 'accounts' || params.has('error') || params.has('connected') || params.has('error_code')) {
      return 'accounts';
    }
    if (window.location.pathname.includes('/accounts')) return 'accounts';
  }
  return 'overview';
};

const emptyPostCounts = {
  total: 0,
  upcoming: 0,
  queued: 0,
  published: 0,
  failed: 0,
};

const readBootCache = () => {
  try {
    const raw = sessionStorage.getItem(BOOT_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.savedAt || Date.now() - parsed.savedAt > BOOT_CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
};

const writeBootCache = (payload) => {
  try {
    sessionStorage.setItem(BOOT_CACHE_KEY, JSON.stringify({ ...payload, savedAt: Date.now() }));
  } catch {
    // ignore quota / private mode
  }
};

export default function App() {
  const cachedBoot = typeof window !== 'undefined' ? readBootCache() : null;
  const [activeTab, setActiveTab] = useState(getInitialTab);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  // If we have a fresh cache, skip the full-page spinner immediately
  const [isLoadingInitial, setIsLoadingInitial] = useState(!cachedBoot);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [backendError, setBackendError] = useState(null);

  const [healthData, setHealthData] = useState(cachedBoot?.healthData || null);
  const [integrations, setIntegrations] = useState(null);
  const [checklist, setChecklist] = useState(null);
  const [accounts, setAccounts] = useState(cachedBoot?.accounts || []);
  const [videos, setVideos] = useState([]);
  const [videoPagination, setVideoPagination] = useState(null);
  const [upcomingPosts, setUpcomingPosts] = useState([]);
  const [postCounts, setPostCounts] = useState(cachedBoot?.postCounts || emptyPostCounts);
  const [logs, setLogs] = useState([]);
  const [n8nStatus, setN8nStatus] = useState(null);
  const [isSyncingDrive, setIsSyncingDrive] = useState(false);

  const [videoFilters, setVideoFilters] = useState({ page: 1, limit: 12, search: '', status: '' });
  const [logFilters, setLogFilters] = useState({ page: 1, limit: 30, module: '', level: '' });

  const videosLoadedFor = useRef('');
  const logsLoadedFor = useRef('');
  const upcomingLoaded = useRef(false);

  const loadDeferredMeta = useCallback(async () => {
    const [integrationsSettled, checklistSettled, n8nSettled] = await Promise.allSettled([
      api.getIntegrations(),
      api.getSetupChecklist(),
      api.getWorkflowStatus(),
    ]);

    if (integrationsSettled.status === 'fulfilled') setIntegrations(integrationsSettled.value?.integrations);
    if (checklistSettled.status === 'fulfilled') setChecklist(checklistSettled.value);
    if (n8nSettled.status === 'fulfilled') setN8nStatus(n8nSettled.value?.data || { isReachable: false });
  }, []);

  // Fast bootstrap: only health + accounts + post stats (needed for shell/sidebar)
  const loadBootstrap = useCallback(async (showRefreshingSpinner = false) => {
    if (showRefreshingSpinner) setIsRefreshing(true);
    setBackendError(null);

    try {
      const [healthSettled, accountsSettled, postStatsSettled] = await Promise.allSettled([
        api.getHealth({ timeoutMs: 8000 }),
        api.getAccounts({}, { timeoutMs: 10000 }),
        api.getPostStats({}, { timeoutMs: 10000 }),
      ]);

      let nextHealth = null;
      let nextAccounts = [];
      let nextCounts = emptyPostCounts;

      if (healthSettled.status === 'fulfilled') {
        nextHealth = healthSettled.value;
        setHealthData(nextHealth);
      }
      if (accountsSettled.status === 'fulfilled') {
        nextAccounts = accountsSettled.value?.data || [];
        setAccounts(nextAccounts);
      }
      if (postStatsSettled.status === 'fulfilled') {
        nextCounts = postStatsSettled.value?.data || emptyPostCounts;
        setPostCounts(nextCounts);
      }

      writeBootCache({
        healthData: nextHealth,
        accounts: nextAccounts,
        postCounts: nextCounts,
      });

      if (healthSettled.status === 'rejected') {
        setBackendError(
          'Backend API is currently unreachable. If this is Render free tier, wait for cold start (~30–60s) then Retry.'
        );
      }
    } catch (err) {
      console.error('[Dashboard Error] Bootstrap failed:', err);
      setBackendError(
        'Backend API is currently unreachable. If this is Render free tier, wait for cold start (~30–60s) then Retry.'
      );
    } finally {
      setIsLoadingInitial(false);
      setIsRefreshing(false);
    }
  }, []);

  const loadVideos = useCallback(async () => {
    const key = JSON.stringify(videoFilters);
    try {
      const res = await api.getVideos(videoFilters, { timeoutMs: 15000 });
      setVideos(res?.data || []);
      setVideoPagination(res?.pagination || {});
      videosLoadedFor.current = key;
    } catch (err) {
      console.warn('[Dashboard] Videos load failed:', err.message);
    }
  }, [videoFilters]);

  const loadLogs = useCallback(async () => {
    const key = JSON.stringify(logFilters);
    try {
      const res = await api.getLogs(logFilters, { timeoutMs: 12000 });
      setLogs(res?.data || []);
      logsLoadedFor.current = key;
    } catch (err) {
      console.warn('[Dashboard] Logs load failed:', err.message);
    }
  }, [logFilters]);

  const loadUpcoming = useCallback(async () => {
    try {
      const res = await api.getPosts(
        { status: 'queued,scheduled,retrying', limit: 8, page: 1, light: true },
        { timeoutMs: 12000 }
      );
      setUpcomingPosts(res?.data || []);
      upcomingLoaded.current = true;
    } catch (err) {
      console.warn('[Dashboard] Upcoming posts load failed:', err.message);
    }
  }, []);

  const loadData = useCallback(async (showRefreshingSpinner = false) => {
    await loadBootstrap(showRefreshingSpinner);
    loadDeferredMeta();
    // Reset lazy flags so active tab reloads fresh data
    videosLoadedFor.current = '';
    logsLoadedFor.current = '';
    upcomingLoaded.current = false;
  }, [loadBootstrap, loadDeferredMeta]);

  // Initial boot
  useEffect(() => {
    loadBootstrap();
    // Deferred heavy probes — never block first paint
    const deferredTimer = setTimeout(() => loadDeferredMeta(), 500);
    const safetyTimer = setTimeout(() => setIsLoadingInitial(false), 2000);

    const interval = setInterval(() => loadBootstrap(false), 90000);
    const deferredInterval = setInterval(() => loadDeferredMeta(), 180000);

    return () => {
      clearTimeout(deferredTimer);
      clearTimeout(safetyTimer);
      clearInterval(interval);
      clearInterval(deferredInterval);
    };
  }, [loadBootstrap, loadDeferredMeta]);

  // Tab-scoped lazy loads
  useEffect(() => {
    if (activeTab === 'overview' && !upcomingLoaded.current) {
      loadUpcoming();
    }
    if (activeTab === 'library') {
      const key = JSON.stringify(videoFilters);
      if (videosLoadedFor.current !== key) loadVideos();
    }
    if (activeTab === 'logs') {
      const key = JSON.stringify(logFilters);
      if (logsLoadedFor.current !== key) loadLogs();
    }
  }, [activeTab, videoFilters, logFilters, loadUpcoming, loadVideos, loadLogs]);

  const handleSyncDrive = async () => {
    try {
      setIsSyncingDrive(true);
      const res = await api.syncVideos();
      alert(`Sync completed! ${res.data.totalIndexed} new videos indexed, ${res.data.totalUpdated} updated.`);
      videosLoadedFor.current = '';
      await loadVideos();
    } catch (err) {
      alert(`Drive sync failed: ${err.message}. Please configure GOOGLE_CLIENT_ID and connect via Social Accounts.`);
    } finally {
      setIsSyncingDrive(false);
    }
  };

  const systemStatus = {
    healthy: healthData?.status === 'healthy',
    dbConnected: healthData?.database?.connected,
    aiProvider: integrations?.ai?.provider || 'Gemini',
  };

  const failedPostsCount = postCounts.failed || 0;

  const stats = {
    indexedVideos: checklist?.stats?.indexedVideos ?? videoPagination?.total ?? videos.length,
    connectedAccounts: accounts.length,
    queuedPosts: (postCounts.queued || 0) + (postCounts.scheduled || 0),
    publishedPosts: postCounts.published || 0,
    failedPosts: failedPostsCount,
  };

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900 overflow-hidden">
      <Sidebar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        isMobileOpen={isMobileOpen}
        onCloseMobile={() => setIsMobileOpen(false)}
        systemStatus={systemStatus}
        failedPostsCount={failedPostsCount}
      />

      <div className="flex-1 flex flex-col min-w-0 lg:pl-64 overflow-hidden">
        <Header
          activeTab={activeTab}
          onOpenMobile={() => setIsMobileOpen(true)}
          onRefresh={() => loadData(true)}
          isRefreshing={isRefreshing}
          systemStatus={systemStatus}
        />

        <StatusBanner checklist={checklist} onNavigate={setActiveTab} />

        {backendError && (
          <div className="bg-rose-50/40 border-b border-rose-500/30 px-6 py-2.5 flex items-center justify-between text-xs text-rose-700">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{backendError}</span>
            </div>
            <button
              onClick={() => loadData(true)}
              className="px-2.5 py-1 rounded bg-rose-600/30 hover:bg-rose-600/50 text-rose-800 font-medium transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          {isLoadingInitial ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-3">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
              <p className="text-xs">Loading dashboard shell...</p>
            </div>
          ) : (
            <div className="max-w-7xl mx-auto">
              {activeTab === 'overview' && (
                <OverviewModule
                  integrations={integrations}
                  checklist={checklist}
                  stats={stats}
                  upcomingPosts={upcomingPosts}
                  onNavigate={setActiveTab}
                  onSyncDrive={handleSyncDrive}
                />
              )}

              {activeTab === 'accounts' && (
                <SocialAccountsModule
                  accounts={accounts}
                  onReload={loadData}
                  isLoading={isRefreshing}
                />
              )}

              {activeTab === 'channels' && (
                <ChannelsModule
                  accounts={accounts}
                  onNavigate={setActiveTab}
                />
              )}

              {activeTab === 'library' && (
                <VideoLibraryModule
                  videos={videos}
                  pagination={videoPagination}
                  currentFilters={videoFilters}
                  onSearch={(q) => setVideoFilters((prev) => ({ ...prev, search: q, page: 1 }))}
                  onFilterChange={(f) => setVideoFilters((prev) => ({ ...prev, ...f, page: 1 }))}
                  onPageChange={(p) => setVideoFilters((prev) => ({ ...prev, page: p }))}
                  onSyncDrive={handleSyncDrive}
                  isSyncing={isSyncingDrive}
                  accounts={accounts}
                  onQueuePost={loadData}
                  onReload={loadData}
                  onNavigate={setActiveTab}
                />
              )}

              {activeTab === 'published' && (
                <PublishedVideosModule
                  accounts={accounts}
                  onReload={loadData}
                  onNavigate={setActiveTab}
                />
              )}

              {activeTab === 'queue' && (
                <PublishingQueueModule
                  accounts={accounts}
                  onReload={loadData}
                  onNavigate={setActiveTab}
                />
              )}

              {activeTab === 'calendar' && (
                <CalendarModule onNavigate={setActiveTab} />
              )}

              {activeTab === 'automation' && (
                <AutomationModule
                  n8nStatus={n8nStatus}
                  onReload={loadData}
                />
              )}

              {activeTab === 'logs' && (
                <LogsModule
                  logs={logs}
                  onReload={() => {
                    logsLoadedFor.current = '';
                    loadLogs();
                  }}
                  pagination={{ page: logFilters.page, limit: logFilters.limit }}
                  onFilterChange={(f) => setLogFilters((prev) => ({ ...prev, ...f, page: 1 }))}
                />
              )}

              {activeTab === 'drive-transfer' && <DriveTransferModule />}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
