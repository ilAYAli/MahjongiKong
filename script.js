"use strict";

// ---[ state ]-----------------------------------------------------------------
const canvas = document.getElementById('board_canvas');
const ctx = canvas.getContext('2d');

const queryString = window.location.search;
const urlParams = new URLSearchParams(queryString);

const spriteParam = urlParams.get('spriteIdx')
const spriteIdx = spriteParam ? Number(spriteParam) : 0;

const levelParam = urlParams.get('l')

let level = 0;
let URI;
let QR;

const DEFAULT_TIMEOUT = 60 * 5;

const TILE = {
    unused:     "unused",
    active:     "active",
    selected:   "selected",
    dead:       "dead",
}

const SOLVED = {
    all:    Symbol("all"),
    one:    Symbol("one"),
    none:   Symbol("none"),
}


function resize() {
    ctx.canvas.width  = 1024;
    ctx.canvas.height = 768;
}

// ---[ triggers ]--------------------------------------------------------------
window.onload = () => {
    loadHighscore();
    resize();
    board.init();
}


var scheduledRedraw;
window.addEventListener('resize', () => {
    clearTimeout(scheduledRedraw);
    scheduledRedraw = setTimeout(() => {
        resize();
    }, 100);
});


canvas.addEventListener('mousemove', function(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const xpos = (e.clientX - rect.left) * scaleX;
    const ypos = (e.clientY - rect.top) * scaleY;
    board.hoverIdx = board.posToBoardIdx(xpos, ypos);
});

canvas.addEventListener('mouseleave', () => {
    board.hoverIdx = -1;
});

canvas.addEventListener('mousedown', function(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const xpos = (e.clientX - rect.left) * scaleX;
    const ypos = (e.clientY - rect.top) * scaleY;
    board.mouseClick(board, xpos, ypos, true);
});

let touchStartX = 0;
let touchStartY = 0;
let touchStartTime = 0;

canvas.addEventListener('touchstart', function(e) {
    const touch = e.touches[0];
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
    touchStartTime = Date.now();
}, { passive: true });

canvas.addEventListener('touchend', function(e) {
    const touch = e.changedTouches[0];
    const dx = Math.abs(touch.clientX - touchStartX);
    const dy = Math.abs(touch.clientY - touchStartY);
    const dt = Date.now() - touchStartTime;

    if (dx < 10 && dy < 10 && dt < 300) {
        e.preventDefault(); 
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const xpos = (touch.clientX - rect.left) * scaleX;
        const ypos = (touch.clientY - rect.top) * scaleY;
        board.mouseClick(board, xpos, ypos, true);
    }
}, { passive: false });


// return board idx from active col, row
function activeCoordToBoard(col, row) {
    // board has 1-tile border
    let idx = ((row + 1) * board.numCols) + (col + 1);
    return idx;
}

function activeIdxToBoard(idx) {
    let row = Math.floor(idx % (board.numRows - 2));
    let col = Math.floor(idx / (board.numRows - 2));
    return activeCoordToBoard(col, row);
}

function decodeBoard(encoded) {
    let board_pt = LZString.decompressFromEncodedURIComponent(encoded);
    let new_board = [];
    for (let i = 0; i < board_pt.length; i+=2) {
        new_board.push(parseInt(board_pt.substring(i, i+2), 16));
    }
    return new_board;
}

function createLevelUri() {
    let pt = "";
    for (let r = 0; r < board.active_rows; r++) {
        for (let c = 0; c < board.active_cols; c++) {
            pt += board.tiles[activeCoordToBoard(c, r)][0].toString(16).padStart(2, '0');
        }
    }
    let ec = LZString.compressToEncodedURIComponent(pt);
    let uri = "https://wahlman.no/code/MahjongiKong?l=";
    URI = uri + ec;
    let qr = document.getElementById("url");
    if (qr) qr.href = URI;
}

function createQR() {
    if (QR) {
        document.getElementById("qrcode").innerHTML = "";
    }
    QR = new QRCode("qrcode", {
        text: URI,
        width: 160,
        height: 160,
        colorDark : "#000000",
        colorLight : "#ffffff",
        correctLevel : QRCode.CorrectLevel.H
    });
}

