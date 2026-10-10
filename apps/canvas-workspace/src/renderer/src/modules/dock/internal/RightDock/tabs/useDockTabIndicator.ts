import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

interface TabIndicatorState {
  left: number;
  width: number;
  visible: boolean;
}

interface Options {
  /** Owner of the visible tab set; a change is a swap, not a tab move. */
  scopeId: string;
  activeTabId: string | null;
  visible: boolean;
  previewTabs: readonly { id: string }[];
  terminalTabs: readonly { id: string }[];
  chatTabEnabled: boolean;
  dockWidth: number;
}

export const useDockTabIndicator = ({ scopeId, activeTabId, visible, previewTabs, terminalTabs, chatTabEnabled, dockWidth }: Options) => {
  const tabsRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  // Track the last tab we scrolled into view so closing a non-active tab
  // (which changes previewTabs but not activeTabId) doesn't re-trigger the
  // smooth scroll and produce the "tabs slide to the active one" jitter.
  const lastScrolledTabId = useRef<string | null>(null);
  const [indicator, setIndicator] = useState<TabIndicatorState>({ left: 0, width: 0, visible: false });
  // A workspace switch replaces the whole strip. Smooth-scrolling from the
  // old workspace's position reads as tabs jumping around, so a new scope
  // lands in place; the glider transition is off via `right-dock-switching`.
  const scopeRef = useRef(scopeId);
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
  useLayoutEffect(() => {
    if (scopeRef.current === scopeId) return;
    scopeRef.current = scopeId;
    // The strip has CSS `scroll-behavior: smooth`, so both calls must say
    // `instant` explicitly.
    tabsRef.current?.scrollTo({ left: 0, behavior: 'instant' });
    const activeTab = activeTabId ? tabRefs.current.get(activeTabId) : null;
    if (visible && activeTab) {
      activeTab.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
      lastScrolledTabId.current = activeTabId;
    } else {
      lastScrolledTabId.current = null;
    }
  }, [scopeId, activeTabId, visible]);
  useLayoutEffect(update, [update, previewTabs, terminalTabs, chatTabEnabled, dockWidth]);
  useEffect(() => {
    if (!visible || !activeTabId) return;
    // Only scroll when the active tab actually changes - not when the tab
    // list reshuffles (e.g. a non-active tab closes). Closing a non-active
    // tab changes previewTabs but cannot push the active tab out of view,
    // so re-scrolling only adds the unwanted smooth slide.
    if (lastScrolledTabId.current === activeTabId) return;
    lastScrolledTabId.current = activeTabId;
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
