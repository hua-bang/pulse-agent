import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type {
  BrowserLoadError,
  BrowserLoadState,
  EmbeddedWebviewTag,
} from './types';

interface Options {
  className: string;
  enabled?: boolean;
  hostRef?: RefObject<HTMLDivElement>;
  mountKey?: string | number;
  onFaviconChange?: (favicons: string[]) => void;
  onNavigate?: (url: string) => void;
  onTitleChange?: (title: string) => void;
  url: string;
}

interface Result {
  canGoBack: boolean;
  canGoForward: boolean;
  currentUrl: string;
  goBack: () => void;
  goForward: () => void;
  hostRef: React.RefObject<HTMLDivElement>;
  loadError: BrowserLoadError | null;
  loadState: BrowserLoadState;
  reload: () => void;
  webview: EmbeddedWebviewTag | null;
}

export const useEmbeddedBrowser = ({
  className,
  enabled = true,
  hostRef: providedHostRef,
  mountKey = 0,
  onFaviconChange,
  onNavigate,
  onTitleChange,
  url,
}: Options): Result => {
  const internalHostRef = useRef<HTMLDivElement>(null);
  const hostRef = providedHostRef ?? internalHostRef;
  const [webview, setWebview] = useState<EmbeddedWebviewTag | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [currentUrl, setCurrentUrl] = useState(url);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [loadState, setLoadState] = useState<BrowserLoadState>(url ? 'loading' : 'idle');
  const [loadError, setLoadError] = useState<BrowserLoadError | null>(null);
  const callbacksRef = useRef({ onFaviconChange, onNavigate, onTitleChange });
  callbacksRef.current = { onFaviconChange, onNavigate, onTitleChange };
  const urlRef = useRef(url);
  urlRef.current = url;

  useLayoutEffect(() => {
    if (!enabled) {
      setWebview(null);
      setLoadState('idle');
      setLoadError(null);
      return;
    }
    const host = hostRef.current;
    if (!host) return;

    const element = document.createElement('webview') as EmbeddedWebviewTag;
    element.setAttribute('allowpopups', '');
    if (urlRef.current) element.setAttribute('src', urlRef.current);
    element.className = className;
    host.appendChild(element);
    setWebview(element);
    setCurrentUrl(urlRef.current);
    setCanGoBack(false);
    setCanGoForward(false);
    setLoadState(urlRef.current ? 'loading' : 'idle');
    setLoadError(null);

    const syncNavigation = () => {
      setCanGoBack(element.canGoBack());
      setCanGoForward(element.canGoForward());
    };
    const handleNavigate = (event: Event) => {
      const detail = event as Event & { isMainFrame?: boolean; url?: string };
      if (detail.isMainFrame === false) return;
      if (detail.url) {
        setCurrentUrl(detail.url);
        callbacksRef.current.onNavigate?.(detail.url);
      }
      syncNavigation();
    };
    const handleTitle = (event: Event) => {
      const title = (event as Event & { title?: string }).title;
      if (title) callbacksRef.current.onTitleChange?.(title);
    };
    const handleFavicon = (event: Event) => {
      callbacksRef.current.onFaviconChange?.(
        (event as Event & { favicons?: string[] }).favicons ?? [],
      );
    };
    const handleStart = () => {
      setLoadState('loading');
      setLoadError(null);
    };
    const handleStop = () => {
      setLoadState((state) => state === 'failed' ? state : 'ready');
      const title = element.getTitle?.().trim();
      if (title) callbacksRef.current.onTitleChange?.(title);
      syncNavigation();
    };
    const handleFail = (event: Event) => {
      const detail = event as Event & {
        errorCode?: number;
        errorDescription?: string;
        isMainFrame?: boolean;
      };
      if (detail.isMainFrame === false || detail.errorCode === -3) return;
      setLoadState('failed');
      setLoadError({ code: detail.errorCode, description: detail.errorDescription });
    };

    element.addEventListener('did-navigate', handleNavigate);
    element.addEventListener('did-navigate-in-page', handleNavigate);
    element.addEventListener('page-title-updated', handleTitle);
    element.addEventListener('page-favicon-updated', handleFavicon);
    element.addEventListener('did-start-loading', handleStart);
    element.addEventListener('did-stop-loading', handleStop);
    element.addEventListener('did-fail-load', handleFail);

    return () => {
      element.removeEventListener('did-navigate', handleNavigate);
      element.removeEventListener('did-navigate-in-page', handleNavigate);
      element.removeEventListener('page-title-updated', handleTitle);
      element.removeEventListener('page-favicon-updated', handleFavicon);
      element.removeEventListener('did-start-loading', handleStart);
      element.removeEventListener('did-stop-loading', handleStop);
      element.removeEventListener('did-fail-load', handleFail);
      element.remove();
      setWebview((current) => current === element ? null : current);
    };
  }, [className, enabled, mountKey, reloadKey]);

  useLayoutEffect(() => {
    if (!webview) return;
    // A did-navigate event already moved this live guest. When the parent
    // mirrors that URL into persisted tab state, do not assign src again and
    // accidentally reload the page we just reached.
    if (url === currentUrl) return;
    if (webview.getAttribute('src') !== url) webview.setAttribute('src', url);
    setCurrentUrl(url);
    setLoadState(url ? 'loading' : 'idle');
    setLoadError(null);
  }, [currentUrl, url, webview]);

  const goBack = useCallback(() => {
    if (webview?.canGoBack()) webview.goBack();
  }, [webview]);
  const goForward = useCallback(() => {
    if (webview?.canGoForward()) webview.goForward();
  }, [webview]);
  const reload = useCallback(() => {
    if (!webview) return;
    setLoadState(url ? 'loading' : 'idle');
    setLoadError(null);
    try {
      webview.reload();
    } catch {
      setReloadKey((key) => key + 1);
    }
  }, [url, webview]);

  return {
    canGoBack,
    canGoForward,
    currentUrl,
    goBack,
    goForward,
    hostRef,
    loadError,
    loadState,
    reload,
    webview,
  };
};
