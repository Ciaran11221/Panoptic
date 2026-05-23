# -*- coding: utf-8 -*-
"""
routes/audit.py

Defines the Panoptic audit pipeline and exposes two Flask endpoints:

  POST /api/audit
    Runs a full audit using the built-in mock data.
    No file upload required - useful for demos and testing.

  POST /api/audit/upload
    Accepts real SaaS export files (CSV, XML, or JSON) via multipart form data.
    Each file is parsed and mapped to an integration (okta, m365, jira, github).
    Any integration not covered by an uploaded file falls back to mock data,
    so a partial upload still produces a complete report.

Claude integration:
  Both endpoints funnel their data through run_claude_audit(), which builds
  a structured prompt and calls the Anthropic Messages API. The response is
  parsed from JSON and returned directly to the frontend.

PyInstaller compatibility:
  When running as a bundled .exe, sys._MEIPASS points to the temp directory
  where PyInstaller extracts files. All file paths are resolved through this
  so the same code works in both development and production.
"""

import csv
import io
import json
import os
import re
import sys
import xml.etree.ElementTree as ET

from anthropic import Anthropic
from dotenv import load_dotenv
from flask import Blueprint, jsonify, request


# ---------------------------------------------------------------------------
# Environment and client setup
# ---------------------------------------------------------------------------

# Resolve .env path for both development (.py) and production (.exe) modes.
# In a PyInstaller bundle, sys._MEIPASS is the extraction directory.
if getattr(sys, "frozen", False):
    _dotenv_path = os.path.join(sys._MEIPASS, ".env")
else:
    _dotenv_path = os.path.join(os.path.dirname(__file__), "../.env")

load_dotenv(_dotenv_path)

# Initialise the Anthropic client once at module load.
# The API key is read from the .env file loaded above.
client = Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

# Resolve mock data directory using the same dual-mode path logic.
MOCK_DATA_DIR = os.path.join(
    getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__))),
    "mock_data",
)

audit_bp = Blueprint("audit", __name__)


# ---------------------------------------------------------------------------
# Mock data
# ---------------------------------------------------------------------------

def load_mock_data():
    """
    Load all four integration mock JSON files into a single dict.

    Returns:
        dict with keys: okta, m365, jira, github
    """
    data = {}
    for filename in ["okta.json", "m365.json", "jira.json", "github.json"]:
        path = os.path.join(MOCK_DATA_DIR, filename)
        with open(path, "r") as f:
            key = filename.replace(".json", "")
            data[key] = json.load(f)
    return data


# ---------------------------------------------------------------------------
# Integration detection
# ---------------------------------------------------------------------------

def detect_integration(filename):
    """
    Infer which SaaS integration a file belongs to from its filename.

    Detection is intentionally permissive - users are expected to export
    files with the platform name in the filename (e.g. okta_users.csv).

    Returns:
        str: one of 'okta', 'm365', 'jira', 'github', or 'unknown'
    """
    name = filename.lower()
    if "okta" in name:
        return "okta"
    if "m365" in name or "microsoft" in name or "office" in name:
        return "m365"
    if "jira" in name or "atlassian" in name:
        return "jira"
    if "github" in name or "git" in name:
        return "github"
    return "unknown"


# ---------------------------------------------------------------------------
# File parsers
# ---------------------------------------------------------------------------

def parse_csv(content):
    """
    Parse CSV bytes into a list of row dicts.

    Uses utf-8-sig encoding to strip the BOM character that Microsoft
    applications (Excel, M365 admin exports) prepend to CSV files.

    Args:
        content (bytes): raw file content

    Returns:
        list[dict]: one dict per data row, keyed by header column names
    """
    text = content.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    return list(reader)


def parse_xml(content):
    """
    Parse XML bytes into a nested dict structure.

    Handles repeated child tags by converting them to lists,
    and preserves element attributes and text content.

    Args:
        content (bytes): raw file content

    Returns:
        dict: recursive representation of the XML tree
    """
    root = ET.fromstring(content.decode("utf-8"))

    def element_to_dict(el):
        result = {}
        if el.attrib:
            result.update(el.attrib)
        text = el.text and el.text.strip()
        if text:
            result["_text"] = text
        for child in el:
            child_data = element_to_dict(child)
            if child.tag in result:
                existing = result[child.tag]
                if not isinstance(existing, list):
                    result[child.tag] = [existing]
                result[child.tag].append(child_data)
            else:
                result[child.tag] = child_data
        return result

    return element_to_dict(root)


