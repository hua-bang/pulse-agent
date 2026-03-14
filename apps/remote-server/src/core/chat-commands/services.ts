import { ACP_SERVICE_NAME } from 'pulse-coder-acp';
import type { AcpBridgeService } from 'pulse-coder-acp';
import { engine } from '../engine-singleton.js';
import type { SkillRegistryService, SoulService } from './types.js';

export function getSkillRegistry(): SkillRegistryService | undefined {
  return engine.getService<SkillRegistryService>('skillRegistry');
}

export function getSoulService(): SoulService | undefined {
  return engine.getService<SoulService>('soulService');
}

export function getAcpService(): AcpBridgeService | undefined {
  return engine.getService<AcpBridgeService>(ACP_SERVICE_NAME);
}
