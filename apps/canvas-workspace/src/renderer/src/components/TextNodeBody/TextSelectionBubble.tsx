import { useCallback, useMemo } from 'react';
import type { Editor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { useI18n } from '../../i18n';
import { HIGHLIGHT_COLOR_PRESETS, TEXT_COLOR_PRESETS } from './colorPresets';

export const TextSelectionBubble = ({ editor, editing }: { editor: Editor; editing: boolean }) => {
  const { t } = useI18n();

  const keepSelection = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const appendBubbleToBody = useCallback(() => document.body, []);

  const bubbleOptions = useMemo(
    () => ({
      strategy: "fixed" as const,
      placement: "top" as const,
      offset: 8,
      flip: true,
      shift: { padding: 8 },
    }),
    []
  );

  const shouldShowBubble = useCallback(
    ({ editor: currentEditor, state }: Parameters<NonNullable<React.ComponentProps<typeof BubbleMenu>["shouldShow"]>>[0]) =>
      editing && currentEditor.isFocused && !state.selection.empty,
    [editing]
  );

  const applyTextColor = useCallback(
    (color: string) => {
      editor.chain().focus().setMark("textColor", { color }).run();
    },
    [editor]
  );

  const applyHighlight = useCallback(
    (color: string) => {
      editor.chain().focus().setHighlight({ color }).run();
    },
    [editor]
  );

  const clearTextColor = useCallback(() => {
    editor.chain().focus().unsetMark("textColor").run();
  }, [editor]);

  const clearHighlight = useCallback(() => {
    editor.chain().focus().unsetHighlight().run();
  }, [editor]);

  const clearInlineStyles = useCallback(() => {
    editor.chain().focus().unsetAllMarks().run();
  }, [editor]);

  return (
    <BubbleMenu
      className="text-selection-bubble-shell"
      editor={editor}
      shouldShow={shouldShowBubble}
      appendTo={appendBubbleToBody}
      updateDelay={0}
      options={bubbleOptions}
    >
      <div
        className="text-selection-bubble"
        role="toolbar"
        aria-label={t('canvas.textStyle.inlineFormatting')}
        onMouseDown={keepSelection}
      >
        <div className="text-selection-bubble__group">
          <button
            type="button"
            className={`text-selection-bubble__button${editor.isActive("bold") ? " text-selection-bubble__button--active" : ""}`}
            title={t('canvas.textStyle.bold')}
            aria-label={t('canvas.textStyle.bold')}
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            <strong>B</strong>
          </button>
          <button
            type="button"
            className={`text-selection-bubble__button${editor.isActive("italic") ? " text-selection-bubble__button--active" : ""}`}
            title={t('canvas.textStyle.italic')}
            aria-label={t('canvas.textStyle.italic')}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            <em>I</em>
          </button>
          <button
            type="button"
            className={`text-selection-bubble__button${editor.isActive("underline") ? " text-selection-bubble__button--active" : ""}`}
            title={t('canvas.textStyle.underline')}
            aria-label={t('canvas.textStyle.underline')}
            onClick={() => editor.chain().focus().toggleUnderline().run()}
          >
            <span className="text-selection-bubble__underline">U</span>
          </button>
        </div>

        <div className="text-selection-bubble__divider" />

        <div
          className="text-selection-bubble__group"
          aria-label={t('canvas.textStyle.selectionTextColor')}
        >
          {TEXT_COLOR_PRESETS.map((preset) => {
            const active = editor.isActive("textColor", { color: preset.value });
            return (
              <button
                type="button"
                key={preset.name}
                className={`text-selection-bubble__swatch text-selection-bubble__swatch--text${active ? " text-selection-bubble__swatch--active" : ""}`}
                style={{ color: preset.value }}
                title={t('canvas.textStyle.selectionTextColorOption', { name: preset.name })}
                aria-label={t('canvas.textStyle.selectionTextColorOption', { name: preset.name })}
                aria-pressed={active}
                onClick={() => applyTextColor(preset.value)}
              >
                A
              </button>
            );
          })}
          <button
            type="button"
            className="text-selection-bubble__swatch text-selection-bubble__swatch--clear"
            title={t('canvas.textStyle.clearTextColor')}
            aria-label={t('canvas.textStyle.clearTextColor')}
            onClick={clearTextColor}
          />
        </div>

        <div className="text-selection-bubble__divider" />

        <div
          className="text-selection-bubble__group"
          aria-label={t('canvas.textStyle.selectionHighlight')}
        >
          {HIGHLIGHT_COLOR_PRESETS.map((preset) => {
            const active = editor.isActive("highlight", { color: preset.value });
            return (
              <button
                type="button"
                key={preset.name}
                className={`text-selection-bubble__swatch text-selection-bubble__swatch--highlight${active ? " text-selection-bubble__swatch--active" : ""}`}
                style={{ backgroundColor: preset.value }}
                title={t('canvas.textStyle.selectionHighlightOption', { name: preset.name })}
                aria-label={t('canvas.textStyle.selectionHighlightOption', { name: preset.name })}
                aria-pressed={active}
                onClick={() => applyHighlight(preset.value)}
              />
            );
          })}
          <button
            type="button"
            className="text-selection-bubble__swatch text-selection-bubble__swatch--clear"
            title={t('canvas.textStyle.clearHighlight')}
            aria-label={t('canvas.textStyle.clearHighlight')}
            onClick={clearHighlight}
          />
        </div>

        <div className="text-selection-bubble__divider" />

        <button
          type="button"
          className="text-selection-bubble__button text-selection-bubble__button--clear"
          title={t('canvas.textStyle.clearInlineStyles')}
          aria-label={t('canvas.textStyle.clearInlineStyles')}
          onClick={clearInlineStyles}
        >
          Tx
        </button>
      </div>
    </BubbleMenu>
  );
};
