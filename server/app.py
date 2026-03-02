"""
MahjongiKong global highscore API
Run locally: flask --app app run --port 3001
Run in production via gunicorn (see Caddyfile.snippet / .service)
"""

import os
import re
import sqlite3
import threading
import time
from collections import defaultdict
from datetime import datetime, timezone
from flask import Flask, g, jsonify, request

# ---[ config ] ---------------------------------------------------------------
TOP_N        = 10
MAX_NAME     = 20
MAX_SCORE    = 100_000
RATE_LIMIT   = 5          # max POST per IP per time window
RATE_WINDOW  = 60         # seconds

DB_PATH = os.path.join(os.path.dirname(__file__), "data", "scores.db")

app = Flask(__name__)

# ---[ database ] -------------------------------------------------------------
os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)

def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH, check_same_thread=False)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA journal_mode=WAL")
        g.db.execute("""
            CREATE TABLE IF NOT EXISTS scores (
                name       TEXT    PRIMARY KEY,
                score      INTEGER NOT NULL,
                updated_at TEXT    NOT NULL
            )
        """)
        g.db.commit()
    return g.db

@app.teardown_appcontext
def close_db(_):
    db = g.pop("db", None)
    if db:
        db.close()

# ---[ rate limiting ] ---------------------------------------------------------
_rate_lock  = threading.Lock()
_rate_store = defaultdict(list)   # ip -> [timestamp, ...]

def is_rate_limited(ip: str) -> bool:
    now = time.monotonic()
    cutoff = now - RATE_WINDOW
    with _rate_lock:
        hits = [t for t in _rate_store[ip] if t > cutoff]
        if len(hits) >= RATE_LIMIT:
            _rate_store[ip] = hits
            return True
        hits.append(now)
        _rate_store[ip] = hits
        return False

# ---[ validation ] -----------------------------------------------------------
_NAME_RE = re.compile(r"^[\x20-\x7E]{1,20}$")

def validate_name(raw) -> str | None:
    if not isinstance(raw, str):
        return None
    name = raw.strip()
    if not _NAME_RE.match(name):
        return None
    return name

def validate_score(raw) -> int | None:
    try:
        n = int(raw)
    except (TypeError, ValueError):
        return None
    return n if 1 <= n <= MAX_SCORE else None

# ---[ helpers ] --------------------------------------------------------------
def client_ip() -> str:
    forwarded = request.headers.get("X-Forwarded-For", "")
    return forwarded.split(",")[0].strip() if forwarded else (request.remote_addr or "unknown")

# ---[ routes ] ---------------------------------------------------------------
@app.after_request
def security_headers(resp):
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"]        = "DENY"
    return resp

@app.get("/api/highscores")
def get_highscores():
    rows = get_db().execute(
        "SELECT name, score, updated_at AS date FROM scores ORDER BY score DESC LIMIT ?",
        (TOP_N,)
    ).fetchall()
    return jsonify([dict(r) for r in rows])

@app.post("/api/highscores")
def post_highscore():
    if is_rate_limited(client_ip()):
        return jsonify({"error": "Too many requests, slow down."}), 429

    data  = request.get_json(silent=True) or {}
    name  = validate_name(data.get("name"))
    score = validate_score(data.get("score"))

    if not name:
        return jsonify({"error": f"Invalid name (1–{MAX_NAME} printable characters)."}), 400
    if score is None:
        return jsonify({"error": f"Invalid score (1–{MAX_SCORE})."}), 400

    date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    db   = get_db()
    db.execute("""
        INSERT INTO scores (name, score, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET
          score      = CASE WHEN excluded.score > scores.score THEN excluded.score ELSE scores.score END,
          updated_at = CASE WHEN excluded.score > scores.score THEN excluded.updated_at ELSE scores.updated_at END
    """, (name, score, date))
    db.commit()

    rank = db.execute(
        "SELECT COUNT(*) FROM scores WHERE score > ?", (score,)
    ).fetchone()[0] + 1

    return jsonify({"ok": True, "rank": rank})

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=3001, debug=True)
