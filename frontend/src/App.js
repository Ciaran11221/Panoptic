/**
 * App.js
 *
 * Root component for the Panoptic frontend.
 *
 * Responsibilities:
 *   - Renders the main dashboard UI
 *   - Supports two audit modes:
 *       1. Mock Mode: POSTs to /api/audit — backend uses built-in mock JSON data
 *       2. Upload Mode: POSTs files to /api/audit/upload — backend parses real exports
 *   - Displays the Claude API response as a structured report:
 *       - Audit summary and risk score
 *       - Colour-coded findings with severity badges
 *       - List of healthy positives
 *       - Badge showing which integrations came from uploaded files vs mock fallback
 *   - Accepts drag-and-drop of:
 *       - CSV exports from Okta, M365, Jira, GitHub
 *       - audit-data.json / enriched-report.json
 *       - Previously saved report.html (opens in new tab)
 *
 * State:
 *   - report:        Parsed JSON response from the backend (null until audit runs)
 *   - loading:       Boolean flag shown while the API call is in progress
 *   - error:         Error message string if the backend call fails
 *   - uploadedFiles: Array of File objects staged for upload
 *   - dragging:      Boolean — true while a file is being dragged over the drop zone
 *   - dropStatus:    "idle" | "loading" | "success" | "error" — state of the drop zone UI
 *   - dropResult:    Metadata about the last successfully dropped file
 */

import { useState, useCallback, useRef } from "react";
import axios from "axios";

// ---------------------------------------------------------------------------
// Colour maps
// ---------------------------------------------------------------------------

const severityColor = {
  LOW: "bg-blue-500",
  MEDIUM: "bg-yellow-500",
  HIGH: "bg-orange-500",
  CRITICAL: "bg-red-500",
};

const statusColor = {
  OK: "text-green-400",
  WARNING: "text-yellow-400",
  CRITICAL: "text-red-400",
};

const integrationLabel = {
  okta: "Okta",
  m365: "Microsoft 365",
  jira: "Jira",
  github: "GitHub",
  unknown: "Unknown",
};

// ---------------------------------------------------------------------------
// File classification helpers
// ---------------------------------------------------------------------------

/**
 * Sniff the first CSV header row to detect which SaaS platform it came from.
 * Returns one of: "okta" | "m365" | "jira" | "github" | "csv-unknown"
 */
function detectCsvPlatform(text) {
  const header = text.split("\n")[0].toLowerCase();
  if (header.includes("login") && header.includes("status") && header.includes("activated"))
    return "okta";
  if (header.includes("userprincipalname") || header.includes("displayname"))
    return "m365";
  if (header.includes("project key") || header.includes("assignee"))
    return "jira";
  if (header.includes("login") && header.includes("role") && header.includes("site"))
    return "github";
  return "csv-unknown";
}

/**
 * Sniff a parsed JSON object to detect which Panoptic format it is.
 * Returns one of: "enriched-report" | "audit-data" | "json-unknown"
 */
function detectJsonSubtype(parsed) {
  if (parsed.summary || parsed.riskScore || parsed.findings) return "enriched-report";
  if (parsed.system || parsed.disk || parsed.patches) return "audit-data";
  return "json-unknown";
}

/**
 * Parse a File into a typed payload:
 * { type, subtype, raw, text, file }
 */
async function parseDroppedFile(file) {
  const name = file.name.toLowerCase();
  const text = await file.text();

  if (name.endsWith(".json")) {
    try {
      const raw = JSON.parse(text);
      return { type: "json", subtype: detectJsonSubtype(raw), raw, text, file };
    } catch {
      throw new Error(`"${file.name}" is not valid JSON.`);
    }
  }

  if (name.endsWith(".csv")) {
    const subtype = detectCsvPlatform(text);
    return { type: "csv", subtype, raw: text, text, file };
  }

  if (name.endsWith(".html") || name.endsWith(".htm")) {
    return { type: "html", subtype: "saved-report", raw: text, text, file };
  }

  throw new Error(`Unsupported file type: "${file.name}". Drop a .csv, .json, or .html file.`);
}

/** Convert a flat CSV string into an array of objects keyed by header row. */
function parseCsvToObjects(text) {
  const [headerLine, ...rows] = text.trim().split("\n");
  const headers = headerLine.split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  return rows.map((row) => {
    const values = row.split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
    return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? ""]));
  });
}

const PLATFORM_LABELS = {
  okta: "Okta export",
  m365: "Microsoft 365 export",
  jira: "Jira export",
  github: "GitHub export",
  "csv-unknown": "CSV (platform not recognised)",
  "enriched-report": "Enriched audit report",
  "audit-data": "Raw audit data",
  "json-unknown": "JSON (format not recognised)",
  "saved-report": "Saved HTML report",
};

