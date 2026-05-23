# -*- mode: python ; coding: utf-8 -*-
"""
panoptic.spec

PyInstaller build configuration for Panoptic.

Produces a single self-contained Windows executable that bundles:
  - The Flask backend and all Python dependencies
  - The compiled React frontend (served as static files by Flask)
  - Mock data JSON files for demo mode
  - The .env file containing the Anthropic API key

Usage:
    cd backend
    python -m PyInstaller panoptic.spec

Output:
    dist/Panoptic.exe

The API key is baked in at build time. Rotate your key and rebuild
before distributing the .exe externally.
"""

import os

HERE = os.path.dirname(os.path.abspath(SPEC))

block_cipher = None

a = Analysis(
    ["app.py"],
    pathex=[HERE],
    binaries=[],
    datas=[
        # Compiled React app - Flask serves these as static files
        (os.path.join(HERE, "../frontend/build"), "frontend_build"),
        # Mock JSON data for demo mode
        (os.path.join(HERE, "mock_data"), "mock_data"),
        # API key - baked in at build time
        (os.path.join(HERE, ".env"), "."),
    ],
    hiddenimports=[
        "flask",
        "flask_cors",
        "anthropic",
        "dotenv",
        "email.mime.text",
        "email.mime.multipart",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="Panoptic",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,   # No terminal window for end users
    icon=None,       # Swap for "panoptic.ico" to set a custom icon
)
