import React, { useEffect, useMemo, useState } from 'react';
import {
  Folders,
  Youtube,
  Instagram,
  Folder,
  Film,
  Clock,
  AlertTriangle,
} from 'lucide-react';
import { Card, CardHeader } from '../common/Card.jsx';
import { Button } from '../common/Button.jsx';
import { EmptyState } from '../common/EmptyState.jsx';
import { api } from '../../api/client.js';

const PAIR_STORAGE_KEY = 'channel-board-pairs';

const readPairs = () => {
  try {
    const raw = localStorage.getItem(PAIR_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const normalizeName = (value) => (value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const suggestAccount = (folderName, accounts) => {
  const folderKey = normalizeName(folderName);
  if (!folderKey) return '';
  const hits = accounts.filter((account) => {
    const name = normalizeName(account.accountName);
    const username = normalizeName(account.username);
    return (
      (name && (folderKey.includes(name) || name.includes(folderKey))) ||
      (username && (folderKey.includes(username) || username.includes(folderKey)))
    );
  });
  return hits.length === 1 ? hits[0]._id : '';
};

const accountIdOf = (post) => String(post.accountId?._id || post.accountId || '');
const videoOf = (post) => (post.videoId && typeof post.videoId === 'object' ? post.videoId : null);

const statusTone = (status) => {
  if (status === 'published') return 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20';
  if (status === 'failed') return 'text-rose-300 bg-rose-500/10 border-rose-500/20';
  if (status === 'paused' || status === 'cancelled') return 'text-slate-300 bg-slate-800 border-slate-700';
  return 'text-amber-200 bg-amber-500/10 border-amber-500/20';
};

const formatWhen = (value) => {
  if (!value) return '';
  return new Date(value).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const latestPost = (items) => {
  if (!items.length) return null;
  return [...items].sort((a, b) => new Date(b.scheduledAt) - new Date(a.scheduledAt))[0];
};

export const ChannelsModule = ({ accounts = [], posts = [], onNavigate }) => {
  const [folders, setFolders] = useState([]);
  const [isLoadingFolders, setIsLoadingFolders] = useState(true);
  const [folderError, setFolderError] = useState('');
  const [pairs, setPairs] = useState(readPairs);
  const [selectedFolderId, setSelectedFolderId] = useState('');
  const [videos, setVideos] = useState([]);
  const [videoPage, setVideoPage] = useState(1);
  const [videoTotal, setVideoTotal] = useState(0);
  const [isLoadingVideos, setIsLoadingVideos] = useState(false);

  const youtubeAccounts = accounts.filter((account) => account.platform === 'youtube' && account.status !== 'disconnected');
  const instagramAccounts = accounts.filter((account) => account.platform === 'instagram' && account.status !== 'disconnected');

  useEffect(() => {
    let cancelled = false;
    const loadFolders = async () => {
      setIsLoadingFolders(true);
      setFolderError('');
      try {
        const res = await api.getVideoFoldersSummary();
        if (cancelled) return;
        const list = Array.isArray(res.data) ? res.data : [];
        setFolders(list);
        setSelectedFolderId((current) => current || list[0]?._id || '');
      } catch (err) {
        if (!cancelled) setFolderError(err.message || 'Could not load Drive folders');
      } finally {
        if (!cancelled) setIsLoadingFolders(false);
      }
    };
    loadFolders();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedFolder = folders.find((folder) => folder._id === selectedFolderId) || null;

  useEffect(() => {
    if (!selectedFolderId) {
      setVideos([]);
      setVideoTotal(0);
      return undefined;
    }
    let cancelled = false;
    const loadVideos = async () => {
      setIsLoadingVideos(true);
      try {
        const res = await api.getVideos({
          folderId: selectedFolderId,
          status: 'all',
          limit: 20,
          page: videoPage,
        });
        if (cancelled) return;
        setVideos(res.data || []);
        setVideoTotal(res.pagination?.total || 0);
      } catch {
        if (!cancelled) {
          setVideos([]);
          setVideoTotal(0);
        }
      } finally {
        if (!cancelled) setIsLoadingVideos(false);
      }
    };
    loadVideos();
    return () => {
      cancelled = true;
    };
  }, [selectedFolderId, videoPage]);

  const savePair = (folderId, patch) => {
    setPairs((current) => {
      const next = {
        ...current,
        [folderId]: { ...(current[folderId] || {}), ...patch },
      };
      localStorage.setItem(PAIR_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const pair = selectedFolder ? pairs[selectedFolder._id] || {} : {};
  const suggestedYoutube = selectedFolder ? suggestAccount(selectedFolder.folderName, youtubeAccounts) : '';
  const suggestedInstagram = selectedFolder ? suggestAccount(selectedFolder.folderName, instagramAccounts) : '';

  const folderPosts = useMemo(() => {
    if (!selectedFolder) return [];
    return posts.filter((post) => videoOf(post)?.folderId && String(videoOf(post).folderId) === String(selectedFolder._id));
  }, [posts, selectedFolder]);

  const postsForAccount = (accountId) => {
    if (!accountId) return [];
    return folderPosts
      .filter((post) => accountIdOf(post) === String(accountId))
      .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
  };

  const youtubePosts = postsForAccount(pair.youtubeAccountId);
  const instagramPosts = postsForAccount(pair.instagramAccountId);

  const mismatchedCount = useMemo(() => {
    const linked = [pair.youtubeAccountId, pair.instagramAccountId].filter(Boolean).map(String);
    if (!selectedFolder || linked.length === 0) return 0;
    return posts.filter((post) => {
      if (!linked.includes(accountIdOf(post))) return false;
      const folderId = videoOf(post)?.folderId;
      return folderId && String(folderId) !== String(selectedFolder._id);
    }).length;
  }, [posts, pair.youtubeAccountId, pair.instagramAccountId, selectedFolder]);

  const assignedAccountIds = useMemo(() => {
    const ids = new Set();
    Object.values(pairs).forEach((item) => {
      if (item?.youtubeAccountId) ids.add(String(item.youtubeAccountId));
      if (item?.instagramAccountId) ids.add(String(item.instagramAccountId));
    });
    return ids;
  }, [pairs]);

  const unassignedAccounts = accounts.filter(
    (account) => account.status !== 'disconnected' && !assignedAccountIds.has(String(account._id))
  );

  const openInLibrary = () => {
    if (!selectedFolderId) return;
    sessionStorage.setItem('library-folder-focus', selectedFolderId);
    if (onNavigate) onNavigate('library');
  };

  const renderPostList = (items, emptyLabel) => {
    if (items.length === 0) {
      return <p className="text-[11px] text-slate-500 py-3">{emptyLabel}</p>;
    }
    return (
      <div className="space-y-2">
        {items.map((post) => {
          const video = videoOf(post);
          return (
            <div key={post._id} className="rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-medium text-slate-100 truncate">
                  {video?.cleanTitle || video?.originalName || post.title}
                </p>
                <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded border capitalize ${statusTone(post.status)}`}>
                  {post.status}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 mt-1 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {formatWhen(post.scheduledAt)}
              </p>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="One folder, one YouTube, one Instagram"
          subtitle="Name each Drive folder after the channel. This board keeps that pair separate so you can see which video is going where."
        />
        <p className="text-xs text-slate-400">
          Scheduling still happens in Video Library. Pick only this pair’s YouTube and Instagram when you queue a video from that folder.
        </p>
      </Card>

      {isLoadingFolders ? (
        <Card>
          <p className="text-xs text-slate-400">Loading Drive folders…</p>
        </Card>
      ) : folderError ? (
        <Card>
          <p className="text-xs text-rose-300">{folderError}</p>
        </Card>
      ) : folders.length === 0 ? (
        <Card>
          <EmptyState
            icon={Folders}
            title="No Drive folders indexed yet"
            description="Create one folder per channel in Google Drive, put only that channel’s videos inside it, then sync the folder from Video Library."
            actionLabel="Open Video Library"
            onAction={() => onNavigate && onNavigate('library')}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] gap-4">
          <Card className="p-3">
            <p className="px-2 pb-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">
              {folders.length} channel folder{folders.length === 1 ? '' : 's'}
            </p>
            <div className="space-y-1 max-h-[70vh] overflow-y-auto">
              {folders.map((folder) => {
                const saved = pairs[folder._id] || {};
                const yt = youtubeAccounts.find((account) => account._id === saved.youtubeAccountId);
                const ig = instagramAccounts.find((account) => account._id === saved.instagramAccountId);
                const active = folder._id === selectedFolderId;
                return (
                  <button
                    key={folder._id || folder.folderName}
                    type="button"
                    onClick={() => {
                      setSelectedFolderId(folder._id);
                      setVideoPage(1);
                    }}
                    className={`w-full text-left rounded-lg px-3 py-2.5 border transition-colors ${
                      active
                        ? 'bg-indigo-600/15 border-indigo-500/30'
                        : 'bg-slate-950/40 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-100 truncate">{folder.folderName || 'Unnamed folder'}</span>
                      <span className="text-[10px] text-slate-500 shrink-0">{folder.count}</span>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-1 truncate">
                      YT {yt?.accountName || 'not set'} · IG {ig?.accountName || ig?.username || 'not set'}
                    </p>
                  </button>
                );
              })}
            </div>
          </Card>

          {selectedFolder && (
            <div className="space-y-4">
              <Card>
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Folder className="w-4 h-4 text-indigo-400" />
                      <h3 className="text-sm font-semibold text-slate-100">{selectedFolder.folderName}</h3>
                    </div>
                    <p className="text-xs text-slate-400 mt-1">{selectedFolder.count} videos in this Drive folder</p>
                  </div>
                  <Button variant="secondary" size="sm" onClick={openInLibrary} className="text-xs">
                    Open this folder in library
                  </Button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
                  <label className="space-y-1">
                    <span className="text-[11px] text-slate-400 flex items-center gap-1">
                      <Youtube className="w-3.5 h-3.5 text-red-400" /> YouTube channel
                    </span>
                    <select
                      value={pair.youtubeAccountId || ''}
                      onChange={(event) => savePair(selectedFolder._id, { youtubeAccountId: event.target.value })}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500/60"
                    >
                      <option value="">Select YouTube</option>
                      {youtubeAccounts.map((account) => (
                        <option key={account._id} value={account._id}>
                          {account.accountName}
                        </option>
                      ))}
                    </select>
                    {!pair.youtubeAccountId && suggestedYoutube && (
                      <button
                        type="button"
                        onClick={() => savePair(selectedFolder._id, { youtubeAccountId: suggestedYoutube })}
                        className="text-[11px] text-indigo-300 hover:text-indigo-200"
                      >
                        Use suggested: {youtubeAccounts.find((account) => account._id === suggestedYoutube)?.accountName}
                      </button>
                    )}
                  </label>

                  <label className="space-y-1">
                    <span className="text-[11px] text-slate-400 flex items-center gap-1">
                      <Instagram className="w-3.5 h-3.5 text-pink-400" /> Instagram account
                    </span>
                    <select
                      value={pair.instagramAccountId || ''}
                      onChange={(event) => savePair(selectedFolder._id, { instagramAccountId: event.target.value })}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500/60"
                    >
                      <option value="">Select Instagram</option>
                      {instagramAccounts.map((account) => (
                        <option key={account._id} value={account._id}>
                          {account.accountName}
                          {account.username ? ` (@${account.username})` : ''}
                        </option>
                      ))}
                    </select>
                    {!pair.instagramAccountId && suggestedInstagram && (
                      <button
                        type="button"
                        onClick={() => savePair(selectedFolder._id, { instagramAccountId: suggestedInstagram })}
                        className="text-[11px] text-indigo-300 hover:text-indigo-200"
                      >
                        Use suggested: {instagramAccounts.find((account) => account._id === suggestedInstagram)?.accountName}
                      </button>
                    )}
                  </label>
                </div>

                {mismatchedCount > 0 && (
                  <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>
                      {mismatchedCount} post{mismatchedCount === 1 ? '' : 's'} for this pair use a video from a different folder.
                    </span>
                  </div>
                )}
              </Card>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card>
                  <CardHeader
                    title="YouTube"
                    subtitle={pair.youtubeAccountId ? `${youtubePosts.length} posts from this folder` : 'Choose the YouTube channel above'}
                  />
                  {renderPostList(youtubePosts, 'No YouTube posts from this folder yet.')}
                </Card>
                <Card>
                  <CardHeader
                    title="Instagram"
                    subtitle={pair.instagramAccountId ? `${instagramPosts.length} posts from this folder` : 'Choose the Instagram account above'}
                  />
                  {renderPostList(instagramPosts, 'No Instagram posts from this folder yet.')}
                </Card>
              </div>

              <Card>
                <CardHeader
                  title="Videos in this folder"
                  subtitle={`${videoTotal || selectedFolder.count} videos. Each row shows whether it is scheduled on this pair.`}
                  action={
                    videoTotal > 20 ? (
                      <div className="flex items-center gap-2 text-[11px] text-slate-400">
                        <button
                          type="button"
                          disabled={videoPage <= 1}
                          onClick={() => setVideoPage((page) => Math.max(1, page - 1))}
                          className="px-2 py-1 rounded border border-slate-800 disabled:opacity-40"
                        >
                          Prev
                        </button>
                        <span>{videoPage}</span>
                        <button
                          type="button"
                          disabled={videoPage * 20 >= videoTotal}
                          onClick={() => setVideoPage((page) => page + 1)}
                          className="px-2 py-1 rounded border border-slate-800 disabled:opacity-40"
                        >
                          Next
                        </button>
                      </div>
                    ) : null
                  }
                />
                {isLoadingVideos ? (
                  <p className="text-xs text-slate-400">Loading videos…</p>
                ) : videos.length === 0 ? (
                  <p className="text-xs text-slate-500">No videos in this folder.</p>
                ) : (
                  <div className="space-y-2">
                    {videos.map((video) => {
                      const yt = latestPost(
                        posts.filter((post) => {
                          const id = videoOf(post)?._id || post.videoId;
                          return String(id) === String(video._id) && accountIdOf(post) === String(pair.youtubeAccountId || '');
                        })
                      );
                      const ig = latestPost(
                        posts.filter((post) => {
                          const id = videoOf(post)?._id || post.videoId;
                          return String(id) === String(video._id) && accountIdOf(post) === String(pair.instagramAccountId || '');
                        })
                      );
                      return (
                        <div
                          key={video._id}
                          className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2"
                        >
                          <div className="min-w-0 flex items-center gap-2">
                            <Film className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-slate-100 truncate">{video.cleanTitle || video.originalName}</p>
                              <p className="text-[10px] text-slate-500 truncate">{video.originalName}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded border ${yt ? statusTone(yt.status) : 'text-slate-500 border-slate-800'}`}>
                              YT {yt ? yt.status : 'not scheduled'}
                            </span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded border ${ig ? statusTone(ig.status) : 'text-slate-500 border-slate-800'}`}>
                              IG {ig ? ig.status : 'not scheduled'}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            </div>
          )}
        </div>
      )}

      {unassignedAccounts.length > 0 && folders.length > 0 && (
        <Card>
          <p className="text-[11px] text-slate-400">
            Not linked to a folder yet:{' '}
            <span className="text-slate-200">
              {unassignedAccounts.map((account) => `${account.accountName} (${account.platform})`).join(', ')}
            </span>
          </p>
        </Card>
      )}
    </div>
  );
};
