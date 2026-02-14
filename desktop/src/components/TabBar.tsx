import type { Tab } from '../hooks/useTabs';
import { isChatTab } from '../hooks/useTabs';
import type { SessionState } from '../hooks/useGateway';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { cn } from '@/lib/utils';
import {
  MessageSquare, Radio, LayoutGrid, Zap, Sparkles, Brain, Settings2,
  Plus, X, Loader2,
} from 'lucide-react';

const VIEW_ICONS: Record<string, React.ReactNode> = {
  chat: <MessageSquare className="w-3 h-3" />,
  channels: <Radio className="w-3 h-3" />,
  goals: <LayoutGrid className="w-3 h-3" />,
  automation: <Zap className="w-3 h-3" />,
  skills: <Sparkles className="w-3 h-3" />,
  memory: <Brain className="w-3 h-3" />,
  settings: <Settings2 className="w-3 h-3" />,
};

function getTabIcon(tab: Tab) {
  if (isChatTab(tab)) {
    if (tab.channel === 'whatsapp') return <img src="./whatsapp.png" className="w-3 h-3" alt="W" />;
    if (tab.channel === 'telegram') return <img src="./telegram.png" className="w-3 h-3" alt="T" />;
    return <MessageSquare className="w-3 h-3" />;
  }
  return VIEW_ICONS[tab.type] || <MessageSquare className="w-3 h-3" />;
}

function DraggableTab({
  tab,
  isActive,
  isRunning,
  groupId,
  onFocusTab,
  onCloseTab,
}: {
  tab: Tab;
  isActive: boolean;
  isRunning: boolean;
  groupId?: string;
  onFocusTab: (id: string) => void;
  onCloseTab: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `tab:${tab.id}`,
    data: { tabId: tab.id, sourceGroupId: groupId },
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cn(
        'group relative flex items-center gap-1.5 px-3 h-[34px] text-[11px] font-mono border-r border-border/50 cursor-grab transition-colors select-none',
        'max-w-[180px] min-w-[80px] shrink-0',
        isDragging && 'opacity-30',
        isActive
          ? 'bg-background text-foreground'
          : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground',
      )}
      onClick={() => onFocusTab(tab.id)}
      onMouseDown={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          onCloseTab(tab.id);
        }
      }}
    >
      {isActive && (
        <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary" />
      )}
      <span className="shrink-0 opacity-70">
        {isRunning ? (
          <Loader2 className="w-3 h-3 animate-spin text-primary" />
        ) : (
          getTabIcon(tab)
        )}
      </span>
      <span className="truncate flex-1">{tab.label}</span>
      {tab.closable && (
        <button
          className={cn(
            'shrink-0 rounded p-0.5 transition-all',
            isActive
              ? 'opacity-50 hover:opacity-100 hover:bg-secondary'
              : 'opacity-0 group-hover:opacity-50 hover:!opacity-100 hover:bg-secondary',
          )}
          onClick={e => {
            e.stopPropagation();
            onCloseTab(tab.id);
          }}
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

type TabBarProps = {
  tabs: Tab[];
  activeTabId: string;
  sessionStates: Record<string, SessionState>;
  isActiveGroup?: boolean;
  isMultiPane?: boolean;
  groupId?: string;
  onFocusTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewChat: () => void;
};

export function TabBar({ tabs, activeTabId, sessionStates, isActiveGroup, isMultiPane, groupId, onFocusTab, onCloseTab, onNewChat }: TabBarProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `group-drop:${groupId || 'default'}`,
    data: { groupId },
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex items-center h-[34px] bg-card border-b shrink-0 min-w-0 transition-colors",
        isMultiPane && isActiveGroup ? "border-b-2 border-b-primary" : "border-b-border",
        isOver && "bg-primary/10 border-b-primary",
      )}
    >
      <div className="flex items-center flex-1 min-w-0 overflow-x-auto no-scrollbar">
        {tabs.map(tab => {
          const isActive = tab.id === activeTabId;
          const isRunning = isChatTab(tab) && sessionStates[tab.sessionKey]?.agentStatus !== 'idle' && sessionStates[tab.sessionKey]?.agentStatus != null;

          return (
            <DraggableTab
              key={tab.id}
              tab={tab}
              isActive={isActive}
              isRunning={isRunning}
              groupId={groupId}
              onFocusTab={onFocusTab}
              onCloseTab={onCloseTab}
            />
          );
        })}
      </div>

      <button
        className="shrink-0 flex items-center justify-center w-[34px] h-[34px] text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors border-l border-border/50"
        onClick={onNewChat}
        title="new task"
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// Reusable tab preview for DragOverlay
export function TabDragOverlay({ tab }: { tab: Tab }) {
  return (
    <div className="flex items-center gap-1.5 px-3 h-[34px] text-[11px] font-mono bg-card border border-border rounded shadow-lg select-none max-w-[180px]">
      <span className="shrink-0 opacity-70">{getTabIcon(tab)}</span>
      <span className="truncate flex-1">{tab.label}</span>
    </div>
  );
}
