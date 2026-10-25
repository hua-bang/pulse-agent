/**
 * Settings — unified global settings page (`/settings?section=…`).
 *
 * One full page with the section rail on the left. Entry points:
 *  - The app rail gear
 *  - Chat header buttons (Reply Style / Models) — they call openSettings
 *    with the matching section instead of opening their own surface.
 *
 * State note: each section's data hook (useCanvasModels, usePromptProfile)
 * is owned here; the chat-side instances stay independent. The codebase
 * already accepted that staleness model (chat panel and chat page each
 * had their own instance), and unifying via context can come later if it
 * becomes a real problem.
 */

import { useEffect, useState } from 'react';
import { Button, SegmentedControl } from '../../../../components/ui';
import { ModelsSection } from '../ModelSettings';
import { useCanvasModels } from '../../../models';
import { ReplyStyleSection, usePromptProfile } from '../PromptSettings';
import { AgentSection } from './AgentSection';
import { AppearanceSection } from './AppearanceSection';
import { BrowserSection } from './BrowserSection';
import { BuiltInToolsSection } from './BuiltInToolsSection';
import { ExperimentalSection } from './ExperimentalSection';
import { LanguageSection } from './LanguageSection';
import { TelemetrySection } from './TelemetrySection';
import { UpdateSection } from './UpdateSection';
import { McpManager } from '../settings-config/McpManager';
import { PluginsManager } from '../settings-config/PluginsManager';
import { useI18n, type I18nKey } from '../../../../i18n';
import { runViewTransition } from '../../../../shared/viewTransition';
import { usePageEscape } from '../../../../hooks/usePageEscape';
import './index.css';

type SettingsPage = 'models' | 'chat' | 'agent' | 'tools-integrations' | 'general' | 'experimental';
type ChatSettingsTab = 'reply-style' | 'chat-roles';
type ToolsSettingsTab = 'built-in-tools' | 'mcp' | 'plugins';

export type SettingsSection = SettingsPage | ChatSettingsTab | ToolsSettingsTab | 'browser' | 'updates' | 'language';

const GLOBAL_SCOPE = { level: 'global' } as const;

interface SectionDef {
  id: SettingsPage;
  labelKey: I18nKey;
  descriptionKey: I18nKey;
  titleKey: I18nKey;
}

interface SectionGroup {
  id: string;
  labelKey: I18nKey;
  sections: SectionDef[];
}

const SECTION_GROUPS: SectionGroup[] = [
  {
    id: 'ai-chat',
    labelKey: 'settings.group.aiChat',
    sections: [
      {
        id: 'models',
        labelKey: 'settings.models.label',
        descriptionKey: 'settings.models.description',
        titleKey: 'settings.models.title',
      },
      {
        id: 'chat',
        labelKey: 'settings.chat.label',
        descriptionKey: 'settings.chat.description',
        titleKey: 'settings.chat.title',
      },
    ],
  },
  {
    id: 'agents-extensions',
    labelKey: 'settings.group.agentsExtensions',
    sections: [
      {
        id: 'agent',
        labelKey: 'settings.agent.label',
        descriptionKey: 'settings.agent.description',
        titleKey: 'settings.agent.title',
      },
      {
        id: 'tools-integrations',
        labelKey: 'settings.toolsIntegrations.label',
        descriptionKey: 'settings.toolsIntegrations.description',
        titleKey: 'settings.toolsIntegrations.title',
      },
    ],
  },
  {
    id: 'app',
    labelKey: 'settings.group.app',
    sections: [
      {
        id: 'general',
        labelKey: 'settings.general.label',
        descriptionKey: 'settings.general.description',
        titleKey: 'settings.general.title',
      },
      {
        id: 'experimental',
        labelKey: 'settings.experimental.label',
        descriptionKey: 'settings.experimental.description',
        titleKey: 'settings.experimental.title',
      },
    ],
  },
];

const SECTIONS = SECTION_GROUPS.flatMap((group) => group.sections);

interface SettingsTarget {
  page: SettingsPage;
  toolsTab?: ToolsSettingsTab;
}

const resolveSettingsTarget = (section: SettingsSection): SettingsTarget => {
  if (section === 'reply-style' || section === 'chat-roles') {
    return { page: 'chat' };
  }
  if (section === 'built-in-tools' || section === 'mcp' || section === 'plugins') {
    return { page: 'tools-integrations', toolsTab: section };
  }
  if (section === 'browser' || section === 'language' || section === 'updates') {
    return { page: 'general' };
  }
  // A stale or hand-typed `?section=` falls back to the first page.
  return SECTIONS.some((def) => def.id === section) ? { page: section } : { page: 'models' };
};

interface SettingsProps {
  initialSection: SettingsSection;
  /** Leaves the page; sections also call it after a finished edit. */
  onClose: () => void;
}

