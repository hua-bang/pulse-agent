import {
  ArrowUpRight,
  ChatCircleDots,
  PuzzlePiece,
  Trash,
} from '@phosphor-icons/react';
import { useI18n } from '../../i18n';
import { Button, EmptyState } from '../ui';
import type { DisplaySkill } from './types';

interface Props {
  skills: DisplaySkill[];
  query: string;
  onOpen: (skill: DisplaySkill) => void;
  onAddToChat: (skill: DisplaySkill) => void;
  onPromote: (skill: DisplaySkill) => void;
  onRemove: (skill: DisplaySkill) => void;
}

export const SkillList = ({
  skills,
  query,
  onOpen,
  onAddToChat,
  onPromote,
  onRemove,
}: Props) => {
  const { t } = useI18n();

  return (
    <div className="skills-library__list-scroll">
      {skills.length === 0 ? (
        <EmptyState
          icon={<PuzzlePiece size={24} />}
          title={query ? t('skillsLibrary.noMatches') : t('skillsConfig.empty')}
        />
      ) : (
        <ul className="skills-library__list">
          {skills.map((skill) => (
            <li key={`${skill.configScope.level}:${skill.path}`} className="skills-library__row">
              <Button
                variant="secondary"
                className="skills-library__row-main"
                onClick={() => onOpen(skill)}
              >
                <span>
                  <strong>{skill.name}</strong>
                  <small>{skill.source}</small>
                  {skill.overridesGlobal && <em>{t('skillsLibrary.overridesGlobal')}</em>}
                </span>
                <p>{skill.description}</p>
              </Button>
              <div className="skills-library__row-actions">
                <Button
                  variant="icon"
                  size="md"
                  aria-label={t('skillsLibrary.addToChat')}
                  title={t('skillsLibrary.addToChat')}
                  onClick={() => onAddToChat(skill)}
                >
                  <ChatCircleDots size={16} />
                </Button>
                {skill.configScope.level === 'workspace' && skill.writable && (
                  <Button
                    variant="icon"
                    size="md"
                    aria-label={t('skillsLibrary.promoteToGlobal', { name: skill.name })}
                    title={t('skillsLibrary.promoteToGlobal', { name: skill.name })}
                    onClick={() => onPromote(skill)}
                  >
                    <ArrowUpRight size={16} />
                  </Button>
                )}
                {skill.writable && (
                  <Button
                    variant="icon"
                    size="md"
                    aria-label={t('skillsLibrary.removeTitle', { name: skill.name })}
                    title={t('skillsLibrary.removeTitle', { name: skill.name })}
                    onClick={() => onRemove(skill)}
                  >
                    <Trash size={16} />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
