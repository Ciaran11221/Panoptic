# Panoptic

AI-powered SaaS audit platform that identifies inactive users, unused licences, orphaned accounts, and cost inefficiencies across your organisation's tools.

Built with React, Python/Flask, and the Claude API.

---

## What it does

Panoptic connects to your SaaS platforms, sends the collected data to Claude for analysis, and returns a structured audit report with:

- **Risk score** (0–100)
- **Overall status** (OK / WARNING / CRITICAL)
- **Findings** with severity ratings and specific remediation recommendations
- **Positives** — things that are healthy and working well

### Supported integrations

| Platform | What Panoptic checks |
|---|---|
| Okta | Inactive users, suspended accounts, deprovisioned users still active |
| Microsoft 365 | Unused licences, ghost accounts, inactive users holding paid plans |
| Jira | Stale projects, abandoned work, inactive licensed users |
| GitHub | Ghost members, never-active accounts, stale repositories |

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React, Tailwind CSS |
| Backend | Python, Flask |
| AI | Anthropic Claude API |

---

## Getting started

### Prerequisites

- Python 3.10+
- Node.js 18+
- An Anthropic API key

### 1. Clone the repo

```bash
git clone https://github.com/Ciaran11221/Panoptic.git
cd Panoptic
```

### 2. Set up the backend

```bash
cd backend
pip install -r requirements.txt
cp ../.env.example .env
```

Open `.env` and set your API key:

```
ANTHROPIC_API_KEY=your-key-here
```

Start Flask:

```bash
python app.py
```

### 3. Set up the frontend

```bash
cd ../frontend
npm install
npm start
```

Open `http://localhost:3000` and click **Run Audit (Mock Mode)**.

---

## Mock mode

All four integrations ship with realistic mock data in `backend/mock_data/`. This lets you demo the full pipeline without any real SaaS accounts.

---

## Project structure

```
Panoptic/
├── backend/
│   ├── app.py
│   ├── requirements.txt
│   ├── routes/
│   │   └── audit.py
│   └── mock_data/
│       ├── okta.json
│       ├── m365.json
│       ├── jira.json
│       └── github.json
├── frontend/
│   └── src/
│       └── App.js
├── .env.example
└── README.md
```

---

## Roadmap

- [ ] Live API integration for Okta, M365, Jira, GitHub
- [ ] OAuth login flow
- [ ] Scheduled audits with email reports
- [ ] Export report as PDF