//---[ classes ]-----------------------------------------------------------------

class SpriteSheet {
    constructor(width, height, cols, rows, dark, light) {
        this.tile_width = width;
        this.tile_height = height;
        this.cols = cols;
        this.rows = rows;
        this.dark_image = new Image();
        this.light_image = new Image();
        this.dark_image.src = dark;
        this.light_image.src = light;

        this.empty_tile = 0;
        this.unused_tiles = [];
    }

    idxToCoord(idx) {
        let tile_x = idx % this.cols;
        let tile_y = Math.floor(idx / this.cols);
        return [tile_x, tile_y];
    }

    getRandomTile () {
        while (true) {
            let idx = Math.floor(Math.random() * this.cols * this.rows);
            let usable = true;
            for (let i = 0; i < this.unused_tiles.length; ++i) {
                if (idx == this.unused_tiles[i]) {
                    usable = false;
                    break;
                }
            }
            if (usable) return idx;
        }
    }
}


class GameBoard {
    constructor(numCols, numRows, sheet) {
        this.numCols = numCols;
        this.numRows = numRows;
        this.sheet = sheet;
        this.active_rows = numRows - 2;
        this.active_cols = numCols - 2;
        this.active_size = this.active_rows * this.active_cols;
        this.tile_width = 0;
        this.tile_height = 0;

        this.src_tile = -1;
        this.dst_tile = -1;

        this.tiles = [];
        this.arrows = [];

        this.score = 0;
        this.totalScore = 0;
        this.lastMatchTime = Date.now();
        
        this.draw_arrows = true;
        this.demo_mode = false;
        this.have_hint = false;
        this.animations = [];
        this.pulse = 0;
        this.hoverIdx = -1;
        this.arrowShowTime = 0;
        
        this.animationLoopStarted = false;
    }

