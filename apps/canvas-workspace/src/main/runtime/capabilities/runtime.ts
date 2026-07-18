import { z } from 'zod';

import {
  CapabilityError,
  type CapabilityCallResult,
  type CapabilityContext,
  type AnyCapabilityDefinition,
  type CapabilityDescriptor,
  type CapabilityActor,
  type CapabilityPolicy,
} from './types';

export class CapabilityRuntime {
  private readonly definitions = new Map<string, AnyCapabilityDefinition>();

  constructor(
    definitions: Iterable<AnyCapabilityDefinition>,
    private readonly policy: CapabilityPolicy = () => true,
  ) {
    for (const definition of definitions) {
      if (this.definitions.has(definition.name)) {
        throw new Error(`Duplicate capability: ${definition.name}`);
      }
      this.definitions.set(definition.name, definition);
    }
  }

  list(actor: CapabilityActor): CapabilityDescriptor[] {
    return Array.from(this.definitions.values(), (definition) => this.describe(definition))
      .filter((descriptor) => this.policy(descriptor, actor));
  }

  async call(
    name: string,
    input: unknown,
    context: CapabilityContext,
  ): Promise<CapabilityCallResult> {
    const definition = this.definitions.get(name);
    if (!definition) {
      return {
        ok: false,
        error: { code: 'capability_not_found', message: `Unknown capability: ${name}` },
      };
    }
    const descriptor = this.describe(definition);
    if (!this.policy(descriptor, context.actor)) {
      return {
        ok: false,
        error: {
          code: 'capability_forbidden',
          message: `Actor ${context.actor.kind} cannot call capability ${name}`,
        },
      };
    }
    if (!context.workspaceId.trim()) {
      return {
        ok: false,
        error: { code: 'invalid_context', message: 'workspaceId is required' },
      };
    }
    if (context.abortSignal?.aborted) {
      return {
        ok: false,
        error: { code: 'aborted', message: 'Capability call was aborted' },
      };
    }

    const parsed = await definition.inputSchema.safeParseAsync(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: {
          code: 'invalid_input',
          message: parsed.error.message,
          details: parsed.error.issues,
        },
      };
    }

    try {
      return { ok: true, value: await definition.execute(parsed.data, context) };
    } catch (error) {
      if (error instanceof CapabilityError) {
        return {
          ok: false,
          error: {
            code: error.code,
            message: error.message,
            ...(error.details === undefined ? {} : { details: error.details }),
          },
        };
      }
      return {
        ok: false,
        error: {
          code: 'execution_failed',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  private describe(definition: AnyCapabilityDefinition): CapabilityDescriptor {
    return {
      name: definition.name,
      description: definition.description,
      risk: definition.risk,
      inputSchema: z.toJSONSchema(definition.inputSchema),
    };
  }
}
