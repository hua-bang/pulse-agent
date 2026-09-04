import { useI18n } from '../../../../../../i18n';
import type { LaidOutTopic } from '../../../../mindmap/layout';
import './index.css';

interface Props {
  topic: LaidOutTopic;
  onAddChild: () => void;
  onSelect: () => void;
  onToggleCollapsed: () => void;
}

export const TopicActions = ({
  topic,
  onAddChild,
  onSelect,
  onToggleCollapsed,
}: Props) => {
  const { t } = useI18n();
  const isRoot = topic.depth === 0;
  const stopPropagation = (event: React.MouseEvent) => event.stopPropagation();

  return (
    <span className="mindmap-topic-actions" aria-hidden={false}>
      <button
        type="button"
        className="mindmap-topic-action mindmap-topic-action--add"
        aria-label={t('mindmap.topic.addChild')}
        title={t('mindmap.topic.addChild')}
        onMouseDown={stopPropagation}
        onDoubleClick={stopPropagation}
        onClick={(event) => {
          event.stopPropagation();
          onSelect();
          onAddChild();
        }}
      >
        +
      </button>
      {!isRoot && topic.hasChildren && (
        <button
          type="button"
          className={[
            'mindmap-topic-action',
            'mindmap-topic-action--fold',
            topic.collapsed && 'mindmap-topic-action--unfold',
          ].filter(Boolean).join(' ')}
          style={{ ['--mindmap-topic-toggle-color' as string]: topic.color }}
          aria-label={topic.collapsed ? t('mindmap.topic.unfold') : t('mindmap.topic.fold')}
          title={topic.collapsed ? t('mindmap.topic.unfold') : t('mindmap.topic.fold')}
          onMouseDown={stopPropagation}
          onDoubleClick={stopPropagation}
          onClick={(event) => {
            event.stopPropagation();
            onSelect();
            onToggleCollapsed();
          }}
        >
          {topic.collapsed
            ? t('mindmap.topic.unfoldShort')
            : t('mindmap.topic.foldShort')}
        </button>
      )}
    </span>
  );
};
