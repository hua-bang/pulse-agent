import { useMemo, useState } from 'react';
import type { KnowledgeTagDefinition, WorkspaceNodeRecord } from '../../types';
import { tagName } from './utils';
import { useI18n } from '../../i18n';
import { isImeComposing } from '../../utils/ime';

interface NodeTagEditorProps {
  node: WorkspaceNodeRecord;
  workspaceId: string;
  tags: string[];
  tagDefinitions: KnowledgeTagDefinition[];
  readOnly?: boolean;
  onNodePatched?: (next: WorkspaceNodeRecord) => void;
  onTagsChanged?: () => void;
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function uniqueTagDefinitions(tags: KnowledgeTagDefinition[]): KnowledgeTagDefinition[] {
  const seen = new Set<string>();
  const result: KnowledgeTagDefinition[] = [];
  for (const tag of tags) {
    if (seen.has(tag.id)) continue;
    seen.add(tag.id);
    result.push(tag);
  }
  return result;
}

export const NodeTagEditor = ({
  node,
  workspaceId,
  tags,
  tagDefinitions,
  readOnly,
  onNodePatched,
  onTagsChanged,
}: NodeTagEditorProps) => {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = useMemo(() => new Set(tags), [tags]);
  const query = normalizeText(input);
  const definitions = useMemo(() => uniqueTagDefinitions(tagDefinitions), [tagDefinitions]);
  const availableTags = useMemo(() => {
    return definitions
      .filter((tag) => !selected.has(tag.id))
      .filter((tag) => {
        if (!query) return true;
        return normalizeText(tag.name).includes(query) || normalizeText(tag.id).includes(query);
      })
      .slice(0, 8);
  }, [definitions, query, selected]);

  const exactMatch = useMemo(() => {
    if (!query) return null;
    return definitions.find((tag) => normalizeText(tag.name) === query || normalizeText(tag.id) === query) ?? null;
  }, [definitions, query]);

  const updateTags = async (nextTags: string[]) => {
    const api = window.canvasWorkspace?.workspaceNodes;
    if (!api) return;
    setSaving(true);
    setError(null);
    try {
      const result = await api.updateTags(workspaceId, node.id, nextTags);
      if (!result.ok || !result.node) {
        setError(result.error ?? t('workspaceNodes.updateTagsFailed'));
        return;
      }
      onNodePatched?.(result.node);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const addTag = async (tagId: string) => {
    if (!tagId || selected.has(tagId)) return;
    await updateTags([...tags, tagId]);
    setInput('');
  };

  const removeTag = async (tagId: string) => {
    await updateTags(tags.filter((tag) => tag !== tagId));
  };

  const createOrAddFromInput = async () => {
    const name = input.trim();
    if (!name) return;
    if (exactMatch) {
      await addTag(exactMatch.id);
      return;
    }

    const api = window.canvasWorkspace?.workspaceNodes;
    if (!api) return;
    setSaving(true);
    setError(null);
    try {
      const result = await api.upsertTag({ name });
      if (!result.ok || !result.tag) {
        setError(result.error ?? t('workspaceNodes.createTagFailed'));
        return;
      }
      onTagsChanged?.();
      await addTag(result.tag.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="node-tag-editor">
      <div className="workspace-node-tags workspace-node-tags--editable">
        {tags.length > 0
          ? tags.map((tag) => (
            <span key={tag} className="workspace-node-tag workspace-node-tag--removable">
              {tagName(tag, definitions)}
              {!readOnly && (
                <button
                  type="button"
                  className="workspace-node-tag__remove"
                  aria-label={t('workspaceNodes.removeTag', { tag: tagName(tag, definitions) })}
                  disabled={saving}
                  onClick={() => { void removeTag(tag); }}
                >
                  x
                </button>
              )}
            </span>
          ))
          : <span className="workspace-node-muted">{t('workspaceNodes.noTags')}</span>}
        {!readOnly && (
          <button
            type="button"
            className="workspace-node-tag workspace-node-tag--add"
            disabled={saving}
            onClick={() => setOpen((value) => !value)}
          >
            {t('workspaceNodes.addTag')}
          </button>
        )}
      </div>

      {open && !readOnly && (
        <div className="node-tag-editor__picker">
          <input
            className="node-tag-editor__input"
            value={input}
            disabled={saving}
            placeholder={t('workspaceNodes.searchOrCreateTag')}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (isImeComposing(event)) return;
              if (event.key === 'Escape') {
                setOpen(false);
                setInput('');
              }
              if (event.key === 'Enter') {
                event.preventDefault();
                void createOrAddFromInput();
              }
            }}
            autoFocus
          />
          <div className="node-tag-editor__options">
            {availableTags.map((tag) => (
              <button
                key={tag.id}
                type="button"
                className="node-tag-editor__option"
                disabled={saving}
                title={tag.description}
                onClick={() => { void addTag(tag.id); }}
              >
                <span>{tag.name}</span>
                <small>{tag.id}</small>
              </button>
            ))}
            {input.trim() && !exactMatch && (
              <button
                type="button"
                className="node-tag-editor__option node-tag-editor__option--create"
                disabled={saving}
                onClick={() => { void createOrAddFromInput(); }}
              >
                {t('workspaceNodes.createTag', { name: input.trim() })}
              </button>
            )}
            {!availableTags.length && !input.trim() && (
              <div className="node-tag-editor__empty">{t('workspaceNodes.noTagsYet')}</div>
            )}
          </div>
          {error && <div className="node-tag-editor__error">{error}</div>}
        </div>
      )}
    </div>
  );
};