def parse_json(content):
    """
    Parse JSON bytes into a Python object.

    Args:
        content (bytes): raw file content

    Returns:
        dict | list: parsed JSON data
    """
    return json.loads(content.decode("utf-8"))


def parse_file(filename, content):
    """
    Route a file to the correct parser based on its extension.

    Args:
        filename (str): original filename including extension
        content (bytes): raw file content

    Returns:
        dict | list: parsed data

    Raises:
        ValueError: if the file extension is not supported
    """
    ext = filename.rsplit(".", 1)[-1].lower()
    parsers = {
        "csv": parse_csv,
        "xml": parse_xml,
        "json": parse_json,
    }
    if ext not in parsers:
        raise ValueError(f"Unsupported file type: .{ext}. Expected csv, xml, or json.")
    return parsers[ext](content)


# ---------------------------------------------------------------------------
# Claude audit runner
# ---------------------------------------------------------------------------

def run_claude_audit(data):
    """
    Send collected SaaS data to Claude and return a structured audit report.

    The prompt instructs Claude to act as an IT auditor and return a strict
    JSON schema. Markdown fences are stripped defensively in case the model
    wraps its output despite the instruction.

    Args:
        data (dict): integration data keyed by platform name

    Returns:
        dict: parsed audit report with keys:
              summary, risk_score, status, findings, positives

    Raises:
        json.JSONDecodeError: if Claude returns malformed JSON
    """
    prompt = f"""
You are an IT systems auditor. Analyse the following data collected from a company's SaaS tools
and identify security risks, access control issues, cost inefficiencies, and orphaned resources.
Cross-reference users across platforms where possible to find mismatches.

DATA:
{json.dumps(data, indent=2)}

Respond in this exact JSON format with no markdown, no code blocks, just raw JSON:
{{
  "summary": "2-3 sentence plain English overview of the organisation's posture",
  "risk_score": <integer 0-100>,
  "status": "OK or WARNING or CRITICAL",
  "findings": [
    {{
      "title": "short descriptive title",
      "severity": "LOW or MEDIUM or HIGH or CRITICAL",
      "detail": "specific description of the issue including affected users or systems",
      "recommendation": "concrete remediation steps"
    }}
  ],
  "positives": ["what is working well", "another healthy signal"]
}}
"""
    message = client.messages.create(
        model="claude-sonnet-4-5",
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}],
    )

    # Strip markdown code fences defensively - the prompt requests raw JSON
    # but the model occasionally wraps output in backtick blocks
    raw = message.content[0].text
    raw = re.sub(r"```json\s*", "", raw)
    raw = re.sub(r"```\s*", "", raw)
    return json.loads(raw.strip())


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@audit_bp.route("/audit", methods=["POST"])
def run_audit():
    """
    POST /api/audit

    Runs a full audit using mock data from the mock_data/ directory.
    No request body or files required.

    Returns:
        JSON audit report
    """
    data = load_mock_data()
    result = run_claude_audit(data)
    return jsonify(result)


@audit_bp.route("/audit/upload", methods=["POST"])
def run_audit_upload():
    """
    POST /api/audit/upload

    Accepts multipart/form-data containing one or more SaaS export files.
    Files can be CSV, XML, or JSON. Each is parsed and mapped to an integration
    by filename. Integrations not covered by an upload fall back to mock data.

    The response includes an 'uploaded_integrations' field listing which
    platforms used real data vs mock fallback - surfaced as badges in the UI.

    Returns:
        JSON audit report with uploaded_integrations list
        400 if no files were provided or none could be parsed
    """
    if not request.files:
        return jsonify({"error": "No files uploaded"}), 400

    # Seed with mock data so every integration is covered even with partial uploads
    data = load_mock_data()
    uploaded_integrations = []

    for _field_name, file in request.files.items():
        filename = file.filename
        if not filename:
            continue
        try:
            content = file.read()
            parsed = parse_file(filename, content)
            integration = detect_integration(filename)
            data[integration] = parsed
            uploaded_integrations.append(integration)
        except Exception as e:
            return jsonify({"error": f"Failed to parse {filename}: {str(e)}"}), 400

    if not uploaded_integrations:
        return jsonify({"error": "No valid files could be parsed"}), 400

    result = run_claude_audit(data)
    # Tell the frontend which integrations used real uploaded data
    result["uploaded_integrations"] = uploaded_integrations
    return jsonify(result)
