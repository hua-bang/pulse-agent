import type * as lark from '@larksuiteoapi/node-sdk';

type Json = Record<string, any>;
export interface Frame {
  at: number;
  operation: string;
  card: Json | null;
  cards: Array<{ messageId: string; card: Json }>;
  messageId?: string;
  text?: string;
  sequence?: number;
  elementId?: string;
}

/** A deliberately partial protocol model, not Feishu's renderer or validator. */
export class MockFeishu {
  readonly frames: Frame[] = [];
  readonly violations: string[] = [];
  readonly calls: Array<{ operation: string; at: number; payload: Json }> = [];
  card: Json | null = null;
  replyCard: Json | null = null;
  private sentCards = 0;
  denyCardkit = false;
  rejectNextContent = false;
  contentDelay = 0;
  private sequence = 0;
  private appliedSequence = 0;
  private readonly start = Date.now();

  private record(operation: string, payload: Json = {}): void {
    this.calls.push({ operation, at: Date.now() - this.start, payload: structuredClone(payload) });
  }

  private capture(operation: string, data: Partial<Frame> = {}): void {
    const cards = [this.card && { messageId: 'mock-message', card: this.card }, this.replyCard && { messageId: 'mock-reply', card: this.replyCard }].filter(Boolean) as Array<{ messageId: string; card: Json }>;
    this.frames.push({ at: Date.now() - this.start, operation, card: structuredClone(this.card), cards: structuredClone(cards), messageId: 'mock-message', ...data });
  }

  private require(condition: unknown, message: string): asserts condition {
    if (condition) return;
    this.violations.push(message);
    throw new Error(message);
  }

  private visit(value: unknown, fn: (node: Json) => void): void {
    if (!value || typeof value !== 'object') return;
    const node = value as Json;
    fn(node);
    Object.values(node).forEach(child => {
      if (Array.isArray(child)) child.forEach(item => this.visit(item, fn));
      else if (child && typeof child === 'object') this.visit(child, fn);
    });
  }

  private validateCard(card: Json): void {
    this.require(card.schema === '2.0', 'Expected schema 2.0');
    this.require(Array.isArray(card.body?.elements), 'Missing body.elements');
    const ids = new Set<string>();
    this.visit(card, node => {
      if (!node.element_id) return;
      this.require(typeof node.element_id === 'string' && node.element_id.length <= 20, 'Invalid element ID');
      this.require(!ids.has(node.element_id), `Duplicate element ID: ${node.element_id}`);
      ids.add(node.element_id);
    });
  }

  private begin(operation: string, request: Json): void {
    this.record(operation, request);
    this.require(request.path.card_id === 'mock-card', 'Wrong card ID');
    this.require(Number.isInteger(request.data.sequence) && request.data.sequence > this.sequence, 'Sequence did not increase');
    this.sequence = request.data.sequence;
  }

  readonly client = {
    cardkit: { v1: {
      card: {
        create: async (request: Json) => {
          this.record('card.create', request);
          if (this.denyCardkit) return { code: 99991672, msg: 'mock: missing cardkit permission' };
          this.card = JSON.parse(request.data.data);
          this.validateCard(this.card!);
          return { code: 0, data: { card_id: 'mock-card' } };
        },
        settings: async (request: Json) => {
          this.begin('card.settings', request);
          Object.assign(this.card!.config, JSON.parse(request.data.settings).config);
          this.appliedSequence = request.data.sequence;
          this.capture('card.settings', { sequence: request.data.sequence });
          return { code: 0 };
        },
        update: async (request: Json) => {
          this.begin('card.update', request);
          const card = JSON.parse(request.data.card.data);
          this.validateCard(card);
          this.card = card;
          this.appliedSequence = request.data.sequence;
          this.capture('card.update', { sequence: request.data.sequence });
          return { code: 0 };
        },
      },
      cardElement: {
        content: async (request: Json) => {
          this.begin('element.content', request);
          if (this.rejectNextContent) {
            this.rejectNextContent = false;
            return { code: 200810, msg: 'mock: transient rejection' };
          }
          if (this.contentDelay) await new Promise(resolve => setTimeout(resolve, this.contentDelay));
          if (request.data.sequence <= this.appliedSequence) return { code: 300317 };
          this.require(this.card?.config?.streaming_mode === true, 'Content update outside streaming mode');
          let target: Json | undefined;
          this.visit(this.card, node => { if (node.element_id === request.path.element_id) target = node; });
          this.require(target && ['markdown', 'plain_text'].includes(target.tag), 'Text element does not exist');
          this.require(typeof request.data.content === 'string' && request.data.content.length > 0, 'Empty content update');
          target.content = request.data.content;
          this.appliedSequence = request.data.sequence;
          this.capture('element.content', { sequence: request.data.sequence, elementId: request.path.element_id });
          return { code: 0 };
        },
      },
    } },
    im: { message: {
      create: async (request: Json) => this.send('message.create', request),
      reply: async (request: Json) => this.send('message.reply', request),
      patch: async (request: Json) => {
        this.record('message.patch', request);
        this.require(['mock-message', 'mock-reply'].includes(request.path.message_id), 'Wrong message ID');
        const card = JSON.parse(request.data.content); this.validateCard(card);
        if (request.path.message_id === 'mock-reply') this.replyCard = card;
        else this.card = card;
        this.capture('message.patch', { messageId: request.path.message_id });
        return { code: 0 };
      },
    } },
  } as unknown as lark.Client;

  private send(operation: string, request: Json): Json {
    this.record(operation, request);
    const data = JSON.parse(request.data.content);
    if (request.data.msg_type === 'interactive') {
      if (data.type === 'card') this.require(data.data.card_id === 'mock-card', 'Wrong entity reference');
      else { this.validateCard(data); if (this.sentCards === 0) this.card = data; else this.replyCard = data; }
      this.sentCards++;
      this.capture(operation, { messageId: this.sentCards === 1 ? 'mock-message' : 'mock-reply' });
    } else this.capture(operation, { text: data.text });
    return { code: 0, data: { message_id: this.sentCards <= 1 ? 'mock-message' : 'mock-reply' } };
  }
}
