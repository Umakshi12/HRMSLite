import React, { useState } from 'react';
import { Upload, X, ArrowLeft, CheckCircle2, AlertCircle, FileText, Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import useStore from '../lib/store';
import { importPreview, importValidate, importFinal, getSheetHeaders } from '../lib/api';

// Normalize a string for fuzzy comparison
const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

// Auto-detect: for each sheet column find the closest-matching CSV column
function buildAutoMapping(csvHeaders, sheetHeaders) {
  const normCsv = csvHeaders.map(h => ({ original: h, n: norm(h) }));
  const mapping = {};
  for (const sh of sheetHeaders) {
    const nsh = norm(sh);
    let match = normCsv.find(c => c.n === nsh);
    if (!match) match = normCsv.find(c => c.n.includes(nsh) || nsh.includes(c.n));
    mapping[sh] = match ? match.original : '';
  }
  return mapping;
}

export default function CSVImportWizard({ onClose, effectiveTab }) {
  const [step, setStep] = useState(1);
  const [file, setFile] = useState(null);
  const [csvHeaders, setCsvHeaders] = useState([]);
  const [csvPreview, setCsvPreview] = useState([]);
  const [sheetHeaders, setSheetHeaders] = useState([]);
  const [mapping, setMapping] = useState({});  // { sheetHeader: csvColumn }
  const [validation, setValidation] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const { activeSheet } = useStore();
  const qc = useQueryClient();

  const handleFileUpload = async (e) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;
    if (!selectedFile.name.endsWith('.csv')) { toast.error('Only .csv files are supported'); return; }
    if (selectedFile.size > 10 * 1024 * 1024) { toast.error('File size exceeds 10MB limit'); return; }

    setFile(selectedFile);
    setLoading(true);
    try {
      const [previewData, headersData] = await Promise.all([
        importPreview(selectedFile),
        getSheetHeaders(activeSheet, effectiveTab),
      ]);

      if (!previewData.success) { toast.error(previewData.message || 'Failed to parse CSV'); return; }

      const csvHdrs = previewData.headers;
      // If the sheet has no headers yet, treat the CSV columns as the destination
      const sheetHdrs = headersData.headers?.length ? headersData.headers : csvHdrs;

      setCsvHeaders(csvHdrs);
      setCsvPreview(previewData.preview);
      setSheetHeaders(sheetHdrs);
      setMapping(buildAutoMapping(csvHdrs, sheetHdrs));
      setStep(2);
    } catch (err) {
      toast.error(err.message || 'Error during preview');
    } finally {
      setLoading(false);
    }
  };

  const handleValidate = async () => {
    const mappedCount = Object.values(mapping).filter(Boolean).length;
    if (mappedCount === 0) { toast.error('Map at least one CSV column to a sheet column'); return; }

    setLoading(true);
    try {
      const data = await importValidate(file, mapping, activeSheet, effectiveTab);
      if (data.success) { setValidation(data); setStep(3); }
      else toast.error(data.message || 'Validation failed');
    } catch (err) {
      toast.error(err.message || 'Error during validation');
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async () => {
    setLoading(true);
    try {
      const data = await importFinal(file, mapping, activeSheet, effectiveTab);
      if (data.success) {
        setImportResult(data);
        setStep(4);
        qc.invalidateQueries({ queryKey: ['sheet-data'] });
        qc.invalidateQueries({ queryKey: ['sheet-summary'] });
        toast.success(`Import complete: ${data.imported} rows added`);
      } else {
        toast.error(data.message || 'Import failed');
      }
    } catch (err) {
      toast.error(err.message || 'Error during import');
    } finally {
      setLoading(false);
    }
  };

  const downloadErrorReport = () => {
    if (!validation?.errors?.length) return;
    const csvRows = [
      ['Row', 'Error', ...csvHeaders],
      ...validation.errors.map(err => [err.row, err.reason, ...csvHeaders.map(h => err.data[h] || '')])
    ];
    const content = 'data:text/csv;charset=utf-8,' + csvRows.map(r => r.join(',')).join('\n');
    const link = document.createElement('a');
    link.href = encodeURI(content);
    link.download = `import_errors_${Date.now()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const mappedCount = Object.values(mapping).filter(Boolean).length;

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-2xl w-full max-w-4xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Bulk CSV Import</h2>
            <p className="text-xs text-slate-500">Importing into <strong>{activeSheet}</strong></p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Stepper */}
        <div className="px-6 py-3 bg-slate-50 flex items-center border-b border-slate-100">
          {['Upload', 'Map Columns', 'Validate', 'Done'].map((label, i) => (
            <div key={label} className="flex items-center gap-2">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${step > i + 1 ? 'bg-green-500 text-white' : step === i + 1 ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-500'}`}>
                {step > i + 1 ? <CheckCircle2 className="w-4 h-4" /> : i + 1}
              </div>
              <span className={`text-xs font-semibold ${step >= i + 1 ? 'text-slate-800' : 'text-slate-400'}`}>{label}</span>
              {i < 3 && <div className="w-8 h-[2px] bg-slate-200 mx-2" />}
            </div>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 min-h-[400px]">

          {/* Step 1 — Upload */}
          {step === 1 && (
            <div className="flex flex-col items-center justify-center h-full py-10">
              <div className="w-20 h-20 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mb-4">
                <Upload className="w-10 h-10" />
              </div>
              <h3 className="text-base font-bold text-slate-800 mb-2">Upload CSV File</h3>
              <p className="text-sm text-slate-500 mb-6 text-center max-w-sm">
                Any CSV file works — columns will be mapped to <strong>{activeSheet}</strong>'s headers in the next step.
              </p>
              <label className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-xl font-bold text-sm cursor-pointer transition shadow-lg shadow-blue-200 flex items-center gap-2">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                Select CSV File
                <input type="file" accept=".csv" className="hidden" onChange={handleFileUpload} disabled={loading} />
              </label>
            </div>
          )}

          {/* Step 2 — Column Mapping */}
          {step === 2 && (
            <div className="space-y-6">
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                <p className="text-xs text-blue-800 leading-relaxed">
                  Map each <strong>sheet column</strong> (left) to the best <strong>CSV column</strong> (right).
                  Auto-detect has pre-filled obvious matches. Set to "— Skip —" to leave a column blank.
                  <span className="ml-1 font-bold">{mappedCount} of {sheetHeaders.length} mapped.</span>
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {sheetHeaders.map(sh => (
                  <div key={sh} className={`p-3 rounded-xl border transition ${mapping[sh] ? 'border-green-200 bg-green-50/30' : 'border-slate-100 hover:border-blue-200'}`}>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5 flex items-center justify-between">
                      <span className="truncate">{sh}</span>
                      {mapping[sh] && <span className="text-[10px] text-green-600 font-mono shrink-0 ml-1">✓ mapped</span>}
                    </label>
                    <select
                      value={mapping[sh] || ''}
                      onChange={e => setMapping({ ...mapping, [sh]: e.target.value })}
                      className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs outline-none focus:border-blue-500"
                    >
                      <option value="">— Skip —</option>
                      {csvHeaders.map(h => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              {/* CSV Preview */}
              <div className="mt-4">
                <h4 className="text-xs font-bold text-slate-500 mb-3 uppercase tracking-wider">CSV Preview (first 5 rows)</h4>
                <div className="overflow-x-auto border border-slate-100 rounded-xl">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-50">
                      <tr>{csvHeaders.map(h => <th key={h} className="px-3 py-2 border-b border-slate-100 font-bold text-slate-600 whitespace-nowrap">{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {csvPreview.map((row, i) => (
                        <tr key={i}>
                          {csvHeaders.map(h => <td key={h} className="px-3 py-2 border-b border-slate-100 text-slate-500 whitespace-nowrap">{row[h]}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Step 3 — Validation */}
          {step === 3 && validation && (
            <div className="space-y-6">
              <div className="flex items-center gap-6">
                <div className="flex-1 bg-green-50 border border-green-100 rounded-2xl p-6 text-center">
                  <div className="text-3xl font-black text-green-600 mb-1">{validation.validCount}</div>
                  <div className="text-xs font-bold text-green-700 uppercase">Valid Rows</div>
                </div>
                <div className="flex-1 bg-red-50 border border-red-100 rounded-2xl p-6 text-center">
                  <div className="text-3xl font-black text-red-500 mb-1">{validation.errorCount}</div>
                  <div className="text-xs font-bold text-red-700 uppercase">Skipped Rows</div>
                </div>
              </div>

              {validation.errors.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Skipped Rows</h4>
                    <button onClick={downloadErrorReport} className="text-blue-600 text-xs font-bold hover:underline flex items-center gap-1">
                      <Download className="w-3.5 h-3.5" /> Download Report
                    </button>
                  </div>
                  <div className="bg-slate-50 border border-slate-100 rounded-xl max-h-60 overflow-y-auto">
                    {validation.errors.map((err, i) => (
                      <div key={i} className="px-4 py-3 border-b border-slate-100 last:border-0 flex items-start gap-3">
                        <span className="bg-red-100 text-red-700 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold mt-0.5">Row {err.row}</span>
                        <span className="text-xs text-slate-600">{err.reason}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
                <p className="text-xs text-amber-800">
                  <strong>{validation.validCount} rows</strong> will be imported into <strong>{activeSheet}</strong>. Empty rows are skipped.
                </p>
              </div>
            </div>
          )}

          {/* Step 4 — Result */}
          {step === 4 && importResult && (
            <div className="flex flex-col items-center justify-center h-full py-10">
              <div className="w-20 h-20 bg-green-50 text-green-600 rounded-full flex items-center justify-center mb-6">
                <CheckCircle2 className="w-10 h-10" />
              </div>
              <h3 className="text-xl font-black text-slate-800 mb-2">Import Successful!</h3>
              <p className="text-sm text-slate-500 mb-8 text-center max-w-sm">
                The spreadsheet has been updated.
              </p>
              <div className="grid grid-cols-3 gap-8 w-full max-w-md mb-10">
                <div className="text-center">
                  <div className="text-2xl font-black text-slate-800">{importResult.imported}</div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase">Imported</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-black text-red-500">{importResult.failed ?? 0}</div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase">Failed</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-black text-amber-500">{importResult.skipped ?? 0}</div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase">Skipped</div>
                </div>
              </div>
              <button onClick={onClose} className="bg-slate-800 hover:bg-slate-900 text-white px-8 py-3 rounded-xl font-bold text-sm transition">
                Done
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        {step < 4 && (
          <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between bg-slate-50/50">
            <button
              disabled={step === 1 || loading}
              onClick={() => setStep(s => s - 1)}
              className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-slate-600 hover:text-slate-800 disabled:opacity-30"
            >
              <ArrowLeft className="w-4 h-4" /> Back
            </button>

            {step === 2 && (
              <button
                disabled={loading || mappedCount === 0}
                onClick={handleValidate}
                className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-xl font-bold text-sm transition flex items-center gap-2 disabled:opacity-50"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                Validate {mappedCount} Mapped Column{mappedCount !== 1 ? 's' : ''}
              </button>
            )}

            {step === 3 && (
              <button
                disabled={loading || !validation?.validCount}
                onClick={handleImport}
                className="bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded-xl font-bold text-sm transition flex items-center gap-2 disabled:opacity-50 shadow-lg shadow-green-100"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                Import {validation?.validCount ?? 0} Rows
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
