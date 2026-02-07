import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

type Props = {
  content: string;
  filePath: string;
};

function getLanguage(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();

  const langMap: Record<string, string> = {
    'js': 'javascript',
    'jsx': 'jsx',
    'ts': 'typescript',
    'tsx': 'tsx',
    'py': 'python',
    'rs': 'rust',
    'go': 'go',
    'java': 'java',
    'c': 'c',
    'cpp': 'cpp',
    'h': 'c',
    'hpp': 'cpp',
    'css': 'css',
    'html': 'html',
    'json': 'json',
    'xml': 'xml',
    'yaml': 'yaml',
    'yml': 'yaml',
    'toml': 'toml',
    'sh': 'bash',
    'bash': 'bash',
    'zsh': 'bash',
    'rb': 'ruby',
    'php': 'php',
    'swift': 'swift',
    'kt': 'kotlin',
    'scala': 'scala',
    'sql': 'sql',
    'r': 'r',
    'lua': 'lua',
    'vim': 'vim',
  };

  return langMap[ext || ''] || 'text';
}

export function CodeViewer({ content, filePath }: Props) {
  const language = getLanguage(filePath);

  return (
    <div className="code-viewer">
      <SyntaxHighlighter
        language={language}
        style={vscDarkPlus}
        showLineNumbers
        customStyle={{
          margin: 0,
          padding: '1rem',
          fontSize: '13px',
          lineHeight: '1.5',
          height: '100%',
          overflow: 'auto',
        }}
      >
        {content}
      </SyntaxHighlighter>
    </div>
  );
}
