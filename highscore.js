const NO_OF_HIGH_SCORES = 10;
const HIGH_SCORES = 'mahgjongikong';

function loadHighscore() {
    let div = document.getElementById("highscore_div");
    div.innerHTML = '';

    const jd = JSON.parse(localStorage.getItem(HIGH_SCORES)) ?? [];

    if (!jd.length) {
        let a = document.createElement("a");
        a.textContent = "no record set";
        a.setAttribute('href', "#");
        div.appendChild(a);
        return;
    }

    jd.forEach((elt) => {
        if (elt['elapsed']) {
            let time = new Date(null)
            time.setSeconds(elt['elapsed']);

            let a = document.createElement("a");
            a.textContent = String(time.toISOString().slice(14, 19) + " - " + elt['when']);
            a.setAttribute('href', "#");
            div.appendChild(a);
        }
    });
}

function saveHighScore(jd, elapsed) {
    const d = new Date();
    const when = d.getDate() + "/" + (d.getMonth()+1) + "-" + ("0" + d.getFullYear()).slice(-2);
    const newScore = { elapsed, when };

    jd.push(newScore);
    jd.sort((a, b) => a.elapsed - b.elapsed);
    jd.splice(NO_OF_HIGH_SCORES);
    localStorage.setItem(HIGH_SCORES, JSON.stringify(jd));

    loadHighscore();
};

function isHighScore(jd, elapsed) {
    const slowest = jd[NO_OF_HIGH_SCORES - 1]?.elapsed ?? 1000000;
    console.log("slowest:", slowest);
    return elapsed < slowest;
}

function clearStorage() {
    localStorage.clear();
}

function gameOver(elapsed) {
    const jd = JSON.parse(localStorage.getItem(HIGH_SCORES)) ?? [];
    if (isHighScore(jd, elapsed)) {
        console.log("saving new time");
        saveHighScore(jd, elapsed);
    } else {
        console.log("not fast enough");
    }
}
