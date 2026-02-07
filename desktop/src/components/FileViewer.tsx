import { useState, useEffect } from 'react';
import { CodeViewer } from './viewers/CodeViewer';
import { MarkdownViewer } from './viewers/MarkdownViewer';
import { PDFViewer } from './viewers/PDFViewer';
import { ExcelViewer } from './viewers/ExcelViewer';

type Props = {
  filePath: string;
  rpc: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  onClose: () => void;
};

type FileType = 'code' | 'markdown' | 'pdf' | 'excel' | 'unsupported';

const CODE_EXTENSIONS = [
  'js', 'jsx', 'ts', 'tsx', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'hpp',
  'css', 'html', 'json', 'xml', 'yaml', 'yml', 'toml', 'sh', 'bash', 'zsh',
  'rb', 'php', 'swift', 'kt', 'scala', 'sql', 'r', 'lua', 'vim', 'txt', 'log',
];

const EXCEL_EXTENSIONS = ['xlsx', 'xls', 'csv'];

function getFileType(path: string): FileType {
  const ext = path.split('.').pop()?.toLowerCase();
  if (!ext) return 'unsupported';

  if (ext === 'md') return 'markdown';
  if (ext === 'pdf') return 'pdf';
  if (EXCEL_EXTENSIONS.includes(ext)) return 'excel';
  if (CODE_EXTENSIONS.includes(ext)) return 'code';

  return 'unsupported';
}

function getFileName(path: string): string {
  return path.split('/').pop() || path;
}

export function FileViewer({ filePath, rpc, onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState<string>('');
  const fileType = getFileType(filePath);
  const fileName = getFileName(filePath);

  useEffect(() => {
    if (fileType === 'unsupported') {
      setLoading(false);
      setError('File type not supported for preview');
      return;
    }

    // pdf and excel handle their own file reading
    if (fileType === 'pdf' || fileType === 'excel') {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    rpc('fs.read', { path: filePath })
      .then((res) => {
        const result = res as { content: string };
        setContent(result.content);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, [filePath, rpc, fileType]);

  const renderViewer = () => {
    if (loading) {
      return <div className="file-viewer-loading">Loading...</div>;
    }

    if (error) {
      return <div className="file-viewer-error">Error: {error}</div>;
    }

    switch (fileType) {
      case 'code':
        return <CodeViewer content={content} filePath={filePath} />;
      case 'markdown':
        return <MarkdownViewer content={content} />;
      case 'pdf':
        return <PDFViewer filePath={filePath} />;
      case 'excel':
        return <ExcelViewer filePath={filePath} rpc={rpc} />;
      default:
        return <div className="file-viewer-unsupported">Unsupported file type</div>;
    }
  };

  return (
    <div className="file-viewer">
      <div className="file-viewer-header">
        <span className="file-viewer-title">{fileName}</span>
        <button className="file-viewer-close" onClick={onClose}>✕</button>
      </div>
      <div className="file-viewer-body">
        {renderViewer()}
      </div>
    </div>
  );
}
