import { useState, useRef, useEffect, useCallback } from 'react';
import type { AgentChatMessage } from '../../types';
import './ChatPanel.css';

interface ChatPanelProps {
  workspaceId: string;
  onClose: () => void;
}

export const ChatPanel = ({ workspaceId, onClose }: ChatPanelProps) => {
  const [messages, setMessages] = useState<AgentChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load history on mount
  useEffect(() => {
    void (async () => {
      const result = await window.canvasWorkspace.agent.getHistory(workspaceId);
      if (result.ok && result.messages) {
        setMessages(result.messages);
      }
    })();
  }, [workspaceId]);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-resize textarea
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }, []);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    // Add user message immediately
    const userMsg: AgentChatMessage = {
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    try {
      const result = await window.canvasWorkspace.agent.chat(workspaceId, text);
      if (result.ok && result.response) {
        const assistantMsg: AgentChatMessage = {
          role: 'assistant',
          content: result.response,
          timestamp: Date.now(),
        };
        setMessages(prev => [...prev, assistantMsg]);
      } else {
        const errorMsg: AgentChatMessage = {
          role: 'assistant',
          content: `Error: ${result.error ?? 'Unknown error'}`,
          timestamp: Date.now(),
        };
        setMessages(prev => [...prev, errorMsg]);
      }
    } catch (err) {
      const errorMsg: AgentChatMessage = {
        role: 'assistant',
        content: `Error: ${String(err)}`,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, workspaceId]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  }, [sendMessage]);

  return (
    <div className="chat-panel">
      <div className="chat-panel-header">
        <h3>Canvas Agent</h3>
        <button className="chat-panel-close" onClick={onClose} title="Close">
          ×
        </button>
      </div>

      {messages.length === 0 && !loading ? (
        <div className="chat-messages-empty">
          Ask me anything about this workspace.
          <br />
          I can read, create, and organize canvas nodes,
          <br />
          write code, and run commands.
        </div>
      ) : (
        <div className="chat-messages">
          {messages.map((msg, i) => (
            <div key={i} className={`chat-message chat-message-${msg.role}`}>
              <div className="chat-message-bubble">{msg.content}</div>
            </div>
          ))}
          {loading && (
            <div className="chat-loading">
              <div className="chat-loading-dot" />
              <div className="chat-loading-dot" />
              <div className="chat-loading-dot" />
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      )}

      <div className="chat-input-area">
        <textarea
          ref={textareaRef}
          className="chat-input"
          placeholder="Ask the Canvas Agent..."
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          rows={1}
          disabled={loading}
        />
        <button
          className="chat-send-btn"
          onClick={() => void sendMessage()}
          disabled={!input.trim() || loading}
        >
          Send
        </button>
      </div>
    </div>
  );
};
