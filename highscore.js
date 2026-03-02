// Use absolute URL when opened from the filesystem (local dev), otherwise same-origin
const API_BASE = location.protocol === "file:"
    ? "http://localhost:3001/api"
    : "/api";

async function loadHighscore() {
    const div = document.getElementById("highscore_div");
    div.innerHTML = '<a href="#" style="opacity:0.5">Loading...</a>';

    let rows;
    try {
        const resp = await fetch(`${API_BASE}/highscores`);
        const text = await resp.text();
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        rows = JSON.parse(text);
    } catch (_) {
        div.innerHTML = '<a href="#">Could not load scores</a>';
        return;
    }

    div.innerHTML = '';

    if (!rows.length) {
        const a = document.createElement("a");
        a.textContent = "No scores yet - be first!";
        a.href = "#";
        div.appendChild(a);
        return;
    }

    rows.forEach((row, i) => {
        const a = document.createElement("a");
        a.href = "#";
        a.textContent = `#${i + 1}  ${row.name}  -  ${row.score.toLocaleString()} pts  (${row.date})`;
        div.appendChild(a);
    });
}

async function gameOver(elapsed, totalScore) {
    const raw = window.prompt(
        `Board cleared!\nYour score: ${totalScore.toLocaleString()} pts\n\nEnter your name for the global highscore:`
    );

    const name = (raw ?? "").trim();
    if (!name) return;

    let result;
    try {
        const resp = await fetch(`${API_BASE}/highscores`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, score: totalScore }),
        });
        const text = await resp.text();
        result = text ? JSON.parse(text) : {};
        if (!resp.ok) throw new Error(result.error ?? `HTTP ${resp.status}`);
    } catch (err) {
        alert(`Could not save score: ${err.message}`);
        return;
    }

    const medal = result.rank === 1 ? "Gold #1!" :
                  result.rank === 2 ? "Silver #2!" :
                  result.rank === 3 ? "Bronze #3!" :
                  `#${result.rank}`;
    alert(`Score saved! You are ${medal}`);

    loadHighscore();
}
