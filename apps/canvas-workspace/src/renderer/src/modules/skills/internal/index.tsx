import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  FolderSimple,
  Globe,
} from '@phosphor-icons/react';
import type {
  CanvasConfigScope,
  CanvasSkillEntry,
  CanvasSkillInput,
} from '../../../types';
import type { WorkspaceEntry } from '../../../hooks/useWorkspaces';
import { useI18n } from '../../../i18n';
import { subscribeCanvasSkillsChanged } from '../../../utils/skillsEvents';
import { skillNameKey } from '../../../../../shared/skill-name';
import { useAppShell } from '../../../shared/appShell';
import { useRightDock } from '../../../shared/dockPort';
import { SegmentedControl, TextField } from '../../../components/ui';
import { SkillEditorModal } from './SkillEditorModal';
import { LibraryContextSelect } from './LibraryContextSelect';
import { SkillList } from './SkillList';
import { SkillsLibraryLoading } from './SkillsLibraryLoading';
import { SkillsLibraryHeader } from './SkillsLibraryHeader';
import { SkillsLibraryTabs } from './SkillsLibraryTabs';
import type { DisplaySkill, LibraryContext, ScopeView } from './types';
import './index.css';
interface Props {
  activeWorkspaceId: string;
  workspaces: WorkspaceEntry[];
  onSelectWorkspace: (workspaceId: string) => void;
  onNavigatePlugins: () => void;
}

