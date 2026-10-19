import React, { useState, useEffect } from 'react';
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
} from 'lucide-react';
import { Card, CardHeader } from '../common/Card.jsx';
import { Button } from '../common/Button.jsx';
import { Badge } from '../common/Badge.jsx';
import { EmptyState } from '../common/EmptyState.jsx';
import { Modal } from '../common/Modal.jsx';
import { api } from '../../api/client.js';

export const SocialAccountsModule = ({ accounts = [], onReload, isLoading }) => {
  const [activeTab, setActiveTab] = useState('all'); // 'all' | 'youtube' | 'instagram'
  const [sourceFilter, setSourceFilter] = useState('all'); // 'all' | 'real' | 'demo'
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [testingId, setTestingId] = useState(null);
  const [actionLoadingId, setActionLoadingId] = useState(null);
  const [isPurging, setIsPurging] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
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

  // Parse URL search parameters on mount for OAuth redirect errors or successes
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const err = params.get('error');
    const errCode = params.get('error_code');
    const enableUrlParam = params.get('enable_url');
    const projectIdParam = params.get('project_id') || '702701632845';
    const connected = params.get('connected');
    const connectedName = params.get('name');

    if (errCode || err) {
      if (errCode === 'API_NOT_ENABLED') {
        const targetEnableUrl =
          enableUrlParam ||
          `https://console.developers.google.com/apis/api/youtube.googleapis.com/overview?project=${projectIdParam}`;
        setOAuthBanner({
          type: 'api_not_enabled',
          code: 'API_NOT_ENABLED (403)',
          title: `YouTube Data API v3 Disabled in Google Cloud Project ${projectIdParam}`,
          message: `Your Google authorization was successful, but Google Cloud blocked channel discovery because the YouTube Data API v3 has not been enabled in Google Cloud Project ${projectIdParam}. Enable it in your Google Cloud Console, wait 1-2 minutes for Google quota propagation, and click "Retry Authorization".`,
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
            'You cancelled or closed the Google authorization window before granting permissions. When you are ready, click "Add Google Account" to try again.',
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
          title: 'Google OAuth Authorization Failed',
          message: err || 'An unexpected error occurred during Google account authentication.',
          primaryAction: {
            label: 'Retry Authorization',
            icon: RefreshCw,
            onClick: () => handleConnectYouTube(),
          },
        });
      }

      // Clean query string from browser URL
      window.history.replaceState({}, '', window.location.pathname);
    } else if (connected) {
      if (connected === 'instagram') {
        setSuccessMsg(`Successfully authorized and connected Instagram account "${decodeURIComponent(connectedName || 'Instagram')}"!`);
      } else {
        setSuccessMsg(`Successfully authorized and connected YouTube channel "${decodeURIComponent(connectedName || 'Channel')}"!`);
      }
      window.history.replaceState({}, '', window.location.pathname);
      if (onReload) onReload();
    }
  }, []);

  // Compute counts
  const realAccountsCount = accounts.filter((a) => !a.isDemo).length;
  const demoAccountsCount = accounts.filter((a) => a.isDemo).length;
  const ytCount = accounts.filter((a) => a.platform === 'youtube').length;
  const igCount = accounts.filter((a) => a.platform === 'instagram').length;

  // Filter accounts
  const filteredAccounts = accounts.filter((acc) => {
    if (activeTab !== 'all' && acc.platform !== activeTab) return false;
    if (statusFilter !== 'all' && acc.status !== statusFilter) return false;
    if (sourceFilter === 'real' && acc.isDemo) return false;
    if (sourceFilter === 'demo' && !acc.isDemo) return false;
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

  // Handlers for OAuth
  const handleConnectYouTube = async () => {
    try {
      setErrorMsg(null);
      setOAuthBanner(null);
      const res = await api.getGoogleAuthUrl();
      if (res.authUrl) {
        window.location.href = res.authUrl;
      }
    } catch (err) {
      setErrorMsg(`Failed to initiate YouTube OAuth: ${err.message}. Please verify GOOGLE_CLIENT_ID in backend/.env`);
    }
  };

  const handleConnectInstagram = async () => {
    try {
      setErrorMsg(null);
      setOAuthBanner(null);
      const res = await api.getMetaAuthUrl();
      if (res.authUrl) {
        window.location.href = res.authUrl;
      }
    } catch (err) {
      if (err.message && (err.message.includes('Meta App ID is not configured') || err.message.includes('Meta App credentials') || err.message.includes('Meta App'))) {
        setShowGuide(true);
        setOAuthBanner({
          type: 'config_missing',
          code: 'META_CONFIG_REQUIRED (400)',
          title: 'Meta / Instagram Developer App Not Configured',
          message:
            'To connect Instagram accounts, you must configure your Meta App ID and Secret in backend/.env. Add META_APP_ID and META_APP_SECRET, save backend/.env, and restart the backend server.',
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

  const handleTestAccount = async (account) => {
    try {
      setTestingId(account._id);
      setErrorMsg(null);
      const res = await api.testAccount(account._id);
      if (res.data?.connected) {
        setSuccessMsg(`Status verified for ${account.accountName}: ${res.data.message || 'Token is active'}`);
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

  const handlePurgeDemo = async () => {
    const count = demoAccountsCount;
    const confirmText = `Are you sure you want to remove all ${count} demo/mock channel records?\n\nReal authorized accounts and their encrypted tokens will NOT be affected.\n\nThis action cannot be undone.`;
    if (!window.confirm(confirmText)) return;

    try {
      setIsPurging(true);
      setErrorMsg(null);
      const res = await api.purgeDemoAccounts();
      setSuccessMsg(res.message || `Cleaned up ${res.deletedCount || count} demo records.`);
      if (onReload) onReload();
    } catch (err) {
      setErrorMsg(`Failed to purge demo accounts: ${err.message}`);
    } finally {
      setIsPurging(false);
    }
  };

  const handleOpenSettings = (account) => {
    setSettingsModalAccount(account);
    const s = account.settings || {};
    setSettingsForm({
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
      setSuccessMsg(`Preferences saved for ${settingsModalAccount.accountName}`);
      setSettingsModalAccount(null);
      if (onReload) onReload();
    } catch (err) {
      setErrorMsg(`Failed to save preferences: ${err.message}`);
    } finally {
      setActionLoadingId(null);
    }
  };

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
        return <Badge variant="success" dot className="capitalize text-[10px]">Connected</Badge>;
      case 'expired':
        return <Badge variant="warning" dot className="capitalize text-[10px]">Token Expired</Badge>;
      case 'authorization_required':
        return <Badge variant="warning" dot className="capitalize text-[10px]">Auth Required</Badge>;
      case 'permission_error':
        return <Badge variant="error" dot className="capitalize text-[10px]">Permission Error</Badge>;
      case 'disconnected':
        return <Badge variant="neutral" dot className="capitalize text-[10px]">Disconnected</Badge>;
      case 'error':
      default:
        return <Badge variant="error" dot className="capitalize text-[10px]">Error</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* OAuth Diagnostic Action Banner */}
      {oAuthBanner && (
        <div
          className={`p-4 rounded-xl border ${
            oAuthBanner.type === 'api_not_enabled'
              ? 'bg-amber-500/10 border-amber-500/30 text-amber-200'
              : oAuthBanner.type === 'no_channel'
              ? 'bg-sky-500/10 border-sky-500/30 text-sky-200'
              : oAuthBanner.type === 'cancelled'
              ? 'bg-slate-800/80 border-slate-700 text-slate-300'
              : oAuthBanner.type === 'config_missing'
              ? 'bg-pink-500/10 border-pink-500/30 text-pink-200'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-200'
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              {oAuthBanner.type === 'api_not_enabled' ? (
                <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              ) : oAuthBanner.type === 'no_channel' ? (
                <Info className="w-5 h-5 text-sky-400 shrink-0 mt-0.5" />
              ) : oAuthBanner.type === 'config_missing' ? (
                <Instagram className="w-5 h-5 text-pink-400 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              )}
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <h4 className="text-sm font-semibold">{oAuthBanner.title}</h4>
                  {oAuthBanner.code && (
                    <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-black/40 border border-white/10 text-slate-300">
                      {oAuthBanner.code}
                    </span>
                  )}
                </div>
                <p className="text-xs leading-relaxed opacity-90 max-w-3xl">
                  {oAuthBanner.message}
                </p>
                <div className="flex flex-wrap items-center gap-2 pt-2">
                  {oAuthBanner.primaryAction && (
                    <Button
                      variant={oAuthBanner.type === 'api_not_enabled' ? 'primary' : 'secondary'}
                      size="sm"
                      icon={oAuthBanner.primaryAction.icon}
                      onClick={oAuthBanner.primaryAction.onClick}
                      className="text-xs"
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
                      className="text-xs"
                    >
                      {oAuthBanner.secondaryAction.label}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setOAuthBanner(null)}
                    className="text-xs text-slate-400 hover:text-slate-200"
                  >
                    Dismiss
                  </Button>
                </div>
              </div>
            </div>
            <button
              onClick={() => setOAuthBanner(null)}
              className="text-slate-400 hover:text-slate-200 p-1 text-base leading-none"
            >
              &times;
            </button>
          </div>
        </div>
      )}

      {/* Alert Banners */}
      {errorMsg && (
        <div className="p-4 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button onClick={() => setErrorMsg(null)} className="text-slate-400 hover:text-slate-200">
            &times;
          </button>
        </div>
      )}

      {successMsg && (
        <div className="p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{successMsg}</span>
          </div>
          <button onClick={() => setSuccessMsg(null)} className="text-slate-400 hover:text-slate-200">
            &times;
          </button>
        </div>
      )}

      {/* Main Header Card with Multi-Account Actions */}
      <Card>
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h3 className="text-base font-semibold text-slate-100">Connected Social Channels</h3>
              <span className="text-xs px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-300">
                {realAccountsCount} Real Channels
              </span>
              {demoAccountsCount > 0 && (
                <span className="text-xs px-2 py-0.5 rounded bg-purple-500/10 border border-purple-500/20 text-purple-400">
                  {demoAccountsCount} Demo Records
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-1 max-w-xl">
              Connect real Google accounts to discover and publish to your authentic YouTube channels. Each Google account is authorized independently and all tokens are AES-256-GCM encrypted.
            </p>
          </div>

          <div className="flex items-center gap-2 w-full md:w-auto flex-wrap">
            <Button
              variant="secondary"
              size="sm"
              icon={Youtube}
              onClick={handleConnectYouTube}
              className="text-red-400 hover:text-red-300 border-red-500/20 flex-1 md:flex-initial"
              title="Authorize a Google account and discover accessible YouTube channels"
            >
              Add Google Account
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={Instagram}
              onClick={handleConnectInstagram}
              className="text-pink-400 hover:text-pink-300 border-pink-500/20 flex-1 md:flex-initial"
            >
              Add Instagram
            </Button>
            {demoAccountsCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                icon={Trash2}
                isLoading={isPurging}
                onClick={handlePurgeDemo}
                className="text-purple-400 hover:text-purple-300 hover:bg-purple-500/10 border border-purple-500/20"
                title="Purge all mock test channels from database"
              >
                Purge Demo ({demoAccountsCount})
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              icon={HelpCircle}
              onClick={() => setShowGuide(!showGuide)}
              className="text-slate-400 hover:text-slate-200"
              title="View Setup Guide"
            />
          </div>
        </div>

        {/* Collapsible Integration Guide */}
        {showGuide && (
          <div className="mt-4 pt-4 border-t border-slate-800 text-xs text-slate-400 space-y-3 bg-slate-950/60 p-4 rounded-xl border border-slate-800/60">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-slate-200 flex items-center gap-1.5">
                <Info className="w-4 h-4 text-indigo-400" />
                OAuth Setup & YouTube Data API Requirements
              </h4>
              <button onClick={() => setShowGuide(false)} className="text-slate-500 hover:text-slate-300">&times;</button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-3 bg-slate-900/80 rounded-lg border border-slate-800">
                <p className="font-medium text-red-400 flex items-center gap-1 mb-1">
                  <Youtube className="w-3.5 h-3.5" /> YouTube / Google Cloud Setup
                </p>
                <ul className="list-disc list-inside space-y-1 text-slate-400 text-[11px]">
                  <li>
                    <strong>API Enablement:</strong> YouTube Data API v3 must be enabled in Google Cloud Project{' '}
                    <code className="text-indigo-300 font-mono text-[10px]">702701632845</code>.
                  </li>
                  <li>
                    <strong>Multi-Account:</strong> Clicking <em>Add Google Account</em> presents the Google account chooser so you can authorize brand accounts or different Google emails independently.
                  </li>
                  <li>
                    <strong>Channel Discovery:</strong> Only real YouTube channels returned from the official <code className="text-slate-300 font-mono text-[10px]">channels.list(mine=true)</code> endpoint are added.
                  </li>
                </ul>
              </div>
              <div className="p-3 bg-slate-900/80 rounded-lg border border-slate-800">
                <p className="font-medium text-pink-400 flex items-center gap-1 mb-1">
                  <Instagram className="w-3.5 h-3.5" /> Instagram API with Instagram Login
                </p>
                <ul className="list-disc list-inside space-y-1.5 text-slate-400 text-[11px]">
                  <li>
                    <strong>App Credentials:</strong> Add <code className="text-pink-300 font-mono text-[10px]">META_APP_ID</code> and <code className="text-pink-300 font-mono text-[10px]">META_APP_SECRET</code> to <code className="text-slate-300 font-mono text-[10px]">backend/.env</code>.
                  </li>
                  <li>
                    <strong>OAuth Redirect URI:</strong> <code className="text-slate-300 font-mono text-[10px]">http://localhost:5000/api/accounts/meta/callback</code>
                  </li>
                  <li>
                    <strong>Professional Account:</strong> The Instagram account must be set to <strong>Professional (Business or Creator)</strong>.
                  </li>
                  <li>
                    <strong>Official Scopes:</strong> Requests <code className="text-slate-300 font-mono text-[10px]">instagram_business_basic</code> and <code className="text-slate-300 font-mono text-[10px]">instagram_business_content_publish</code>.
                  </li>
                  <li>
                    <strong>Meta App Setup:</strong> In your Meta App Dashboard under <em>Use Cases &rarr; Customize</em>, add these permissions to the app. In Development mode, ensure your Instagram user is added as an <em>Instagram Tester</em> or app Role.
                  </li>
                </ul>
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* Tabs and Search / Filters */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
        {/* Platform Tabs & Source Filter */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Platform Tabs */}
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800/80 text-xs">
            <button
              onClick={() => setActiveTab('all')}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1.5 ${
                activeTab === 'all'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Users2 className="w-3.5 h-3.5" />
              All Platforms
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-900/80 text-slate-300">
                {accounts.length}
              </span>
            </button>
            <button
              onClick={() => setActiveTab('youtube')}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1.5 ${
                activeTab === 'youtube'
                  ? 'bg-red-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Youtube className="w-3.5 h-3.5" />
              YouTube
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-900/80 text-slate-300">
                {ytCount}
              </span>
            </button>
            <button
              onClick={() => setActiveTab('instagram')}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1.5 ${
                activeTab === 'instagram'
                  ? 'bg-pink-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Instagram className="w-3.5 h-3.5" />
              Instagram
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-900/80 text-slate-300">
                {igCount}
              </span>
            </button>
          </div>

          {/* Source Segregation Filter */}
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800/80 text-xs">
            <button
              onClick={() => setSourceFilter('all')}
              className={`px-2.5 py-1 rounded-lg font-medium transition-colors ${
                sourceFilter === 'all'
                  ? 'bg-slate-800 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              All Sources ({accounts.length})
            </button>
            <button
              onClick={() => setSourceFilter('real')}
              className={`px-2.5 py-1 rounded-lg font-medium transition-colors flex items-center gap-1 ${
                sourceFilter === 'real'
                  ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/30'
                  : 'text-slate-400 hover:text-emerald-400'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              Real ({realAccountsCount})
            </button>
            <button
              onClick={() => setSourceFilter('demo')}
              className={`px-2.5 py-1 rounded-lg font-medium transition-colors flex items-center gap-1 ${
                sourceFilter === 'demo'
                  ? 'bg-purple-600/30 text-purple-300 border border-purple-500/30'
                  : 'text-slate-400 hover:text-purple-400'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />
              Demo ({demoAccountsCount})
            </button>
          </div>
        </div>

        {/* Search & Status Filters */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1 sm:w-60">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search name, ID, or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none"
          >
            <option value="all">All Statuses</option>
            <option value="connected">Connected</option>
            <option value="expired">Token Expired</option>
            <option value="authorization_required">Auth Required</option>
            <option value="permission_error">Permission Error</option>
            <option value="disconnected">Disconnected</option>
          </select>
        </div>
      </div>

      {/* Account Cards Grid */}
      {filteredAccounts.length === 0 ? (
        <Card>
          <EmptyState
            icon={Users2}
            title={
              accounts.length === 0
                ? 'No Social Channels Connected Yet'
                : sourceFilter === 'real' && realAccountsCount === 0
                ? 'No Real Social Channels Connected Yet'
                : 'No accounts match your current filter'
            }
            description={
              accounts.length === 0
                ? 'Connect multiple YouTube channels and Instagram accounts via official OAuth to enable multi-target video publishing.'
                : sourceFilter === 'real' && realAccountsCount === 0
                ? 'Click "Add Google Account" to authorize your real Google identity and discover your YouTube channels.'
                : 'Try adjusting your search query, source filter, or status filter.'
            }
            actionLabel={
              sourceFilter === 'real' && realAccountsCount === 0
                ? 'Add Google Account'
                : accounts.length === 0
                ? 'Connect YouTube Channel'
                : 'Clear Filters'
            }
            onAction={
              accounts.length === 0 || (sourceFilter === 'real' && realAccountsCount === 0)
                ? handleConnectYouTube
                : () => {
                    setSearchQuery('');
                    setStatusFilter('all');
                    setActiveTab('all');
                    setSourceFilter('all');
                  }
            }
            actionIcon={
              accounts.length === 0 || (sourceFilter === 'real' && realAccountsCount === 0)
                ? Youtube
                : RefreshCw
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredAccounts.map((acc) => {
            const isYt = acc.platform === 'youtube';
            const isAuthIssue = ['expired', 'authorization_required', 'permission_error', 'error'].includes(acc.status);

            return (
              <div
                key={acc._id}
                className={`p-4 rounded-xl bg-slate-950/40 border transition-all flex flex-col justify-between space-y-4 ${
                  isAuthIssue
                    ? 'border-amber-500/30 shadow-sm shadow-amber-500/5'
                    : acc.isDemo
                    ? 'border-slate-800/80 hover:border-purple-500/40'
                    : 'border-slate-800/80 hover:border-emerald-500/40'
                }`}
              >
                {/* Header: Avatar, Name, Platform Badge, Status */}
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                      {acc.profilePictureUrl ? (
                        <img
                          src={acc.profilePictureUrl}
                          alt={acc.accountName}
                          className="w-10 h-10 rounded-full border border-slate-700 object-cover shrink-0"
                        />
                      ) : (
                        <div
                          className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                            isYt ? 'bg-red-500/20 text-red-400' : 'bg-pink-500/20 text-pink-400'
                          }`}
                        >
                          {isYt ? <Youtube className="w-5 h-5" /> : <Instagram className="w-5 h-5" />}
                        </div>
                      )}

                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h4 className="text-sm font-semibold text-slate-100 truncate" title={acc.accountName}>
                            {acc.accountName}
                          </h4>
                        </div>
                        <p className="text-xs text-slate-400 truncate">
                          {acc.username ? `@${acc.username}` : `ID: ${acc.accountId}`}
                        </p>
                      </div>
                    </div>

                    <div className="shrink-0 flex flex-col items-end gap-1">
                      {getStatusBadge(acc.status)}
                      {acc.isDemo ? (
                        <Badge variant="purple" dot className="text-[10px]">Demo Data</Badge>
                      ) : (
                        <Badge variant="success" dot className="text-[10px]">Real Account</Badge>
                      )}
                    </div>
                  </div>

                  {/* Channel ID and Google Account display */}
                  <div className="mt-2.5 pt-2 border-t border-slate-800/40 space-y-1">
                    <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
                      <span className="text-slate-500 font-sans text-[10px]">Channel ID:</span>
                      <button
                        onClick={() => {
                          if (typeof navigator !== 'undefined' && navigator.clipboard) {
                            navigator.clipboard.writeText(acc.accountId);
                            setSuccessMsg(`Copied Channel ID ${acc.accountId} to clipboard`);
                          }
                        }}
                        className="bg-slate-900 border border-slate-800/80 hover:border-slate-700 px-1.5 py-0.5 rounded text-indigo-300 font-mono text-[10px] flex items-center gap-1 cursor-pointer transition-colors"
                        title="Click to copy Channel ID"
                      >
                        <span className="truncate max-w-[170px]">{acc.accountId}</span>
                        <Copy className="w-2.5 h-2.5 text-slate-500 shrink-0" />
                      </button>
                    </div>

                    {acc.googleEmail && (
                      <div className="flex items-center justify-between text-[11px] text-slate-400">
                        <span className="text-slate-500 text-[10px]">Google User:</span>
                        <span className="text-slate-300 text-[10px] font-medium truncate max-w-[180px]" title={acc.googleEmail}>
                          {acc.googleEmail}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Warning / Error alert banner if token has issue */}
                  {isAuthIssue && (
                    <div className="mt-3 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-300 space-y-1">
                      <div className="flex items-start gap-1.5 font-medium">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                        <span>Action Required</span>
                      </div>
                      <p className="text-[10px] text-amber-400/90 leading-tight">
                        {acc.errorMessage || 'Access token expired or unauthorized. Reconnect to restore automated publishing.'}
                      </p>
                    </div>
                  )}

                  {/* Audience & Publishing Metrics Grid */}
                  <div className="mt-3 text-[11px] text-slate-400 grid grid-cols-2 gap-2 bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/60 font-mono">
                    <div>
                      <span className="text-slate-500 text-[10px] block font-sans">Audience:</span>
                      <span className="font-medium text-slate-200">
                        {acc.metadata?.subscriberCount !== undefined
                          ? `${acc.metadata.subscriberCount.toLocaleString()} subs`
                          : acc.metadata?.instagramBusinessId
                          ? 'Business Profile'
                          : 'Connected'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 text-[10px] block font-sans">Content:</span>
                      <span className="font-medium text-slate-200">
                        {acc.metadata?.videoCount !== undefined
                          ? `${acc.metadata.videoCount.toLocaleString()} videos`
                          : 'Active'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 text-[10px] block font-sans">Published Jobs:</span>
                      <span className="font-medium text-emerald-400">
                        {acc.stats?.totalPublished || 0} posts
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 text-[10px] block font-sans">Last Synced:</span>
                      <span className="font-medium text-slate-300">
                        {acc.lastSyncedAt ? new Date(acc.lastSyncedAt).toLocaleDateString([], { month: 'short', day: 'numeric' }) : 'Never'}
                      </span>
                    </div>
                  </div>

                  {/* Account Settings preview tag */}
                  {acc.settings?.defaultTitlePrefix && (
                    <div className="mt-2 text-[10px] text-slate-400 flex items-center gap-1 truncate">
                      <span className="text-slate-500">Title Prefix:</span>
                      <code className="text-slate-300 bg-slate-900 px-1 py-0.5 rounded font-mono truncate">
                        {acc.settings.defaultTitlePrefix}
                      </code>
                    </div>
                  )}
                </div>

                {/* Footer Action Buttons */}
                <div className="pt-2 border-t border-slate-800/60 flex items-center justify-between gap-1">
                  <div className="flex items-center gap-1">
                    {/* Test & Sync Token */}
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={RefreshCw}
                      isLoading={testingId === acc._id}
                      onClick={() => handleTestAccount(acc)}
                      className="text-xs text-slate-400 hover:text-slate-200 p-1.5"
                      title="Test token and refresh subscriber count"
                    />

                    {/* Reconnect button if auth issue */}
                    {isAuthIssue && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={isYt ? handleConnectYouTube : handleConnectInstagram}
                        className="text-[11px] text-amber-400 border-amber-500/30 px-2 py-1"
                      >
                        Reconnect
                      </Button>
                    )}

                    {/* Settings Modal */}
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={Settings}
                      onClick={() => handleOpenSettings(acc)}
                      className="text-xs text-slate-400 hover:text-slate-200 p-1.5"
                      title="Configure account publishing preferences"
                    />

                    {/* History Modal */}
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={History}
                      onClick={() => handleOpenHistory(acc)}
                      className="text-xs text-slate-400 hover:text-slate-200 p-1.5"
                      title="View publishing history for this account"
                    />
                  </div>

                  {/* Disconnect Button */}
                  <Button
                    variant="danger"
                    size="sm"
                    icon={Trash2}
                    isLoading={actionLoadingId === acc._id}
                    onClick={() => handleDisconnectAccount(acc)}
                    className="text-xs p-1.5"
                    title="Disconnect account"
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Account Preferences Modal */}
      {settingsModalAccount && (
        <Modal
          isOpen={Boolean(settingsModalAccount)}
          onClose={() => setSettingsModalAccount(null)}
          title={`Publishing Preferences: ${settingsModalAccount.accountName}`}
        >
          <form onSubmit={handleSaveSettings} className="space-y-4 text-xs">
            <p className="text-xs text-slate-400">
              Configure default title formatting, hashtags, and privacy settings automatically applied when scheduling videos to this channel.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Title Prefix (Optional):</label>
                <input
                  type="text"
                  placeholder="e.g. [TECH] "
                  value={settingsForm.defaultTitlePrefix}
                  onChange={(e) => setSettingsForm({ ...settingsForm, defaultTitlePrefix: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-slate-300 font-medium mb-1">Title Suffix (Optional):</label>
                <input
                  type="text"
                  placeholder="e.g. | AutoReel"
                  value={settingsForm.defaultTitleSuffix}
                  onChange={(e) => setSettingsForm({ ...settingsForm, defaultTitleSuffix: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-slate-300 font-medium mb-1">Default Tags / Hashtags:</label>
              <input
                type="text"
                placeholder="#Shorts, #Trending, #AI"
                value={settingsForm.defaultTags}
                onChange={(e) => setSettingsForm({ ...settingsForm, defaultTags: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 focus:outline-none font-mono text-[11px]"
              />
              <span className="text-[10px] text-slate-500 mt-0.5 block">Separated by comma or space. Automatically merged with AI hashtags.</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Privacy Status:</label>
                <select
                  value={settingsForm.privacyStatus}
                  onChange={(e) => setSettingsForm({ ...settingsForm, privacyStatus: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 focus:outline-none"
                >
                  <option value="public">Public</option>
                  <option value="unlisted">Unlisted</option>
                  <option value="private">Private</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Preferred Publish Hour (UTC):</label>
                <input
                  type="number"
                  min="0"
                  max="23"
                  value={settingsForm.preferredPublishHourUtc}
                  onChange={(e) => setSettingsForm({ ...settingsForm, preferredPublishHourUtc: parseInt(e.target.value, 10) || 14 })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 focus:outline-none font-mono"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <input
                type="checkbox"
                id="isMadeForKids"
                checked={settingsForm.isMadeForKids}
                onChange={(e) => setSettingsForm({ ...settingsForm, isMadeForKids: e.target.checked })}
                className="rounded border-slate-800 text-indigo-600 focus:ring-0"
              />
              <label htmlFor="isMadeForKids" className="text-slate-300">
                Child-Directed Content (COPPA / Made for kids)
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-800">
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

      {/* Account Publishing History Modal */}
      {historyModalAccount && (
        <Modal
          isOpen={Boolean(historyModalAccount)}
          onClose={() => setHistoryModalAccount(null)}
          title={`Publishing History: ${historyModalAccount.accountName}`}
          maxWidth="max-w-2xl"
        >
          <div className="space-y-4 text-xs">
            {/* Quick Stats Banner */}
            {historyData?.stats && (
              <div className="grid grid-cols-3 gap-3 p-3 bg-slate-950 rounded-xl border border-slate-800 text-center font-mono">
                <div>
                  <span className="text-[10px] text-slate-500 block font-sans">Active Queue</span>
                  <span className="text-sm font-semibold text-indigo-400">{historyData.stats.totalScheduled}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 block font-sans">Published</span>
                  <span className="text-sm font-semibold text-emerald-400">{historyData.stats.totalPublished}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 block font-sans">Failed</span>
                  <span className="text-sm font-semibold text-rose-400">{historyData.stats.totalFailed}</span>
                </div>
              </div>
            )}

            {isHistoryLoading ? (
              <div className="p-8 text-center text-slate-500 flex items-center justify-center gap-2">
                <RefreshCw className="w-4 h-4 animate-spin" />
                Loading account publishing records...
              </div>
            ) : !historyData?.posts || historyData.posts.length === 0 ? (
              <p className="text-slate-400 text-center py-6">No scheduled or published posts for this account yet.</p>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                {historyData.posts.map((post) => (
                  <div
                    key={post._id}
                    className="p-3 bg-slate-950/60 rounded-lg border border-slate-800/80 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <h5 className="font-semibold text-slate-200 truncate text-xs">{post.title}</h5>
                      <div className="flex items-center gap-2 text-[10px] text-slate-500 mt-0.5 font-mono">
                        <Clock className="w-3 h-3 text-slate-600" />
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
                          className="text-slate-400 hover:text-slate-200"
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
