import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight,
  ChatCircleDots,
  Check,
  FolderSimple,
  Globe,
  Plus,
  PuzzlePiece,
  Trash,
  UploadSimple,
} from '@phosphor-icons/react';
import type {
  CanvasConfigScope,
  CanvasSkillEntry,
  CanvasSkillInput,
} from '../../types';
import type { WorkspaceEntry } from '../../hooks/useWorkspaces';
import { useI18n } from '../../i18n';
import { subscribeCanvasSkillsChanged } from '../../utils/skillsEvents';
import { skillNameKey } from '../../../../shared/skill-name';
import { useAppShell } from '../AppShellProvider';
import { useRightDock } from '../RightDock';
import { Button, EmptyState, SegmentedControl, Select, TextField } from '../ui';
import { SkillEditorModal } from './SkillEditorModal';
import './index.css';

type ScopeView = 'effective' | 'workspace' | 'global';
type DisplaySkill = CanvasSkillEntry & {
  configScope: CanvasConfigScope;
  overridesGlobal: boolean;
};

interface Props {
  activeWorkspaceId: string;
  workspaces: WorkspaceEntry[];
  onSelectWorkspace: (workspaceId: string) => void;
}

export const SkillsLibrary = ({
  activeWorkspaceId,
  workspaces,
  onSelectWorkspace,
}: Props) => {
  const { t } = useI18n();
  const { notify, confirm } = useAppShell();
  const dock = useRightDock();
  const [scopeView, setScopeView] = useState<ScopeView>('effective');
  const [workspaceSkills, setWorkspaceSkills] = useState<CanvasSkillEntry[]>([]);
  const [globalSkills, setGlobalSkills] = useState<CanvasSkillEntry[]>([]);
  const [query, setQuery] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const loadSequenceRef = useRef(0);
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId);

  const load = useCallback(async () => {
    const sequence = ++loadSequenceRef.current;
    const [workspaceResult, globalResult] = await Promise.all([
      window.canvasWorkspace.canvasSkills.list({
        level: 'workspace',
        workspaceId: activeWorkspaceId,
      }),
      window.canvasWorkspace.canvasSkills.list({ level: 'global' }),
    ]);
    if (sequence !== loadSequenceRef.current) return;
    if (!workspaceResult.ok || !workspaceResult.status || !globalResult.ok || !globalResult.status) {
      notify({
        tone: 'error',
        title: t('skillsLibrary.loadFailed'),
        description: workspaceResult.error ?? globalResult.error,
      });
      return;
    }
    setWorkspaceSkills(workspaceResult.status.skills);
    setGlobalSkills(globalResult.status.skills);
  }, [activeWorkspaceId, notify, t]);

  useEffect(() => {
    void load();
    return subscribeCanvasSkillsChanged(() => void load());
  }, [load]);

  const displaySkills = useMemo<DisplaySkill[]>(() => {
    const globalNames = new Set(globalSkills.map((skill) => skillNameKey(skill.name)));
    const workspaceNames = new Set(workspaceSkills.map((skill) => skillNameKey(skill.name)));
    const local = workspaceSkills.map((skill) => ({
      ...skill,
      configScope: { level: 'workspace', workspaceId: activeWorkspaceId } as const,
      overridesGlobal: globalNames.has(skillNameKey(skill.name)),
    }));
    const global = globalSkills.map((skill) => ({
      ...skill,
      configScope: { level: 'global' } as const,
      overridesGlobal: false,
    }));
    const source = scopeView === 'workspace'
      ? local
      : scopeView === 'global'
        ? global
        : [...local, ...global.filter((skill) => !workspaceNames.has(skillNameKey(skill.name)))];
    const normalizedQuery = skillNameKey(query);
    return source.filter((skill) => (
      !normalizedQuery
      || skillNameKey(`${skill.name} ${skill.description} ${skill.source}`).includes(normalizedQuery)
    ));
  }, [activeWorkspaceId, globalSkills, query, scopeView, workspaceSkills]);

  const addToChat = (skill: CanvasSkillEntry) => {
    dock.addSkillToChat(activeWorkspaceId, skill.name);
    notify({ tone: 'success', title: t('skillsLibrary.addedToChat', { name: skill.name }) });
  };

  const promote = async (skill: DisplaySkill) => {
    if (skill.configScope.level !== 'workspace') return;
    const accepted = await confirm({
      title: t('skillsLibrary.promoteTitle', { name: skill.name }),
      description: t('skillsLibrary.promoteDescription'),
      confirmLabel: t('skillsLibrary.promoteConfirm'),
    });
    if (!accepted) return;
    const response = await window.canvasWorkspace.canvasSkills.promote(
      activeWorkspaceId,
      skill.name,
    );
    if (!response.ok || !response.result) {
      notify({ tone: 'error', title: t('skillsLibrary.promoteFailed'), description: response.error });
      return;
    }
    setWorkspaceSkills(response.result.workspaceStatus.skills);
    setGlobalSkills(response.result.globalStatus.skills);
    setScopeView('global');
    dock.closeSkill(skill.configScope, skill.name);
    dock.openSkill({ level: 'global' }, response.result.skill);
    notify({ tone: 'success', title: t('skillsLibrary.promoted', { name: skill.name }) });
  };

  const removeSkill = async (skill: DisplaySkill) => {
    const accepted = await confirm({
      title: t('skillsLibrary.removeTitle', { name: skill.name }),
      description: t('skillsLibrary.removeDescription'),
      confirmLabel: t('skillsLibrary.removeConfirm'),
    });
    if (!accepted) return;
    const response = await window.canvasWorkspace.canvasSkills.remove(
      skill.configScope,
      skill.name,
    );
    if (!response.ok || !response.status) {
      notify({ tone: 'error', title: t('skillsLibrary.removeFailed'), description: response.error });
      return;
    }
    if (skill.configScope.level === 'global') setGlobalSkills(response.status.skills);
    else setWorkspaceSkills(response.status.skills);
    dock.closeSkill(skill.configScope, skill.name);
    notify({ tone: 'success', title: t('skillsLibrary.removed', { name: skill.name }) });
  };

  const createSkill = async (target: CanvasConfigScope, skill: CanvasSkillInput) => {
    const response = await window.canvasWorkspace.canvasSkills.upsert(target, skill);
    if (!response.ok) {
      notify({ tone: 'error', title: response.error ?? t('skillsLibrary.loadFailed') });
      return false;
    }
    dock.closeSkill(target, skill.originalName ?? skill.name);
    dock.closeSkill(target, skill.name);
    setScopeView(target.level);
    await load();
    notify({ tone: 'success', title: t('skillsLibrary.created', { name: skill.name }) });
    return true;
  };

  const importZip = async (file: File) => {
    const target: CanvasConfigScope = scopeView === 'global'
      ? { level: 'global' }
      : { level: 'workspace', workspaceId: activeWorkspaceId };
    const response = await window.canvasWorkspace.canvasSkills.importZip(
      target,
      await file.arrayBuffer(),
    );
    if (!response.ok) {
      notify({ tone: 'error', title: t('skillsLibrary.importFailed'), description: response.error });
      return;
    }
    for (const entry of response.entries ?? []) dock.closeSkill(target, entry.name);
    await load();
    notify({
      tone: 'success',
      title: t('skillsLibrary.importDone', { count: response.entries?.length ?? 0 }),
    });
  };

  const chooseImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip,application/zip';
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) void importZip(file);
    };
    input.click();
  };

  const scopeOptions = [
    { id: 'effective', label: <><Check size={14} />{t('skillsLibrary.availableHere')} <small>{workspaceSkills.length + globalSkills.filter((skill) => !workspaceSkills.some((local) => skillNameKey(local.name) === skillNameKey(skill.name))).length}</small></> },
    { id: 'workspace', label: <><FolderSimple size={14} />{t('skillsLibrary.workspace')} <small>{workspaceSkills.length}</small></> },
    { id: 'global', label: <><Globe size={14} />{t('skillsLibrary.global')} <small>{globalSkills.length}</small></> },
  ];

  const heading = scopeView === 'effective'
    ? t('skillsLibrary.availableIn', { workspace: activeWorkspace?.name ?? '' })
    : scopeView === 'workspace'
      ? t('skillsLibrary.savedIn', { workspace: activeWorkspace?.name ?? '' })
      : t('skillsLibrary.availableEverywhere');

  return (
    <main className="skills-library">
      <header className="skills-library__header">
        <div>
          <span>{t('skillsLibrary.kicker')}</span>
          <h1>{t('skillsLibrary.title')}</h1>
          <p>{t('skillsLibrary.description')}</p>
        </div>
        <div className="skills-library__header-actions">
          <Button variant="secondary" onClick={chooseImport}>
            <UploadSimple size={16} />
            {t('skillsLibrary.import')}
          </Button>
          <Button variant="primary" onClick={() => setEditorOpen(true)}>
            <Plus size={16} />
            {t('skillsConfig.add')}
          </Button>
        </div>
      </header>

      <div className="skills-library__scope-bar">
        <Select
          value={activeWorkspaceId}
          ariaLabel={t('skillsLibrary.activeWorkspace')}
          className="skills-library__workspace-select"
          options={workspaces.map((workspace) => ({
            value: workspace.id,
            label: workspace.name,
            description: t('skillsLibrary.activeWorkspace'),
            icon: <FolderSimple size={15} />,
          }))}
          onChange={onSelectWorkspace}
        />
        <SegmentedControl
          ariaPattern="tab"
          ariaLabel={t('skillsLibrary.title')}
          value={scopeView}
          options={scopeOptions}
          onChange={(value) => setScopeView(value as ScopeView)}
          className="skills-library__scope-tabs"
        />
      </div>

      <TextField
        type="search"
        className="skills-library__search"
        placeholder={t('skillsConfig.search')}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      <div className="skills-library__list-heading">
        <strong>{heading}</strong>
        <span>{t('skillsLibrary.skillCount', { count: displaySkills.length })}</span>
      </div>

      {displaySkills.length === 0 ? (
        <EmptyState
          icon={<PuzzlePiece size={24} />}
          title={query ? t('skillsLibrary.noMatches') : t('skillsConfig.empty')}
        />
      ) : (
        <ul className="skills-library__list">
          {displaySkills.map((skill) => (
            <li key={`${skill.configScope.level}:${skill.path}`} className="skills-library__row">
              <Button
                variant="secondary"
                className="skills-library__row-main"
                onClick={() => dock.openSkill(skill.configScope, skill)}
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
                  onClick={() => addToChat(skill)}
                >
                  <ChatCircleDots size={16} />
                </Button>
                {skill.configScope.level === 'workspace' && skill.writable && (
                  <Button
                    variant="icon"
                    size="md"
                    aria-label={t('skillsLibrary.promoteToGlobal', { name: skill.name })}
                    title={t('skillsLibrary.promoteToGlobal', { name: skill.name })}
                    onClick={() => void promote(skill)}
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
                    onClick={() => void removeSkill(skill)}
                  >
                    <Trash size={16} />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <SkillEditorModal
        open={editorOpen}
        workspaceScope={{ level: 'workspace', workspaceId: activeWorkspaceId }}
        initialScope={scopeView === 'global'
          ? { level: 'global' }
          : { level: 'workspace', workspaceId: activeWorkspaceId }}
        onClose={() => setEditorOpen(false)}
        onCreate={createSkill}
      />
    </main>
  );
};
