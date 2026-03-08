"""
MahjongiKong global highscore API — pure Python stdlib, no pip required.
Run: python3 app.py
"""

import json
import os
import re
import sqlite3
import threading
import time
from collections import defaultdict
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
HOST        = "127.0.0.1"
PORT        = 3001
TOP_N       = 10
MAX_NAME    = 20
RATE_LIMIT  = 5   # max POST per IP
RATE_WINDOW = 60  # seconds

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "scores.db")
_db_lock = threading.Lock()

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------
os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)



def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS scores (
            name       TEXT    PRIMARY KEY,
            score      INTEGER NOT NULL,
            updated_at TEXT    NOT NULL,
            board_url  TEXT,
            hints      INTEGER NOT NULL DEFAULT 0
        )
    """)
    # migrate existing DBs that don't have board_url yet
    try:
        conn.execute("ALTER TABLE scores ADD COLUMN board_url TEXT")
    except Exception:
        pass
    # migrate existing DBs that don't have hints yet
    try:
        conn.execute("ALTER TABLE scores ADD COLUMN hints INTEGER NOT NULL DEFAULT 0")
    except Exception:
        pass
    # migrate existing DBs that don't have demo flag yet
    try:
        conn.execute("ALTER TABLE scores ADD COLUMN demo INTEGER NOT NULL DEFAULT 0")
    except Exception:
        pass
    conn.commit()
    return conn

# ---------------------------------------------------------------------------
# Rate limiting
# ---------------------------------------------------------------------------
_rate_lock  = threading.Lock()
_rate_store = defaultdict(list)

def is_rate_limited(ip):
    now    = time.monotonic()
    cutoff = now - RATE_WINDOW
    with _rate_lock:
        hits = [t for t in _rate_store[ip] if t > cutoff]
        if len(hits) >= RATE_LIMIT:
            _rate_store[ip] = hits
            return True
        hits.append(now)
        _rate_store[ip] = hits
        return False

# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------
_NAME_RE = re.compile(r"^[\x20-\x7E]{1,20}$")

def validate_name(raw):
    if not isinstance(raw, str):
        return None
    name = raw.strip()
    if not _NAME_RE.match(name):
        return None
    # Normalize: first char uppercase, rest lowercase
    return name.capitalize()

def validate_score(raw):
    try:
        n = int(raw)
    except (TypeError, ValueError):
        return None
    return n if n >= 1 else None

# ---------------------------------------------------------------------------
# Static file root (local dev only)
# ---------------------------------------------------------------------------
_GAME_ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

# ---------------------------------------------------------------------------
# Request handler
# ---------------------------------------------------------------------------
class Handler(BaseHTTPRequestHandler):

    def log_message(self, fmt, *args):
        print(f"[{self.address_string()}] {fmt % args}")

    def _client_ip(self):
        fwd = self.headers.get("X-Forwarded-For", "")
        return fwd.split(",")[0].strip() if fwd else self.client_address[0]

    def _send_json(self, status, obj):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(body))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        try:
            return json.loads(self.rfile.read(length))
        except json.JSONDecodeError:
            return None

    # OPTIONS pre-flight (for local dev from file://)
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        if self.path == "/api/highscores":
            with _db_lock:
                conn = get_conn()
                # Fetch more than TOP_N in case there are case-duplicate names
                rows = conn.execute(
                    "SELECT name, score, updated_at AS date, board_url, hints FROM scores WHERE COALESCE(demo, 0) = 0 ORDER BY score DESC"
                ).fetchall()
                conn.close()
            # Deduplicate case-insensitively: rows already sorted DESC so first hit is best
            seen = {}
            deduped = []
            for r in rows:
                key = r["name"].strip().lower()
                if key not in seen:
                    seen[key] = True
                    d = dict(r)
                    d["name"] = d["name"].strip().capitalize()
                    deduped.append(d)
                    if len(deduped) >= TOP_N:
                        break
            self._send_json(200, deduped)
        else:
            # Serve static game files for local dev
            path = self.path.split("?")[0]
            if path == "/":
                path = "/index.html"
            file_path = os.path.normpath(os.path.join(_GAME_ROOT, path.lstrip("/")))
            # Safety: don't escape game root
            if not file_path.startswith(os.path.abspath(_GAME_ROOT)):
                self._send_json(403, {"error": "Forbidden"})
                return
            if os.path.isfile(file_path):
                ext = os.path.splitext(file_path)[1]
                mime = {
                    ".html": "text/html", ".js": "application/javascript",
                    ".css": "text/css",   ".png": "image/png",
                    ".jpg": "image/jpeg", ".svg": "image/svg+xml",
                    ".ico": "image/x-icon",
                }.get(ext, "application/octet-stream")
                data = open(file_path, "rb").read()
                self.send_response(200)
                self.send_header("Content-Type", mime)
                self.send_header("Content-Length", len(data))
                self.end_headers()
                self.wfile.write(data)
            else:
                self._send_json(404, {"error": "Not found"})

    def do_POST(self):
        if self.path != "/api/highscores":
            self._send_json(404, {"error": "Not found"})
            return

        if is_rate_limited(self._client_ip()):
            self._send_json(429, {"error": "Too many requests, slow down."})
            return

        data = self._read_json()
        if data is None:
            self._send_json(400, {"error": "Invalid JSON"})
            return

        is_demo = bool(data.get("demo", False))
        name  = "__demo__" if is_demo else validate_name(data.get("name"))
        score = validate_score(data.get("score"))
        board_url = data.get("board_url")
        if not isinstance(board_url, str) or len(board_url) > 2048:
            board_url = None
        try:
            hints = max(0, min(200, int(data.get("hints", 0))))
        except (TypeError, ValueError):
            hints = 0

        if not name:
            self._send_json(400, {"error": f"Invalid name (1-{MAX_NAME} printable ASCII chars)."})
            return
        if score is None:
            self._send_json(400, {"error": "Invalid score (must be >= 1)."})
            return

        date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        with _db_lock:
            conn = get_conn()
            # Case-insensitive upsert: find any existing row for this name
            existing = conn.execute(
                "SELECT name, score FROM scores WHERE LOWER(name) = LOWER(?)", (name,)
            ).fetchone()
            if existing:
                if score > existing["score"]:
                    # New score is better: remove old row and insert fresh
                    conn.execute("DELETE FROM scores WHERE LOWER(name) = LOWER(?)", (name,))
                    conn.execute(
                        "INSERT INTO scores (name, score, updated_at, board_url, hints, demo) VALUES (?, ?, ?, ?, ?, ?)",
                        (name, score, date, board_url, hints, 1 if is_demo else 0)
                    )
                # else keep existing (higher) record as-is
            else:
                conn.execute(
                    "INSERT INTO scores (name, score, updated_at, board_url, hints, demo) VALUES (?, ?, ?, ?, ?, ?)",
                    (name, score, date, board_url, hints, 1 if is_demo else 0)
                )
            conn.commit()
            rank = conn.execute(
                "SELECT COUNT(*) FROM scores WHERE score > ? AND COALESCE(demo, 0) = 0", (score,)
            ).fetchone()[0] + 1
            conn.close()

        self._send_json(200, {"ok": True, "rank": rank})

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Highscore API listening on http://{HOST}:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
