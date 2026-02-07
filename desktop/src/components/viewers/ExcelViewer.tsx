import { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';

type Props = {
  filePath: string;
  rpc: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
};

type SheetData = {
  name: string;
  data: (string | number)[][];
};

export function ExcelViewer({ filePath, rpc }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sheets, setSheets] = useState<SheetData[]>([]);
  const [activeSheet, setActiveSheet] = useState(0);

  useEffect(() => {
    setLoading(true);
    setError(null);

    // read file as binary via RPC
    rpc('fs.readBinary', { path: filePath })
      .then((res) => {
        const result = res as { content: string };
        const base64 = result.content;

        // convert base64 to array buffer
        const binaryString = atob(base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        // parse excel file
        const workbook = XLSX.read(bytes, { type: 'array' });
        const sheetData: SheetData[] = [];

        for (const sheetName of workbook.SheetNames) {
          const worksheet = workbook.Sheets[sheetName];
          const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as (string | number)[][];
          sheetData.push({ name: sheetName, data });
        }

        setSheets(sheetData);
        setActiveSheet(0);
        setLoading(false);
      })
      .catch(err => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, [filePath, rpc]);

  if (loading) {
    return <div className="excel-viewer-loading">loading excel file...</div>;
  }

  if (error) {
    return (
      <div className="excel-viewer-error">
        <p>failed to load excel file</p>
        <p style={{ fontSize: '12px', marginTop: '8px', opacity: 0.7 }}>{error}</p>
      </div>
    );
  }

  if (sheets.length === 0) {
    return <div className="excel-viewer-error">no sheets found in file</div>;
  }

  const currentSheet = sheets[activeSheet];

  return (
    <div className="excel-viewer-container">
      {sheets.length > 1 && (
        <div className="excel-sheet-tabs">
          {sheets.map((sheet, i) => (
            <button
              key={i}
              className={`excel-sheet-tab ${i === activeSheet ? 'active' : ''}`}
              onClick={() => setActiveSheet(i)}
            >
              {sheet.name}
            </button>
          ))}
        </div>
      )}
      <div className="excel-table-wrapper">
        <table className="excel-table">
          <tbody>
            {currentSheet.data.map((row, rowIdx) => (
              <tr key={rowIdx}>
                {row.map((cell, cellIdx) => (
                  <td key={cellIdx}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
