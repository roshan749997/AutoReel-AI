import React from 'react';
import { AlertCircle, ArrowRight, CheckCircle2 } from 'lucide-react';

export const StatusBanner = ({ checklist, onNavigate }) => {
  if (!checklist || !checklist.items) return null;

  const incompleteItems = checklist.items.filter((item) => !item.isCompleted);
  if (incompleteItems.length === 0) return null;

  const nextStep = incompleteItems[0];

  return (
    <div className="bg-white border-b border-indigo-500/20 px-6 py-2.5 flex items-center justify-between text-xs">
      <div className="flex items-center gap-2.5 text-slate-700">
        <span className="flex h-2 w-2 relative">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
        </span>
        <span className="font-medium text-indigo-700">Setup Progress: {checklist.overallProgress}% complete.</span>
        <span className="text-slate-400 hidden sm:inline">Next step: {nextStep.title}</span>
      </div>

      <button
        onClick={() => onNavigate('overview')}
        className="inline-flex items-center gap-1 font-medium text-indigo-600 hover:text-indigo-800 hover:underline"
      >
        View setup checklist
        <ArrowRight className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
