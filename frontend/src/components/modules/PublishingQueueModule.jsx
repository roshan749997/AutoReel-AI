import React, { useState } from 'react';
import {
  ListVideo,
  Youtube,
  Instagram,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Play,
  Trash2,
  ExternalLink,
  Info,
  Pause,
  RotateCcw,
  Calendar,
  XCircle,
  Globe,
  Edit3,
  Check,
  RefreshCw,
  Layers,
} from 'lucide-react';
import { Card, CardHeader } from '../common/Card.jsx';
import { Button } from '../common/Button.jsx';
import { Badge } from '../common/Badge.jsx';
import { EmptyState } from '../common/EmptyState.jsx';
import { Modal } from '../common/Modal.jsx';
import { api } from '../../api/client.js';

export const PublishingQueueModule = ({ posts = [], accounts = [], onReload, onNavigate }) => {
  const [filterStatus, setFilterStatus] = useState('all');
  const [accountFilter, setAccountFilter] = useState('all');
  const [platformFilter, setPlatformFilter] = useState('all');
  const [activeLogPost, setActiveLogPost] = useState(null);
  const [isActionLoading, setIsActionLoading] = useState(false);

  // Modals state
  const [reschedulePostItem, setReschedulePostItem] = useState(null);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleTimezone, setRescheduleTimezone] = useState('UTC');

  const [editPostItem, setEditPostItem] = useState(null);
  const [editForm, setEditForm] = useState({
    title: '',
    caption: '',
    hashtags: '',
    timezone: 'UTC',
  });

  const statuses = [
    'all',
    'scheduled',
    'queued',
    'processing',
    'retrying',
    'paused',
    'failed',
    'cancelled',
    'published',
  ];

  const filteredPosts = posts.filter((p) => {
    if (filterStatus !== 'all' && p.status !== filterStatus) return false;
    if (platformFilter !== 'all' && p.platform !== platformFilter) return false;
    if (accountFilter !== 'all') {
      const accId = p.accountId?._id || p.accountId;
      if (accId !== accountFilter) return false;
    }
    return true;
  });

  // Action handlers
  const handlePause = async (id) => {
    try {
      setIsActionLoading(true);
      await api.pausePost(id);
      if (onReload) onReload();
    } catch (err) {
      alert(`Pause error: ${err.message}`);
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleResume = async (id) => {
    try {
      setIsActionLoading(true);
      await api.resumePost(id);
      if (onReload) onReload();
    } catch (err) {
      alert(`Resume error: ${err.message}`);
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleCancelPost = async (id) => {
    const reason = window.prompt('Reason for cancelling this scheduled post (optional):', 'Cancelled by creator');
    if (reason === null) return; // user clicked cancel
    try {
      setIsActionLoading(true);
      await api.cancelPost(id, reason);
      if (onReload) onReload();
    } catch (err) {
      alert(`Cancel error: ${err.message}`);
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleRetry = async (id) => {
    try {
      setIsActionLoading(true);
      await api.retryPost(id);
      if (onReload) onReload();
      alert('Post reset for queue processing.');
    } catch (err) {
      alert(`Retry error: ${err.message}`);
    } finally {
      setIsActionLoading(false);
    }
  };

  const openRescheduleModal = (post) => {
    setReschedulePostItem(post);
    setRescheduleDate(new Date(post.scheduledAt).toISOString().slice(0, 16));
    setRescheduleTimezone(post.timezone || 'UTC');
  };

  const handleConfirmReschedule = async (e) => {
    e.preventDefault();
    if (!reschedulePostItem) return;
    try {
      setIsActionLoading(true);
      await api.reschedulePost(reschedulePostItem._id, {
        scheduledAt: new Date(rescheduleDate).toISOString(),
        timezone: rescheduleTimezone,
      });
      setReschedulePostItem(null);
      if (onReload) onReload();
      alert('Post rescheduled successfully.');
    } catch (err) {
      alert(`Reschedule error: ${err.message}`);
    } finally {
      setIsActionLoading(false);
    }
  };

  const openEditModal = (post) => {
    setEditPostItem(post);
    setEditForm({
      title: post.title,
      caption: post.caption || '',
      hashtags: Array.isArray(post.hashtags) ? post.hashtags.join(' ') : post.hashtags || '',
      timezone: post.timezone || 'UTC',
    });
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    if (!editPostItem) return;
    try {
      setIsActionLoading(true);
      await api.updatePost(editPostItem._id, {
        title: editForm.title,
        caption: editForm.caption,
        hashtags: editForm.hashtags.split(/[\s,]+/).filter(Boolean),
        timezone: editForm.timezone,
      });
      setEditPostItem(null);
      if (onReload) onReload();
      alert('Post details updated.');
    } catch (err) {
      alert(`Update error: ${err.message}`);
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleDeletePost = async (id) => {
    if (!window.confirm('Permanently remove this post from the publishing queue?')) return;
    try {
      setIsActionLoading(true);
      await api.deletePost(id);
      if (onReload) onReload();
    } catch (err) {
      alert(`Delete error: ${err.message}`);
    } finally {
      setIsActionLoading(false);
    }
  };

  const handlePurgeQueue = async (purgeAll = false) => {
    const confirmMsg = purgeAll
      ? 'Are you sure you want to completely clear ALL items from the publishing queue?'
      : 'Clear all failed, cancelled, and old finished posts from the queue?';
    if (!window.confirm(confirmMsg)) return;
    try {
      setIsActionLoading(true);
      const res = await api.purgePosts(purgeAll ? { all: 'true' } : {});
      alert(res.message || 'Publishing queue cleaned successfully!');
      if (onReload) onReload();
    } catch (err) {
      alert(`Clear queue error: ${err.message}`);
    } finally {
      setIsActionLoading(false);
    }
  };

  const handlePublishNow = async (id) => {
    if (!window.confirm('Dispatch and publish this post to YouTube now?')) return;
    try {
      setIsActionLoading(true);
      const res = await api.publishNow(id);
      alert(res.message || 'Publish executed successfully!');
      if (onReload) onReload();
    } catch (err) {
      alert(`Publish error: ${err.message}`);
    } finally {
      setIsActionLoading(false);
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'published':
        return <Badge variant="success" dot className="capitalize text-[10px]">Published</Badge>;
      case 'manual_review':
        return <Badge variant="warning" dot className="capitalize text-[10px] text-amber-300 bg-amber-950/40 border-amber-500/30">Manual Review</Badge>;
      case 'failed':
        return <Badge variant="error" dot className="capitalize text-[10px]">Failed</Badge>;
      case 'retrying':
        return <Badge variant="warning" dot className="capitalize text-[10px]">Retrying</Badge>;
      case 'processing':
        return <Badge variant="info" dot className="capitalize text-[10px]">Processing</Badge>;
      case 'paused':
        return <Badge variant="neutral" dot className="capitalize text-[10px]">Paused</Badge>;
      case 'cancelled':
        return <Badge variant="neutral" dot className="capitalize text-[10px]">Cancelled</Badge>;
      case 'queued':
        return <Badge variant="info" dot className="capitalize text-[10px]">Queued (Ready)</Badge>;
      case 'scheduled':
      default:
        return <Badge variant="info" dot className="capitalize text-[10px]">Scheduled</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. Queue Overview & Filter Tabs */}
      <Card>
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-slate-100">Smart Publishing Queue & Orchestrator</h3>
              <span className="text-xs px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400">
                {posts.length} Total Jobs
              </span>
              {posts.length > 0 && (
                <button
                  type="button"
                  onClick={() => handlePurgeQueue(false)}
                  disabled={isActionLoading}
                  className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-red-950/40 border border-red-800/50 text-red-400 hover:bg-red-900/50 hover:text-red-300 transition-colors cursor-pointer"
                  title="Remove old failed, cancelled, and completed posts from queue"
                >
                  <Trash2 className="w-3 h-3" />
                  Clear Old
                </button>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Timezone-aware scheduling with bounded queue workers, retry backoff, and n8n webhook orchestration
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <div className="flex flex-wrap items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs max-w-full overflow-x-auto">
              {statuses.map((st) => (
                <button
                  key={st}
                  onClick={() => setFilterStatus(st)}
                  className={`px-2 py-1 rounded-md font-medium capitalize text-[11px] transition-colors whitespace-nowrap ${
                    filterStatus === st
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-850'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1.5">
              <select
                value={platformFilter}
                onChange={(e) => setPlatformFilter(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-xs text-slate-300 focus:outline-none"
              >
                <option value="all">All Platforms</option>
                <option value="youtube">YouTube</option>
                <option value="instagram">Instagram</option>
              </select>

              {accounts.length > 0 && (
                <select
                  value={accountFilter}
                  onChange={(e) => setAccountFilter(e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-xs text-slate-300 focus:outline-none max-w-[150px] truncate"
                >
                  <option value="all">All Accounts</option>
                  {accounts.map((a) => (
                    <option key={a._id} value={a._id}>
                      {a.accountName}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* 2. Posts List */}
      <Card>
        <CardHeader
          title="Scheduled Dispatches"
          subtitle={`${filteredPosts.length} post${filteredPosts.length === 1 ? '' : 's'} in current view`}
        />

        {filteredPosts.length === 0 ? (
          <EmptyState
            icon={ListVideo}
            title="Queue is empty"
            description="There are no posts matching this status filter. Select approved videos from your library to schedule new posts."
            actionLabel="Browse Video Library"
            onAction={() => onNavigate('library')}
          />
        ) : (
          <div className="space-y-3">
            {filteredPosts.map((post) => {
              const isYt = post.platform === 'youtube';
              const isPaused = post.status === 'paused';
              const isCancelled = post.status === 'cancelled';
              const isFailed = post.status === 'failed';
              const isPublished = post.status === 'published';

              return (
                <div
                  key={post._id}
                  className="p-4 rounded-xl bg-slate-950/40 border border-slate-800/80 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 hover:border-slate-700/80 transition-colors"
                >
                  {/* Left: Platform & Post Details */}
                  <div className="flex items-start gap-3.5 flex-1 min-w-0">
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${
                        isYt
                          ? 'bg-red-500/10 text-red-400 border-red-500/20'
                          : 'bg-pink-500/10 text-pink-400 border-pink-500/20'
                      }`}
                    >
                      {isYt ? <Youtube className="w-5 h-5" /> : <Instagram className="w-5 h-5" />}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-xs font-semibold text-slate-100 truncate max-w-md">{post.title}</h4>
                        {getStatusBadge(post.status)}
                        {post.publishingStatus && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400 font-mono">
                            Dispatch: {post.publishingStatus}
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-slate-400 line-clamp-1 mt-0.5">{post.caption || 'No caption'}</p>

                      <div className="flex flex-wrap items-center gap-3 mt-2 text-[11px] text-slate-400">
                        <span className="flex items-center gap-1 font-mono">
                          <Clock className="w-3.5 h-3.5 text-slate-500" />
                          {new Date(post.scheduledAt).toLocaleString([], {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                          <span className="text-slate-500 text-[10px]">({post.timezone || 'UTC'})</span>
                        </span>

                        <span>Account: {post.accountId?.accountName || 'Unknown'}</span>
                        {post.attempts > 0 && <span>Attempts: {post.attempts}/{post.maxAttempts || 3}</span>}

                        {post.nextRetryAt && (
                          <span className="text-amber-400 font-mono text-[10px]">
                            Next Retry: {new Date(post.nextRetryAt).toLocaleTimeString()}
                          </span>
                        )}
                      </div>

                      {post.lastError && (
                        <p className="text-[11px] text-rose-400 mt-1.5 flex items-center gap-1 font-mono">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          {post.lastError.message}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Right: Actions */}
                  <div className="flex flex-wrap items-center gap-1.5 w-full md:w-auto justify-end border-t md:border-t-0 pt-3 md:pt-0 border-slate-800">
                    {/* View External URL if published */}
                    {post.publishDetails?.externalUrl && (
                      <a
                        href={post.publishDetails.externalUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors"
                        title="View published video"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    )}

                    {/* Audit Log Modal Button */}
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={Info}
                      onClick={() => setActiveLogPost(post)}
                      className="text-xs text-slate-400 hover:text-slate-200 py-1"
                    >
                      Audit
                    </Button>

                    {/* Edit Metadata */}
                    {!isPublished && (
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={Edit3}
                        onClick={() => openEditModal(post)}
                        className="text-xs py-1"
                        title="Edit title & caption"
                      >
                        Edit
                      </Button>
                    )}

                    {/* Reschedule */}
                    {!isPublished && (
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={Calendar}
                        onClick={() => openRescheduleModal(post)}
                        className="text-xs py-1"
                        title="Change date or timezone"
                      >
                        Reschedule
                      </Button>
                    )}

                    {/* Pause / Resume */}
                    {!isPublished && !isCancelled && !isFailed && (
                      isPaused ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          icon={Play}
                          isLoading={isActionLoading}
                          onClick={() => handleResume(post._id)}
                          className="text-xs py-1 text-emerald-400"
                        >
                          Resume
                        </Button>
                      ) : (
                        <Button
                          variant="secondary"
                          size="sm"
                          icon={Pause}
                          isLoading={isActionLoading}
                          onClick={() => handlePause(post._id)}
                          className="text-xs py-1"
                        >
                          Pause
                        </Button>
                      )
                    )}

                    {/* Manual Retry */}
                    {(isFailed || isCancelled) && (
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={RotateCcw}
                        isLoading={isActionLoading}
                        onClick={() => handleRetry(post._id)}
                        className="text-xs py-1 text-indigo-400"
                      >
                        Retry
                      </Button>
                    )}

                    {/* Publish Now / Dispatch */}
                    {!isPublished && !isCancelled && (
                      <Button
                        variant="primary"
                        size="sm"
                        icon={Play}
                        isLoading={isActionLoading}
                        onClick={() => handlePublishNow(post._id)}
                        className="text-xs py-1"
                        title="Upload and publish this post to YouTube now"
                      >
                        Publish Now
                      </Button>
                    )}

                    {/* Cancel Action */}
                    {!isPublished && !isCancelled && (
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={XCircle}
                        onClick={() => handleCancelPost(post._id)}
                        className="text-xs py-1 text-slate-400 hover:text-amber-400"
                        title="Cancel schedule"
                      >
                        Cancel
                      </Button>
                    )}

                    {/* Remove Action */}
                    <Button
                      variant="danger"
                      size="sm"
                      icon={Trash2}
                      onClick={() => handleDeletePost(post._id)}
                      className="text-xs py-1"
                      title="Delete permanently"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* 3. Execution Audit Log Modal */}
      <Modal
        isOpen={!!activeLogPost}
        onClose={() => setActiveLogPost(null)}
        title={`Audit Trail: ${activeLogPost?.title}`}
      >
        <div className="space-y-4 text-xs max-h-[70vh] overflow-y-auto">
          <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1">
            <div className="flex justify-between text-slate-400 text-[11px]">
              <span>Idempotency Key:</span>
              <span className="font-mono text-slate-200">{activeLogPost?.idempotencyKey || 'None'}</span>
            </div>
            <div className="flex justify-between text-slate-400 text-[11px]">
              <span>Timezone:</span>
              <span className="text-slate-200">{activeLogPost?.timezone || 'UTC'}</span>
            </div>
            <div className="flex justify-between text-slate-400 text-[11px]">
              <span>Current Status:</span>
              <span className="font-semibold text-indigo-400 capitalize">{activeLogPost?.status}</span>
            </div>
          </div>

          <div className="space-y-2">
            {(activeLogPost?.executionLogs || []).length === 0 ? (
              <p className="text-slate-400 text-center py-4">No execution logs recorded yet.</p>
            ) : (
              activeLogPost.executionLogs.map((log, i) => (
                <div
                  key={i}
                  className={`p-3 rounded-lg border font-mono text-[11px] ${
                    log.level === 'error'
                      ? 'bg-rose-950/20 border-rose-500/30 text-rose-300'
                      : log.level === 'warn'
                      ? 'bg-amber-950/20 border-amber-500/30 text-amber-300'
                      : 'bg-slate-950 border-slate-800 text-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between text-slate-500 mb-1">
                    <span className="uppercase font-semibold text-[10px] text-indigo-400">{log.step}</span>
                    <span>{new Date(log.timestamp).toLocaleTimeString()}</span>
                  </div>
                  <div>{log.message}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </Modal>

      {/* 4. Reschedule Modal */}
      <Modal
        isOpen={!!reschedulePostItem}
        onClose={() => setReschedulePostItem(null)}
        title="Reschedule Publishing Date & Time"
      >
        <form onSubmit={handleConfirmReschedule} className="space-y-4 text-xs">
          <div>
            <label className="block text-slate-300 font-medium mb-1">New Scheduled Date & Time:</label>
            <input
              type="datetime-local"
              value={rescheduleDate}
              onChange={(e) => setRescheduleDate(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 focus:outline-none"
              required
            />
          </div>

          <div>
            <label className="block text-slate-300 font-medium mb-1">Target Timezone:</label>
            <select
              value={rescheduleTimezone}
              onChange={(e) => setRescheduleTimezone(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 focus:outline-none"
            >
              <option value="UTC">UTC (Coordinated Universal Time)</option>
              <option value="Asia/Kolkata">Asia/Kolkata (IST +5:30)</option>
              <option value="America/New_York">America/New_York (EST / EDT)</option>
              <option value="America/Los_Angeles">America/Los_Angeles (PST / PDT)</option>
              <option value="Europe/London">Europe/London (GMT / BST)</option>
            </select>
          </div>

          <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setReschedulePostItem(null)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" type="submit" isLoading={isActionLoading}>
              Confirm Reschedule
            </Button>
          </div>
        </form>
      </Modal>

      {/* 5. Edit Post Details Modal */}
      <Modal
        isOpen={!!editPostItem}
        onClose={() => setEditPostItem(null)}
        title="Edit Scheduled Post Details"
      >
        <form onSubmit={handleSaveEdit} className="space-y-4 text-xs">
          <div>
            <label className="block text-slate-300 font-medium mb-1">Title:</label>
            <input
              type="text"
              value={editForm.title}
              onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 focus:outline-none"
              required
            />
          </div>

          <div>
            <label className="block text-slate-300 font-medium mb-1">Caption:</label>
            <textarea
              rows={3}
              value={editForm.caption}
              onChange={(e) => setEditForm({ ...editForm, caption: e.target.value })}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-slate-300 font-medium mb-1">Hashtags (space separated):</label>
            <input
              type="text"
              value={editForm.hashtags}
              onChange={(e) => setEditForm({ ...editForm, hashtags: e.target.value })}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 focus:outline-none"
            />
          </div>

          <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditPostItem(null)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" type="submit" isLoading={isActionLoading}>
              Save Changes
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