    #drawLine(ctx, x1, y1, x2, y2) {
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
    }

    #drawArrowPath(ctx) {
        if (!this.draw_arrows || this.arrows.length === 0) return;

        const elapsed = Date.now() - this.arrowShowTime;
        if (elapsed > 500) {
            this.arrows = [];
            return;
        }

        ctx.save();
        const alpha = Math.max(0, 1 - (elapsed / 500));
        ctx.globalAlpha = alpha;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.lineWidth = 6;
        ctx.strokeStyle = '#6c5ce7';
        ctx.shadowBlur = 10;
        ctx.shadowColor = '#a29bfe';
        
        ctx.beginPath();
        this.arrows.forEach((arrow, index) => {
            let [x1, y1] = this.coordToPos(arrow[0], arrow[1]);
            let [x2, y2] = this.coordToPos(arrow[2], arrow[3]);
            x1 += (this.tile_width/2); y1 += (this.tile_height/2);
            x2 += (this.tile_width/2); y2 += (this.tile_height/2);
            if (index === 0) ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
        });
        ctx.stroke();

        ctx.lineWidth = 2;
        ctx.strokeStyle = '#fff';
        ctx.shadowBlur = 0;
        ctx.stroke();

        const last = this.arrows[this.arrows.length - 1];
        let [lx1, ly1] = this.coordToPos(last[0], last[1]);
        let [lx2, ly2] = this.coordToPos(last[2], last[3]);
        lx2 += (this.tile_width/2); ly2 += (this.tile_height/2);
        lx1 += (this.tile_width/2); ly1 += (this.tile_height/2);
        
        const headlen = 10;
        const theta = Math.atan2(ly2 - ly1, lx2 - lx1);
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.moveTo(lx2, ly2);
        ctx.lineTo(lx2 - headlen * Math.cos(theta - Math.PI/6), ly2 - headlen * Math.sin(theta - Math.PI/6));
        ctx.lineTo(lx2 - headlen * Math.cos(theta + Math.PI/6), ly2 - headlen * Math.sin(theta + Math.PI/6));
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    #drawOutline(ctx) {
        let active_width = (this.numCols - 2) * this.tile_width;
        let active_height = (this.numRows - 2) * this.tile_height;
        ctx.beginPath();
        ctx.rect(this.tile_width, this.tile_height, active_width, active_height);
        ctx.lineWidth = 1;
        ctx.strokeStyle = '#aaaaaa';
        ctx.stroke();
    }

    #populateInvisibleBorder() {
        let board_size = this.numCols * this.numRows;
        let border_state = TILE.dead;
        let border_tile = this.sheet.empty_tile;

        for (let i = 0; i < this.numCols; i++) {
            this.tiles[i] = [border_tile, border_state]; // top
            this.tiles[board_size - i - 1] = [border_tile, border_state]; // bottom
        }
        for (let i = 0; i < this.numRows; i++) {
            this.tiles[i * this.numCols] = [border_tile, border_state]; // left
            this.tiles[i * this.numCols + (this.numCols - 1)] = [border_tile, border_state]; // right
        }
    }

    #allValidRowsFromPoint(x, y) {
        let valid_moves = [];
        for (let i = x - 1; i >= 0; i--) {
            if (!this.#isValidHmode(x, y, i)) break;
            valid_moves.push(i);
        }
        for (let i = x + 1; i < this.numCols; i++) {
            if (!this.#isValidHmode(x, y, i)) break;
            valid_moves.push(i);
        }
        return valid_moves;
    }

    #allValidColsFromPoint(x, y) {
        let valid_moves = [];
        for (let i = y - 1; i >= 0; i--) {
            if (!this.#isValidVmove(x, y, i)) break;
            valid_moves.push(i);
        }
        for (let i = y + 1; i < this.numRows; i++) {
            if (!this.#isValidVmove(x, y, i)) break;
            valid_moves.push(i);
        }
        return valid_moves;
    }

    #isValidHmode(x, y, dx) {
        let dist = Math.abs(dx - x);
        let mod = x < dx ? 1 : -1;
        for (let i = 1; i <= dist; i++) {
            let tx = x + (i * mod);
            if (this.tiles[this.coordToIdx(tx, y)][1] === TILE.active) return false;
        }
        return true;
    }

    #isValidVmove(x, y, dy) {
        let dist = Math.abs(dy - y);
        let mod = y < dy ? 1 : -1;
        for (let i = 1; i <= dist; i++) {
            let ty = y + (i * mod);
            if (ty < 0 || ty >= this.numRows) return false;
            if (this.tiles[this.coordToIdx(x, ty)][1] === TILE.active) return false;
        }
        return true;
    }

    #isReachable(r, c, tr, tc) {
        if (c === tc && this.#isValidHmode(r, c, tr)) return [[r, c, tr, tc]];
        if (r === tr && this.#isValidVmove(r, c, tc)) return [[r, c, tr, tc]];
        return null;
    }

    coordToIdx(col, row) {
        return (row * this.numCols) + col;
    }

    idxToCoord(idx) {
        let col = idx % this.numCols;
        let row = Math.floor(idx / this.numCols);
        return [col, row];
    }

    #getNumActiveTiles() {
        return this.tiles.filter(t => t[1] === TILE.active).length;
    }

    #getRandomActiveTile() {
        const active = this.tiles.map((t, i) => t[1] === TILE.active ? i : -1).filter(i => i !== -1);
        return active[Math.floor(Math.random() * active.length)];
    }

    unselectAll() {
        this.tiles.forEach(t => { if (t[1] === TILE.selected) t[1] = TILE.active; });
        this.src_tile = -1;
        this.dst_tile = -1;
    }

    removeSelectedTilePair() {
        let t1 = -1, t2 = -1;
        for (let i = 0; i < this.tiles.length; i++) {
            if (this.tiles[i][1] === TILE.selected) {
                if (t1 === -1) t1 = i; else { t2 = i; break; }
            }
        }
        if (t1 !== -1 && t2 !== -1) {
            const [t1_idx] = this.tiles[t1], [t2_idx] = this.tiles[t2];
            this.animations.push({ type: 'pop', idx: t1, tile_idx: t1_idx, start: Date.now(), duration: 500 });
            this.animations.push({ type: 'pop', idx: t2, tile_idx: t2_idx, start: Date.now(), duration: 500 });
            
            if (!this.demo_mode) {
                const timeSinceLast = (Date.now() - this.lastMatchTime) / 1000;
                const points = 100 + Math.max(0, 10 - Math.floor(timeSinceLast)) * 20;
                this.totalScore += points;
                this.lastMatchTime = Date.now();
                const [col, row] = this.idxToCoord(t1);
                this.animations.push({ type: 'points', x: col * this.tile_width + this.tile_width/2, y: row * this.tile_height + this.tile_height/2, points, start: Date.now(), duration: 1000 });
            }
            this.tiles[t1][1] = TILE.dead;
            this.tiles[t2][1] = TILE.dead;
            this.src_tile = -1;
            this.dst_tile = -1;
        }
    }

    getUnusedTile() {
        const unused = this.tiles.map((t, i) => t[1] === TILE.unused ? i : -1).filter(i => i !== -1);
        return unused[Math.floor(Math.random() * unused.length)];
    }

    #drawAnimations(ctx) {
        const now = Date.now();
        this.animations = this.animations.filter(anim => {
            const progress = Math.min((now - anim.start) / anim.duration, 1);
            ctx.save();
            if (anim.type === 'pop') {
                const scale = 1 + Math.sin(progress * Math.PI) * 0.4;
                ctx.globalAlpha = 1 - progress;
                const [bx, by] = this.idxToCoord(anim.idx);
                ctx.translate(bx * this.tile_width + this.tile_width/2, by * this.tile_height + this.tile_height/2);
                ctx.scale(scale, scale);
                const [tx, ty] = this.sheet.idxToCoord(anim.tile_idx);
                ctx.drawImage(this.sheet.dark_image, tx * this.sheet.tile_width, ty * this.sheet.tile_height, this.sheet.tile_width, this.sheet.tile_height, -this.tile_width/2, -this.tile_height/2, this.tile_width, this.tile_height);
            } else if (anim.type === 'points') {
                ctx.fillStyle = `rgba(162, 155, 254, ${1 - progress})`;
                ctx.font = "bold 24px Arial"; ctx.textAlign = 'center';
                ctx.fillText("+" + anim.points, anim.x, anim.y - (progress * 50));
            }
            ctx.restore();
            return progress < 1;
        });
    }

    draw(ctx) {
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        this.tile_width = ctx.canvas.width / this.numCols;
        this.tile_height = ctx.canvas.height / this.numRows;
        this.#drawOutline(ctx);

        this.pulse = (this.pulse + 0.05) % (Math.PI * 2);
        const glow = 0.5 + Math.sin(this.pulse) * 0.5;

        for (let i = 0; i < this.tiles.length; i++) {
            const [col, row] = this.idxToCoord(i);
            if (col === 0 || col === this.numCols - 1 || row === 0 || row === this.numRows - 1) continue;

            const [ss_idx, state] = this.tiles[i];
            if (state === TILE.dead) continue;

            const [tx, ty] = this.sheet.idxToCoord(ss_idx);
            const dx = col * this.tile_width, dy = row * this.tile_height;

            ctx.save();
            if (state === TILE.active && i === this.hoverIdx) {
                ctx.shadowBlur = 10; ctx.shadowColor = 'rgba(255, 255, 255, 0.5)';
            }
            if (state === TILE.selected) {
                ctx.shadowBlur = 15 * glow; ctx.shadowColor = '#a29bfe';
                ctx.translate(dx + this.tile_width/2, dy + this.tile_height/2);
                ctx.scale(1.05, 1.05);
                ctx.translate(-(dx + this.tile_width/2), -(dy + this.tile_height/2));
            }

            const img = (state === TILE.selected && !spriteIdx) ? this.sheet.light_image : this.sheet.dark_image;
            ctx.drawImage(img, tx * this.sheet.tile_width, ty * this.sheet.tile_height, this.sheet.tile_width, this.sheet.tile_height, dx, dy, this.tile_width, this.tile_height);
            ctx.restore();
        }

        this.#drawArrowPath(ctx);
        this.#drawAnimations(ctx);
        if (!this.animationLoopStarted) {
            this.animationLoopStarted = true;
            const loop = () => { this.draw(ctx); requestAnimationFrame(loop); };
            requestAnimationFrame(loop);
        }
    }

    posToBoardIdx(x, y) {
        const col = Math.floor(x / this.tile_width);
        const row = Math.floor(y / this.tile_height);
        return this.coordToIdx(col, row);
    }

    coordToPos(col, row) {
        return [col * this.tile_width, row * this.tile_height];
    }

    hasValidPath(p1, p2) {
        const [p1x, p1y] = this.idxToCoord(p1), [p2x, p2y] = this.idxToCoord(p2);
        let path = this.#isReachable(p1x, p1y, p2x, p2y);
        if (path) return path;

        const rows = this.#allValidRowsFromPoint(p1x, p1y);
        for (let r of rows) {
            let p2p = this.#isReachable(r, p1y, p2x, p2y);
            if (p2p) return [[p1x, p1y, r, p1y], ...p2p];
            const cols = this.#allValidColsFromPoint(r, p1y);
            for (let c of cols) {
                let p3p = this.#isReachable(r, c, p2x, p2y);
                if (p3p) return [[p1x, p1y, r, p1y], [r, p1y, r, c], ...p3p];
            }
        }

        const cols = this.#allValidColsFromPoint(p1x, p1y);
        for (let c of cols) {
            let p2p = this.#isReachable(p1x, c, p2x, p2y);
            if (p2p) return [[p1x, p1y, p1x, c], ...p2p];
            const rows = this.#allValidRowsFromPoint(p1x, c);
            for (let r of rows) {
                let p3p = this.#isReachable(r, c, p2x, p2y);
                if (p3p) return [[p1x, p1y, p1x, c], [p1x, c, r, c], ...p3p];
            }
        }
        return null;
    }

    shuffle(interactive = true) {
        if (interactive && this.demo_mode) return;
        this.unselectAll();
        const active = this.tiles.map((t, i) => t[1] === TILE.active ? i : -1).filter(i => i !== -1);
        for (let i = active.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.tiles[active[i]][0], this.tiles[active[j]][0]] = [this.tiles[active[j]][0], this.tiles[active[i]][0]];
        }
        if (!this.solve(false)) return this.shuffle(false);
        if (interactive) { timer.elapsed += 60; triggerPenalty(); }
        return true;
    }

    autosolveImpl(setArrows = true) {
        for (let s = 0; s < this.tiles.length; s++) {
            if (this.tiles[s][1] !== TILE.active) continue;
            for (let d = 0; d < this.tiles.length; d++) {
                if (s === d || this.tiles[d][1] !== TILE.active || this.tiles[s][0] !== this.tiles[d][0]) continue;
                const path = this.hasValidPath(s, d);
                if (path) {
                    this.tiles[s][1] = TILE.selected; this.tiles[d][1] = TILE.selected;
                    if (setArrows) { this.arrows = path; this.arrowShowTime = Date.now(); }
                    return SOLVED.one;
                }
            }
        }
        return this.#getNumActiveTiles() === 0 ? SOLVED.all : SOLVED.none;
    }

    solve(setArrows = false) {
        const backup = JSON.stringify(this.tiles);
        let status;
        while ((status = this.autosolveImpl(setArrows)) === SOLVED.one);
        this.tiles = JSON.parse(backup);
        return status === SOLVED.all;
    }

    hint(interactive = true) {
        if (this.demo_mode) return;
        const status = this.autosolveImpl(true);
        if (interactive) {
            if (status !== SOLVED.none) { timer.elapsed += 60; triggerPenalty(); }
            else { alert("No moves! Shuffling..."); this.shuffle(); }
            this.unselectAll();
        }
        return status;
    }

    mouseClick(board, xpos, ypos, interactive) {
        const idx = this.posToBoardIdx(xpos, ypos);
        if (idx < 0 || idx >= this.tiles.length) return;
        const [t_idx, state] = this.tiles[idx];
        if (this.src_tile === -1) {
            if (state === TILE.active) { this.src_tile = idx; this.tiles[idx][1] = TILE.selected; }
        } else {
            if (state !== TILE.active || idx === this.src_tile) { this.tiles[this.src_tile][1] = TILE.active; }
            else {
                this.tiles[idx][1] = TILE.selected;
                const path = this.hasValidPath(this.src_tile, idx);
                if (path) {
                    this.arrows = path; this.arrowShowTime = Date.now();
                    this.removeSelectedTilePair();
                    if (this.#getNumActiveTiles() === 0) { gameOver(timer.elapsed); this.init(); }
                } else { this.tiles[this.src_tile][1] = TILE.active; this.tiles[idx][1] = TILE.active; }
            }
            this.src_tile = -1;
        }
    }

    init() {
        this.tiles = Array.from({ length: this.numCols * this.numRows }, () => [this.sheet.empty_tile, TILE.unused]);
        this.#populateInvisibleBorder();
        if (levelParam) {
            decodeBoard(levelParam).forEach((val, i) => { const idx = activeIdxToBoard(i); this.tiles[idx] = [val, TILE.active]; });
        } else {
            for (let i = 0; i < this.active_size / 2; i++) {
                const t = this.sheet.getRandomTile();
                this.tiles[this.getUnusedTile()] = [t, TILE.active];
                this.tiles[this.getUnusedTile()] = [t, TILE.active];
            }
            if (!this.solve(false)) return this.init();
        }
        this.totalScore = 0; this.lastMatchTime = Date.now(); updateTimeBar(0);
        this.draw(ctx);
    }
}

