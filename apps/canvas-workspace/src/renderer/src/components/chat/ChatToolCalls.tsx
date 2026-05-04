import type { ToolCallStatus } from './types';

interface ChatToolCallsProps {
  tools: ToolCallStatus[];
  collapsed: boolean;
  expandedTools: Set<number>;
  showSectionHeader: boolean;
  onToggleSection: () => void;
  onToggleToolExpand: (toolId: number) => void;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

function formatToolSignature(name: string, args: any): string {
  if (!args) return `${name}()`;

  const parts: string[] = [];
  if (name === 'read' || name === 'write') {
    if (args.file_path || args.filePath) parts.push(JSON.stringify(args.file_path || args.filePath));
  } else if (name === 'edit') {
    if (args.file_path || args.filePath) parts.push(JSON.stringify(args.file_path || args.filePath));
    if (args.old_string) parts.push(JSON.stringify(truncate(args.old_string, 30)));
  } else if (name === 'bash') {
    if (args.command) parts.push(JSON.stringify(truncate(args.command, 60)));
  } else if (name === 'grep') {
    if (args.pattern) parts.push(JSON.stringify(args.pattern));
    if (args.path) parts.push(JSON.stringify(args.path));
  } else if (name === 'ls') {
    if (args.path) parts.push(JSON.stringify(args.path));
  } else {
    for (const value of Object.values(args)) {
      if (parts.length >= 3) break;
      if (typeof value === 'string') parts.push(JSON.stringify(truncate(value, 40)));
      else if (typeof value === 'number') parts.push(String(value));
    }
  }

  return `${name}(${parts.join(', ')})`;
}

function formatToolLabel(name: string, status: ToolCallStatus['status']): string {
  const prefix = status === 'running' ? '正在' : '已';
  switch (name) {
    case 'canvas_read_context':
      return `${prefix}读取画布上下文`;
    case 'canvas_read_node':
      return `${prefix}读取节点内容`;
    case 'canvas_create_node':
      return `${prefix}创建画布节点`;
    case 'canvas_create_agent_node':
      return `${prefix}创建 Agent 节点`;
    case 'canvas_create_terminal_node':
      return `${prefix}创建 Terminal 节点`;
    case 'canvas_update_node':
      return `${prefix}更新画布节点`;
    case 'canvas_delete_node':
      return `${prefix}删除画布节点`;
    case 'canvas_move_node':
      return `${prefix}移动画布节点`;
    case 'canvas_send_to_agent':
      return `${prefix}发送给 Agent`;
    case 'read':
      return `${prefix}读取文件`;
    case 'write':
      return `${prefix}写入文件`;
    case 'edit':
      return `${prefix}编辑文件`;
    case 'grep':
      return `${prefix}搜索内容`;
    case 'ls':
      return `${prefix}查看目录`;
    case 'bash':
      return `${prefix}运行命令`;
    default:
      return status === 'running' ? `正在执行 ${name}` : `已执行 ${name}`;
  }
}

export const ChatToolCalls = ({
  tools,
  collapsed,
  expandedTools,
  showSectionHeader,
  onToggleSection,
  onToggleToolExpand,
}: ChatToolCallsProps) => {
  if (collapsed) {
    return (
      <div className="chat-tool-calls chat-tool-calls--collapsed" onClick={onToggleSection}>
        <span className="chat-tool-call-icon">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M3 6l2 2 4-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="chat-tool-calls-summary">已完成 {tools.length} 个操作</span>
        <span className="chat-tool-call-chevron">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M3 4l2 2 2-2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </div>
    );
  }

  return (
    <div className="chat-tool-calls">
      {showSectionHeader && tools.length > 0 && (
        <div className="chat-tool-calls-section-header" onClick={onToggleSection}>
          <span className="chat-tool-calls-summary">已完成 {tools.length} 个操作</span>
          <span className="chat-tool-call-chevron chat-tool-call-chevron--open">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M3 4l2 2 2-2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </div>
      )}
      {tools.map(tool => (
        <div key={tool.id} className={`chat-tool-call chat-tool-call--${tool.status}`}>
          <div
            className="chat-tool-call-header"
            onClick={tool.status === 'done' && tool.result ? () => onToggleToolExpand(tool.id) : undefined}
            style={tool.status === 'done' && tool.result ? { cursor: 'pointer' } : undefined}
          >
            <span className="chat-tool-call-icon">
              {tool.status === 'running' ? (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="chat-tool-call-spinner">
                  <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.2" strokeDasharray="14 14" strokeLinecap="round" />
                </svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M3 6l2 2 4-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </span>
            <span className="chat-tool-call-sig" title={formatToolSignature(tool.name, tool.args)}>
              {formatToolLabel(tool.name, tool.status)}
            </span>
            {tool.status === 'done' && tool.result && (
              <span className={`chat-tool-call-chevron${expandedTools.has(tool.id) ? ' chat-tool-call-chevron--open' : ''}`}>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M3 4l2 2 2-2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            )}
          </div>
          {expandedTools.has(tool.id) && tool.result && (
            <div className="chat-tool-call-result">
              <pre>{tool.result.length > 2000 ? `${tool.result.slice(0, 2000)}\n...(truncated)` : tool.result}</pre>
            </div>
          )}
        </div>
      ))}
    </div>
  );
};
