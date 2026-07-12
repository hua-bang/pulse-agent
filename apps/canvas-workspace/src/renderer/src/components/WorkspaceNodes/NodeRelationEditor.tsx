import { useEffect, useMemo, useState } from 'react';
import type { WorkspaceNodeLink, WorkspaceNodeListItem, WorkspaceNodeRecord } from '../../types';
import { useI18n } from '../../i18n';
import { Button, Select, TextField } from '../ui';
import { getNodeTitle } from './utils';

interface NodeRelationEditorProps {
  node: WorkspaceNodeRecord;
  workspaceId: string;
  candidates: WorkspaceNodeListItem[];
  readOnly?: boolean;
  onNodePatched?: (next: WorkspaceNodeRecord) => void;
}

const SUGGESTED_RELATIONS = ['related to', 'supports', 'contradicts', 'derived from'];

/**
 * A deliberately small relationship editor. Relation strings stay open-ended
 * in the persisted record, while the datalist gives people a useful starting
 * vocabulary without making a migration or ontology decision today.
 */
export const NodeRelationEditor = ({
  node,
  workspaceId,
  candidates,
  readOnly,
  onNodePatched,
}: NodeRelationEditorProps) => {
  const { t } = useI18n();
  const [adding, setAdding] = useState(false);
  const [relation, setRelation] = useState(SUGGESTED_RELATIONS[0]);
  const [targetId, setTargetId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const links = node.links ?? [];
  const availableCandidates = useMemo(
    () => candidates.filter((candidate) => candidate.id !== node.id),
    [candidates, node.id],
  );
  const targetOptions = useMemo(
    () => availableCandidates.map((candidate) => ({
      value: candidate.id,
      label: getNodeTitle(candidate, t('workspaceNodes.untitled')),
    })),
    [availableCandidates, t],
  );

  useEffect(() => {
    setAdding(false);
    setTargetId('');
    setError(null);
  }, [node.id]);

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

  const addRelation = async () => {
    const relationLabel = relation.trim();
    const target = availableCandidates.find((candidate) => candidate.id === targetId);
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
  };

  const removeRelation = async (index: number) => {
    await persist(links.filter((_, itemIndex) => itemIndex !== index));
  };

  return (
    <div className="node-relation-editor">
      {links.length > 0 ? (
        <div className="node-relation-editor__list">
          {links.map((link, index) => (
            <div key={`${link.relation}:${link.target.workspaceId ?? workspaceId}:${link.target.nodeId}:${index}`} className="node-relation-editor__row">
              <span className="node-relation-editor__predicate">{link.relation}</span>
              <strong title={link.title ?? link.target.nodeId}>{link.title ?? link.target.nodeId}</strong>
              {!readOnly && (
                <Button
                  variant="icon"
                  size="xs"
                  aria-label={t('workspaceNodes.relations.remove', { title: link.title ?? link.target.nodeId })}
                  title={t('workspaceNodes.relations.remove', { title: link.title ?? link.target.nodeId })}
                  disabled={saving}
                  onClick={() => { void removeRelation(index); }}
                >
                  ×
                </Button>
              )}
            </div>
          ))}
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
          <div className="node-relation-editor__field">
            <span className="node-relation-editor__field-label">{t('workspaceNodes.relations.target')}</span>
            <Select
              className="node-relation-editor__target"
              value={targetId}
              options={targetOptions}
              onChange={setTargetId}
              ariaLabel={t('workspaceNodes.relations.target')}
              placeholder={t('workspaceNodes.relations.targetPlaceholder')}
              menuPlacement="top"
              disabled={saving}
            />
          </div>
          <div className="node-relation-editor__form-actions">
            <Button size="xs" variant="primary" disabled={saving || availableCandidates.length === 0} onClick={() => { void addRelation(); }}>
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
