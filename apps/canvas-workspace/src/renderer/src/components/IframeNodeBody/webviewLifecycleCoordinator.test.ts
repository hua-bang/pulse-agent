import { describe, expect, it, vi } from 'vitest';
import { WebviewLifecycleCoordinator } from './webviewLifecycleCoordinator';

const registerLiveOffscreen = (
  coordinator: WebviewLifecycleCoordinator,
  id: string,
  options: {
    canDiscard?: () => boolean | Promise<boolean>;
    onDiscard?: () => void;
    onWake?: (restoring: boolean) => void;
  } = {},
) => {
  const handle = coordinator.register({
    id,
    nodeId: id,
    canDiscard: options.canDiscard ?? (() => true),
    onDiscard: options.onDiscard ?? vi.fn(),
    onWake: options.onWake ?? vi.fn(),
  });
  handle.wake();
  handle.setVisibility({ near: false, active: false });
  return handle;
};

describe('WebviewLifecycleCoordinator', () => {
  it('discards the oldest offscreen guests until the live cap is met', async () => {
    let now = 1_000;
    const discarded: string[] = [];
    const coordinator = new WebviewLifecycleCoordinator(
      { liveCap: 2, offscreenGraceMs: 100 },
      () => now,
    );

    registerLiveOffscreen(coordinator, 'oldest', {
      onDiscard: () => discarded.push('oldest'),
    });
    now += 1;
    registerLiveOffscreen(coordinator, 'middle', {
      onDiscard: () => discarded.push('middle'),
    });
    now += 1;
    registerLiveOffscreen(coordinator, 'newest', {
      onDiscard: () => discarded.push('newest'),
    });

    await coordinator.reconcile({ ignoreGrace: true });

    expect(discarded).toEqual(['oldest']);
    expect(coordinator.snapshot()).toMatchObject({ liveCount: 2, discardedCount: 1 });
  });

  it('naturally reconciles after the offscreen grace timer expires', async () => {
    vi.useFakeTimers();
    try {
      let now = 0;
      const coordinator = new WebviewLifecycleCoordinator(
        { liveCap: 1, offscreenGraceMs: 100 },
        () => now,
      );
      registerLiveOffscreen(coordinator, 'oldest');
      registerLiveOffscreen(coordinator, 'newest');

      now = 101;
      await vi.advanceTimersByTimeAsync(101);

      expect(coordinator.snapshot()).toMatchObject({ liveCount: 1, discardedCount: 1 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('never discards visible, explicitly protected, or probe-rejected guests', async () => {
    const discarded: string[] = [];
    const coordinator = new WebviewLifecycleCoordinator(
      { liveCap: 1, offscreenGraceMs: 100 },
      () => 1_000,
    );
    const visible = registerLiveOffscreen(coordinator, 'visible', {
      onDiscard: () => discarded.push('visible'),
    });
    visible.setVisibility({ near: true, active: true });
    const selected = registerLiveOffscreen(coordinator, 'selected', {
      onDiscard: () => discarded.push('selected'),
    });
    selected.setProtected(true);
    registerLiveOffscreen(coordinator, 'audible-or-dirty', {
      canDiscard: () => false,
      onDiscard: () => discarded.push('audible-or-dirty'),
    });
    registerLiveOffscreen(coordinator, 'eligible', {
      onDiscard: () => discarded.push('eligible'),
    });

    await coordinator.reconcile({ ignoreGrace: true });

    expect(discarded).toEqual(['eligible']);
    expect(coordinator.snapshot().liveCount).toBe(3);
  });

  it('rechecks visibility after an asynchronous discard probe', async () => {
    let resolveProbe!: (allowed: boolean) => void;
    const probe = new Promise<boolean>((resolve) => { resolveProbe = resolve; });
    const onDiscard = vi.fn();
    const coordinator = new WebviewLifecycleCoordinator(
      { liveCap: 0, offscreenGraceMs: 100 },
      () => 1_000,
    );
    const handle = registerLiveOffscreen(coordinator, 'racing', {
      canDiscard: () => probe,
      onDiscard,
    });

    const reconciling = coordinator.reconcile({ ignoreGrace: true });
    handle.setVisibility({ near: true, active: true });
    resolveProbe(true);
    await reconciling;

    expect(onDiscard).not.toHaveBeenCalled();
    expect(coordinator.snapshot().liveCount).toBe(1);
  });

  it('skips a stuck discard probe and continues reconciling other candidates', async () => {
    const discarded: string[] = [];
    const coordinator = new WebviewLifecycleCoordinator(
      { liveCap: 1, offscreenGraceMs: 0, discardProbeTimeoutMs: 5 },
      () => 1_000,
    );
    registerLiveOffscreen(coordinator, 'stuck', {
      canDiscard: () => new Promise(() => undefined),
      onDiscard: () => discarded.push('stuck'),
    });
    registerLiveOffscreen(coordinator, 'eligible-1', {
      onDiscard: () => discarded.push('eligible-1'),
    });
    registerLiveOffscreen(coordinator, 'eligible-2', {
      onDiscard: () => discarded.push('eligible-2'),
    });

    await coordinator.reconcile({ ignoreGrace: true });

    expect(discarded).toEqual(['eligible-1', 'eligible-2']);
    expect(coordinator.snapshot().liveCount).toBe(1);
  });

  it('bounds timed-out probes per pass and cools down before trying later candidates', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    try {
      const probes = {
        stuck1: vi.fn(() => new Promise<boolean>(() => undefined)),
        stuck2: vi.fn(() => new Promise<boolean>(() => undefined)),
        stuck3: vi.fn(() => new Promise<boolean>(() => undefined)),
        eligible: vi.fn(() => true),
      };
      const onDiscard = vi.fn();
      const coordinator = new WebviewLifecycleCoordinator({
        liveCap: 3,
        offscreenGraceMs: 0,
        discardProbeTimeoutMs: 5,
      });
      registerLiveOffscreen(coordinator, 'stuck-1', { canDiscard: probes.stuck1 });
      registerLiveOffscreen(coordinator, 'stuck-2', { canDiscard: probes.stuck2 });
      registerLiveOffscreen(coordinator, 'stuck-3', { canDiscard: probes.stuck3 });
      registerLiveOffscreen(coordinator, 'eligible', {
        canDiscard: probes.eligible,
        onDiscard,
      });

      const firstPass = coordinator.reconcile({ ignoreGrace: true });
      await vi.advanceTimersByTimeAsync(20);
      await firstPass;

      expect(probes.stuck1).toHaveBeenCalledTimes(1);
      expect(probes.stuck2).toHaveBeenCalledTimes(1);
      expect(probes.stuck3).not.toHaveBeenCalled();
      expect(probes.eligible).not.toHaveBeenCalled();
      expect(onDiscard).not.toHaveBeenCalled();

      await coordinator.reconcile({ ignoreGrace: true });
      expect(probes.stuck3).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(5_010);

      expect(probes.stuck3).toHaveBeenCalledTimes(1);
      expect(probes.eligible).toHaveBeenCalledTimes(1);
      expect(onDiscard).toHaveBeenCalledTimes(1);
      expect(coordinator.snapshot().liveCount).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('exponentially backs off repeated timeouts for each entry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    try {
      const probe = vi.fn(() => new Promise<boolean>(() => undefined));
      const coordinator = new WebviewLifecycleCoordinator({
        liveCap: 0,
        offscreenGraceMs: 0,
        discardProbeTimeoutMs: 5,
      });
      registerLiveOffscreen(coordinator, 'stuck', { canDiscard: probe });

      const firstPass = coordinator.reconcile({ ignoreGrace: true });
      await vi.advanceTimersByTimeAsync(5);
      await firstPass;
      expect(probe).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(4_999);
      expect(probe).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(probe).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(5);

      await vi.advanceTimersByTimeAsync(9_999);
      expect(probe).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(probe).toHaveBeenCalledTimes(3);

      coordinator.reset();
    } finally {
      vi.useRealTimers();
    }
  });

  it('counts hook-style slow false probes toward the per-pass budget', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    try {
      const slowFalse = () => new Promise<boolean>((resolve) => {
        setTimeout(() => resolve(false), 4);
      });
      const probes = [vi.fn(slowFalse), vi.fn(slowFalse), vi.fn(slowFalse)];
      const coordinator = new WebviewLifecycleCoordinator({
        liveCap: 2,
        offscreenGraceMs: 0,
        discardProbeTimeoutMs: 5,
      });
      probes.forEach((probe, index) => {
        registerLiveOffscreen(coordinator, `slow-${index}`, { canDiscard: probe });
      });

      const pass = coordinator.reconcile({ ignoreGrace: true });
      await vi.advanceTimersByTimeAsync(10);
      await pass;

      expect(probes[0]).toHaveBeenCalledTimes(1);
      expect(probes[1]).toHaveBeenCalledTimes(1);
      expect(probes[2]).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('wakes a discarded guest as a restoring generation', async () => {
    const wakeStates: boolean[] = [];
    const coordinator = new WebviewLifecycleCoordinator(
      { liveCap: 0, offscreenGraceMs: 0 },
      () => 1_000,
    );
    const handle = registerLiveOffscreen(coordinator, 'page', {
      onWake: (restoring) => wakeStates.push(restoring),
    });

    await coordinator.reconcile({ ignoreGrace: true });
    expect(coordinator.snapshot().discardedCount).toBe(1);

    handle.wake();

    expect(wakeStates).toEqual([false, true]);
    expect(coordinator.snapshot()).toMatchObject({ liveCount: 1, discardedCount: 0 });
  });
});