function getSpriteIndex(idx) {
    const configs = [
        { w: 128, h: 128, c: 10, r: 4, d: "assets/deck_mahjong_dark_0.png", l: "assets/deck_mahjong_light_0.png", e: 38, u: [38, 39] },
        { w: 128, h: 128, c: 6, r: 2, d: "assets/pieces.png", l: "assets/pieces.png", e: 12, u: [] },
        { w: 128, h: 128, c: 6, r: 1, d: "assets/chess.png", l: "assets/chess.png", e: 6, u: [] },
        { w: 128, h: 192, c: 13, r: 4, d: "assets/cards.jpg", l: "assets/cards.jpg", e: 52, u: [] }
    ];
    const cfg = configs[idx] || configs[0];
    const s = new SpriteSheet(cfg.w, cfg.h, cfg.c, cfg.r, cfg.d, cfg.l);
    s.empty_tile = cfg.e; s.unused_tiles = cfg.u;
    return s;
}

const timer = {
    elapsed: 0, timerid: null, callback: null,
    tick: function() { this.elapsed++; this.callback(this); },
    start: function() { if (!this.timerid) this.timerid = setInterval(this.tick.bind(this), 1000); },
    init: function(cb) { this.elapsed = 0; this.callback = cb; this.start(); }
};

function updateTimeBar(e) {
    const bar = document.getElementById('time-bar');
    if (bar) bar.style.width = Math.min((e / 900) * 100, 100) + "%";
}

