"""
One-time migration: normalize all names in the highscore DB.
  - Lowercases everything, then capitalizes the first letter
  - Merges case-duplicates, keeping the row with the highest score

Run on the server:
    python3 fix_names.py
"""
import sqlite3, os

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "scores.db")

conn = sqlite3.connect(DB_PATH)
conn.row_factory = sqlite3.Row

rows = conn.execute("SELECT name, score, updated_at, board_url, hints FROM scores").fetchall()

# Group by normalized name, keep best score
best = {}
for row in rows:
    key = row["name"].strip().capitalize()
    if key not in best or row["score"] > best[key]["score"]:
        best[key] = dict(row)

print(f"Before: {len(rows)} rows  →  After: {len(best)} rows")
for key, d in sorted(best.items(), key=lambda x: -x[1]["score"]):
    print(f"  {key!r:25s}  {d['score']}")

answer = input("\nApply changes? [y/N] ")
if answer.strip().lower() != "y":
    print("Aborted.")
    conn.close()
    exit()

conn.execute("DELETE FROM scores")
for key, d in best.items():
    conn.execute(
        "INSERT INTO scores (name, score, updated_at, board_url, hints) VALUES (?, ?, ?, ?, ?)",
        (key, d["score"], d["updated_at"], d["board_url"], d["hints"]),
    )
conn.commit()
conn.close()
print("Done.")
