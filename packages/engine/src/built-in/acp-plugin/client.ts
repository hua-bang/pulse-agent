import type {
  AcpCancelInput,
  AcpClientConfig,
  AcpNewSessionInput,
  AcpNewSessionResult,
  AcpPromptInput,
  AcpPromptResult,
} from './types';
import { extractFinishReason, extractSessionId, extractText, safeJsonParse } from './parsers';

export class AcpHttpClient {
  private readonly config: AcpClientConfig;

  private initializePromise: Promise<void> | null = null;

  constructor(config: AcpClientConfig) {
    this.config = config;
  }

  isConfigured(): boolean {
    return this.config.baseUrl.length > 0;
  }

  getStatus(): { configured: boolean; baseUrl?: string; timeoutMs: number } {
    if (!this.isConfigured()) {
      return { configured: false, timeoutMs: this.config.timeoutMs };
    }

    return {
      configured: true,
      baseUrl: this.config.baseUrl,
      timeoutMs: this.config.timeoutMs,
    };
  }

  async ensureInitialized(): Promise<void> {
    if (this.initializePromise) {
      await this.initializePromise;
      return;
    }

    this.initializePromise = this.initializeInternal();
    await this.initializePromise;
  }

  async createSession(input: AcpNewSessionInput): Promise<AcpNewSessionResult> {
    await this.ensureInitialized();
    const payload = await this.postJson(this.config.sessionNewPath, {
      target: input.target,
      metadata: input.metadata ?? {},
    });

    const sessionId = extractSessionId(payload);
    if (!sessionId) {
      throw new Error('ACP session/new response missing session id');
    }

    return { sessionId, raw: payload };
  }

  async prompt(input: AcpPromptInput): Promise<AcpPromptResult> {
    await this.ensureInitialized();
    const payload = await this.postJson(this.config.sessionPromptPath, {
      sessionId: input.sessionId,
      session_id: input.sessionId,
      target: input.target,
      prompt: input.prompt,
      metadata: input.metadata ?? {},
    });

    return {
      text: extractText(payload),
      finishReason: extractFinishReason(payload),
      raw: payload,
    };
  }

  async cancel(input: AcpCancelInput): Promise<{ ok: boolean; raw: unknown }> {
    await this.ensureInitialized();
    const payload = await this.postJson(this.config.sessionCancelPath, {
      sessionId: input.sessionId,
      session_id: input.sessionId,
      reason: input.reason,
    });

    return { ok: true, raw: payload };
  }

  private async initializeInternal(): Promise<void> {
    if (!this.isConfigured()) {
      throw new Error('ACP bridge is not configured. Set ACP_BRIDGE_BASE_URL.');
    }

    try {
      await this.postJson(this.config.initializePath, {
        client: {
          name: 'pulse-coder-engine/built-in-acp',
          version: '0.1.0',
        },
        capabilities: {
          session: ['new', 'prompt', 'cancel'],
        },
      });
    } catch (error) {
      if (!this.config.initializeOptional) {
        throw error;
      }
      console.warn('[ACP] initialize failed, continuing in optional mode:', error);
    }
  }

  private async postJson(pathname: string, payload: unknown): Promise<unknown> {
    if (!this.isConfigured()) {
      throw new Error('ACP bridge is not configured. Set ACP_BRIDGE_BASE_URL.');
    }

    const url = `${this.config.baseUrl}${pathname}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
      };
      if (this.config.apiKey) {
        headers.authorization = `Bearer ${this.config.apiKey}`;
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const rawText = await response.text();
      const parsed = rawText ? safeJsonParse(rawText) : {};

      if (!response.ok) {
        const preview = rawText.slice(0, 300);
        throw new Error(`ACP request failed: ${response.status} ${response.statusText}; body=${preview}`);
      }

      return parsed;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
