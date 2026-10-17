import type { AgentContextSkillRef } from '../../../shared/settings-config';
import { promptLabel } from './scheduled-task-context';

/** Names the skills open beside the chat, so "this skill" resolves. */
export function formatSkillContextBlock(skills: AgentContextSkillRef[] = []): string {
  if (skills.length === 0) return '';
  return [
    '',
    '## Skills In Context',
    'The user has these skills open. "This skill" means them. Read the SKILL.md before you explain or change one:',
    ...skills.map(skill => `- **${promptLabel(skill.name)}** (${skill.scope}, \`${promptLabel(skill.path)}\`)`),
    '',
  ].join('\n');
}
