import React, { useState, useEffect, useCallback } from 'react';
import {
  Film,
  Search,
  RefreshCw,
  Sparkles,
  Calendar,
  ExternalLink,
  SlidersHorizontal,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Smartphone,
  Eye,
  FolderSync,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Folder,
  Pause,
  Play,
  RotateCcw,
  HardDrive,
  ShieldAlert,
  CheckSquare,
  Square,
  Layers,
  Globe,
  Edit3,
  Save,
  CheckCircle,
  Info,
  Cpu,
} from 'lucide-react';
import { Card, CardHeader } from '../common/Card.jsx';
import { Button } from '../common/Button.jsx';
import { Badge } from '../common/Badge.jsx';
import { EmptyState } from '../common/EmptyState.jsx';
import { Modal } from '../common/Modal.jsx';
import { api } from '../../api/client.js';

export function extractDriveFolderId(input) {
  if (!input || typeof input !== 'string') return '';
  const trimmed = input.trim();
  if (!trimmed || trimmed === 'root') return 'root';
  const folderMatch = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folderMatch) return folderMatch[1];
  const idParamMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idParamMatch) return idParamMatch[1];
  const fileMatch = trimmed.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (fileMatch) return fileMatch[1];
  return trimmed.split('?')[0].split('&')[0];
}

