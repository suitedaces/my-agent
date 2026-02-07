import { useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// configure worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

type Props = {
  filePath: string;
};

export function PDFViewer({ filePath }: Props) {
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState<number>(1);

  function onDocumentLoadSuccess({ numPages }: { numPages: number }) {
    setNumPages(numPages);
    setPageNumber(1);
  }

  const goToPrevPage = () => setPageNumber(p => Math.max(1, p - 1));
  const goToNextPage = () => setPageNumber(p => Math.min(numPages, p + 1));

  return (
    <div className="pdf-viewer">
      <div className="pdf-controls">
        <button onClick={goToPrevPage} disabled={pageNumber <= 1}>←</button>
        <span>Page {pageNumber} of {numPages}</span>
        <button onClick={goToNextPage} disabled={pageNumber >= numPages}>→</button>
      </div>
      <div className="pdf-content">
        <Document
          file={filePath}
          onLoadSuccess={onDocumentLoadSuccess}
          onLoadError={(error) => console.error('pdf load error:', error)}
        >
          <Page pageNumber={pageNumber} />
        </Document>
      </div>
    </div>
  );
}
