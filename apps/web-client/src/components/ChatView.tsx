import { useState, useRef, useEffect, useCallback } from 'react';
import { postChat, openStream, postClarify } from '../api/client';
import './ChatView.css';

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
  toolCalls?: string[];
}

interface Clarification {
  streamId: string;
  clarificationId: string;
  prompt: string;
}

interface Props {
  apiKey: string;
  userId: string;
  onKeyInvalid: () => void;
}

export function ChatView({ apiKey, userId, onKeyInvalid }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [clarification, setClarification] = useState<Clarification | null>(null);
  const [clarifyInput, setClarifyInput] = useState('');

  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Scroll to bottom when messages update
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  // Cleanup stream on unmount
  useEffect(() => () => { cleanupRef.current?.(); }, []);

  const addMessage = useCallback((msg: Message) => {
    setMessages((prev) => [...prev, msg]);
    return msg.id;
  }, []);

  const updateLastAssistant = useCallback((updater: (prev: Message) => Message) => {
    setMessages((prev) => {
      const next = [...prev];
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].role === 'assistant') {
          next[i] = updater(next[i]);
          break;
        }
      }
      return next;
    });
  }, []);

  async function send(text: string, forceNew?: boolean) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    setSending(true);
    setInput('');

    addMessage({ id: generateId(), role: 'user', content: trimmed });
    const assistantId = generateId();
    addMessage({ id: assistantId, role: 'assistant', content: '', streaming: true, toolCalls: [] });

    try {
      const { streamId } = await postChat(apiKey, userId, trimmed, forceNew);

      const cleanup = openStream(streamId, {
        onText(delta) {
          updateLastAssistant((m) => ({ ...m, content: m.content + delta }));
        },
        onToolCall(toolName) {
          updateLastAssistant((m) => ({
            ...m,
            toolCalls: [...(m.toolCalls ?? []), toolName],
          }));
        },
        onClarification(id, prompt) {
          setClarification({ streamId, clarificationId: id, prompt });
        },
        onDone() {
          updateLastAssistant((m) => ({ ...m, streaming: false }));
          setSending(false);
          cleanupRef.current = null;
          inputRef.current?.focus();
        },
        onError(message) {
          updateLastAssistant((m) => ({
            ...m,
            content: m.content || `错误：${message}`,
            streaming: false,
          }));
          setSending(false);
          cleanupRef.current = null;
        },
      });

      cleanupRef.current = cleanup;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      if (msg === 'AUTH_FAILED') {
        onKeyInvalid();
        return;
      }
      updateLastAssistant((m) => ({
        ...m,
        content: `请求失败：${msg}`,
        streaming: false,
      }));
      setSending(false);
    }
  }

  async function handleClarifySubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!clarification || !clarifyInput.trim()) return;

    await postClarify(apiKey, clarification.streamId, clarification.clarificationId, clarifyInput.trim());
    setClarification(null);
    setClarifyInput('');
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    // Auto-resize textarea
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
  }

  return (
    <div className="chat">
      {/* Header */}
      <div className="chat__header">
        <span className="chat__title">⚡ Pulse Coder</span>
        <button
          className="chat__new-btn"
          onClick={() => {
            cleanupRef.current?.();
            setMessages([]);
            setSending(false);
          }}
          title="新建对话"
        >
          新对话
        </button>
      </div>

      {/* Messages */}
      <div className="chat__list" ref={listRef}>
        {messages.length === 0 && (
          <div className="chat__empty">
            <p>发送消息开始对话</p>
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`chat__msg chat__msg--${msg.role}`}>
            {msg.role === 'assistant' && (
              <div className="chat__avatar">⚡</div>
            )}
            <div className="chat__bubble">
              {msg.toolCalls && msg.toolCalls.length > 0 && (
                <div className="chat__tools">
                  {msg.toolCalls.map((t, i) => (
                    <span key={i} className="chat__tool-tag">⚙ {t}</span>
                  ))}
                </div>
              )}
              <pre className="chat__text">{msg.content}
                {msg.streaming && <span className="chat__cursor" />}
              </pre>
            </div>
          </div>
        ))}
      </div>

      {/* Clarification overlay */}
      {clarification && (
        <div className="chat__clarify-overlay">
          <div className="chat__clarify-card">
            <p className="chat__clarify-prompt">{clarification.prompt}</p>
            <form onSubmit={handleClarifySubmit} className="chat__clarify-form">
              <input
                className="chat__clarify-input"
                value={clarifyInput}
                onChange={(e) => setClarifyInput(e.target.value)}
                placeholder="输入你的回答..."
                autoFocus
              />
              <button className="chat__clarify-btn" type="submit">
                确认
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Input bar */}
      <div className="chat__bar">
        <textarea
          ref={inputRef}
          className="chat__input"
          placeholder="发送消息…"
          rows={1}
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          disabled={sending}
        />
        <button
          className="chat__send"
          onClick={() => send(input)}
          disabled={sending || !input.trim()}
        >
          {sending ? '…' : '↑'}
        </button>
      </div>
    </div>
  );
}