const PLATFORM_SUBTITLES = {
  okta: "Staged for upload audit",
  m365: "Staged for upload audit",
  jira: "Staged for upload audit",
  github: "Staged for upload audit",
  "csv-unknown": "Staged — check platform detection",
  "enriched-report": "Report reloaded",
  "audit-data": "Queued for re-analysis",
  "json-unknown": "Staged — format not fully recognised",
  "saved-report": "Opened in new tab",
};

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------

export default function App() {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [uploadedFiles, setUploadedFiles] = useState([]);

  // Drop zone UI state
  const [dragging, setDragging] = useState(false);
  const [dropStatus, setDropStatus] = useState("idle"); // "idle"|"loading"|"success"|"error"
  const [dropResult, setDropResult] = useState(null);   // { label, subtitle, fileName, fileSize }
  const [dropError, setDropError] = useState("");

  const dragCounter = useRef(0); // prevents flicker on nested drag enter/leave
  const fileInputRef = useRef(null);

  // ---------------------------------------------------------------------------
  // File routing — decides what to do with each dropped file type
  // ---------------------------------------------------------------------------

  const dispatchFile = useCallback((payload) => {
    const { type, subtype, raw, text, file } = payload;

    switch (subtype) {
      // Enriched report JSON — reload dashboard directly without hitting the backend
      case "enriched-report":
        setReport(raw);
        break;

      // Raw audit data JSON — stage it for upload so the backend re-runs Claude on it
      case "audit-data":
        setUploadedFiles((prev) => [...prev, file]);
        break;

      // SaaS CSV exports — stage them for the upload audit endpoint
      case "okta":
      case "m365":
      case "jira":
      case "github":
      case "csv-unknown":
        setUploadedFiles((prev) => [...prev, file]);
        break;

      // Saved HTML report — open in a new tab using a blob URL
      case "saved-report": {
        const blob = new Blob([text], { type: "text/html" });
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank");
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
        break;
      }

      default:
        // Still stage it — let the backend decide
        setUploadedFiles((prev) => [...prev, file]);
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Core drop handler
  // ---------------------------------------------------------------------------

  const processFiles = useCallback(
    async (files) => {
      if (files.length === 0) return;

      setDropStatus("loading");
      setDropError("");

      // Process all dropped files; collect results and any errors
      const results = [];
      const errors = [];

      for (const file of files) {
        try {
          const payload = await parseDroppedFile(file);
          dispatchFile(payload);
          results.push({
            label: PLATFORM_LABELS[payload.subtype],
            subtitle: PLATFORM_SUBTITLES[payload.subtype],
            fileName: file.name,
            fileSize: file.size,
          });
        } catch (err) {
          errors.push(err.message);
        }
      }

      if (errors.length > 0 && results.length === 0) {
        // Everything failed
        setDropStatus("error");
        setDropError(errors.join(" · "));
      } else {
        // At least one file processed successfully
        setDropStatus("success");
        // Show summary: first result + count of any additional files
        setDropResult(
          results.length === 1
            ? results[0]
            : { ...results[0], label: `${results.length} files loaded`, subtitle: results.map((r) => r.label).join(", ") }
        );
        if (errors.length > 0) setDropError(`Some files skipped: ${errors.join(" · ")}`);
        setError(null);
      }
    },
    [dispatchFile]
  );

  // ---------------------------------------------------------------------------
  // Drag event handlers
  // ---------------------------------------------------------------------------

  const onDragEnter = useCallback((e) => {
    e.preventDefault();
    dragCounter.current++;
    setDragging(true);
  }, []);

  const onDragLeave = useCallback((e) => {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current === 0) setDragging(false);
  }, []);

  const onDragOver = useCallback((e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const onDrop = useCallback(
    (e) => {
      e.preventDefault();
      dragCounter.current = 0;
      setDragging(false);
      const files = Array.from(e.dataTransfer.files);
      processFiles(files);
    },
    [processFiles]
  );

  const onFileInputChange = useCallback(
    (e) => {
      const files = Array.from(e.target.files);
      processFiles(files);
      e.target.value = "";
    },
    [processFiles]
  );

  const dismissDrop = () => {
    setDropStatus("idle");
    setDropResult(null);
    setDropError("");
  };

  const removeFile = useCallback((index) => {
    setUploadedFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // ---------------------------------------------------------------------------
  // Audit runners
  // ---------------------------------------------------------------------------

  const runMockAudit = async () => {
    setLoading(true);
    setError(null);
    setReport(null);
    try {
      const res = await axios.post("http://127.0.0.1:5000/api/audit");
      setReport(res.data);
    } catch {
      setError("Failed to connect to backend. Make sure Flask is running on port 5000.");
    } finally {
      setLoading(false);
    }
  };

  const runUploadAudit = async () => {
    if (uploadedFiles.length === 0) {
      setError("Please drop at least one file before running an upload audit.");
      return;
    }
    setLoading(true);
    setError(null);
    setReport(null);
    try {
      const formData = new FormData();
      uploadedFiles.forEach((file, index) => {
        formData.append(`file_${index}`, file, file.name);
      });
      const res = await axios.post(
        "http://127.0.0.1:5000/api/audit/upload",
        formData,
        { headers: { "Content-Type": "multipart/form-data" } }
      );
      setReport(res.data);
    } catch (err) {
      setError(
        err.response?.data?.error ||
          "Upload failed. Make sure Flask is running and files are CSV, XML, or JSON."
      );
    } finally {
      setLoading(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Derived display helpers
  // ---------------------------------------------------------------------------

  const formatBytes = (b) =>
    b > 1_000_000 ? `${(b / 1_000_000).toFixed(1)} MB` : `${(b / 1000).toFixed(1)} KB`;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="min-h-screen bg-gray-950 text-white p-8">
      <div className="max-w-5xl mx-auto">

        {/* Header */}
        <div className="mb-10">
          <h1 className="text-4xl font-bold tracking-tight">Panoptic</h1>
          <p className="text-gray-400 mt-1">AI-powered SaaS audit platform</p>
        </div>

        {/* ------------------------------------------------------------------ */}
        {/* Drop zone                                                            */}
        {/* ------------------------------------------------------------------ */}

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          id="file-input"
          type="file"
          multiple
          accept=".csv,.xml,.json,.html,.htm"
          className="hidden"
          onChange={onFileInputChange}
        />

        {/* ── Idle / drag-over ── */}
        {(dropStatus === "idle" || dropStatus === "error") && (
          <div
            onDragEnter={onDragEnter}
            onDragLeave={onDragLeave}
            onDragOver={onDragOver}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`mb-6 rounded-xl border-2 border-dashed p-8 text-center transition-colors cursor-pointer select-none
              ${dragging
                ? "border-indigo-400 bg-indigo-950"
                : "border-gray-700 bg-gray-900 hover:border-gray-500"
              }`}
          >
            <p className="text-2xl mb-2">{dragging ? "◈" : "⊕"}</p>
            <p className="text-gray-300 text-sm font-medium">
              {dragging ? "Release to load" : "Drag & drop files here, or click to browse"}
            </p>
            <p className="text-gray-600 text-xs mt-2">
              .csv (Okta · M365 · Jira · GitHub) · .json (audit data / report) · .html (saved report)
            </p>

            {/* Inline error */}
            {dropStatus === "error" && (
              <div className="mt-4 px-4 py-2 rounded-lg bg-red-950 border border-red-800 text-red-400 text-xs text-left">
                ✗ {dropError}
              </div>
            )}
          </div>
        )}

        {/* ── Loading ── */}
        {dropStatus === "loading" && (
          <div className="mb-6 rounded-xl border-2 border-dashed border-indigo-800 bg-gray-900 p-8 text-center">
            <div className="inline-block w-5 h-5 border-2 border-indigo-700 border-t-indigo-400 rounded-full animate-spin mb-3" />
            <p className="text-gray-400 text-sm">Reading file…</p>
          </div>
        )}

        {/* ── Success ── */}
        {dropStatus === "success" && dropResult && (
          <div className="mb-6 rounded-xl border border-indigo-800 bg-indigo-950/40 p-5">
            <div className="flex items-center gap-4">
              {/* Icon */}
              <div className="w-10 h-10 rounded-lg bg-indigo-900/60 border border-indigo-700 flex items-center justify-center text-indigo-400 text-lg flex-shrink-0">
                ◈
              </div>
              {/* Text */}
              <div className="flex-1 min-w-0">
                <p className="text-indigo-300 font-semibold text-sm">{dropResult.label}</p>
                <p className="text-gray-500 text-xs mt-0.5 truncate">
                  {dropResult.subtitle}
                  {dropResult.fileName && (
                    <span className="ml-2 text-gray-600">
                      · {dropResult.fileName} ({formatBytes(dropResult.fileSize)})
                    </span>
                  )}
                </p>
                {/* Partial-success warning */}
                {dropError && (
                  <p className="text-yellow-600 text-xs mt-1">⚠ {dropError}</p>
                )}
              </div>
              {/* Check */}
              <span className="text-indigo-400 text-lg flex-shrink-0">✓</span>
            </div>

            <button
              onClick={dismissDrop}
              className="mt-3 text-xs text-gray-600 hover:text-gray-400 transition"
            >
              drop another file
            </button>
          </div>
        )}

        {/* ------------------------------------------------------------------ */}
        {/* Staged file list                                                     */}
        {/* ------------------------------------------------------------------ */}
        {uploadedFiles.length > 0 && (
          <div className="mb-6 bg-gray-900 rounded-xl border border-gray-800 p-4">
            <p className="text-sm font-semibold text-gray-300 mb-3">
              Staged files ({uploadedFiles.length})
            </p>
            <ul className="space-y-2">
              {uploadedFiles.map((file, i) => (
                <li key={i} className="flex items-center justify-between text-sm text-gray-300">
                  <span>
                    {file.name}
                    <span className="text-gray-600 ml-2 text-xs">
                      ({(file.size / 1024).toFixed(1)} KB)
                    </span>
                  </span>
                  <button
                    onClick={() => removeFile(i)}
                    className="text-gray-600 hover:text-red-400 transition text-xs ml-4"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ------------------------------------------------------------------ */}
        {/* Action buttons                                                       */}
        {/* ------------------------------------------------------------------ */}
        <div className="flex gap-4 mb-10 flex-wrap">
          <button
            onClick={runMockAudit}
            disabled={loading}
            className="px-6 py-3 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:cursor-not-allowed rounded-lg font-semibold transition text-sm"
          >
            {loading ? "Running..." : "Run Audit (Mock Mode)"}
          </button>

          <button
            onClick={runUploadAudit}
            disabled={loading || uploadedFiles.length === 0}
            className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-900 disabled:cursor-not-allowed rounded-lg font-semibold transition text-sm"
          >
            {loading
              ? "Running..."
              : `Run Audit (${uploadedFiles.length} file${uploadedFiles.length !== 1 ? "s" : ""})`}
          </button>
        </div>

        {error && <p className="text-red-400 mb-6 text-sm">{error}</p>}

        {/* ------------------------------------------------------------------ */}
        {/* Report                                                               */}
        {/* ------------------------------------------------------------------ */}
        {report && (
          <div className="space-y-8">

            {/* Data source badges */}
            {report.uploaded_integrations && (
              <div className="flex flex-wrap gap-2">
                {["okta", "m365", "jira", "github"].map((key) => {
                  const isReal = report.uploaded_integrations.includes(key);
                  return (
                    <span
                      key={key}
                      className={`text-xs font-semibold px-3 py-1 rounded-full border
                        ${isReal
                          ? "border-green-500 text-green-400 bg-green-950"
                          : "border-gray-700 text-gray-500 bg-gray-900"
                        }`}
                    >
                      {integrationLabel[key]} {isReal ? "↑ uploaded" : "· mock"}
                    </span>
                  );
                })}
              </div>
            )}

            {/* Summary card */}
            <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold">Audit Summary</h2>
                <span className={`text-2xl font-bold ${statusColor[report.status]}`}>
                  {report.status}
                </span>
              </div>
              <p className="text-gray-300 mb-4">{report.summary}</p>
              <div className="flex items-center gap-4">
                <span className="text-gray-400 text-sm">Risk Score</span>
                <div className="flex-1 bg-gray-700 rounded-full h-3">
                  <div
                    className="bg-indigo-500 h-3 rounded-full transition-all"
                    style={{ width: `${report.risk_score}%` }}
                  />
                </div>
                <span className="text-white font-bold">{report.risk_score}/100</span>
              </div>
            </div>

            {/* Findings */}
            <div>
              <h2 className="text-xl font-semibold mb-4">Findings</h2>
              <div className="space-y-4">
                {report.findings.map((f, i) => (
                  <div key={i} className="bg-gray-900 rounded-xl p-5 border border-gray-800">
                    <div className="flex items-center gap-3 mb-2">
                      <span className={`text-xs font-bold px-2 py-1 rounded ${severityColor[f.severity]}`}>
                        {f.severity}
                      </span>
                      <h3 className="font-semibold">{f.title}</h3>
                    </div>
                    <p className="text-gray-400 text-sm mb-2">{f.detail}</p>
                    <p className="text-indigo-300 text-sm">
                      <span className="font-semibold text-white">Recommendation: </span>
                      {f.recommendation}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Positives */}
            <div>
              <h2 className="text-xl font-semibold mb-4">What Looks Healthy</h2>
              <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
                <ul className="space-y-2">
                  {report.positives.map((p, i) => (
                    <li key={i} className="flex items-start gap-2 text-gray-300 text-sm">
                      <span className="text-green-400 mt-0.5">✓</span>
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}