export const VideoLibraryModule = ({
  videos,
  pagination,
  onSearch,
  onFilterChange,
  onPageChange,
  accounts,
  onQueuePost,
  onReload,
}) => {
  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [aspectFilter, setAspectFilter] = useState('');
  const [sizeFilter, setSizeFilter] = useState('');
  const [sortOption, setSortOption] = useState('modified_desc');

  // Drive Connection & Folder state
  const [driveStatus, setDriveStatus] = useState(null);
  const [folderIdInput, setFolderIdInput] = useState('');
  const [isValidatingFolder, setIsValidatingFolder] = useState(false);
  const [folderValidation, setFolderValidation] = useState(null);

  // Sync Job & Progress state
  const [syncProgress, setSyncProgress] = useState(null);
  const [isStartingSync, setIsStartingSync] = useState(false);
  const [isCancellingSync, setIsCancellingSync] = useState(false);
  const [syncConfigOpen, setSyncConfigOpen] = useState(false);
  const [syncOptions, setSyncOptions] = useState({
    maxPages: 200,
    pageSize: 100,
    recursive: true,
  });

  // AI Provider Diagnostic Status
  const [aiStatus, setAiStatus] = useState(null);
  const [isLoadingAiStatus, setIsLoadingAiStatus] = useState(false);

  // Multi-Selection State for Bulk AI
  const [selectedVideoIds, setSelectedVideoIds] = useState([]);
  const [bulkLanguage, setBulkLanguage] = useState('en');
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkProgress, setBulkProgress] = useState(null);
  const [isStartingBulk, setIsStartingBulk] = useState(false);
  const [isCancellingBulk, setIsCancellingBulk] = useState(false);

  // Single Video AI Generation & Draft Edit state
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [singleLanguage, setSingleLanguage] = useState('en');

  // Live draft form inside AI modal
  const [draftForm, setDraftForm] = useState({
    youtubeTitle: '',
    instagramCaption: '',
    hook: '',
    description: '',
    cta: '',
    hashtags: '',
    category: 'Entertainment',
    language: 'en',
    provider: 'manual',
    approvalStatus: 'draft',
  });

  // Schedule modal state (multi-account selection)
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [scheduleForm, setScheduleForm] = useState({
    selectedAccountIds: [],
    title: '',
    caption: '',
    hashtags: '',
    scheduledAt: '',
    timezone: 'UTC',
  });

  // Load Drive status, AI status, & sync progress on mount
  const checkInitialStatus = useCallback(async () => {
    try {
      const [driveRes, progressRes, aiRes, bulkRes] = await Promise.all([
        api.getDriveStatus().catch(() => ({ data: { connected: false } })),
        api.getSyncProgress().catch(() => ({ data: null })),
        api.getAiStatus().catch(() => ({ data: null })),
        api.getBulkAiProgress().catch(() => ({ data: null })),
      ]);

      setDriveStatus(driveRes.data);
      if (driveRes.data?.defaultFolderId && !folderIdInput) {
        setFolderIdInput(driveRes.data.defaultFolderId);
      }
      setSyncProgress(progressRes.data);
      setAiStatus(aiRes.data);
      setBulkProgress(bulkRes.data);
    } catch (err) {
      console.error('[VideoLibraryModule] Error checking status:', err);
    }
  }, [folderIdInput]);

  useEffect(() => {
    checkInitialStatus();
  }, [checkInitialStatus]);

  // Polling Drive sync progress when active
  useEffect(() => {
    let interval = null;
    if (syncProgress?.hasActiveJob) {
      interval = setInterval(async () => {
        try {
          const res = await api.getSyncProgress();
          setSyncProgress(res.data);
          if (res.data?.job?.status === 'completed' || res.data?.job?.status === 'failed') {
            if (onReload) onReload();
          }
        } catch {}
      }, 2500);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [syncProgress?.hasActiveJob, onReload]);

  // Polling Bulk AI progress when active
  useEffect(() => {
    let interval = null;
    if (bulkProgress?.hasActiveJob) {
      interval = setInterval(async () => {
        try {
          const res = await api.getBulkAiProgress();
          setBulkProgress(res.data);
          if (res.data?.job?.status === 'completed' || res.data?.job?.status === 'cancelled') {
            if (onReload) onReload();
          }
        } catch {}
      }, 2000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [bulkProgress?.hasActiveJob, onReload]);

  // Validate target folder
  const handleValidateFolder = async () => {
    try {
      setIsValidatingFolder(true);
      setFolderValidation(null);
      const cleanId = extractDriveFolderId(folderIdInput) || folderIdInput;
      if (cleanId && cleanId !== folderIdInput) {
        setFolderIdInput(cleanId);
      }
      const res = await api.validateFolder(cleanId);
      setFolderValidation({ success: true, ...res.data });
    } catch (err) {
      setFolderValidation({ success: false, error: err.message });
    } finally {
      setIsValidatingFolder(false);
    }
  };

  // Start or resume Drive sync job
  const handleStartSync = async (resume = false) => {
    try {
      setIsStartingSync(true);
      const cleanId = extractDriveFolderId(folderIdInput) || folderIdInput;
      if (cleanId && cleanId !== folderIdInput) {
        setFolderIdInput(cleanId);
      }
      await api.startSyncJob({
        folderId: cleanId,
        resume,
        maxPages: syncOptions.maxPages,
        pageSize: syncOptions.pageSize,
        recursive: syncOptions.recursive,
      });
      setSyncConfigOpen(false);
      await checkInitialStatus();
      if (onReload) onReload();
    } catch (err) {
      alert(`Indexing error: ${err.message}`);
    } finally {
      setIsStartingSync(false);
    }
  };

  // Cancel running Drive sync job
  const handleCancelSync = async () => {
    if (!window.confirm('Cancel the currently running Google Drive sync? You can resume it anytime.')) return;
    try {
      setIsCancellingSync(true);
      await api.cancelSyncJob();
      await checkInitialStatus();
    } catch (err) {
      alert(`Cancel error: ${err.message}`);
    } finally {
      setIsCancellingSync(false);
    }
  };

  // Filters change handler
  const handleFilterUpdate = (newFilters) => {
    const combined = {
      search: searchQuery,
      status: statusFilter,
      isVertical: aspectFilter,
      sort: sortOption,
      ...newFilters,
    };

    if (newFilters.sizeFilter !== undefined) {
      if (newFilters.sizeFilter === 'small') {
        combined.minSize = '';
        combined.maxSize = 25 * 1024 * 1024; // < 25MB
      } else if (newFilters.sizeFilter === 'medium') {
        combined.minSize = 25 * 1024 * 1024;
        combined.maxSize = 100 * 1024 * 1024; // 25-100MB
      } else if (newFilters.sizeFilter === 'large') {
        combined.minSize = 100 * 1024 * 1024; // > 100MB
        combined.maxSize = '';
      } else {
        combined.minSize = '';
        combined.maxSize = '';
      }
    }

    onFilterChange(combined);
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    onSearch(searchQuery);
  };

  // Multi-select toggle
  const toggleSelectVideo = (id) => {
    setSelectedVideoIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const toggleSelectAllPage = () => {
    const pageIds = videos.map((v) => v._id);
    const allSelected = pageIds.every((id) => selectedVideoIds.includes(id));
    if (allSelected) {
      setSelectedVideoIds((prev) => prev.filter((id) => !pageIds.includes(id)));
    } else {
      setSelectedVideoIds((prev) => Array.from(new Set([...prev, ...pageIds])));
    }
  };

  // Open single AI generator modal
  const openAiGenerator = (video) => {
    setSelectedVideo(video);
    const meta = video.aiMetadata || {};
    const lang = meta.language || 'en';
    setSingleLanguage(lang);
    setDraftForm({
      youtubeTitle: meta.youtubeTitle || meta.generatedTitle || video.cleanTitle || video.originalName,
      instagramCaption: meta.instagramCaption || meta.description || '',
      hook: meta.hook || '',
      description: meta.description || '',
      cta: meta.cta || '',
      hashtags: Array.isArray(meta.hashtags) ? meta.hashtags.join(' ') : meta.hashtags || '',
      category: meta.category || 'Entertainment',
      language: lang,
      provider: meta.provider || 'manual',
      approvalStatus: meta.approvalStatus || 'draft',
    });
    setAiModalOpen(true);
  };

  // Generate / Regenerate AI metadata for single video
  const handleGenerateAi = async () => {
    if (!selectedVideo) return;
    try {
      setIsGeneratingAi(true);
      const res = await api.generateAiMetadata({
        videoId: selectedVideo._id,
        language: singleLanguage,
      });

      const meta = res.data.metadata;
      setDraftForm({
        youtubeTitle: meta.youtubeTitle || meta.generatedTitle || '',
        instagramCaption: meta.instagramCaption || '',
        hook: meta.hook || '',
        description: meta.description || '',
        cta: meta.cta || '',
        hashtags: Array.isArray(meta.hashtags) ? meta.hashtags.join(' ') : meta.hashtags || '',
        category: meta.category || 'Entertainment',
        language: meta.language || singleLanguage,
        provider: meta.provider || 'manual',
        approvalStatus: 'draft',
      });
      setSelectedVideo((prev) => (prev ? {
        ...prev,
        aiMetadata: {
          ...(prev.aiMetadata || {}),
          ...meta,
          approvalStatus: 'draft',
        },
      } : prev));
      if (onReload) onReload();
    } catch (err) {
      alert(`AI Generation error: ${err.message}`);
    } finally {
      setIsGeneratingAi(false);
    }
  };

  // Save draft metadata edits
  const handleSaveDraft = async (markApproved = false) => {
    if (!selectedVideo) return;
    try {
      setIsSavingDraft(true);
      const targetStatus = markApproved ? 'approved' : draftForm.approvalStatus || 'draft';
      await api.updateAiDraft(selectedVideo._id, {
        youtubeTitle: draftForm.youtubeTitle,
        instagramCaption: draftForm.instagramCaption,
        hook: draftForm.hook,
        description: draftForm.description,
        cta: draftForm.cta,
        hashtags: draftForm.hashtags,
        category: draftForm.category,
        language: draftForm.language,
        approvalStatus: targetStatus,
      });

      setDraftForm((prev) => ({ ...prev, approvalStatus: targetStatus }));
      setSelectedVideo((prev) => (prev ? {
        ...prev,
        aiMetadata: {
          ...(prev.aiMetadata || {}),
          ...draftForm,
          approvalStatus: targetStatus,
        },
      } : prev));
      if (onReload) onReload();
      alert(markApproved ? 'Metadata approved for publishing!' : 'Draft metadata saved successfully.');
    } catch (err) {
      alert(`Save error: ${err.message}`);
    } finally {
      setIsSavingDraft(false);
    }
  };

  // Start Bulk AI generation
  const handleStartBulkAi = async () => {
    if (selectedVideoIds.length === 0) return;
    try {
      setIsStartingBulk(true);
      const res = await api.startBulkAi({
        videoIds: selectedVideoIds,
        language: bulkLanguage,
        concurrency: 2,
      });
      setBulkModalOpen(true);
      const progRes = await api.getBulkAiProgress(res.data.jobId);
      setBulkProgress(progRes.data);
    } catch (err) {
      alert(`Bulk AI error: ${err.message}`);
    } finally {
      setIsStartingBulk(false);
    }
  };

  // Cancel Bulk AI generation
  const handleCancelBulkAi = async () => {
    if (!window.confirm('Cancel the active Bulk AI generation batch?')) return;
    try {
      setIsCancellingBulk(true);
      await api.cancelBulkAi(bulkProgress?.job?.jobId);
      const progRes = await api.getBulkAiProgress();
      setBulkProgress(progRes.data);
      if (onReload) onReload();
    } catch (err) {
      alert(`Cancel error: ${err.message}`);
    } finally {
      setIsCancellingBulk(false);
    }
  };

  // Open schedule post modal
  const openScheduleModal = (video, prefilledAi = null) => {
    const meta = prefilledAi || video.aiMetadata || {};
    const effectiveVideo = {
      ...video,
      aiMetadata: {
        ...(video.aiMetadata || {}),
        ...meta,
      },
    };
    setSelectedVideo(effectiveVideo);

    // If metadata is draft, ask user whether to schedule directly (with auto-approval) or review first
    if (meta.approvalStatus !== 'approved') {
      const shouldProceed = window.confirm(
        `This video's metadata is currently in DRAFT status.\n\nClick OK to schedule with current title & tags (they will be marked approved for publishing), or CANCEL to review/edit the AI metadata first.`
      );
      if (!shouldProceed) {
        openAiGenerator(video);
        return;
      }
    }

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(18, 0, 0, 0);

    const activeAccounts = accounts.filter((a) => a.status === 'connected');
    const defaultIds = activeAccounts.length > 0 ? [activeAccounts[0]._id] : (accounts[0]?._id ? [accounts[0]._id] : []);

    setScheduleForm({
      selectedAccountIds: defaultIds,
      title: meta.youtubeTitle || meta.generatedTitle || meta.title || video.cleanTitle || video.originalName,
      caption: meta.instagramCaption || meta.description || '',
      hashtags: Array.isArray(meta.hashtags) ? meta.hashtags.join(' ') : meta.hashtags || '#Shorts #Reels #Viral',
      scheduledAt: tomorrow.toISOString().slice(0, 16),
      timezone: 'UTC',
      allowDuplicate: video.status === 'queued' || video.status === 'published',
    });
    setAiModalOpen(false);
    setScheduleModalOpen(true);
  };

  const handleScheduleSubmit = async (e) => {
    e.preventDefault();
    const selectedIds = scheduleForm.selectedAccountIds || [];
    if (selectedIds.length === 0) {
      alert('Please select at least one target YouTube channel or Instagram account.');
      return;
    }

    try {
      // Auto-approve metadata if it was draft so scheduler validation succeeds
      if (selectedVideo?.aiMetadata?.approvalStatus !== 'approved') {
        try {
          await api.updateAiDraft(selectedVideo._id, {
            youtubeTitle: scheduleForm.title,
            instagramCaption: scheduleForm.caption,
            hashtags: scheduleForm.hashtags,
            approvalStatus: 'approved',
          });
          setSelectedVideo((prev) => (prev ? {
            ...prev,
            aiMetadata: {
              ...(prev.aiMetadata || {}),
              approvalStatus: 'approved',
            },
          } : prev));
        } catch (approveErr) {
          console.warn('[VideoLibrary] Auto-approval notice:', approveErr);
        }
      }

      const targets = selectedIds.map((id) => {
        const acc = accounts.find((a) => a._id === id);
        return {
          accountId: id,
          platform: acc?.platform || 'youtube',
          allowDuplicate: Boolean(scheduleForm.allowDuplicate),
        };
      });

      const res = await api.scheduleMultiPlatform({
        videoId: selectedVideo._id,
        targets,
        title: scheduleForm.title,
        caption: scheduleForm.caption,
        hashtags: scheduleForm.hashtags.split(/[\s,]+/).filter(Boolean),
        scheduledAt: new Date(scheduleForm.scheduledAt).toISOString(),
        timezone: scheduleForm.timezone || 'UTC',
        allowDuplicate: Boolean(scheduleForm.allowDuplicate),
        autoApprove: true,
      });

      setScheduleModalOpen(false);
      if (onQueuePost) onQueuePost();
      if (onReload) onReload();

      const createdCount = res.data?.scheduledPosts?.length || res.data?.totalScheduled || 0;
      const errorCount = res.data?.errors?.length || 0;

      if (errorCount > 0) {
        const errDetails = res.data.errors.map((er) => `- ${er.platform}: ${er.error}`).join('\n');
        alert(
          `Scheduled for ${createdCount} account(s).\nEncountered issues on ${errorCount} account(s):\n${errDetails}`
        );
      } else {
        alert(`Successfully scheduled post for ${createdCount} social channel${createdCount === 1 ? '' : 's'}!`);
      }
    } catch (err) {
      alert(`Failed to schedule post: ${err.message}`);
    }
  };

  const formatBytes = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  const currentJob = syncProgress?.job;
  const isJobRunning = currentJob?.status === 'running';

  const currentBulkJob = bulkProgress?.job;
  const isBulkRunning = currentBulkJob?.status === 'running';
  const bulkPercent = currentBulkJob?.totalVideos
    ? Math.round((currentBulkJob.processedVideos / currentBulkJob.totalVideos) * 100)
    : 0;

  const allPageIds = videos.map((v) => v._id);
  const isAllPageSelected = videos.length > 0 && allPageIds.every((id) => selectedVideoIds.includes(id));

  return (
    <div className="space-y-6">
      {/* 1. Google Drive & AI Provider Diagnostic Status Bar */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Drive Status */}
        <Card>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div
                className={`w-9 h-9 rounded-xl flex items-center justify-center border shrink-0 ${
                  driveStatus?.connected
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                    : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                }`}
              >
                <HardDrive className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-xs font-semibold text-slate-100">Google Drive Library</h3>
                  <Badge variant={driveStatus?.connected ? 'success' : 'warning'} dot className="text-[10px]">
                    {driveStatus?.connected ? 'Drive Connected' : 'Auth Required'}
                  </Badge>
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {driveStatus?.connected
                    ? `Indexed for 20,000+ files (${driveStatus.user?.emailAddress || 'Ready'})`
                    : 'Connect Google account to discover Drive videos.'}
                </p>
              </div>
            </div>

            <Button
              variant="secondary"
              size="sm"
              icon={FolderSync}
              onClick={() => setSyncConfigOpen(!syncConfigOpen)}
              className="text-xs py-1"
            >
              Sync Config
            </Button>
          </div>
        </Card>

        {/* AI Provider Status */}
        <Card>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div
                className={`w-9 h-9 rounded-xl flex items-center justify-center border shrink-0 ${
                  aiStatus?.connected
                    ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20'
                    : 'bg-slate-800 text-slate-400 border-slate-700'
                }`}
              >
                <Cpu className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-xs font-semibold text-slate-100">AI Provider Engine</h3>
                  <Badge
                    variant={aiStatus?.connected ? 'info' : aiStatus?.provider === 'manual' ? 'neutral' : 'warning'}
                    dot
                    className="text-[10px] capitalize"
                  >
                    {aiStatus?.provider || 'Manual Fallback'}
                  </Badge>
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {aiStatus?.provider === 'gemini'
                    ? aiStatus.connected
                      ? `Google Gemini Free Tier (${aiStatus.model || 'gemini-1.5-flash'})`
                      : 'Gemini Key Not Configured (Using Deterministic Heuristic Fallback)'
                    : aiStatus?.provider === 'ollama'
                    ? aiStatus.connected
                      ? `Local Ollama (${aiStatus.targetModel})`
                      : 'Ollama Offline (Using Heuristic Fallback)'
                    : 'Deterministic Heuristic Fallback ($0 cost, 100% offline, multilingual)'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                icon={RefreshCw}
                onClick={async () => {
                  const res = await api.getAiStatus();
                  setAiStatus(res.data);
                }}
                className="text-xs py-1"
                title="Refresh Provider Status"
              />
            </div>
          </div>
        </Card>
      </div>

      {/* Expandable Drive Folder Configuration Panel */}
      {syncConfigOpen && (
        <Card className="border-indigo-500/30 bg-slate-900/90 animate-in fade-in duration-150">
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="md:col-span-2 space-y-1">
                <label className="text-slate-300 font-medium block">
                  Target Google Drive Folder ID (Containing 20k+ Videos):
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="Enter Folder ID (e.g. 1aBcDeFgHiJkLmNoP... or leave blank for root)"
                    value={folderIdInput}
                    onChange={(e) => {
                      setFolderIdInput(e.target.value);
                      setFolderValidation(null);
                    }}
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500/60 font-mono text-xs"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    isLoading={isValidatingFolder}
                    onClick={handleValidateFolder}
                    className="shrink-0"
                  >
                    Validate
                  </Button>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-slate-300 font-medium block">Scope:</label>
                <div className="flex items-center gap-3 pt-2 text-slate-400">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={syncOptions.recursive}
                      onChange={(e) => setSyncOptions({ ...syncOptions, recursive: e.target.checked })}
                      className="rounded bg-slate-950 border-slate-700 text-indigo-600 focus:ring-0"
                    />
                    Include Subfolders
                  </label>
                </div>
              </div>
            </div>

            {folderValidation && (
              <div
                className={`p-3 rounded-lg border text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
                  folderValidation.success
                    ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-300'
                    : 'bg-rose-950/20 border-rose-500/30 text-rose-300'
                }`}
              >
                <div className="flex items-start gap-2.5">
                  {folderValidation.success ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  )}
                  <div className="space-y-1.5">
                    <p className="leading-relaxed">
                      {folderValidation.success
                        ? `Access confirmed: "${folderValidation.folderName}" (ID: ${folderValidation.folderId})`
                        : folderValidation.error}
                    </p>
                    {!folderValidation.success && folderValidation.error?.includes('missing Google Drive permissions') && (
                      <div className="pt-1">
                        <Button
                          variant="secondary"
                          size="sm"
                          icon={RefreshCw}
                          onClick={async () => {
                            const res = await api.getGoogleAuthUrl();
                            if (res.authUrl) window.location.href = res.authUrl;
                          }}
                          className="text-xs text-amber-300 border-amber-500/30"
                        >
                          Reconnect Google Account with Drive Scopes
                        </Button>
                      </div>
                    )}
                    {!folderValidation.success && folderValidation.error?.includes('Google Drive API is disabled') && (
                      <div className="pt-1">
                        <Button
                          variant="secondary"
                          size="sm"
                          icon={ExternalLink}
                          onClick={() =>
                            window.open(
                              'https://console.developers.google.com/apis/api/drive.googleapis.com/overview?project=702701632845',
                              '_blank',
                              'noopener,noreferrer'
                            )
                          }
                          className="text-xs text-amber-300 border-amber-500/30"
                        >
                          Enable Google Drive API in Google Cloud Console
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
                <button onClick={() => setFolderValidation(null)} className="text-slate-400 hover:text-slate-200 self-start sm:self-center">
                  &times;
                </button>
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              <span className="text-[11px] text-slate-500">
                Streams metadata using cursor pagination. Database upsert avoids duplicates.
              </span>

              <div className="flex items-center gap-2">
                {currentJob && (currentJob.status === 'paused' || currentJob.status === 'cancelled') && (
                  <Button
                    variant="outline"
                    size="sm"
                    icon={Play}
                    isLoading={isStartingSync}
                    onClick={() => handleStartSync(true)}
                  >
                    Resume Sync
                  </Button>
                )}
                <Button
                  variant="primary"
                  size="sm"
                  icon={FolderSync}
                  isLoading={isStartingSync}
                  onClick={() => handleStartSync(false)}
                >
                  Start Fresh Indexing
                </Button>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* 2. Drive Sync Progress Banner (Visible during sync) */}
      {currentJob && isJobRunning && (
        <Card className="border-indigo-500/30 bg-slate-900/90">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-indigo-400 animate-ping" />
                <h4 className="text-xs font-semibold text-slate-200">
                  Indexing Drive: {currentJob.folderName || 'Google Drive'}
                </h4>
                <Badge variant="info" className="text-[10px] capitalize">
                  {currentJob.status}
                </Badge>
              </div>
              <Button
                variant="danger"
                size="sm"
                icon={Pause}
                isLoading={isCancellingSync}
                onClick={handleCancelSync}
                className="text-xs py-1"
              >
                Pause / Cancel
              </Button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-950/60 p-3 rounded-lg border border-slate-800 text-[11px]">
              <div>
                <span className="text-slate-500 block">Total Scanned:</span>
                <span className="font-semibold text-slate-200 text-sm">{currentJob.totalScanned || 0}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Newly Indexed:</span>
                <span className="font-semibold text-emerald-400 text-sm">{currentJob.totalIndexed || 0}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Updated / Existing:</span>
                <span className="font-semibold text-indigo-400 text-sm">{currentJob.totalUpdated || 0}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Pages Scanned:</span>
                <span className="font-semibold text-slate-300 text-sm">{currentJob.pagesProcessed || 0}</span>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* 3. Search and Multi-Filter Controls */}
      <Card>
        <div className="space-y-3">
          <form onSubmit={handleSearchSubmit} className="relative">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search 20,000+ videos by filename, clean title, or keywords..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-10 pr-24 py-2.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500/60"
            />
            <button
              type="submit"
              className="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-colors"
            >
              Search
            </button>
          </form>

          <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                handleFilterUpdate({ status: e.target.value });
              }}
              className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-300 focus:outline-none"
            >
              <option value="">All Statuses</option>
              <option value="discovered">Discovered</option>
              <option value="metadata_ready">Metadata Ready</option>
              <option value="queued">Queued</option>
              <option value="published">Published</option>
            </select>

            <select
              value={aspectFilter}
              onChange={(e) => {
                setAspectFilter(e.target.value);
                handleFilterUpdate({ isVertical: e.target.value });
              }}
              className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-300 focus:outline-none"
            >
              <option value="">All Orientations</option>
              <option value="true">Vertical 9:16 (Shorts/Reels)</option>
              <option value="false">Horizontal / Landscape</option>
            </select>

            <select
              value={sizeFilter}
              onChange={(e) => {
                setSizeFilter(e.target.value);
                handleFilterUpdate({ sizeFilter: e.target.value });
              }}
              className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-300 focus:outline-none"
            >
              <option value="">All File Sizes</option>
              <option value="small">&lt; 25 MB</option>
              <option value="medium">25 MB - 100 MB</option>
              <option value="large">&gt; 100 MB</option>
            </select>

            <select
              value={sortOption}
              onChange={(e) => {
                setSortOption(e.target.value);
                handleFilterUpdate({ sort: e.target.value });
              }}
              className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-300 focus:outline-none"
            >
              <option value="modified_desc">Modified (Newest First)</option>
              <option value="modified_asc">Modified (Oldest First)</option>
              <option value="created_desc">Created Date (Newest)</option>
              <option value="name_asc">Filename (A-Z)</option>
              <option value="name_desc">Filename (Z-A)</option>
              <option value="size_desc">File Size (Largest First)</option>
            </select>

            {(searchQuery || statusFilter || aspectFilter || sizeFilter) && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  setStatusFilter('');
                  setAspectFilter('');
                  setSizeFilter('');
                  setSortOption('modified_desc');
                  onFilterChange({ search: '', status: '', isVertical: '', sort: 'modified_desc' });
                }}
                className="text-indigo-400 hover:text-indigo-300 text-xs px-2 py-1"
              >
                Reset Filters
              </button>
            )}
          </div>
        </div>
      </Card>

      {/* 4. Floating / Sticky Bulk Action Bar when items selected */}
      {selectedVideoIds.length > 0 && (
        <div className="bg-indigo-950/80 border border-indigo-500/40 p-3 rounded-xl flex flex-wrap items-center justify-between gap-3 shadow-lg backdrop-blur-sm animate-in fade-in duration-200">
          <div className="flex items-center gap-3 text-xs">
            <span className="font-semibold text-indigo-200 flex items-center gap-1.5">
              <CheckSquare className="w-4 h-4 text-indigo-400" />
              {selectedVideoIds.length} video{selectedVideoIds.length > 1 ? 's' : ''} selected
            </span>
            <span className="text-slate-500">|</span>
            <div className="flex items-center gap-1.5 text-slate-300">
              <Globe className="w-3.5 h-3.5 text-slate-400" />
              <span>Language:</span>
              <select
                value={bulkLanguage}
                onChange={(e) => setBulkLanguage(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-200 focus:outline-none text-xs"
              >
                <option value="en">English</option>
                <option value="hi">हिंदी (Hindi)</option>
                <option value="mr">मराठी (Marathi)</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedVideoIds([])}
              className="text-xs text-slate-400 hover:text-slate-200"
            >
              Clear
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={Sparkles}
              isLoading={isStartingBulk}
              onClick={handleStartBulkAi}
              className="text-xs bg-indigo-600 hover:bg-indigo-500"
            >
              Generate AI Metadata ({selectedVideoIds.length})
            </Button>
          </div>
        </div>
      )}

      {/* 5. Videos Grid / Catalog */}
      <Card>
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-4 border-b border-slate-800/80 mb-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-100">Drive Video Catalog</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Showing page {pagination?.page || 1} of {pagination?.totalPages || 1} (
              {pagination?.total?.toLocaleString() || 0} total indexed videos)
            </p>
          </div>

          {videos.length > 0 && (
            <div className="flex items-center gap-2 text-xs">
              <button
                onClick={toggleSelectAllPage}
                className="flex items-center gap-1.5 text-slate-300 hover:text-white px-2 py-1 rounded bg-slate-900 border border-slate-800 transition-colors"
              >
                {isAllPageSelected ? (
                  <CheckSquare className="w-3.5 h-3.5 text-indigo-400" />
                ) : (
                  <Square className="w-3.5 h-3.5 text-slate-500" />
                )}
                <span>{isAllPageSelected ? 'Deselect Page' : 'Select All on Page'}</span>
              </button>

              {currentBulkJob && (
                <Button
                  variant="secondary"
                  size="sm"
                  icon={Layers}
                  onClick={() => setBulkModalOpen(true)}
                  className="text-xs py-1"
                >
                  View Batch Progress
                </Button>
              )}
            </div>
          )}
        </div>

        {videos.length === 0 ? (
          <EmptyState
            icon={Film}
            title="No videos match current criteria"
            description="Your video catalog is currently empty or no videos matched the active search filters. Start an indexing job to catalog files from your Google Drive."
            actionLabel={driveStatus?.connected ? 'Configure Drive Folder' : 'Connect Google Drive'}
            onAction={() => setSyncConfigOpen(true)}
            actionIcon={FolderSync}
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {videos.map((video) => {
              const isSelected = selectedVideoIds.includes(video._id);
              const aiMeta = video.aiMetadata;
              const hasAi = Boolean(aiMeta?.youtubeTitle || aiMeta?.generatedTitle);
              const approvalStatus = aiMeta?.approvalStatus || (hasAi ? 'draft' : null);

              return (
                <div
                  key={video._id}
                  className={`bg-slate-950/50 border rounded-xl overflow-hidden flex flex-col justify-between transition-all ${
                    isSelected
                      ? 'border-indigo-500/80 ring-1 ring-indigo-500/50'
                      : 'border-slate-800/80 hover:border-slate-700'
                  }`}
                >
                  {/* Video Info Header */}
                  <div className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2 flex-1 min-w-0">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectVideo(video._id)}
                          className="mt-0.5 rounded bg-slate-900 border-slate-700 text-indigo-600 focus:ring-0 cursor-pointer"
                        />
                        <span
                          className="text-xs font-semibold text-slate-100 line-clamp-2"
                          title={video.cleanTitle || video.originalName}
                        >
                          {video.cleanTitle || video.originalName}
                        </span>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {approvalStatus && (
                          <Badge
                            variant={approvalStatus === 'approved' ? 'success' : 'warning'}
                            className="text-[9px] uppercase tracking-wider font-semibold"
                          >
                            {approvalStatus}
                          </Badge>
                        )}
                        <Badge
                          variant={
                            video.status === 'published'
                              ? 'success'
                              : video.status === 'queued'
                              ? 'warning'
                              : video.status === 'metadata_ready'
                              ? 'info'
                              : 'neutral'
                          }
                          className="text-[10px] capitalize"
                        >
                          {video.status.replace('_', ' ')}
                        </Badge>
                      </div>
                    </div>

                    <p className="text-[10px] text-slate-500 font-mono truncate" title={video.originalName}>
                      {video.originalName}
                    </p>

                    {/* Badges / Specs */}
                    <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-slate-400">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-900 border border-slate-800">
                        <Clock className="w-3 h-3 text-slate-500" />
                        {video.duration ? `${video.duration}s` : 'Short'}
                      </span>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-900 border border-slate-800">
                        <Smartphone className="w-3 h-3 text-slate-500" />
                        {video.resolution?.isVertical ? 'Vertical 9:16' : 'Landscape'}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800">
                        {formatBytes(video.fileSize)}
                      </span>
                      {aiMeta?.language && (
                        <span className="px-1.5 py-0.5 rounded bg-indigo-950/60 border border-indigo-500/30 text-indigo-300 font-semibold uppercase text-[9px]">
                          {aiMeta.language}
                        </span>
                      )}
                    </div>

                    {/* AI Metadata snippet preview if available */}
                    {hasAi && (
                      <div className="p-2.5 rounded-lg bg-indigo-950/20 border border-indigo-500/20 space-y-1">
                        <div className="flex items-center justify-between text-[10px]">
                          <span className="flex items-center gap-1 font-semibold text-indigo-400">
                            <Sparkles className="w-3 h-3" />
                            YouTube Shorts Title
                          </span>
                          <span className="text-slate-500 text-[9px] capitalize">{aiMeta.provider}</span>
                        </div>
                        <p className="text-[11px] text-slate-300 font-medium line-clamp-1">
                          {aiMeta.youtubeTitle || aiMeta.generatedTitle}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Card Actions */}
                  <div className="px-4 py-3 bg-slate-900/60 border-t border-slate-800/60 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      {video.driveWebViewLink && (
                        <a
                          href={video.driveWebViewLink}
                          target="_blank"
                          rel="noreferrer"
                          className="p-1.5 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800"
                          title="View in Google Drive"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={hasAi ? Edit3 : Sparkles}
                        onClick={() => openAiGenerator(video)}
                        className={`text-xs ${
                          hasAi
                            ? 'text-indigo-300 hover:text-indigo-200'
                            : 'text-indigo-400 hover:text-indigo-300 font-medium'
                        }`}
                      >
                        {hasAi ? 'Edit AI Metadata' : 'Generate AI'}
                      </Button>
                    </div>

                    <Button
                      variant={video.status === 'queued' ? 'outline' : 'secondary'}
                      size="sm"
                      icon={Calendar}
                      onClick={() => openScheduleModal(video)}
                      className={`text-xs ${video.status === 'queued' ? 'text-amber-400 border-amber-500/30 hover:bg-amber-950/20' : ''}`}
                    >
                      {video.status === 'queued' ? 'Reschedule' : 'Schedule'}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination Bar */}
        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between pt-5 border-t border-slate-800/80 mt-5 text-xs text-slate-400">
            <span>
              Page {pagination.page} of {pagination.totalPages} ({pagination.total?.toLocaleString()} items)
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                icon={ChevronLeft}
                disabled={pagination.page <= 1}
                onClick={() => onPageChange(pagination.page - 1)}
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                size="sm"
                icon={ChevronRight}
                disabled={pagination.page >= pagination.totalPages}
                onClick={() => onPageChange(pagination.page + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* 6. Single Video AI Metadata Generator & Draft Editor Modal */}
      <Modal
        isOpen={aiModalOpen}
        onClose={() => setAiModalOpen(false)}
        title="AI Content Metadata Pipeline (Draft & Review)"
      >
        <div className="space-y-4 text-xs max-h-[75vh] overflow-y-auto pr-1">
          {/* Target Video & Provider Info */}
          <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <span className="text-slate-500 block text-[11px]">Selected Video:</span>
                <span className="font-semibold text-slate-100 text-sm">
                  {selectedVideo?.cleanTitle || selectedVideo?.originalName}
                </span>
              </div>
              <Badge
                variant={draftForm.approvalStatus === 'approved' ? 'success' : 'warning'}
                className="text-[10px] uppercase font-semibold"
              >
                {draftForm.approvalStatus}
              </Badge>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-900 text-[11px] text-slate-400">
              <div className="flex items-center gap-2">
                <span>Language:</span>
                <select
                  value={singleLanguage}
                  onChange={(e) => setSingleLanguage(e.target.value)}
                  className="bg-slate-900 border border-slate-700 rounded px-2 py-0.5 text-slate-200 text-xs focus:outline-none"
                >
                  <option value="en">English</option>
                  <option value="hi">हिंदी (Hindi)</option>
                  <option value="mr">मराठी (Marathi)</option>
                </select>
              </div>

              <span className="text-slate-500">
                Provider: <span className="text-slate-300 font-medium capitalize">{draftForm.provider}</span>
              </span>
            </div>
          </div>

          {/* Context Disclaimer Alert */}
          <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800 text-[11px] text-slate-400 flex items-start gap-2">
            <Info className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
            <span>
              Metadata is contextually derived from filename, folder topic, notes, and duration. No visual or audio
              deep analysis is simulated. All generated content is saved as <strong>Draft</strong> for manual review
              before publishing.
            </span>
          </div>

          {/* Generate / Regenerate Action */}
          <Button
            variant="primary"
            size="md"
            icon={Sparkles}
            isLoading={isGeneratingAi}
            onClick={handleGenerateAi}
            className="w-full bg-indigo-600 hover:bg-indigo-500"
          >
            {isGeneratingAi
              ? 'Generating structured metadata...'
              : draftForm.youtubeTitle
              ? 'Regenerate Content with AI'
              : 'Generate AI Titles & Captions'}
          </Button>

          {/* Editable Metadata Form */}
          {draftForm.youtubeTitle && (
            <div className="space-y-3 pt-2">
              {/* YouTube Shorts Title */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-semibold text-slate-200 block">
                    YouTube Shorts Title (Platform Limit: 100 Chars):
                  </label>
                  <span
                    className={`text-[10px] ${
                      draftForm.youtubeTitle.length > 95
                        ? 'text-rose-400 font-bold'
                        : draftForm.youtubeTitle.length > 80
                        ? 'text-amber-400'
                        : 'text-slate-400'
                    }`}
                  >
                    {draftForm.youtubeTitle.length} / 100
                  </span>
                </div>
                <input
                  type="text"
                  value={draftForm.youtubeTitle}
                  maxLength={100}
                  onChange={(e) => setDraftForm({ ...draftForm, youtubeTitle: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-100 font-medium focus:outline-none focus:border-indigo-500/60 text-xs"
                />
              </div>

              {/* Attention Hook */}
              <div>
                <label className="font-semibold text-slate-200 block mb-1">Attention Hook (First 3s):</label>
                <input
                  type="text"
                  value={draftForm.hook}
                  onChange={(e) => setDraftForm({ ...draftForm, hook: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-300 focus:outline-none focus:border-indigo-500/60 text-xs"
                />
              </div>

              {/* Instagram Reel Caption */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-semibold text-slate-200 block">
                    Instagram Reel Caption (Platform Limit: 2200 Chars):
                  </label>
                  <span className="text-[10px] text-slate-400">{draftForm.instagramCaption.length} / 2200</span>
                </div>
                <textarea
                  rows={4}
                  value={draftForm.instagramCaption}
                  maxLength={2200}
                  onChange={(e) => setDraftForm({ ...draftForm, instagramCaption: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-300 focus:outline-none focus:border-indigo-500/60 text-xs font-sans"
                />
              </div>

              {/* CTA & Category Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-200 block mb-1">Suggested Call to Action:</label>
                  <input
                    type="text"
                    value={draftForm.cta}
                    onChange={(e) => setDraftForm({ ...draftForm, cta: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-300 focus:outline-none text-xs"
                  />
                </div>

                <div>
                  <label className="font-semibold text-slate-200 block mb-1">Content Category:</label>
                  <select
                    value={draftForm.category}
                    onChange={(e) => setDraftForm({ ...draftForm, category: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-300 focus:outline-none text-xs"
                  >
                    <option value="Entertainment">Entertainment</option>
                    <option value="Education">Education</option>
                    <option value="Tech">Technology & AI</option>
                    <option value="Lifestyle">Lifestyle & Travel</option>
                    <option value="Business">Business & Finance</option>
                    <option value="Motivation">Motivation & Self-Help</option>
                  </select>
                </div>
              </div>

              {/* Hashtags */}
              <div>
                <label className="font-semibold text-slate-200 block mb-1">
                  Hashtags (Space separated, 3-15 clean tags):
                </label>
                <input
                  type="text"
                  value={draftForm.hashtags}
                  onChange={(e) => setDraftForm({ ...draftForm, hashtags: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-300 focus:outline-none text-xs"
                />
                <div className="flex flex-wrap gap-1 mt-2">
                  {draftForm.hashtags
                    .split(/[\s,]+/)
                    .filter(Boolean)
                    .map((tag, i) => (
                      <Badge key={i} variant="info" className="text-[10px]">
                        {tag.startsWith('#') ? tag : `#${tag}`}
                      </Badge>
                    ))}
                </div>
              </div>

              {/* Action Buttons: Save Draft, Approve, Schedule */}
              <div className="pt-4 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={Save}
                    isLoading={isSavingDraft}
                    onClick={() => handleSaveDraft(false)}
                  >
                    Save Draft
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    icon={CheckCircle}
                    isLoading={isSavingDraft}
                    onClick={() => handleSaveDraft(true)}
                    className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-950/20"
                  >
                    Approve for Publishing
                  </Button>
                </div>

                <Button
                  variant="primary"
                  size="sm"
                  icon={Calendar}
                  onClick={() => openScheduleModal(selectedVideo, draftForm)}
                >
                  Schedule Post
                </Button>
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* 7. Bulk AI Generation Progress Modal */}
      <Modal
        isOpen={bulkModalOpen}
        onClose={() => setBulkModalOpen(false)}
        title="Bulk AI Video Generation Engine"
      >
        <div className="space-y-4 text-xs">
          {currentBulkJob ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className={`w-2.5 h-2.5 rounded-full ${
                      isBulkRunning ? 'bg-indigo-400 animate-ping' : 'bg-slate-400'
                    }`}
                  />
                  <span className="font-semibold text-slate-200">
                    Batch Job Status: <span className="capitalize">{currentBulkJob.status}</span>
                  </span>
                </div>
                <Badge
                  variant={
                    isBulkRunning
                      ? 'info'
                      : currentBulkJob.status === 'completed'
                      ? 'success'
                      : currentBulkJob.status === 'failed'
                      ? 'error'
                      : 'neutral'
                  }
                  className="capitalize text-[10px]"
                >
                  {currentBulkJob.status}
                </Badge>
              </div>

              {/* Animated Progress Bar */}
              <div className="space-y-1">
                <div className="flex justify-between text-[11px] text-slate-400">
                  <span>Progress: {bulkPercent}%</span>
                  <span>
                    {currentBulkJob.processedVideos} of {currentBulkJob.totalVideos} videos
                  </span>
                </div>
                <div className="w-full bg-slate-900 rounded-full h-2.5 overflow-hidden border border-slate-800">
                  <div
                    className="bg-indigo-500 h-2.5 rounded-full transition-all duration-300"
                    style={{ width: `${bulkPercent}%` }}
                  />
                </div>
              </div>

              {/* Metrics Counters */}
              <div className="grid grid-cols-3 gap-3 bg-slate-950/60 p-3 rounded-lg border border-slate-800 text-center">
                <div>
                  <span className="text-slate-500 block text-[10px]">Total</span>
                  <span className="font-semibold text-slate-200 text-sm">{currentBulkJob.totalVideos}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">Successful</span>
                  <span className="font-semibold text-emerald-400 text-sm">
                    {currentBulkJob.successfulVideos}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">Failed</span>
                  <span className="font-semibold text-rose-400 text-sm">{currentBulkJob.failedVideos}</span>
                </div>
              </div>

              {/* Active Item */}
              {isBulkRunning && currentBulkJob.currentVideoTitle && (
                <div className="p-2.5 rounded bg-slate-950 border border-slate-800/80 text-[11px] text-slate-400 flex items-center gap-2">
                  <RefreshCw className="w-3.5 h-3.5 text-indigo-400 animate-spin shrink-0" />
                  <span className="truncate">Processing: {currentBulkJob.currentVideoTitle}</span>
                </div>
              )}

              {/* Errors list if any */}
              {currentBulkJob.errors?.length > 0 && (
                <div className="space-y-1.5 pt-2">
                  <span className="font-semibold text-rose-400 block text-[11px]">Encountered Errors:</span>
                  <div className="max-h-28 overflow-y-auto space-y-1">
                    {currentBulkJob.errors.map((err, i) => (
                      <div
                        key={i}
                        className="p-2 rounded bg-rose-950/20 border border-rose-500/20 text-[10px] text-rose-300 flex items-start gap-1.5"
                      >
                        <AlertTriangle className="w-3 h-3 text-rose-400 shrink-0 mt-0.5" />
                        <div>
                          <strong className="block text-rose-200">{err.title}</strong>
                          <span>{err.error}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Modal Actions */}
              <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
                {isBulkRunning ? (
                  <Button
                    variant="danger"
                    size="sm"
                    icon={Pause}
                    isLoading={isCancellingBulk}
                    onClick={handleCancelBulkAi}
                  >
                    Cancel Batch
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => {
                      setBulkModalOpen(false);
                      setSelectedVideoIds([]);
                      if (onReload) onReload();
                    }}
                  >
                    Close & Review Results
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="text-center py-6 text-slate-400">
              <p>No active bulk AI generation job running.</p>
              <Button
                variant="secondary"
                size="sm"
                className="mt-3"
                onClick={() => setBulkModalOpen(false)}
              >
                Close
              </Button>
            </div>
          )}
        </div>
      </Modal>

      {/* 8. Schedule Post Modal */}
      <Modal
        isOpen={scheduleModalOpen}
        onClose={() => setScheduleModalOpen(false)}
        title="Schedule Post for Publishing"
      >
        <form onSubmit={handleScheduleSubmit} className="space-y-4 text-xs">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-slate-300 font-medium">Select Target Channels:</label>
              <div className="flex items-center gap-1 text-[10px]">
                <button
                  type="button"
                  onClick={() => {
                    const validIds = accounts.filter((a) => a.status === 'connected').map((a) => a._id);
                    setScheduleForm({ ...scheduleForm, selectedAccountIds: validIds });
                  }}
                  className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800"
                >
                  Select All
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const ytIds = accounts.filter((a) => a.platform === 'youtube' && a.status === 'connected').map((a) => a._id);
                    setScheduleForm({ ...scheduleForm, selectedAccountIds: ytIds });
                  }}
                  className="px-1.5 py-0.5 rounded bg-red-950/60 border border-red-800/40 text-red-300 hover:bg-red-900/60"
                >
                  All YouTube
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const igIds = accounts.filter((a) => a.platform === 'instagram' && a.status === 'connected').map((a) => a._id);
                    setScheduleForm({ ...scheduleForm, selectedAccountIds: igIds });
                  }}
                  className="px-1.5 py-0.5 rounded bg-pink-950/60 border border-pink-800/40 text-pink-300 hover:bg-pink-900/60"
                >
                  All Instagram
                </button>
                <button
                  type="button"
                  onClick={() => setScheduleForm({ ...scheduleForm, selectedAccountIds: [] })}
                  className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400 hover:bg-slate-800"
                >
                  Clear
                </button>
              </div>
            </div>

            {accounts.length === 0 ? (
              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs">
                No connected social channels found. Please connect your YouTube channel or Instagram account in the Connected Accounts tab first.
              </div>
            ) : (
              <div className="space-y-1.5 max-h-48 overflow-y-auto p-1 bg-slate-950 rounded-lg border border-slate-800/80">
                {accounts.map((acc) => {
                  const isYt = acc.platform === 'youtube';
                  const isSelected = (scheduleForm.selectedAccountIds || []).includes(acc._id);
                  const isDisconnected = acc.status !== 'connected';

                  return (
                    <label
                      key={acc._id}
                      className={`flex items-center justify-between p-2 rounded-lg border cursor-pointer transition-all ${
                        isDisconnected
                          ? 'opacity-50 cursor-not-allowed bg-slate-900/30 border-slate-900'
                          : isSelected
                          ? 'bg-indigo-950/40 border-indigo-500/40'
                          : 'bg-slate-900/50 border-slate-800/60 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <input
                          type="checkbox"
                          disabled={isDisconnected}
                          checked={isSelected}
                          onChange={(e) => {
                            const cur = scheduleForm.selectedAccountIds || [];
                            const next = e.target.checked ? [...cur, acc._id] : cur.filter((id) => id !== acc._id);
                            setScheduleForm({ ...scheduleForm, selectedAccountIds: next });
                          }}
                          className="rounded border-slate-800 text-indigo-600 focus:ring-0"
                        />

                        {acc.profilePictureUrl ? (
                          <img
                            src={acc.profilePictureUrl}
                            alt=""
                            className="w-6 h-6 rounded-full border border-slate-700 object-cover shrink-0"
                          />
                        ) : (
                          <div
                            className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-[10px] ${
                              isYt ? 'bg-red-500/20 text-red-400' : 'bg-pink-500/20 text-pink-400'
                            }`}
                          >
                            {isYt ? 'YT' : 'IG'}
                          </div>
                        )}

                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-slate-200 truncate text-xs">{acc.accountName}</span>
                            <span
                              className={`text-[9px] px-1 py-0.2 rounded font-medium ${
                                isYt ? 'text-red-400 bg-red-500/10' : 'text-pink-400 bg-pink-500/10'
                              }`}
                            >
                              {isYt ? 'YouTube' : 'Instagram'}
                            </span>
                          </div>
                          <span className="text-[10px] text-slate-500 block truncate">
                            {acc.username ? `@${acc.username}` : `ID: ${acc.accountId}`}
                          </span>
                        </div>
                      </div>

                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded font-mono shrink-0 ${
                          acc.status === 'connected'
                            ? 'text-emerald-400 bg-emerald-500/10'
                            : 'text-amber-400 bg-amber-500/10'
                        }`}
                      >
                        {acc.status}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}

            <div className="mt-1 flex items-center justify-between text-[11px] text-slate-400">
              <span>
                Selected: <strong className="text-slate-200 font-mono">{(scheduleForm.selectedAccountIds || []).length}</strong> channel(s)
              </span>
              {(scheduleForm.selectedAccountIds || []).length > 0 && (
                <span className="text-emerald-400 text-[10px]">
                  ✓ Separate publishing job queued per channel
                </span>
              )}
            </div>
          </div>

          <div>
            <label className="block text-slate-300 font-medium mb-1">Post Title:</label>
            <input
              type="text"
              value={scheduleForm.title}
              onChange={(e) => setScheduleForm({ ...scheduleForm, title: e.target.value })}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 focus:outline-none"
              required
            />
          </div>

          <div>
            <label className="block text-slate-300 font-medium mb-1">Caption / Description:</label>
            <textarea
              rows={3}
              value={scheduleForm.caption}
              onChange={(e) => setScheduleForm({ ...scheduleForm, caption: e.target.value })}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-slate-300 font-medium mb-1">Hashtags (space separated):</label>
            <input
              type="text"
              value={scheduleForm.hashtags}
              onChange={(e) => setScheduleForm({ ...scheduleForm, hashtags: e.target.value })}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-300 font-medium mb-1">Scheduled Date & Time:</label>
              <input
                type="datetime-local"
                value={scheduleForm.scheduledAt}
                onChange={(e) => setScheduleForm({ ...scheduleForm, scheduledAt: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 focus:outline-none"
                required
              />
            </div>

            <div>
              <label className="block text-slate-300 font-medium mb-1">Target Timezone:</label>
              <select
                value={scheduleForm.timezone || 'UTC'}
                onChange={(e) => setScheduleForm({ ...scheduleForm, timezone: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 focus:outline-none"
              >
                <option value="UTC">UTC (Coordinated Universal Time)</option>
                <option value="Asia/Kolkata">Asia/Kolkata (IST +5:30)</option>
                <option value="America/New_York">America/New_York (EST / EDT)</option>
                <option value="America/Los_Angeles">America/Los_Angeles (PST / PDT)</option>
                <option value="Europe/London">Europe/London (GMT / BST)</option>
              </select>
            </div>
          </div>

          {/* Allow Duplicate / Reschedule Option */}
          <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-800">
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={scheduleForm.allowDuplicate || false}
                onChange={(e) => setScheduleForm({ ...scheduleForm, allowDuplicate: e.target.checked })}
                className="mt-0.5 rounded border-slate-700 text-indigo-600 focus:ring-0"
              />
              <div className="text-[11px] text-slate-300">
                <span className="font-semibold text-slate-200 block">Allow duplicate schedule / reschedule</span>
                <span className="text-slate-400 block text-[10px] leading-relaxed mt-0.5">
                  Check this if this video is already scheduled or queued on a selected channel and you want to schedule another post for it.
                </span>
              </div>
            </label>
          </div>

          <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setScheduleModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" type="submit">
              Confirm & Queue
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
