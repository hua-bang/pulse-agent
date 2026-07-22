import { useEffect, useRef, useState } from 'react';
import {
  initialWebviewLoadScheduler,
  type InitialLoadHandle,
  type InitialLoadReleaseReason,
} from './initial-load-scheduler';

interface Options {
  eligible: boolean;
  getPriority?: () => number;
  id: string;
  priority: number;
}

export const useInitialWebviewLoadSlot = ({ eligible, getPriority, id, priority }: Options) => {
  const [granted, setGranted] = useState(false);
  const handleRef = useRef<InitialLoadHandle | null>(null);

  useEffect(() => {
    if (!eligible || granted) return;
    const handle = initialWebviewLoadScheduler.schedule(
      id,
      getPriority?.() ?? priority,
      () => setGranted(true),
    );
    handleRef.current = handle;
    return () => {
      handle.cancel();
      if (handleRef.current === handle) handleRef.current = null;
    };
    // `granted` deliberately is not a dependency: the state flip is the
    // scheduler admitting this request, not a lifecycle teardown. Cleaning
    // up on that render would immediately cancel the active slot before the
    // guest's did-stop-loading can release it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligible, id]);

  useEffect(() => {
    handleRef.current?.updatePriority(getPriority?.() ?? priority);
  }, [getPriority, priority]);

  const release = (reason: InitialLoadReleaseReason) => {
    initialWebviewLoadScheduler.release(id, reason);
  };

  return {
    granted,
    queued: eligible && !granted,
    release,
  };
};
