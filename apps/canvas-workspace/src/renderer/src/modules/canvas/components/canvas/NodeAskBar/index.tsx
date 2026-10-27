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
  node: CanvasNode;
  /** Other cards on the canvas; the bar avoids covering their text. */
  nodes?: CanvasNode[];
  transform: CanvasTransform;
  onAsk: (prompt: ChatPromptSubmission) => Promise<ChatDeliveryReceipt>;
}

/**
 * Small "ask about this card" control under the single selected node. It
 * starts as a compact chip so a selected card is not covered by an input;
 * pressing it opens the input, and leaving an empty input folds it again.
 * The question starts a new workspace chat scoped to that node; the answer
 * shows in the dock chat, not here.
 */
/** True when a card (not a container) other than `self` meets the screen rect. */
const coversCard = (
  nodes: CanvasNode[],
  self: CanvasNode,
  transform: CanvasTransform,
  rect: { left: number; top: number; right: number; bottom: number },
) => nodes.some((other) => {
  if (other.id === self.id || other.type === 'frame' || other.type === 'group') return false;
  const left = other.x * transform.scale + transform.x;
  const top = other.y * transform.scale + transform.y;
  return rect.left < left + other.width * transform.scale && rect.right > left
    && rect.top < top + other.height * transform.scale && rect.bottom > top;
});

export const NodeAskBar = ({ workspaceId, node, nodes = [], transform, onAsk }: Props) => {
  const { t } = useI18n();
  const notifyChatDelivery = useChatDeliveryNotifier();
  const barRef = useRef<HTMLFormElement>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [placeAbove, setPlaceAbove] = useState(false);
  const [aboveLeft, setAboveLeft] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const label = getNodeDisplayLabel(node);
  const left = node.x * transform.scale + transform.x;
  const right = (node.x + node.width) * transform.scale + transform.x;
  const belowTop = (node.y + node.height) * transform.scale + transform.y + NODE_GAP;
  const aboveBottom = node.y * transform.scale + transform.y - NODE_GAP;

  useEffect(() => {
    setText('');
    setExpanded(false);
  }, [node.id]);

  // Flip above the card when the bar would fall off the bottom of the canvas.
  useLayoutEffect(() => {
    const bar = barRef.current;
    const host = bar?.offsetParent as HTMLElement | null;
    if (!bar || !host) return;
    const height = bar.offsetHeight;
    // Above the card, align to its right edge (the left side of that row
    // holds frame titles and their tools), but stay inside the canvas.
    const width = bar.offsetWidth;
    const maxLeft = Math.max(VIEWPORT_GAP, host.clientWidth - width - VIEWPORT_GAP);
    const nextAboveLeft = Math.min(Math.max(right - width, VIEWPORT_GAP), maxLeft);
    const fitsAbove = aboveBottom - height > 0;
    // Also flip when the bar would sit on the card below and the row above
    // is clear, so it does not cover a neighbour's text.
    const coversBelow = coversCard(nodes, node, transform, {
      left, top: belowTop, right: left + width, bottom: belowTop + height,
    });
    const coversAbove = coversCard(nodes, node, transform, {
      left: nextAboveLeft, top: aboveBottom - height, right: nextAboveLeft + width, bottom: aboveBottom,
    });
    setPlaceAbove(fitsAbove && (belowTop + height > host.clientHeight || (coversBelow && !coversAbove)));
    setAboveLeft(nextAboveLeft);
  }, [aboveBottom, belowTop, expanded, left, node, nodes, right, transform]);

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
        nodes: [{ id: node.id, title: label, type: node.type }],
        ...(lastAskedNodeIds.get(workspaceId) === node.id ? {} : { newSession: true }),
      });
      if (receipt.status === 'delivered' || receipt.status === 'queued') lastAskedNodeIds.set(workspaceId, node.id);
      // A delivered question is visible in the chat itself; only report problems.
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

  return (
    <form
      ref={barRef}
      className={`node-ask-bar${expanded ? ' node-ask-bar--expanded' : ''}`}
      style={placeAbove
        ? { left: aboveLeft, top: aboveBottom, transform: 'translateY(-100%)' }
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
          <span>{t('launcher.askSubmit')}</span>
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
