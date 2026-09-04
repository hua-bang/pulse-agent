import { useLayoutEffect, type RefObject } from 'react';
import { mcpAppDockHostElementId } from '../../../../shared/dock/dock-tab-ids';
type McpAppDisplayMode = 'inline' | 'fullscreen';
interface Options {
  displayMode: McpAppDisplayMode;
  dockHost: HTMLElement | null;
  dockTabVisible: boolean;
  height: number;
  inlineHostRef: RefObject<HTMLDivElement>;
  instanceId: string;
  resourceKey: unknown;
  surfaceRef: RefObject<HTMLDivElement>;
}
export const useMcpAppSurfacePlacement = ({
  displayMode,
  dockHost,
  dockTabVisible,
  height,
  inlineHostRef,
  instanceId,
  resourceKey,
  surfaceRef,
}: Options) => {
  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    surface.dataset.displayMode = displayMode;
    const resolveTarget = (): HTMLElement | null => displayMode === 'fullscreen'
      ? document.getElementById(mcpAppDockHostElementId(instanceId)) ?? dockHost
      : inlineHostRef.current;
    const transitionRoot = displayMode === 'fullscreen'
      ? document.querySelector('.right-dock')
      : resolveTarget()?.closest('.right-dock') ?? null;
    const transitionStyle = transitionRoot ? getComputedStyle(transitionRoot) : null;
    const cssTimeMs = (value: string): number => {
      const numeric = Number.parseFloat(value);
      if (!Number.isFinite(numeric)) return 0;
      return value.trim().endsWith('ms') ? numeric : numeric * 1_000;
    };
    const transitionDurations = transitionStyle?.transitionDuration.split(',').map(cssTimeMs) ?? [];
    const transitionDelays = transitionStyle?.transitionDelay.split(',').map(cssTimeMs) ?? [];
    const transitionWindowMs = transitionDurations.reduce((longest, duration, index) => (
      Math.max(longest, duration + (transitionDelays[index % Math.max(transitionDelays.length, 1)] ?? 0))
    ), 0);
    let targetVisible = false;
    let observer: ResizeObserver | null = null;
    let observedTarget: HTMLElement | null = null;
    const syncObservedTarget = (target: HTMLElement | null) => {
      if (!observer || observedTarget === target) return;
      observer.disconnect();
      observedTarget = target;
      if (target) observer.observe(target);
    };
    const placeOverTarget = () => {
      const target = resolveTarget();
      syncObservedTarget(target);
      if (!target || (displayMode === 'fullscreen' && !dockTabVisible)) {
        surface.style.visibility = 'hidden';
        surface.style.pointerEvents = 'none';
        targetVisible = false;
        return 'missing';
      }
      const rect = target.getBoundingClientRect();
      const hasLayout = rect.width > 0 || rect.height > 0;
      const visible = !hasLayout || (
        rect.bottom > 0
        && rect.right > 0
        && rect.top < window.innerHeight
        && rect.left < window.innerWidth
      );
      Object.assign(surface.style, {
        position: 'fixed',
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        visibility: visible ? 'visible' : 'hidden',
        pointerEvents: visible ? 'auto' : 'none',
      });
      targetVisible = visible;
      return `${rect.left}:${rect.top}:${rect.width}:${rect.height}`;
    };
    placeOverTarget();
    let animationFrame: number | undefined;
    let lastPlacement = '';
    let stableFrames = 0;
    let trackingDeadline = 0;
    let visibilityDeadline = 0;
    const followMovingTarget = () => {
      const placement = placeOverTarget();
      stableFrames = placement === lastPlacement ? stableFrames + 1 : 0;
      lastPlacement = placement;
      const now = performance.now();
      const awaitingFullscreenHost = displayMode === 'fullscreen'
        && dockTabVisible
        && !targetVisible
        && now < visibilityDeadline;
      if (awaitingFullscreenHost || now < trackingDeadline || stableFrames < 3) {
        animationFrame = requestAnimationFrame(followMovingTarget);
      } else {
        animationFrame = undefined;
      }
    };
    const restartTargetTracking = () => {
      stableFrames = 0;
      lastPlacement = '';
      trackingDeadline = Math.max(trackingDeadline, performance.now() + transitionWindowMs + 50);
      visibilityDeadline = Math.max(visibilityDeadline, performance.now() + 2_000);
      if (animationFrame === undefined) {
        animationFrame = requestAnimationFrame(followMovingTarget);
      }
    };
    const finishTargetTransition = () => {
      placeOverTarget();
      restartTargetTracking();
    };
    restartTargetTracking();
    observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(finishTargetTransition);
    syncObservedTarget(resolveTarget());
    transitionRoot?.addEventListener('transitionrun', restartTargetTracking);
    transitionRoot?.addEventListener('transitionend', finishTargetTransition);
    transitionRoot?.addEventListener('transitioncancel', finishTargetTransition);
    window.addEventListener('resize', finishTargetTransition);
    document.addEventListener('scroll', placeOverTarget, true);
    return () => {
      if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
      observer?.disconnect();
      transitionRoot?.removeEventListener('transitionrun', restartTargetTracking);
      transitionRoot?.removeEventListener('transitionend', finishTargetTransition);
      transitionRoot?.removeEventListener('transitioncancel', finishTargetTransition);
      window.removeEventListener('resize', finishTargetTransition);
      document.removeEventListener('scroll', placeOverTarget, true);
    };
  }, [displayMode, dockHost, dockTabVisible, height, inlineHostRef, instanceId, resourceKey, surfaceRef]);
};
