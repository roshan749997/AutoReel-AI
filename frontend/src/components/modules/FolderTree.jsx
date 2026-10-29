import React, { useState, useMemo, useEffect } from 'react';
import {
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  Home,
  ArrowLeft,
  Check,
  Globe,
  LayoutGrid,
  ListTree,
  SlidersHorizontal,
} from 'lucide-react';

export const videoFolderLabel = (video) => {
  if (Array.isArray(video?.folderPathNames) && video.folderPathNames.length > 0) {
    return video.folderPathNames.join(' / ');
  }
  return video?.folderName || '';
};

const visibleChildren = (node) =>
  (node?.children || []).filter((child) => (child.total ?? child.count ?? 0) > 0);

// Helper to build a hierarchical tree from a flat foldersSummary list if tree is empty
function buildTreeFromFlatList(flatList) {
  if (!Array.isArray(flatList) || flatList.length === 0) return [];
  const nodeMap = new Map();
  const roots = [];

  for (const item of flatList) {
    const ids = Array.isArray(item.folderPathIds) && item.folderPathIds.length > 0
      ? item.folderPathIds
      : [item._id];
    const names = Array.isArray(item.folderPathNames) && item.folderPathNames.length > 0
      ? item.folderPathNames
      : [item.folderName || 'Folder'];

    let parent = null;
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const name = names[i] || 'Folder';
      let node = nodeMap.get(id);
      if (!node) {
        node = { id, name, count: 0, total: 0, children: [] };
        nodeMap.set(id, node);
        if (parent) {
          if (!parent.children.some((c) => c.id === id)) {
            parent.children.push(node);
          }
        } else {
          if (!roots.some((r) => r.id === id)) {
            roots.push(node);
          }
        }
      }
      parent = node;
    }

    const leaf = nodeMap.get(item._id);
    if (leaf) {
      leaf.count += item.count || 0;
    }
  }

  function calcTotal(node) {
    const childTotal = (node.children || []).reduce((acc, c) => acc + calcTotal(c), 0);
    node.total = (node.count || 0) + childTotal;
    return node.total;
  }
  roots.forEach(calcTotal);
  return roots.filter((r) => (r.total || r.count || 0) > 0);
}

// Helper to find the trail/path to a specific folder in the tree
function findPathToNode(tree, targetId) {
  if (!targetId || !Array.isArray(tree)) return [];
  for (const node of tree) {
    if (String(node.id) === String(targetId)) {
      return [node];
    }
    if (node.children && node.children.length > 0) {
      const subPath = findPathToNode(node.children, targetId);
      if (subPath.length > 0) {
        return [node, ...subPath];
      }
    }
  }
  return [];
}

/**
 * Traditional Tree Node (Fallback view)
 */
