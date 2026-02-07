import { useState, useEffect, useMemo } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

type Props = {
  filePath: string;
  rpc: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
};

export function PDFViewer({ filePath, rpc }: Props) {
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);

    rpc('fs.readBinary', { path: filePath })
      .then((res) => {
        const result = res as { content: string };
        const binaryString = atob(result.content);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        setPdfData(bytes);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, [filePath, rpc]);

  function onDocumentLoadSuccess({ numPages }: { numPages: number }) {
    setNumPages(numPages);
    setPageNumber(1);
  }

  const goToPrevPage = () => setPageNumber(p => Math.max(1, p - 1));
  const goToNextPage = () => setPageNumber(p => Math.min(numPages, p + 1));

  const file = useMemo(() => pdfData ? { data: pdfData } : null, [pdfData]);

  if (loading) return <div className="pdf-viewer">loading pdf...</div>;
  if (error) return <div className="pdf-viewer">failed to load pdf: {error}</div>;
  if (!file) return null;

  return (
    <div className="pdf-viewer">
      <div className="pdf-controls">
        <button onClick={goToPrevPage} disabled={pageNumber <= 1}>←</button>
        <span>Page {pageNumber} of {numPages}</span>
        <button onClick={goToNextPage} disabled={pageNumber >= numPages}>→</button>
      </div>
      <div className="pdf-content">
        <Document
          file={file}
          onLoadSuccess={onDocumentLoadSuccess}
          onLoadError={(error) => console.error('pdf load error:', error)}
        >
          <Page pageNumber={pageNumber} />
        </Document>
      </div>
    </div>
  );
}
