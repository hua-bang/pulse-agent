import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

interface TabIndicatorState {
  left: number;
  width: number;
  visible: boolean;
}

interface Options {
  activeTabId: string | null;
  visible: boolean;
  previewTabs: readonly { id: string }[];
  terminalTabs: readonly { id: string }[];
  chatTabEnabled: boolean;
  dockWidth: number;
}

export const useDockTabIndicator = ({ activeTabId, visible, previewTabs, terminalTabs, chatTabEnabled, dockWidth }: Options) => {
  const tabsRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const [indicator, setIndicator] = useState<TabIndicatorState>({ left: 0, width: 0, visible: false });
  const registerTab = useCallback((id: string, element: HTMLButtonElement | null) => {
    if (element) tabRefs.current.set(id, element);
    else tabRefs.current.delete(id);
  }, []);
  const update = useCallback(() => {
    const activeTab = activeTabId ? tabRefs.current.get(activeTabId) : null;
    const tabScroll = tabsRef.current;
    if (!visible || !activeTab || !tabScroll) {
      setIndicator((current) => current.visible ? { ...current, visible: false } : current);
      return;
    }
    const tabRect = activeTab.getBoundingClientRect();
    const scrollRect = tabScroll.getBoundingClientRect();
    const next = {
      left: tabRect.left - scrollRect.left + tabScroll.scrollLeft,
      width: tabRect.width,
      visible: true,
    };
    setIndicator((current) => (
      current.left === next.left && current.width === next.width && current.visible
        ? current
        : next
    ));
  }, [activeTabId, visible]);
  useLayoutEffect(update, [update, previewTabs, terminalTabs, chatTabEnabled, dockWidth]);
  useEffect(() => {
    if (!visible || !activeTabId) return;
    tabRefs.current.get(activeTabId)?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [activeTabId, visible, previewTabs, terminalTabs]);
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    if (tabsRef.current) observer.observe(tabsRef.current);
    for (const tab of tabRefs.current.values()) observer.observe(tab);
    return () => observer.disconnect();
  }, [update, previewTabs, terminalTabs, chatTabEnabled]);
  return { tabsRef, registerTab, indicator, update };
};
