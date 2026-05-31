/**
 * Settings — unified global settings drawer.
 *
 * Replaces the standalone ModelSettingsDrawer and PromptSettingsDrawer
 * (they're now rendered as sections inside this one shell). Entry points:
 *  - Sidebar gear (bottom of the workspace list)
 *  - Chat header buttons (Reply Style / Models) — they call openSettings
 *    with the matching section instead of opening their own drawer.
 *
 * State note: each section's data hook (useCanvasModels, usePromptProfile)
 * is owned here; the chat-side instances stay independent. The codebase
 * already accepted that staleness model (chat panel and chat page each
 * had their own instance), and unifying via context can come later if it
 * becomes a real problem.
 */

import { useEffect, useState } from 'react';
import { SettingsDrawer } from '../SettingsDrawer';
import { ModelsSection, useCanvasModels } from '../chat/ModelSettings';
import { ReplyStyleSection, usePromptProfile } from '../chat/PromptSettings';
import { AgentSection } from './AgentSection';
import { ExperimentalSection } from './ExperimentalSection';
import { LanguageSection } from './LanguageSection';
import { SkillsManager } from '../settings-config/SkillsManager';
import { McpManager } from '../settings-config/McpManager';
import { useI18n, type I18nKey } from '../../i18n';
import './index.css';

export type SettingsSection = 'models' | 'reply-style' | 'agent' | 'skills' | 'mcp' | 'experimental' | 'language';

const GLOBAL_SCOPE = { level: 'global' } as const;

interface SectionDef {
  id: SettingsSection;
  labelKey: I18nKey;
  descriptionKey: I18nKey;
  titleKey: I18nKey;
}

const SECTIONS: SectionDef[] = [
  {
    id: 'models',
    labelKey: 'settings.models.label',
    descriptionKey: 'settings.models.description',
    titleKey: 'settings.models.title',
  },
  {
    id: 'reply-style',
    labelKey: 'settings.replyStyle.label',
    descriptionKey: 'settings.replyStyle.description',
    titleKey: 'settings.replyStyle.title',
  },
  {
    id: 'agent',
    labelKey: 'settings.agent.label',
    descriptionKey: 'settings.agent.description',
    titleKey: 'settings.agent.title',
  },
  {
    id: 'skills',
    labelKey: 'settings.skills.label',
    descriptionKey: 'settings.skills.description',
    titleKey: 'settings.skills.title',
  },
  {
    id: 'mcp',
    labelKey: 'settings.mcp.label',
    descriptionKey: 'settings.mcp.description',
    titleKey: 'settings.mcp.title',
  },
  {
    id: 'experimental',
    labelKey: 'settings.experimental.label',
    descriptionKey: 'settings.experimental.description',
    titleKey: 'settings.experimental.title',
  },
  {
    id: 'language',
    labelKey: 'settings.language.label',
    descriptionKey: 'settings.language.description',
    titleKey: 'settings.language.title',
  },
];

interface SettingsProps {
  open: boolean;
  initialSection: SettingsSection;
  onClose: () => void;
}

export const Settings = ({ open, initialSection, onClose }: SettingsProps) => {
  const { t } = useI18n();
  const [activeSection, setActiveSection] = useState<SettingsSection>(initialSection);
  const canvasModels = useCanvasModels();
  const promptProfile = usePromptProfile();

  // Re-sync the active section every time the drawer opens with a
  // (potentially different) target. While open, the user drives section
  // changes via the rail.
  useEffect(() => {
    if (open) setActiveSection(initialSection);
  }, [open, initialSection]);

  const activeDef = SECTIONS.find((s) => s.id === activeSection) ?? SECTIONS[0];

  return (
    <SettingsDrawer
      open={open}
      onClose={onClose}
      kicker={t('settings.kicker')}
      title={t(activeDef.titleKey)}
      ariaLabel={t('settings.ariaLabel')}
      width={1000}
    >
      <div className="settings-body">
        <nav className="settings-rail" aria-label={t('settings.sectionsAria')}>
          {SECTIONS.map((section) => {
            const active = section.id === activeSection;
            return (
              <button
                key={section.id}
                type="button"
                className={`settings-rail-item${active ? ' settings-rail-item--active' : ''}`}
                aria-current={active ? 'page' : undefined}
                onClick={() => setActiveSection(section.id)}
              >
                <span className="settings-rail-label">{t(section.labelKey)}</span>
                <span className="settings-rail-desc">{t(section.descriptionKey)}</span>
              </button>
            );
          })}
        </nav>
        <div className="settings-content">
          {activeSection === 'models' && (
            <ModelsSection
              status={canvasModels.status}
              error={canvasModels.error}
              onClose={onClose}
              onSaveProvider={canvasModels.upsertProvider}
              onRemoveProvider={canvasModels.removeProvider}
              onFetchModels={canvasModels.fetchModels}
            />
          )}
          {activeSection === 'reply-style' && (
            <ReplyStyleSection
              profile={promptProfile.profile}
              error={promptProfile.error}
              onClose={onClose}
              onSave={promptProfile.save}
              onReset={promptProfile.reset}
            />
          )}
          {activeSection === 'agent' && <AgentSection onClose={onClose} />}
          {activeSection === 'skills' && (
            <div className="cfg-pane">
              <SkillsManager scope={GLOBAL_SCOPE} />
            </div>
          )}
          {activeSection === 'mcp' && (
            <div className="cfg-pane">
              <McpManager scope={GLOBAL_SCOPE} />
            </div>
          )}
          {activeSection === 'experimental' && <ExperimentalSection onClose={onClose} />}
          {activeSection === 'language' && <LanguageSection />}
        </div>
      </div>
    </SettingsDrawer>
  );
};
