import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type FormEvent, type KeyboardEvent } from 'react';
import type { CanvasNode, CanvasTransform } from '../../../../../types';
import type { ChatDeliveryReceipt, ChatPromptSubmission } from '../../../../chat';
import { useChatDeliveryNotifier } from '../../../../chat/delivery';
import { SparklesIcon } from '../../../../../components/icons';
import { Button, TextField } from '../../../../../components/ui';
import { useI18n } from '../../../../../i18n';
import { getNodeDisplayLabel } from '../../../../../utils/nodeLabel';
import './index.css';

/**
 * Screen-space gap between the selected card and the bar. It clears the
 * connect handles, which sit 14px outside the card and are 10px wide.
 */
const NODE_GAP = 24;
const VIEWPORT_GAP = 8;

/**
 * Card whose question started the current ask conversation, per workspace.
 * A question about another card starts a new conversation, so it does not
 * land in an unrelated thread; a follow-up about the same card keeps its
 * history. Each workspace has its own chat, so each keeps its own card.
 */
const lastAskedNodeIds = new Map<string, string>();

interface Props {
  /** Workspace whose chat receives the question. */
  workspaceId: string;
  /** Single selected node (backward-compatible shorthand for selectedNodes). */
  node?: CanvasNode;
  /** One or more selected nodes; frames expand to their enclosed cards. */
  selectedNodes?: CanvasNode[];
  /** Other cards on the canvas; the bar avoids covering their text. */
  nodes?: CanvasNode[];
  transform: CanvasTransform;
  onAsk: (prompt: ChatPromptSubmission) => Promise<ChatDeliveryReceipt>;
}

const isInsideFrame = (candidate: CanvasNode, frame: CanvasNode): boolean => {
  if (candidate.id === frame.id || candidate.type === 'frame' || candidate.type === 'group') return false;
  const cx = candidate.x + candidate.width / 2;
  const cy = candidate.y + candidate.height / 2;
  return cx >= frame.x && cx <= frame.x + frame.width && cy >= frame.y && cy <= frame.y + frame.height;
};

/** Expand selected frames into their enclosed cards while preserving order and deduplicating. */
const resolveAskTargets = (selection: CanvasNode[], allNodes: CanvasNode[]): CanvasNode[] => {
  const seen = new Set<string>();
  const resolved: CanvasNode[] = [];
  const push = (item: CanvasNode) => {
    if (seen.has(item.id)) return;
    seen.add(item.id);
    resolved.push(item);
  };
  for (const item of selection) {
    if (item.type === 'frame') {
      const enclosed = allNodes.filter((candidate) => isInsideFrame(candidate, item));
      if (enclosed.length > 0) {
        enclosed.forEach(push);
        continue;
      }
    }
    push(item);
  }
  return resolved;
};

/** True when a card (not a container) outside `excludedIds` meets the screen rect. */
const coversCard = (
  nodes: CanvasNode[],
  excludedIds: Set<string>,
  transform: CanvasTransform,
  rect: { left: number; top: number; right: number; bottom: number },
) => nodes.some((other) => {
  if (excludedIds.has(other.id) || other.type === 'frame' || other.type === 'group') return false;
  const left = other.x * transform.scale + transform.x;
  const top = other.y * transform.scale + transform.y;
  return rect.left < left + other.width * transform.scale && rect.right > left
    && rect.top < top + other.height * transform.scale && rect.bottom > top;
});

