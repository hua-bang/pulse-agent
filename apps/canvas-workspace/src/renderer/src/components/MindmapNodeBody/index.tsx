import './index.css';
import { TopicPill } from './TopicPill';
import type { MindmapNodeBodyProps } from './types';
import { useMindmapController } from './useMindmapController';

export const MindmapNodeBody = ({
  node,
  isSelected,
  isOuterDragging = false,
  onUpdate,
  onSelectNode,
  onAutoResize,
  readOnly = false,
}: MindmapNodeBodyProps) => {
  const controller = useMindmapController({
    node,
    onUpdate,
    onSelectNode,
    onAutoResize,
    readOnly,
  });

  return (
    <div
      className={`mindmap-node-body${isSelected ? ' mindmap-node-body--selected' : ''}${isOuterDragging ? ' mindmap-node-body--outer-dragging' : ''}`}
    >
      <div
        className="mindmap-viewport"
        style={{
          width: controller.viewportWidth,
          height: controller.viewportHeight,
          padding: controller.padding,
        }}
      >
        <div
          className="mindmap-content"
          style={{
            width: controller.layout.width,
            height: controller.layout.height,
          }}
        >
          <svg
            className="mindmap-branches"
            width={controller.layout.width}
            height={controller.layout.height}
            viewBox={`0 0 ${Math.max(1, controller.layout.width)} ${Math.max(1, controller.layout.height)}`}
          >
            {controller.layout.branches.map((branch) => (
              <path
                key={branch.id}
                d={branch.path}
                fill="none"
                stroke={branch.color}
                strokeWidth={2}
                strokeLinecap="round"
                opacity={0.85}
              />
            ))}
          </svg>
          {controller.layout.topics.map((topic) => (
            <TopicPill
              key={topic.id}
              topic={topic}
              isSelected={controller.selectedId === topic.id}
              isEditing={controller.editingId === topic.id}
              outerCanvasSelected={isSelected}
              isDragSource={controller.reorder?.sourceId === topic.id}
              dropHint={controller.getDropHint(topic.id)}
              onBeginReorder={(e) => controller.beginReorder(topic.id, e)}
              onSelect={() => controller.selectTopic(topic.id)}
              onEnterEdit={() => controller.enterTopicEdit(topic.id)}
              onCommitText={(text) => controller.renameTopic(topic.id, text)}
              onToggleCollapsed={() => controller.toggleTopicCollapsed(topic.id)}
              onKeyAction={(action) => controller.handleTopicKeyAction(topic.id, action)}
              readOnly={readOnly}
            />
          ))}
        </div>
      </div>
    </div>
  );
};
