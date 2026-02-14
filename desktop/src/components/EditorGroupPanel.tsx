import type { EditorGroup, GroupId } from '../hooks/useLayout';
import type { Tab } from '../hooks/useTabs';
import { isChatTab } from '../hooks/useTabs';
import type { useGateway } from '../hooks/useGateway';
import type { useTabs } from '../hooks/useTabs';
import { useDroppable } from '@dnd-kit/core';
import { TabBar } from './TabBar';
import { ChatView } from '../views/Chat';
import { ChannelView } from '../views/Channel';
import { Automations } from './Automations';
import { SettingsView } from '../views/Settings';
import { SoulView } from '../views/Soul';
import { SkillsView } from '../views/Skills';
import { GoalsView } from '../views/Goals';
import { FileViewer } from './FileViewer';
import { cn } from '@/lib/utils';

// VS Code-style drop zone inside a panel — shows quadrant highlights when dragging
function PanelDropZone({ groupId, zone }: { groupId: string; zone: 'left' | 'right' | 'top' | 'bottom' | 'center' }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `panel-split:${groupId}:${zone}`,
    data: { panelGroupId: groupId, splitZone: zone },
  });

  const posStyles: Record<string, string> = {
    left: 'left-0 top-0 bottom-0 w-1/4',
    right: 'right-0 top-0 bottom-0 w-1/4',
    top: 'top-0 left-1/4 right-1/4 h-1/4',
    bottom: 'bottom-0 left-1/4 right-1/4 h-1/4',
    center: 'top-1/4 bottom-1/4 left-1/4 right-1/4',
  };

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'absolute z-40 transition-all pointer-events-auto rounded-sm',
        posStyles[zone],
        isOver ? 'bg-primary/20 border-2 border-primary/40' : 'bg-transparent',
      )}
    />
  );
}

type Props = {
  group: EditorGroup;
  tabs: Tab[];
  isActive: boolean;
  isMultiPane: boolean;
  isDragging: boolean;
  gateway: ReturnType<typeof useGateway>;
  tabState: ReturnType<typeof useTabs>;
  selectedFile: string | null;
  selectedChannel: 'whatsapp' | 'telegram';
  onFocusGroup: () => void;
  onNavigateSettings: () => void;
  onViewSession: (sessionId: string, channel?: string, chatId?: string, chatType?: string) => void;
  onSwitchChannel: (ch: 'whatsapp' | 'telegram') => void;
  onClearSelectedFile: () => void;
  onSetupChat: (prompt: string) => void;
  onNavClick: (navId: string) => void;
};

export function EditorGroupPanel({
  group,
  tabs,
  isActive,
  isMultiPane,
  isDragging,
  gateway,
  tabState,
  selectedFile,
  selectedChannel,
  onFocusGroup,
  onNavigateSettings,
  onViewSession,
  onSwitchChannel,
  onClearSelectedFile,
  onSetupChat,
  onNavClick,
}: Props) {
  const groupTabs = group.tabIds
    .map(id => tabs.find(t => t.id === id))
    .filter(Boolean) as Tab[];

  const activeTab = groupTabs.find(t => t.id === group.activeTabId) || groupTabs[0];

  const renderContent = () => {
    // File viewer takes precedence if this is the active group
    if (isActive && selectedFile) {
      return <FileViewer filePath={selectedFile} rpc={gateway.rpc} onClose={onClearSelectedFile} />;
    }

    if (!activeTab) return null;

    switch (activeTab.type) {
      case 'chat': {
        const ss = gateway.sessionStates[activeTab.sessionKey] || {
          chatItems: [],
          agentStatus: 'idle',
          pendingQuestion: null,
        };
        return (
          <ChatView
            gateway={gateway}
            chatItems={ss.chatItems}
            agentStatus={ss.agentStatus}
            pendingQuestion={ss.pendingQuestion}
            sessionKey={activeTab.sessionKey}
            onNavigateSettings={onNavigateSettings}
          />
        );
      }
      case 'channels':
        return (
          <ChannelView
            channel={selectedChannel}
            gateway={gateway}
            onViewSession={onViewSession}
            onSwitchChannel={onSwitchChannel}
          />
        );
      case 'goals':
        return <GoalsView gateway={gateway} />;
      case 'automation':
        return <Automations gateway={gateway} />;
      case 'skills':
        return <SkillsView gateway={gateway} />;
      case 'memory':
        return (
          <SoulView
            gateway={gateway}
            onSetupChat={onSetupChat}
          />
        );
      case 'settings':
        return <SettingsView gateway={gateway} />;
      default:
        return null;
    }
  };

  return (
    <div
      data-group-id={group.id}
      className={cn(
        'flex flex-col h-full min-h-0 min-w-0 transition-all duration-150',
        isMultiPane && (isActive
          ? 'ring-2 ring-primary/50 ring-inset'
          : 'opacity-75 hover:opacity-90'),
      )}
      onClick={onFocusGroup}
    >
      <TabBar
        tabs={groupTabs}
        activeTabId={group.activeTabId || ''}
        sessionStates={gateway.sessionStates}
        isActiveGroup={isActive}
        isMultiPane={isMultiPane}
        groupId={group.id}
        onFocusTab={(id) => {
          onFocusGroup();
          tabState.focusTab(id, group.id);
        }}
        onCloseTab={tabState.closeTab}
        onNewChat={() => {
          onFocusGroup();
          tabState.newChatTab(group.id);
        }}
      />
      <div className="@container flex-1 min-h-0 min-w-0 relative">
        {renderContent()}
        {isDragging && (
          <>
            <PanelDropZone groupId={group.id} zone="left" />
            <PanelDropZone groupId={group.id} zone="right" />
            <PanelDropZone groupId={group.id} zone="top" />
            <PanelDropZone groupId={group.id} zone="bottom" />
            <PanelDropZone groupId={group.id} zone="center" />
          </>
        )}
      </div>
    </div>
  );
}
