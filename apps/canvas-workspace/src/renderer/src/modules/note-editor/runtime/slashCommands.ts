import type { Editor } from '@tiptap/react';
import type { I18nKey } from '../../../i18n';

export type SlashCommandGroupId = 'basic' | 'lists' | 'media' | 'advanced' | 'inline';

export type SlashCommandIconId =
  | 'text'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'ul'
  | 'ol'
  | 'task'
  | 'quote'
  | 'callout'
  | 'code'
  | 'table'
  | 'image'
  | 'divider'
  | 'date'
  | 'link'
  | 'highlight'
  | 'underline'
  | 'strike';

export interface SlashCmdContext {
  /** Called when a command needs the user to supply a URL (link, etc.). */
  requestLink?: (initial: string) => void;
  /** Called when a command needs to pick an image file to insert. */
  requestImage?: () => void;
}

export interface SlashCmd {
  id: string;
  group: SlashCommandGroupId;
  labelKey: I18nKey;
  descKey: I18nKey;
  icon: SlashCommandIconId;
  aliases: readonly string[];
  /** Marks commands shown by the selection toolbar's block-type picker.
   * Keeping active-state detection beside the command avoids a second,
   * drifting switch whenever a new block type is added. */
  isBlockTypeActive?: (editor: Editor) => boolean;
  run: (editor: Editor, from: number, to: number, ctx?: SlashCmdContext) => void;
}

export interface SlashCommandGroup {
  id: SlashCommandGroupId;
  labelKey: I18nKey;
  items: SlashCmd[];
}

export interface SlashQueryMatch {
  query: string;
  slashFrom: number;
}

export const SLASH_COMMAND_GROUP_ORDER: readonly SlashCommandGroupId[] = [
  'basic',
  'lists',
  'media',
  'advanced',
  'inline',
];

const GROUP_LABEL_KEYS: Record<SlashCommandGroupId, I18nKey> = {
  basic: 'slashCommand.group.basic',
  lists: 'slashCommand.group.lists',
  media: 'slashCommand.group.media',
  advanced: 'slashCommand.group.advanced',
  inline: 'slashCommand.group.inline',
};

const deleteSlash = (editor: Editor, from: number, to: number) =>
  editor.chain().focus().deleteRange({ from, to });

