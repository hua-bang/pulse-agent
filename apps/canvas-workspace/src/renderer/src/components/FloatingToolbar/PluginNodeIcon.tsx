function isImageIcon(icon: string): boolean {
  return /^(https?:|data:image\/|pulse-canvas:)/i.test(icon);
}

function isEmojiIcon(icon: string): boolean {
  const chars = Array.from(icon.trim());
  return chars.length > 0 && chars.length <= 2 && !/^[a-z0-9_.:/-]+$/i.test(icon);
}

export function inferPluginIcon(nodeType: string): string {
  if (nodeType.includes('todo')) return 'todo';
  if (nodeType.includes('note')) return 'note';
  if (nodeType.includes('excalidraw') || nodeType.includes('board')) return 'excalidraw';
  return 'plugin';
}

export const PluginNodeIcon = ({ icon, size = 18 }: { icon?: string; size?: number }) => {
  const normalized = (icon ?? 'plugin').trim() || 'plugin';
  const token = normalized.toLowerCase();

  if (isImageIcon(normalized)) {
    return (
      <img
        className="plugin-node-icon-media"
        src={normalized}
        alt=""
        aria-hidden="true"
        style={{ width: size, height: size }}
      />
    );
  }

  if (isEmojiIcon(normalized)) {
    return (
      <span
        className="plugin-node-icon-emoji"
        aria-hidden="true"
        style={{ fontSize: Math.max(12, size - 2), width: size, height: size }}
      >
        {normalized}
      </span>
    );
  }

  if (token === 'todo' || token === 'checklist' || token === 'tasks') {
    return (
      <svg width={size} height={size} viewBox="0 0 18 18" fill="none" aria-hidden="true">
        <rect x="3" y="3" width="12" height="12" rx="2.5" stroke="currentColor" strokeWidth="1.25" />
        <path d="M6 7l1.2 1.2L9.3 6M6 12h.1M10 8h2.3M10 12h2.3" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (token === 'note' || token === 'doc' || token === 'document') {
    return (
      <svg width={size} height={size} viewBox="0 0 18 18" fill="none" aria-hidden="true">
        <path d="M5 2.8h5.4L14 6.4V14a1.2 1.2 0 01-1.2 1.2H5A1.2 1.2 0 013.8 14V4A1.2 1.2 0 015 2.8z" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
        <path d="M10.2 3v3.6h3.6M6.4 9.2h5.2M6.4 12h3.6" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (token === 'excalidraw' || token === 'draw' || token === 'board' || token === 'sketch') {
    return (
      <svg width={size} height={size} viewBox="0 0 18 18" fill="none" aria-hidden="true">
        <path d="M3.5 12.7l.8-3.1 5.9-5.9a1.5 1.5 0 012.1 0l.1.1a1.5 1.5 0 010 2.1l-5.9 5.9-3 .9z" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M9.3 4.7l2 2M10.2 13.8h4" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M6.4 2.8h5.2a1.2 1.2 0 011.2 1.2v2.2H15a1.2 1.2 0 011.2 1.2v3.2a1.2 1.2 0 01-1.2 1.2h-2.2V14a1.2 1.2 0 01-1.2 1.2H6.4A1.2 1.2 0 015.2 14v-2.2H3A1.2 1.2 0 011.8 10.6V7.4A1.2 1.2 0 013 6.2h2.2V4a1.2 1.2 0 011.2-1.2z" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
      <path d="M7.2 6.2h3.6v5.6H7.2V6.2z" fill="currentColor" opacity="0.16" />
    </svg>
  );
};
