import React, { useState, useEffect, useMemo } from 'react';
import {
  Users2,
  Youtube,
  Instagram,
  Plus,
  Trash2,
  RefreshCw,
  ExternalLink,
  Shield,
  AlertTriangle,
  CheckCircle,
  Settings,
  History,
  Search,
  Filter,
  CheckCircle2,
  XCircle,
  HelpCircle,
  ChevronRight,
  Info,
  Clock,
  Send,
  Layers,
  Copy,
  Check,
  Globe,
  Sparkles,
  ArrowUpDown,
  Lock,
  Radio,
} from 'lucide-react';
import { Card, CardHeader } from '../common/Card.jsx';
import { Button } from '../common/Button.jsx';
import { Badge } from '../common/Badge.jsx';
import { EmptyState } from '../common/EmptyState.jsx';
import { Modal } from '../common/Modal.jsx';
import { ChannelAvatar } from '../common/ChannelAvatar.jsx';
import { api } from '../../api/client.js';

export const SocialAccountsModule = ({ accounts = [], onReload, isLoading }) => {
  const [activeTab, setActiveTab] = useState('all'); // 'all' | 'youtube' | 'instagram'
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortOption, setSortOption] = useState('recent'); // 'recent' | 'published_desc' | 'name_asc' | 'subs_desc'
  const [testingId, setTestingId] = useState(null);
  const [isTestingAll, setIsTestingAll] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [showGuide, setShowGuide] = useState(false);
  const [oAuthBanner, setOAuthBanner] = useState(null);

  // Settings Modal State
  const [settingsModalAccount, setSettingsModalAccount] = useState(null);
  const [settingsForm, setSettingsForm] = useState({
    defaultTitlePrefix: '',
    defaultTitleSuffix: '',
    defaultDescriptionPrefix: '',
    defaultDescriptionSuffix: '',
    defaultTags: '',
    privacyStatus: 'public',
    isMadeForKids: false,
    autoApprove: false,
    preferredPublishHourUtc: 14,
  });

  // History Modal State
  const [historyModalAccount, setHistoryModalAccount] = useState(null);
  const [historyData, setHistoryData] = useState(null);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);

  // Parse URL search parameters on mount for OAuth redirect feedback
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const err = params.get('error');
    const errCode = params.get('error_code');
    const enableUrlParam = params.get('enable_url');
    const projectIdParam = params.get('project_id') || '702701632845';
    const connected = params.get('connected');
    const connectedName = params.get('name');
    const created = params.get('created');

    if (errCode || err) {
      if (errCode === 'API_NOT_ENABLED') {
        const targetEnableUrl =
          enableUrlParam ||
          `https://console.developers.google.com/apis/api/youtube.googleapis.com/overview?project=${projectIdParam}`;
        setOAuthBanner({
          type: 'api_not_enabled',
          code: 'API_NOT_ENABLED (403)',
          title: `YouTube Data API v3 Disabled in Google Cloud Project ${projectIdParam}`,
          message: `Your Google authorization was successful, but Google Cloud blocked channel discovery because the YouTube Data API v3 has not been enabled in Project ${projectIdParam}. Enable it in your Google Cloud Console, wait 1-2 minutes for Google quota propagation, and click "Retry Authorization".`,
          primaryAction: {
            label: 'Enable YouTube Data API v3 in Console',
            icon: ExternalLink,
            onClick: () => window.open(targetEnableUrl, '_blank', 'noopener,noreferrer'),
          },
          secondaryAction: {
            label: 'Retry Authorization',
            icon: RefreshCw,
            onClick: () => handleConnectYouTube(),
          },
        });
      } else if (errCode === 'NO_CHANNEL_FOUND') {
        setOAuthBanner({
          type: 'no_channel',
          code: 'NO_CHANNEL_FOUND',
          title: 'No YouTube Channel Found for Authorized Account',
          message:
            'The authorized Google account does not have an active YouTube channel created yet. AutoReel AI requires an active YouTube channel to retrieve subscriber stats and publish Shorts.',
          primaryAction: {
            label: 'Create YouTube Channel',
            icon: ExternalLink,
            onClick: () => window.open('https://www.youtube.com/create_channel', '_blank', 'noopener,noreferrer'),
          },
          secondaryAction: {
            label: 'Sign in with Different Google Account',
            icon: Youtube,
            onClick: () => handleConnectYouTube(),
          },
        });
      } else if (errCode === 'access_denied') {
        setOAuthBanner({
          type: 'cancelled',
          code: 'AUTH_CANCELLED',
          title: 'Google Authorization Cancelled',
          message:
            'You cancelled or closed the Google authorization window before granting permissions. When you are ready, click "Add YouTube Channel" to try again.',
          primaryAction: {
            label: 'Try Again',
            icon: Youtube,
            onClick: () => handleConnectYouTube(),
          },
        });
      } else {
        setOAuthBanner({
          type: 'error',
          code: errCode || 'OAUTH_ERROR',
          title: 'OAuth Authorization Failed',
          message: err || 'An unexpected error occurred during account authentication.',
          primaryAction: {
            label: 'Retry Authorization',
            icon: RefreshCw,
            onClick: () => handleConnectYouTube(),
          },
        });
      }

      window.history.replaceState({}, '', window.location.pathname);
    } else if (connected) {
      if (connected === 'instagram') {
        const label = decodeURIComponent(connectedName || 'Instagram');
        if (created === '0') {
          setSuccessMsg(`@${label} refreshed successfully! Token is active.`);
        } else {
          setSuccessMsg(`Successfully connected Instagram account @${label}!`);
        }
      } else {
        setSuccessMsg(`Successfully connected YouTube channel "${decodeURIComponent(connectedName || 'Channel')}"!`);
      }
      window.history.replaceState({}, '', window.location.pathname);
      if (onReload) onReload();
    }
  }, []);

  // Compute stats
  const realAccounts = useMemo(() => accounts.filter((a) => !a.isDemo), [accounts]);
  const ytAccounts = useMemo(() => realAccounts.filter((a) => a.platform === 'youtube'), [realAccounts]);
  const igAccounts = useMemo(() => realAccounts.filter((a) => a.platform === 'instagram'), [realAccounts]);
  const healthyAccounts = useMemo(() => realAccounts.filter((a) => a.status === 'connected'), [realAccounts]);
  const issueAccounts = useMemo(
    () => realAccounts.filter((a) => ['expired', 'authorization_required', 'permission_error', 'error'].includes(a.status)),
    [realAccounts]
  );
  const totalPublishedPosts = useMemo(
    () => realAccounts.reduce((acc, a) => acc + (a.stats?.totalPublished || 0), 0),
    [realAccounts]
  );

  // Filter & sort accounts
  const filteredAccounts = useMemo(() => {
    let list = realAccounts.filter((acc) => {
      if (activeTab !== 'all' && acc.platform !== activeTab) return false;
      if (statusFilter !== 'all') {
        if (statusFilter === 'connected' && acc.status !== 'connected') return false;
        if (statusFilter === 'issues' && !['expired', 'authorization_required', 'permission_error', 'error'].includes(acc.status)) return false;
        if (statusFilter === 'disconnected' && acc.status !== 'disconnected') return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = (acc.accountName || '').toLowerCase().includes(q);
        const matchUser = (acc.username || '').toLowerCase().includes(q);
        const matchId = (acc.accountId || '').toLowerCase().includes(q);
        const matchEmail = (acc.googleEmail || '').toLowerCase().includes(q);
        if (!matchName && !matchUser && !matchId && !matchEmail) return false;
      }
      return true;
    });

    return list.sort((a, b) => {
      if (sortOption === 'published_desc') {
        return (b.stats?.totalPublished || 0) - (a.stats?.totalPublished || 0);
      }
      if (sortOption === 'name_asc') {
        return (a.accountName || '').localeCompare(b.accountName || '');
      }
      if (sortOption === 'subs_desc') {
        return (b.metadata?.subscriberCount || 0) - (a.metadata?.subscriberCount || 0);
      }
      // 'recent' by default
      return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    });
  }, [realAccounts, activeTab, statusFilter, searchQuery, sortOption]);

  // Connect YouTube
  const handleConnectYouTube = async () => {
    try {
      setErrorMsg(null);
      const res = await api.getYouTubeAuthUrl();
      const targetUrl = res.authUrl || res.data?.authUrl;
      if (targetUrl) {
        window.location.href = targetUrl;
      } else {
        throw new Error('Google authorization URL not returned by server.');
      }
    } catch (err) {
      setErrorMsg(`Failed to initiate Google OAuth: ${err.message}`);
    }
  };

  // Connect Instagram
  const handleConnectInstagram = async () => {
    try {
      setErrorMsg(null);
      const res = await api.getMetaAuthUrl();
      if (res.authUrl) {
        window.location.href = res.authUrl;
      }
    } catch (err) {
      if (
        err.message &&
        (err.message.includes('Meta App ID is not configured') ||
          err.message.includes('Meta App credentials') ||
          err.message.includes('Meta App'))
      ) {
        setShowGuide(true);
        setOAuthBanner({
          type: 'config_missing',
          code: 'META_CONFIG_REQUIRED (400)',
          title: 'Meta / Instagram Developer App Not Configured',
          message:
            'To connect Instagram accounts, configure META_APP_ID and META_APP_SECRET in backend/.env, and restart the backend server.',
          primaryAction: {
            label: 'Open Meta Developer Portal',
            icon: ExternalLink,
            onClick: () => window.open('https://developers.facebook.com/apps/', '_blank', 'noopener,noreferrer'),
          },
          secondaryAction: {
            label: 'View Setup Details',
            icon: Info,
            onClick: () => setShowGuide(true),
          },
        });
      } else {
        setErrorMsg(`Failed to initiate Meta OAuth: ${err.message}. Please verify META_APP_ID in backend/.env`);
      }
    }
  };

  // Test single account token
  const handleTestAccount = async (account) => {
    try {
      setTestingId(account._id);
      setErrorMsg(null);
      const res = await api.testAccount(account._id);
      if (res.data?.connected) {
        setSuccessMsg(`Status verified for ${account.accountName}: ${res.data.message || 'Token is active & valid'}`);
      } else {
        setErrorMsg(`Account status notice: ${res.data?.message || res.data?.error || 'Validation failed'}`);
      }
      if (onReload) onReload();
    } catch (err) {
      setErrorMsg(`Account check error: ${err.message}`);
    } finally {
      setTestingId(null);
    }
  };

  // Test all accounts at once
  const handleTestAllAccounts = async () => {
    if (realAccounts.length === 0) return;
    try {
      setIsTestingAll(true);
      setErrorMsg(null);
      let passed = 0;
      let failed = 0;
      for (const acc of realAccounts) {
        try {
          const res = await api.testAccount(acc._id);
          if (res.data?.connected) passed++;
          else failed++;
        } catch {
          failed++;
        }
      }
      setSuccessMsg(`Tested ${realAccounts.length} channels: ${passed} active, ${failed} issues found.`);
      if (onReload) onReload();
    } catch (err) {
      setErrorMsg(`Failed to test channels: ${err.message}`);
    } finally {
      setIsTestingAll(false);
    }
  };

  // Disconnect account
  const handleDisconnectAccount = async (account) => {
    const confirmText = `Are you sure you want to disconnect "${account.accountName}" (${account.platform.toUpperCase()})?\n\nThis will revoke token access and disable automated scheduling for this channel.`;
    if (!window.confirm(confirmText)) return;

    try {
      setActionLoadingId(account._id);
      setErrorMsg(null);
      await api.disconnectAccount(account._id);
      setSuccessMsg(`Account "${account.accountName}" disconnected successfully`);
      if (onReload) onReload();
    } catch (err) {
      setErrorMsg(`Disconnect failed: ${err.message}`);
    } finally {
      setActionLoadingId(null);
    }
  };

  // Copy Channel ID with feedback
  const handleCopyChannelId = (id) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(id);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  };

  // Open Settings modal
  const handleOpenSettings = (account) => {
    setSettingsModalAccount(account);
    const s = account.settings || {};
    setSettingsForm({
      accountName: account.accountName || '',
      profilePictureUrl: account.profilePictureUrl || '',
      defaultTitlePrefix: s.defaultTitlePrefix || '',
      defaultTitleSuffix: s.defaultTitleSuffix || '',
      defaultDescriptionPrefix: s.defaultDescriptionPrefix || '',
      defaultDescriptionSuffix: s.defaultDescriptionSuffix || '',
      defaultTags: Array.isArray(s.defaultTags) ? s.defaultTags.join(', ') : '',
      privacyStatus: s.privacyStatus || 'public',
      isMadeForKids: Boolean(s.isMadeForKids),
      autoApprove: Boolean(s.autoApprove),
      preferredPublishHourUtc: s.preferredPublishHourUtc ?? 14,
    });
  };

  // Save Settings
  const handleSaveSettings = async (e) => {
    e.preventDefault();
    if (!settingsModalAccount) return;

    try {
      setActionLoadingId(settingsModalAccount._id);
      const payload = {
        ...settingsForm,
        defaultTags: settingsForm.defaultTags
          .split(/[\s,]+/)
          .map((t) => (t.startsWith('#') ? t : `#${t}`))
          .filter((t) => t.length > 1),
      };

      await api.updateAccountPreferences(settingsModalAccount._id, payload);
      setSuccessMsg(`Preferences saved for ${settingsForm.accountName || settingsModalAccount.accountName}`);
      setSettingsModalAccount(null);
      if (onReload) onReload();
    } catch (err) {
      setErrorMsg(`Failed to save preferences: ${err.message}`);
    } finally {
      setActionLoadingId(null);
    }
  };

  // History modal
  const handleOpenHistory = async (account) => {
    setHistoryModalAccount(account);
    setIsHistoryLoading(true);
    try {
      const res = await api.getAccountHistory(account._id);
      setHistoryData(res.data);
    } catch (err) {
      setErrorMsg(`Failed to load history: ${err.message}`);
    } finally {
      setIsHistoryLoading(false);
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'connected':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-2xs">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Connected
          </span>
        );
      case 'expired':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            Token Expired
          </span>
        );
      case 'authorization_required':
      case 'permission_error':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
            Auth Required
          </span>
        );
      case 'disconnected':
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-slate-100 text-slate-600 border border-slate-200">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
            Disconnected
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. Diagnostic OAuth Error / Action Banner */}
      {oAuthBanner && (
        <div
          className={`p-4 rounded-2xl border shadow-sm ${
            oAuthBanner.type === 'api_not_enabled'
              ? 'bg-amber-50/70 border-amber-300 text-amber-900'
              : oAuthBanner.type === 'no_channel'
              ? 'bg-sky-50/70 border-sky-300 text-sky-900'
              : oAuthBanner.type === 'cancelled'
              ? 'bg-slate-50 border-slate-300 text-slate-800'
              : oAuthBanner.type === 'config_missing'
              ? 'bg-pink-50/70 border-pink-300 text-pink-900'
              : 'bg-rose-50/70 border-rose-300 text-rose-900'
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              {oAuthBanner.type === 'api_not_enabled' ? (
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              ) : oAuthBanner.type === 'no_channel' ? (
                <Info className="w-5 h-5 text-sky-600 shrink-0 mt-0.5" />
              ) : oAuthBanner.type === 'config_missing' ? (
                <Instagram className="w-5 h-5 text-pink-600 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              )}
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <h4 className="text-sm font-bold">{oAuthBanner.title}</h4>
                  {oAuthBanner.code && (
                    <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-white/80 border border-black/10 font-medium">
                      {oAuthBanner.code}
                    </span>
                  )}
                </div>
                <p className="text-xs leading-relaxed opacity-90 max-w-3xl">{oAuthBanner.message}</p>
                <div className="flex flex-wrap items-center gap-2 pt-2">
                  {oAuthBanner.primaryAction && (
                    <Button
                      variant={oAuthBanner.type === 'api_not_enabled' ? 'primary' : 'secondary'}
                      size="sm"
                      icon={oAuthBanner.primaryAction.icon}
                      onClick={oAuthBanner.primaryAction.onClick}
                      className="text-xs font-semibold"
                    >
                      {oAuthBanner.primaryAction.label}
                    </Button>
                  )}
                  {oAuthBanner.secondaryAction && (
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={oAuthBanner.secondaryAction.icon}
                      onClick={oAuthBanner.secondaryAction.onClick}
                      className="text-xs font-medium"
                    >
                      {oAuthBanner.secondaryAction.label}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setOAuthBanner(null)}
                    className="text-xs text-slate-500 hover:text-slate-800"
                  >
                    Dismiss
                  </Button>
                </div>
              </div>
            </div>
            <button
              onClick={() => setOAuthBanner(null)}
              className="text-slate-400 hover:text-slate-800 p-1 text-base leading-none cursor-pointer"
            >
              &times;
            </button>
          </div>
        </div>
      )}

      {/* Alert Banners */}
      {errorMsg && (
        <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center justify-between shadow-2xs">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button onClick={() => setErrorMsg(null)} className="text-slate-400 hover:text-slate-700 cursor-pointer">
            &times;
          </button>
        </div>
      )}

      {successMsg && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs flex items-center justify-between shadow-2xs">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" />
            <span>{successMsg}</span>
          </div>
          <button onClick={() => setSuccessMsg(null)} className="text-slate-400 hover:text-slate-700 cursor-pointer">
            &times;
          </button>
        </div>
      )}

      {/* 2. Interactive Channel Metrics Ribbon */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3.5 rounded-2xl border border-slate-200 bg-white shadow-2xs flex items-center justify-between">
          <div>
            <span className="text-[11px] font-medium text-slate-500 block">Total Channels</span>
            <span className="text-xl font-bold text-slate-900 mt-0.5 block">{realAccounts.length}</span>
            <span className="text-[10px] text-slate-400">Connected destinations</span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
            <Users2 className="w-5 h-5" />
          </div>
        </div>

        <div className="p-3.5 rounded-2xl border border-red-100 bg-gradient-to-br from-white to-red-50/30 shadow-2xs flex items-center justify-between">
          <div>
            <span className="text-[11px] font-medium text-slate-500 block">YouTube Channels</span>
            <span className="text-xl font-bold text-red-700 mt-0.5 block">{ytAccounts.length}</span>
            <span className="text-[10px] text-red-600/70">Shorts / Video publishing</span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-red-100 text-red-600 flex items-center justify-center shrink-0">
            <Youtube className="w-5 h-5" />
          </div>
        </div>

        <div className="p-3.5 rounded-2xl border border-pink-100 bg-gradient-to-br from-white to-pink-50/30 shadow-2xs flex items-center justify-between">
          <div>
            <span className="text-[11px] font-medium text-slate-500 block">Instagram Accounts</span>
            <span className="text-xl font-bold text-pink-700 mt-0.5 block">{igAccounts.length}</span>
            <span className="text-[10px] text-pink-600/70">Reels auto-publishing</span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-pink-100 text-pink-600 flex items-center justify-center shrink-0">
            <Instagram className="w-5 h-5" />
          </div>
        </div>

        <div className="p-3.5 rounded-2xl border border-slate-200 bg-white shadow-2xs flex items-center justify-between">
          <div>
            <span className="text-[11px] font-medium text-slate-500 block">Total Posts Published</span>
            <span className="text-xl font-bold text-emerald-600 mt-0.5 block">{totalPublishedPosts}</span>
            <span className="text-[10px] text-slate-400">Across all destinations</span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* 3. Dedicated Platform Connection Hub */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* YouTube Connection Card */}
        <div className="p-4 sm:p-5 rounded-2xl border border-red-200/80 bg-gradient-to-br from-white via-white to-red-50/40 shadow-xs flex flex-col justify-between space-y-4">
          <div className="flex items-start gap-3.5">
            <div className="w-11 h-11 rounded-2xl bg-red-600 text-white flex items-center justify-center shrink-0 shadow-md shadow-red-500/20">
              <Youtube className="w-6 h-6" />
            </div>
            <div className="space-y-1 min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-slate-900">Connect YouTube Channel</h3>
                <span className="text-[10px] font-semibold text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
                  Official API v3
                </span>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                Connect your YouTube brand or personal channel via Google OAuth. Supports unlimited Shorts & direct video uploads with official quota compliance.
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-red-100 text-xs">
            <span className="text-[11px] text-slate-400 flex items-center gap-1 font-medium">
              <Shield className="w-3.5 h-3.5 text-emerald-500" />
              AES-256 encrypted tokens
            </span>
            <Button
              variant="primary"
              size="sm"
              icon={Plus}
              onClick={handleConnectYouTube}
              className="bg-red-600 hover:bg-red-700 text-white font-semibold text-xs shadow-sm shadow-red-600/30 px-4 py-2 cursor-pointer"
            >
              Add YouTube Channel
            </Button>
          </div>
        </div>

        {/* Instagram Connection Card */}
        <div className="p-4 sm:p-5 rounded-2xl border border-pink-200/80 bg-gradient-to-br from-white via-white to-pink-50/40 shadow-xs flex flex-col justify-between space-y-4">
          <div className="flex items-start gap-3.5">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-amber-500 via-pink-600 to-purple-600 text-white flex items-center justify-center shrink-0 shadow-md shadow-pink-500/20">
              <Instagram className="w-6 h-6" />
            </div>
            <div className="space-y-1 min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-slate-900">Connect Instagram Account</h3>
                <span className="text-[10px] font-semibold text-pink-600 bg-pink-50 border border-pink-200 px-2 py-0.5 rounded-full">
                  Meta Graph API
                </span>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                Connect your Instagram Professional (Business or Creator) account. Enables automated 9:16 vertical Reels publishing with custom captions & hashtags.
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-pink-100 text-xs">
            <button
              type="button"
              onClick={() => setShowGuide(!showGuide)}
              className="text-[11px] text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1 cursor-pointer"
            >
              <Info className="w-3.5 h-3.5" />
              Requirements guide
            </button>
            <Button
              variant="primary"
              size="sm"
              icon={Plus}
              onClick={handleConnectInstagram}
              className="bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-700 hover:to-purple-700 text-white font-semibold text-xs shadow-sm shadow-pink-600/30 px-4 py-2 cursor-pointer"
            >
              Add Instagram Account
            </Button>
          </div>
        </div>
      </div>

      {/* Collapsible Integration Guide */}
      {showGuide && (
        <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50/80 text-xs space-y-3 animate-in fade-in duration-150">
          <div className="flex items-center justify-between border-b border-slate-200 pb-2">
            <h4 className="font-bold text-slate-900 flex items-center gap-2">
              <Info className="w-4 h-4 text-indigo-500" />
              API Requirements & Setup Guidelines
            </h4>
            <button onClick={() => setShowGuide(false)} className="text-slate-400 hover:text-slate-700 text-sm font-bold cursor-pointer">
              &times;
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-3.5 bg-white rounded-xl border border-slate-200 space-y-1.5">
              <p className="font-bold text-red-600 flex items-center gap-1.5">
                <Youtube className="w-4 h-4" /> YouTube API Requirements
              </p>
              <ul className="list-disc list-inside space-y-1 text-slate-600 text-[11px] leading-relaxed">
                <li>YouTube Data API v3 must be enabled in your Google Cloud Project.</li>
                <li>Each "Add YouTube" click shows Google account chooser so you can connect multiple brand channels independently.</li>
                <li>Only real YouTube channels with active uploads permission are registered.</li>
              </ul>
            </div>
            <div className="p-3.5 bg-white rounded-xl border border-slate-200 space-y-1.5">
              <p className="font-bold text-pink-600 flex items-center gap-1.5">
                <Instagram className="w-4 h-4" /> Instagram API Requirements
              </p>
              <ul className="list-disc list-inside space-y-1 text-slate-600 text-[11px] leading-relaxed">
                <li>Instagram account must be set to <strong>Professional (Creator or Business)</strong> in the Instagram app.</li>
                <li>Requires <code className="text-pink-600 font-mono text-[10px]">META_APP_ID</code> & <code className="text-pink-600 font-mono text-[10px]">META_APP_SECRET</code> in <code className="text-slate-700 font-mono text-[10px]">backend/.env</code>.</li>
                <li>In Development mode, ensure your Instagram user is added as an <em>Instagram Tester</em> in Meta Developer Dashboard.</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* 4. Controls: Tabs, Search, Status Filter & Test All Action */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 pt-1">
        {/* Platform Tabs */}
        <div className="flex items-center gap-1.5 p-1 rounded-xl bg-slate-100 border border-slate-200 text-xs">
          <button
            type="button"
            onClick={() => setActiveTab('all')}
            className={`px-3 py-1.5 rounded-lg font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'all'
                ? 'bg-white text-indigo-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Users2 className="w-3.5 h-3.5" />
            <span>All Platforms</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-200 text-slate-700 font-bold">
              {realAccounts.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('youtube')}
            className={`px-3 py-1.5 rounded-lg font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'youtube'
                ? 'bg-red-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-red-700'
            }`}
          >
            <Youtube className="w-3.5 h-3.5" />
            <span>YouTube</span>
            <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${activeTab === 'youtube' ? 'bg-red-700 text-white' : 'bg-slate-200 text-slate-700'}`}>
              {ytAccounts.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('instagram')}
            className={`px-3 py-1.5 rounded-lg font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'instagram'
                ? 'bg-pink-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-pink-700'
            }`}
          >
            <Instagram className="w-3.5 h-3.5" />
            <span>Instagram</span>
            <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${activeTab === 'instagram' ? 'bg-pink-700 text-white' : 'bg-slate-200 text-slate-700'}`}>
              {igAccounts.length}
            </span>
          </button>
        </div>

        {/* Search, Filter & Quick Test All Button */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Search Bar */}
          <div className="relative flex-1 sm:w-56">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search channel or username..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-white border border-slate-200 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-indigo-500 shadow-2xs"
            />
          </div>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 focus:outline-none font-medium shadow-2xs cursor-pointer"
          >
            <option value="all">All Statuses ({realAccounts.length})</option>
            <option value="connected">Connected ({healthyAccounts.length})</option>
            <option value="issues">Needs Action ({issueAccounts.length})</option>
            <option value="disconnected">Disconnected</option>
          </select>

          {/* Sort Dropdown */}
          <select
            value={sortOption}
            onChange={(e) => setSortOption(e.target.value)}
            className="bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 focus:outline-none font-medium shadow-2xs cursor-pointer"
          >
            <option value="recent">Recently Added</option>
            <option value="published_desc">Most Published</option>
            <option value="subs_desc">Audience Size</option>
            <option value="name_asc">Name (A to Z)</option>
          </select>

          {/* 1-Click Test All Tokens Button */}
          {realAccounts.length > 0 && (
            <Button
              variant="secondary"
              size="sm"
              icon={RefreshCw}
              isLoading={isTestingAll}
              onClick={handleTestAllAccounts}
              className="text-xs font-semibold py-1.5 bg-white border-slate-200 text-slate-700 hover:text-indigo-600 shadow-2xs cursor-pointer"
              title="Test OAuth tokens for all connected channels"
            >
              Check All
            </Button>
          )}
        </div>
      </div>

      {/* 5. Connected Account Cards Grid */}
      {filteredAccounts.length === 0 ? (
        <Card className="text-center py-12">
          <EmptyState
            icon={Users2}
            title={
              realAccounts.length === 0
                ? 'No Social Channels Connected Yet'
                : 'No Channels Match Your Filter'
            }
            description={
              realAccounts.length === 0
                ? 'Connect your YouTube channels and Instagram accounts above using official OAuth to start automated publishing.'
                : 'Try adjusting your search query or status filter.'
            }
            actionLabel={realAccounts.length === 0 ? 'Add YouTube Channel' : 'Reset Filters'}
            onAction={
              realAccounts.length === 0
                ? handleConnectYouTube
                : () => {
                    setSearchQuery('');
                    setStatusFilter('all');
                    setActiveTab('all');
                  }
            }
            actionIcon={realAccounts.length === 0 ? Youtube : RefreshCw}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredAccounts.map((acc) => {
            const isYt = acc.platform === 'youtube';
            const isAuthIssue = ['expired', 'authorization_required', 'permission_error', 'error'].includes(acc.status);
            const channelUrl = isYt
              ? acc.accountId?.startsWith('UC')
                ? `https://www.youtube.com/channel/${acc.accountId}`
                : acc.username
                ? `https://www.youtube.com/@${acc.username}`
                : null
              : acc.username
              ? `https://www.instagram.com/${acc.username}/`
              : null;

            return (
              <div
                key={acc._id}
                className={`rounded-2xl bg-white border transition-all duration-150 flex flex-col justify-between overflow-hidden shadow-2xs hover:shadow-md hover:-translate-y-0.5 ${
                  isAuthIssue
                    ? 'border-amber-300 ring-2 ring-amber-400/20'
                    : isYt
                    ? 'border-slate-200 hover:border-red-300'
                    : 'border-slate-200 hover:border-pink-300'
                }`}
              >
                {/* Brand Accent Top Stripe */}
                <div
                  className={`h-1.5 w-full ${
                    isYt
                      ? 'bg-red-600'
                      : 'bg-gradient-to-r from-amber-500 via-pink-600 to-purple-600'
                  }`}
                />

                <div className="p-4 space-y-3.5 flex-1">
                  {/* Top: Avatar, Name, Handle, Status */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      {/* Avatar with Platform Emblem */}
                      <ChannelAvatar
                        account={acc}
                        size="lg"
                        showBadge={true}
                      />

                      {/* Name & Handle */}
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          {channelUrl ? (
                            <a
                              href={channelUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-sm font-bold text-slate-900 hover:text-indigo-600 transition-colors truncate flex items-center gap-1"
                              title="Open live channel"
                            >
                              <span className="truncate">{acc.accountName}</span>
                              <ExternalLink className="w-3 h-3 text-slate-400 shrink-0" />
                            </a>
                          ) : (
                            <h4 className="text-sm font-bold text-slate-900 truncate" title={acc.accountName}>
                              {acc.accountName}
                            </h4>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 truncate font-mono">
                          {acc.username ? `@${acc.username}` : `ID: ${acc.accountId?.slice(0, 16)}...`}
                        </p>
                      </div>
                    </div>

                    {/* Status Badge */}
                    <div className="shrink-0">{getStatusBadge(acc.status)}</div>
                  </div>

                  {/* Channel ID & Google/Meta Info Bar */}
                  <div className="p-2.5 rounded-xl bg-slate-50/80 border border-slate-200/80 space-y-1.5 text-[11px]">
                    <div className="flex items-center justify-between font-mono">
                      <span className="text-slate-500 font-sans text-[10px]">Destination ID:</span>
                      <button
                        type="button"
                        onClick={() => handleCopyChannelId(acc.accountId)}
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white border border-slate-200 hover:border-indigo-400 text-indigo-700 text-[10px] transition-colors cursor-pointer"
                        title="Click to copy ID"
                      >
                        <span className="truncate max-w-[150px]">{acc.accountId}</span>
                        {copiedId === acc.accountId ? (
                          <Check className="w-3 h-3 text-emerald-600 shrink-0" />
                        ) : (
                          <Copy className="w-3 h-3 text-slate-400 shrink-0" />
                        )}
                      </button>
                    </div>

                    {acc.googleEmail && (
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-500 text-[10px]">Google User:</span>
                        <span className="text-slate-700 text-[10px] font-medium truncate max-w-[180px]" title={acc.googleEmail}>
                          {acc.googleEmail}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Auth Issue Alert Box if expired */}
                  {isAuthIssue && (
                    <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-900 space-y-2">
                      <div className="flex items-start gap-1.5 font-semibold text-amber-800">
                        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                        <span>Token Authorization Required</span>
                      </div>
                      <p className="text-[10px] text-amber-700 leading-tight">
                        {acc.errorMessage || 'Access token expired or revoked. Reconnect to resume scheduled publishing.'}
                      </p>
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={RefreshCw}
                        onClick={isYt ? handleConnectYouTube : handleConnectInstagram}
                        className="w-full text-xs font-semibold py-1 bg-white border-amber-300 text-amber-900 hover:bg-amber-100/50 cursor-pointer"
                      >
                        Reconnect Account
                      </Button>
                    </div>
                  )}

                  {/* 4-Box Metrics Grid */}
                  <div className="grid grid-cols-2 gap-2 text-[11px] bg-slate-50/60 p-2.5 rounded-xl border border-slate-200/70">
                    <div className="p-1.5 rounded-lg bg-white border border-slate-200/80">
                      <span className="text-[10px] text-slate-500 block">Audience</span>
                      <span className="font-bold text-slate-900 text-xs">
                        {acc.metadata?.subscriberCount !== undefined
                          ? `${Number(acc.metadata.subscriberCount).toLocaleString()} subs`
                          : isYt
                          ? 'Active Channel'
                          : 'Professional Profile'}
                      </span>
                    </div>

                    <div className="p-1.5 rounded-lg bg-white border border-slate-200/80">
                      <span className="text-[10px] text-slate-500 block">Published</span>
                      <span className="font-bold text-emerald-600 text-xs">
                        {acc.stats?.totalPublished || 0} posts
                      </span>
                    </div>

                    <div className="p-1.5 rounded-lg bg-white border border-slate-200/80">
                      <span className="text-[10px] text-slate-500 block">Channel Content</span>
                      <span className="font-bold text-slate-800 text-xs">
                        {acc.metadata?.videoCount !== undefined
                          ? `${Number(acc.metadata.videoCount).toLocaleString()} videos`
                          : 'Live'}
                      </span>
                    </div>

                    <div className="p-1.5 rounded-lg bg-white border border-slate-200/80">
                      <span className="text-[10px] text-slate-500 block">Token Security</span>
                      <span className="font-bold text-indigo-700 text-xs flex items-center gap-1">
                        <Lock className="w-2.5 h-2.5 text-indigo-500" />
                        AES-256
                      </span>
                    </div>
                  </div>

                  {/* Preset Prefix Tags preview if set */}
                  {acc.settings?.defaultTitlePrefix && (
                    <div className="text-[10px] text-slate-500 flex items-center gap-1.5 truncate">
                      <span className="font-medium text-slate-400">Prefix:</span>
                      <code className="text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded font-mono truncate">
                        {acc.settings.defaultTitlePrefix}
                      </code>
                    </div>
                  )}
                </div>

                {/* Footer Action Buttons */}
                <div className="p-3 bg-slate-50/70 border-t border-slate-200/80 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    {/* Test & Sync Token */}
                    <button
                      type="button"
                      onClick={() => handleTestAccount(acc)}
                      disabled={testingId === acc._id}
                      className="px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 hover:border-slate-300 text-slate-700 hover:text-indigo-600 text-xs font-medium flex items-center gap-1 shadow-2xs cursor-pointer transition-colors"
                      title="Test token and refresh subscriber count"
                    >
                      <RefreshCw className={`w-3 h-3 ${testingId === acc._id ? 'animate-spin text-indigo-600' : ''}`} />
                      <span>Sync</span>
                    </button>

                    {/* Settings Modal */}
                    <button
                      type="button"
                      onClick={() => handleOpenSettings(acc)}
                      className="px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 hover:border-slate-300 text-slate-700 hover:text-indigo-600 text-xs font-medium flex items-center gap-1 shadow-2xs cursor-pointer transition-colors"
                      title="Configure default title, hashtags & publishing preferences"
                    >
                      <Settings className="w-3 h-3" />
                      <span>Settings</span>
                    </button>

                    {/* History Modal */}
                    <button
                      type="button"
                      onClick={() => handleOpenHistory(acc)}
                      className="px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 hover:border-slate-300 text-slate-700 hover:text-indigo-600 text-xs font-medium flex items-center gap-1 shadow-2xs cursor-pointer transition-colors"
                      title="View publishing history for this account"
                    >
                      <History className="w-3 h-3" />
                      <span>History</span>
                    </button>
                  </div>

                  {/* Disconnect Button */}
                  <button
                    type="button"
                    onClick={() => handleDisconnectAccount(acc)}
                    disabled={actionLoadingId === acc._id}
                    className="p-1.5 rounded-lg bg-white border border-slate-200 hover:border-rose-300 text-slate-400 hover:text-rose-600 text-xs transition-colors cursor-pointer shadow-2xs"
                    title="Disconnect this channel"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 6. Account Publishing Preferences Modal */}
      {settingsModalAccount && (
        <Modal
          isOpen={Boolean(settingsModalAccount)}
          onClose={() => setSettingsModalAccount(null)}
          title={`Publishing Preferences: ${settingsModalAccount.accountName}`}
        >
          <form onSubmit={handleSaveSettings} className="space-y-4 text-xs">
            {/* Live Profile Header Card */}
            <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
              <ChannelAvatar
                name={settingsForm.accountName || settingsModalAccount.accountName}
                platform={settingsModalAccount.platform}
                profilePictureUrl={settingsForm.profilePictureUrl}
                size="lg"
                showBadge={true}
              />
              <div className="min-w-0 flex-1">
                <h4 className="font-bold text-slate-900 text-sm truncate">
                  {settingsForm.accountName || settingsModalAccount.accountName}
                </h4>
                <p className="text-[11px] text-slate-500 font-mono">
                  {settingsModalAccount.platform === 'youtube' ? 'YouTube Channel' : 'Instagram Account'} • ID: {settingsModalAccount.accountId}
                </p>
              </div>
            </div>

            {/* Account Name & Avatar URL */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-800 font-semibold mb-1">Channel Display Name:</label>
                <input
                  type="text"
                  value={settingsForm.accountName}
                  onChange={(e) => setSettingsForm({ ...settingsForm, accountName: e.target.value })}
                  className="w-full bg-white border border-slate-200 rounded-lg p-2.5 text-slate-800 focus:outline-none focus:border-indigo-500 shadow-2xs font-medium"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-slate-800 font-semibold">Custom Profile Picture URL:</label>
                  {settingsForm.profilePictureUrl && (
                    <button
                      type="button"
                      onClick={() => setSettingsForm({ ...settingsForm, profilePictureUrl: '' })}
                      className="text-[10px] text-indigo-600 hover:text-indigo-800 cursor-pointer"
                    >
                      Clear
                    </button>
                  )}
                </div>
                <input
                  type="url"
                  placeholder="https://... (or leave blank for gradient)"
                  value={settingsForm.profilePictureUrl}
                  onChange={(e) => setSettingsForm({ ...settingsForm, profilePictureUrl: e.target.value })}
                  className="w-full bg-white border border-slate-200 rounded-lg p-2.5 text-slate-800 focus:outline-none focus:border-indigo-500 shadow-2xs text-xs font-mono"
                />
              </div>
            </div>

            <p className="text-xs text-slate-500">
              Configure automated title prefixes, default tags, and privacy settings applied whenever scheduling videos to this channel.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-800 font-semibold mb-1">Title Prefix (Optional):</label>
                <input
                  type="text"
                  placeholder="e.g. [TECH] "
                  value={settingsForm.defaultTitlePrefix}
                  onChange={(e) => setSettingsForm({ ...settingsForm, defaultTitlePrefix: e.target.value })}
                  className="w-full bg-white border border-slate-200 rounded-lg p-2.5 text-slate-800 focus:outline-none focus:border-indigo-500 shadow-2xs"
                />
              </div>
              <div>
                <label className="block text-slate-800 font-semibold mb-1">Title Suffix (Optional):</label>
                <input
                  type="text"
                  placeholder="e.g. | AutoReel"
                  value={settingsForm.defaultTitleSuffix}
                  onChange={(e) => setSettingsForm({ ...settingsForm, defaultTitleSuffix: e.target.value })}
                  className="w-full bg-white border border-slate-200 rounded-lg p-2.5 text-slate-800 focus:outline-none focus:border-indigo-500 shadow-2xs"
                />
              </div>
            </div>

            <div>
              <label className="block text-slate-800 font-semibold mb-1">Default Tags / Hashtags:</label>
              <input
                type="text"
                placeholder="#Shorts, #Trending, #Viral"
                value={settingsForm.defaultTags}
                onChange={(e) => setSettingsForm({ ...settingsForm, defaultTags: e.target.value })}
                className="w-full bg-white border border-slate-200 rounded-lg p-2.5 text-slate-800 focus:outline-none focus:border-indigo-500 font-mono text-xs shadow-2xs"
              />
              <span className="text-[10px] text-slate-400 mt-1 block">Separated by comma or space. Automatically merged with AI hashtags.</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-800 font-semibold mb-1">Privacy Status:</label>
                <select
                  value={settingsForm.privacyStatus}
                  onChange={(e) => setSettingsForm({ ...settingsForm, privacyStatus: e.target.value })}
                  className="w-full bg-white border border-slate-200 rounded-lg p-2.5 text-slate-800 focus:outline-none focus:border-indigo-500 cursor-pointer shadow-2xs"
                >
                  <option value="public">Public (Immediate Visibility)</option>
                  <option value="unlisted">Unlisted (Link Only)</option>
                  <option value="private">Private (Only You)</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-800 font-semibold mb-1">Preferred Publish Hour (UTC):</label>
                <input
                  type="number"
                  min="0"
                  max="23"
                  value={settingsForm.preferredPublishHourUtc}
                  onChange={(e) => setSettingsForm({ ...settingsForm, preferredPublishHourUtc: parseInt(e.target.value, 10) || 14 })}
                  className="w-full bg-white border border-slate-200 rounded-lg p-2.5 text-slate-800 focus:outline-none focus:border-indigo-500 font-mono shadow-2xs"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                id="isMadeForKids"
                checked={settingsForm.isMadeForKids}
                onChange={(e) => setSettingsForm({ ...settingsForm, isMadeForKids: e.target.checked })}
                className="rounded border-slate-300 text-indigo-600 focus:ring-0 cursor-pointer"
              />
              <label htmlFor="isMadeForKids" className="text-slate-700 cursor-pointer">
                Child-Directed Content (COPPA / Made for kids)
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-200">
              <Button variant="ghost" size="sm" type="button" onClick={() => setSettingsModalAccount(null)}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" type="submit" isLoading={actionLoadingId === settingsModalAccount._id}>
                Save Preferences
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* 7. Account Publishing History Modal */}
      {historyModalAccount && (
        <Modal
          isOpen={Boolean(historyModalAccount)}
          onClose={() => setHistoryModalAccount(null)}
          title={`Publishing History: ${historyModalAccount.accountName}`}
          maxWidth="max-w-2xl"
        >
          <div className="space-y-4 text-xs">
            {historyData?.stats && (
              <div className="grid grid-cols-3 gap-3 p-3.5 bg-slate-50 rounded-2xl border border-slate-200 text-center font-mono">
                <div>
                  <span className="text-[10px] text-slate-500 block font-sans">Active Queue</span>
                  <span className="text-base font-bold text-indigo-600">{historyData.stats.totalScheduled}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 block font-sans">Published</span>
                  <span className="text-base font-bold text-emerald-600">{historyData.stats.totalPublished}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 block font-sans">Failed</span>
                  <span className="text-base font-bold text-rose-600">{historyData.stats.totalFailed}</span>
                </div>
              </div>
            )}

            {isHistoryLoading ? (
              <div className="p-8 text-center text-slate-500 flex items-center justify-center gap-2">
                <RefreshCw className="w-4 h-4 animate-spin text-indigo-600" />
                Loading publishing records...
              </div>
            ) : !historyData?.posts || historyData.posts.length === 0 ? (
              <p className="text-slate-500 text-center py-6">No scheduled or published posts for this account yet.</p>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                {historyData.posts.map((post) => (
                  <div
                    key={post._id}
                    className="p-3 bg-white rounded-xl border border-slate-200 flex items-center justify-between gap-3 shadow-2xs"
                  >
                    <div className="min-w-0">
                      <h5 className="font-semibold text-slate-900 truncate text-xs">{post.title}</h5>
                      <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5 font-mono">
                        <Clock className="w-3 h-3 text-slate-400" />
                        <span>{new Date(post.scheduledAt).toLocaleString()}</span>
                        <span>({post.timezone || 'UTC'})</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {getStatusBadge(post.status)}
                      {post.publishDetails?.externalUrl && (
                        <a
                          href={post.publishDetails.externalUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="p-1 rounded text-slate-400 hover:text-indigo-600 transition-colors"
                          title="View live post"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
};
