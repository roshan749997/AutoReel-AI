import React, { useState } from 'react';
import {
  Cpu,
  Terminal,
  Play,
  CheckCircle2,
  AlertCircle,
  Copy,
  ExternalLink,
  GitBranch,
  Shield,
} from 'lucide-react';
import { Card, CardHeader } from '../common/Card.jsx';
import { Button } from '../common/Button.jsx';
import { Badge } from '../common/Badge.jsx';
import { api } from '../../api/client.js';

export const AutomationModule = ({ n8nStatus, onReload }) => {
  const [isTriggering, setIsTriggering] = useState(false);
  const [triggerResult, setTriggerResult] = useState(null);
  const [copiedCmd, setCopiedCmd] = useState(false);

  const dockerCommand = 'docker compose -f automation/n8n/docker-compose.yml up -d';

  const copyToClipboard = () => {
    navigator.clipboard.writeText(dockerCommand);
    setCopiedCmd(true);
    setTimeout(() => setCopiedCmd(false), 2000);
  };

  const handleTestWebhook = async () => {
    try {
      setIsTriggering(true);
      setTriggerResult(null);
      const res = await api.triggerWorkflow({
        workflow: 'video-pipeline',
        payload: { test: true, timestamp: new Date().toISOString() },
      });
      setTriggerResult({ success: true, message: res.message || 'Trigger sent successfully' });
    } catch (err) {
      setTriggerResult({ success: false, message: err.message });
    } finally {
      setIsTriggering(false);
    }
  };

  const isRunning = Boolean(
    n8nStatus?.connected ?? n8nStatus?.isReachable ?? (n8nStatus?.dockerStatus === 'running')
  );

  return (
    <div className="space-y-6">
      {/* n8n Status Card */}
      <Card>
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center border ${
                isRunning
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                  : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
              }`}
            >
              <Cpu className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold text-slate-900">Self-Hosted n8n Engine</h3>
                <Badge variant={isRunning ? 'success' : 'warning'} dot>
                  {isRunning ? 'Running on 127.0.0.1:5678' : 'Not Running'}
                </Badge>
              </div>
              <p className="text-xs text-slate-400 mt-1 max-w-xl">
                Community Edition running locally via Docker Compose. Bound exclusively to 127.0.0.1 for maximum security with persistent encrypted storage.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isRunning && (
              <a
                href="http://127.0.0.1:5678"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 text-slate-800 hover:bg-slate-200 transition-colors border border-slate-300"
              >
                Open n8n UI
                <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
              </a>
            )}
            <Button
              variant="primary"
              size="sm"
              icon={Play}
              isLoading={isTriggering}
              onClick={handleTestWebhook}
              className="text-xs"
            >
              Test Webhook Trigger
            </Button>
          </div>
        </div>
      </Card>

      {/* Trigger Feedback Banner */}
      {triggerResult && (
        <div
          className={`p-4 rounded-xl border text-xs flex items-center justify-between ${
            triggerResult.success
              ? 'bg-emerald-50/20 border-emerald-500/30 text-emerald-700'
              : 'bg-amber-50/20 border-amber-500/30 text-amber-800'
          }`}
        >
          <div className="flex items-center gap-2 font-mono">
            {triggerResult.success ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
            )}
            <span>{triggerResult.message}</span>
          </div>
          <button onClick={() => setTriggerResult(null)} className="text-slate-400 hover:text-slate-800">
            &times;
          </button>
        </div>
      )}

      {/* Docker Compose Instructions Card */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader
            title="Local Docker Setup (Windows)"
            subtitle="Start n8n Community Edition bound to 127.0.0.1"
          />

          <div className="space-y-4 text-xs">
            <p className="text-slate-400 leading-relaxed">
              To launch your self-hosted n8n instance, ensure Docker Desktop is running on Windows, then execute in PowerShell:
            </p>

            <div className="relative group bg-slate-50 rounded-lg p-3 font-mono text-[11px] text-indigo-700 border border-slate-200 flex items-center justify-between">
              <code>{dockerCommand}</code>
              <button
                onClick={copyToClipboard}
                className="p-1.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
                title="Copy command"
              >
                {copiedCmd ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>

            <div className="space-y-2 text-slate-400">
              <div className="flex items-center gap-2 text-slate-700 font-medium">
                <Shield className="w-4 h-4 text-emerald-400" />
                Security Specifications:
              </div>
              <ul className="list-disc pl-5 space-y-1 text-[11px] text-slate-400">
                <li>Host binding: strictly <code className="text-slate-700">127.0.0.1:5678</code></li>
                <li>Persistent volume: <code className="text-slate-700">video_automation_n8n_data</code></li>
                <li>Database encryption: configured via <code className="text-slate-700">N8N_ENCRYPTION_KEY</code></li>
              </ul>
            </div>
          </div>
        </Card>

        {/* Workflow Pipeline Architecture */}
        <Card>
          <CardHeader
            title="Pipeline Architecture"
            subtitle="Event-driven content preparation and dispatch flow"
          />

          <div className="space-y-3 text-xs">
            <div className="p-3 rounded-lg bg-slate-50/60 border border-slate-200/80 space-y-1.5">
              <div className="flex items-center justify-between text-indigo-400 font-semibold text-[11px]">
                <span>1. Google Drive Ingestion</span>
                <Badge variant="neutral">Auto-Sync</Badge>
              </div>
              <p className="text-slate-400 text-[11px]">
                Indexes 20,000+ files via Drive API v3 without downloading entire files locally.
              </p>
            </div>

            <div className="p-3 rounded-lg bg-slate-50/60 border border-slate-200/80 space-y-1.5">
              <div className="flex items-center justify-between text-purple-400 font-semibold text-[11px]">
                <span>2. AI Content Generation</span>
                <Badge variant="purple">Gemini / Ollama</Badge>
              </div>
              <p className="text-slate-400 text-[11px]">
                Analyzes video tags and creates viral hooks, captions, and targeted hashtags.
              </p>
            </div>

            <div className="p-3 rounded-lg bg-slate-50/60 border border-slate-200/80 space-y-1.5">
              <div className="flex items-center justify-between text-emerald-400 font-semibold text-[11px]">
                <span>3. Official API Publishing</span>
                <Badge variant="success">YouTube / Meta</Badge>
              </div>
              <p className="text-slate-400 text-[11px]">
                Scheduler worker streams video directly from Drive into YouTube Shorts & Instagram Reels containers.
              </p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
};
