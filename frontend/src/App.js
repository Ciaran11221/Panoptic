/**
 * App.js
 *
 * Root component for the Panoptic frontend.
 *
 * Responsibilities:
 *   - Renders the main dashboard UI
 *   - Sends a POST request to the Flask backend to trigger an audit
 *   - Displays the Claude API response as a structured report:
 *       - Audit summary and risk score
 *       - Colour-coded findings with severity badges
 *       - List of healthy positives
 *
 * State:
 *   - report:  The parsed JSON response from the backend (null until audit runs)
 *   - loading: Boolean flag shown while the API call is in progress
 *   - error:   Error message string if the backend call fails
 */

import { useState } from "react";
import axios from "axios";

// Maps severity levels to Tailwind background colours for badge styling
const severityColor = {
  LOW: "bg-blue-500",
  MEDIUM: "bg-yellow-500",
  HIGH: "bg-orange-500",
  CRITICAL: "bg-red-500",
};

// Maps overall audit status to Tailwind text colours
const statusColor = {
  OK: "text-green-400",
  WARNING: "text-yellow-400",
  CRITICAL: "text-red-400",
};

export default function App() {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  /**
   * runAudit
   *
   * Sends a POST request to the Flask /api/audit endpoint.
   * The backend loads mock SaaS data, calls the Claude API,
   * and returns a structured JSON report which is stored in state.
   */
  const runAudit = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.post("http://127.0.0.1:5000/api/audit");
      setReport(res.data);
    } catch (err) {
      setError("Failed to connect to backend. Make sure Flask is running.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white p-8">
      <div className="max-w-5xl mx-auto">

        {/* Header */}
        <div className="mb-10">
          <h1 className="text-4xl font-bold tracking-tight">Panoptic</h1>
          <p className="text-gray-400 mt-1">AI-powered SaaS audit platform</p>
        </div>

        {/* Audit trigger button — disabled while request is in flight */}
        <button
          onClick={runAudit}
          disabled={loading}
          className="mb-10 px-6 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-900 disabled:cursor-not-allowed rounded-lg font-semibold transition"
        >
          {loading ? "Running Audit..." : "Run Audit (Mock Mode)"}
        </button>

        {/* Error message shown if the backend is unreachable */}
        {error && <p className="text-red-400 mb-6">{error}</p>}

        {/* Report — only rendered once data is returned from the backend */}
        {report && (
          <div className="space-y-8">

            {/* Summary card — shows plain English overview, status, and risk score bar */}
            <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold">Audit Summary</h2>
                <span className={`text-2xl font-bold ${statusColor[report.status]}`}>
                  {report.status}
                </span>
              </div>
              <p className="text-gray-300 mb-4">{report.summary}</p>
              {/* Risk score progress bar */}
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

            {/* Findings list — each finding has a severity badge, title, detail, and recommendation */}
            <div>
              <h2 className="text-xl font-semibold mb-4">Findings</h2>
              <div className="space-y-4">
                {report.findings.map((f, i) => (
                  <div key={i} className="bg-gray-900 rounded-xl p-5 border border-gray-800">
                    <div className="flex items-center gap-3 mb-2">
                      {/* Severity badge — colour determined by severityColor map above */}
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

            {/* Positives — healthy signals identified by Claude */}
            <div>
              <h2 className="text-xl font-semibold mb-4">What Looks Healthy</h2>
              <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
                <ul className="space-y-2">
                  {report.positives.map((p, i) => (
                    <li key={i} className="flex items-start gap-2 text-gray-300 text-sm">
                      <span className="text-green-400 mt-0.5">?</span>
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
