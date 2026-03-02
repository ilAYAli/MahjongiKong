const API_BASE = "/api";

async function loadHighscore() {
    const div = document.getElementById("highscore_div");
    div.innerHTML = '<a href="#" style="opacity:0.5">Loading...</a>';

    let rows;
    try {
        const resp = await fetch(`${API_BASE}/highscores`);
        if (!resp.ok) throw new Error(resp.status);
        rows = await resp.json();
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
        result = await resp.json();
        if (!resp.ok) throw new Error(result.error ?? resp.status);
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