function triggerPenalty() {
    const s = document.getElementById('score_div'), t = document.getElementById('time-bar');
    s.classList.remove('penalty'); void s.offsetWidth; s.classList.add('penalty');
    if (t) { t.style.backgroundColor = '#ff4757'; setTimeout(() => t.style.backgroundColor = '#a29bfe', 500); }
}

const board = new GameBoard(16, 12, getSpriteIndex(spriteIdx));
timer.init((t) => { updateScoreCanvas(t); updateTimeBar(t.elapsed); });

function updateScoreCanvas() {
    const c = document.getElementById('score_canvas');
    if (!c) return;
    const g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = "24px Arial, sans-serif"; g.fillStyle = "#fff";
    g.fillText(board.totalScore.toLocaleString(), c.width / 2, c.height / 2 + 1);
}

let demoId = null;
function demo() {
    const delay = 500;
    if (!board.demo_mode) {
        board.demo_mode = true; board.init();
        demoId = setInterval(() => {
            const s = board.autosolveImpl();
            if (s === SOLVED.all) { board.demo_mode = false; clearInterval(demoId); board.init(); }
            else if (s === SOLVED.none) board.shuffle();
            else setTimeout(() => board.removeSelectedTilePair(), delay / 2);
        }, delay);
    } else { board.demo_mode = false; clearInterval(demoId); board.init(); }
}
