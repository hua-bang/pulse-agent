import { useEffect, useMemo, useRef, useState } from 'react';
import { Compartment, EditorState, Transaction, type Extension } from '@codemirror/state';
import {
  EditorView, drawSelection, dropCursor, highlightActiveLine,
  highlightActiveLineGutter, highlightSpecialChars, keymap, lineNumbers,
} from '@codemirror/view';
import { bracketMatching, foldGutter, StreamLanguage } from '@codemirror/language';
import {
  defaultKeymap, history, historyKeymap, indentWithTab,
  redo, redoDepth, undo, undoDepth,
} from '@codemirror/commands';
import { searchKeymap } from '@codemirror/search';
import { ArrowCounterClockwise, ArrowClockwise } from '@phosphor-icons/react';
import { Button, Portal } from '../../../../../components/ui';
import { EditorSearchPanel } from './EditorSearchPanel';
import { useEditorSearchPanel } from './useEditorSearchPanel';
import { editorHighlighting } from './editorHighlight';
import './search-panel.css';
import { useI18n } from '../../../../../i18n';
import { getResolvedTheme, useResolvedTheme } from '../../../../../shared/theme';

interface Props { path: string; content: string; original: string; saving: boolean; onChange: (content: string) => void }

export const syncEditorContent = (view: EditorView, content: string): boolean => {
  if (view.state.doc.toString() === content) return false;
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: content },
    annotations: Transaction.addToHistory.of(false),
  });
  return true;
};

const loadLanguage = async (path: string): Promise<Extension> => {
  const extension = path.split('.').pop()?.toLowerCase() ?? '';
  if (['ts', 'tsx'].includes(extension)) {
    const { typescript } = await import('@codemirror/legacy-modes/mode/javascript');
    return StreamLanguage.define(typescript);
  }
  if (['js', 'jsx', 'mjs', 'cjs'].includes(extension)) {
    const { javascript } = await import('@codemirror/legacy-modes/mode/javascript');
    return StreamLanguage.define(javascript);
  }
  if (['json', 'jsonc'].includes(extension)) {
    const { json } = await import('@codemirror/legacy-modes/mode/javascript');
    return StreamLanguage.define(json);
  }
  if (['yaml', 'yml'].includes(extension)) {
    const { yaml } = await import('@codemirror/legacy-modes/mode/yaml');
    return StreamLanguage.define(yaml);
  }
  if (extension === 'py') {
    const { python } = await import('@codemirror/legacy-modes/mode/python');
    return StreamLanguage.define(python);
  }
  if (['sh', 'bash', 'zsh'].includes(extension)) {
    const { shell } = await import('@codemirror/legacy-modes/mode/shell');
    return StreamLanguage.define(shell);
  }
  if (['css', 'scss', 'less'].includes(extension)) {
    const mode = await import('@codemirror/legacy-modes/mode/css');
    return StreamLanguage.define(extension === 'scss' ? mode.sCSS : extension === 'less' ? mode.less : mode.css);
  }
  if (['html', 'xml', 'svg'].includes(extension)) {
    const mode = await import('@codemirror/legacy-modes/mode/xml');
    return StreamLanguage.define(extension === 'html' ? mode.html : mode.xml);
  }
  if (extension === 'rs') {
    const { rust } = await import('@codemirror/legacy-modes/mode/rust');
    return StreamLanguage.define(rust);
  }
  return [];
};

export const CodeEditor = ({ path, content, original, saving, onChange }: Props) => {
  const { t } = useI18n();
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const editable = useRef(new Compartment());
  const language = useRef(new Compartment());
  const highlighting = useRef(new Compartment());
  const theme = useResolvedTheme();
  const searchPanel = useEditorSearchPanel();
  const [historyState, setHistoryState] = useState({ undo: false, redo: false });
  const separator = original.includes('\r\n') ? '\r\n' : '\n';
  const baseExtensions = useMemo(() => [
    lineNumbers(), highlightActiveLineGutter(), highlightSpecialChars(),
    history(), foldGutter(), drawSelection(), dropCursor(), bracketMatching(),
    highlighting.current.of(editorHighlighting(getResolvedTheme())),
    keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap, ...searchKeymap]),
    searchPanel.extension,
    EditorState.lineSeparator.of(separator),
    EditorState.phrases.of({
      Find: t('folder.search.find'), Replace: t('folder.search.replacePlaceholder'),
      next: t('folder.search.next'), previous: t('folder.search.previous'),
      'match case': t('folder.search.matchCase'), regexp: t('folder.search.regexp'),
      'by word': t('folder.search.wholeWord'), replace: t('folder.search.replace'),
      'replace all': t('folder.search.replaceAll'), close: t('folder.search.close'),
    }),
    EditorView.contentAttributes.of({ 'aria-label': t('folder.editor') }),
    EditorView.updateListener.of(update => {
      if (update.docChanged) onChangeRef.current(update.state.doc.toString());
      const next = { undo: undoDepth(update.state) > 0, redo: redoDepth(update.state) > 0 };
      setHistoryState(previous => previous.undo === next.undo && previous.redo === next.redo ? previous : next);
    }),
    editable.current.of(EditorView.editable.of(!saving)),
    language.current.of([]),
  ], [saving, searchPanel.extension, separator, t]);

  useEffect(() => {
    if (!hostRef.current) return;
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({ doc: content, extensions: baseExtensions }),
    });
    viewRef.current = view;
    return () => { viewRef.current = null; view.destroy(); };
  }, []);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: editable.current.reconfigure(EditorView.editable.of(!saving)) });
  }, [saving]);

  useEffect(() => {
    const view = viewRef.current;
    if (view) syncEditorContent(view, content);
  }, [content]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: highlighting.current.reconfigure(editorHighlighting(theme)) });
  }, [theme]);

  useEffect(() => {
    let current = true;
    void loadLanguage(path).then(extension => {
      if (current) viewRef.current?.dispatch({ effects: language.current.reconfigure(extension) });
    }).catch(() => undefined);
    return () => { current = false; };
  }, [path]);

  return <div className="folder-code-editor"><div ref={hostRef} className="folder-code-editor__mount" />
    {searchPanel.panel && <Portal target={searchPanel.panel.dom}><EditorSearchPanel view={searchPanel.panel.view} revision={searchPanel.panel.revision} /></Portal>}
    {(historyState.undo || historyState.redo) && <div className="folder-editor-history" aria-label={t('folder.history')}>
      <Button variant="icon" size="md" disabled={saving || !historyState.undo} aria-label={t('folder.undo')} title={t('folder.undo')}
        onMouseDown={event => event.preventDefault()} onClick={() => { const view = viewRef.current; if (view) { undo(view); view.focus(); } }}><ArrowCounterClockwise size={16} /></Button>
      <Button variant="icon" size="md" disabled={saving || !historyState.redo} aria-label={t('folder.redo')} title={t('folder.redo')}
        onMouseDown={event => event.preventDefault()} onClick={() => { const view = viewRef.current; if (view) { redo(view); view.focus(); } }}><ArrowClockwise size={16} /></Button>
    </div>}
  </div>;
};