export const ALL_SLASH_COMMANDS: SlashCmd[] = [
  {
    id: 'text',
    group: 'basic',
    labelKey: 'slashCommand.text.label',
    descKey: 'slashCommand.text.desc',
    icon: 'text',
    aliases: ['text', 'paragraph', 'plain', '正文', '文本', '段落'],
    isBlockTypeActive: (editor) =>
      editor.isActive('paragraph')
      && !editor.isActive('bulletList')
      && !editor.isActive('orderedList')
      && !editor.isActive('taskList')
      && !editor.isActive('blockquote')
      && !editor.isActive('callout')
      && !editor.isActive('codeBlock'),
    run: (editor, from, to) => deleteSlash(editor, from, to).clearNodes().run(),
  },
  {
    id: 'h1',
    group: 'basic',
    labelKey: 'slashCommand.h1.label',
    descKey: 'slashCommand.h1.desc',
    icon: 'h1',
    aliases: ['heading 1', 'h1', 'title', '一级标题', '大标题', '标题'],
    isBlockTypeActive: (editor) => editor.isActive('heading', { level: 1 }),
    run: (editor, from, to) =>
      deleteSlash(editor, from, to).clearNodes().toggleHeading({ level: 1 }).run(),
  },
  {
    id: 'h2',
    group: 'basic',
    labelKey: 'slashCommand.h2.label',
    descKey: 'slashCommand.h2.desc',
    icon: 'h2',
    aliases: ['heading 2', 'h2', 'subtitle', '二级标题', '中标题', '标题'],
    isBlockTypeActive: (editor) => editor.isActive('heading', { level: 2 }),
    run: (editor, from, to) =>
      deleteSlash(editor, from, to).clearNodes().toggleHeading({ level: 2 }).run(),
  },
  {
    id: 'h3',
    group: 'basic',
    labelKey: 'slashCommand.h3.label',
    descKey: 'slashCommand.h3.desc',
    icon: 'h3',
    aliases: ['heading 3', 'h3', '三级标题', '小标题', '标题'],
    isBlockTypeActive: (editor) => editor.isActive('heading', { level: 3 }),
    run: (editor, from, to) =>
      deleteSlash(editor, from, to).clearNodes().toggleHeading({ level: 3 }).run(),
  },
  {
    id: 'ul',
    group: 'lists',
    labelKey: 'slashCommand.ul.label',
    descKey: 'slashCommand.ul.desc',
    icon: 'ul',
    aliases: ['bullet list', 'bulleted list', 'unordered list', '项目列表', '无序列表'],
    isBlockTypeActive: (editor) => editor.isActive('bulletList'),
    run: (editor, from, to) =>
      deleteSlash(editor, from, to).clearNodes().toggleBulletList().run(),
  },
  {
    id: 'ol',
    group: 'lists',
    labelKey: 'slashCommand.ol.label',
    descKey: 'slashCommand.ol.desc',
    icon: 'ol',
    aliases: ['numbered list', 'ordered list', '编号列表', '有序列表'],
    isBlockTypeActive: (editor) => editor.isActive('orderedList'),
    run: (editor, from, to) =>
      deleteSlash(editor, from, to).clearNodes().toggleOrderedList().run(),
  },
  {
    id: 'task',
    group: 'lists',
    labelKey: 'slashCommand.task.label',
    descKey: 'slashCommand.task.desc',
    icon: 'task',
    aliases: ['task list', 'todo', 'to-do', 'checklist', '待办事项', '任务列表'],
    isBlockTypeActive: (editor) => editor.isActive('taskList'),
    run: (editor, from, to) =>
      deleteSlash(editor, from, to).clearNodes().toggleTaskList().run(),
  },
  {
    id: 'image',
    group: 'media',
    labelKey: 'slashCommand.image.label',
    descKey: 'slashCommand.image.desc',
    icon: 'image',
    aliases: ['image', 'photo', 'picture', 'insert image', '图片', '插图', '照片'],
    run: (editor, from, to, context) => {
      deleteSlash(editor, from, to).run();
      context?.requestImage?.();
    },
  },
  {
    id: 'quote',
    group: 'advanced',
    labelKey: 'slashCommand.quote.label',
    descKey: 'slashCommand.quote.desc',
    icon: 'quote',
    aliases: ['quote', 'blockquote', 'quotation', '引用', '引用块'],
    isBlockTypeActive: (editor) => editor.isActive('blockquote'),
    run: (editor, from, to) =>
      deleteSlash(editor, from, to).clearNodes().toggleBlockquote().run(),
  },
  {
    id: 'callout',
    group: 'advanced',
    labelKey: 'slashCommand.callout.label',
    descKey: 'slashCommand.callout.desc',
    icon: 'callout',
    aliases: ['callout', 'notice', 'info', '提示块', '标注', '提示'],
    isBlockTypeActive: (editor) => editor.isActive('callout'),
    run: (editor, from, to) =>
      deleteSlash(editor, from, to)
        .clearNodes()
        .wrapIn('callout', { icon: '💡' })
        .run(),
  },
  {
    id: 'code',
    group: 'advanced',
    labelKey: 'slashCommand.code.label',
    descKey: 'slashCommand.code.desc',
    icon: 'code',
    aliases: ['code block', 'code', 'snippet', '代码块', '代码'],
    isBlockTypeActive: (editor) => editor.isActive('codeBlock'),
    run: (editor, from, to) =>
      deleteSlash(editor, from, to).clearNodes().toggleCodeBlock().run(),
  },
  {
    id: 'table',
    group: 'advanced',
    labelKey: 'slashCommand.table.label',
    descKey: 'slashCommand.table.desc',
    icon: 'table',
    aliases: ['table', 'grid', 'spreadsheet', '表格'],
    run: (editor, from, to) =>
      deleteSlash(editor, from, to)
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run(),
  },
  {
    id: 'hr',
    group: 'advanced',
    labelKey: 'slashCommand.hr.label',
    descKey: 'slashCommand.hr.desc',
    icon: 'divider',
    aliases: ['divider', 'horizontal rule', 'separator', 'hr', '分割线', '分隔线'],
    run: (editor, from, to) => deleteSlash(editor, from, to).setHorizontalRule().run(),
  },
  {
    id: 'date',
    group: 'advanced',
    labelKey: 'slashCommand.date.label',
    descKey: 'slashCommand.date.desc',
    icon: 'date',
    aliases: ['date', 'today', 'calendar', '日期', '今天'],
    run: (editor, from, to) =>
      deleteSlash(editor, from, to).insertContent(new Date().toLocaleDateString()).run(),
  },
  {
    id: 'link',
    group: 'inline',
    labelKey: 'slashCommand.link.label',
    descKey: 'slashCommand.link.desc',
    icon: 'link',
    aliases: ['link', 'url', 'hyperlink', '链接', '超链接'],
    run: (editor, from, to, context) => {
      deleteSlash(editor, from, to).run();
      const previousHref = (editor.getAttributes('link')?.href as string | undefined) ?? '';
      context?.requestLink?.(previousHref);
    },
  },
  {
    id: 'highlight',
    group: 'inline',
    labelKey: 'slashCommand.highlight.label',
    descKey: 'slashCommand.highlight.desc',
    icon: 'highlight',
    aliases: ['highlight', 'mark', '高亮', '标记'],
    run: (editor, from, to) => deleteSlash(editor, from, to).toggleHighlight().run(),
  },
  {
    id: 'underline',
    group: 'inline',
    labelKey: 'slashCommand.underline.label',
    descKey: 'slashCommand.underline.desc',
    icon: 'underline',
    aliases: ['underline', 'u', '下划线'],
    run: (editor, from, to) => deleteSlash(editor, from, to).toggleUnderline().run(),
  },
  {
    id: 'strike',
    group: 'inline',
    labelKey: 'slashCommand.strike.label',
    descKey: 'slashCommand.strike.desc',
    icon: 'strike',
    aliases: ['strikethrough', 'strike', 's', '删除线'],
    run: (editor, from, to) => deleteSlash(editor, from, to).toggleStrike().run(),
  },
];

const normalizeQuery = (value: string): string =>
  value.normalize('NFKC').toLocaleLowerCase().trim().replace(/\s+/g, ' ');

export const filterCmds = (query: string): SlashCmd[] => {
  const normalized = normalizeQuery(query);
  if (!normalized) return ALL_SLASH_COMMANDS;

  const tokens = normalized.split(' ');
  return ALL_SLASH_COMMANDS.filter((command) => {
    const searchable = normalizeQuery([command.id, ...command.aliases].join(' '));
    return tokens.every((token) => searchable.includes(token));
  });
};

export const groupSlashCommands = (items: SlashCmd[]): SlashCommandGroup[] =>
  SLASH_COMMAND_GROUP_ORDER
    .map((id) => ({
      id,
      labelKey: GROUP_LABEL_KEYS[id],
      items: items.filter((item) => item.group === id),
    }))
    .filter((group) => group.items.length > 0);

export const parseSlashQuery = (
  textBeforeCursor: string,
  cursorPos: number,
): SlashQueryMatch | null => {
  const match = textBeforeCursor.match(/(?:^|\s)\/([^/\n]*)$/u);
  if (!match) return null;

  const query = match[1] ?? '';
  return {
    query,
    slashFrom: cursorPos - query.length - 1,
  };
};
