import React, { useMemo } from 'react';
import type { NotePayload, PluginNodeData, PluginNodeViewProps } from './types';

const accents = ['#2383e2', '#0f766e', '#7c3aed', '#c2410c'];

function readPayload(data: unknown): NotePayload {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  const payload = (data as PluginNodeData).payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
  return payload as NotePayload;
}

function normalizePayload(payload: NotePayload): Required<NotePayload> {
  return {
    title: typeof payload.title === 'string' && payload.title.trim()
      ? payload.title
      : 'External React plugin',
    body: typeof payload.body === 'string'
      ? payload.body
      : 'This node view is rendered by a user-owned MF remote.',
    accent: typeof payload.accent === 'string' && payload.accent
      ? payload.accent
      : accents[0],
    pinned: payload.pinned === true,
  };
}

export function NoteNodeView({ node, readOnly, selected, updateNode }: PluginNodeViewProps) {
  const payload = normalizePayload(readPayload(node.data));
  const wordCount = useMemo(
    () => payload.body.trim().split(/\s+/).filter(Boolean).length,
    [payload.body],
  );

  const patchPayload = (patch: Partial<NotePayload>) => {
    if (readOnly) return;
    const data = node.data && typeof node.data === 'object' && !Array.isArray(node.data)
      ? node.data as PluginNodeData
      : {};
    updateNode({
      data: {
        ...data,
        payload: {
          ...payload,
          ...patch,
        },
      },
    });
  };

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        padding: 18,
        boxSizing: 'border-box',
        background: '#fff',
        borderTop: `4px solid ${payload.accent}`,
        boxShadow: selected ? `inset 0 0 0 1px ${payload.accent}` : 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: payload.accent,
              textTransform: 'uppercase',
            }}
          >
            React MF / demo.note
          </div>
          <input
            value={payload.title}
            readOnly={readOnly}
            onChange={(event) => patchPayload({ title: event.target.value })}
            style={{
              marginTop: 8,
              width: '100%',
              border: 0,
              padding: 0,
              outline: 'none',
              background: 'transparent',
              color: '#1f2328',
              fontFamily: 'inherit',
              fontSize: 18,
              fontWeight: 750,
              lineHeight: 1.25,
            }}
          />
        </div>
        <button
          type="button"
          disabled={readOnly}
          onClick={() => patchPayload({ pinned: !payload.pinned })}
          style={{
            height: 30,
            borderRadius: 8,
            border: '1px solid rgba(55, 53, 47, 0.12)',
            background: payload.pinned ? 'rgba(35, 131, 226, 0.1)' : '#fff',
            color: payload.pinned ? payload.accent : 'rgba(55, 53, 47, 0.65)',
            cursor: readOnly ? 'not-allowed' : 'pointer',
            fontSize: 12,
            fontWeight: 700,
            padding: '0 10px',
          }}
        >
          {payload.pinned ? 'Pinned' : 'Pin'}
        </button>
      </div>

      <textarea
        value={payload.body}
        readOnly={readOnly}
        onChange={(event) => patchPayload({ body: event.target.value })}
        style={{
          flex: 1,
          minHeight: 0,
          width: '100%',
          resize: 'none',
          border: '1px solid rgba(55, 53, 47, 0.1)',
          borderRadius: 8,
          padding: 12,
          outline: 'none',
          boxSizing: 'border-box',
          color: '#37352f',
          background: '#fbfbfa',
          fontFamily: 'inherit',
          fontSize: 13,
          lineHeight: 1.5,
        }}
      />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {accents.map((accent) => (
            <button
              key={accent}
              type="button"
              aria-label={`Use ${accent}`}
              disabled={readOnly}
              onClick={() => patchPayload({ accent })}
              style={{
                width: 18,
                height: 18,
                borderRadius: 9,
                border: accent === payload.accent ? '2px solid #1f2328' : '1px solid rgba(55, 53, 47, 0.16)',
                background: accent,
                cursor: readOnly ? 'not-allowed' : 'pointer',
              }}
            />
          ))}
        </div>
        <div style={{ fontSize: 11, color: 'rgba(55, 53, 47, 0.5)' }}>
          {wordCount} words
        </div>
      </div>
    </div>
  );
}
