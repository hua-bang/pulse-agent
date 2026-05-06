import type { PulseAgent } from 'pulse-coder-engine';

interface SkillSummary {
  name: string;
  description: string;
}

interface SkillRegistryService {
  getAll: () => SkillSummary[];
  get: (name: string) => SkillSummary | undefined;
}

export class SkillCommands {
  constructor(
    private agent: PulseAgent,
    private readonly log: (message?: string) => void = console.log,
  ) {}

  async transformSkillsCommandToMessage(args: string[]): Promise<string | null> {
    const registry = this.getSkillRegistry();
    if (!registry) {
      this.log('\n⚠️ skill registry unavailable. Ensure built-in skills plugin is enabled.');
      return null;
    }

    const skills = this.getAvailableSkills();
    if (skills.length === 0) {
      this.log('\n📭 No skills found. Add SKILL.md under .pulse-coder/skills/**/SKILL.md');
      return null;
    }

    const subCommand = args[0]?.toLowerCase();

    if (!subCommand || subCommand === 'list') {
      this.printSkillList(skills);
      this.log('\nUsage: /skills <name|index> <message>');
      return null;
    }

    if (subCommand === 'current' || subCommand === 'clear' || subCommand === 'off' || subCommand === 'none') {
      this.log('\nℹ️ Skills are single-use. Use /skills <name|index> <message> to run one prompt with a skill.');
      return null;
    }

    let selectionTokens = args;
    if (subCommand === 'use') {
      selectionTokens = args.slice(1);
    }

    if (selectionTokens.length < 2) {
      this.log('\n❌ Please provide both a skill and a message.');
      this.log('Usage: /skills <name|index> <message>');
      return null;
    }

    const skillTarget = selectionTokens[0];
    const selectedSkill = this.resolveSkillSelection(skillTarget, skills);
    if (!selectedSkill) {
      this.log(`\n❌ Skill not found: ${skillTarget}`);
      this.log('Run /skills list to see available skills.');
      return null;
    }

    const message = selectionTokens.slice(1).join(' ').trim();
    if (!message) {
      this.log('\n❌ Message cannot be empty.');
      this.log('Usage: /skills <name|index> <message>');
      return null;
    }

    const transformed = `[use skill](${selectedSkill.name}) ${message}`;
    this.log(`\n✅ One-shot skill message prepared with: ${selectedSkill.name}`);
    return transformed;
  }

  private printSkillList(skills: SkillSummary[]): void {
    this.log('\n🧰 Available skills:');
    skills.forEach((skill, index) => {
      this.log(`${String(index + 1).padStart(2, ' ')}. ${skill.name} - ${skill.description}`);
    });
  }

  private getSkillRegistry(): SkillRegistryService | undefined {
    return this.agent.getService<SkillRegistryService>('skillRegistry');
  }

  private getAvailableSkills(): SkillSummary[] {
    const registry = this.getSkillRegistry();
    if (!registry) {
      return [];
    }

    return [...registry.getAll()].sort((a, b) => a.name.localeCompare(b.name));
  }

  private resolveSkillSelection(target: string, skills: SkillSummary[]): SkillSummary | null {
    const trimmed = target.trim();
    if (!trimmed) {
      return null;
    }

    if (/^\d+$/.test(trimmed)) {
      const index = Number.parseInt(trimmed, 10);
      if (index >= 1 && index <= skills.length) {
        return skills[index - 1];
      }
      return null;
    }

    const lower = trimmed.toLowerCase();
    const exact = skills.find((skill) => skill.name.toLowerCase() === lower);
    if (exact) {
      return exact;
    }

    const fuzzy = skills.filter((skill) => skill.name.toLowerCase().includes(lower));
    if (fuzzy.length === 1) {
      return fuzzy[0];
    }

    return null;
  }
}
