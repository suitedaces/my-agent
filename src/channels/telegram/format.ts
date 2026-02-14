// convert markdown to telegram-compatible HTML
// handles the case where the agent outputs markdown instead of HTML tags

export function markdownToTelegramHtml(text: string): string {
  let result = text;

  // protect existing HTML tags so we don't double-process them
  const htmlTags: string[] = [];
  result = result.replace(/<(\/?)(\w+)([^>]*)>/g, (match) => {
    const idx = htmlTags.length;
    htmlTags.push(match);
    return `\x00HT${idx}\x00`;
  });

  // protect code blocks first (```lang\ncode\n```)
  const codeBlocks: string[] = [];
  result = result.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const idx = codeBlocks.length;
    const escaped = escapeHtml(code.trimEnd());
    const langAttr = lang ? ` class="language-${lang}"` : '';
    codeBlocks.push(`<pre><code${langAttr}>${escaped}</code></pre>`);
    return `\x00CB${idx}\x00`;
  });

  // protect inline code (`code`)
  const inlineCodes: string[] = [];
  result = result.replace(/`([^`\n]+)`/g, (_, code) => {
    const idx = inlineCodes.length;
    inlineCodes.push(`<code>${escapeHtml(code)}</code>`);
    return `\x00IC${idx}\x00`;
  });

  // protect markdown links before escaping (so URLs with & don't get mangled)
  const links: string[] = [];
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => {
    const idx = links.length;
    links.push(`<a href="${url}">${escapeHtml(text)}</a>`);
    return `\x00LK${idx}\x00`;
  });

  // escape HTML entities in remaining text
  result = escapeHtml(result);

  // spoiler ||text||
  result = result.replace(/\|\|(.+?)\|\|/g, '<tg-spoiler>$1</tg-spoiler>');

  // bold **text** or __text__
  result = result.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  result = result.replace(/__(.+?)__/g, '<b>$1</b>');

  // italic *text* or _text_ (not mid-word)
  result = result.replace(/(?<!\w)\*([^*\n]+?)\*(?!\w)/g, '<i>$1</i>');
  result = result.replace(/(?<!\w)_([^_\n]+?)_(?!\w)/g, '<i>$1</i>');

  // strikethrough ~~text~~
  result = result.replace(/~~(.+?)~~/g, '<s>$1</s>');

  // headings → bold (telegram has no heading tags)
  result = result.replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>');

  // blockquotes > text
  result = result.replace(/^&gt;\s?(.+)$/gm, '<blockquote>$1</blockquote>');
  // merge adjacent blockquotes
  result = result.replace(/<\/blockquote>\n<blockquote>/g, '\n');

  // make long blockquotes expandable (>500 chars)
  result = result.replace(/<blockquote>([\s\S]{500,}?)<\/blockquote>/g, '<blockquote expandable>$1</blockquote>');

  // restore protected blocks
  result = result.replace(/\x00CB(\d+)\x00/g, (_, idx) => codeBlocks[Number(idx)]);
  result = result.replace(/\x00IC(\d+)\x00/g, (_, idx) => inlineCodes[Number(idx)]);
  result = result.replace(/\x00LK(\d+)\x00/g, (_, idx) => links[Number(idx)]);
  result = result.replace(/\x00HT(\d+)\x00/g, (_, idx) => htmlTags[Number(idx)]);

  return result;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
