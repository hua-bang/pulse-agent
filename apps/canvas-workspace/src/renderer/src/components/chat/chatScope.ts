import { scopeSessionStoreId } from '../../../../shared/agent-chat';
import type { AgentScope } from './types';

export const chatScopeId = (scope: AgentScope): string => scopeSessionStoreId(scope);
