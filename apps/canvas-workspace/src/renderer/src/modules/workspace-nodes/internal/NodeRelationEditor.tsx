import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import type { WorkspaceNodeLink, WorkspaceNodeListItem, WorkspaceNodeRecord } from '../../../types';
import { useI18n } from '../../../i18n';
import { Button, TextField } from '../../../components/ui';
import { CloseIcon } from '../../../components/icons';
import { getNodeTitle } from './utils';
import { dispatchOpenNode } from '../../../utils/openNodeBridge';
import { isImeComposing } from '../../../utils/ime';
import { useIndexNav } from '../../../components/ui/hooks/useIndexNav';

interface Props {
  node: WorkspaceNodeRecord;
  workspaceId: string;
  candidates: WorkspaceNodeListItem[];
  readOnly?: boolean;
  onNodePatched?: (next: WorkspaceNodeRecord) => void;
}

const SUGGESTED_RELATIONS = ['related to', 'supports', 'contradicts', 'derived from'];
const MAX_TARGET_OPTIONS = 8;

/**
 * A deliberately small relationship editor. Relation strings stay open-ended
 * in the persisted record, while the datalist gives people a useful starting
 * vocabulary without making a migration or ontology decision today.
 *
 * The target picker is a filtering combobox rather than a `ui/Select`: that
 * dropdown has no search, so picking a node out of a workspace with hundreds
 * of them meant scrolling an unfiltered list. The interaction contract here
 * matches NodeTagEditor's picker (type to filter, Arrow/Home/End, Enter,
 * Escape) so both fields in this panel behave the same way.
 */
