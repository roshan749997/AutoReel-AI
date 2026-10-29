import React from 'react';
import { Folders } from 'lucide-react';
import { channelAccountLabels, channelTitle } from '../../utils/channelPairs.js';

export const ChannelSwitcher = ({
  pairs = [],
  accounts = [],
  selectedFolderId = '',
  showAllActive = false,
  onSelect,
  onOpenChannels,
  emptyHint = 'Open Channels and link each Drive folder to one YouTube and one Instagram account.',
}) => {
  if (!pairs.length) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/40 px-3 py-2.5 text-xs text-slate-400 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <span>{emptyHint}</span>
        {onOpenChannels && (
          <button
            type="button"
            onClick={onOpenChannels}
            className="shrink-0 text-[11px] text-indigo-700 hover:text-indigo-800"
          >
            Open Channels
          </button>
        )}
      </div>
    );
  }

  const isAllActive = showAllActive || selectedFolderId === 'all';

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-slate-400 flex items-center gap-1">
          <Folders className="w-3.5 h-3.5 text-indigo-400" />
          Channels
        </span>
        {onOpenChannels && (
          <button type="button" onClick={onOpenChannels} className="text-[11px] text-indigo-700 hover:text-indigo-800">
            Edit links
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onSelect(isAllActive ? '' : 'all')}
          className={`px-2.5 py-1.5 rounded-lg text-xs border transition-colors ${
            isAllActive
              ? 'bg-indigo-600 text-white border-indigo-500 font-medium'
              : 'bg-slate-50 text-slate-700 border-slate-200 hover:border-slate-300'
          }`}
        >
          All channels
        </button>
        {pairs.map((pair) => {
          const active = String(selectedFolderId) === String(pair.folderId);
          const labels = channelAccountLabels(pair, accounts);
          return (
            <button
              key={pair.folderId}
              type="button"
              onClick={() => onSelect(active ? '' : pair.folderId)}
              className={`max-w-[220px] text-left px-2.5 py-1.5 rounded-lg text-xs border transition-colors ${
                active
                  ? 'bg-indigo-600 text-white border-indigo-500'
                  : 'bg-slate-50 text-slate-700 border-slate-200 hover:border-slate-300'
              }`}
              title={`${labels.youtube} · ${labels.instagram}`}
            >
              <span className="block truncate font-medium">{channelTitle(pair, accounts)}</span>
              <span className={`block truncate text-[10px] ${active ? 'text-indigo-100' : 'text-slate-500'}`}>
                YT {labels.youtube} · IG {labels.instagram}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
