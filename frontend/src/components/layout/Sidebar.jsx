import React from 'react';
import {
  LayoutDashboard,
  Users2,
  Folders,
  Film,
  CheckCircle2,
  ListVideo,
  Calendar,
  Cpu,
  ScrollText,
  Activity,
  Sparkles,
  FolderInput,
} from 'lucide-react';

const navItems = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'accounts', label: 'Social Accounts', icon: Users2 },
  { id: 'channels', label: 'Channels', icon: Folders },
  { id: 'library', label: 'Video Library', icon: Film, badge: '20k+' },
  { id: 'published', label: 'Published Videos', icon: CheckCircle2, badge: 'Live' },
  { id: 'queue', label: 'Publishing Queue', icon: ListVideo },
  { id: 'calendar', label: 'Calendar', icon: Calendar },
  { id: 'automation', label: 'Automation (n8n)', icon: Cpu },
  { id: 'logs', label: 'Activity Logs', icon: ScrollText },
  { id: 'drive-transfer', label: 'Drive Transfer', icon: FolderInput },
];

export const Sidebar = ({ activeTab, onSelectTab, isMobileOpen, onCloseMobile, systemStatus, failedPostsCount = 0 }) => {
  return (
    <>
      {/* Mobile backdrop */}
      {isMobileOpen && (
        <div
          onClick={onCloseMobile}
          className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm lg:hidden"
        />
      )}

      <aside
        className={`fixed top-0 bottom-0 left-0 z-50 w-64 bg-white border-r border-slate-200/80 flex flex-col transition-transform duration-200 ease-in-out lg:translate-x-0 ${
          isMobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Brand Header */}
        <div className="h-16 px-6 flex items-center gap-3 border-b border-slate-200/80">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white shadow-md shadow-indigo-900/30">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-slate-900 tracking-tight">AutoVideo Agent</h1>
            <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">Free SaaS Pipeline</p>
          </div>
        </div>

        {/* Navigation links */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  onSelectTab(item.id);
                  if (onCloseMobile) onCloseMobile();
                }}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-indigo-50 text-indigo-700 border border-indigo-200 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-transparent'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon className={`w-4 h-4 ${isActive ? 'text-indigo-600' : 'text-slate-500'}`} />
                  <span>{item.label}</span>
                </div>
                {item.id === 'queue' && failedPostsCount > 0 ? (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-500 text-white animate-pulse shadow-sm">
                    {failedPostsCount} Failed
                  </span>
                ) : item.badge ? (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-500 border border-slate-200">
                    {item.badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>

        {/* System Status Footer */}
        <div className="p-4 border-t border-slate-200/80 bg-slate-50/40">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-2 font-medium">
            <span className="flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-slate-500" />
              Status
            </span>
            <span
              className={`inline-flex items-center gap-1 text-[11px] ${
                systemStatus?.healthy ? 'text-emerald-400' : 'text-amber-400'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  systemStatus?.healthy ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
                }`}
              />
              {systemStatus?.healthy ? 'Online' : 'Checking'}
            </span>
          </div>

          <div className="text-[11px] text-slate-500 space-y-1">
            <div className="flex justify-between">
              <span>DB (Mongoose):</span>
              <span className={systemStatus?.dbConnected ? 'text-emerald-400' : 'text-slate-400'}>
                {systemStatus?.dbConnected ? 'Connected' : 'Offline'}
              </span>
            </div>
            <div className="flex justify-between">
              <span>AI Provider:</span>
              <span className="text-indigo-400 uppercase font-mono text-[10px]">
                {systemStatus?.aiProvider || 'Gemini'}
              </span>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
};
