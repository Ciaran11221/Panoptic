"""
app.py

Entry point for the Panoptic Flask backend.

Responsibilities:
    - Initialise the Flask application
    - Enable CORS so the React frontend (localhost:3000) can call the API
    - Register the audit blueprint under the /api prefix
    - Run the development server on port 5000
"""

from flask import Flask
from flask_cors import CORS
from routes.audit import audit_bp

# Initialise the Flask app
app = Flask(__name__)

# Enable Cross-Origin Resource Sharing so the React dev server on
# localhost:3000 can make requests to this backend on localhost:5000
CORS(app)

# Register the audit blueprint — all routes inside audit.py are
# accessible under the /api prefix e.g. POST /api/audit
app.register_blueprint(audit_bp, url_prefix="/api")

if __name__ == "__main__":
    # debug=True enables auto-reload on file changes during development
    app.run(debug=True, port=5000)
