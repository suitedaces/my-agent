import { useState, useEffect, useCallback } from 'react';
import type React from 'react';

type FileEntry = {
  name: string;
  type: 'file' | 'directory';
  size?: number;
};

type DirState = {
  entries: FileEntry[];
  loading: boolean;
  error?: string;
};

type Props = {
  rpc: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  connected: boolean;
  onFileClick?: (filePath: string) => void;
  onFileChange?: (listener: (path: string) => void) => () => void;
};

function shortenPath(p: string): string {
  const m = p.match(/^\/Users\/[^/]+/);
  if (m && p.startsWith(m[0])) return '~' + p.slice(m[0].length);
  return p;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + 'K';
  return (bytes / (1024 * 1024)).toFixed(1) + 'M';
}

function buildCrumbs(root: string, current: string): { label: string; path: string }[] {
  const short = shortenPath(current);
  const parts = short.split('/').filter(Boolean);
  const crumbs: { label: string; path: string }[] = [];
  // first part is ~ or absolute root
  let abs = short.startsWith('~') ? root.match(/^\/Users\/[^/]+/)?.[0] || '' : '';
  for (const part of parts) {
    if (part === '~') {
      abs = root.match(/^\/Users\/[^/]+/)?.[0] || '';
      crumbs.push({ label: '~', path: abs });
    } else {
      abs = abs + '/' + part;
      crumbs.push({ label: part, path: abs });
    }
  }
  return crumbs;
}