export const NodeRelationEditor = ({
  node,
  workspaceId,
  candidates,
  readOnly,
  onNodePatched,
}: Props) => {
  const { t } = useI18n();
  const [adding, setAdding] = useState(false);
  const [relation, setRelation] = useState(SUGGESTED_RELATIONS[0]);
  const [targetId, setTargetId] = useState('');
  const [targetQuery, setTargetQuery] = useState('');
  const {
    index: activeIndex,
    setIndex: setActiveIndex,
    move: moveActiveIndex,
    home: moveActiveHome,
    end: moveActiveEnd,
    reset: resetActiveIndex,
  } = useIndexNav({ wrap: true, initialIndex: -1 });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const links = node.links ?? [];
  const availableCandidates = useMemo(
    () => candidates.filter((candidate) => candidate.id !== node.id),
    [candidates, node.id],
  );
  const targetOptions = useMemo(() => {
    const query = targetQuery.trim().toLowerCase();
    return availableCandidates
      .map((candidate) => ({
        id: candidate.id,
        label: getNodeTitle(candidate, t('workspaceNodes.untitled')),
      }))
      .filter((option) => !query
        || option.label.toLowerCase().includes(query)
        || option.id.toLowerCase().includes(query))
      .slice(0, MAX_TARGET_OPTIONS);
  }, [availableCandidates, targetQuery, t]);

  useEffect(() => {
    setAdding(false);
    setTargetId('');
    setTargetQuery('');
    setError(null);
  }, [node.id]);

  useEffect(() => {
    if (!adding) return;
    resetActiveIndex(targetOptions.length > 0 ? 0 : -1);
  }, [adding, resetActiveIndex, targetOptions.length, targetQuery]);

  const persist = async (nextLinks: WorkspaceNodeLink[]) => {
    const api = window.canvasWorkspace?.workspaceNodes;
    if (!api) return;
    setSaving(true);
    setError(null);
    try {
      const result = await api.update(workspaceId, node.id, { links: nextLinks });
      if (!result.ok || !result.node) {
        setError(result.error ?? t('workspaceNodes.relations.updateFailed'));
        return;
      }
      onNodePatched?.(result.node);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const addRelation = async (selectedId = targetId) => {
    const relationLabel = relation.trim();
    const target = availableCandidates.find((candidate) => candidate.id === selectedId);
    if (!relationLabel || !target) {
      setError(t('workspaceNodes.relations.required'));
      return;
    }
    await persist([
      ...links,
      {
        relation: relationLabel,
        target: { nodeId: target.id },
        title: getNodeTitle(target, t('workspaceNodes.untitled')),
      },
    ]);
    setAdding(false);
    setTargetId('');
    setTargetQuery('');
  };

  const removeRelation = async (index: number) => {
    await persist(links.filter((_, itemIndex) => itemIndex !== index));
  };

  // Option rows preventDefault on mousedown, so the combobox input keeps
  // focus through a pick — no imperative refocus needed.
  const selectTarget = useCallback((id: string, label: string) => {
    setTargetId(id);
    setTargetQuery(label);
  }, []);

  const handleTargetKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    if (isImeComposing(event)) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (targetOptions.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      moveActiveIndex(event.key === 'ArrowDown' ? 1 : -1, targetOptions.length);
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      if (targetOptions.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Home') moveActiveHome();
      else moveActiveEnd(targetOptions.length);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      const option = activeIndex >= 0 ? targetOptions[activeIndex] : undefined;
      if (option && option.id !== targetId) {
        selectTarget(option.id, option.label);
        return;
      }
      void addRelation(option?.id ?? targetId);
    }
  }, [activeIndex, addRelation, moveActiveEnd, moveActiveHome, moveActiveIndex, selectTarget, targetId, targetOptions]);

  return (
    <div className="node-relation-editor">
      {links.length > 0 ? (
        <div className="node-relation-editor__list">
          {links.map((link, index) => {
            const title = link.title ?? link.target.nodeId;
            return (
              <div key={`${link.relation}:${link.target.workspaceId ?? workspaceId}:${link.target.nodeId}:${index}`} className="node-relation-editor__row">
                <span className="node-relation-editor__predicate">{link.relation}</span>
                {/* A relation the user cannot walk is only half a graph — open
                  * the target the same way a note mention does. */}
                <Button
                  size="xs"
                  className="node-relation-editor__target-link"
                  title={t('workspaceNodes.relations.open', { title })}
                  onClick={() => dispatchOpenNode({
                    workspaceId: link.target.workspaceId ?? workspaceId,
                    nodeId: link.target.nodeId,
                  })}
                >
                  {title}
                </Button>
                {!readOnly && (
                  <Button
                    variant="icon"
                    size="xs"
                    aria-label={t('workspaceNodes.relations.remove', { title })}
                    title={t('workspaceNodes.relations.remove', { title })}
                    disabled={saving}
                    onClick={() => { void removeRelation(index); }}
                  >
                    <CloseIcon size={11} />
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="node-detail-panel__disclosure-empty">{t('workspaceNodes.relations.empty')}</p>
      )}

      {!readOnly && (adding ? (
        <div className="node-relation-editor__form">
          <div className="node-relation-editor__field">
            <span className="node-relation-editor__field-label">{t('workspaceNodes.relations.relation')}</span>
            <TextField
              className="node-relation-editor__input"
              aria-label={t('workspaceNodes.relations.relation')}
              value={relation}
              onChange={(event) => setRelation(event.target.value)}
              placeholder={t('workspaceNodes.relations.relationHint')}
              disabled={saving}
            />
          </div>
          <div className="node-relation-editor__field node-relation-editor__field--target">
            <span className="node-relation-editor__field-label">{t('workspaceNodes.relations.target')}</span>
            <TextField
              className="node-relation-editor__input"
              aria-label={t('workspaceNodes.relations.target')}
              value={targetQuery}
              onChange={(event) => {
                setTargetQuery(event.target.value);
                setTargetId('');
              }}
              onKeyDown={handleTargetKeyDown}
              placeholder={t('workspaceNodes.relations.searchTarget')}
              disabled={saving}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={targetOptions.length > 0}
            />
            {/* Collapses once a target is confirmed so the form does not sit
              * permanently taller than the panel it lives in. */}
            {!targetId && (
            <div
              className="node-relation-editor__options"
              role="listbox"
              aria-label={t('workspaceNodes.relations.targetOptionsLabel')}
            >
              {targetOptions.map((option, index) => (
                <Button
                  key={option.id}
                  size="xs"
                  className={`node-relation-editor__option${index === activeIndex ? ' node-relation-editor__option--active' : ''}`}
                  role="option"
                  aria-selected={option.id === targetId}
                  disabled={saving}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => selectTarget(option.id, option.label)}
                >
                  {option.label}
                </Button>
              ))}
              {targetOptions.length === 0 && (
                <div className="node-relation-editor__empty">{t('workspaceNodes.relations.noTargets')}</div>
              )}
            </div>
            )}
          </div>
          <div className="node-relation-editor__form-actions">
            <Button size="xs" variant="primary" disabled={saving || !targetId} onClick={() => { void addRelation(); }}>
              {t('workspaceNodes.relations.save')}
            </Button>
            <Button size="xs" disabled={saving} onClick={() => { setAdding(false); setError(null); }}>
              {t('workspaceNodes.relations.cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <Button size="xs" className="node-relation-editor__add" disabled={availableCandidates.length === 0} onClick={() => setAdding(true)}>
          + {t('workspaceNodes.relations.add')}
        </Button>
      ))}

      {error && <p className="node-relation-editor__error" role="alert">{error}</p>}
    </div>
  );
};
