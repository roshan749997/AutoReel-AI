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
  Folders,
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
  Plus,
  ArrowUpDown,
  Filter,
  Monitor,
  Tag,
  PlayCircle,
  Trash2,
  Loader2,
  Youtube,
  Instagram,
  Zap,
  ChevronDown,
  ChevronUp,
  Send,
  X,
  Minus,
} from 'lucide-react';
import { Card, CardHeader } from '../common/Card.jsx';
import { Button } from '../common/Button.jsx';
import { Badge } from '../common/Badge.jsx';
import { EmptyState } from '../common/EmptyState.jsx';
import { Modal } from '../common/Modal.jsx';
import { api } from '../../api/client.js';
import { driveTransferApi } from '../../api/driveTransferClient.js';
import { FolderTree, FolderBoxes, videoFolderLabel } from './FolderTree.jsx';
import { ChannelAvatar } from '../common/ChannelAvatar.jsx';
import { accountIdsOfPair, findPairForFolder } from '../../utils/channelPairs.js';

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

export function formatDuration(seconds) {
  if (!seconds || isNaN(seconds) || seconds <= 0) return '0:00';
  const sec = Math.round(seconds);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export const VideoThumbnail = ({ video, onPreview }) => {
  const [imgError, setImgError] = useState(false);
  const proxyUrl = `/api/videos/${video._id}/thumbnail`;
  const [src, setSrc] = useState(proxyUrl);

  return (
    <div
      onClick={onPreview}
      className="group/thumb relative w-16 h-20 sm:w-20 sm:h-24 rounded-lg overflow-hidden bg-white border border-slate-200 shrink-0 flex items-center justify-center cursor-pointer hover:border-indigo-500/60 transition-colors shadow-xs select-none"
      title="Click to preview video"
    >
      {!imgError ? (
        <img
          src={src}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => {
            if (src !== video.thumbnailUrl && video.thumbnailUrl) {
              setSrc(video.thumbnailUrl);
            } else {
              setImgError(true);
            }
          }}
          className="w-full h-full object-cover group-hover/thumb:scale-105 transition-transform duration-200"
          loading="lazy"
        />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-white to-indigo-50/40 text-slate-500 group-hover/thumb:text-indigo-400 transition-colors">
          <Film className="w-6 h-6" />
        </div>
      )}

      {/* Hover Play Button Overlay */}
      <div className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover/thumb:opacity-100 flex items-center justify-center transition-opacity">
        <PlayCircle className="w-7 h-7 text-white drop-shadow-md" />
      </div>

      {/* Overlaid Duration Badge */}
      <span className="absolute bottom-1 right-1 bg-slate-900/80 backdrop-blur-xs text-white text-[9px] font-mono px-1 py-0.5 rounded leading-none">
        {formatDuration(video.duration)}
      </span>

      {/* 9:16 Vertical Pill Overlay */}
      {video.resolution?.isVertical && (
        <span className="absolute top-1 left-1 bg-indigo-600 text-white text-[8px] font-bold px-1 py-0.5 rounded leading-none shadow-xs">
          9:16
        </span>
      )}
    </div>
  );
};

