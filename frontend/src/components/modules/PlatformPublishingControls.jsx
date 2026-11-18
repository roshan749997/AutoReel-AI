import React, { useCallback, useEffect, useState } from 'react';
import { Power, Loader2, CheckCircle2, AlertCircle, Youtube, Instagram } from 'lucide-react';
import { Card, CardHeader } from '../common/Card.jsx';
import { Badge } from '../common/Badge.jsx';
import { api } from '../../api/client.js';

const PLATFORM_META = {
  youtube: {
    label: 'YouTube',
    Icon: Youtube,
    accentOn: 'bg-rose-500/10 text-rose-600 border-rose-500/20',
    accentOff: 'bg-slate-100 text-slate-500 border-slate-200',
    descriptionOn: 'Scheduled Shorts uploads and retries are ACTIVE. Queue workers may publish to connected YouTube channels.',
    descriptionOff: 'YouTube publishing is STOPPED. Pending YouTube posts are paused (not deleted). Accounts and OAuth tokens stay connected.',
  },
  instagram: {
    label: 'Instagram',
    Icon: Instagram,
    accentOn: 'bg-fuchsia-500/10 text-fuchsia-600 border-fuchsia-500/20',
    accentOff: 'bg-slate-100 text-slate-500 border-slate-200',
    descriptionOn: 'Reel publishing and retries are ACTIVE. Multi-account Instagram queue processing continues normally.',
    descriptionOff: 'Instagram publishing is STOPPED. Pending Reels are paused (not deleted). Connected accounts and tokens are preserved.',
  },
};

function formatUpdatedAt(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return String(value);
  }
}

export const PlatformPublishingControls = () => {
  const [platforms, setPlatforms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pendingPlatform, setPendingPlatform] = useState(null);
  const [toast, setToast] = useState(null);
  const [confirmTarget, setConfirmTarget] = useState(null);

  const showToast = useCallback((success, message) => {
    setToast({ success, message });
    window.clearTimeout(showToast._timer);
    showToast._timer = window.setTimeout(() => setToast(null), 4500);
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.getPlatformPublishingSettings();
      setPlatforms(res?.data?.platforms || []);
    } catch (err) {
      showToast(false, err.message || 'Failed to load platform publishing settings');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const applyToggle = async (platform, nextEnabled) => {
    setPendingPlatform(platform);
    setConfirmTarget(null);
    try {
      const res = await api.setPlatformPublishing(platform, nextEnabled, 'admin');
      const updated = res?.data?.setting;
      setPlatforms((prev) =>
        prev.map((p) => (p.platform === platform ? { ...p, ...updated } : p))
      );
      const paused = res?.data?.pausedCount || 0;
      const resumed = res?.data?.resumedCount || 0;
      const label = PLATFORM_META[platform]?.label || platform;
      if (nextEnabled) {
        showToast(
          true,
          `${label} publishing ENABLED.${resumed ? ` Resumed ${resumed} paused post(s).` : ''}`
        );
      } else {
        showToast(
          true,
          `${label} publishing STOPPED.${paused ? ` Paused ${paused} pending post(s).` : ''}`
        );
      }
    } catch (err) {
      showToast(false, err.message || 'Failed to update platform publishing setting');
      await loadSettings();
    } finally {
      setPendingPlatform(null);
    }
  };

  const onToggleClick = (platformKey, currentlyEnabled) => {
    if (pendingPlatform) return;
    if (currentlyEnabled) {
      setConfirmTarget({ platform: platformKey, nextEnabled: false });
      return;
    }
    applyToggle(platformKey, true);
  };

  const ordered = ['youtube', 'instagram'].map(
    (key) =>
      platforms.find((p) => p.platform === key) || {
        platform: key,
        publishingEnabled: true,
        status: 'ACTIVE',
        updatedAt: null,
        updatedBy: 'system',
      }
  );

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Platform Publishing Controls"
        subtitle="Independently start or stop YouTube and Instagram publishing. Changes are enforced by the backend scheduler."
        action={
          <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
            <Power className="w-3.5 h-3.5" />
            Kill switches
          </div>
        }
      />

      {toast && (
        <div
          className={`mb-4 px-3 py-2.5 rounded-lg border text-xs flex items-start gap-2 ${
            toast.success
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
          role="status"
        >
          {toast.success ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          )}
          <span className="flex-1">{toast.message}</span>
          <button type="button" className="text-current/70 hover:text-current" onClick={() => setToast(null)}>
            ×
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-slate-400 text-xs">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading platform controls…
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {ordered.map((setting) => {
            const meta = PLATFORM_META[setting.platform] || PLATFORM_META.youtube;
            const Icon = meta.Icon;
            const enabled = Boolean(setting.publishingEnabled);
            const busy = pendingPlatform === setting.platform;

            return (
              <div
                key={setting.platform}
                className={`rounded-xl border p-4 transition-colors ${
                  enabled
                    ? 'border-slate-200 bg-white'
                    : 'border-slate-200 bg-slate-50/80 opacity-95'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center border shrink-0 ${
                        enabled ? meta.accentOn : meta.accentOff
                      }`}
                    >
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-sm font-semibold text-slate-900">{meta.label} Publishing</h4>
                        <Badge variant={enabled ? 'success' : 'neutral'} dot>
                          {enabled ? 'ACTIVE' : 'STOPPED'}
                        </Badge>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">
                        {enabled ? meta.descriptionOn : meta.descriptionOff}
                      </p>
                      <p className="text-[10px] text-slate-400 mt-2">
                        Last updated: {formatUpdatedAt(setting.updatedAt)}
                        {setting.updatedBy ? ` · by ${setting.updatedBy}` : ''}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    role="switch"
                    aria-checked={enabled}
                    aria-label={`${meta.label} publishing ${enabled ? 'on' : 'off'}`}
                    disabled={busy}
                    onClick={() => onToggleClick(setting.platform, enabled)}
                    className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60 ${
                      enabled
                        ? 'bg-emerald-500 border-emerald-600'
                        : 'bg-slate-300 border-slate-400'
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                        enabled ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                    {busy && (
                      <Loader2 className="absolute inset-0 m-auto w-3.5 h-3.5 animate-spin text-white" />
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {confirmTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40">
          <div
            className="w-full max-w-md rounded-xl bg-white border border-slate-200 shadow-xl p-5"
            role="dialog"
            aria-modal="true"
            aria-labelledby="platform-disable-title"
          >
            <h3 id="platform-disable-title" className="text-base font-semibold text-slate-900">
              Stop {PLATFORM_META[confirmTarget.platform]?.label || confirmTarget.platform} publishing?
            </h3>
            <p className="text-xs text-slate-500 mt-2 leading-relaxed">
              Pending posts for this platform will be paused (not deleted or marked failed). Connected accounts
              and OAuth tokens stay intact. The other platform is unaffected.
            </p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"
                onClick={() => setConfirmTarget(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="px-3 py-1.5 text-xs rounded-lg bg-rose-600 text-white hover:bg-rose-500 border border-rose-500"
                onClick={() => applyToggle(confirmTarget.platform, false)}
              >
                Stop publishing
              </button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
};
