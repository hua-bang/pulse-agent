import type { CanvasNode, CanvasSaveData } from '../../../../shared/canvas';
import type { CanvasWorkspaceApi } from '../../../../shared/api/workspace-api';
import type { WebHostAuthSession } from './types';

type MobileTab = 'cards' | 'canvas' | 'chat';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderSimpleMarkdown(md: string): string {
  const lines = escapeHtml(md).split('\n');
  let html = '';
  let inCode = false;
  for (const line of lines) {
    if (line.startsWith('```')) {
      if (!inCode) {
        inCode = true;
        html += '<pre class="pulse-h5-code"><code>';
      } else {
        inCode = false;
        html += '</code></pre>';
      }
      continue;
    }
    if (inCode) {
      html += `${line}\n`;
      continue;
    }
    const inline = line
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code class="pulse-h5-inline-code">$1</code>');
    if (inline.startsWith('### ')) html += `<h4>${inline.slice(4)}</h4>`;
    else if (inline.startsWith('## ')) html += `<h3>${inline.slice(3)}</h3>`;
    else if (inline.startsWith('# ')) html += `<h2>${inline.slice(2)}</h2>`;
    else if (inline.startsWith('- ')) html += `<div class="pulse-h5-li">• ${inline.slice(2)}</div>`;
    else if (inline.trim() === '') html += '<div class="pulse-h5-gap"></div>';
    else html += `<p>${inline}</p>`;
  }
  return html;
}

function extractNodeText(node: CanvasNode): string {
  const data = (node.data ?? {}) as Record<string, unknown>;
  if (typeof data.content === 'string' && data.content.trim()) return data.content;
  if (typeof data.text === 'string' && data.text.trim()) return data.text;
  if (typeof data.url === 'string' && data.url.trim()) return data.url;
  return '';
}

function nodeTypeLabel(type: string): string {
  switch (type) {
    case 'text':
      return '笔记';
    case 'file':
      return '文件';
    case 'iframe':
      return '网页';
    case 'image':
      return '图片';
    case 'mindmap':
      return '导图';
    case 'terminal':
      return '终端';
    case 'agent':
      return 'Agent';
    default:
      return type;
  }
}

function setDesktopChatDockOpen(open: boolean): void {
  const dock = document.querySelector('.right-dock');
  const dockVisible = dock?.getAttribute('data-expanded') === 'true';
  if (open === dockVisible) return;
  const fab = document.querySelector<HTMLButtonElement>('.chat-floating-button');
  if (open && fab) {
    fab.click();
    return;
  }
  if (!open && dockVisible) {
    if (fab) {
      fab.click();
      return;
    }
    const closeBtn = document.querySelector<HTMLButtonElement>(
      '.right-dock button[title*="Collapse"], .right-dock button[aria-label*="Collapse"], .right-dock button[title*="Close"]',
    );
    closeBtn?.click();
  }
}

/**
 * Mounts a lightweight native-feeling H5 mobile shell (`<= 768px` only) over the shared
 * Pulse Canvas renderer: bottom tab bar (`卡片` / `画布` / `对话`), workspace switcher,
 * Frame-grouped readable card feed, full-screen Markdown reader, and seamless switching
 * to the touch Canvas and full-screen Shared Chat Room.
 */
