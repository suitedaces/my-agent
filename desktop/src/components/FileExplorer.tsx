import { useState, useEffect, useCallback } from 'react';
import type React from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { Folder, File, ChevronRight, ChevronDown, FolderPlus, Pencil, Trash2 } from 'lucide-react';

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

  useEffect(() => {
    if (!viewRoot || !connected) return;
    rpc('fs.watch.start', { path: viewRoot }).catch(() => {});
    const unsubscribe = onFileChange?.((changedPath) => {
      if (changedPath === viewRoot) loadDir(viewRoot);
    });
    return () => {
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
      return [<div key="loading" className="text-[11px] text-muted-foreground py-1" style={{ paddingLeft: depth * 16 + 12 }}>...</div>];
    }

    if (state.error) {
      return [<div key="error" className="text-[11px] text-destructive py-1" style={{ paddingLeft: depth * 16 + 12 }}>{state.error}</div>];
    }

    const items: React.JSX.Element[] = [];
    for (const entry of state.entries) {
      const fullPath = parentPath + '/' + entry.name;
      const isDir = entry.type === 'directory';
      const isExpanded2 = expanded.has(fullPath);
      const isDot = entry.name.startsWith('.');

      items.push(
        <div
          key={fullPath}
          className={cn(
            'flex items-center gap-1.5 py-0.5 px-1 rounded-sm text-[11px] cursor-pointer group transition-colors',
            isDot && 'opacity-50',
            selectedPath === fullPath ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'
          )}
          style={{ paddingLeft: depth * 16 + 12 }}
          onClick={isDir ? () => toggleDir(fullPath) : () => handleFileClick(fullPath)}
          onDoubleClick={isDir ? () => navigateTo(fullPath) : undefined}
        >
          {isDir ? (
            isExpanded2 ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />
          ) : (
            <span className="w-3 shrink-0" />
          )}
          {isDir ? <Folder className="w-3 h-3 shrink-0 text-primary" /> : <File className="w-3 h-3 shrink-0" />}
          <span className={cn('flex-1 truncate', isDir && 'font-semibold')}>{entry.name}</span>
          {entry.size != null && <span className="text-[9px] text-muted-foreground shrink-0">{formatSize(entry.size)}</span>}
          <span className="hidden group-hover:flex items-center gap-0.5 shrink-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <button className="p-0.5 hover:text-primary transition-colors" onClick={(e) => renameItem(fullPath, e)}>
                  <Pencil className="w-2.5 h-2.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-[10px]">Rename</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button className="p-0.5 hover:text-destructive transition-colors" onClick={(e) => deleteItem(fullPath, e)}>
                  <Trash2 className="w-2.5 h-2.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-[10px]">Delete</TooltipContent>
            </Tooltip>
          </span>
        </div>
      );

      if (isDir && isExpanded2) {
        items.push(...renderEntries(fullPath, depth + 1));
      }
    }

    return items;
  };

  const crumbs = viewRoot ? buildCrumbs(homeCwd, viewRoot) : [];

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
        <span className="text-xs font-semibold">files</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={createFolder}>
              <FolderPlus className="w-3 h-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-[10px]">New Folder</TooltipContent>
        </Tooltip>
        <div className="flex items-center gap-0.5 text-[10px] text-muted-foreground flex-1 overflow-hidden ml-1">
          {crumbs.map((c, i) => (
            <span key={c.path} className="flex items-center gap-0.5 shrink-0">
              {i > 0 && <span>/</span>}
              <span
                className={cn(
                  'hover:text-foreground transition-colors',
                  i === crumbs.length - 1 ? 'text-foreground font-semibold' : 'cursor-pointer'
                )}
                onClick={i < crumbs.length - 1 ? () => navigateTo(c.path) : undefined}
              >{c.label}</span>
            </span>
          ))}
        </div>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <div className="py-1">
          {viewRoot ? renderEntries(viewRoot, 0) : <div className="text-[11px] text-muted-foreground p-3">loading...</div>}
        </div>
      </ScrollArea>
    </div>
  );
}
