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

    const header = document.createElement("div");
    header.className = "hs-header";
    header.textContent = "HIGHSCORES";
    div.appendChild(header);

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
        if (i === 0) a.className = "hs-gold";
        else if (i === 1) a.className = "hs-silver";
        else if (i === 2) a.className = "hs-bronze";

        const medals = ["🥇", "🥈", "🥉"];
        const rankEl = document.createElement("span");
        rankEl.className = "hs-rank";
        rankEl.textContent = medals[i] ?? `#${i + 1}`;

        const nameEl = document.createElement("span");
        nameEl.className = "hs-name";
        if (row.board_url) {
            const link = document.createElement("a");
            const qs   = row.board_url.startsWith("?") ? row.board_url : row.board_url.slice(row.board_url.indexOf("?"));
            const sep  = qs.includes("view=") ? "&" : (qs + "&view=1").slice(qs.length);
            link.href = location.origin + location.pathname + qs + "&view=1&player=" + encodeURIComponent(row.name);
            link.textContent = row.name;
            link.style.color = "inherit";
            link.style.textDecoration = "underline";
            link.style.textUnderlineOffset = "3px";
            nameEl.appendChild(link);
        } else {
            nameEl.textContent = row.name;
        }

        const scoreEl = document.createElement("span");
        scoreEl.className = "hs-score";
        scoreEl.textContent = row.score.toLocaleString() + " pts";

        const hintsEl = document.createElement("span");
        hintsEl.className = "hs-hints";
        hintsEl.textContent = row.hints > 0 ? `${row.hints}\u{1F4A1}` : "";

        const dateEl = document.createElement("span");
        dateEl.className = "hs-date";
        dateEl.textContent = row.date;

        a.append(rankEl, nameEl, scoreEl, hintsEl, dateEl);
        div.appendChild(a);
    });
}

async function gameOver(elapsed, totalScore, hints = 0) {
    return new Promise((resolve) => {
        const modal    = document.getElementById("hs-modal");
        const scoreEl  = document.getElementById("hs-modal-score");
        const input    = document.getElementById("hs-modal-input");
        const submit   = document.getElementById("hs-modal-submit");
        const skip     = document.getElementById("hs-modal-skip");

        scoreEl.textContent = `${totalScore.toLocaleString()} pts`;
        input.value = "";
        modal.style.display = "flex";
        setTimeout(() => input.focus(), 50);

        async function doSubmit() {
            const name = input.value.trim();
            if (!name) { input.focus(); return; }
            modal.style.display = "none";

            const board_url = (typeof encodeBoard === "function") ? encodeBoard() : null;
            // Store only the query string so it works on any host
            const board_qs = board_url ? board_url.slice(board_url.indexOf("?")) : null;

            let result;
            try {
                const resp = await fetch(`${API_BASE}/highscores`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name, score: totalScore, board_url: board_qs, hints }),
                });
                const text = await resp.text();
                result = text ? JSON.parse(text) : {};
                if (!resp.ok) throw new Error(result.error ?? `HTTP ${resp.status}`);
            } catch (err) {
                alert(`Could not save score: ${err.message}`);
                resolve();
                return;
            }

            const medal = result.rank === 1 ? "Gold #1!" :
                          result.rank === 2 ? "Silver #2!" :
                          result.rank === 3 ? "Bronze #3!" :
                          `#${result.rank}`;
            alert(`Score saved! You are ${medal}`);
            loadHighscore();
            resolve();
        }

        submit.onclick = doSubmit;
        skip.onclick   = () => { modal.style.display = "none"; resolve(); };
        input.onkeydown = (e) => { if (e.key === "Enter") doSubmit(); };
    });
}
