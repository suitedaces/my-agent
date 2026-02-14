import { useState, useCallback, useMemo, useEffect } from 'react';

export type LayoutMode = 'single' | '2-col' | '2-row' | '2x2';
export type GroupId = 'g0' | 'g1' | 'g2' | 'g3';

export type EditorGroup = {
  id: GroupId;
  tabIds: string[];
  activeTabId: string | null;
};

export type LayoutState = {
  mode: LayoutMode;
  groups: EditorGroup[];
  activeGroupId: GroupId;
};

const ALL_GROUP_IDS: GroupId[] = ['g0', 'g1', 'g2', 'g3'];
const LAYOUT_STORAGE_KEY = 'dorabot:layout';

function makeEmptyGroups(): EditorGroup[] {
  return ALL_GROUP_IDS.map(id => ({ id, tabIds: [], activeTabId: null }));
}

function loadFromStorage(): LayoutState | null {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LayoutState;
    if (!parsed.mode || !Array.isArray(parsed.groups)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function defaultLayout(): LayoutState {
  return {
    mode: 'single',
    groups: makeEmptyGroups(),
    activeGroupId: 'g0',
  };
}

export function useLayout() {
  const [state, setState] = useState<LayoutState>(() => {
    return loadFromStorage() || defaultLayout();
  });

  // Persist
  useEffect(() => {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const visibleGroups = useMemo(() => {
    switch (state.mode) {
      case 'single': return [state.groups[0]];
      case '2-col': return [state.groups[0], state.groups[1]];
      case '2-row': return [state.groups[0], state.groups[1]];
      case '2x2': return state.groups.slice(0, 4);
    }
  }, [state.mode, state.groups]);

  const isMultiPane = state.mode !== 'single';

  const updateGroup = useCallback((groupId: GroupId, patch: Partial<EditorGroup>) => {
    setState(prev => ({
      ...prev,
      groups: prev.groups.map(g => g.id === groupId ? { ...g, ...patch } : g),
    }));
  }, []);

  const focusGroup = useCallback((groupId: GroupId) => {
    setState(prev => prev.activeGroupId === groupId ? prev : { ...prev, activeGroupId: groupId });
  }, []);

  const splitHorizontal = useCallback(() => {
    setState(prev => {
      if (prev.mode === 'single') return { ...prev, mode: '2-col' as LayoutMode };
      if (prev.mode === '2x2') return prev;
      return { ...prev, mode: '2x2' as LayoutMode }; // 2-col or 2-row → 2x2
    });
  }, []);

  const splitVertical = useCallback(() => {
    setState(prev => {
      if (prev.mode === 'single') return { ...prev, mode: '2-row' as LayoutMode };
      if (prev.mode === '2x2') return prev;
      return { ...prev, mode: '2x2' as LayoutMode }; // 2-col or 2-row → 2x2
    });
  }, []);

  const splitGrid = useCallback(() => {
    setState(prev => {
      if (prev.mode === '2x2') return prev;
      return { ...prev, mode: '2x2' };
    });
  }, []);

  const resetToSingle = useCallback(() => {
    setState(prev => {
      if (prev.mode === 'single') return prev;
      // Merge all tabs into g0
      const allTabIds: string[] = [];
      const seen = new Set<string>();
      for (const g of prev.groups) {
        for (const tid of g.tabIds) {
          if (!seen.has(tid)) {
            seen.add(tid);
            allTabIds.push(tid);
          }
        }
      }
      const activeGroup = prev.groups.find(g => g.id === prev.activeGroupId);
      const activeTabId = activeGroup?.activeTabId || allTabIds[0] || null;
      const groups = makeEmptyGroups();
      groups[0].tabIds = allTabIds;
      groups[0].activeTabId = activeTabId;
      return { mode: 'single', groups, activeGroupId: 'g0' };
    });
  }, []);

  const moveTabToGroup = useCallback((tabId: string, fromGroupId: GroupId, toGroupId: GroupId) => {
    if (fromGroupId === toGroupId) return;
    setState(prev => {
      const groups = prev.groups.map(g => ({ ...g, tabIds: [...g.tabIds] }));
      const from = groups.find(g => g.id === fromGroupId)!;
      const to = groups.find(g => g.id === toGroupId)!;

      const idx = from.tabIds.indexOf(tabId);
      if (idx < 0) return prev;

      from.tabIds.splice(idx, 1);
      to.tabIds.push(tabId);

      // Update activeTabId if we moved the active tab
      if (from.activeTabId === tabId) {
        from.activeTabId = from.tabIds[Math.min(idx, from.tabIds.length - 1)] || null;
      }
      to.activeTabId = tabId;

      return { ...prev, groups, activeGroupId: toGroupId };
    });
  }, []);

  // Add a tab to a group (called by useTabs)
  const addTabToGroup = useCallback((tabId: string, groupId?: GroupId) => {
    setState(prev => {
      const targetId = groupId || prev.activeGroupId;
      const groups = prev.groups.map(g => {
        if (g.id !== targetId) return g;
        if (g.tabIds.includes(tabId)) return { ...g, activeTabId: tabId };
        return { ...g, tabIds: [...g.tabIds, tabId], activeTabId: tabId };
      });
      return { ...prev, groups };
    });
  }, []);

  // Remove a tab from whichever group owns it
  const removeTabFromGroup = useCallback((tabId: string): { groupId: GroupId; wasActive: boolean; neighborTabId: string | null } => {
    // Compute result from current state BEFORE queuing the update
    // (setState updaters may not run synchronously in React 18)
    const group = state.groups.find(g => g.tabIds.includes(tabId));
    if (!group) return { groupId: 'g0' as GroupId, wasActive: false, neighborTabId: null };

    const idx = group.tabIds.indexOf(tabId);
    const wasActive = group.activeTabId === tabId;
    const newTabIds = group.tabIds.filter(id => id !== tabId);
    const neighborIdx = Math.min(idx, newTabIds.length - 1);
    const neighborTabId = newTabIds[neighborIdx] || null;

    setState(prev => ({
      ...prev,
      groups: prev.groups.map(g => {
        if (!g.tabIds.includes(tabId)) return g;
        const filtered = g.tabIds.filter(id => id !== tabId);
        return {
          ...g,
          tabIds: filtered,
          activeTabId: g.activeTabId === tabId
            ? (filtered[Math.min(g.tabIds.indexOf(tabId), filtered.length - 1)] || null)
            : g.activeTabId,
        };
      }),
    }));

    return { groupId: group.id, wasActive, neighborTabId };
  }, [state.groups]);

  // Set a group's active tab
  const setGroupActiveTab = useCallback((groupId: GroupId, tabId: string) => {
    setState(prev => ({
      ...prev,
      groups: prev.groups.map(g =>
        g.id === groupId ? { ...g, activeTabId: tabId } : g
      ),
    }));
  }, []);

  // Find which group owns a tab
  const findGroupForTab = useCallback((tabId: string): GroupId | null => {
    for (const g of state.groups) {
      if (g.tabIds.includes(tabId)) return g.id;
    }
    return null;
  }, [state.groups]);

  // Collapse an empty group — downgrade layout mode
  const collapseGroup = useCallback((emptyGroupId: GroupId) => {
    setState(prev => {
      if (prev.mode === 'single') return prev;

      if (prev.mode === '2-col' || prev.mode === '2-row') {
        // Two groups → single: keep the non-empty group's tabs in g0
        const survivorIdx = prev.groups[0].id === emptyGroupId ? 1 : 0;
        const survivor = prev.groups[survivorIdx];
        const groups = makeEmptyGroups();
        groups[0].tabIds = [...survivor.tabIds];
        groups[0].activeTabId = survivor.activeTabId;
        return { mode: 'single' as LayoutMode, groups, activeGroupId: 'g0' };
      }

      // 2x2 → 2-col or 2-row: merge the empty group's column/row partner
      // Grid: g0=top-left, g1=top-right, g2=bottom-left, g3=bottom-right
      const emptyIdx = ALL_GROUP_IDS.indexOf(emptyGroupId);
      const groups = makeEmptyGroups();

      // Collect all tabs from non-empty groups
      const remaining = prev.groups.filter(g => g.id !== emptyGroupId && g.tabIds.length > 0);

      if (remaining.length <= 1) {
        // Only 0-1 groups have tabs — go to single
        const survivor = remaining[0];
        if (survivor) {
          groups[0].tabIds = [...survivor.tabIds];
          groups[0].activeTabId = survivor.activeTabId;
        }
        return { mode: 'single' as LayoutMode, groups, activeGroupId: 'g0' };
      }

      // 2 or 3 remaining groups — go to 2-col, putting left-column groups in g0, right in g1
      // (or top/bottom for 2-row based on which group was removed)
      const isRowCollapse = emptyIdx === 0 || emptyIdx === 1; // top row lost a member
      const newMode: LayoutMode = isRowCollapse ? '2-row' : '2-col';

      // Just put first remaining group in g0, second in g1, extras merge into g1
      groups[0].tabIds = [...remaining[0].tabIds];
      groups[0].activeTabId = remaining[0].activeTabId;
      const mergedIds: string[] = [];
      let mergedActive: string | null = null;
      for (let i = 1; i < remaining.length; i++) {
        mergedIds.push(...remaining[i].tabIds);
        if (!mergedActive) mergedActive = remaining[i].activeTabId;
      }
      groups[1].tabIds = mergedIds;
      groups[1].activeTabId = mergedActive;

      // Map activeGroupId to the destination group that received its tabs
      let finalActiveGroup: GroupId = 'g0';
      if (prev.activeGroupId !== emptyGroupId) {
        const activeRemIdx = remaining.findIndex(g => g.id === prev.activeGroupId);
        // remaining[0] → g0, remaining[1+] → merged into g1
        if (activeRemIdx > 0) finalActiveGroup = 'g1';
      }

      return { mode: newMode, groups, activeGroupId: finalActiveGroup };
    });
  }, []);

  // Navigate focus between groups
  const focusGroupDirection = useCallback((direction: 'left' | 'right' | 'up' | 'down') => {
    setState(prev => {
      const currentIdx = ALL_GROUP_IDS.indexOf(prev.activeGroupId);
      let nextIdx: number;

      if (prev.mode === '2-col') {
        if (direction === 'left') nextIdx = 0;
        else if (direction === 'right') nextIdx = 1;
        else return prev;
      } else if (prev.mode === '2-row') {
        if (direction === 'up') nextIdx = 0;
        else if (direction === 'down') nextIdx = 1;
        else return prev;
      } else if (prev.mode === '2x2') {
        // Grid: g0=top-left, g1=top-right, g2=bottom-left, g3=bottom-right
        const grid: Record<number, Record<string, number>> = {
          0: { right: 1, down: 2 },
          1: { left: 0, down: 3 },
          2: { right: 3, up: 0 },
          3: { left: 2, up: 1 },
        };
        nextIdx = grid[currentIdx]?.[direction] ?? currentIdx;
      } else {
        return prev;
      }

      const nextGroupId = ALL_GROUP_IDS[nextIdx];
      if (!nextGroupId || nextGroupId === prev.activeGroupId) return prev;
      return { ...prev, activeGroupId: nextGroupId };
    });
  }, []);

  return {
    mode: state.mode,
    groups: state.groups,
    activeGroupId: state.activeGroupId,
    visibleGroups,
    isMultiPane,
    focusGroup,
    splitHorizontal,
    splitVertical,
    splitGrid,
    resetToSingle,
    moveTabToGroup,
    addTabToGroup,
    removeTabFromGroup,
    setGroupActiveTab,
    findGroupForTab,
    focusGroupDirection,
    collapseGroup,
    updateGroup,
  };
}
