import React, { useState } from 'react';
import {
  ScrollText,
  Filter,
  Trash2,
  AlertCircle,
  CheckCircle2,
  Info,
  AlertTriangle,
  RefreshCw,
  Code2,
} from 'lucide-react';
import { Card, CardHeader } from '../common/Card.jsx';
import { Button } from '../common/Button.jsx';
import { Badge } from '../common/Badge.jsx';
import { EmptyState } from '../common/EmptyState.jsx';
import { Modal } from '../common/Modal.jsx';
import { api } from '../../api/client.js';

export const LogsModule = ({ logs, onReload, pagination, onFilterChange }) => {
  const [selectedLog, setSelectedLog] = useState(null);
  const [isClearing, setIsClearing] = useState(false);

  const handleClearLogs = async () => {
    if (!window.confirm('Are you sure you want to clear all audit logs?')) return;
    try {
      setIsClearing(true);
      await api.clearLogs();
      onReload();
    } catch (err) {
      alert(`Clear logs error: ${err.message}`);
    } finally {
      setIsClearing(false);
    }
  };

  const getLevelBadge = (level) => {
    switch (level) {
      case 'success':
        return <Badge variant="success" dot>SUCCESS</Badge>;
      case 'error':
        return <Badge variant="error" dot>ERROR</Badge>;
      case 'warn':
        return <Badge variant="warning" dot>WARN</Badge>;
      default:
        return <Badge variant="info" dot>INFO</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Controls */}
      <Card>
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <select
              onChange={(e) => onFilterChange({ module: e.target.value })}
              className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-700 focus:outline-none"
            >
              <option value="">All Modules</option>
              <option value="drive">Drive</option>
              <option value="ai">AI</option>
              <option value="youtube">YouTube</option>
              <option value="instagram">Instagram</option>
              <option value="n8n">n8n</option>
              <option value="scheduler">Scheduler</option>
              <option value="system">System</option>
            </select>

            <select
              onChange={(e) => onFilterChange({ level: e.target.value })}
              className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-700 focus:outline-none"
            >
              <option value="">All Levels</option>
              <option value="info">Info</option>
              <option value="success">Success</option>
              <option value="warn">Warn</option>
              <option value="error">Error</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon={RefreshCw}
              onClick={onReload}
              className="text-xs"
            >
              Refresh
            </Button>
            <Button
              variant="danger"
              size="sm"
              icon={Trash2}
              isLoading={isClearing}
              onClick={handleClearLogs}
              className="text-xs"
            >
              Clear Logs
            </Button>
          </div>
        </div>
      </Card>

      {/* Logs Table */}
      <Card>
        <CardHeader
          title="Audit Trail"
          subtitle={`Showing ${logs.length} most recent log records`}
        />

        {logs.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title="No logs recorded"
            description="System activity logs, Drive sync results, and publishing status events will appear here."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50/60 text-slate-400 font-semibold border-b border-slate-200/80">
                <tr>
                  <th className="py-2.5 px-3">Timestamp</th>
                  <th className="py-2.5 px-3">Level</th>
                  <th className="py-2.5 px-3">Module</th>
                  <th className="py-2.5 px-3">Action</th>
                  <th className="py-2.5 px-3">Message</th>
                  <th className="py-2.5 px-3 text-right">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/60 font-mono">
                {logs.map((log) => (
                  <tr key={log._id} className="hover:bg-slate-850/40 transition-colors">
                    <td className="py-2.5 px-3 text-slate-400 whitespace-nowrap text-[11px]">
                      {new Date(log.createdAt).toLocaleTimeString([], {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </td>
                    <td className="py-2.5 px-3">{getLevelBadge(log.level)}</td>
                    <td className="py-2.5 px-3">
                      <span className="px-2 py-0.5 rounded text-[10px] uppercase font-semibold bg-slate-100 text-slate-700">
                        {log.module}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-slate-700 text-[11px] font-sans font-medium">
                      {log.action}
                    </td>
                    <td className="py-2.5 px-3 text-slate-400 font-sans truncate max-w-xs">
                      {log.message}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      {log.metadata ? (
                        <button
                          onClick={() => setSelectedLog(log)}
                          className="p-1 rounded text-slate-400 hover:text-indigo-400 hover:bg-slate-100"
                          title="View metadata"
                        >
                          <Code2 className="w-4 h-4" />
                        </button>
                      ) : (
                        <span className="text-slate-600">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Metadata Detail Modal */}
      <Modal
        isOpen={!!selectedLog}
        onClose={() => setSelectedLog(null)}
        title={`Log Metadata: ${selectedLog?.action}`}
      >
        <div className="space-y-3 text-xs">
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 font-sans">
            <span className="text-slate-400 block mb-1">Message:</span>
            <p className="text-slate-900 font-medium">{selectedLog?.message}</p>
          </div>

          <div>
            <span className="text-slate-400 block mb-1 font-sans">Payload Metadata:</span>
            <pre className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-indigo-700 overflow-x-auto font-mono text-[11px]">
              {JSON.stringify(selectedLog?.metadata, null, 2)}
            </pre>
          </div>
        </div>
      </Modal>
    </div>
  );
};
