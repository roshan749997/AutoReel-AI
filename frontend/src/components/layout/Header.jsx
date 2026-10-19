import React from 'react';
import { Menu, RefreshCw } from 'lucide-react';
import { Button } from '../common/Button.jsx';
import { Badge } from '../common/Badge.jsx';

const titleMap = {
  overview: { title: 'Dashboard Overview', desc: 'Central command for accounts, queue, and content workflows' },
  accounts: { title: 'Social Accounts', desc: 'Manage official YouTube Data API & Meta Instagram Graph API connections' },
  library: { title: 'Google Drive Video Library', desc: 'Catalog and stream 20,000+ videos directly from Drive' },
  queue: { title: 'Publishing Queue', desc: 'Scheduled reels and shorts awaiting official API dispatch' },
  calendar: { title: 'Publishing Calendar', desc: 'Timeline view of scheduled and published content' },
  automation: { title: 'Automation Workflows', desc: 'Self-hosted n8n pipeline orchestration on 127.0.0.1' },
  logs: { title: 'System Activity Logs', desc: 'Audit trail for syncing, AI generation, and publishing attempts' },
};

export const Header = ({ activeTab, onOpenMobile, onRefresh, isRefreshing, systemStatus }) => {
  const current = titleMap[activeTab] || { title: 'Dashboard', desc: '' };

  return (
    <header className="h-16 px-6 bg-slate-900/60 backdrop-blur-md border-b border-slate-800/80 flex items-center justify-between sticky top-0 z-30">
      <div className="flex items-center gap-4">
        <button
          onClick={onOpenMobile}
          className="p-2 -ml-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 lg:hidden"
          aria-label="Open sidebar"
        >
          <Menu className="w-5 h-5" />
        </button>
        <div>
          <h2 className="text-sm font-semibold text-slate-100">{current.title}</h2>
          <p className="text-xs text-slate-400 hidden sm:block">{current.desc}</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {systemStatus?.dbConnected ? (
          <Badge variant="success" dot className="hidden md:inline-flex">
            MongoDB Atlas Connected
          </Badge>
        ) : (
          <Badge variant="warning" dot className="hidden md:inline-flex">
            DB Config Pending
          </Badge>
        )}

        <Button
          variant="secondary"
          size="sm"
          icon={RefreshCw}
          isLoading={isRefreshing}
          onClick={onRefresh}
          className="text-xs"
        >
          Refresh
        </Button>
      </div>
    </header>
  );
};
