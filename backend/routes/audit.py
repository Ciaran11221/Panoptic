"""
routes/audit.py

Defines the /api/audit endpoint for the Panoptic audit pipeline.

Flow:
    1. Load mock JSON data for each SaaS integration (Okta, M365, Jira, GitHub)
    2. Build a structured prompt and send it to the Claude API
    3. Parse the JSON response and return it to the frontend
"""

import json
import os
import re
from flask import Blueprint, jsonify
from anthropic import Anthropic
from dotenv import load_dotenv

# Load environment variables from .env file (ANTHROPIC_API_KEY)
load_dotenv()

# Register this file as a Flask Blueprint so app.py can import it modularly
audit_bp = Blueprint("audit", __name__)

# Initialise the Anthropic client using the API key from .env
client = Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

# Path to the mock data directory (one JSON file per integration)
MOCK_DATA_DIR = os.path.join(os.path.dirname(__file__), "../mock_data")


def load_mock_data():
    """
    Load all mock SaaS data from JSON files into a single dictionary.

    In mock mode, these files simulate the responses you would receive
    from real API calls to Okta, Microsoft 365, Jira, and GitHub.

    Returns:
        dict: Combined data keyed by integration name (okta, m365, jira, github)
    """
    data = {}
    for filename in ["okta.json", "m365.json", "jira.json", "github.json"]:
        path = os.path.join(MOCK_DATA_DIR, filename)
        with open(path, "r") as f:
            key = filename.replace(".json", "")
            data[key] = json.load(f)
    return data


@audit_bp.route("/audit", methods=["POST"])
def run_audit():
    """
    POST /api/audit

    Runs the full audit pipeline:
        - Loads mock data from all four integrations
        - Sends the combined data to Claude for AI analysis
        - Returns a structured JSON report with findings, risk score, and recommendations

    Returns:
        JSON response containing:
            - summary (str): Plain English overview of findings
            - risk_score (int): 0-100 risk rating
            - status (str): OK, WARNING, or CRITICAL
            - findings (list): Each finding has title, severity, detail, recommendation
            - positives (list): Things that look healthy
    """
    # Load mock data for all integrations
    data = load_mock_data()

    # Build the audit prompt � instructs Claude to act as an IT auditor
    # and return structured JSON only (no markdown, no prose wrapping)
    prompt = f"""
You are an IT systems auditor. Analyse the following data collected from a company's SaaS tools and identify inefficiencies, risks, and cost-saving opportunities.

DATA:
{json.dumps(data, indent=2)}

Respond in this exact JSON format with no markdown, no code blocks, just raw JSON:
{{
  "summary": "2-3 sentence plain English overview",
  "risk_score": <number 0-100>,
  "status": "OK or WARNING or CRITICAL",
  "findings": [
    {{
      "title": "short title",
      "severity": "LOW or MEDIUM or HIGH or CRITICAL",
      "detail": "what the problem is",
      "recommendation": "what to do about it"
    }}
  ],
  "positives": ["thing that looks healthy", "another positive"]
}}
"""

    # Send the prompt to Claude and retrieve the response
    message = client.messages.create(
        model="claude-sonnet-4-5",
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}]
    )

    # Extract the raw text response from the API reply
    raw = message.content[0].text

    # Strip markdown code fences if Claude wraps the JSON in ```json ... ```
    raw = re.sub(r"```json\s*", "", raw)
    raw = re.sub(r"```\s*", "", raw)
    raw = raw.strip()

    # Parse the cleaned JSON string into a Python dict and return it
    result = json.loads(raw)
    return jsonify(result)
