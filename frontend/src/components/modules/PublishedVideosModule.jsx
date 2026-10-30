import React, { useState, useMemo } from 'react';
import {
  CheckCircle2,
  Youtube,
  Instagram,
  ExternalLink,
  Search,
  Calendar,
  Clock,
  Film,
  Sparkles,
  RefreshCw,
  Info,
  Play,
  Layers,
  ArrowUpRight,
  Share2,
} from 'lucide-react';
import { Card, CardHeader } from '../common/Card.jsx';
import { Button } from '../common/Button.jsx';
import { Badge } from '../common/Badge.jsx';
import { EmptyState } from '../common/EmptyState.jsx';
import { Modal } from '../common/Modal.jsx';
import { ChannelAvatar } from '../common/ChannelAvatar.jsx';
import { getVideoThumbnailUrl } from '../../api/client.js';

export const PublishedVideosModule = ({
  posts = [],
  accounts = [],
  onReload,
  onNavigate,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [platformFilter, setPlatformFilter] = useState('all');
  const [accountFilter, setAccountFilter] = useState('all');
  const [selectedPostDetails, setSelectedPostDetails] = useState(null);

  // Filter only published posts
  const publishedPosts = useMemo(() => {
    return (posts || []).filter((p) => p.status === 'published');
  }, [posts]);

  // Statistics
  const stats = useMemo(() => {
    const total = publishedPosts.length;
    const ytCount = publishedPosts.filter((p) => p.platform === 'youtube').length;
    const igCount = publishedPosts.filter((p) => p.platform === 'instagram').length;
    return { total, ytCount, igCount };
  }, [publishedPosts]);

  // Filtered published posts
  const filteredPosts = useMemo(() => {
    return publishedPosts.filter((p) => {
      // Platform filter
      if (platformFilter !== 'all' && p.platform !== platformFilter) return false;

      // Account filter
      if (accountFilter !== 'all') {
        const accId = p.accountId?._id || p.accountId;
        if (accId !== accountFilter) return false;
      }

      // Search filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const titleMatch = (p.title || '').toLowerCase().includes(q);
        const captionMatch = (p.caption || '').toLowerCase().includes(q);
        const originalNameMatch = (p.videoId?.originalName || '').toLowerCase().includes(q);
        const accountMatch = (p.accountId?.accountName || p.accountId?.username || '').toLowerCase().includes(q);
        if (!titleMatch && !captionMatch && !originalNameMatch && !accountMatch) {
          return false;
        }
      }

      return true;
    }).sort((a, b) => new Date(b.publishedAt || b.updatedAt) - new Date(a.publishedAt || a.updatedAt));
  }, [publishedPosts, platformFilter, accountFilter, searchQuery]);

  const formatPublishDate = (dateStr) => {
    if (!dateStr) return 'Recently';
    const d = new Date(dateStr);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatDuration = (seconds) => {
    if (!seconds && seconds !== 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="space-y-6">
      {/* 1. Header Banner & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            Published Content Hub
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Browse and verify all live videos successfully published to YouTube Shorts and Instagram Reels.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {onReload && (
            <Button
              variant="outline"
              size="sm"
              icon={RefreshCw}
              onClick={onReload}
              className="text-slate-700 hover:text-slate-900"
            >
              Refresh
            </Button>
          )}
          {onNavigate && (
            <Button
              variant="primary"
              size="sm"
              icon={Film}
              onClick={() => onNavigate('library')}
              className="bg-indigo-600 hover:bg-indigo-500"
            >
              Open Video Library
            </Button>
          )}
        </div>
      </div>

      {/* 2. Top Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="p-4 rounded-xl bg-white/60 border border-slate-200/80 flex items-center justify-between">
          <div>
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
              Total Live Posts
            </span>
            <span className="text-2xl font-bold text-slate-900 mt-1 block">
              {stats.total.toLocaleString()}
            </span>
          </div>
          <div className="w-10 h-10 rounded-lg bg-emerald-50/60 border border-emerald-200/40 flex items-center justify-center text-emerald-400 shadow-sm">
            <CheckCircle2 className="w-5 h-5" />
          </div>
        </div>

        <div className="p-4 rounded-xl bg-white/60 border border-slate-200/80 flex items-center justify-between">
          <div>
            <span className="text-[11px] font-semibold text-rose-400 uppercase tracking-wider block">
              YouTube Shorts Live
            </span>
            <span className="text-2xl font-bold text-slate-900 mt-1 block">
              {stats.ytCount.toLocaleString()}
            </span>
          </div>
          <div className="w-10 h-10 rounded-lg bg-rose-50/60 border border-rose-200/40 flex items-center justify-center text-rose-400 shadow-sm">
            <Youtube className="w-5 h-5" />
          </div>
        </div>

        <div className="p-4 rounded-xl bg-white/60 border border-slate-200/80 flex items-center justify-between">
          <div>
            <span className="text-[11px] font-semibold text-pink-400 uppercase tracking-wider block">
              Instagram Reels Live
            </span>
            <span className="text-2xl font-bold text-slate-900 mt-1 block">
              {stats.igCount.toLocaleString()}
            </span>
          </div>
          <div className="w-10 h-10 rounded-lg bg-pink-50/60 border border-pink-200/40 flex items-center justify-center text-pink-400 shadow-sm">
            <Instagram className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* 3. Filter & Search Controls */}
      <Card>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          {/* Search Box */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              placeholder="Search published titles, original filenames, or channels..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-xs text-slate-800 placeholder-slate-500 focus:outline-none focus:border-indigo-500/60"
            />
          </div>

          {/* Platform Filter Buttons */}
          <div className="flex items-center gap-1.5 bg-slate-50 p-1 rounded-lg border border-slate-200 self-start sm:self-auto">
            <button
              type="button"
              onClick={() => setPlatformFilter('all')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                platformFilter === 'all'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:text-slate-800'
              }`}
            >
              All Platforms
            </button>
            <button
              type="button"
              onClick={() => setPlatformFilter('youtube')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 ${
                platformFilter === 'youtube'
                  ? 'bg-rose-600 text-white'
                  : 'text-slate-400 hover:text-rose-400'
              }`}
            >
              <Youtube className="w-3.5 h-3.5" />
              YouTube Shorts
            </button>
            <button
              type="button"
              onClick={() => setPlatformFilter('instagram')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 ${
                platformFilter === 'instagram'
                  ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white'
                  : 'text-slate-400 hover:text-pink-400'
              }`}
            >
              <Instagram className="w-3.5 h-3.5" />
              Instagram Reels
            </button>
          </div>

          {/* Account Filter Dropdown */}
          {accounts.length > 0 && (
            <select
              value={accountFilter}
              onChange={(e) => setAccountFilter(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2 text-xs text-slate-700 focus:outline-none focus:border-indigo-500/60"
            >
              <option value="all">All Channels & Accounts</option>
              {accounts.map((acc) => (
                <option key={acc._id} value={acc._id}>
                  {acc.platform === 'youtube' ? '📺 ' : '📸 '}
                  {acc.accountName || acc.username}
                </option>
              ))}
            </select>
          )}
        </div>
      </Card>

      {/* 4. Published Cards Grid */}
      {filteredPosts.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title={publishedPosts.length === 0 ? 'No Published Videos Yet' : 'No Videos Found'}
          description={
            publishedPosts.length === 0
              ? 'When scheduled videos in the Publishing Queue are published to YouTube or Instagram, they will appear here with live watch links.'
              : 'No published videos match your current search and filter criteria.'
          }
          actionLabel={publishedPosts.length === 0 ? 'Go to Video Library' : 'Clear Filters'}
          onAction={() => {
            if (publishedPosts.length === 0 && onNavigate) {
              onNavigate('library');
            } else {
              setSearchQuery('');
              setPlatformFilter('all');
              setAccountFilter('all');
            }
          }}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredPosts.map((post) => {
            const video = post.videoId || {};
            const account = post.accountId || {};
            const liveUrl =
              post.publishDetails?.externalUrl ||
              (post.platform === 'youtube' && post.publishDetails?.externalPostId
                ? `https://www.youtube.com/watch?v=${post.publishDetails.externalPostId}`
                : post.platform === 'instagram' && post.publishDetails?.externalPostId
                ? `https://www.instagram.com/p/${post.publishDetails.externalPostId}/`
                : null);

            return (
              <Card
                key={post._id}
                className="overflow-hidden flex flex-col justify-between hover:border-slate-300 transition-all border border-slate-200/80 bg-white/60 shadow-xs"
              >
                <div>
                  {/* Top Thumbnail Preview */}
                  <div className="relative aspect-video bg-slate-50 overflow-hidden group">
                    {video?._id || video?.thumbnailUrl ? (
                      <img
                        src={getVideoThumbnailUrl(video?._id) || video?.thumbnailUrl}
                        alt={post.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        loading="lazy"
                        onError={(e) => {
                          if (video?.thumbnailUrl && e.target.src !== video.thumbnailUrl) {
                            e.target.src = video.thumbnailUrl;
                          }
                        }}
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center bg-slate-50 text-slate-600">
                        <Film className="w-8 h-8 mb-1" />
                        <span className="text-[10px]">No Thumbnail</span>
                      </div>
                    )}

                    {/* Gradient Overlay */}
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-50/90 via-slate-50/20 to-transparent" />

                    {/* Platform Badge (Top Left) */}
                    <div className="absolute top-2 left-2 flex items-center gap-1.5">
                      {post.platform === 'youtube' ? (
                        <span className="bg-rose-600/90 backdrop-blur-xs text-white text-[10px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1 shadow-sm">
                          <Youtube className="w-3 h-3" />
                          YouTube Shorts
                        </span>
                      ) : (
                        <span className="bg-gradient-to-r from-purple-600/90 to-pink-600/90 backdrop-blur-xs text-white text-[10px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1 shadow-sm">
                          <Instagram className="w-3 h-3" />
                          Instagram Reel
                        </span>
                      )}

                      {video.resolution?.isVertical && (
                        <span className="bg-white/80 backdrop-blur-xs text-slate-700 text-[9px] font-bold px-1.5 py-0.5 rounded border border-slate-300/50">
                          9:16
                        </span>
                      )}
                    </div>

                    {/* Duration Badge (Bottom Right) */}
                    {video.duration > 0 && (
                      <span className="absolute bottom-2 right-2 bg-slate-900/80 backdrop-blur-xs text-white text-[9px] font-mono px-1.5 py-0.5 rounded">
                        {formatDuration(video.duration)}
                      </span>
                    )}

                    {/* Published Date (Bottom Left) */}
                    <span className="absolute bottom-2 left-2 text-[10px] text-slate-700 flex items-center gap-1 drop-shadow-md">
                      <Clock className="w-3 h-3 text-emerald-400" />
                      {formatPublishDate(post.publishedAt || post.updatedAt)}
                    </span>
                  </div>

                  {/* Body Content */}
                  <div className="p-4 space-y-3">
                    {/* Title */}
                    <h3 className="font-semibold text-slate-900 text-sm line-clamp-2 leading-snug">
                      {post.title}
                    </h3>

                    {/* Account Info Pill */}
                    <div className="flex items-center gap-2 text-xs text-slate-700 bg-slate-50/60 p-2 rounded-lg border border-slate-200/60">
                      <ChannelAvatar
                        account={account}
                        size="xs"
                        showBadge={false}
                      />
                      <span className="font-medium truncate flex-1">
                        {account.accountName || account.username || 'Connected Channel'}
                      </span>
                      <span className="text-[10px] text-emerald-400 font-semibold uppercase flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        Live
                      </span>
                    </div>

                    {/* Caption Preview */}
                    {post.caption && (
                      <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed">
                        {post.caption}
                      </p>
                    )}

                    {/* Hashtags */}
                    {Array.isArray(post.hashtags) && post.hashtags.length > 0 && (
                      <div className="flex flex-wrap gap-1 text-[10px] text-indigo-400/80">
                        {post.hashtags.slice(0, 4).map((h, idx) => (
                          <span key={idx}>{h.startsWith('#') ? h : `#${h}`}</span>
                        ))}
                        {post.hashtags.length > 4 && (
                          <span className="text-slate-500">+{post.hashtags.length - 4} more</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Bottom Actions */}
                <div className="p-4 pt-0 border-t border-slate-200/60 mt-2 flex items-center gap-2">
                  {liveUrl ? (
                    <a
                      href={liveUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 inline-flex items-center justify-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors shadow-sm"
                    >
                      <span>Watch Live</span>
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </a>
                  ) : (
                    <button
                      type="button"
                      disabled
                      className="flex-1 bg-slate-100 text-slate-500 text-xs px-3 py-2 rounded-lg cursor-not-allowed"
                    >
                      Live URL Pending
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => setSelectedPostDetails(post)}
                    className="p-2 text-slate-400 hover:text-slate-800 bg-slate-50 border border-slate-200 hover:border-slate-300 rounded-lg text-xs transition-colors"
                    title="View Execution Details & Audit"
                  >
                    <Info className="w-4 h-4" />
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* 5. Post Execution & Audit Details Modal */}
      {selectedPostDetails && (
        <Modal
          isOpen={Boolean(selectedPostDetails)}
          onClose={() => setSelectedPostDetails(null)}
          title="Published Post Audit & Details"
        >
          <div className="space-y-4 text-xs max-h-[75vh] overflow-y-auto pr-1">
            {/* Live Link Button */}
            {selectedPostDetails.publishDetails?.externalUrl && (
              <a
                href={selectedPostDetails.publishDetails.externalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center justify-between p-3 rounded-lg bg-indigo-600/20 border border-indigo-500/40 text-indigo-700 hover:bg-indigo-600/30 transition-colors"
              >
                <div className="flex items-center gap-2 font-semibold">
                  <ExternalLink className="w-4 h-4" />
                  <span>Open Live Post on {selectedPostDetails.platform === 'youtube' ? 'YouTube' : 'Instagram'}</span>
                </div>
                <ArrowUpRight className="w-4 h-4" />
              </a>
            )}

            {/* Title & Metadata */}
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
              <div>
                <span className="text-[10px] text-slate-500 uppercase tracking-wider block">Video Title</span>
                <span className="font-semibold text-slate-900 text-sm">{selectedPostDetails.title}</span>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-200 text-[11px]">
                <div>
                  <span className="text-slate-500 block">Platform:</span>
                  <span className="font-medium text-slate-800 capitalize">{selectedPostDetails.platform}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Published At:</span>
                  <span className="font-medium text-slate-800">
                    {formatPublishDate(selectedPostDetails.publishedAt)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">Platform ID:</span>
                  <span className="font-mono text-slate-700 text-[10px]">
                    {selectedPostDetails.publishDetails?.externalPostId || '—'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">Channel / Account:</span>
                  <span className="font-medium text-slate-800">
                    {selectedPostDetails.accountId?.accountName || selectedPostDetails.accountId?.username || '—'}
                  </span>
                </div>
              </div>
            </div>

            {/* Caption */}
            {selectedPostDetails.caption && (
              <div className="space-y-1">
                <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block">
                  Caption & Description
                </span>
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-slate-700 text-xs whitespace-pre-wrap leading-relaxed max-h-40 overflow-y-auto">
                  {selectedPostDetails.caption}
                </div>
              </div>
            )}

            {/* Step-by-Step Execution Logs */}
            <div className="space-y-1">
              <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block">
                Execution Audit Trail
              </span>
              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
                {selectedPostDetails.executionLogs && selectedPostDetails.executionLogs.length > 0 ? (
                  selectedPostDetails.executionLogs.map((log, idx) => (
                    <div key={idx} className="flex items-start gap-2 text-[11px] pb-1.5 border-b border-slate-200 last:border-0 last:pb-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0 mt-1.5" />
                      <div className="flex-1">
                        <span className="text-slate-800 block font-medium">{log.message}</span>
                        {log.timestamp && (
                          <span className="text-[9px] text-slate-500 font-mono">
                            {new Date(log.timestamp).toLocaleTimeString()}
                          </span>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <span className="text-slate-500 text-xs">No execution logs recorded.</span>
                )}
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
