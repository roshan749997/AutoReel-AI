import React, { useState, useEffect, useCallback } from 'react';
import { Sidebar } from './components/layout/Sidebar.jsx';
import { Header } from './components/layout/Header.jsx';
import { StatusBanner } from './components/layout/StatusBanner.jsx';
import { OverviewModule } from './components/modules/OverviewModule.jsx';
import { SocialAccountsModule } from './components/modules/SocialAccountsModule.jsx';
import { VideoLibraryModule } from './components/modules/VideoLibraryModule.jsx';
import { PublishedVideosModule } from './components/modules/PublishedVideosModule.jsx';
import { PublishingQueueModule } from './components/modules/PublishingQueueModule.jsx';
import { CalendarModule } from './components/modules/CalendarModule.jsx';
import { AutomationModule } from './components/modules/AutomationModule.jsx';
import { LogsModule } from './components/modules/LogsModule.jsx';
import { api } from './api/client.js';
import { AlertTriangle, Loader2 } from 'lucide-react';

const getInitialTab = () => {
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    if (params.has('error') || params.has('connected') || params.has('error_code')) {
      return 'accounts';
    }
    if (window.location.pathname.includes('/accounts')) {
      return 'accounts';
    }
  }
  return 'overview';
};

export default function App() {
  const [activeTab, setActiveTab] = useState(getInitialTab);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isLoadingInitial, setIsLoadingInitial] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [backendError, setBackendError] = useState(null);

  // Data states
  const [healthData, setHealthData] = useState(null);
  const [integrations, setIntegrations] = useState(null);
  const [checklist, setChecklist] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [videos, setVideos] = useState([]);
  const [videoPagination, setVideoPagination] = useState(null);
  const [posts, setPosts] = useState([]);
  const [logs, setLogs] = useState([]);
  const [n8nStatus, setN8nStatus] = useState(null);
  const [isSyncingDrive, setIsSyncingDrive] = useState(false);

  // Filters
  const [videoFilters, setVideoFilters] = useState({ page: 1, limit: 12, search: '', status: '' });
  const [logFilters, setLogFilters] = useState({ page: 1, limit: 30, module: '', level: '' });

  const loadData = useCallback(async (showRefreshingSpinner = false) => {
    if (showRefreshingSpinner) setIsRefreshing(true);
    setBackendError(null);

    try {
      // Primary system & integration statuses
      const [healthRes, integrationsRes, checklistRes] = await Promise.allSettled([
        api.getHealth(),
        api.getIntegrations(),
        api.getSetupChecklist(),
      ]);

      if (healthRes.status === 'fulfilled') setHealthData(healthRes.value);
      if (integrationsRes.status === 'fulfilled') setIntegrations(integrationsRes.value.integrations);
      if (checklistRes.status === 'fulfilled') setChecklist(checklistRes.value);

      // Connected social accounts
      const accountsRes = await api.getAccounts().catch(() => ({ data: [] }));
      setAccounts(accountsRes.data || []);

      // Scheduled posts
      const postsRes = await api.getPosts().catch(() => ({ data: [] }));
      setPosts(postsRes.data || []);

      // Videos
      const videosRes = await api.getVideos(videoFilters).catch(() => ({ data: [], pagination: {} }));
      setVideos(videosRes.data || []);
      setVideoPagination(videosRes.pagination || {});

      // Logs
      const logsRes = await api.getLogs(logFilters).catch(() => ({ data: [] }));
      setLogs(logsRes.data || []);

      // n8n
      const n8nRes = await api.getWorkflowStatus().catch(() => ({ data: { isReachable: false } }));
      setN8nStatus(n8nRes.data);
    } catch (err) {
      console.error('[Dashboard Error] Failed to load data:', err);
      setBackendError(
        'Backend API is currently unreachable. Make sure your Express server is running on port 5000 (`npm run dev:backend`).'
      );
    } finally {
      setIsLoadingInitial(false);
      setIsRefreshing(false);
    }
  }, [videoFilters, logFilters]);

  useEffect(() => {
    loadData();
    const interval = setInterval(() => loadData(false), 30000); // 30s background sync
    return () => clearInterval(interval);
  }, [loadData]);

  const handleSyncDrive = async () => {
    try {
      setIsSyncingDrive(true);
      const res = await api.syncVideos();
      alert(`Sync completed! ${res.data.totalIndexed} new videos indexed, ${res.data.totalUpdated} updated.`);
      loadData();
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

  const stats = {
    indexedVideos: checklist?.stats?.indexedVideos ?? videos.length,
    connectedAccounts: accounts.length,
    queuedPosts: posts.filter((p) => p.status === 'queued').length,
    publishedPosts: posts.filter((p) => p.status === 'published').length,
  };

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 overflow-hidden">
      {/* Sidebar Navigation */}
      <Sidebar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        isMobileOpen={isMobileOpen}
        onCloseMobile={() => setIsMobileOpen(false)}
        systemStatus={systemStatus}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 lg:pl-64 overflow-hidden">
        {/* Header */}
        <Header
          activeTab={activeTab}
          onOpenMobile={() => setIsMobileOpen(true)}
          onRefresh={() => loadData(true)}
          isRefreshing={isRefreshing}
          systemStatus={systemStatus}
        />

        {/* Setup Banner */}
        <StatusBanner checklist={checklist} onNavigate={setActiveTab} />

        {/* Backend Connection Error Alert */}
        {backendError && (
          <div className="bg-rose-950/40 border-b border-rose-500/30 px-6 py-2.5 flex items-center justify-between text-xs text-rose-300">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{backendError}</span>
            </div>
            <button
              onClick={() => loadData(true)}
              className="px-2.5 py-1 rounded bg-rose-600/30 hover:bg-rose-600/50 text-rose-200 font-medium transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {/* Module Content */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          {isLoadingInitial ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-3">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
              <p className="text-xs">Initializing dashboard and verifying official APIs...</p>
            </div>
          ) : (
            <div className="max-w-7xl mx-auto">
              {activeTab === 'overview' && (
                <OverviewModule
                  integrations={integrations}
                  checklist={checklist}
                  stats={stats}
                  upcomingPosts={posts.filter((p) => p.status === 'queued')}
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

              {activeTab === 'library' && (
                <VideoLibraryModule
                  videos={videos}
                  pagination={videoPagination}
                  onSearch={(q) => setVideoFilters((prev) => ({ ...prev, search: q, page: 1 }))}
                  onFilterChange={(f) => setVideoFilters((prev) => ({ ...prev, ...f, page: 1 }))}
                  onPageChange={(p) => setVideoFilters((prev) => ({ ...prev, page: p }))}
                  onSyncDrive={handleSyncDrive}
                  isSyncing={isSyncingDrive}
                  accounts={accounts}
                  onQueuePost={loadData}
                  onReload={loadData}
                />
              )}

              {activeTab === 'published' && (
                <PublishedVideosModule
                  posts={posts}
                  accounts={accounts}
                  onReload={loadData}
                  onNavigate={setActiveTab}
                />
              )}

              {activeTab === 'queue' && (
                <PublishingQueueModule
                  posts={posts}
                  accounts={accounts}
                  onReload={loadData}
                  onNavigate={setActiveTab}
                />
              )}

              {activeTab === 'calendar' && (
                <CalendarModule
                  posts={posts}
                  onNavigate={setActiveTab}
                />
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
                  onReload={loadData}
                  pagination={{ page: logFilters.page, limit: logFilters.limit }}
                  onFilterChange={(f) => setLogFilters((prev) => ({ ...prev, ...f, page: 1 }))}
                />
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
