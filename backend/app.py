# -*- coding: utf-8 -*-
"""
app.py

Entry point for the Panoptic Flask backend.

In production (packaged as .exe):
    - Serves the React frontend as static files from the build/ folder
    - Opens the browser automatically on startup
    - Runs on a free port to avoid conflicts

In development:
    - CORS is enabled so the React dev server (localhost:3000) can call the API
    - Run with: python app.py
"""

import os
import sys
import threading
import webbrowser
from flask import Flask, send_from_directory
from flask_cors import CORS
from routes.audit import audit_bp

# ---------------------------------------------------------------------------
# Resolve paths - works both when run as a .py and as a PyInstaller .exe
# ---------------------------------------------------------------------------

def resource_path(relative):
    """
    Return the absolute path to a resource.
    PyInstaller extracts bundled files to sys._MEIPASS at runtime.
    When running as a plain .py, just use the script's directory.
    """
    base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, relative)


# ---------------------------------------------------------------------------
# App factory
# ---------------------------------------------------------------------------

# Point Flask at the React production build for static assets
STATIC_FOLDER = resource_path("frontend_build")

app = Flask(
    __name__,
    static_folder=STATIC_FOLDER,
    static_url_path="/"
)

# CORS only needed in dev (React runs on :3000, Flask on :5000)
# In production the same server serves both so CORS is irrelevant,
# but keeping it here does no harm
CORS(app)

# Register all /api/* routes
app.register_blueprint(audit_bp, url_prefix="/api")


# ---------------------------------------------------------------------------
# Serve the React app for every non-API route
# ---------------------------------------------------------------------------

@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_react(path):
    """
    Serve the React build.
    - If the requested path is a real static file (JS, CSS, images) serve it directly.
    - Everything else falls back to index.html so React Router works.
    """
    target = os.path.join(STATIC_FOLDER, path)
    if path and os.path.exists(target):
        return send_from_directory(STATIC_FOLDER, path)
    return send_from_directory(STATIC_FOLDER, "index.html")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def open_browser(port):
    """Open the default browser after a short delay to let Flask start up."""
    webbrowser.open(f"http://localhost:{port}")


if __name__ == "__main__":
    PORT = 5000

    # Open browser in a background thread so Flask is not blocked
    timer = threading.Timer(1.2, open_browser, args=[PORT])
    timer.start()

    # use_reloader=False is important - reloader spawns a second process
    # which would open the browser twice and break PyInstaller builds
    app.run(debug=False, port=PORT, use_reloader=False)