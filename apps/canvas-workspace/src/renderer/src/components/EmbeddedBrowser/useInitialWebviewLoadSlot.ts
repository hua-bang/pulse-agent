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
  const leaseIdRef = useRef<string | null>(null);
  const grantedRef = useRef(false);
  const latestIdentityRef = useRef({ eligible, id });
  latestIdentityRef.current = { eligible, id };

  useEffect(() => {
    if (!eligible || grantedRef.current) return;
    const leaseId = id;
    const handle = initialWebviewLoadScheduler.schedule(
      leaseId,
      getPriority?.() ?? priority,
      () => {
        leaseIdRef.current = leaseId;
        grantedRef.current = true;
        setGranted(true);
      },
    );
    handleRef.current = handle;
    leaseIdRef.current = leaseId;
    return () => {
      // A Dock workspace change can keep the same guest element and its
      // first navigation alive. Keep that granted lease under its original
      // scheduler id until the guest settles, otherwise the live guest would
      // fall out of the global concurrency accounting.
      const latest = latestIdentityRef.current;
      if (grantedRef.current && latest.eligible && latest.id !== leaseId) return;
      handle.cancel();
      if (handleRef.current === handle) {
        handleRef.current = null;
        leaseIdRef.current = null;
      }
    };
    // The admission state deliberately is not a dependency: the state flip
    // is the scheduler admitting this request, not a lifecycle teardown.
    // Cleaning up on that render would immediately cancel the active slot
    // before the guest's did-stop-loading can release it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligible, id]);

  useEffect(() => {
    // When a granted webview is removed without an id change (for example a
    // discard), the scheduling effect may already have retained its old lease
    // during a prior identity change. Release it explicitly rather than leave
    // a phantom active slot behind.
    if (!eligible) {
      handleRef.current?.cancel();
      handleRef.current = null;
      leaseIdRef.current = null;
    }
  }, [eligible]);

  useEffect(() => () => {
    handleRef.current?.cancel();
    handleRef.current = null;
    leaseIdRef.current = null;
  }, []);

  useEffect(() => {
    handleRef.current?.updatePriority(getPriority?.() ?? priority);
  }, [getPriority, priority]);

  const release = (reason: InitialLoadReleaseReason) => {
    const leaseId = leaseIdRef.current;
    if (leaseId) initialWebviewLoadScheduler.release(leaseId, reason);
  };

  return {
    granted,
    queued: eligible && !granted,
    release,
  };
};
