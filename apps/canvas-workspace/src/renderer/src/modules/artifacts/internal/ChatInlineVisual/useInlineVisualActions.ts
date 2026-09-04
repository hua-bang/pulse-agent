import { useCallback, useMemo, useState } from 'react';
import { useRightDock } from '../../../../shared/dockPort';
import { createArtifactPromotion } from './artifactPromotion';
import type { InlineVisualPayload } from './types';

interface Input {
  workspaceId: string;
  livePayload: InlineVisualPayload | null;
}

export const useInlineVisualActions = ({ workspaceId, livePayload }: Input) => {
  const { openArtifact } = useRightDock();
  const [opening, setOpening] = useState(false);
  const [pinning, setPinning] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [copied, setCopied] = useState(false);
  const promotion = useMemo(() => createArtifactPromotion(async (visual) => {
    const result = await window.canvasWorkspace.artifacts.create(workspaceId, {
      type: visual.type,
      title: visual.title || 'Saved visual',
      content: visual.content,
      source: { origin: 'inline_promotion' },
    });
    return result.ok && result.artifact ? result.artifact.id : null;
  }), [workspaceId]);

  const open = useCallback(async () => {
    if (opening || !livePayload?.content) return;
    setOpening(true);
    try {
      const id = await promotion.promote(livePayload);
      if (id) openArtifact(workspaceId, id);
    } finally {
      setOpening(false);
    }
  }, [livePayload, openArtifact, opening, promotion, workspaceId]);

  const copy = useCallback(async () => {
    if (!livePayload?.content) return;
    try {
      await navigator.clipboard.writeText(livePayload.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard writes are best-effort for an inline preview.
    }
  }, [livePayload]);

  const saveToCanvas = useCallback(async () => {
    if (pinning || pinned || !livePayload?.content) return;
    setPinning(true);
    try {
      const id = await promotion.promote(livePayload);
      if (!id) return;
      const result = await window.canvasWorkspace.artifacts.pinToCanvas(workspaceId, id, {});
      if (result?.ok) setPinned(true);
    } finally {
      setPinning(false);
    }
  }, [livePayload, pinned, pinning, promotion, workspaceId]);

  return {
    copied,
    copy,
    open,
    opening,
    pinned,
    pinning,
    saveToCanvas,
  };
};