export function FileExplorer({ rpc, connected, onFileClick, onFileChange }: Props) {
  const [homeCwd, setHomeCwd] = useState('');
  const [viewRoot, setViewRoot] = useState('');
  const [dirs, setDirs] = useState<Map<string, DirState>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const loadDir = useCallback(async (path: string) => {
    setDirs(prev => {
      const next = new Map(prev);
      next.set(path, { entries: prev.get(path)?.entries || [], loading: true });
      return next;
    });
    try {
      const entries = await rpc('fs.list', { path }) as FileEntry[];
      setDirs(prev => {
        const next = new Map(prev);
        next.set(path, { entries: entries || [], loading: false });
        return next;
      });
    } catch (err) {
      setDirs(prev => {
        const next = new Map(prev);
        next.set(path, { entries: [], loading: false, error: String(err) });
        return next;
      });
    }
  }, [rpc]);

  useEffect(() => {
    if (!connected) return;
    rpc('config.get').then((res: unknown) => {
      const c = (res as Record<string, unknown>)?.cwd as string;
      if (c) {
        setHomeCwd(c);
        if (!viewRoot) {
          setViewRoot(c);
          loadDir(c);
        }
      }
    }).catch(() => {});
  }, [rpc, loadDir, connected, viewRoot]);

  // watch current viewRoot directory for changes
  useEffect(() => {
    if (!viewRoot || !connected) return;

    // start watching
    rpc('fs.watch.start', { path: viewRoot }).catch(() => {});

    // listen to file change events
    const unsubscribe = onFileChange?.((changedPath) => {
      // refresh if the changed path is the current viewRoot
      if (changedPath === viewRoot) {
        console.log('[file-explorer] reloading due to fs change:', changedPath);
        loadDir(viewRoot);
      }
    });

    return () => {
      // stop watching
      rpc('fs.watch.stop', { path: viewRoot }).catch(() => {});
      unsubscribe?.();
    };
  }, [viewRoot, connected, rpc, loadDir, onFileChange]);

  const navigateTo = useCallback((path: string) => {
    setViewRoot(path);
    setExpanded(new Set());
    if (!dirs.has(path)) loadDir(path);
  }, [dirs, loadDir]);

  const toggleDir = useCallback((path: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
        if (!dirs.has(path)) loadDir(path);
      }
      return next;
    });
  }, [dirs, loadDir]);

  const createFolder = useCallback(async () => {
    const folderName = prompt('Enter folder name:');
    if (!folderName) return;

    const newPath = viewRoot + '/' + folderName;
    try {
      await rpc('fs.mkdir', { path: newPath });
      loadDir(viewRoot);
    } catch (err) {
      alert('Failed to create folder: ' + (err instanceof Error ? err.message : String(err)));
    }
  }, [viewRoot, rpc, loadDir]);

  const deleteItem = useCallback(async (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Delete ${path}?`)) return;

    try {
      await rpc('fs.delete', { path });
      const parentPath = path.substring(0, path.lastIndexOf('/'));
      loadDir(parentPath);
      if (selectedPath === path) setSelectedPath(null);
    } catch (err) {
      alert('Failed to delete: ' + (err instanceof Error ? err.message : String(err)));
    }
  }, [rpc, loadDir, selectedPath]);

  const renameItem = useCallback(async (oldPath: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const oldName = oldPath.substring(oldPath.lastIndexOf('/') + 1);
    const newName = prompt('Enter new name:', oldName);
    if (!newName || newName === oldName) return;

    const parentPath = oldPath.substring(0, oldPath.lastIndexOf('/'));
    const newPath = parentPath + '/' + newName;

    try {
      await rpc('fs.rename', { oldPath, newPath });
      loadDir(parentPath);
      if (selectedPath === oldPath) setSelectedPath(newPath);
    } catch (err) {
      alert('Failed to rename: ' + (err instanceof Error ? err.message : String(err)));
    }
  }, [rpc, loadDir, selectedPath]);

  const handleFileClick = useCallback((path: string) => {
    setSelectedPath(path);
    onFileClick?.(path);
  }, [onFileClick]);

  const renderEntries = (parentPath: string, depth: number): React.JSX.Element[] => {
    const state = dirs.get(parentPath);
    if (!state) return [];

    if (state.loading && state.entries.length === 0) {
      return [<div key="loading" className="fe-entry" style={{ paddingLeft: depth * 16 + 12 }}>...</div>];
    }

    if (state.error) {
      return [<div key="error" className="fe-entry fe-error" style={{ paddingLeft: depth * 16 + 12 }}>{state.error}</div>];
    }

    const items: React.JSX.Element[] = [];
    for (const entry of state.entries) {
      const fullPath = parentPath + '/' + entry.name;
      const isDir = entry.type === 'directory';
      const isExpanded = expanded.has(fullPath);
      const isDot = entry.name.startsWith('.');

      items.push(
        <div
          key={fullPath}
          className={`fe-entry${isDot ? ' fe-dimmed' : ''}${selectedPath === fullPath ? ' fe-selected' : ''}`}
          style={{ paddingLeft: depth * 16 + 12 }}
          onClick={isDir ? () => toggleDir(fullPath) : () => handleFileClick(fullPath)}
          onDoubleClick={isDir ? () => navigateTo(fullPath) : undefined}
        >
          <span className="fe-icon">{isDir ? (isExpanded ? 'v' : '>') : ' '}</span>
          <span className={isDir ? 'fe-dir-name' : 'fe-file-name'}>{entry.name}</span>
          {entry.size != null && <span className="fe-size">{formatSize(entry.size)}</span>}
          <span className="fe-actions">
            <button className="fe-action-btn" onClick={(e) => renameItem(fullPath, e)} title="Rename">✎</button>
            <button className="fe-action-btn" onClick={(e) => deleteItem(fullPath, e)} title="Delete">×</button>
          </span>
        </div>
      );

      if (isDir && isExpanded) {
        items.push(...renderEntries(fullPath, depth + 1));
      }
    }

    return items;
  };

  const crumbs = viewRoot ? buildCrumbs(homeCwd, viewRoot) : [];

  return (
    <div className="file-explorer-panel">
      <div className="fe-header">
        <span>files</span>
        <button className="fe-new-folder-btn" onClick={createFolder} title="New Folder">+</button>
        <div className="fe-breadcrumbs">
          {crumbs.map((c, i) => (
            <span key={c.path}>
              {i > 0 && <span className="fe-crumb-sep">/</span>}
              <span
                className={`fe-crumb${i === crumbs.length - 1 ? ' fe-crumb-active' : ''}`}
                onClick={i < crumbs.length - 1 ? () => navigateTo(c.path) : undefined}
              >{c.label}</span>
            </span>
          ))}
        </div>
      </div>
      <div className="fe-body">
        {viewRoot ? renderEntries(viewRoot, 0) : <div className="fe-entry">loading...</div>}
      </div>
    </div>
  );
}
