# -*- coding: utf-8 -*-
"""
app.py

Flask entry point for the Panoptic backend.

Dual-mode operation:
  Development  - CORS enabled so the React dev server (localhost:3000) can call
                 the API on localhost:5000. Run with: python app.py
  Production   - Serves the compiled React build as static files so no separate
                 frontend server is needed. Packaged into a single .exe via
                 PyInstaller; the browser opens automatically on launch.

Path resolution:
  PyInstaller extracts bundled files to a temp directory at sys._MEIPASS.
  resource_path() abstracts this so the same code works in both environments.
"""

import os
import sys
import threading
import webbrowser

from flask import Flask, send_from_directory
from flask_cors import CORS
from routes.audit import audit_bp


# ---------------------------------------------------------------------------
# Path resolution
# ---------------------------------------------------------------------------

def resource_path(relative):
    """
    Resolve a path relative to the application root.

    In a PyInstaller bundle, files are extracted to sys._MEIPASS at runtime.
    In development, paths are resolved relative to this file's directory.
    """
    base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, relative)


# ---------------------------------------------------------------------------
# Application setup
# ---------------------------------------------------------------------------

# In production the React app is compiled to static files and served directly
# by Flask, eliminating the need for a separate Node process.
STATIC_FOLDER = resource_path("frontend_build")

app = Flask(
    __name__,
    static_folder=STATIC_FOLDER,
    static_url_path="/",
)

# CORS is required in development where React (port 3000) and Flask (port 5000)
# run on different origins. In production both are served from the same origin
# so CORS headers are redundant but harmless.
CORS(app)

# All audit API routes are registered under the /api prefix.
# Keeping routes in a Blueprint separates concerns and makes the API
# independently testable without the frontend.
app.register_blueprint(audit_bp, url_prefix="/api")


# ---------------------------------------------------------------------------
# Frontend serving
# ---------------------------------------------------------------------------

@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_react(path):
    """
    Serve the compiled React application.

    Static assets (JS bundles, CSS, images) are served directly from the
    build folder. All other paths fall through to index.html so that
    React Router can handle client-side navigation.
    """
    target = os.path.join(STATIC_FOLDER, path)
    if path and os.path.exists(target):
        return send_from_directory(STATIC_FOLDER, path)
    return send_from_directory(STATIC_FOLDER, "index.html")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def open_browser(port):
    """
    Open the default browser pointing at the local server.
    Called from a background thread so Flask startup is not blocked.
    """
    webbrowser.open(f"http://localhost:{port}")


if __name__ == "__main__":
    PORT = 5000

    # Delay browser open slightly to give Flask time to bind the port.
    # use_reloader=False prevents the reloader from spawning a child process,
    # which would cause the browser to open twice and break PyInstaller builds.
    threading.Timer(1.2, open_browser, args=[PORT]).start()
    app.run(debug=False, port=PORT, use_reloader=False)
