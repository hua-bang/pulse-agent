import type { AcpHttpClient } from './client';
import type { AcpBridgeStatus, AcpSessionBinding, AcpSessionStore, EnsureSessionInput, EnsureSessionResult } from './types';

export class AcpBridgeService {
  private readonly client: AcpHttpClient;

  private readonly sessionStore: AcpSessionStore;

  private readonly defaultTarget: string;

  constructor(input: {
    client: AcpHttpClient;
    sessionStore: AcpSessionStore;
    defaultTarget: string;
  }) {
    this.client = input.client;
    this.sessionStore = input.sessionStore;
    this.defaultTarget = input.defaultTarget;
  }

  getStatus(): AcpBridgeStatus {
    return {
      ...this.client.getStatus(),
      defaultTarget: this.defaultTarget,
    };
  }

  async ensureBoundSession(input: EnsureSessionInput): Promise<EnsureSessionResult> {
    this.assertConfigured();
    const existing = await this.sessionStore.get(input.remoteSessionId);
    const requestedTarget = this.resolveTarget(input.target, existing?.target);

    if (existing && !input.forceNewSession && existing.target === requestedTarget) {
      return { binding: existing, reused: true };
    }

    const created = await this.client.createSession({
      target: requestedTarget,
      metadata: input.metadata,
    });

    const binding = await this.sessionStore.upsert({
      remoteSessionId: input.remoteSessionId,
      acpSessionId: created.sessionId,
      target: requestedTarget,
      metadata: input.metadata,
    });

    return {
      binding,
      reused: false,
    };
  }

  async promptWithBoundSession(input: {
    remoteSessionId: string;
    prompt: string;
    target?: string;
    metadata?: Record<string, unknown>;
    forceNewSession?: boolean;
  }): Promise<{
    binding: AcpSessionBinding;
    reusedSession: boolean;
    text: string;
    finishReason?: string;
    raw: unknown;
  }> {
    const session = await this.ensureBoundSession({
      remoteSessionId: input.remoteSessionId,
      target: input.target,
      metadata: input.metadata,
      forceNewSession: input.forceNewSession,
    });

    const prompted = await this.client.prompt({
      sessionId: session.binding.acpSessionId,
      prompt: input.prompt,
      target: session.binding.target,
      metadata: input.metadata,
    });

    return {
      binding: session.binding,
      reusedSession: session.reused,
      text: prompted.text,
      finishReason: prompted.finishReason,
      raw: prompted.raw,
    };
  }

  async cancelBoundSession(input: {
    remoteSessionId: string;
    reason?: string;
    dropBinding?: boolean;
  }): Promise<{
    found: boolean;
    canceled: boolean;
    binding?: AcpSessionBinding;
    raw?: unknown;
  }> {
    this.assertConfigured();
    const binding = await this.sessionStore.get(input.remoteSessionId);
    if (!binding) {
      return {
        found: false,
        canceled: false,
      };
    }

    const canceled = await this.client.cancel({
      sessionId: binding.acpSessionId,
      reason: input.reason,
    });

    if (input.dropBinding) {
      await this.sessionStore.remove(input.remoteSessionId);
    }

    return {
      found: true,
      canceled: true,
      binding,
      raw: canceled.raw,
    };
  }

  private resolveTarget(primary?: string, fallback?: string): string {
    const fromPrimary = primary?.trim();
    if (fromPrimary) {
      return fromPrimary;
    }

    const fromFallback = fallback?.trim();
    if (fromFallback) {
      return fromFallback;
    }

    const fromDefault = this.defaultTarget.trim();
    if (fromDefault) {
      return fromDefault;
    }

    throw new Error('ACP target is missing. Provide target or set ACP_DEFAULT_TARGET.');
  }

  private assertConfigured(): void {
    if (!this.client.isConfigured()) {
      throw new Error('ACP bridge is not configured. Set ACP_BRIDGE_BASE_URL first.');
    }
  }
}
