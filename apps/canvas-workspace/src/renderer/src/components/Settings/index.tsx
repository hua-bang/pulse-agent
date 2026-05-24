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
import './index.css';

export type SettingsSection = 'models' | 'reply-style' | 'agent';

interface SectionDef {
  id: SettingsSection;
  label: string;
  description: string;
  title: string;
}

const SECTIONS: SectionDef[] = [
  {
    id: 'models',
    label: 'Models',
    description: 'Providers, API keys, current model',
    title: 'Models & Providers',
  },
  {
    id: 'reply-style',
    label: 'Reply Style',
    description: 'Preset + custom prompt',
    title: 'Reply Style & Custom Prompt',
  },
  {
    id: 'agent',
    label: 'Agent',
    description: 'Skills & external agent setup',
    title: 'Agent',
  },
];

interface SettingsProps {
  open: boolean;
  initialSection: SettingsSection;
  onClose: () => void;
}

export const Settings = ({ open, initialSection, onClose }: SettingsProps) => {
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
      kicker="Settings"
      title={activeDef.title}
      ariaLabel="Settings"
      width={1000}
    >
      <div className="settings-body">
        <nav className="settings-rail" aria-label="Settings sections">
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
                <span className="settings-rail-label">{section.label}</span>
                <span className="settings-rail-desc">{section.description}</span>
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
        </div>
      </div>
    </SettingsDrawer>
  );
};
