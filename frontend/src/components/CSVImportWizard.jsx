import React, { useState, useCallback } from 'react';
import { Upload, X, ArrowRight, ArrowLeft, CheckCircle2, AlertCircle, FileText, Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import useStore from '../lib/store';
import { importPreview, importValidate, importFinal } from '../lib/api';

const REQUIRED_FIELDS = ['name', 'mobile'];
const DB_FIELDS = [
  { id: 'name', label: 'Candidate Name', required: true },
  { id: 'mobile', label: 'Mobile Number', required: true },
  { id: 'address', label: 'Address' },
  { id: 'state', label: 'State' },
  { id: 'area', label: 'Area' },
  { id: 'experience', label: 'Experience' },
  { id: 'education', label: 'Education' },
  { id: 'dob', label: 'Date of Birth' },
  { id: 'gender', label: 'Gender' },
  { id: 'salary', label: 'Salary' },
  { id: 'marital_status', label: 'Marital Status' },
  { id: 'timing', label: 'Timing' },
  { id: 'description', label: 'Description/Notes' },
];

export default function CSVImportWizard({ onClose }) {
  const [step, setStep] = useState(1);
  const [file, setFile] = useState(null);
  const [headers, setHeaders] = useState([]);
  const [preview, setPreview] = useState([]);
  const [mapping, setMapping] = useState({});
  const [validation, setValidation] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const { activeSheet } = useStore();
  const qc = useQueryClient();

  const handleFileUpload = async (e) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    if (!selectedFile.name.endsWith('.csv')) {
      toast.error('Only .csv files are supported');
      return;
    }

    if (selectedFile.size > 10 * 1024 * 1024) {
      toast.error('File size exceeds 10MB limit');
      return;
    }

    setFile(selectedFile);
    setLoading(true);

    try {
      const data = await importPreview(selectedFile);
      if (data.success) {
        setHeaders(data.headers);
        setPreview(data.preview);
        
        // Auto-detect mapping
        const initialMapping = {};
        data.headers.forEach(header => {
          const lower = header.toLowerCase().replace(/[^a-z0-9]/g, '');
          const match = DB_FIELDS.find(f => 
            f.id.toLowerCase() === lower || 
            f.label.toLowerCase().replace(/[^a-z0-9]/g, '') === lower
          );
          if (match) initialMapping[match.id] = header;
        });
        setMapping(initialMapping);
        setStep(2);
      } else {
        toast.error(data.message || 'Failed to parse CSV');
      }
    } catch (err) {
      toast.error(err.message || 'Error during preview');
    } finally {
      setLoading(false);
    }
  };

  const handleValidate = async () => {
    // Check if required fields are mapped
    const unmappedRequired = REQUIRED_FIELDS.filter(f => !mapping[f]);
    if (unmappedRequired.length > 0) {
      toast.error(`Please map required fields: ${unmappedRequired.join(', ')}`);
      return;
    }

    setLoading(true);
    try {
      const data = await importValidate(file, mapping, activeSheet);
      if (data.success) {
        setValidation(data);
        setStep(3);
      } else {
        toast.error(data.message || 'Validation failed');
      }
    } catch (err) {
      toast.error(err.message || 'Error during validation');
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async () => {
    setLoading(true);
    try {
      const data = await importFinal(file, mapping, activeSheet);
      if (data.success) {
        setImportResult(data);
        setStep(4);
        qc.invalidateQueries({ queryKey: ['sheet-data'] });
        qc.invalidateQueries({ queryKey: ['sheet-summary'] });
        toast.success(`Import complete: ${data.imported} candidates added`);
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
      ['Row', 'Error Reason', ...headers],
      ...validation.errors.map(err => [err.row, err.reason, ...headers.map(h => err.data[h] || '')])
    ];
    const csvContent = "data:text/csv;charset=utf-8," + csvRows.map(e => e.join(",")).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `import_errors_${new Date().getTime()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-2xl w-full max-w-4xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden animate-in">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Bulk CSV Import</h2>
            <p className="text-xs text-slate-500">Import candidates to <strong>{activeSheet}</strong></p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Stepper */}
        <div className="px-6 py-4 bg-slate-50 flex items-center justify-between border-b border-slate-100">
          {[1, 2, 3, 4].map(s => (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${step >= s ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-500'}`}>
                {step > s ? <CheckCircle2 className="w-4 h-4" /> : s}
              </div>
              <span className={`text-xs font-semibold ${step >= s ? 'text-slate-800' : 'text-slate-400'}`}>
                {s === 1 ? 'Upload' : s === 2 ? 'Mapping' : s === 3 ? 'Validate' : 'Result'}
              </span>
              {s < 4 && <div className="w-8 h-[2px] bg-slate-200 mx-2" />}
            </div>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 min-h-[400px]">
          {step === 1 && (
            <div className="flex flex-col items-center justify-center h-full py-10">
              <div className="w-20 h-20 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mb-4">
                <Upload className="w-10 h-10" />
              </div>
              <h3 className="text-base font-bold text-slate-800 mb-2">Upload Candidate CSV</h3>
              <p className="text-sm text-slate-500 mb-6 text-center max-w-sm">
                Ensure your file is in .csv format and under 10MB.<br />You'll map the columns in the next step.
              </p>
              <label className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-xl font-bold text-sm cursor-pointer transition shadow-lg shadow-blue-200 flex items-center gap-2">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                Select CSV File
                <input type="file" accept=".csv" className="hidden" onChange={handleFileUpload} disabled={loading} />
              </label>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6">
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-blue-800 leading-relaxed">
                  We've auto-detected some columns. Please review and ensure all <strong>Required Fields</strong> are mapped to their respective CSV headers.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {DB_FIELDS.map(field => (
                  <div key={field.id} className={`p-3 rounded-xl border transition ${!mapping[field.id] && field.required ? 'border-red-200 bg-red-50/30' : 'border-slate-100 hover:border-blue-200'}`}>
                    <label className="block text-xs font-bold text-slate-700 mb-2 flex items-center justify-between">
                      <span>{field.label} {field.required && <span className="text-red-500">*</span>}</span>
                      {!mapping[field.id] && field.required && <span className="text-[10px] text-red-500 font-mono">Unmapped</span>}
                    </label>
                    <select
                      value={mapping[field.id] || ''}
                      onChange={(e) => setMapping({ ...mapping, [field.id]: e.target.value })}
                      className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs outline-none focus:border-blue-500"
                    >
                      <option value="">-- Ignore this field --</option>
                      {headers.map(h => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              {/* Preview Table */}
              <div className="mt-8">
                <h4 className="text-xs font-bold text-slate-500 mb-3 uppercase tracking-wider">CSV Preview (First 5 Rows)</h4>
                <div className="overflow-x-auto border border-slate-100 rounded-xl">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-50">
                      <tr>
                        {headers.map(h => <th key={h} className="px-3 py-2 border-b border-slate-100 font-bold text-slate-600">{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.map((row, i) => (
                        <tr key={i}>
                          {headers.map(h => <th key={h} className="px-3 py-2 border-b border-slate-100 font-normal text-slate-500">{row[h]}</th>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6">
              <div className="flex items-center gap-6">
                <div className="flex-1 bg-green-50 border border-green-100 rounded-2xl p-6 text-center">
                  <div className="text-3xl font-black text-green-600 mb-1">{validation.validCount}</div>
                  <div className="text-xs font-bold text-green-700 uppercase">Valid Rows</div>
                </div>
                <div className="flex-1 bg-red-50 border border-red-100 rounded-2xl p-6 text-center">
                  <div className="text-3xl font-black text-red-500 mb-1">{validation.errorCount}</div>
                  <div className="text-xs font-bold text-red-700 uppercase">Invalid Rows</div>
                </div>
              </div>

              {validation.errors.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Validation Errors</h4>
                    <button onClick={downloadErrorReport} className="text-blue-600 text-xs font-bold hover:underline flex items-center gap-1">
                      <Download className="w-3.5 h-3.5" /> Download Error CSV
                    </button>
                  </div>
                  <div className="bg-slate-50 border border-slate-100 rounded-xl overflow-hidden">
                    <div className="max-h-60 overflow-y-auto">
                      {validation.errors.map((err, i) => (
                        <div key={i} className="px-4 py-3 border-b border-slate-100 last:border-0 flex items-start gap-3">
                          <span className="bg-red-100 text-red-700 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold mt-0.5">Row {err.row}</span>
                          <span className="text-xs text-slate-600">{err.reason}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
                <p className="text-xs text-amber-800 leading-relaxed">
                  Only <strong>{validation.validCount} valid rows</strong> will be imported. Rows with errors will be skipped. 
                  Duplicates are identified by mobile number against existing candidates in <strong>{activeSheet}</strong>.
                </p>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="flex flex-col items-center justify-center h-full py-10">
              <div className="w-20 h-20 bg-green-50 text-green-600 rounded-full flex items-center justify-center mb-6">
                <CheckCircle2 className="w-10 h-10" />
              </div>
              <h3 className="text-xl font-black text-slate-800 mb-2">Import Successful!</h3>
              <p className="text-sm text-slate-500 mb-8 text-center max-w-sm">
                We've successfully processed the CSV data and updated the spreadsheet.
              </p>
              
              <div className="grid grid-cols-3 gap-8 w-full max-w-md mb-10">
                <div className="text-center">
                  <div className="text-2xl font-black text-slate-800">{importResult.imported}</div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase">Imported</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-black text-red-500">{importResult.failed}</div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase">Failed</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-black text-amber-500">{importResult.skipped}</div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase">Skipped</div>
                </div>
              </div>

              <button
                onClick={onClose}
                className="bg-slate-800 hover:bg-slate-900 text-white px-8 py-3 rounded-xl font-bold text-sm transition"
              >
                Done, Back to Table
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        {step < 4 && (
          <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between bg-slate-50/50">
            <button
              disabled={step === 1 || loading}
              onClick={() => setStep(step - 1)}
              className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-slate-600 hover:text-slate-800 disabled:opacity-30"
            >
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
            
            {step === 2 && (
              <button
                disabled={loading}
                onClick={handleValidate}
                className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-xl font-bold text-sm transition flex items-center gap-2 disabled:opacity-50"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                Validate Rows
              </button>
            )}

            {step === 3 && (
              <button
                disabled={loading || validation.validCount === 0}
                onClick={handleImport}
                className="bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded-xl font-bold text-sm transition flex items-center gap-2 disabled:opacity-50 shadow-lg shadow-green-100"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                Import {validation.validCount} Rows
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
