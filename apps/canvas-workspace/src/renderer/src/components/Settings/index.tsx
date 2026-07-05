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

import './index.css';
import { useEffect, useState } from 'react';
import { SettingsDrawer } from '../SettingsDrawer';
import { ModelsSection, useCanvasModels } from '../chat/ModelSettings';
import { ReplyStyleSection, usePromptProfile } from '../chat/PromptSettings';
import { AgentSection } from './AgentSection';
import { BuiltInToolsSection } from './BuiltInToolsSection';
import { ExperimentalSection } from './ExperimentalSection';
import { LanguageSection } from './LanguageSection';
import { UpdateSection } from './UpdateSection';
import { SkillsManager } from '../settings-config/SkillsManager';
import { McpManager } from '../settings-config/McpManager';
import { PluginsManager } from '../settings-config/PluginsManager';
import { useI18n, type I18nKey } from '../../i18n';

export type SettingsSection = 'models' | 'built-in-tools' | 'reply-style' | 'agent' | 'skills' | 'mcp' | 'plugins' | 'experimental' | 'updates' | 'language';

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
    id: 'built-in-tools',
    labelKey: 'settings.builtInTools.label',
    descriptionKey: 'settings.builtInTools.description',
    titleKey: 'settings.builtInTools.title',
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
    id: 'plugins',
    labelKey: 'settings.plugins.label',
    descriptionKey: 'settings.plugins.description',
    titleKey: 'settings.plugins.title',
  },
  {
    id: 'experimental',
    labelKey: 'settings.experimental.label',
    descriptionKey: 'settings.experimental.description',
    titleKey: 'settings.experimental.title',
  },
  {
    id: 'updates',
    labelKey: 'settings.updates.label',
    descriptionKey: 'settings.updates.description',
    titleKey: 'settings.updates.title',
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
          {activeSection === 'built-in-tools' && <BuiltInToolsSection onClose={onClose} />}
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
          {activeSection === 'plugins' && (
            <div className="cfg-pane">
              <PluginsManager />
            </div>
          )}
          {activeSection === 'experimental' && <ExperimentalSection onClose={onClose} />}
          {activeSection === 'updates' && <UpdateSection />}
          {activeSection === 'language' && <LanguageSection />}
        </div>
      </div>
    </SettingsDrawer>
  );
};
