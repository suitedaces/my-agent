import ReactMarkdown from 'react-markdown';

type Props = {
  content: string;
};

export function MarkdownViewer({ content }: Props) {
  return (
    <div className="markdown-viewer">
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  );
}