const FolderTreeNode = ({ node, depth, selectedId, onSelect }) => {
  const children = visibleChildren(node);
  const [open, setOpen] = useState(depth < 2);
  const hasChildren = children.length > 0;
  const active = selectedId === node.id;
  const videoCount = node.total ?? node.count ?? 0;
  if (videoCount <= 0 && !hasChildren) return null;

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
            active ? 'bg-indigo-600 text-white font-medium' : 'text-slate-700 hover:bg-slate-100'
          }`}
        >
          <span className="flex items-center gap-1.5 min-w-0">
            <Folder className={`w-3.5 h-3.5 shrink-0 ${active ? 'text-white' : 'text-amber-500'}`} />
            <span className="truncate">{node.name || 'Untitled folder'}</span>
          </span>
          <span className={`text-[10px] shrink-0 ${active ? 'text-indigo-100' : 'text-slate-500'}`}>
            {videoCount}
            {hasChildren ? ` · ${children.length}` : ''}
          </span>
        </button>
      </div>
      {open &&
        hasChildren &&
        children.map((child) => (
          <FolderTreeNode key={child.id} node={child} depth={depth + 1} selectedId={selectedId} onSelect={onSelect} />
        ))}
    </div>
  );
};

/**
 * Modern Folder Boxes Component
 * Displays Google Drive Folders & Subfolders in beautiful, interactive Card Boxes.
 * Does NOT auto-select "All" - lets the user navigate cleanly.
 */
export const FolderBoxes = ({
  nodes = [],
  foldersList = [],
  selectedId = '',
  onSelect = () => {},
  onShowAll = () => {},
  showAllActive = false,
  totalVideosCount = 0,
}) => {
  const [viewMode, setViewMode] = useState('boxes'); // 'boxes' | 'tree'
  const [currentPath, setCurrentPath] = useState([]);

  // Normalize data into tree structure
  const tree = useMemo(() => {
    if (Array.isArray(nodes) && nodes.length > 0) return nodes;
    if (Array.isArray(foldersList) && foldersList.length > 0) {
      return buildTreeFromFlatList(foldersList);
    }
    return [];
  }, [nodes, foldersList]);

  // Synchronize path when selectedId changes externally (e.g. from ChannelSwitcher)
  useEffect(() => {
    if (selectedId) {
      const path = findPathToNode(tree, selectedId);
      if (path.length > 0) {
        // If the selected folder has children, keep it as current. Otherwise, show its parent path
        setCurrentPath(path);
      }
    } else if (!showAllActive) {
      // Return to root if deselected
      setCurrentPath([]);
    }
  }, [selectedId, tree, showAllActive]);

  // Determine which folders to display at the current level
  const currentFolders = useMemo(() => {
    if (currentPath.length === 0) {
      return tree.filter((n) => (n.total ?? n.count ?? 0) > 0);
    }
    const currentFolder = currentPath[currentPath.length - 1];
    return visibleChildren(currentFolder);
  }, [tree, currentPath]);

  const currentFolderNode = currentPath.length > 0 ? currentPath[currentPath.length - 1] : null;

  // Navigation handlers
  const handleFolderClick = (folder) => {
    const hasKids = folder.children && folder.children.length > 0;
    if (hasKids) {
      // Enter folder and select it
      setCurrentPath((prev) => [...prev, folder]);
      onSelect(folder.id);
    } else {
      // Leaf folder: toggle selection
      onSelect(selectedId === folder.id ? '' : folder.id);
    }
  };

  const handleStepBack = () => {
    if (currentPath.length === 0) return;
    const nextPath = currentPath.slice(0, -1);
    setCurrentPath(nextPath);
    if (nextPath.length > 0) {
      onSelect(nextPath[nextPath.length - 1].id);
    } else {
      onSelect('');
    }
  };

  const handleJumpToPath = (index) => {
    if (index === -1) {
      // Root
      setCurrentPath([]);
      onSelect('');
    } else {
      const nextPath = currentPath.slice(0, index + 1);
      setCurrentPath(nextPath);
      onSelect(nextPath[nextPath.length - 1].id);
    }
  };

  if (!tree.length && !foldersList.length) return null;

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-slate-50/60 p-3 sm:p-4 space-y-3.5 transition-all">
      {/* Top Header & Breadcrumb Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2.5 border-b border-slate-200/70">
        {/* Breadcrumb Path */}
        <div className="flex items-center gap-1.5 flex-wrap text-xs">
          {currentPath.length > 0 && (
            <button
              type="button"
              onClick={handleStepBack}
              className="mr-1 p-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 transition-colors shadow-2xs flex items-center gap-1 text-[11px] font-medium"
              title="Go back up one level"
            >
              <ArrowLeft className="w-3.5 h-3.5 text-indigo-600" />
              <span>Back</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => handleJumpToPath(-1)}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg transition-colors text-xs ${
              currentPath.length === 0 && !selectedId && !showAllActive
                ? 'bg-slate-200 text-slate-800 font-semibold'
                : 'text-slate-600 hover:text-indigo-600 hover:bg-white'
            }`}
          >
            <Home className="w-3.5 h-3.5 text-amber-500" />
            <span>Drive Root</span>
          </button>

          {currentPath.map((item, idx) => {
            const isLast = idx === currentPath.length - 1;
            return (
              <React.Fragment key={item.id}>
                <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <button
                  type="button"
                  onClick={() => handleJumpToPath(idx)}
                  className={`px-2.5 py-1 rounded-lg transition-colors text-xs truncate max-w-[180px] ${
                    isLast
                      ? 'bg-indigo-50 border border-indigo-200 text-indigo-700 font-semibold'
                      : 'text-slate-600 hover:text-indigo-600 hover:bg-white'
                  }`}
                  title={item.name}
                >
                  {item.name}
                </button>
              </React.Fragment>
            );
          })}
        </div>

        {/* Right Action Tools: Browse All (not auto-selected) & View Mode */}
        <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
          {/* Explicit Browse All Videos button */}
          <button
            type="button"
            onClick={onShowAll}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all flex items-center gap-1.5 shadow-2xs ${
              showAllActive
                ? 'bg-indigo-600 text-white border-indigo-500 shadow-sm'
                : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300 hover:text-slate-900'
            }`}
            title="Explicitly view all videos across all folders"
          >
            <Globe className="w-3.5 h-3.5" />
            <span>All Videos{totalVideosCount > 0 ? ` (${totalVideosCount.toLocaleString()})` : ''}</span>
          </button>

          {/* If a folder is currently selected, option to clear */}
          {selectedId && (
            <button
              type="button"
              onClick={() => onSelect('')}
              className="text-[11px] text-slate-500 hover:text-rose-600 px-2 py-1 rounded-lg transition-colors border border-dashed border-slate-200 hover:border-rose-300"
            >
              Clear filter
            </button>
          )}

          {/* Toggle View Mode: Boxes vs Tree */}
          <div className="flex items-center rounded-lg border border-slate-200 bg-white p-0.5">
            <button
              type="button"
              onClick={() => setViewMode('boxes')}
              className={`p-1 rounded-md transition-colors ${
                viewMode === 'boxes' ? 'bg-indigo-600 text-white shadow-2xs' : 'text-slate-500 hover:text-slate-800'
              }`}
              title="Boxes / Cards View"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('tree')}
              className={`p-1 rounded-md transition-colors ${
                viewMode === 'tree' ? 'bg-indigo-600 text-white shadow-2xs' : 'text-slate-500 hover:text-slate-800'
              }`}
              title="List / Tree View"
            >
              <ListTree className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* BOXES VIEW */}
      {viewMode === 'boxes' ? (
        <div className="space-y-3">
          {currentFolders.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2.5">
              {currentFolders.map((folder) => {
                const isSelected = String(selectedId) === String(folder.id);
                const hasChildren = folder.children && folder.children.length > 0;
                const videoCount = folder.total ?? folder.count ?? 0;

                return (
                  <div
                    key={folder.id}
                    onClick={() => handleFolderClick(folder)}
                    className={`group relative p-3 rounded-xl border transition-all duration-150 cursor-pointer flex flex-col justify-between min-h-[96px] text-left select-none ${
                      isSelected
                        ? 'bg-indigo-50/90 border-indigo-500 ring-2 ring-indigo-500/25 shadow-xs'
                        : 'bg-white hover:bg-slate-50/80 border-slate-200/90 hover:border-indigo-400 hover:shadow-xs hover:-translate-y-0.5'
                    }`}
                    title={`${folder.name} (${videoCount} videos)`}
                  >
                    <div className="flex items-start justify-between gap-1.5">
                      <div
                        className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-all ${
                          isSelected
                            ? 'bg-indigo-600 text-white shadow-2xs'
                            : 'bg-amber-500/10 text-amber-600 group-hover:bg-amber-500/20 group-hover:scale-105'
                        }`}
                      >
                        {hasChildren ? <FolderOpen className="w-5 h-5" /> : <Folder className="w-5 h-5" />}
                      </div>

                      {hasChildren && (
                        <span className="text-[10px] text-slate-500 group-hover:text-indigo-600 font-medium flex items-center gap-0.5 shrink-0 bg-slate-100 group-hover:bg-indigo-50 px-1.5 py-0.5 rounded-md transition-colors">
                          {folder.children.length}
                          <ChevronRight className="w-3 h-3" />
                        </span>
                      )}
                    </div>

                    <div className="mt-2.5 min-w-0">
                      <h4
                        className={`text-xs font-semibold truncate ${
                          isSelected ? 'text-indigo-950 font-bold' : 'text-slate-800 group-hover:text-indigo-600'
                        }`}
                      >
                        {folder.name || 'Untitled Folder'}
                      </h4>
                      <div className="flex items-center justify-between text-[11px] text-slate-400 mt-0.5">
                        <span className={isSelected ? 'text-indigo-700 font-medium' : ''}>
                          {videoCount} video{videoCount !== 1 ? 's' : ''}
                        </span>
                        {isSelected && (
                          <span className="text-[10px] text-emerald-600 font-semibold flex items-center gap-0.5 bg-emerald-50 px-1 rounded">
                            <Check className="w-2.5 h-2.5" /> Active
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-4 px-3 rounded-xl border border-dashed border-slate-200 bg-white/60 text-xs text-slate-500 space-y-1">
              <p className="font-medium text-slate-700">No subfolders inside "{currentFolderNode?.name || 'this folder'}"</p>
              <p className="text-[11px] text-slate-400">
                Videos inside this folder are listed below. Use "Back" to navigate to other folders.
              </p>
            </div>
          )}

          {/* Current Folder Active Banner */}
          {currentFolderNode && (
            <div className="flex items-center justify-between bg-white px-3 py-2 rounded-xl border border-slate-200 text-xs text-slate-600">
              <div className="flex items-center gap-2">
                <Folder className="w-4 h-4 text-amber-500" />
                <span>
                  Current Folder: <strong className="text-slate-800">{currentFolderNode.name}</strong> ({currentFolderNode.total ?? currentFolderNode.count ?? 0} videos)
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleJumpToPath(-1)}
                className="text-xs text-indigo-600 hover:text-indigo-700 font-medium"
              >
                Back to all folders &rarr;
              </button>
            </div>
          )}
        </div>
      ) : (
        /* TREE VIEW FALLBACK */
        <div className="rounded-xl border border-slate-200 bg-white p-2.5 max-h-80 overflow-y-auto">
          {tree.map((node) => (
            <FolderTreeNode key={node.id} node={node} depth={0} selectedId={selectedId} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  );
};

// Default export FolderTree as FolderBoxes for full backward compatibility
export const FolderTree = FolderBoxes;