export function mountMobileWebShell(api: CanvasWorkspaceApi, session: WebHostAuthSession): () => void {
  const host = document.createElement('div');
  host.className = 'pulse-h5-shell';
  document.body.appendChild(host);

  let activeTab: MobileTab = 'cards';
  let workspaces: Array<{ id: string; name: string }> = [];
  let activeWorkspaceId = session.workspaceId ?? '';
  let canvasData: CanvasSaveData | null = null;
  let searchQuery = '';
  let selectedNodeId: string | null = null;
  let peerCount = 1;

  const syncModeDataset = () => {
    document.documentElement.dataset.pulseH5Tab = activeTab;
    window.dispatchEvent(new CustomEvent('pulse-h5-tab-change', { detail: activeTab }));
  };

  async function refreshWorkspaces(): Promise<void> {
    const manifest = await api.store.load('__workspaces__');
    const raw = manifest.data as unknown as {
      workspaces?: Array<{ id: string; name: string }>;
      activeId?: string;
    } | null;
    if (Array.isArray(raw?.workspaces) && raw.workspaces.length > 0) {
      workspaces = raw.workspaces;
      if (!activeWorkspaceId || !workspaces.some((w) => w.id === activeWorkspaceId)) {
        activeWorkspaceId = raw.activeId || workspaces[0].id;
      }
    }
    await refreshCanvas();
  }

  async function refreshCanvas(): Promise<void> {
    if (!activeWorkspaceId) return;
    const [loaded, presence] = await Promise.all([
      api.store.load(activeWorkspaceId),
      api.remoteVps.getPresence?.(activeWorkspaceId).catch(() => null),
    ]);
    if (loaded.ok) {
      canvasData = loaded.data ?? null;
    }
    if (presence?.ok) {
      peerCount = Math.max(1, presence.peers.length);
    }
    render();
  }

  function switchTab(next: MobileTab): void {
    activeTab = next;
    syncModeDataset();
    if (next === 'chat') {
      setDesktopChatDockOpen(true);
    } else {
      setDesktopChatDockOpen(false);
    }
    render();
  }

  function renderCardsOverlay(): string {
    const nodes = canvasData?.nodes ?? [];
    const frames = nodes.filter((n) => n.type === 'frame');
    const contentNodes = nodes.filter((n) => n.type !== 'frame');
    const q = searchQuery.trim().toLowerCase();
    const filtered = contentNodes.filter((n) => {
      if (!q) return true;
      const title = (n.title ?? '').toLowerCase();
      const body = extractNodeText(n).toLowerCase();
      return title.includes(q) || body.includes(q);
    });

    if (selectedNodeId) {
      const node = contentNodes.find((n) => n.id === selectedNodeId);
      if (node) {
        const body = extractNodeText(node);
        return `
          <div class="pulse-h5-overlay">
            <div class="pulse-h5-topbar">
              <button class="pulse-h5-back" data-h5-action="back">← 返回卡片</button>
              <button class="pulse-h5-ask-btn" data-h5-action="ask-node">问 Agent</button>
            </div>
            <div class="pulse-h5-reader">
              <div class="pulse-h5-reader-meta">
                <span class="pulse-h5-badge">${escapeHtml(nodeTypeLabel(node.type))}</span>
                <span>${escapeHtml(activeWorkspaceId)}</span>
              </div>
              <h1 class="pulse-h5-reader-title">${escapeHtml(node.title || '未命名节点')}</h1>
              <div class="pulse-h5-reader-body">${body ? renderSimpleMarkdown(body) : '<p class="pulse-h5-empty">暂无文本内容</p>'}</div>
            </div>
          </div>
        `;
      }
      selectedNodeId = null;
    }

    const wsOptions = workspaces
      .map(
        (w) =>
          `<option value="${escapeHtml(w.id)}" ${w.id === activeWorkspaceId ? 'selected' : ''}>${escapeHtml(w.name)}</option>`,
      )
      .join('');

    const cardItems =
      filtered.length > 0
        ? filtered
            .map((node) => {
              const rawText = extractNodeText(node).replace(/^#+\s*/gm, '').replace(/[*`]/g, '');
              const preview = rawText.slice(0, 120) || '点击查看节点内容';
              const parentFrame = frames.find(
                (f) =>
                  node.x >= f.x &&
                  node.y >= f.y &&
                  node.x <= f.x + (f.width ?? 0) &&
                  node.y <= f.y + (f.height ?? 0),
              );
              return `
                <button class="pulse-h5-card" data-h5-node="${escapeHtml(node.id)}">
                  <div class="pulse-h5-card-head">
                    <span class="pulse-h5-badge">${escapeHtml(nodeTypeLabel(node.type))}</span>
                    ${parentFrame?.title ? `<span class="pulse-h5-frame-tag">${escapeHtml(parentFrame.title)}</span>` : ''}
                  </div>
                  <div class="pulse-h5-card-title">${escapeHtml(node.title || '未命名节点')}</div>
                  <div class="pulse-h5-card-preview">${escapeHtml(preview)}</div>
                </button>
              `;
            })
            .join('')
        : '<div class="pulse-h5-empty">当前工作区暂无可展示的节点</div>';

    return `
      <div class="pulse-h5-overlay">
        <div class="pulse-h5-topbar">
          <div class="pulse-h5-ws-wrap">
            <span class="pulse-h5-dot"></span>
            <select class="pulse-h5-ws-select" id="pulse-h5-ws-select">${wsOptions}</select>
          </div>
          <span class="pulse-h5-online">${peerCount} 人在线</span>
        </div>
        <div class="pulse-h5-search-bar">
          <input id="pulse-h5-search" type="search" placeholder="搜索节点标题或笔记内容..." value="${escapeHtml(searchQuery)}" />
        </div>
        <div class="pulse-h5-card-list">
          ${cardItems}
        </div>
      </div>
    `;
  }

  function render(): void {
    const overlayHtml = activeTab === 'cards' ? renderCardsOverlay() : '';
    host.innerHTML = `
      ${overlayHtml}
      <nav class="pulse-h5-tabbar" aria-label="Mobile Navigation">
        <button class="pulse-h5-tab ${activeTab === 'cards' ? 'is-active' : ''}" data-h5-tab="cards">
          <span class="pulse-h5-tab-icon">◫</span>
          <span>卡片</span>
        </button>
        <button class="pulse-h5-tab ${activeTab === 'canvas' ? 'is-active' : ''}" data-h5-tab="canvas">
          <span class="pulse-h5-tab-icon">❖</span>
          <span>画布</span>
        </button>
        <button class="pulse-h5-tab ${activeTab === 'chat' ? 'is-active' : ''}" data-h5-tab="chat">
          <span class="pulse-h5-tab-icon">✦</span>
          <span>对话</span>
        </button>
      </nav>
    `;

    host.querySelectorAll<HTMLButtonElement>('[data-h5-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const next = btn.dataset.h5Tab as MobileTab;
        if (next) switchTab(next);
      });
    });

    host.querySelectorAll<HTMLButtonElement>('[data-h5-node]').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedNodeId = btn.dataset.h5Node ?? null;
        render();
      });
    });

    const backBtn = host.querySelector<HTMLButtonElement>('[data-h5-action="back"]');
    backBtn?.addEventListener('click', () => {
      selectedNodeId = null;
      render();
    });

    const askBtn = host.querySelector<HTMLButtonElement>('[data-h5-action="ask-node"]');
    askBtn?.addEventListener('click', () => {
      switchTab('chat');
    });

    const wsSelect = host.querySelector<HTMLSelectElement>('#pulse-h5-ws-select');
    wsSelect?.addEventListener('change', () => {
      activeWorkspaceId = wsSelect.value;
      selectedNodeId = null;
      void api.store.save('__workspaces__', { activeId: activeWorkspaceId });
      void refreshCanvas();
    });

    const searchInput = host.querySelector<HTMLInputElement>('#pulse-h5-search');
    searchInput?.addEventListener('input', () => {
      searchQuery = searchInput.value;
      render();
      const nextInput = host.querySelector<HTMLInputElement>('#pulse-h5-search');
      if (nextInput) {
        nextInput.focus();
        nextInput.setSelectionRange(searchQuery.length, searchQuery.length);
      }
    });
  }

  syncModeDataset();
  render();
  void refreshWorkspaces();

  const unsubscribe = api.store.onExternalUpdate((event) => {
    if (event.workspaceId === activeWorkspaceId) {
      void refreshCanvas();
    }
  });

  return () => {
    unsubscribe();
    host.remove();
    delete document.documentElement.dataset.pulseH5Tab;
  };
}