export const Settings = ({ initialSection, onClose }: SettingsProps) => {
  const { t } = useI18n();
  const initialTarget = resolveSettingsTarget(initialSection);
  const [activePage, setActivePage] = useState<SettingsPage>(initialTarget.page);
  const [toolsTab, setToolsTab] = useState<ToolsSettingsTab>(initialTarget.toolsTab ?? 'built-in-tools');
  const canvasModels = useCanvasModels();
  const promptProfile = usePromptProfile();

  // Re-sync when an entry point asks for another section. Otherwise the
  // user drives section changes via the rail.
  useEffect(() => {
    const target = resolveSettingsTarget(initialSection);
    setActivePage(target.page);
    if (target.toolsTab) setToolsTab(target.toolsTab);
  }, [initialSection]);

  // Escape leaves the page like its close button. Dialogs opened from a
  // section close first: their capture-phase `useEscapeClose` consumes it.
  usePageEscape(true, onClose);

  const activeDef = SECTIONS.find((s) => s.id === activePage) ?? SECTIONS[0];

  return (
    <section className="settings-page" aria-label={t('settings.ariaLabel')}>
      <div className="settings-body">
        <nav className="settings-rail" aria-label={t('settings.sectionsAria')}>
          <h1 className="settings-rail-heading">{t('settings.kicker')}</h1>
          {SECTION_GROUPS.map((group) => {
            const groupTitleId = `settings-group-${group.id}`;
            return (
              <div
                key={group.id}
                className="settings-rail-group"
                role="group"
                aria-labelledby={groupTitleId}
              >
                <div id={groupTitleId} className="settings-rail-group-title">
                  {t(group.labelKey)}
                </div>
                <div className="settings-rail-group-items">
                  {group.sections.map((section) => {
                    const active = section.id === activePage;
                    return (
                      <button
                        key={section.id}
                        type="button"
                        className={`settings-rail-item${active ? ' settings-rail-item--active' : ''}`}
                        aria-current={active ? 'page' : undefined}
                        title={t(section.descriptionKey)}
                        onClick={() => runViewTransition(() => setActivePage(section.id))}
                      >
                        <span className="settings-rail-label">{t(section.labelKey)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>
        <div className="settings-content">
          <header className="settings-content-header">
            <div className="settings-content-heading">
              <h2>{t(activeDef.titleKey)}</h2>
              <p>{t(activeDef.descriptionKey)}</p>
            </div>
            <Button
              variant="icon"
              size="sm"
              onClick={onClose}
              title={t('shell.close')}
              aria-label={t('shell.close')}
            >
              ×
            </Button>
          </header>
          {activePage === 'models' && (
            <ModelsSection
              status={canvasModels.status}
              error={canvasModels.error}
              onClose={onClose}
              onSaveProvider={canvasModels.upsertProvider}
              onRemoveProvider={canvasModels.removeProvider}
              onFetchModels={canvasModels.fetchModels}
            />
          )}
          {activePage === 'chat' && (
            <ReplyStyleSection
              profile={promptProfile.profile}
              error={promptProfile.error}
              onClose={onClose}
              onSave={promptProfile.save}
              onReset={promptProfile.reset}
            />
          )}
          {activePage === 'agent' && <AgentSection onClose={onClose} />}
          {activePage === 'tools-integrations' && (
            <div className="settings-merged-page">
              <div className="settings-merged-tabs">
                <SegmentedControl
                  options={[
                    { id: 'built-in-tools', label: t('settings.builtInTools.label') },
                    { id: 'mcp', label: t('settings.mcp.label') },
                    { id: 'plugins', label: t('settings.plugins.label') },
                  ]}
                  value={toolsTab}
                  onChange={(id) => setToolsTab(id as ToolsSettingsTab)}
                  ariaPattern="tab"
                  ariaLabel={t('settings.toolsIntegrations.tabsAria')}
                />
              </div>
              <div className="settings-merged-content">
                {toolsTab === 'built-in-tools' && <BuiltInToolsSection onClose={onClose} />}
                {toolsTab === 'mcp' && (
                  <div className="cfg-pane">
                    <McpManager scope={GLOBAL_SCOPE} />
                  </div>
                )}
                {toolsTab === 'plugins' && (
                  <div className="cfg-pane">
                    <PluginsManager />
                  </div>
                )}
              </div>
            </div>
          )}
          {activePage === 'general' && (
            <div className="settings-general-page">
              <AppearanceSection />
              <BrowserSection />
              <LanguageSection />
              <UpdateSection />
              <TelemetrySection />
            </div>
          )}
          {activePage === 'experimental' && <ExperimentalSection onClose={onClose} />}
        </div>
      </div>
    </section>
  );
};