export const NodeAskBar = ({ workspaceId, node, selectedNodes, nodes = [], transform, onAsk }: Props) => {
  const { t } = useI18n();
  const notifyChatDelivery = useChatDeliveryNotifier();
  const barRef = useRef<HTMLFormElement>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [layout, setLayout] = useState<{ placeAbove: boolean; left: number; top: number } | null>(null);
  const [expanded, setExpanded] = useState(false);

  const selection = selectedNodes && selectedNodes.length > 0 ? selectedNodes : (node ? [node] : []);
  const targets = resolveAskTargets(selection, nodes);
  const selectionKey = targets.map((item) => item.id).sort().join(',');

  const bounds = selection.reduce(
    (acc, item) => ({
      minX: Math.min(acc.minX, item.x),
      minY: Math.min(acc.minY, item.y),
      maxX: Math.max(acc.maxX, item.x + item.width),
      maxY: Math.max(acc.maxY, item.y + item.height),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );

  const primaryNode = targets[0] ?? selection[0];
  const label = targets.length > 1
    ? `${getNodeDisplayLabel(primaryNode)} (+${targets.length - 1})`
    : (primaryNode ? getNodeDisplayLabel(primaryNode) : '');
  const left = bounds.minX * transform.scale + transform.x;
  const right = bounds.maxX * transform.scale + transform.x;
  const belowTop = bounds.maxY * transform.scale + transform.y + NODE_GAP;
  const aboveBottom = bounds.minY * transform.scale + transform.y - NODE_GAP;

  useEffect(() => {
    setText('');
    setExpanded(false);
  }, [selectionKey]);

  // Flip above the selection when the bar would fall off the bottom of the canvas,
  // and clamp both horizontal and vertical coordinates inside the host bounds.
  useLayoutEffect(() => {
    const bar = barRef.current;
    const host = bar?.offsetParent as HTMLElement | null;
    if (!bar || !host || selection.length === 0) return;
    const excludedIds = new Set([...selection.map((item) => item.id), ...targets.map((item) => item.id)]);
    const height = bar.offsetHeight;
    const width = bar.offsetWidth;
    const hasWidth = host.clientWidth > 0;
    const hasHeight = host.clientHeight > 0;
    const maxLeft = Math.max(VIEWPORT_GAP, host.clientWidth - width - VIEWPORT_GAP);
    const nextAboveLeft = hasWidth ? Math.min(Math.max(right - width, VIEWPORT_GAP), maxLeft) : right - width;
    const nextBelowLeft = hasWidth ? Math.min(Math.max(left, VIEWPORT_GAP), maxLeft) : left;
    const fitsAbove = aboveBottom - height > 0;
    const coversBelow = coversCard(nodes, excludedIds, transform, {
      left: nextBelowLeft, top: belowTop, right: nextBelowLeft + width, bottom: belowTop + height,
    });
    const coversAbove = coversCard(nodes, excludedIds, transform, {
      left: nextAboveLeft, top: aboveBottom - height, right: nextAboveLeft + width, bottom: aboveBottom,
    });
    const nextPlaceAbove = fitsAbove && (
      (hasHeight && belowTop + height > host.clientHeight) || (coversBelow && !coversAbove)
    );
    const maxBelowTop = Math.max(VIEWPORT_GAP, host.clientHeight - height - VIEWPORT_GAP);
    const nextBelowTop = hasHeight ? Math.min(Math.max(belowTop, VIEWPORT_GAP), maxBelowTop) : belowTop;
    const minAboveTop = height + VIEWPORT_GAP;
    const nextAboveTop = hasHeight
      ? Math.min(Math.max(aboveBottom, minAboveTop), Math.max(minAboveTop, host.clientHeight - VIEWPORT_GAP))
      : aboveBottom;
    setLayout({
      placeAbove: nextPlaceAbove,
      left: nextPlaceAbove ? nextAboveLeft : nextBelowLeft,
      top: nextPlaceAbove ? nextAboveTop : nextBelowTop,
    });
  }, [aboveBottom, belowTop, expanded, left, nodes, right, selectionKey, transform]);

  if (selection.length === 0 || targets.length === 0) return null;

  const handleBlur = (event: FocusEvent<HTMLFormElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    if (!text.trim() && !sending) setExpanded(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key !== 'Escape' || sending) return;
    event.stopPropagation();
    setText('');
    setExpanded(false);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const question = text.trim();
    if (!question || sending) return;
    setSending(true);
    try {
      const receipt = await onAsk({
        text: question,
        nodes: targets.map((item) => ({ id: item.id, title: getNodeDisplayLabel(item), type: item.type })),
        ...(lastAskedNodeIds.get(workspaceId) === selectionKey ? {} : { newSession: true }),
      });
      if (receipt.status === 'delivered' || receipt.status === 'queued') {
        lastAskedNodeIds.set(workspaceId, selectionKey);
      }
      if (receipt.status !== 'delivered') notifyChatDelivery(receipt, label);
      if (receipt.status === 'delivered' || receipt.status === 'queued') {
        setText('');
        setExpanded(false);
      }
    } catch (error) {
      notifyChatDelivery({
        status: 'failed',
        target: null,
        error: error instanceof Error ? error.message : String(error),
      }, label);
    } finally {
      setSending(false);
    }
  };

  const chipText = targets.length > 1
    ? `${t('launcher.askSubmit')} (${targets.length})`
    : t('launcher.askSubmit');

  return (
    <form
      ref={barRef}
      className={`node-ask-bar${expanded ? ' node-ask-bar--expanded' : ''}`}
      style={layout
        ? (layout.placeAbove
          ? { left: layout.left, top: layout.top, transform: 'translateY(-100%)' }
          : { left: layout.left, top: layout.top })
        : { left, top: belowTop }}
      aria-label={t('canvas.askBar.label', { title: label })}
      onSubmit={(event) => { void handleSubmit(event); }}
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
    >
      {!expanded ? (
        <Button
          variant="secondary"
          size="xs"
          className="node-ask-bar__chip"
          onClick={() => setExpanded(true)}
          aria-label={t('canvas.askBar.label', { title: label })}
        >
          <SparklesIcon size={13} className="node-ask-bar__icon" />
          <span>{chipText}</span>
        </Button>
      ) : (
        <>
          <SparklesIcon size={14} className="node-ask-bar__icon" />
          <TextField
            autoFocus
            className="node-ask-bar__input"
            value={text}
            placeholder={t('canvas.askBar.placeholder')}
            aria-label={t('canvas.askBar.label', { title: label })}
            onChange={(event) => setText(event.target.value)}
            disabled={sending}
          />
          <Button
            type="submit"
            variant="icon"
            size="sm"
            className="node-ask-bar__send"
            disabled={sending || !text.trim()}
            title={t('canvas.askBar.send')}
            aria-label={t('canvas.askBar.send')}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M8 13V4.5M8 4.5l-3.5 3.5M8 4.5l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Button>
        </>
      )}
    </form>
  );
};
