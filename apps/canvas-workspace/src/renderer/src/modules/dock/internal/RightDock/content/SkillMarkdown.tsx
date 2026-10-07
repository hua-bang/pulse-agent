import MarkdownIt from 'markdown-it';
import { useMemo } from 'react';

const markdown = new MarkdownIt({
  breaks: false,
  html: false,
  linkify: true,
  typographer: false,
});

markdown.renderer.rules.table_open = () => (
  '<div class="skill-detail__table-scroll"><table>'
);
markdown.renderer.rules.table_close = () => '</table></div>';

const defaultHeadingOpen = markdown.renderer.rules.heading_open
  ?? ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options));
markdown.renderer.rules.heading_open = (tokens, index, options, env, self) => {
  const token = tokens[index];
  const level = Number(token.tag.slice(1));
  token.tag = `h${Math.min(level + 1, 6)}`;
  return defaultHeadingOpen(tokens, index, options, env, self);
};
markdown.renderer.rules.heading_close = (tokens, index, options, _env, self) => {
  const token = tokens[index];
  const level = Number(token.tag.slice(1));
  token.tag = `h${Math.min(level + 1, 6)}`;
  return self.renderToken(tokens, index, options);
};

markdown.renderer.rules.image = (tokens, index) => {
  const token = tokens[index];
  const label = token.content.trim() || 'Image';
  const source = token.attrGet('src') ?? '';
  return [
    '<span class="skill-detail__image-placeholder"',
    source ? ` title="${markdown.utils.escapeHtml(source)}"` : '',
    '>',
    markdown.utils.escapeHtml(label),
    '</span>',
  ].join('');
};

const defaultLinkOpen = markdown.renderer.rules.link_open
  ?? ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options));

markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
  const token = tokens[index];
  const href = token.attrGet('href');
  if (href && !href.startsWith('#')) {
    token.attrSet('target', '_blank');
    token.attrSet('rel', 'noreferrer');
  }
  return defaultLinkOpen(tokens, index, options, env, self);
};

interface Props {
  content: string;
}

export const SkillMarkdown = ({ content }: Props) => {
  const html = useMemo(() => markdown.render(content), [content]);

  return (
    <div
      className="skill-detail__markdown"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};