export const SkillsLibrary = ({
  activeWorkspaceId,
  workspaces,
  onSelectWorkspace,
  onNavigatePlugins,
}: Props) => {
  const { t } = useI18n();
  const { notify, confirm } = useAppShell();
  const dock = useRightDock();
  const [scopeView, setScopeView] = useState<ScopeView>('effective');
  const [workspaceSkills, setWorkspaceSkills] = useState<CanvasSkillEntry[]>([]);
  const [globalSkills, setGlobalSkills] = useState<CanvasSkillEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [libraryContext, setLibraryContext] = useState<LibraryContext>({
    kind: 'workspace',
    workspaceId: activeWorkspaceId,
  });
  const loadSequenceRef = useRef(0);
  const globalPerspective = libraryContext.kind === 'global';
  const visibleScopeView: ScopeView = globalPerspective ? 'global' : scopeView;
  const workspaceContextId = libraryContext.kind === 'workspace'
    ? libraryContext.workspaceId
    : activeWorkspaceId;
  const activeWorkspace = workspaces.find((workspace) => workspace.id === workspaceContextId);

  useEffect(() => {
    setLibraryContext((current) => {
      if (current.kind === 'global' || current.workspaceId === activeWorkspaceId) return current;
      return { kind: 'workspace', workspaceId: activeWorkspaceId };
    });
  }, [activeWorkspaceId]);

  const load = useCallback(async () => {
    const sequence = ++loadSequenceRef.current;
    try {
      const globalRequest = window.canvasWorkspace.canvasSkills.list({ level: 'global' });
      const workspaceRequest = globalPerspective
        ? Promise.resolve(null)
        : window.canvasWorkspace.canvasSkills.list({
          level: 'workspace',
          workspaceId: workspaceContextId,
        });
      const [workspaceResult, globalResult] = await Promise.all([workspaceRequest, globalRequest]);
      if (sequence !== loadSequenceRef.current) return;
      if (
        !globalResult.ok
        || !globalResult.status
        || (!globalPerspective && (!workspaceResult?.ok || !workspaceResult.status))
      ) {
        notify({
          tone: 'error',
          title: t('skillsLibrary.loadFailed'),
          description: workspaceResult?.error ?? globalResult.error,
        });
        return;
      }
      setWorkspaceSkills(workspaceResult?.status?.skills ?? []);
      setGlobalSkills(globalResult.status.skills);
    } catch (error) {
      if (sequence !== loadSequenceRef.current) return;
      notify({
        tone: 'error',
        title: t('skillsLibrary.loadFailed'),
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (sequence === loadSequenceRef.current) setLoading(false);
    }
  }, [globalPerspective, notify, t, workspaceContextId]);

  useEffect(() => {
    setLoading(true);
    void load();
    const unsubscribe = subscribeCanvasSkillsChanged(() => void load());
    return () => {
      loadSequenceRef.current += 1;
      unsubscribe();
    };
  }, [load]);

  const displaySkills = useMemo<DisplaySkill[]>(() => {
    const globalNames = new Set(globalSkills.map((skill) => skillNameKey(skill.name)));
    const workspaceNames = new Set(workspaceSkills.map((skill) => skillNameKey(skill.name)));
    const local = workspaceSkills.map((skill) => ({
      ...skill,
      configScope: { level: 'workspace', workspaceId: workspaceContextId } as const,
      overridesGlobal: globalNames.has(skillNameKey(skill.name)),
    }));
    const global = globalSkills.map((skill) => ({
      ...skill,
      configScope: { level: 'global' } as const,
      overridesGlobal: false,
    }));
    const source = visibleScopeView === 'global'
      ? global
      : visibleScopeView === 'workspace'
      ? local
      : [...local, ...global.filter((skill) => !workspaceNames.has(skillNameKey(skill.name)))];
    const normalizedQuery = skillNameKey(query);
    return source.filter((skill) => (
      !normalizedQuery
      || skillNameKey(`${skill.name} ${skill.description} ${skill.source}`).includes(normalizedQuery)
    ));
  }, [globalSkills, query, visibleScopeView, workspaceContextId, workspaceSkills]);

  const startSkillChat = (skill: CanvasSkillEntry) => {
    dock.startSkillChat(workspaceContextId, skill.name);
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
      workspaceContextId,
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
    const target: CanvasConfigScope = visibleScopeView === 'global'
      ? { level: 'global' }
      : { level: 'workspace', workspaceId: workspaceContextId };
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

  const heading = visibleScopeView === 'global'
    ? t('skillsLibrary.availableEverywhere')
    : scopeView === 'effective'
    ? t('skillsLibrary.availableIn', { workspace: activeWorkspace?.name ?? '' })
    : t('skillsLibrary.savedIn', { workspace: activeWorkspace?.name ?? '' });

  const selectLibraryContext = (value: LibraryContext) => {
    setLibraryContext(value);
    if (value.kind === 'global') {
      setScopeView('global');
      return;
    }
    setScopeView('effective');
    onSelectWorkspace(value.workspaceId);
  };

  return (
    <main className="skills-library">
      <SkillsLibraryTabs onNavigatePlugins={onNavigatePlugins} />
      <SkillsLibraryHeader
        onImport={chooseImport}
        onAdd={() => setEditorOpen(true)}
      />

      {loading ? (
        <SkillsLibraryLoading />
      ) : (
        <>
      <div className="skills-library__scope-bar">
        <LibraryContextSelect
          value={libraryContext}
          workspaces={workspaces}
          onChange={selectLibraryContext}
        />
        {globalPerspective ? (
          <div className="skills-library__global-summary">
            <Globe size={16} />
            <span>{t('skillsLibrary.availableEverywhere')}</span>
            <small>{t('skillsLibrary.skillCount', { count: globalSkills.length })}</small>
          </div>
        ) : (
          <SegmentedControl
            ariaPattern="tab"
            ariaLabel={t('skillsLibrary.title')}
            value={scopeView}
            options={scopeOptions}
            onChange={(value) => setScopeView(value as ScopeView)}
            className="skills-library__scope-tabs"
          />
        )}
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

      <SkillList
        skills={displaySkills}
        query={query}
        onOpen={(skill) => dock.openSkill(skill.configScope, skill)}
        onStartChat={startSkillChat}
        onPromote={(skill) => void promote(skill)}
        onRemove={(skill) => void removeSkill(skill)}
      />
        </>
      )}

      <SkillEditorModal
        open={editorOpen}
        workspaceScope={{ level: 'workspace', workspaceId: workspaceContextId }}
        initialScope={visibleScopeView === 'global'
          ? { level: 'global' }
          : { level: 'workspace', workspaceId: workspaceContextId }}
        onClose={() => setEditorOpen(false)}
        onCreate={createSkill}
      />
    </main>
  );
};
