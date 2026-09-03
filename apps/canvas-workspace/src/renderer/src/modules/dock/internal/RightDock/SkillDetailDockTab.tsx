import {
  ArrowSquareOut,
  ArrowUpRight,
  ChatCircleDots,
  FileText,
  FolderSimple,
  Globe,
} from '@phosphor-icons/react';
import type { CanvasSkillEntry } from '../../../../types';
import { useI18n } from '../../../../i18n';
import { notifyCanvasSkillsChanged } from '../../../../utils/skillsEvents';
import { useAppShell } from '../../../../shared/appShell';
import { Button } from '../../../../components/ui';
import type { DockPreviewTab } from './dock-store';
import { SkillMarkdown } from './SkillMarkdown';
import './skill-detail.css';

interface Props {
  tab: Extract<DockPreviewTab, { kind: 'skill' }>;
  activeWorkspaceId: string;
  workspaceName?: string;
  onStartChat: (workspaceId: string, skillName: string) => void;
  onPromoted: (skill: CanvasSkillEntry) => void;
}

export const SkillDetailDockTab = ({
  tab,
  activeWorkspaceId,
  workspaceName,
  onStartChat,
  onPromoted,
}: Props) => {
  const { t } = useI18n();
  const { confirm, notify } = useAppShell();
  const { skill, scope } = tab;
  const workspaceSkill = scope.level === 'workspace' && skill.writable;

  const promote = async () => {
    if (scope.level !== 'workspace') return;
    const accepted = await confirm({
      title: t('skillsLibrary.promoteTitle', { name: skill.name }),
      description: t('skillsLibrary.promoteDescription'),
      confirmLabel: t('skillsLibrary.promoteConfirm'),
    });
    if (!accepted) return;
    const response = await window.canvasWorkspace.canvasSkills.promote(
      scope.workspaceId,
      skill.name,
    );
    if (!response.ok || !response.result) {
      notify({
        tone: 'error',
        title: t('skillsLibrary.promoteFailed'),
        description: response.error,
      });
      return;
    }
    notify({
      tone: 'success',
      title: t('skillsLibrary.promoted', { name: skill.name }),
    });
    notifyCanvasSkillsChanged();
    onPromoted(response.result.skill);
  };

  const openSkillFile = async (path = skill.path) => {
    const response = await window.canvasWorkspace.file.openInVSCode(path);
    if (!response.ok) {
      notify({
        tone: 'error',
        title: t('skillsLibrary.openFailed'),
        description: response.error,
      });
    }
  };

  return (
    <div className="skill-detail">
      <div className="skill-detail__scroll">
        <div className="skill-detail__body">
          <span className="skill-detail__kicker">{t('skillsLibrary.detailKicker')}</span>
          <h1 className="skill-detail__title">{skill.name}</h1>
          <p className="skill-detail__description">{skill.description}</p>

          <section className="skill-detail__section">
            <span className="skill-detail__label">{t('skillsLibrary.location')}</span>
            <div className="skill-detail__location">
              {scope.level === 'global' ? <Globe size={18} /> : <FolderSimple size={18} />}
              <span>
                <strong>
                  {scope.level === 'global'
                    ? t('skillsConfig.globalScope')
                    : workspaceName ?? t('skillsLibrary.activeWorkspace')}
                </strong>
                <small>{skill.path}</small>
              </span>
            </div>
          </section>

          {workspaceSkill && (
            <section className="skill-detail__promote">
              <Globe size={18} />
              <span>
                <strong>{t('skillsLibrary.makeGlobal')}</strong>
                <small>{t('skillsLibrary.makeGlobalHint')}</small>
              </span>
              <Button variant="secondary" size="xs" onClick={() => void promote()}>
                <ArrowUpRight size={13} />
                {t('skillsLibrary.promote')}
              </Button>
            </section>
          )}

          <section className="skill-detail__section">
            <span className="skill-detail__label">{t('skillsLibrary.content')}</span>
            <div className="skill-detail__content">
              <SkillMarkdown content={skill.body || t('skillsLibrary.emptyBody')} />
            </div>
          </section>

          <section className="skill-detail__section">
            <span className="skill-detail__label">{t('skillsLibrary.resources')}</span>
            <div className="skill-detail__resource-list">
              <Button
                variant="secondary"
                className="skill-detail__resource"
                aria-label={`${t('skillsLibrary.open')} SKILL.md`}
                onClick={() => void openSkillFile()}
              >
                <FileText size={15} />
                <span>
                  <strong>SKILL.md</strong>
                  <small>{t('skillsLibrary.primaryInstructions')}</small>
                </span>
                <ArrowSquareOut size={14} aria-hidden="true" />
              </Button>
              {skill.resources?.map((resource) => (
                <Button
                  key={resource.path}
                  variant="secondary"
                  className="skill-detail__resource"
                  aria-label={`${t('skillsLibrary.open')} ${resource.name}`}
                  title={resource.path}
                  onClick={() => void openSkillFile(resource.path)}
                >
                  <FileText size={15} />
                  <span>
                    <strong>{resource.name}</strong>
                    <small>{t('skillsLibrary.bundledResource')}</small>
                  </span>
                  <ArrowSquareOut size={14} aria-hidden="true" />
                </Button>
              ))}
            </div>
          </section>
        </div>
      </div>

      <div className="skill-detail__actions">
        <Button variant="secondary" onClick={() => void openSkillFile()}>
          <FileText size={15} />
          {t('skillsLibrary.openSkillMd')}
        </Button>
        <Button
          variant="primary"
          onClick={() => onStartChat(
            scope.level === 'workspace' ? scope.workspaceId : activeWorkspaceId,
            skill.name,
          )}
        >
          <ChatCircleDots size={15} />
          {t('skillsLibrary.startChat')}
        </Button>
      </div>
    </div>
  );
};