export const VideoLibraryModule = ({
  videos,
  pagination,
  onSearch,
  onFilterChange,
  onPageChange,
  accounts = [],
  onQueuePost,
  onReload,
  onNavigate,
}) => {
  // Search, Filter & Understandable Sorting state
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [aspectFilter, setAspectFilter] = useState('');
  const [sizeFilter, setSizeFilter] = useState('');
  const [approvalFilter, setApprovalFilter] = useState('');
  const [selectedFolder, setSelectedFolder] = useState(() => {
    if (typeof sessionStorage === 'undefined') return '';
    const focus = sessionStorage.getItem('library-folder-focus') || '';
    if (focus) sessionStorage.removeItem('library-folder-focus');
    return focus;
  });
  const [showAllVideos, setShowAllVideos] = useState(false);
  const [sortOption, setSortOption] = useState('modified_desc');

  // Google Drive Accounts & Folders state
  const [selectedDriveAccount, setSelectedDriveAccount] = useState('all');
  const [driveLink, setDriveLink] = useState(null);
  const [foldersList, setFoldersList] = useState([]);
  const [folderTree, setFolderTree] = useState([]);
  const [channelPairs, setChannelPairs] = useState([]);
  const [isConnectingGoogle, setIsConnectingGoogle] = useState(false);
  const [isRemovingDriveId, setIsRemovingDriveId] = useState(null);

  // Quick Stats State (for interactive 1-click status ribbon)
  const [libraryStats, setLibraryStats] = useState({
    total: 0,
    approved: 0,
    draft: 0,
    needsAi: 0,
    vertical: 0,
    queued: 0,
    published: 0,
  });

  // In-app video preview player modal state
  const [previewVideo, setPreviewVideo] = useState(null);

  // Drive Connection & Folder sync state
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
  const [isSelectingAll, setIsSelectingAll] = useState(false);
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

  // AI Provider Configuration (Google Gemini Key)
  const [showAiConfig, setShowAiConfig] = useState(false);
  const [geminiKeyInput, setGeminiKeyInput] = useState('');
  const [isConfiguringAi, setIsConfiguringAi] = useState(false);
  const [aiConfigMsg, setAiConfigMsg] = useState(null);

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

  // Batch Multi-Video Scheduling State
  const [batchScheduleModalOpen, setBatchScheduleModalOpen] = useState(false);
  const [isSubmittingBatchSchedule, setIsSubmittingBatchSchedule] = useState(false);
  const [batchScheduleItems, setBatchScheduleItems] = useState([]);
  const [globalBatchConfig, setGlobalBatchConfig] = useState({
    selectedAccountIds: [],
    startDateTime: '',
    intervalMinutes: 120, // 2 hours default gap
    timezone: 'Asia/Kolkata',
    allowDuplicate: false,
  });

  // Load Drive status, AI status, folders & sync progress on mount
  const checkInitialStatus = useCallback(async (targetAccountId = null) => {
    try {
      const accId = targetAccountId !== null ? targetAccountId : selectedDriveAccount;
      const accountFilter = accId && accId !== 'all' ? { accountId: accId } : {};

      const [driveRes, progressRes, aiRes, bulkRes, foldersRes, treeRes, statsRes, driveLinkRes, pairsRes] = await Promise.all([
        api.getDriveStatus().catch(() => ({ data: { connected: false } })),
        api.getSyncProgress().catch(() => ({ data: null })),
        api.getAiStatus().catch(() => ({ data: null })),
        api.getBulkAiProgress().catch(() => ({ data: null })),
        api.getVideoFoldersSummary(accountFilter).catch(() => ({ data: [] })),
        api.getVideoFolderTree().catch(() => ({ data: [] })),
        api.getVideoStats(accountFilter).catch(() => ({ data: null })),
        driveTransferApi.getStatus().catch(() => ({ data: { connected: false } })),
        api.getChannelPairs().catch(() => ({ data: [] })),
      ]);

      setDriveStatus(driveRes.data);
      setDriveLink(driveLinkRes.data);
      if (driveRes.data?.defaultFolderId && !folderIdInput) {
        setFolderIdInput(driveRes.data.defaultFolderId);
      }
      setSyncProgress(progressRes.data);
      setAiStatus(aiRes.data);
      setBulkProgress(bulkRes.data);
      if (foldersRes.data && Array.isArray(foldersRes.data)) {
        setFoldersList(foldersRes.data);
      }
      if (treeRes?.data && Array.isArray(treeRes.data)) {
        setFolderTree(treeRes.data);
      }
      if (statsRes?.data) {
        setLibraryStats(statsRes.data);
      }
      if (Array.isArray(pairsRes?.data)) {
        setChannelPairs(pairsRes.data);
      }
    } catch (err) {
      console.error('[VideoLibraryModule] Error checking status:', err);
    }
  }, [folderIdInput, selectedDriveAccount]);

  useEffect(() => {
    checkInitialStatus();
  }, [checkInitialStatus]);

  const linkedAccountIdsFor = (video) => {
    const pair = findPairForFolder(
      channelPairs,
      video?.folderId || selectedFolder,
      video?.folderPathIds
    );
    const linked = accountIdsOfPair(pair).filter((id) =>
      accounts.some((account) => String(account._id) === String(id) && account.status === 'connected')
    );
    if (linked.length > 0) return linked;
    const connected = accounts.filter((account) => account.status === 'connected');
    return connected.length <= 2 ? connected.map((account) => account._id) : [];
  };

  useEffect(() => {
    if (!selectedFolder) return undefined;
    onFilterChange({ folderId: selectedFolder });
    return undefined;
  }, []);

  // Connect another Google Drive account handler
  const handleConnectGoogleDrive = async () => {
    try {
      setIsConnectingGoogle(true);
      const res = await driveTransferApi.getAuthUrl();
      const authUrl = res?.data?.authUrl;
      if (authUrl) {
        window.location.href = authUrl;
      } else {
        alert('Could not retrieve the Drive authorization URL. Connect Drive from the Drive Transfer page.');
      }
    } catch (err) {
      alert(`Failed to start Google Drive connection: ${err.message}`);
    } finally {
      setIsConnectingGoogle(false);
    }
  };

  const handleDisconnectDrive = async () => {
    const confirmed = window.confirm('Disconnect Google Drive? YouTube and Instagram accounts stay connected. Videos already in the library stay.');
    if (!confirmed) return;
    try {
      setIsRemovingDriveId('drive');
      await driveTransferApi.disconnect();
      setDriveLink((current) => ({ ...(current || {}), connected: false, email: null }));
      await checkInitialStatus('all');
    } catch (err) {
      alert(`Failed to disconnect Google Drive: ${err.message}`);
    } finally {
      setIsRemovingDriveId(null);
    }
  };

  // Polling Drive sync progress when active
  useEffect(() => {
    let interval = null;
    if (syncProgress?.hasActiveJob) {
      interval = setInterval(async () => {
        try {
          const res = await api.getSyncProgress();
          setSyncProgress(res.data);
          const treeRes = await api.getVideoFolderTree().catch(() => null);
          if (treeRes?.data && Array.isArray(treeRes.data)) setFolderTree(treeRes.data);
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
      approvalStatus: approvalFilter,
      folderId: selectedFolder,
      sort: sortOption,
      accountId: selectedDriveAccount === 'all' ? '' : selectedDriveAccount,
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

    if (newFilters.accountId !== undefined) {
      checkInitialStatus(newFilters.accountId);
    }

    onFilterChange(combined);
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    onSearch(searchQuery);
  };

  // Multi-select toggle
  const toggleSelectVideo = (id) => {
    const videoId = String(id);
    setSelectedVideoIds((prev) =>
      prev.includes(videoId) ? prev.filter((item) => item !== videoId) : [...prev, videoId]
    );
  };

  const catalogQueryParams = () => {
    const params = {
      search: searchQuery || '',
      status: statusFilter || '',
      isVertical: aspectFilter || '',
      approvalStatus: approvalFilter || '',
      folderId: selectedFolder || '',
      sort: sortOption || '',
      accountId: selectedDriveAccount === 'all' ? '' : selectedDriveAccount,
    };
    if (sizeFilter === 'small') {
      params.maxSize = 25 * 1024 * 1024;
    } else if (sizeFilter === 'medium') {
      params.minSize = 25 * 1024 * 1024;
      params.maxSize = 100 * 1024 * 1024;
    } else if (sizeFilter === 'large') {
      params.minSize = 100 * 1024 * 1024;
    }
    return params;
  };

  const selectAllMatching = async () => {
    const total = pagination?.total || 0;
    if (total > 0 && selectedVideoIds.length >= total) {
      setSelectedVideoIds([]);
      return;
    }
    if (total > 500) {
      const label = selectedFolder ? 'in this folder' : 'matching the current filters';
      if (!window.confirm(`Select all ${total.toLocaleString()} videos ${label}?`)) return;
    }
    try {
      setIsSelectingAll(true);
      const res = await api.getVideoIds(catalogQueryParams());
      const ids = (res.data || []).map(String);
      if (ids.length === 0) {
        setSelectedVideoIds(videos.map((v) => String(v._id)));
      } else {
        setSelectedVideoIds(ids);
      }
    } catch (err) {
      setSelectedVideoIds(videos.map((v) => String(v._id)));
      alert(`Could not select all videos: ${err.message}`);
    } finally {
      setIsSelectingAll(false);
    }
  };

  // Toggle selection for all videos on the current page
  const toggleSelectAllPage = () => {
    if (!videos || videos.length === 0) return;
    const pageIds = videos.map((v) => String(v._id));
    const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedVideoIds.includes(id));

    if (allPageSelected) {
      setSelectedVideoIds((prev) => prev.filter((id) => !pageIds.includes(id)));
    } else {
      setSelectedVideoIds((prev) => Array.from(new Set([...prev, ...pageIds])));
    }
  };

  // Save Google Gemini API Key and test connection
  const handleSaveGeminiKey = async (e) => {
    if (e) e.preventDefault();
    if (!geminiKeyInput.trim()) {
      alert('Please enter your Google Gemini API key');
      return;
    }
    try {
      setIsConfiguringAi(true);
      setAiConfigMsg(null);
      const res = await api.configureAi({ geminiApiKey: geminiKeyInput.trim() });
      if (res.data?.connected) {
        setAiConfigMsg({ type: 'success', text: 'Google Gemini AI connected successfully! 🚀' });
        setDraftForm((prev) => ({ ...prev, provider: 'gemini' }));
        handleGenerateAi();
      } else {
        setAiConfigMsg({ type: 'error', text: res.data?.error || res.data?.message || 'Connection failed' });
      }
    } catch (err) {
      setAiConfigMsg({ type: 'error', text: err.message });
    } finally {
      setIsConfiguringAi(false);
    }
  };

  // Open single AI generator modal
  const openAiGenerator = (video) => {
    setSelectedVideo(video);
    const meta = video.aiMetadata || {};
    const lang = meta.language || 'en';
    setSingleLanguage(lang);
    setAiConfigMsg(null);

    const isCamera = (name) => {
      if (!name) return true;
      const stripped = String(name).replace(/\.[^/.]+$/, '').trim();
      return /^(vid|img|mov|pxl|dcim|clip|rec|cam|video)[_\s-]?\d+/i.test(stripped) || /\b\d{5,}\b/.test(stripped);
    };

    let initialTitle = meta.youtubeTitle || meta.generatedTitle || '';
    if (initialTitle && /shdushj|Wait For The #Shorts/i.test(initialTitle)) {
      initialTitle = '';
    }
    if (!initialTitle && !isCamera(video.cleanTitle || video.originalName)) {
      const candidate = (video.cleanTitle || video.originalName || '')
        .replace(/\bshdushj[a-z0-9]*\b/gi, '')
        .replace(/\b(reel bundle|reel bundel|digiproducthub)\b/gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
      initialTitle = candidate || '';
    }

    setDraftForm({
      youtubeTitle: initialTitle,
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

  // Start Bulk AI generation or regeneration
  const handleStartBulkAi = async (forceRegenerate = false) => {
    if (selectedVideoIds.length === 0) return;

    if (forceRegenerate) {
      const langLabel =
        bulkLanguage === 'mr' ? 'मराठी (Marathi)' : bulkLanguage === 'hi' ? 'हिंदी (Hindi)' : 'English';
      const confirmMsg = `Regenerate AI content for ${selectedVideoIds.length} video(s) in ${langLabel}?\n\nThis will re-run the AI pipeline and create fresh titles, hooks, descriptions, and hashtags for all selected videos.`;
      if (!window.confirm(confirmMsg)) return;
    }

    try {
      setIsStartingBulk(true);
      const res = await api.startBulkAi({
        videoIds: selectedVideoIds,
        language: bulkLanguage,
        concurrency: 2,
        retryFailedOnly: false,
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

    const defaultIds = linkedAccountIdsFor(effectiveVideo);

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

  // Open Multi-Video Batch Schedule Modal
  const openBatchScheduleModal = async () => {
    if (selectedVideoIds.length === 0) return;
    let selectedObjs = videos.filter((v) => selectedVideoIds.includes(String(v._id)) || selectedVideoIds.includes(v._id));
    if (selectedObjs.length < selectedVideoIds.length) {
      try {
        const res = await api.getVideosByIds(selectedVideoIds);
        selectedObjs = res.data || [];
      } catch (err) {
        alert(`Could not load selected videos: ${err.message}`);
        return;
      }
    }
    if (selectedObjs.length === 0) return;

    const defaultAccountIds = linkedAccountIdsFor(selectedObjs[0]);

    // Default start time: today + 1 hour rounded to nearest 15 mins
    const start = new Date(Date.now() + 60 * 60 * 1000);
    start.setMinutes(Math.ceil(start.getMinutes() / 15) * 15, 0, 0);
    const startLocal = new Date(start.getTime() - start.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

    const defaultIntervalMinutes = 120; // 2 hours default gap

    const items = selectedObjs.map((video, idx) => {
      const itemDate = new Date(start.getTime() + idx * defaultIntervalMinutes * 60 * 1000);
      const itemLocal = new Date(itemDate.getTime() - itemDate.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      const aiMeta = video.aiMetadata || {};

      return {
        videoId: video._id,
        video,
        title: aiMeta.youtubeTitle || aiMeta.generatedTitle || video.cleanTitle || video.originalName,
        caption: aiMeta.instagramCaption || video.cleanTitle || '',
        hashtags: Array.isArray(aiMeta.hashtags)
          ? aiMeta.hashtags.join(' ')
          : aiMeta.hashtags || '#Shorts #Reels #Viral',
        selectedAccountIds: [...defaultAccountIds],
        scheduledAt: itemLocal,
        allowDuplicate: false,
        isExpanded: false,
        isCustomizingChannels: false,
      };
    });

    setGlobalBatchConfig({
      selectedAccountIds: [...defaultAccountIds],
      startDateTime: startLocal,
      intervalMinutes: defaultIntervalMinutes,
      timezone: 'Asia/Kolkata',
      allowDuplicate: false,
    });

    setBatchScheduleItems(items);
    setBatchScheduleModalOpen(true);
  };

  const applyAutoStagger = (customStart = null, customInterval = null) => {
    const startTimeStr = customStart || globalBatchConfig.startDateTime;
    const intervalMins = customInterval !== null ? customInterval : parseInt(globalBatchConfig.intervalMinutes, 10);
    if (!startTimeStr) return;

    const startDate = new Date(startTimeStr);
    setBatchScheduleItems((prev) =>
      prev.map((item, idx) => {
        const itemDate = new Date(startDate.getTime() + idx * intervalMins * 60 * 1000);
        const itemLocal = new Date(itemDate.getTime() - itemDate.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
        return {
          ...item,
          scheduledAt: itemLocal,
        };
      })
    );
  };

  const applyGlobalAccountsToAll = (accountIds) => {
    setGlobalBatchConfig((prev) => ({ ...prev, selectedAccountIds: accountIds }));
    setBatchScheduleItems((prev) =>
      prev.map((item) => ({
        ...item,
        selectedAccountIds: [...accountIds],
      }))
    );
  };

  const toggleGlobalAccount = (accountId) => {
    const current = globalBatchConfig.selectedAccountIds || [];
    const next = current.includes(accountId)
      ? current.filter((id) => id !== accountId)
      : [...current, accountId];
    applyGlobalAccountsToAll(next);
  };

  const toggleItemAccount = (index, accountId) => {
    setBatchScheduleItems((prev) => {
      const next = [...prev];
      const cur = next[index].selectedAccountIds || [];
      next[index] = {
        ...next[index],
        selectedAccountIds: cur.includes(accountId)
          ? cur.filter((id) => id !== accountId)
          : [...cur, accountId],
      };
      return next;
    });
  };

  const updateBatchItem = (index, field, value) => {
    setBatchScheduleItems((prev) => {
      const next = [...prev];
      next[index] = {
        ...next[index],
        [field]: value,
      };
      return next;
    });
  };

  const removeBatchItem = (index) => {
    setBatchScheduleItems((prev) => prev.filter((_, i) => i !== index));
  };

  const selectAllApproved = async () => {
    try {
      setIsSelectingAll(true);
      const res = await api.getVideoIds({ ...catalogQueryParams(), approvalStatus: 'approved' });
      const approvedIds = (res.data || []).map(String);
      if (approvedIds.length === 0) {
        alert('No approved videos found. Generate AI metadata or approve drafts first.');
        return;
      }
      setSelectedVideoIds(approvedIds);
    } catch (err) {
      alert(`Could not select approved videos: ${err.message}`);
    } finally {
      setIsSelectingAll(false);
    }
  };

  const handleSubmitBatchSchedule = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (batchScheduleItems.length === 0) {
      alert('Please select at least one video to schedule.');
      return;
    }

    for (let i = 0; i < batchScheduleItems.length; i++) {
      const item = batchScheduleItems[i];
      if (!item.selectedAccountIds || item.selectedAccountIds.length === 0) {
        alert(
          `Video #${i + 1} ("${item.title.slice(0, 30)}...") has no target channels selected.\n` +
          `Please select at least one channel for this video or remove it from the batch.`
        );
        return;
      }
      if (!item.scheduledAt) {
        alert(`Video #${i + 1} ("${item.title.slice(0, 30)}...") has no scheduled time set.`);
        return;
      }
    }

    const payload = batchScheduleItems.map((item) => {
      const targets = item.selectedAccountIds.map((accId) => {
        const acc = accounts.find((a) => a._id === accId);
        return {
          accountId: accId,
          platform: acc?.platform || 'youtube',
          allowDuplicate: Boolean(item.allowDuplicate || globalBatchConfig.allowDuplicate),
        };
      });

      return {
        videoId: item.videoId,
        targets,
        title: item.title,
        caption: item.caption,
        hashtags: Array.isArray(item.hashtags)
          ? item.hashtags
          : String(item.hashtags || '').split(/[\s,]+/).filter(Boolean),
        scheduledAt: new Date(item.scheduledAt).toISOString(),
        timezone: globalBatchConfig.timezone || 'UTC',
        allowDuplicate: Boolean(item.allowDuplicate || globalBatchConfig.allowDuplicate),
        autoApprove: true,
      };
    });

    try {
      setIsSubmittingBatchSchedule(true);
      const res = await api.batchSchedule(payload);
      const scheduledCount = res.data?.totalScheduled || 0;
      const videosCount = batchScheduleItems.length;
      const errorCount = res.data?.errors?.length || 0;

      if (errorCount > 0) {
        const errDetails = res.data.errors.map((er) => `- ${er.error}`).slice(0, 5).join('\n');
        alert(
          `Batch Scheduled ${scheduledCount} post(s) across ${videosCount} video(s).\n` +
          `Encountered ${errorCount} issue(s):\n${errDetails}`
        );
      } else {
        alert(
          `🎉 Batch Scheduling Successful!\n\n` +
          `• ${videosCount} video(s) scheduled\n` +
          `• ${scheduledCount} publishing job(s) queued across your channels!\n\n` +
          `Each video will automatically publish at its assigned scheduled time.`
        );
      }

      setBatchScheduleModalOpen(false);
      setSelectedVideoIds([]);
      if (onReload) onReload();
      if (onQueuePost) onQueuePost();
    } catch (err) {
      const errors = err.errors || err.data?.data?.errors || [];
      const duplicateError = errors.find((e) => e.error?.includes('already scheduled'));
      if (duplicateError) {
        alert(
          `Notice: These videos are ALREADY scheduled in your Publishing Queue!\n\n` +
          `• ${duplicateError.error}\n\n` +
          `Open the "Publishing Queue" tab in the left sidebar to view all scheduled posts across your calendar.`
        );
        setBatchScheduleModalOpen(false);
        setSelectedVideoIds([]);
        if (onReload) onReload();
      } else {
        const errorSummary = errors.length > 0
          ? `\n\nDetails:\n` + errors.slice(0, 4).map((e) => `• ${e.error}`).join('\n')
          : '';
        alert(`Batch Schedule Notice: ${err.message}${errorSummary}`);
      }
    } finally {
      setIsSubmittingBatchSchedule(false);
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

  const catalogTotal = pagination?.total || 0;
  const isAllMatchingSelected = catalogTotal > 0 && selectedVideoIds.length >= catalogTotal;
  const isAllPageSelected = videos.length > 0 && videos.every((video) => selectedVideoIds.includes(String(video._id)));
  const hasSomePageSelected = videos.length > 0 && videos.some((video) => selectedVideoIds.includes(String(video._id)));
  const driveConnected = Boolean(driveLink?.connected);

  return (
    <div className="space-y-6">
      {/* 1. Google Drive Multi-Account & Folder Management */}
      <Card className="border-indigo-500/20 bg-gradient-to-r from-white/90 via-indigo-50/20 to-white/90 shadow-sm">
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500/20 to-emerald-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shrink-0">
                <HardDrive className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-slate-900">Google Drive</h3>
                  <Badge variant={driveConnected ? 'success' : 'warning'} dot className="text-[10px]">
                    {driveConnected ? 'Drive connected' : 'Drive not connected'}
                  </Badge>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  Drive sign-in is separate from Social Accounts. YouTube and Instagram are not used to read Drive.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
              <Button
                variant="primary"
                size="sm"
                icon={Plus}
                isLoading={isConnectingGoogle}
                onClick={handleConnectGoogleDrive}
                className="text-xs bg-indigo-600 hover:bg-indigo-500 shadow-sm font-medium"
              >
                Connect Drive
              </Button>

              <Button
                variant="secondary"
                size="sm"
                icon={FolderSync}
                onClick={() => setSyncConfigOpen(!syncConfigOpen)}
                className="text-xs py-1"
              >
                {syncConfigOpen ? 'Hide Sync Settings' : 'Sync / Index Folders'}
              </Button>
            </div>
          </div>

          {driveConnected ? (
            <div className="p-3 rounded-xl border border-slate-200 bg-slate-50/60 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-slate-900">Drive sign-in</p>
                <p className="text-[11px] text-slate-400">{driveLink.email || 'Connected Google Drive account'}</p>
              </div>
              <Button variant="ghost" size="sm" onClick={handleDisconnectDrive} isLoading={isRemovingDriveId === 'drive'}>
                Disconnect Drive
              </Button>
            </div>
          ) : (
            <div className="p-4 rounded-xl bg-slate-50/40 border border-dashed border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="text-xs text-slate-400 text-center sm:text-left">
                Drive is not connected. Connect the Google account that owns the folders. Do not use the YouTube Brand Account for Drive.
              </div>
              <Button
                variant="primary"
                size="sm"
                icon={Plus}
                isLoading={isConnectingGoogle}
                onClick={handleConnectGoogleDrive}
                className="text-xs"
              >
                Connect Drive
              </Button>
            </div>
          )}

          {(folderTree.length > 0 || foldersList.length > 0) && (
            <div className="pt-2 border-t border-slate-200/60 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-slate-500 font-medium flex items-center gap-1.5">
                  <Folder className="w-3.5 h-3.5 text-amber-500" />
                  Drive Folders & Subfolders
                </span>
              </div>
              <FolderBoxes
                nodes={folderTree}
                foldersList={foldersList}
                selectedId={selectedFolder}
                showAllActive={showAllVideos}
                totalVideosCount={libraryStats?.total || pagination?.total || 0}
                onSelect={(folderId) => {
                  setShowAllVideos(false);
                  setSelectedFolder(folderId);
                  handleFilterUpdate({ folderId, status: folderId ? 'all' : statusFilter });
                }}
                onShowAll={() => {
                  setShowAllVideos(true);
                  setSelectedFolder('');
                  handleFilterUpdate({ folderId: '', status: statusFilter });
                }}
              />
            </div>
          )}
        </div>
      </Card>

      {/* Expandable Drive Folder Configuration Panel */}
      {syncConfigOpen && (
        <Card className="border-indigo-500/30 bg-white/90 animate-in fade-in duration-150">
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="md:col-span-2 space-y-1">
                <label className="text-slate-700 font-medium block">
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
                    className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-800 placeholder-slate-500 focus:outline-none focus:border-indigo-500/60 font-mono text-xs"
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
                <label className="text-slate-700 font-medium block">Scope:</label>
                <div className="flex items-center gap-3 pt-2 text-slate-400">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={syncOptions.recursive}
                      onChange={(e) => setSyncOptions({ ...syncOptions, recursive: e.target.checked })}
                      className="rounded bg-slate-50 border-slate-300 text-indigo-600 focus:ring-0"
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
                    ? 'bg-emerald-50/20 border-emerald-500/30 text-emerald-700'
                    : 'bg-rose-50/20 border-rose-500/30 text-rose-700'
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
                          onClick={handleConnectGoogleDrive}
                          className="text-xs text-amber-800 border-amber-500/30"
                        >
                          Reconnect Google Account with Drive Scopes
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => setFolderValidation(null)}
                  className="text-slate-400 hover:text-slate-800 self-start sm:self-center"
                >
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
        <Card className="border-indigo-500/30 bg-white/90">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-indigo-400 animate-ping" />
                <h4 className="text-xs font-semibold text-slate-800">
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

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50/60 p-3 rounded-lg border border-slate-200 text-[11px]">
              <div>
                <span className="text-slate-500 block">Total Scanned:</span>
                <span className="font-semibold text-slate-800 text-sm">{currentJob.totalScanned || 0}</span>
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
                <span className="font-semibold text-slate-700 text-sm">{currentJob.pagesProcessed || 0}</span>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* 2.5 Interactive Video Library Stats Ribbon (High Clarity & Understandability) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        <button
          type="button"
          onClick={() => {
            setApprovalFilter('');
            setStatusFilter('');
            setAspectFilter('');
            handleFilterUpdate({ approvalStatus: '', status: '', isVertical: '' });
          }}
          className={`p-3 rounded-xl border text-left transition-all ${
            !approvalFilter && !statusFilter && !aspectFilter
              ? 'bg-indigo-50/40 border-indigo-500/70 shadow-sm ring-1 ring-indigo-500/40'
              : 'bg-white/50 border-slate-200/80 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span>Total Catalog</span>
            <Film className="w-3.5 h-3.5 text-indigo-400" />
          </div>
          <div className="text-lg font-bold text-slate-900 mt-1">
            {libraryStats ? libraryStats.total?.toLocaleString() : pagination?.total?.toLocaleString() || 0}
          </div>
          <span className="text-[10px] text-slate-500 block truncate">All drive indexed</span>
        </button>

        <button
          type="button"
          onClick={() => {
            const next = approvalFilter === 'approved' ? '' : 'approved';
            setApprovalFilter(next);
            handleFilterUpdate({ approvalStatus: next });
          }}
          className={`p-3 rounded-xl border text-left transition-all ${
            approvalFilter === 'approved'
              ? 'bg-emerald-50/40 border-emerald-500/70 shadow-sm ring-1 ring-emerald-500/40'
              : 'bg-white/50 border-slate-200/80 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between text-emerald-400 text-xs">
            <span>Approved AI</span>
            <CheckCircle className="w-3.5 h-3.5" />
          </div>
          <div className="text-lg font-bold text-emerald-700 mt-1">
            {libraryStats?.approved?.toLocaleString() ?? '—'}
          </div>
          <span className="text-[10px] text-emerald-400/70 block truncate">Ready to schedule</span>
        </button>

        <button
          type="button"
          onClick={() => {
            const next = approvalFilter === 'draft' ? '' : 'draft';
            setApprovalFilter(next);
            handleFilterUpdate({ approvalStatus: next });
          }}
          className={`p-3 rounded-xl border text-left transition-all ${
            approvalFilter === 'draft'
              ? 'bg-amber-50/40 border-amber-500/70 shadow-sm ring-1 ring-amber-500/40'
              : 'bg-white/50 border-slate-200/80 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between text-amber-400 text-xs">
            <span>Draft AI</span>
            <Clock className="w-3.5 h-3.5" />
          </div>
          <div className="text-lg font-bold text-amber-800 mt-1">
            {libraryStats?.draft?.toLocaleString() ?? '—'}
          </div>
          <span className="text-[10px] text-amber-400/70 block truncate">Needs quick review</span>
        </button>

        <button
          type="button"
          onClick={() => {
            const next = approvalFilter === 'none' ? '' : 'none';
            setApprovalFilter(next);
            handleFilterUpdate({ approvalStatus: next });
          }}
          className={`p-3 rounded-xl border text-left transition-all ${
            approvalFilter === 'none'
              ? 'bg-purple-50/40 border-purple-500/70 shadow-sm ring-1 ring-purple-500/40'
              : 'bg-white/50 border-slate-200/80 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between text-purple-400 text-xs">
            <span>Needs AI</span>
            <Sparkles className="w-3.5 h-3.5" />
          </div>
          <div className="text-lg font-bold text-purple-300 mt-1">
            {libraryStats?.needsAi?.toLocaleString() ?? '—'}
          </div>
          <span className="text-[10px] text-purple-400/70 block truncate">No title / tags yet</span>
        </button>

        <button
          type="button"
          onClick={() => {
            const next = aspectFilter === 'true' ? '' : 'true';
            setAspectFilter(next);
            handleFilterUpdate({ isVertical: next });
          }}
          className={`p-3 rounded-xl border text-left transition-all ${
            aspectFilter === 'true'
              ? 'bg-indigo-50/40 border-indigo-500/70 shadow-sm ring-1 ring-indigo-500/40'
              : 'bg-white/50 border-slate-200/80 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between text-indigo-400 text-xs">
            <span>9:16 Vertical</span>
            <Smartphone className="w-3.5 h-3.5" />
          </div>
          <div className="text-lg font-bold text-indigo-700 mt-1">
            {libraryStats?.vertical?.toLocaleString() ?? '—'}
          </div>
          <span className="text-[10px] text-indigo-400/70 block truncate">Shorts & Reels</span>
        </button>

        <button
          type="button"
          onClick={() => {
            const next = statusFilter === 'queued' ? '' : 'queued';
            setStatusFilter(next);
            handleFilterUpdate({ status: next });
          }}
          className={`p-3 rounded-xl border text-left transition-all ${
            statusFilter === 'queued'
              ? 'bg-cyan-950/40 border-cyan-500/70 shadow-sm ring-1 ring-cyan-500/40'
              : 'bg-white/50 border-slate-200/80 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between text-cyan-400 text-xs">
            <span>Queued</span>
            <Calendar className="w-3.5 h-3.5" />
          </div>
          <div className="text-lg font-bold text-cyan-300 mt-1">
            {libraryStats?.queued?.toLocaleString() ?? '—'}
          </div>
          <span className="text-[10px] text-cyan-400/70 block truncate">Scheduled to post</span>
        </button>
      </div>

      {/* 3. Search, Quick Filters & Understandable Sorting Bar */}
      <Card>
        <div className="space-y-3">
          {/* Top row: Search input & Understandable Sort Dropdown */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <form onSubmit={handleSearchSubmit} className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search videos by title, original filename, or tags..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-10 pr-24 py-2.5 text-xs text-slate-800 placeholder-slate-500 focus:outline-none focus:border-indigo-500/60"
              />
              <button
                type="submit"
                className="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-colors"
              >
                Search
              </button>
            </form>

            {/* Clear, Understandable Sort Dropdown */}
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs text-slate-400 font-medium flex items-center gap-1">
                <ArrowUpDown className="w-3.5 h-3.5 text-indigo-400" />
                Sort:
              </span>
              <select
                value={sortOption}
                onChange={(e) => {
                  setSortOption(e.target.value);
                  handleFilterUpdate({ sort: e.target.value });
                }}
                className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-indigo-500/60 cursor-pointer font-medium"
              >
                <option value="modified_desc">🕒 Newest on Drive (Recently Added)</option>
                <option value="modified_asc">⏳ Oldest on Drive</option>
                <option value="name_asc">🔤 Title: A to Z (Alphabetical)</option>
                <option value="name_desc">🔤 Title: Z to A</option>
                <option value="duration_desc">⏱️ Duration: Longest First</option>
                <option value="duration_asc">⏱️ Duration: Shortest First</option>
                <option value="size_desc">💾 File Size: Largest First</option>
                <option value="size_asc">💾 File Size: Smallest First</option>
                <option value="approval_status">⭐ AI Status: Approved First</option>
              </select>
            </div>
          </div>

          {/* Quick Filter Pills Row */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs border-t border-slate-200/60 mt-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-slate-500 text-[11px] font-medium mr-1 flex items-center gap-1">
                <Filter className="w-3 h-3 text-slate-400" />
                Quick Filter:
              </span>

              {/* All */}
              <button
                onClick={() => {
                  setApprovalFilter('');
                  setStatusFilter('');
                  setAspectFilter('');
                  setShowAllVideos(true);
                  setSelectedFolder('');
                  handleFilterUpdate({ approvalStatus: '', status: '', isVertical: '', folderId: '' });
                }}
                className={`px-2.5 py-1 rounded-md text-xs transition-colors ${
                  showAllVideos && !approvalFilter && !statusFilter && !aspectFilter
                    ? 'bg-indigo-600 text-white font-medium'
                    : 'bg-white text-slate-600 hover:text-slate-800 border border-slate-200'
                }`}
              >
                All Videos
              </button>

              {/* Approved AI */}
              <button
                onClick={() => {
                  const next = approvalFilter === 'approved' ? '' : 'approved';
                  setApprovalFilter(next);
                  handleFilterUpdate({ approvalStatus: next });
                }}
                className={`px-2.5 py-1 rounded-md text-xs transition-colors flex items-center gap-1 ${
                  approvalFilter === 'approved'
                    ? 'bg-emerald-600 text-white font-medium shadow-xs'
                    : 'bg-white text-emerald-400/90 hover:text-emerald-700 border border-slate-200'
                }`}
              >
                <CheckCircle className="w-3 h-3" />
                Approved AI
              </button>

              {/* Draft AI */}
              <button
                onClick={() => {
                  const next = approvalFilter === 'draft' ? '' : 'draft';
                  setApprovalFilter(next);
                  handleFilterUpdate({ approvalStatus: next });
                }}
                className={`px-2.5 py-1 rounded-md text-xs transition-colors flex items-center gap-1 ${
                  approvalFilter === 'draft'
                    ? 'bg-amber-600 text-white font-medium shadow-xs'
                    : 'bg-white text-amber-400/90 hover:text-amber-800 border border-slate-200'
                }`}
              >
                <Clock className="w-3 h-3" />
                Draft AI
              </button>

              {/* No AI Yet */}
              <button
                onClick={() => {
                  const next = approvalFilter === 'none' ? '' : 'none';
                  setApprovalFilter(next);
                  handleFilterUpdate({ approvalStatus: next });
                }}
                className={`px-2.5 py-1 rounded-md text-xs transition-colors ${
                  approvalFilter === 'none'
                    ? 'bg-slate-700 text-white font-medium'
                    : 'bg-white text-slate-400 hover:text-slate-800 border border-slate-200'
                }`}
              >
                Needs AI
              </button>

              {/* 9:16 Vertical */}
              <button
                onClick={() => {
                  const next = aspectFilter === 'true' ? '' : 'true';
                  setAspectFilter(next);
                  handleFilterUpdate({ isVertical: next });
                }}
                className={`px-2.5 py-1 rounded-md text-xs transition-colors flex items-center gap-1 ${
                  aspectFilter === 'true'
                    ? 'bg-indigo-600 text-white font-medium shadow-xs'
                    : 'bg-white text-slate-700 hover:text-slate-900 border border-slate-200'
                }`}
              >
                <Smartphone className="w-3 h-3" />
                9:16 Vertical (Shorts/Reels)
              </button>

              {/* Landscape */}
              <button
                onClick={() => {
                  const next = aspectFilter === 'false' ? '' : 'false';
                  setAspectFilter(next);
                  handleFilterUpdate({ isVertical: next });
                }}
                className={`px-2.5 py-1 rounded-md text-xs transition-colors flex items-center gap-1 ${
                  aspectFilter === 'false'
                    ? 'bg-indigo-600 text-white font-medium shadow-xs'
                    : 'bg-white text-slate-700 hover:text-slate-900 border border-slate-200'
                }`}
              >
                <Monitor className="w-3 h-3" />
                Landscape
              </button>
            </div>

            {/* Secondary Select Filters & Reset */}
            <div className="flex items-center gap-2">
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  handleFilterUpdate({ status: e.target.value });
                }}
                className="bg-slate-50 border border-slate-200 rounded px-2 py-1 text-slate-700 focus:outline-none text-xs"
              >
                <option value="">Status: Available (Hide Queued)</option>
                <option value="discovered">Discovered</option>
                <option value="metadata_ready">Metadata Ready</option>
                <option value="queued">Queued (In Publishing Queue)</option>
                <option value="published">Published</option>
              </select>

              <select
                value={sizeFilter}
                onChange={(e) => {
                  setSizeFilter(e.target.value);
                  handleFilterUpdate({ sizeFilter: e.target.value });
                }}
                className="bg-slate-50 border border-slate-200 rounded px-2 py-1 text-slate-700 focus:outline-none text-xs"
              >
                <option value="">Size: All</option>
                <option value="small">&lt; 25 MB</option>
                <option value="medium">25 MB - 100 MB</option>
                <option value="large">&gt; 100 MB</option>
              </select>

              {(searchQuery || statusFilter || aspectFilter || sizeFilter || approvalFilter || selectedFolder) && (
                <button
                  onClick={() => {
                    setSearchQuery('');
                    setStatusFilter('');
                    setAspectFilter('');
                    setSizeFilter('');
                    setApprovalFilter('');
                    setSelectedFolder('');
                    setSortOption('modified_desc');
                    onFilterChange({
                      search: '',
                      status: '',
                      isVertical: '',
                      approvalStatus: '',
                      folderId: '',
                      sort: 'modified_desc',
                    });
                  }}
                  className="text-indigo-400 hover:text-indigo-700 text-xs px-2 py-1 transition-colors underline"
                >
                  Reset All
                </button>
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* 4. Floating / Sticky Bulk Action Bar when items selected */}
      {selectedVideoIds.length > 0 && (
        <div className="bg-indigo-50/80 border border-indigo-500/40 p-3 rounded-xl flex flex-wrap items-center justify-between gap-3 shadow-lg backdrop-blur-sm animate-in fade-in duration-200">
          <div className="flex items-center gap-3 text-xs">
            <span className="font-semibold text-indigo-800 flex items-center gap-1.5">
              <CheckSquare className="w-4 h-4 text-indigo-400" />
              {selectedVideoIds.length} video{selectedVideoIds.length > 1 ? 's' : ''} selected
            </span>
            <span className="text-slate-500">|</span>
            <div className="flex items-center gap-1.5 text-slate-700">
              <Globe className="w-3.5 h-3.5 text-slate-400" />
              <span>Language:</span>
              <select
                value={bulkLanguage}
                onChange={(e) => setBulkLanguage(e.target.value)}
                className="bg-slate-50 border border-slate-200 rounded px-2 py-1 text-slate-800 focus:outline-none text-xs"
              >
                <option value="en">English</option>
                <option value="hi">हिंदी (Hindi)</option>
                <option value="mr">मराठी (Marathi)</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedVideoIds([])}
              className="text-xs text-slate-400 hover:text-slate-800 cursor-pointer"
            >
              Clear Selection
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={RefreshCw}
              isLoading={isStartingBulk}
              onClick={() => handleStartBulkAi(true)}
              className="text-xs bg-indigo-50/70 border-indigo-500/50 text-indigo-700 hover:bg-indigo-900/70 hover:text-indigo-100 shadow-sm flex items-center gap-1.5 cursor-pointer"
              title="Regenerate fresh AI titles, viral hooks, captions, and hashtags for all selected videos"
            >
              Regenerate Content with AI ({selectedVideoIds.length})
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={Sparkles}
              isLoading={isStartingBulk}
              onClick={() => handleStartBulkAi(false)}
              className="text-xs cursor-pointer"
              title="Generate AI metadata for selected videos"
            >
              Generate AI ({selectedVideoIds.length})
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={Calendar}
              onClick={openBatchScheduleModal}
              className="text-xs bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 shadow-md font-semibold text-white px-3.5 py-1.5 flex items-center gap-1.5 cursor-pointer"
            >
              <Zap className="w-3.5 h-3.5 text-amber-800 fill-amber-300" />
              Batch Schedule ({selectedVideoIds.length} Videos)
            </Button>
          </div>
        </div>
      )}

      {/* 5. Line-by-Line Video List Catalog or Folder Picker Prompt */}
      {!selectedFolder && !showAllVideos && !searchQuery && !statusFilter && !aspectFilter && !approvalFilter && (folderTree.length > 0 || foldersList.length > 0) ? (
        <Card className="text-center py-12 px-4 bg-slate-50/60 border-dashed border-slate-200">
          <div className="max-w-md mx-auto space-y-3.5">
            <div className="w-12 h-12 mx-auto rounded-2xl bg-amber-500/10 text-amber-600 flex items-center justify-center shadow-2xs">
              <Folder className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-slate-800">Choose a Drive Folder</h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Drive folders and subfolders are shown above as boxes. Click on any folder box to explore subfolders and view its videos.
              </p>
            </div>
            <div className="pt-2">
              <Button
                variant="outline"
                size="sm"
                icon={Globe}
                onClick={() => {
                  setShowAllVideos(true);
                  handleFilterUpdate({ folderId: '', status: statusFilter });
                }}
                className="text-xs font-medium"
              >
                Browse All Videos ({libraryStats?.total?.toLocaleString() || pagination?.total?.toLocaleString() || 0})
              </Button>
            </div>
          </div>
        </Card>
      ) : (
        <Card>
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-4 border-b border-slate-200/80 mb-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Video Library Catalog</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Showing page {pagination?.page || 1} of {pagination?.totalPages || 1} (
              {pagination?.total?.toLocaleString() || 0} total videos on Drive)
            </p>
          </div>

          {videos.length > 0 && (
            <div className="flex items-center gap-2 text-xs flex-wrap">
              <button
                onClick={selectAllApproved}
                className="flex items-center gap-1.5 text-slate-700 hover:text-emerald-700 px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 hover:border-emerald-500/30 transition-colors cursor-pointer"
                title="Select all videos that have approved AI metadata"
              >
                <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                <span>Select Approved</span>
              </button>

              {/* Select Page Toggle */}
              <button
                onClick={toggleSelectAllPage}
                className="flex items-center gap-1.5 text-slate-700 hover:text-slate-900 px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 hover:border-slate-300 transition-colors cursor-pointer text-xs font-medium"
                title={isAllPageSelected ? 'Deselect all videos on this page' : 'Select all videos on this page'}
              >
                {isAllPageSelected ? (
                  <CheckSquare className="w-3.5 h-3.5 text-indigo-600" />
                ) : hasSomePageSelected ? (
                  <Minus className="w-3.5 h-3.5 text-indigo-500" />
                ) : (
                  <Square className="w-3.5 h-3.5 text-slate-500" />
                )}
                <span>
                  {isAllPageSelected ? `Deselect Page (${videos.length})` : `Select Page (${videos.length})`}
                </span>
              </button>

              {/* Select All in Catalog */}
              <button
                onClick={selectAllMatching}
                disabled={isSelectingAll}
                className="flex items-center gap-1.5 text-slate-700 hover:text-slate-900 px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 hover:border-slate-300 transition-colors cursor-pointer disabled:opacity-60 text-xs font-medium"
                title="Select all videos matching current filters across all pages"
              >
                {isSelectingAll ? (
                  <Loader2 className="w-3.5 h-3.5 text-indigo-400 animate-spin" />
                ) : isAllMatchingSelected ? (
                  <CheckSquare className="w-3.5 h-3.5 text-indigo-600" />
                ) : (
                  <Square className="w-3.5 h-3.5 text-slate-500" />
                )}
                <span>
                  {isSelectingAll
                    ? 'Selecting…'
                    : isAllMatchingSelected
                    ? 'Deselect All'
                    : `Select All${catalogTotal ? ` (${catalogTotal.toLocaleString()})` : ''}`}
                </span>
              </button>

              {selectedVideoIds.length > 0 && (
                <button
                  onClick={() => setSelectedVideoIds([])}
                  className="flex items-center gap-1 text-slate-500 hover:text-rose-600 px-2.5 py-1.5 rounded-lg hover:bg-rose-50 border border-transparent hover:border-rose-200 transition-colors cursor-pointer text-xs font-medium"
                  title="Clear all selections"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Clear ({selectedVideoIds.length.toLocaleString()})</span>
                </button>
              )}

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

        {videos.length === 0 && !driveConnected ? (
          <EmptyState
            icon={FolderSync}
            title="No Google Drive Connected"
            description="Drive delete / disconnect keli ahe. Please connect your Google Drive account above to catalog, view, and manage your video reels."
            actionLabel="Connect Google Drive"
            onAction={handleConnectGoogleDrive}
            actionIcon={Plus}
          />
        ) : videos.length === 0 ? (
          <EmptyState
            icon={Film}
            title={selectedDriveAccount !== 'all' ? 'No videos found for this Drive' : 'No videos match current criteria'}
            description={
              selectedDriveAccount !== 'all'
                ? 'The selected connected Google Drive has no indexed video reels yet. Sync this drive folder to discover videos.'
                : 'Your video catalog is currently empty or no videos matched the active search filters. Start an indexing job to catalog files from your connected Google Drive.'
            }
            actionLabel="Configure / Sync Drive Folder"
            onAction={() => setSyncConfigOpen(true)}
            actionIcon={FolderSync}
          />
        ) : (
          <div className="space-y-2">
            {/* Desktop Column Header */}
            <div className="hidden lg:flex items-center justify-between gap-4 px-4 py-2.5 text-[11px] font-semibold text-slate-400 bg-white/50 rounded-lg border border-slate-200/80 uppercase tracking-wider">
              <div className="flex-1 min-w-0 flex items-center gap-2">
                <input
                  type="checkbox"
                  ref={(el) => {
                    if (el) el.indeterminate = hasSomePageSelected && !isAllPageSelected;
                  }}
                  checked={isAllPageSelected}
                  onChange={toggleSelectAllPage}
                  className="rounded bg-white border-slate-300 text-indigo-600 focus:ring-0 cursor-pointer"
                  title={isAllPageSelected ? 'Deselect this page' : 'Select all videos on this page'}
                />
                <span>Video & Information</span>
              </div>
              <div className="flex items-center justify-end gap-5 shrink-0 text-slate-400">
                <span className="w-28 text-left">Specs</span>
                <span className="w-28 text-center">AI Metadata</span>
                <span className="w-24 text-center">Status</span>
                <span className="w-56 text-right pr-2">Actions</span>
              </div>
            </div>

            {/* Catalog-Wide Selection Banner */}
            {isAllPageSelected && catalogTotal > videos.length && (
              <div className="bg-indigo-50/80 border border-indigo-200/80 rounded-lg px-4 py-2 text-xs text-indigo-900 flex flex-wrap items-center justify-center gap-2 text-center animate-in fade-in duration-200">
                {isAllMatchingSelected ? (
                  <span>
                    All <strong>{catalogTotal.toLocaleString()}</strong> videos in the catalog are selected.
                  </span>
                ) : (
                  <span>
                    All <strong>{videos.length}</strong> videos on this page are selected.
                  </span>
                )}
                {!isAllMatchingSelected ? (
                  <button
                    onClick={selectAllMatching}
                    disabled={isSelectingAll}
                    className="font-semibold text-indigo-600 hover:text-indigo-800 underline ml-1 cursor-pointer disabled:opacity-60"
                  >
                    {isSelectingAll ? 'Selecting…' : `Select all ${catalogTotal.toLocaleString()} videos in the catalog`}
                  </button>
                ) : (
                  <button
                    onClick={() => setSelectedVideoIds([])}
                    className="font-semibold text-rose-600 hover:text-rose-800 underline ml-1 cursor-pointer"
                  >
                    Clear selection
                  </button>
                )}
              </div>
            )}

            {/* Line-by-Line Video Items */}
            {videos.map((video) => {
              const isSelected = selectedVideoIds.includes(String(video._id));
              const aiMeta = video.aiMetadata;
              const hasAi = Boolean(aiMeta?.youtubeTitle || aiMeta?.generatedTitle);
              const approvalStatus = aiMeta?.approvalStatus || (hasAi ? 'draft' : null);

              return (
                <div
                  key={video._id}
                  className={`group p-3 sm:p-3.5 rounded-xl border transition-all flex flex-col lg:flex-row lg:items-center justify-between gap-3 sm:gap-4 ${
                    isSelected
                      ? 'bg-indigo-50/30 border-indigo-500/60 ring-1 ring-indigo-500/30'
                      : 'bg-slate-50/60 border-slate-200/80 hover:bg-white/60 hover:border-slate-300/80'
                  }`}
                >
                  {/* Left: Checkbox, Thumbnail, Title & Original filename */}
                  <div className="flex items-start sm:items-center gap-3 flex-1 min-w-0">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelectVideo(video._id)}
                      className="mt-1 sm:mt-0 rounded bg-white border-slate-300 text-indigo-600 focus:ring-0 cursor-pointer shrink-0"
                    />

                    {/* Video Thumbnail (Authenticated Proxy + Graceful Fallback) */}
                    <VideoThumbnail video={video} onPreview={() => setPreviewVideo(video)} />

                    {/* Titles & Details */}
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <h4
                          onClick={() => setPreviewVideo(video)}
                          className="text-xs sm:text-sm font-semibold text-slate-900 hover:text-indigo-700 transition-colors cursor-pointer truncate"
                          title="Click to preview video & details"
                        >
                          {video.cleanTitle || video.originalName}
                        </h4>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                        <span className="font-mono text-slate-500 text-[10px] truncate max-w-[220px]" title={video.originalName}>
                          {video.originalName}
                        </span>

                        {videoFolderLabel(video) && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white border border-slate-200 text-[10px] text-slate-400">
                            <Folder className="w-2.5 h-2.5 text-indigo-400" />
                            {videoFolderLabel(video)}
                          </span>
                        )}
                      </div>

                      {/* AI Snippet preview if available */}
                      {hasAi && (
                        <p className="text-[11px] text-indigo-700/90 truncate flex items-center gap-1 font-medium">
                          <Sparkles className="w-3 h-3 text-indigo-400 shrink-0" />
                          <span>{aiMeta.youtubeTitle || aiMeta.generatedTitle}</span>
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Right Section: Technical Specs, AI Status, Publishing Status & Actions */}
                  <div className="w-full lg:w-auto flex flex-wrap lg:flex-nowrap items-center justify-between lg:justify-end gap-3 sm:gap-4 pt-2.5 lg:pt-0 border-t border-slate-200/50 lg:border-t-0 shrink-0">
                    {/* Technical Specs */}
                    <div className="flex flex-col items-start gap-1 text-[11px] text-slate-400 w-28 shrink-0">
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white border border-slate-200 text-[10px]">
                        {video.resolution?.isVertical ? (
                          <Smartphone className="w-3 h-3 text-emerald-400" />
                        ) : (
                          <Monitor className="w-3 h-3 text-slate-400" />
                        )}
                        {video.resolution?.width && video.resolution?.height
                          ? `${video.resolution.width}×${video.resolution.height}`
                          : video.resolution?.isVertical
                          ? 'Vertical 9:16'
                          : 'Landscape'}
                      </span>
                      <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                        <span>{formatBytes(video.fileSize)}</span>
                        <span>•</span>
                        <span>{video.duration ? `${video.duration}s` : 'Short'}</span>
                        {aiMeta?.language && (
                          <span className="px-1 rounded bg-indigo-50/60 border border-indigo-500/30 text-indigo-700 font-bold uppercase text-[9px]">
                            {aiMeta.language}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* AI Metadata & Approval Status */}
                    <div className="w-28 flex items-center justify-center shrink-0">
                      {approvalStatus === 'approved' ? (
                        <Badge variant="success" className="text-[10px] uppercase font-semibold whitespace-nowrap">
                          <CheckCircle className="w-3 h-3 mr-1" />
                          Approved
                        </Badge>
                      ) : approvalStatus === 'draft' ? (
                        <Badge variant="warning" className="text-[10px] uppercase font-semibold whitespace-nowrap">
                          <Clock className="w-3 h-3 mr-1" />
                          Draft (Review)
                        </Badge>
                      ) : (
                        <Badge variant="neutral" className="text-[10px] uppercase font-semibold whitespace-nowrap">
                          No AI Yet
                        </Badge>
                      )}
                    </div>

                    {/* Publishing Status */}
                    <div className="w-24 flex items-center justify-center shrink-0">
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
                        className="text-[10px] capitalize font-medium whitespace-nowrap"
                      >
                        {video.status.replace('_', ' ')}
                      </Badge>
                    </div>

                    {/* Row Action Buttons */}
                    <div className="flex items-center justify-end gap-1.5 shrink-0 ml-auto lg:ml-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={Play}
                        onClick={() => setPreviewVideo(video)}
                        className="text-xs py-1 px-2 text-slate-700 hover:text-slate-900 hover:bg-slate-100 shrink-0"
                        title="Preview video stream & details"
                      >
                        Watch
                      </Button>

                      <Button
                        variant="ghost"
                        size="sm"
                        icon={hasAi ? Edit3 : Sparkles}
                        onClick={() => openAiGenerator(video)}
                        className={`text-xs py-1 px-2.5 whitespace-nowrap shrink-0 ${
                          hasAi ? 'text-indigo-700 hover:text-indigo-800' : 'text-indigo-400 hover:text-indigo-700 font-medium'
                        }`}
                      >
                        {hasAi ? 'Review AI' : 'Generate AI'}
                      </Button>

                      <Button
                        variant={video.status === 'queued' ? 'outline' : 'secondary'}
                        size="sm"
                        icon={Calendar}
                        onClick={() => openScheduleModal(video)}
                        className={`text-xs py-1 px-2.5 whitespace-nowrap shrink-0 ${
                          video.status === 'queued' ? 'text-amber-400 border-amber-500/30 hover:bg-amber-50/20' : ''
                        }`}
                      >
                        {video.status === 'queued' ? 'Reschedule' : 'Schedule'}
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination Bar */}
        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between pt-5 border-t border-slate-200/80 mt-5 text-xs text-slate-400">
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
      )}

      {/* 6. Single Video AI Metadata Generator & Draft Editor Modal */}
      <Modal
        isOpen={aiModalOpen}
        onClose={() => setAiModalOpen(false)}
        title="AI Content Metadata Pipeline (Draft & Review)"
      >
        <div className="space-y-4 text-xs max-h-[75vh] overflow-y-auto pr-1">
          {/* Target Video & Provider Info */}
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <span className="text-slate-500 block text-[11px]">Selected Video:</span>
                <span className="font-semibold text-slate-900 text-sm">
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

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200 text-[11px] text-slate-400">
              <div className="flex items-center gap-2">
                <span>Language:</span>
                <select
                  value={singleLanguage}
                  onChange={(e) => setSingleLanguage(e.target.value)}
                  className="bg-white border border-slate-300 rounded px-2 py-0.5 text-slate-800 text-xs focus:outline-none"
                >
                  <option value="en">English</option>
                  <option value="hi">हिंदी (Hindi)</option>
                  <option value="mr">मराठी (Marathi)</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-slate-500">
                  Provider: <span className="text-slate-700 font-medium capitalize">{draftForm.provider}</span>
                </span>
                <button
                  type="button"
                  onClick={() => setShowAiConfig((v) => !v)}
                  className="text-indigo-400 hover:text-indigo-700 underline text-[11px] ml-1 flex items-center gap-1 cursor-pointer"
                >
                  <Sparkles className="w-3 h-3" />
                  {draftForm.provider === 'gemini' ? 'Gemini AI Active' : 'Setup Gemini AI Key'}
                </button>
              </div>
            </div>

            {/* Optional Gemini API Key configuration card */}
            {showAiConfig && (
              <div className="p-2.5 rounded-lg bg-indigo-50/40 border border-indigo-900/60 space-y-2 mt-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-indigo-800">Google Gemini API Key</span>
                  <a
                    href="https://aistudio.google.com/app/apikey"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[10px] text-indigo-400 hover:underline flex items-center gap-0.5"
                  >
                    Get Free Gemini Key ↗
                  </a>
                </div>
                <p className="text-[10px] text-slate-400 leading-tight">
                  Enter your free Gemini API key for deep AI video generation, or use the built-in offline smart generator.
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="password"
                    placeholder="Paste Gemini API Key (AIzaSy...)"
                    value={geminiKeyInput}
                    onChange={(e) => setGeminiKeyInput(e.target.value)}
                    className="flex-1 bg-white border border-slate-300 rounded px-2.5 py-1 text-slate-800 text-xs focus:outline-none focus:border-indigo-500"
                  />
                  <Button
                    size="xs"
                    variant="primary"
                    isLoading={isConfiguringAi}
                    onClick={handleSaveGeminiKey}
                    className="bg-indigo-600 hover:bg-indigo-500 text-xs shrink-0"
                  >
                    Save & Test
                  </Button>
                </div>
                {aiConfigMsg && (
                  <p className={`text-[10px] ${aiConfigMsg.type === 'success' ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {aiConfigMsg.text}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Context Disclaimer Alert */}
          <div className="p-2.5 rounded-lg bg-white/60 border border-slate-200 text-[11px] text-slate-400 flex items-start gap-2">
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
                  <label className="font-semibold text-slate-800 block">
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
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-900 font-medium focus:outline-none focus:border-indigo-500/60 text-xs"
                />
              </div>

              {/* Attention Hook */}
              <div>
                <label className="font-semibold text-slate-800 block mb-1">Attention Hook (First 3s):</label>
                <input
                  type="text"
                  value={draftForm.hook}
                  onChange={(e) => setDraftForm({ ...draftForm, hook: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-slate-700 focus:outline-none focus:border-indigo-500/60 text-xs"
                />
              </div>

              {/* Instagram Reel Caption */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-semibold text-slate-800 block">
                    Instagram Reel Caption (Platform Limit: 2200 Chars):
                  </label>
                  <span className="text-[10px] text-slate-400">{draftForm.instagramCaption.length} / 2200</span>
                </div>
                <textarea
                  rows={4}
                  value={draftForm.instagramCaption}
                  maxLength={2200}
                  onChange={(e) => setDraftForm({ ...draftForm, instagramCaption: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-700 focus:outline-none focus:border-indigo-500/60 text-xs font-sans"
                />
              </div>

              {/* CTA & Category Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-800 block mb-1">Suggested Call to Action:</label>
                  <input
                    type="text"
                    value={draftForm.cta}
                    onChange={(e) => setDraftForm({ ...draftForm, cta: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-slate-700 focus:outline-none text-xs"
                  />
                </div>

                <div>
                  <label className="font-semibold text-slate-800 block mb-1">Content Category:</label>
                  <select
                    value={draftForm.category}
                    onChange={(e) => setDraftForm({ ...draftForm, category: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-slate-700 focus:outline-none text-xs"
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
                <label className="font-semibold text-slate-800 block mb-1">
                  Hashtags (Space separated, 3-15 clean tags):
                </label>
                <input
                  type="text"
                  value={draftForm.hashtags}
                  onChange={(e) => setDraftForm({ ...draftForm, hashtags: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-slate-700 focus:outline-none text-xs"
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
              <div className="pt-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
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
                    className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-50/20"
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
                  <span className="font-semibold text-slate-800">
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
                <div className="w-full bg-white rounded-full h-2.5 overflow-hidden border border-slate-200">
                  <div
                    className="bg-indigo-500 h-2.5 rounded-full transition-all duration-300"
                    style={{ width: `${bulkPercent}%` }}
                  />
                </div>
              </div>

              {/* Metrics Counters */}
              <div className="grid grid-cols-3 gap-3 bg-slate-50/60 p-3 rounded-lg border border-slate-200 text-center">
                <div>
                  <span className="text-slate-500 block text-[10px]">Total</span>
                  <span className="font-semibold text-slate-800 text-sm">{currentBulkJob.totalVideos}</span>
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
                <div className="p-2.5 rounded bg-slate-50 border border-slate-200/80 text-[11px] text-slate-400 flex items-center gap-2">
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
                        className="p-2 rounded bg-rose-50/20 border border-rose-500/20 text-[10px] text-rose-700 flex items-start gap-1.5"
                      >
                        <AlertTriangle className="w-3 h-3 text-rose-400 shrink-0 mt-0.5" />
                        <div>
                          <strong className="block text-rose-800">{err.title}</strong>
                          <span>{err.error}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Modal Actions */}
              <div className="pt-3 border-t border-slate-200 flex justify-end gap-2">
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
                  <>
                    {currentBulkJob?.videoIds?.length > 0 && (
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={RefreshCw}
                        isLoading={isStartingBulk}
                        onClick={() => {
                          setSelectedVideoIds(currentBulkJob.videoIds);
                          handleStartBulkAi(true);
                        }}
                        className="text-xs bg-indigo-50/70 border-indigo-700/50 text-indigo-700 hover:bg-indigo-900/60 hover:text-indigo-800 cursor-pointer"
                        title="Re-run AI generation for all videos in this batch"
                      >
                        Regenerate All with AI
                      </Button>
                    )}
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
                  </>
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
          {findPairForFolder(channelPairs, selectedVideo?.folderId || selectedFolder, selectedVideo?.folderPathIds) && (
            <p className="text-[11px] text-slate-400">
              This Drive folder is linked on Channels. YouTube and Instagram for that pair are selected. Change them only if you want a different account.
            </p>
          )}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-slate-700 font-medium">Upload to this channel:</label>
              <div className="flex items-center gap-1 text-[10px]">
                <button
                  type="button"
                  onClick={() => {
                    const validIds = accounts.filter((a) => a.status === 'connected').map((a) => a._id);
                    setScheduleForm({ ...scheduleForm, selectedAccountIds: validIds });
                  }}
                  className="px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-700 hover:bg-slate-100"
                >
                  Select All
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const ytIds = accounts.filter((a) => a.platform === 'youtube' && a.status === 'connected').map((a) => a._id);
                    setScheduleForm({ ...scheduleForm, selectedAccountIds: ytIds });
                  }}
                  className="px-1.5 py-0.5 rounded bg-red-50/60 border border-red-200/40 text-red-700 hover:bg-red-900/60"
                >
                  All YouTube
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const igIds = accounts.filter((a) => a.platform === 'instagram' && a.status === 'connected').map((a) => a._id);
                    setScheduleForm({ ...scheduleForm, selectedAccountIds: igIds });
                  }}
                  className="px-1.5 py-0.5 rounded bg-pink-50/60 border border-pink-200/40 text-pink-700 hover:bg-pink-900/60"
                >
                  All Instagram
                </button>
                <button
                  type="button"
                  onClick={() => setScheduleForm({ ...scheduleForm, selectedAccountIds: [] })}
                  className="px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-400 hover:bg-slate-100"
                >
                  Clear
                </button>
              </div>
            </div>

            {accounts.length === 0 ? (
              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-800 text-xs">
                No connected social channels found. Please connect your YouTube channel or Instagram account in the Connected Accounts tab first.
              </div>
            ) : (
              <div className="space-y-1.5 max-h-48 overflow-y-auto p-1 bg-slate-50 rounded-lg border border-slate-200/80">
                {accounts.map((acc) => {
                  const isYt = acc.platform === 'youtube';
                  const isSelected = (scheduleForm.selectedAccountIds || []).includes(acc._id);
                  const isDisconnected = acc.status !== 'connected';

                  return (
                    <label
                      key={acc._id}
                      className={`flex items-center justify-between p-2 rounded-lg border cursor-pointer transition-all ${
                        isDisconnected
                          ? 'opacity-50 cursor-not-allowed bg-white/30 border-slate-200'
                          : isSelected
                          ? 'bg-indigo-50/40 border-indigo-500/40'
                          : 'bg-white/50 border-slate-200/60 hover:border-slate-300'
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
                          className="rounded border-slate-200 text-indigo-600 focus:ring-0"
                        />

                        <ChannelAvatar
                          account={acc}
                          size="xs"
                          showBadge={false}
                        />

                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-slate-800 truncate text-xs">{acc.accountName}</span>
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
                Selected: <strong className="text-slate-800 font-mono">{(scheduleForm.selectedAccountIds || []).length}</strong> channel(s)
              </span>
              {(scheduleForm.selectedAccountIds || []).length > 0 && (
                <span className="text-emerald-400 text-[10px]">
                  ✓ Separate publishing job queued per channel
                </span>
              )}
            </div>
          </div>

          <div>
            <label className="block text-slate-700 font-medium mb-1">Post Title:</label>
            <input
              type="text"
              value={scheduleForm.title}
              onChange={(e) => setScheduleForm({ ...scheduleForm, title: e.target.value })}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-800 focus:outline-none"
              required
            />
          </div>

          <div>
            <label className="block text-slate-700 font-medium mb-1">Caption / Description:</label>
            <textarea
              rows={3}
              value={scheduleForm.caption}
              onChange={(e) => setScheduleForm({ ...scheduleForm, caption: e.target.value })}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-800 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-slate-700 font-medium mb-1">Hashtags (space separated):</label>
            <input
              type="text"
              value={scheduleForm.hashtags}
              onChange={(e) => setScheduleForm({ ...scheduleForm, hashtags: e.target.value })}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-800 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-700 font-medium mb-1">Scheduled Date & Time:</label>
              <input
                type="datetime-local"
                value={scheduleForm.scheduledAt}
                onChange={(e) => setScheduleForm({ ...scheduleForm, scheduledAt: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-800 focus:outline-none"
                required
              />
            </div>

            <div>
              <label className="block text-slate-700 font-medium mb-1">Target Timezone:</label>
              <select
                value={scheduleForm.timezone || 'UTC'}
                onChange={(e) => setScheduleForm({ ...scheduleForm, timezone: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-800 focus:outline-none"
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
          <div className="p-3 rounded-lg bg-white/60 border border-slate-200">
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={scheduleForm.allowDuplicate || false}
                onChange={(e) => setScheduleForm({ ...scheduleForm, allowDuplicate: e.target.checked })}
                className="mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-0"
              />
              <div className="text-[11px] text-slate-700">
                <span className="font-semibold text-slate-800 block">Allow duplicate schedule / reschedule</span>
                <span className="text-slate-400 block text-[10px] leading-relaxed mt-0.5">
                  Check this if this video is already scheduled or queued on a selected channel and you want to schedule another post for it.
                </span>
              </div>
            </label>
          </div>

          <div className="pt-3 border-t border-slate-200 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setScheduleModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" type="submit">
              Confirm & Queue
            </Button>
          </div>
        </form>
      </Modal>

      {/* 9. Smart Batch Multi-Video Scheduling Modal */}
      <Modal
        isOpen={batchScheduleModalOpen}
        onClose={() => setBatchScheduleModalOpen(false)}
        title={`Batch Schedule Videos (${batchScheduleItems.length} Videos Selected)`}
        maxWidth="max-w-4xl"
      >
        <form onSubmit={handleSubmitBatchSchedule} className="space-y-5 text-xs">
          {/* A. Global Quick-Setup Panel */}
          <div className="p-4 rounded-xl bg-slate-50/70 border border-indigo-500/30 space-y-3.5 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200/80 pb-2.5">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-lg bg-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold text-xs">
                  ⚡
                </div>
                <div>
                  <h4 className="font-semibold text-slate-900 text-xs">
                    Quick Batch Presets (सर्व व्हिडिओंसाठी एका क्लिकमध्ये सेट करा)
                  </h4>
                  <p className="text-[10px] text-slate-400">
                    Apply channels & automatic time intervals to all {batchScheduleItems.length} videos at once
                  </p>
                </div>
              </div>

              {/* Channel Preset Buttons */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  type="button"
                  onClick={() => {
                    const validIds = accounts.filter((a) => a.status === 'connected').map((a) => a._id);
                    applyGlobalAccountsToAll(validIds);
                  }}
                  className="px-2 py-1 rounded bg-white border border-slate-300 hover:border-slate-400 text-slate-800 text-[10px] font-medium cursor-pointer"
                >
                  Select All
                </button>
                <button
                  type="button"
                  onClick={() => applyGlobalAccountsToAll([])}
                  className="px-2 py-1 rounded bg-white border border-slate-300 hover:border-rose-400 text-slate-500 hover:text-rose-600 text-[10px] font-medium cursor-pointer"
                >
                  Clear All
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const ytIds = accounts.filter((a) => a.platform === 'youtube' && a.status === 'connected').map((a) => a._id);
                    applyGlobalAccountsToAll(ytIds);
                  }}
                  className="px-2 py-1 rounded bg-red-50 border border-red-200 hover:bg-red-100 text-red-700 text-[10px] font-medium flex items-center gap-1 cursor-pointer"
                >
                  <Youtube className="w-3 h-3 text-red-500" />
                  YouTube Only
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const igIds = accounts.filter((a) => a.platform === 'instagram' && a.status === 'connected').map((a) => a._id);
                    applyGlobalAccountsToAll(igIds);
                  }}
                  className="px-2 py-1 rounded bg-pink-50 border border-pink-200 hover:bg-pink-100 text-pink-700 text-[10px] font-medium flex items-center gap-1 cursor-pointer"
                >
                  <Instagram className="w-3 h-3 text-pink-500" />
                  Instagram Only
                </button>
              </div>
            </div>

            {/* Master Channel Selector at the Top */}
            <div className="space-y-1.5 pt-0.5 pb-1">
              <div className="flex items-center justify-between text-[11px]">
                <label className="text-slate-800 font-semibold flex items-center gap-1.5">
                  <Folders className="w-3.5 h-3.5 text-indigo-500" />
                  <span>Target Channels (येथून चॅनेल्स निवडा — सर्व व्हिडिओंवर लागू होतील):</span>
                </label>
                <span className="text-[10px] text-slate-400">
                  {globalBatchConfig.selectedAccountIds?.length || 0} channels selected
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2 p-2.5 rounded-xl bg-white border border-slate-200 shadow-2xs">
                {accounts.filter((a) => a.status === 'connected').length === 0 ? (
                  <span className="text-xs text-amber-600">No connected accounts found. Connect in Channels tab.</span>
                ) : (
                  accounts.filter((a) => a.status === 'connected').map((acc) => {
                    const isYt = acc.platform === 'youtube';
                    const isSelected = (globalBatchConfig.selectedAccountIds || []).includes(acc._id);

                    return (
                      <button
                        key={acc._id}
                        type="button"
                        onClick={() => toggleGlobalAccount(acc._id)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-all cursor-pointer select-none ${
                          isSelected
                            ? isYt
                              ? 'bg-red-500/15 text-red-700 border-red-500 ring-2 ring-red-500/20 shadow-xs font-semibold'
                              : 'bg-pink-500/15 text-pink-700 border-pink-500 ring-2 ring-pink-500/20 shadow-xs font-semibold'
                            : 'bg-slate-50 text-slate-600 border-slate-200 hover:border-slate-300 hover:bg-white'
                        }`}
                        title={`Click to ${isSelected ? 'remove from' : 'add to'} all ${batchScheduleItems.length} videos`}
                      >
                        {isYt ? (
                          <Youtube className={`w-3.5 h-3.5 ${isSelected ? 'text-red-600' : 'text-slate-400'}`} />
                        ) : (
                          <Instagram className={`w-3.5 h-3.5 ${isSelected ? 'text-pink-600' : 'text-slate-400'}`} />
                        )}
                        <span>{acc.accountName}</span>
                        {isSelected ? (
                          <Check className="w-3.5 h-3.5 ml-0.5 text-emerald-600" />
                        ) : (
                          <span className="text-[10px] text-slate-400 ml-0.5">+</span>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {/* Timing & Auto-Stagger Row */}
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
              <div className="sm:col-span-4">
                <label className="block text-[11px] text-slate-700 font-medium mb-1 flex items-center gap-1">
                  <Clock className="w-3 h-3 text-indigo-400" />
                  Starting Date & Time (पहिला व्हिडिओ वेळ):
                </label>
                <input
                  type="datetime-local"
                  value={globalBatchConfig.startDateTime}
                  onChange={(e) => {
                    const val = e.target.value;
                    setGlobalBatchConfig({ ...globalBatchConfig, startDateTime: val });
                    applyAutoStagger(val, null);
                  }}
                  className="w-full bg-white border border-slate-200 rounded-lg p-2 text-slate-800 focus:outline-none text-xs"
                />
              </div>

              <div className="sm:col-span-3">
                <label className="block text-[11px] text-slate-700 font-medium mb-1">
                  Interval / Gap (व्हिडिओमधील अंतर):
                </label>
                <select
                  value={globalBatchConfig.intervalMinutes}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    setGlobalBatchConfig({ ...globalBatchConfig, intervalMinutes: val });
                    applyAutoStagger(null, val);
                  }}
                  className="w-full bg-white border border-slate-200 rounded-lg p-2 text-slate-800 focus:outline-none text-xs"
                >
                  <option value={30}>Every 30 Minutes</option>
                  <option value={60}>Every 1 Hour (दर १ तासाने)</option>
                  <option value={120}>Every 2 Hours (दर २ तासांनी)</option>
                  <option value={180}>Every 3 Hours (दर ३ तासांनी)</option>
                  <option value={240}>Every 4 Hours (दर ४ तासांनी)</option>
                  <option value={360}>Every 6 Hours (दर ६ तासांनी)</option>
                  <option value={720}>Every 12 Hours (सकाळ-संध्याकाळ)</option>
                  <option value={1440}>Daily / 24 Hours (दररोज एक)</option>
                  <option value={0}>Same Time for All (एकाच वेळी)</option>
                </select>
              </div>

              <div className="sm:col-span-3">
                <label className="block text-[11px] text-slate-700 font-medium mb-1">
                  Timezone (वेळ क्षेत्र):
                </label>
                <select
                  value={globalBatchConfig.timezone}
                  onChange={(e) => setGlobalBatchConfig({ ...globalBatchConfig, timezone: e.target.value })}
                  className="w-full bg-white border border-slate-200 rounded-lg p-2 text-slate-800 focus:outline-none text-xs"
                >
                  <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
                  <option value="UTC">UTC (Universal Time)</option>
                  <option value="America/New_York">America/New_York (EST)</option>
                  <option value="America/Los_Angeles">America/Los_Angeles (PST)</option>
                  <option value="Europe/London">Europe/London (BST)</option>
                </select>
              </div>

              <div className="sm:col-span-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => applyAutoStagger()}
                  className="w-full text-[11px] py-2 bg-indigo-50/60 border-indigo-700/50 hover:bg-indigo-900/60 text-indigo-700 cursor-pointer"
                  title="Recalculate staggered times for all items"
                >
                  <Zap className="w-3 h-3 mr-1" />
                  Auto-Stagger
                </Button>
              </div>
            </div>

            {/* Overwrite / Reschedule Toggle */}
            <div className="pt-2.5 border-t border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={Boolean(globalBatchConfig.allowDuplicate)}
                  onChange={(e) =>
                    setGlobalBatchConfig({
                      ...globalBatchConfig,
                      allowDuplicate: e.target.checked,
                    })
                  }
                  className="rounded border-slate-300 text-indigo-600 focus:ring-0 cursor-pointer"
                />
                <span className="text-[11px] text-slate-800 font-semibold">
                  Allow overwrite / reschedule if video is already in queue
                </span>
              </label>
              <span className="text-[10px] text-slate-400">
                (आधीच लागलेले व्हिडिओ नवीन वेळेनुसार अपडेट करण्यासाठी हा पर्याय चालू करा)
              </span>
            </div>
          </div>

          {/* B. Per-Video Customization List */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between text-xs text-slate-700 font-medium px-1">
              <span className="flex items-center gap-1.5 font-semibold text-slate-800">
                <span>Selected Videos to Schedule ({batchScheduleItems.length})</span>
                <span className="text-[10px] text-slate-400 font-normal">
                  — तुम्ही खाली प्रत्येक व्हिडिओचे चॅनेल आणि वेळ बदलू शकता
                </span>
              </span>
              <span className="text-[11px] text-indigo-400 font-mono">
                {batchScheduleItems.reduce((acc, it) => acc + (it.selectedAccountIds?.length || 0), 0)} Total Dispatches Queued
              </span>
            </div>

            <div className="max-h-[50vh] overflow-y-auto space-y-2.5 pr-1">
              {batchScheduleItems.length > 40 && (
                <p className="text-[11px] text-slate-400 px-1">
                  Showing the first 40 of {batchScheduleItems.length.toLocaleString()} selected videos. The rest use the same channels and time gap.
                </p>
              )}
              {batchScheduleItems.slice(0, 40).map((item, idx) => {
                const video = item.video;
                const isVertical = video?.resolution?.isVertical;
                const connectedAccounts = accounts.filter((a) => a.status === 'connected');

                return (
                  <div
                    key={item.videoId}
                    className="p-3 rounded-xl bg-slate-50/80 border border-slate-200/90 hover:border-slate-300/90 transition-all space-y-3"
                  >
                    {/* Top Row: Number, Thumbnail, Title, and Scheduled Time Input */}
                    <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
                      {/* Left: Thumbnail & Title */}
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className="w-6 h-6 rounded-full bg-slate-100 border border-slate-300 text-slate-700 font-mono text-[11px] flex items-center justify-center shrink-0 font-bold">
                          {idx + 1}
                        </div>

                        <div className="w-10 h-10 rounded-lg bg-slate-100 border border-slate-200 overflow-hidden shrink-0 flex items-center justify-center relative">
                          {video.thumbnailUrl ? (
                            <img src={video.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <Film className="w-4 h-4 text-slate-600" />
                          )}
                          {isVertical && (
                            <div className="absolute bottom-0.5 right-0.5 w-1.5 h-1.5 bg-emerald-400 rounded-full" />
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <input
                            type="text"
                            value={item.title}
                            onChange={(e) => updateBatchItem(idx, 'title', e.target.value)}
                            className="w-full bg-white/60 border border-slate-200 focus:border-indigo-500 rounded px-2 py-1 text-slate-900 font-medium text-xs truncate focus:outline-none"
                            placeholder="Video Title..."
                            title="Click to edit post title"
                          />
                          <div className="flex items-center gap-2 text-[10px] text-slate-500 mt-0.5 truncate">
                            <span className="font-mono truncate">{video.originalName}</span>
                            <span>•</span>
                            <span>{video.duration ? `${video.duration}s` : 'Short'}</span>
                          </div>
                        </div>
                      </div>

                      {/* Right: Scheduled Time Picker for this specific video */}
                      <div className="flex items-center gap-2 w-full md:w-auto shrink-0 justify-between md:justify-end">
                        <div className="flex items-center gap-1.5">
                          <label className="text-[10px] text-slate-400 whitespace-nowrap font-medium">
                            वेळ (Time):
                          </label>
                          <input
                            type="datetime-local"
                            value={item.scheduledAt}
                            onChange={(e) => updateBatchItem(idx, 'scheduledAt', e.target.value)}
                            className="bg-white border border-indigo-500/40 focus:border-indigo-400 rounded-lg px-2.5 py-1 text-indigo-800 text-xs font-mono focus:outline-none"
                            required
                          />
                        </div>

                        <button
                          type="button"
                          onClick={() => updateBatchItem(idx, 'isExpanded', !item.isExpanded)}
                          className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-800 text-[11px] cursor-pointer"
                          title="Toggle caption/hashtags details"
                        >
                          {item.isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>

                        <button
                          type="button"
                          onClick={() => removeBatchItem(idx)}
                          className="p-1 rounded hover:bg-red-50 text-slate-500 hover:text-red-400 transition-colors cursor-pointer"
                          title="Remove this video from batch"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Middle Row: Target Channel Summary & Optional Override for this specific video */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200 text-[11px]">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[10px] text-slate-400 font-medium">Publish To ({item.selectedAccountIds?.length || 0}):</span>
                        {(!item.selectedAccountIds || item.selectedAccountIds.length === 0) ? (
                          <span className="text-[10px] text-amber-500 font-medium bg-amber-50 px-2 py-0.5 rounded">
                            No channels selected (वरती चॅनेल निवडा)
                          </span>
                        ) : (
                          connectedAccounts
                            .filter((acc) => (item.selectedAccountIds || []).includes(acc._id))
                            .map((acc) => {
                              const isYt = acc.platform === 'youtube';
                              return (
                                <span
                                  key={acc._id}
                                  className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-medium ${
                                    isYt
                                      ? 'bg-red-50 text-red-700 border border-red-200'
                                      : 'bg-pink-50 text-pink-700 border border-pink-200'
                                  }`}
                                >
                                  {isYt ? (
                                    <Youtube className="w-2.5 h-2.5 text-red-500" />
                                  ) : (
                                    <Instagram className="w-2.5 h-2.5 text-pink-500" />
                                  )}
                                  <span>{acc.accountName}</span>
                                </span>
                              );
                            })
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => updateBatchItem(idx, 'isCustomizingChannels', !item.isCustomizingChannels)}
                        className="text-[10px] text-indigo-600 hover:text-indigo-800 underline font-medium cursor-pointer ml-auto"
                      >
                        {item.isCustomizingChannels ? 'Done' : 'Customize for this video'}
                      </button>
                    </div>

                    {/* Per-Video Channel Overrides (Only visible if explicitly clicked) */}
                    {item.isCustomizingChannels && (
                      <div className="p-2.5 rounded-xl bg-slate-100/70 border border-slate-200 space-y-1.5 animate-in fade-in duration-100">
                        <span className="text-[10px] text-slate-500 font-medium block">
                          या व्हिडिओंसाठी स्वतंत्र चॅनेल निवडा (Overrides default selection):
                        </span>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {connectedAccounts.map((acc) => {
                            const isYt = acc.platform === 'youtube';
                            const isSelected = (item.selectedAccountIds || []).includes(acc._id);
                            return (
                              <button
                                key={acc._id}
                                type="button"
                                onClick={() => toggleItemAccount(idx, acc._id)}
                                className={`flex items-center gap-1 px-2.5 py-1 rounded-full border text-[10px] font-medium cursor-pointer transition-colors ${
                                  isSelected
                                    ? isYt
                                      ? 'bg-red-500/20 text-red-700 border-red-500 font-semibold'
                                      : 'bg-pink-500/20 text-pink-700 border-pink-500 font-semibold'
                                    : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'
                                }`}
                              >
                                {isYt ? <Youtube className="w-2.5 h-2.5" /> : <Instagram className="w-2.5 h-2.5" />}
                                <span>{acc.accountName}</span>
                                {isSelected ? <Check className="w-2.5 h-2.5 text-emerald-600" /> : '+'}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Expanded Details: Caption & Hashtags if user wants to tweak */}
                    {item.isExpanded && (
                      <div className="space-y-2 pt-2 border-t border-slate-200/80 animate-in fade-in duration-150">
                        <div>
                          <label className="block text-[10px] text-slate-400 font-medium mb-1">
                            Caption / Instagram Description:
                          </label>
                          <textarea
                            rows={2}
                            value={item.caption}
                            onChange={(e) => updateBatchItem(idx, 'caption', e.target.value)}
                            className="w-full bg-white border border-slate-200 rounded p-2 text-slate-800 text-xs focus:outline-none"
                            placeholder="Caption..."
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] text-slate-400 font-medium mb-1">
                            Hashtags:
                          </label>
                          <input
                            type="text"
                            value={item.hashtags}
                            onChange={(e) => updateBatchItem(idx, 'hashtags', e.target.value)}
                            className="w-full bg-white border border-slate-200 rounded p-1.5 text-slate-800 text-xs focus:outline-none"
                            placeholder="#Shorts #Reels..."
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* C. Modal Footer with Summary and Dispatch Button */}
          <div className="pt-3 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="text-xs text-slate-400">
              Total to Queue:{' '}
              <strong className="text-indigo-700 font-mono">
                {batchScheduleItems.reduce((acc, it) => acc + (it.selectedAccountIds?.length || 0), 0)}
              </strong>{' '}
              dispatches across{' '}
              <strong className="text-slate-800 font-mono">{batchScheduleItems.length}</strong> videos
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
              <Button
                variant="ghost"
                size="sm"
                type="button"
                onClick={() => setBatchScheduleModalOpen(false)}
                disabled={isSubmittingBatchSchedule}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                type="submit"
                isLoading={isSubmittingBatchSchedule}
                className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 shadow-md font-semibold text-white px-5 py-2 flex items-center gap-1.5 cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Confirm & Schedule All Videos</span>
              </Button>
            </div>
          </div>
        </form>
      </Modal>

      {/* 8. Studio In-App Video Player & Inspection Modal */}
      {previewVideo && (
        <Modal
          isOpen={Boolean(previewVideo)}
          onClose={() => setPreviewVideo(null)}
          title="Video Inspection & Player"
          maxWidth="max-w-4xl"
        >
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
              {/* Video Player Column */}
              <div className="md:col-span-7 bg-slate-900 rounded-xl overflow-hidden border border-slate-200 flex flex-col items-center justify-center min-h-[360px] relative">
                <video
                  key={previewVideo._id}
                  controls
                  autoPlay
                  preload="metadata"
                  poster={previewVideo.thumbnailUrl}
                  className="w-full max-h-[460px] object-contain rounded-xl bg-slate-900"
                  src={`http://localhost:5000/api/videos/${previewVideo._id}/stream`}
                >
                  Your browser does not support HTML5 video streaming.
                </video>
              </div>

              {/* Video Specs & AI Metadata Column */}
              <div className="md:col-span-5 space-y-3">
                <div className="p-3.5 rounded-xl bg-white/60 border border-slate-200 space-y-2">
                  <h4 className="text-sm font-semibold text-slate-900 truncate">
                    {previewVideo.cleanTitle || previewVideo.originalName}
                  </h4>
                  <p className="text-xs font-mono text-slate-400 break-all">
                    {previewVideo.originalName}
                  </p>

                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-200/80 text-xs text-slate-700">
                    <div>
                      <span className="text-slate-500 block text-[10px]">Dimensions</span>
                      <span className="font-semibold text-slate-800">
                        {previewVideo.resolution?.width && previewVideo.resolution?.height
                          ? `${previewVideo.resolution.width}×${previewVideo.resolution.height}`
                          : previewVideo.resolution?.isVertical
                          ? '9:16 Vertical'
                          : 'Landscape'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[10px]">Duration</span>
                      <span className="font-semibold text-slate-800">
                        {formatDuration(previewVideo.duration)} ({previewVideo.duration || 0}s)
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[10px]">File Size</span>
                      <span className="font-semibold text-slate-800">
                        {formatBytes(previewVideo.fileSize)}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[10px]">Folder</span>
                      <span className="font-semibold text-slate-800 truncate block">
                        {videoFolderLabel(previewVideo) || 'Root'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* AI Metadata Card */}
                <div className="p-3.5 rounded-xl bg-white/60 border border-slate-200 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                      AI Metadata
                    </span>
                    {previewVideo.aiMetadata?.approvalStatus === 'approved' ? (
                      <Badge variant="success" className="text-[10px]">Approved</Badge>
                    ) : previewVideo.aiMetadata?.youtubeTitle ? (
                      <Badge variant="warning" className="text-[10px]">Draft</Badge>
                    ) : (
                      <Badge variant="neutral" className="text-[10px]">None</Badge>
                    )}
                  </div>

                  {previewVideo.aiMetadata?.youtubeTitle ? (
                    <div className="space-y-1.5 pt-1">
                      <div>
                        <span className="text-slate-500 block text-[10px]">Generated Title:</span>
                        <p className="text-slate-800 font-medium">
                          {previewVideo.aiMetadata.youtubeTitle || previewVideo.aiMetadata.generatedTitle}
                        </p>
                      </div>
                      {previewVideo.aiMetadata.instagramCaption && (
                        <div>
                          <span className="text-slate-500 block text-[10px]">Caption:</span>
                          <p className="text-slate-700 line-clamp-3 text-[11px]">
                            {previewVideo.aiMetadata.instagramCaption}
                          </p>
                        </div>
                      )}
                      {previewVideo.aiMetadata.hashtags && (
                        <div className="flex flex-wrap gap-1 pt-1">
                          {(Array.isArray(previewVideo.aiMetadata.hashtags)
                            ? previewVideo.aiMetadata.hashtags
                            : String(previewVideo.aiMetadata.hashtags).split(' ')
                          ).slice(0, 6).map((tag, idx) => (
                            <span key={idx} className="text-[10px] text-indigo-700 bg-indigo-50/60 border border-indigo-200/40 px-1.5 py-0.5 rounded">
                              {tag.startsWith('#') ? tag : `#${tag}`}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-slate-400 text-xs italic">
                      No AI title or tags generated yet for this reel.
                    </p>
                  )}
                </div>

                {/* Modal Action Buttons */}
                <div className="flex items-center justify-end gap-2 pt-2">
                  {previewVideo.driveWebViewLink && (
                    <a
                      href={previewVideo.driveWebViewLink}
                      target="_blank"
                      rel="noreferrer"
                      className="px-3 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-100 text-slate-700 text-xs flex items-center gap-1.5 transition-colors"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Drive Link
                    </a>
                  )}

                  <Button
                    variant="secondary"
                    size="sm"
                    icon={Sparkles}
                    onClick={() => {
                      const v = previewVideo;
                      setPreviewVideo(null);
                      openAiGenerator(v);
                    }}
                    className="text-xs"
                  >
                    {previewVideo.aiMetadata?.youtubeTitle ? 'Edit AI Metadata' : 'Generate AI'}
                  </Button>

                  <Button
                    variant="primary"
                    size="sm"
                    icon={Calendar}
                    onClick={() => {
                      const v = previewVideo;
                      setPreviewVideo(null);
                      openScheduleModal(v);
                    }}
                    className="text-xs bg-indigo-600 hover:bg-indigo-500"
                  >
                    Schedule Reel
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
