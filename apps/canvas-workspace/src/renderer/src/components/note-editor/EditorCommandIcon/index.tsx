import {
  CalendarBlank,
  CheckSquare,
  CodeBlock,
  HighlighterCircle,
  ImageSquare,
  Lightbulb,
  LinkSimple,
  ListBullets,
  ListNumbers,
  Minus,
  Quotes,
  Table,
  TextHOne,
  TextHThree,
  TextHTwo,
  TextStrikethrough,
  TextT,
  TextUnderline,
} from '@phosphor-icons/react';
import type { SlashCommandIconId } from '../../../editor/slashCommands';

const COMMAND_ICONS = {
  text: TextT,
  h1: TextHOne,
  h2: TextHTwo,
  h3: TextHThree,
  ul: ListBullets,
  ol: ListNumbers,
  task: CheckSquare,
  quote: Quotes,
  callout: Lightbulb,
  code: CodeBlock,
  table: Table,
  image: ImageSquare,
  divider: Minus,
  date: CalendarBlank,
  link: LinkSimple,
  highlight: HighlighterCircle,
  underline: TextUnderline,
  strike: TextStrikethrough,
} satisfies Record<SlashCommandIconId, typeof TextT>;

interface Props {
  icon: SlashCommandIconId;
  size?: number;
}

export const EditorCommandIcon = ({ icon, size = 18 }: Props) => {
  const Icon = COMMAND_ICONS[icon];
  return <Icon size={size} weight="regular" aria-hidden="true" />;
};
