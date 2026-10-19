import React from 'react';
import {
  Film,
  Users2,
  ListVideo,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Sparkles,
  Server,
  ArrowUpRight,
  ShieldCheck,
} from 'lucide-react';
import { Card, CardHeader } from '../common/Card.jsx';
import { Badge } from '../common/Badge.jsx';
import { Button } from '../common/Button.jsx';

export const OverviewModule = ({
  integrations,
  checklist,
  stats,
  upcomingPosts,
  onNavigate,
  onSyncDrive,
}) => {
  return (
    <div className="space-y-6">
      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card hover onClick={() => onNavigate('library')} className="group">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">Library Videos</span>
            <div className="w-8 h-8 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center">
              <Film className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-100">{stats?.indexedVideos ?? 0}</span>
            <span className="text-xs text-slate-400">files indexed</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-2 flex items-center gap-1 group-hover:text-indigo-400 transition-colors">
            Browse 20k+ Drive Library <ArrowUpRight className="w-3 h-3" />
          </p>
        </Card>

        <Card hover onClick={() => onNavigate('accounts')} className="group">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">Active Social Channels</span>
            <div className="w-8 h-8 rounded-lg bg-purple-500/10 text-purple-400 flex items-center justify-center">
              <Users2 className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-100">{stats?.connectedAccounts ?? 0}</span>
            <span className="text-xs text-slate-400">connected</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-2 flex items-center gap-1 group-hover:text-purple-400 transition-colors">
            YouTube & Instagram <ArrowUpRight className="w-3 h-3" />
          </p>
        </Card>

        <Card hover onClick={() => onNavigate('queue')} className="group">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">Publishing Queue</span>
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center">
              <ListVideo className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-100">{stats?.queuedPosts ?? 0}</span>
            <span className="text-xs text-slate-400">posts ready</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-2 flex items-center gap-1 group-hover:text-amber-400 transition-colors">
            Manage scheduling <ArrowUpRight className="w-3 h-3" />
          </p>
        </Card>

        <Card hover onClick={() => onNavigate('logs')} className="group">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">Published Total</span>
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-100">{stats?.publishedPosts ?? 0}</span>
            <span className="text-xs text-slate-400">dispatched</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-2 flex items-center gap-1 group-hover:text-emerald-400 transition-colors">
            View audit logs <ArrowUpRight className="w-3 h-3" />
          </p>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Setup Checklist */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader
              title="System Setup Checklist"
              subtitle="Step-by-step verification of free-only services and official platform APIs"
              action={
                <Badge variant={checklist?.overallProgress === 100 ? 'success' : 'info'} dot>
                  {checklist?.overallProgress ?? 0}% Complete
                </Badge>
              }
            />

            <div className="space-y-3">
              {(checklist?.items || []).map((item) => (
                <div
                  key={item.id}
                  className={`p-3.5 rounded-lg border flex items-start justify-between gap-4 transition-colors ${
                    item.isCompleted
                      ? 'bg-slate-900/40 border-slate-800 text-slate-300'
                      : 'bg-slate-800/40 border-slate-700/80 text-slate-200'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {item.isCompleted ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-400 mt-0.5 shrink-0" />
                    ) : (
                      <AlertCircle className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />
                    )}
                    <div>
                      <h4 className="text-xs font-semibold text-slate-200">{item.title}</h4>
                      <p className="text-[11px] text-slate-400 mt-0.5">{item.description}</p>
                      {item.metadata?.indexedVideos !== undefined && (
                        <p className="text-[11px] text-indigo-400 mt-1 font-medium">
                          {item.metadata.indexedVideos} videos indexed in library
                        </p>
                      )}
                    </div>
                  </div>

                  {item.docsLink && (
                    <span className="text-[11px] text-slate-400 font-mono shrink-0 hidden sm:inline">
                      {item.docsLink}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Integration Status Indicators */}
        <div>
          <Card>
            <CardHeader
              title="Connection Diagnostics"
              subtitle="Live health of external services"
              action={<ShieldCheck className="w-4 h-4 text-emerald-400" />}
            />

            <div className="space-y-3">
              {integrations &&
                Object.entries(integrations).map(([key, info]) => {
                  const isOk = info?.connected;
                  return (
                    <div
                      key={key}
                      className="p-3 rounded-lg bg-slate-950/40 border border-slate-800/80 flex items-center justify-between"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`w-2 h-2 rounded-full ${
                              isOk ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
                            }`}
                          />
                          <span className="text-xs font-semibold text-slate-200">{info?.name || key}</span>
                        </div>
                        <p className="text-[10px] text-slate-400 mt-0.5 truncate max-w-[200px]">
                          {info?.message || (isOk ? 'Connected' : 'Pending configuration')}
                        </p>
                      </div>
                      <Badge variant={isOk ? 'success' : 'neutral'} className="text-[10px]">
                        {isOk ? 'Active' : 'Offline'}
                      </Badge>
                    </div>
                  );
                })}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};
