import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, FolderInput, Link2, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { Button } from '../common/Button.jsx';
import { Card, CardHeader } from '../common/Card.jsx';
import { driveTransferApi } from '../../api/driveTransferClient.js';

const ACTIVE = new Set(['scanning', 'copying']);

export function DriveTransferModule() {
  const [auth, setAuth] = useState(null);
  const [pairs, setPairs] = useState(() => [{ id: 1, sourceUrl: '', destinationUrl: '' }]);
  const [validation, setValidation] = useState([]);
  const [queue, setQueue] = useState([]);
  const [job, setJob] = useState(null);
  const [failures, setFailures] = useState([]);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState('');
  const [parallelCopies, setParallelCopies] = useState(5);

  const refreshJob = useCallback(async (jobId) => {
    if (!jobId) return null;
    const res = await driveTransferApi.getJob(jobId);
    setJob(res.data);
    if ((res.data?.failedFiles || 0) > 0 || (res.data?.recentErrors || []).length > 0) {
      const failed = await driveTransferApi.getFailures(jobId).catch(() => ({ data: [] }));
      setFailures(failed.data || []);
    } else {
      setFailures([]);
    }
    return res.data;
  }, []);

  const load = useCallback(async () => {
    const status = await driveTransferApi.getStatus();
    setAuth(status.data);
    const jobs = await driveTransferApi.listJobs();
    const rows = jobs.data || [];
    setQueue(rows.filter((row) => row.status === 'queued').sort((a, b) => (a.queueOrder || 0) - (b.queueOrder || 0)));
    const active = rows.find((row) => ACTIVE.has(row.status)) || rows[0];
    if (active) await refreshJob(active.jobId);
  }, [refreshJob]);

  useEffect(() => {
    if (job?.parallelCopies) setParallelCopies(job.parallelCopies);
  }, [job?.parallelCopies]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('dt_status') === 'connected') {
      setNotice('Drive Transfer connected. YouTube and Instagram sign-in were not changed.');
    } else if (params.get('dt_status') === 'error') {
      setError(params.get('dt_error') || 'Drive Transfer sign-in failed.');
    }
    load().catch((err) => setError(err.message));
  }, [load]);

  useEffect(() => {
    if ((!job || !ACTIVE.has(job.status)) && queue.length === 0) return undefined;
    const timer = setInterval(() => {
      load()
        .then(() => setError((current) => (String(current).startsWith('Request failed with status 5') ? '' : current)))
        .catch((err) => setError(err.message));
    }, 2000);
    return () => clearInterval(timer);
  }, [job, queue.length, load]);

  const run = async (key, action) => {
    setPending(key);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (err) {
      setError(err.message);
    } finally {
      setPending('');
    }
  };

  const connect = () => run('connect', async () => {
    const res = await driveTransferApi.getAuthUrl();
    window.location.assign(res.data.authUrl);
  });

  const disconnect = () => run('disconnect', async () => {
    await driveTransferApi.disconnect();
    setValidation(null);
    await load();
    setNotice('Drive Transfer disconnected locally. Source files were not changed.');
  });

  const filledPairs = pairs.filter((pair) => pair.sourceUrl.trim() && pair.destinationUrl.trim());
  const urlsReady = filledPairs.length > 0;

  const updatePair = (id, field, value) => {
    setPairs((rows) => rows.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
    setValidation([]);
  };

  const addPair = () => {
    setPairs((rows) => {
      if (rows.length >= 10) return rows;
      return [...rows, { id: Date.now(), sourceUrl: '', destinationUrl: rows[0]?.destinationUrl || '' }];
    });
  };

  const removePair = (id) => {
    setPairs((rows) => (rows.length === 1 ? rows : rows.filter((row) => row.id !== id)));
    setValidation([]);
  };

  const validate = () => run('validate', async () => {
    if (!connected) {
      throw new Error('Click Connect Drive above first, then try again.');
    }
    const checks = [];
    for (const pair of filledPairs) {
      const res = await driveTransferApi.validate(pair.sourceUrl, pair.destinationUrl);
      checks.push(res.data);
    }
    setValidation(checks);
    setNotice(checks.length === 1
      ? `Read access confirmed for “${checks[0].source.name}”. Write access confirmed for “${checks[0].destination.name}”.`
      : `Access confirmed for ${checks.length} folders.`);
  });

  const queueFolders = () => run('queue', async () => {
    if (!connected) {
      throw new Error('Click Connect Drive above first, then try again.');
    }
    const res = await driveTransferApi.queueFolders(filledPairs, parallelCopies);
    const queued = res.data?.jobs || [];
    const problems = res.data?.errors || [];
    await load();
    const waitingNote = !queued.length
      ? ''
      : res.data?.started
        ? `${queued.length} folder${queued.length === 1 ? '' : 's'} queued. The first scan has started, then the copy runs on its own.`
        : `${queued.length} folder${queued.length === 1 ? '' : 's'} will start after the current copy. Files already copied stay as they are.`;
    if (problems.length) {
      setError(`${problems.map((problem) => problem.message).join(' ')}${waitingNote ? ` ${waitingNote}` : ''}`);
    } else if (waitingNote) {
      setNotice(waitingNote);
    }
  });

  const cancelQueued = () => run('cancel-queue', async () => {
    const res = await driveTransferApi.cancelQueued();
    await load();
    setNotice(`Removed ${res.data?.cancelled || 0} waiting folders. The copy that is already running was left alone.`);
  });

  const preview = () => run('preview', async () => {
    if (!connected) {
      throw new Error('Click Connect Drive above first, then try again.');
    }
    const first = filledPairs[0];
    const res = await driveTransferApi.preview(first.sourceUrl, first.destinationUrl);
    setJob(res.data);
    setValidation([{
      source: { id: res.data.sourceFolderId, name: res.data.sourceFolderName },
      destination: { id: res.data.destinationFolderId, name: res.data.destinationFolderName },
    }]);
  });

  const changeSpeed = async (value) => {
    const count = Number(value);
    setParallelCopies(count);
    if (!job || !ACTIVE.has(job.status)) return;
    try {
      const res = await driveTransferApi.setSpeed(job.jobId, count);
      setJob(res.data);
      setNotice(`Now copying ${count} files at a time.`);
    } catch (err) {
      setError(err.message);
    }
  };

  const copy = () => run('copy', async () => {
    const res = await driveTransferApi.startCopy(job.jobId, parallelCopies);
    setJob(res.data);
  });

  const resume = () => run('resume', async () => {
    const res = await driveTransferApi.resume(job.jobId, parallelCopies);
    setJob(res.data);
  });

  const retry = () => run('retry', async () => {
    const res = await driveTransferApi.retry(job.jobId, parallelCopies);
    setJob(res.data);
  });

  const cancel = () => run('cancel', async () => {
    const res = await driveTransferApi.cancel(job.jobId);
    setJob(res.data);
  });

  const configured = auth?.configured;
  const connected = auth?.connected;
  const busy = Boolean(pending) || (job && ACTIVE.has(job.status));
  const progress = job?.mode === 'copy' ? job.progressPercent || 0 : 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Drive Transfer"
          subtitle="Copy a Drive folder into another Drive folder. Source files are never deleted or edited."
        />
        <div className="flex flex-wrap items-start gap-3 text-xs text-slate-400">
          <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          <p>
            This page uses its own Google sign-in and the <span className="text-slate-800">/api/drive-transfer</span> routes.
            It does not change YouTube upload, Instagram publishing, Drive indexing, or the scheduler.
          </p>
        </div>
      </Card>

      {(notice || error) && (
        <div className={`rounded-lg border px-4 py-3 text-sm ${error ? 'border-rose-500/40 bg-rose-50/40 text-rose-800' : 'border-emerald-500/30 bg-emerald-50/30 text-emerald-800'}`}>
          <div className="flex items-start gap-2">
            {error ? <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> : <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />}
            <span>{error || notice}</span>
          </div>
        </div>
      )}

      <Card>
        <CardHeader title="Drive account" subtitle="Separate from YouTube and Instagram on Social Accounts" />
        {!configured && (
          <div className="text-sm text-slate-700 space-y-2">
            <p>Add these variables to <span className="font-mono text-slate-900">backend/.env</span>, then restart the API. Do not replace the existing Google client variables.</p>
            <ul className="font-mono text-xs text-slate-400 space-y-1">
              {(auth?.missingEnv || ['DRIVE_TRANSFER_GOOGLE_CLIENT_ID', 'DRIVE_TRANSFER_GOOGLE_CLIENT_SECRET']).map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
            <p className="text-xs text-slate-500">Setup steps are in docs/DRIVE_TRANSFER.md.</p>
          </div>
        )}
        {configured && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-slate-700">
              {connected ? (
                <span>Connected as <span className="text-slate-900">{auth.email || 'Google account'}</span></span>
              ) : (
                <span>Not connected. Click Connect Drive. Check access and Dry-run stay off until that finishes.</span>
              )}
            </div>
            <div className="flex gap-2">
              {connected ? (
                <Button variant="secondary" onClick={disconnect} isLoading={pending === 'disconnect'} disabled={busy && pending !== 'disconnect'}>
                  Disconnect
                </Button>
              ) : (
                <Button onClick={connect} isLoading={pending === 'connect'} icon={Link2}>
                  Connect Drive
                </Button>
              )}
            </div>
          </div>
        )}
        {configured && !connected && auth?.redirectUri && (
          <p className="mt-3 text-xs text-slate-500 break-all">
            If Google says the redirect URI is not allowed, add this exact address on the OAuth client: {auth.redirectUri}
          </p>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Folders"
          subtitle="Add one or more source folders. Each one copies into its own destination. File links are rejected."
        />
        <div className="space-y-4">
          {pairs.map((pair, index) => (
            <div key={pair.id} className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
              <label className="block text-xs text-slate-400">
                Source folder {pairs.length > 1 ? index + 1 : 'URL'}
                <input
                  value={pair.sourceUrl}
                  onChange={(event) => updatePair(pair.id, 'sourceUrl', event.target.value)}
                  placeholder="https://drive.google.com/drive/folders/…"
                  className="mt-1.5 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                />
              </label>
              <label className="block text-xs text-slate-400">
                Destination folder {pairs.length > 1 ? index + 1 : 'URL'}
                <input
                  value={pair.destinationUrl}
                  onChange={(event) => updatePair(pair.id, 'destinationUrl', event.target.value)}
                  placeholder="https://drive.google.com/drive/folders/…"
                  className="mt-1.5 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                />
              </label>
              {pairs.length > 1 && (
                <Button variant="ghost" size="sm" onClick={() => removePair(pair.id)} icon={Trash2} className="mb-0.5">
                  Remove
                </Button>
              )}
            </div>
          ))}
        </div>
        <div className="mt-3">
          <Button variant="ghost" size="sm" onClick={addPair} disabled={pairs.length >= 10} icon={Plus}>
            Add folder
          </Button>
          <p className="mt-2 text-xs text-slate-500">
            Up to 10 folders. Each one is scanned, then copied into its own destination. A copy that is already running finishes first.
          </p>
        </div>
        {validation.length > 0 && (
          <div className="mt-4 space-y-2 text-xs text-slate-700">
            {validation.map((item) => (
              <div key={`${item.source.id}-${item.destination.id}`} className="rounded-lg border border-slate-200 px-3 py-2">
                <span className="text-slate-900">{item.source.name}</span>
                <span className="text-slate-500"> → </span>
                <span className="text-slate-900">{item.destination.name}</span>
              </div>
            ))}
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <label className="text-xs text-slate-400">
            Files at a time
            <select
              value={parallelCopies}
              onChange={(event) => changeSpeed(event.target.value)}
              className="mt-1.5 block rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
            >
              <option value={1}>1 · slowest</option>
              <option value={3}>3</option>
              <option value={5}>5</option>
              <option value={8}>8 · fastest</option>
            </select>
          </label>
          <Button variant="secondary" onClick={validate} isLoading={pending === 'validate'} disabled={!urlsReady || Boolean(pending)}>
            Check access
          </Button>
          <Button variant="outline" onClick={preview} isLoading={pending === 'preview'} disabled={!urlsReady || busy} icon={FolderInput}>
            Dry-run preview
          </Button>
          <Button onClick={queueFolders} isLoading={pending === 'queue'} disabled={!urlsReady || pending === 'queue'}>
            {job && ACTIVE.has(job.status) ? 'Queue folders' : 'Copy folders'}
            {filledPairs.length > 1 ? ` (${filledPairs.length})` : ''}
          </Button>
          <Button onClick={copy} isLoading={pending === 'copy'} disabled={!job || job.status !== 'preview_ready' || busy}>
            Copy files
          </Button>
          {job && (job.status === 'interrupted' || job.status === 'failed') && (
            <Button variant="secondary" onClick={resume} isLoading={pending === 'resume'}>
              Resume
            </Button>
          )}
          {job && job.failedFiles > 0 && !ACTIVE.has(job.status) && (
            <Button variant="secondary" onClick={retry} isLoading={pending === 'retry'}>
              Retry failed
            </Button>
          )}
          {job && ACTIVE.has(job.status) && (
            <Button variant="danger" onClick={cancel} isLoading={pending === 'cancel'}>
              Cancel
            </Button>
          )}
        </div>
        {queue.length > 0 && (
          <div className="mt-4 rounded-lg border border-slate-200 px-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs uppercase tracking-wide text-slate-400">Waiting · {queue.length}</p>
              <Button variant="ghost" size="sm" onClick={cancelQueued} isLoading={pending === 'cancel-queue'}>
                Clear waiting
              </Button>
            </div>
            <ul className="mt-2 space-y-1 text-sm text-slate-700">
              {queue.map((row, index) => (
                <li key={row.jobId}>
                  {index + 1}. {row.sourceFolderName || 'Source'} → {row.destinationFolderName || 'Destination'}
                </li>
              ))}
            </ul>
          </div>
        )}
        {!connected && (
          <p className="mt-3 text-xs text-amber-800">
            Paste both folder links, then click Connect Drive. Copy files stays off until a dry-run preview finishes.
          </p>
        )}
      </Card>

      {job && (
        <Card>
          <CardHeader
            title={job.mode === 'copy' ? 'Copy progress' : 'Preview'}
            subtitle={`${job.sourceFolderName || 'Source'} → ${job.destinationFolderName || 'Destination'}`}
            action={<span className="text-xs uppercase tracking-wide text-slate-400">{job.status.replace('_', ' ')}</span>}
          />
          {job.mode === 'copy' && (
            <div className="mb-4">
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full bg-indigo-500" style={{ width: `${progress}%` }} />
              </div>
              <p className="mt-2 text-xs text-slate-400">
                {progress}% of discovered files are copied, skipped, or failed. Copying {job.parallelCopies || parallelCopies} files at a time.
              </p>
            </div>
          )}
          {job.status === 'scanning' && (
            <p className="mb-4 text-sm text-slate-700">Scanning folders. This preview does not create or download files.</p>
          )}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <Stat label="Total files" value={job.totalFiles} />
            <Stat label="Videos" value={job.videoCount} />
            <Stat label="Folders" value={job.folderCount} />
            <Stat label="Completed" value={job.completedFiles} />
            <Stat label="Skipped" value={job.skippedFiles} />
            <Stat label="Failed" value={job.failedFiles} />
          </div>
          {job.errorMessage && (
            <p className="mt-4 text-sm text-amber-800">{job.errorMessage}</p>
          )}
          {job.status === 'preview_ready' && (
            <p className="mt-4 text-sm text-slate-700">
              Preview finished. Skipped files already match the destination and will be left alone. Copy creates new files only inside the destination.
            </p>
          )}
        </Card>
      )}

      {failures.length > 0 && (
        <Card>
          <CardHeader title="Files that need attention" subtitle="Permissions, quota, inaccessible shares, and unsupported copies" />
          <ul className="space-y-3">
            {failures.map((item) => (
              <li key={`${item.path}-${item.code}`} className="text-sm border-b border-slate-200/80 pb-3 last:border-0">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-slate-900">{item.path || item.name}</span>
                  <span className="text-[10px] uppercase tracking-wide text-slate-400">{item.code}</span>
                </div>
                <p className="text-xs text-slate-400 mt-1">{item.message}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/40 px-3 py-2">
      <div className="text-lg font-semibold text-slate-900">{value ?? 0}</div>
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  );
}
