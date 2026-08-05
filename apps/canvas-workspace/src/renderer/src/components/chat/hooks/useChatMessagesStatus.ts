import { useEffect, useRef, useState } from 'react';

import { useI18n } from '../../../i18n';
import type { AgentChatMessage } from '../../../types';

const SKELETON_DELAY_MS = 180;
const SKELETON_MIN_VISIBLE_MS = 320;

interface UseChatMessagesStatusOptions {
  latestTurnStatus: AgentChatMessage['turnStatus'];
  loading: boolean;
  messageCount: number;
  pendingLabel?: string;
  sessionLoading: boolean;
}

interface ChatMessagesStatus {
  skeletonVisible: boolean;
  turnAnnouncement: string;
}

export function useChatMessagesStatus({
  latestTurnStatus,
  loading,
  messageCount,
  pendingLabel,
  sessionLoading,
}: UseChatMessagesStatusOptions): ChatMessagesStatus {
  const { t } = useI18n();
  const [skeletonVisible, setSkeletonVisible] = useState(false);
  const [turnAnnouncement, setTurnAnnouncement] = useState('');
  const skeletonShownAtRef = useRef(0);
  const prevTurnLoadingRef = useRef(false);

  useEffect(() => {
    let timer: number | undefined;
    if (sessionLoading && messageCount === 0 && !skeletonVisible) {
      timer = window.setTimeout(() => {
        skeletonShownAtRef.current = Date.now();
        setSkeletonVisible(true);
      }, SKELETON_DELAY_MS);
    } else if (!sessionLoading && skeletonVisible) {
      const elapsed = Date.now() - skeletonShownAtRef.current;
      timer = window.setTimeout(
        () => setSkeletonVisible(false),
        Math.max(0, SKELETON_MIN_VISIBLE_MS - elapsed),
      );
    } else if (messageCount > 0) {
      setSkeletonVisible(false);
    }
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [messageCount, sessionLoading, skeletonVisible]);

  useEffect(() => {
    const turnJustFinished = prevTurnLoadingRef.current && !loading;
    prevTurnLoadingRef.current = loading;
    if (pendingLabel) {
      setTurnAnnouncement(pendingLabel);
    } else if (loading) {
      setTurnAnnouncement(t('chat.generating'));
    } else if (turnJustFinished) {
      if (latestTurnStatus === 'stopped') {
        setTurnAnnouncement(t('chat.turn.stopped'));
      } else if (latestTurnStatus === 'failed') {
        setTurnAnnouncement(t('chat.turn.failed'));
      } else {
        setTurnAnnouncement(t('chat.responseComplete'));
      }
    } else {
      setTurnAnnouncement('');
    }
  }, [latestTurnStatus, loading, pendingLabel, t]);

  return { skeletonVisible, turnAnnouncement };
}
