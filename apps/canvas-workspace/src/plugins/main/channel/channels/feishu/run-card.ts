import type * as lark from '@larksuiteoapi/node-sdk';
import { sendCardMessage, updateCardMessage, type FeishuSendTarget } from './feishu-client';

interface CardNode {
  tag?: string;
  element_id?: string;
  content?: string;
  [key: string]: unknown;
}

function textElements(card: object): Map<string, string> {
  const result = new Map<string, string>();
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    const node = value as CardNode;
    if (node.element_id && typeof node.content === 'string') {
      result.set(node.element_id, node.content);
    }
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === 'object') visit(child);
    }
  };
  visit(card);
  return result;
}

function check(result: { code?: number; msg?: string }): void {
  if (result.code && result.code !== 0) {
    throw new Error(`Feishu CardKit: ${result.code} ${result.msg ?? 'unknown error'}`);
  }
}

/** One transport per run; the stream owns serialization and bounded waits. */
export class FeishuRunCard {
  private cardId: string | null = null;
  private messageId: string | null = null;
  private sequence = 0;
  private abandoned = false;
  private cancellation = 0;
  private readonly sent = new Map<string, string>();

  constructor(private readonly client: lark.Client, private readonly target: FeishuSendTarget) {}

  abandon(): void {
    this.abandoned = true;
    this.cancellation++;
  }

  get hasOrderedUpdates(): boolean { return this.cardId !== null; }

  private assertActive(): void {
    if (this.abandoned) throw new Error('Feishu run card operation was abandoned');
  }

  async open(card: object): Promise<string> {
    const source = card as { config: object };
    const streamingCard = {
      ...source,
      config: {
        ...source.config,
        update_multi: true,
        streaming_mode: true,
        streaming_config: {
          print_frequency_ms: { default: 30 },
          print_step: { default: 2 },
          print_strategy: 'fast',
        },
      },
    };
    // Only entity creation can fall back: no chat message exists yet. Never
    // send a second card after an ambiguous message-send failure.
    try {
      const result = await this.client.cardkit.v1.card.create({
        data: { type: 'card_json', data: JSON.stringify(streamingCard) },
      });
      check(result);
      if (!result.data?.card_id) throw new Error('Feishu CardKit returned no card id');
      this.cardId = result.data.card_id;
    } catch (error) {
      console.warn('[channel:feishu] native streaming unavailable; using message patches', error);
    }
    this.assertActive();
    this.messageId = await sendCardMessage(this.client, this.target,
      this.cardId ? { type: 'card', data: { card_id: this.cardId } } : card);
    for (const [id, text] of textElements(card)) this.sent.set(id, text);
    return this.messageId;
  }

  async update(card: object, final: boolean): Promise<void> {
    if (!this.messageId) throw new Error('Feishu run card is not open');
    if (!this.cardId) return updateCardMessage(this.client, this.messageId, card);
    if (!final) this.assertActive();
    const path = { card_id: this.cardId };
    if (final) {
      const cancellation = this.cancellation;
      // Close the native loading/printing lifecycle before replacing the layout.
      check(await this.client.cardkit.v1.card.settings({
        path,
        data: { sequence: ++this.sequence, settings: JSON.stringify({ config: { streaming_mode: false } }) },
      }));
      // A prior progress timeout stops its remaining calls, but a final update
      // can supersede that request using a newer CardKit sequence. A timeout of
      // this final operation itself must still prevent a late second request.
      if (cancellation !== this.cancellation) throw new Error('Feishu final update was abandoned');
      check(await this.client.cardkit.v1.card.update({
        path,
        data: {
          sequence: ++this.sequence,
          card: { type: 'card_json', data: JSON.stringify(card) },
        },
      }));
      return;
    }
    // Send full accumulated text to stable element IDs. Prefix appends animate
    // on the client; changing a tool's state replaces only that text component.
    for (const [element_id, content] of textElements(card)) {
      this.assertActive();
      if (!content || this.sent.get(element_id) === content) continue;
      check(await this.client.cardkit.v1.cardElement.content({
        path: { ...path, element_id },
        data: { content, sequence: ++this.sequence },
      }));
      this.sent.set(element_id, content);
    }
  }
}
