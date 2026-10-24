import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Folder } from 'lucide-react';

export const videoFolderLabel = (video) => {
  if (Array.isArray(video?.folderPathNames) && video.folderPathNames.length > 0) {
    return video.folderPathNames.join(' / ');
  }
  return video?.folderName || '';
};

const FolderNode = ({ node, depth, selectedId, onSelect }) => {
  const [open, setOpen] = useState(depth < 2);
  const hasChildren = node.children?.length > 0;
  const active = selectedId === node.id;

  return (
    <div>
      <div className="flex items-center gap-0.5" style={{ paddingLeft: depth * 14 }}>
        <button
          type="button"
          onClick={() => hasChildren && setOpen((value) => !value)}
          className="w-5 h-6 flex items-center justify-center text-slate-500"
          aria-label={open ? 'Collapse folder' : 'Expand folder'}
        >
          {hasChildren ? (
            open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />
          ) : (
            <span className="w-3.5" />
          )}
        </button>
        <button
          type="button"
          onClick={() => onSelect(active ? '' : node.id)}
          className={`flex-1 min-w-0 flex items-center justify-between gap-2 px-2 py-1 rounded-md text-left text-xs transition-colors ${
            active ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:bg-slate-800'
          }`}
        >
          <span className="flex items-center gap-1.5 min-w-0">
            <Folder className={`w-3.5 h-3.5 shrink-0 ${active ? 'text-white' : 'text-indigo-400'}`} />
            <span className="truncate">{node.name || 'Untitled folder'}</span>
          </span>
          <span className={`text-[10px] shrink-0 ${active ? 'text-indigo-100' : 'text-slate-500'}`}>{node.total ?? node.count ?? 0}</span>
        </button>
      </div>
      {open &&
        hasChildren &&
        node.children.map((child) => (
          <FolderNode key={child.id} node={child} depth={depth + 1} selectedId={selectedId} onSelect={onSelect} />
        ))}
    </div>
  );
};

export const FolderTree = ({ nodes = [], selectedId, onSelect }) => {
  if (!nodes.length) return null;
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-2 max-h-72 overflow-y-auto">
      <button
        type="button"
        onClick={() => onSelect('')}
        className={`w-full text-left px-2 py-1.5 mb-1 rounded-md text-xs ${
          !selectedId ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:bg-slate-800'
        }`}
      >
        All folders
      </button>
      {nodes.map((node) => (
        <FolderNode key={node.id} node={node} depth={0} selectedId={selectedId} onSelect={onSelect} />
      ))}
    </div>
  );
};
