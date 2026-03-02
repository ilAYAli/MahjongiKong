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
    //ctx.canvas.width  = window.innerWidth;
    //ctx.canvas.height = window.innerHeight;
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
        board.draw(ctx);
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
    // Calculate scale factor in case the canvas is resized by CSS
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
    // Don't preventDefault here to allow scrolling
}, { passive: true });

canvas.addEventListener('touchend', function(e) {
    const touch = e.changedTouches[0];
    const dx = Math.abs(touch.clientX - touchStartX);
    const dy = Math.abs(touch.clientY - touchStartY);
    const dt = Date.now() - touchStartTime;

    // Only trigger click if it's a quick tap with minimal movement
    if (dx < 10 && dy < 10 && dt < 300) {
        e.preventDefault(); // Prevent ghost clicks
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
    console.assert(row < board.rows -2);
    console.assert(row >= 0);
    console.assert(col < board.cols - 2);
    console.assert(row >= 0);
    return (board.rows + board.rows * col) + row +1;
}

// return board idx from active idx
function activeIdxToBoard(idx) {
    let c = Math.floor(idx / 14);
    let r = Math.floor(idx % 14);
    return activeCoordToBoard(c, r);
}

function encodeBoard() {
    let pt = [];
    for (let c = 0; c < 10; c++) {
        for (let r = 0; r < 14; r++) {
            // TODO: add active/inactive?
            pt += board.tiles[activeCoordToBoard(c, r)][0].toString(16).padStart(2, '0');
        }
    }
    let ec = LZString.compressToEncodedURIComponent(pt);
    let uri = "https://wahlman.no/code/MahjongiKong?l=";
    console.log(uri + ec);

    URI = uri + ec;
    let link = document.getElementById("share").getElementsByClassName("dropdown-content")[0];
    link.style.width = "220px";
    let qr = document.getElementById("url");
    qr.href = URI;

    return uri + ec;
}

function decodeBoard(ec) {
    let pt = LZString.decompressFromEncodedURIComponent(ec);
    let tiles = [];
    for (let i = 0; i < pt.length; i+=2) {
        let s = pt.substring(i, i + 2);
        tiles.push(parseInt(s, 16));
    }
    return tiles;
}

function createQR() {
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
        console.assert(idx < (this.cols * this.rows), this.idxToCoord.name, ": index too large:", idx);
        let tile_y = Math.floor(idx / this.rows)
        let tile_x = Math.floor(idx % this.rows)
        return [tile_x, tile_y]
    }

    getRandomTile () {
        while (true) {
            let idx = Math.floor(Math.random() * this.cols * this.rows);
            let [sprite_x, sprite_y] = this.idxToCoord(idx)

            let usable = true;
            for (let i = 0; i < this.unused_tiles.length; ++i) {
                if (idx == this.unused_tiles[i]) {
                    usable = false;
                    break;
                }
            }

            if (!usable)
                continue;

            return idx;
        }
    }
}


class GameBoard {
    constructor(cols, rows, sheet) {
        this.cols = cols;
        this.rows = rows;
        this.sheet = sheet;
        this.active_rows = rows - 2;
        this.active_cols = cols - 2;
        this.active_size = this.active_rows * this.active_cols;
        this.tile_width = 0;
        this.tile_height = 0;

        this.src_tile = 0;
        this.dst_tile = 0;

        this.tiles = [];
        this.arrows = [];

        this.score = 0;
        this.margin = 0;

        this.draw_arrows = true;
        this.demo_mode = false;
        this.have_hint = false;
        this.animations = [];
        this.pulse = 0;
        this.hoverIdx = -1;
    }

// private:
    #drawLine(ctx, x1, y1, x2, y2) {
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
    }

    #drawArrowHead(ctx, x1, y1, x2, y2, filled) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        ctx.beginPath();
        ctx.moveTo(x1 + 0.5 * dy, y1 - 0.5 * dx);
        ctx.lineTo(x1 - 0.5 * dy, y1 + 0.5 * dx);
        ctx.lineTo(x2, y2);
        ctx.closePath();
        filled ? ctx.fill() : ctx.stroke();
    }

    #drawArrowPath(ctx) {
        if (!this.draw_arrows || this.arrows.length === 0) {
            this.arrows.splice(0, this.arrows.length)
            return;
        }

        ctx.save();
        
        // Setup glow effect
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.lineWidth = 6;
        ctx.strokeStyle = '#6c5ce7'; // Theme purple
        ctx.shadowBlur = 10;
        ctx.shadowColor = '#a29bfe';
        
        ctx.beginPath();
        let first = true;
        this.arrows.forEach((arrow, index) => {
            let [x1, y1] = board.coordToPos(arrow[0], arrow[1]);
            let [x2, y2] = board.coordToPos(arrow[2], arrow[3]);
            x1 += (this.tile_width/2); y1 += (this.tile_height/2);
            x2 += (this.tile_width/2); y2 += (this.tile_height/2);
            
            if (first) {
                ctx.moveTo(x1, y1);
                first = false;
            }
            ctx.lineTo(x2, y2);
        });
        ctx.stroke();

        // Inner bright line
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#fff';
        ctx.shadowBlur = 0;
        ctx.stroke();

        // Draw Arrowhead at the end
        const last = this.arrows[this.arrows.length - 1];
        let [lx1, ly1] = board.coordToPos(last[0], last[1]);
        let [lx2, ly2] = board.coordToPos(last[2], last[3]);
        lx1 += (this.tile_width/2); ly1 += (this.tile_height/2);
        lx2 += (this.tile_width/2); ly2 += (this.tile_height/2);
        
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
        this.arrows.splice(0, this.arrows.length)
    }

    #drawOutline(ctx) {
        let active_width = (board.rows - 2) * this.tile_width;
        let active_height = (board.cols - 2) * this.tile_height;

        ctx.beginPath();

        let top_left_x = this.tile_width;
        let top_left_y = this.tile_height;

        let top_right_x = top_left_x + active_width;
        let top_right_y = top_left_y;

        let bottom_left_x = top_left_x;
        let bottom_left_y = top_right_y + active_height;

        let bottom_right_x = top_right_x;
        let bottom_right_y = bottom_left_y;

        ctx.moveTo(top_left_x, top_left_y);
        ctx.lineTo(top_right_x, top_right_y);

        ctx.lineTo(bottom_right_x, bottom_right_y);

        ctx.lineTo(bottom_left_x, bottom_left_y);
        ctx.lineTo(top_left_x, top_left_y);

        ctx.lineWidth = 1;
        ctx.strokeStyle = '#aaaaaa';
        ctx.stroke();
    }

    #populateInvisibleBorder() {
        let board_size = this.cols * this.rows;

        let border_state = TILE.dead;
        let border_tile = this.sheet.empty_tile;

        // top:
        for (let i = 0; i < this.rows; i++) {
            this.tiles[i] = [border_tile, border_state];
        }

        // bottom:
        for (let i = 0; i < this.rows; i++) {
            this.tiles[board_size - i - 1] = [border_tile, border_state];
        }

        // left:
        for (let i = 0; i < this.cols; i++) {
            this.tiles[i * this.rows] = [border_tile, border_state];
        }
        // right:
        for (let i = 0; i < this.cols; i++) {
            this.tiles[i * this.rows + (this.rows -1)] = [border_tile, border_state];
        }
    }

    #posToBoardCoord(x, y) {
        console.log("posToBoardCoord:", x, y, "->", x / this.tile_width, y / this.tile_height);
        let tile_x = Math.floor(x / this.tile_width);
        let tile_y = Math.floor(y / this.tile_height);
        return [tile_x, tile_y]
    }


    #allValidRowsFromPoint(x, y) {
        let valid_moves = [];
        for (let i = 0; i < x; i++) {
            let dx = x - (i + 1);
            let valid = this.#isValidHmode(x, y, dx);
            if (!valid)
                break;
            valid_moves.push(dx);
        }

        for (let i = 1; (x + i) < this.rows; i++) {
            let dx = x + i
            let valid = this.#isValidHmode(x, y, dx);
            if (!valid)
                break;
            valid_moves.push(dx);
        }

        return valid_moves;
    }


    #allValidColsFromPoint(x, y) {
        let valid_moves = [];
        for (let i = 0; i < y; i++) {
            let dy = y - (i + 1);
            let valid = this.#isValidVmove(x, y, dy);
            if (!valid)
                break;
            valid_moves.push(dy);
        }

        for (let i = 1; (y + i) < this.cols; i++) {
            let dy = y + i
            let valid = this.#isValidVmove(x, y, dy);
            if (!valid)
                break;
            valid_moves.push(dy);
        }

        return valid_moves;
    }


    #isValidHmode(x, y, dx) {
        let valid = true;
        let src_idx = this.#coordToIdx(x, y);
        let [src_tile, src_state] = this.tiles[src_idx];

        let dist = Math.abs(dx - x);
        let mod = x < dx ? 1 : -1;
        for (let i = 1; i <= dist; i++) {
            let tx = x + (i * mod);
            let board_idx = this.#coordToIdx(tx, y);
            let [tile_idx, state] = this.tiles[board_idx];
            if (state == TILE.active) {
                valid = false;
                break;
            }
        }
        return valid;
    }


    #isValidVmove(x, y, dy) {
        let valid = true;
        let src_idx = this.#coordToIdx(x, y);
        let [src_tile, src_state] = this.tiles[src_idx];

        let dist = Math.abs(dy - y);
        let mod = y < dy ? 1 : -1;
        for (let i = 1; i <= dist; i++) {
            let ty = y + (i * mod);
            if (ty >= this.cols) {
                valid = false;
                break;
            }
            let board_idx = this.#coordToIdx(x, ty);
            let [tile_idx, state] = this.tiles[board_idx];
            if (state == TILE.active) {
                valid = false;
                break;
            }
        }

        return valid;
    }


    #isReachable(r, c, tr, tc) {
        if ((c == tc) && (this.#isValidHmode(r, c, tr))) {
            return true;
        }
        if ((r == tr) && (this.#isValidVmove(r, c, tc))) {
            return true;
        }
        return false;
    }


    #coordToIdx(r, c) {
        console.assert(r < this.rows, this.#coordToIdx.name, ": x pos is too large");
        console.assert(c < this.cols, this.#coordToIdx.name, ": y pos is too large");
        let idx = (c * this.rows) + r;
        return idx;
    }

    #getNumActiveTiles () {
        let board_size = this.cols * this.rows;
        let active = 0;
        for (let i = 0; i < board_size; i++) {
            if (this.tiles[i][1] == TILE.active)
                active++;
        }
        return active;
    }

    #getRandomActiveTile () {
        let board_size = this.cols * this.rows;
        while (true) {
            let idx = Math.floor(Math.random() * board_size);
            if (this.tiles[idx][1] == TILE.active) {
                return idx;
            }
        }
    }

// public:
    unselectAll () {
        let board_size = this.cols * this.rows;
        for (let i = 0; i < board_size; i++) {
            if (this.tiles[i][1] == TILE.selected) {
                this.tiles[i][1] = TILE.active;
            }
        }
    }

    removeSelectedTilePair () {
        let board_size = this.cols * this.rows;
        let t1 = -1;
        let t2 = -1;
        for (let i = 0; i < board_size; i++) {
            if (this.tiles[i][1] == TILE.selected) {
                if (t1 == -1)
                    t1 = i;
                else
                    t2 = i;
            }
            if (t1 != -1 && t2 != -1) {
                //console.assert(this.tiles[t1][0] != this.tiles[t2][0]);
                //console.log("selected pair:", t1, t2);
                if (this.tiles[t1][0] != this.tiles[t2][0]) {
                    console.log("error, selected is not a pair:", this.tiles[t1][0], this.tiles[t2][0]);
                }

                // Trigger animations
                const [t1_idx, t1_state] = this.tiles[t1];
                const [t2_idx, t2_state] = this.tiles[t2];
                this.animations.push({ type: 'pop', idx: t1, tile_idx: t1_idx, start: Date.now(), duration: 500 });
                this.animations.push({ type: 'pop', idx: t2, tile_idx: t2_idx, start: Date.now(), duration: 500 });
                
                const [r, c] = this.idxToCoord(t1);
                this.animations.push({
                    type: 'points',
                    x: r * this.tile_width + this.tile_width/2,
                    y: c * this.tile_height + this.tile_height/2,
                    start: Date.now(),
                    duration: 1000
                });

                this.tiles[t1][1] = TILE.dead;
                this.tiles[t2][1] = TILE.dead;
            }
        }
        this.draw(ctx);
    }

    // includes inactive area:
    idxToCoord(idx) {
        console.assert(idx < (board.rows * board.cols), this.idxToCoord.name, ": index too large:", idx);
        let r = Math.floor(idx % board.rows);
        let c = Math.floor(idx / board.rows);
        return [r, c]
    }

    getUnusedTile() {
        let board_size = this.cols * this.rows;
        while (true) {
            let idx = Math.floor(Math.random() * board_size);
            if (this.tiles[idx][1] == TILE.unused) {
                return idx;
            }
        }
    }

    #drawAnimations(ctx) {
        const now = Date.now();
        this.animations = this.animations.filter(anim => {
            const elapsed = now - anim.start;
            const progress = Math.min(elapsed / anim.duration, 1);
            
            ctx.save();
            if (anim.type === 'pop') {
                const scale = 1 + Math.sin(progress * Math.PI) * 0.4;
                const alpha = 1 - progress;
                ctx.globalAlpha = alpha;
                
                const [board_x, board_y] = this.idxToCoord(anim.idx);
                const dx = board_x * this.tile_width + (this.tile_width / 2);
                const dy = board_y * this.tile_height + (this.tile_height / 2);
                
                ctx.translate(dx, dy);
                ctx.scale(scale, scale);
                
                let [tile_x, tile_y] = this.sheet.idxToCoord(anim.tile_idx);
                ctx.drawImage(
                    this.sheet.dark_image,
                    tile_x * this.sheet.tile_width, tile_y * this.sheet.tile_height, 
                    this.sheet.tile_width, this.sheet.tile_height,
                    -this.tile_width / 2, -this.tile_height / 2, 
                    this.tile_width, this.tile_height
                );
            } else if (anim.type === 'points') {
                ctx.fillStyle = `rgba(162, 155, 254, ${1 - progress})`;
                ctx.font = "bold 24px Arial";
                ctx.textAlign = 'center';
                ctx.fillText("+1", anim.x, anim.y - (progress * 50));
            }
            ctx.restore();
            
            return progress < 1;
        });
    }

    draw(ctx) {
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        this.tile_width = ctx.canvas.width / board.rows;
        this.tile_height = this.tile_width;
        this.#drawOutline(ctx);

        this.pulse = (this.pulse + 0.05) % (Math.PI * 2);
        const selectionGlow = 0.5 + Math.sin(this.pulse) * 0.5;

        for (let i = 0; i < this.tiles.length; i++) {
            let [board_x, board_y] = this.idxToCoord(i);
            const border = ((board_y == 0 || (board_y == this.cols -1)) ||
                            (board_x == 0 || (board_x == this.rows -1)));
            if (border) continue;

            let [ss_idx, state] = this.tiles[i]
            if (state == TILE.dead) continue;

            let [tile_x, tile_y] = this.sheet.idxToCoord(ss_idx);
            const sx = tile_x * this.sheet.tile_width;
            const sy = tile_y * this.sheet.tile_height;
            const dx = board_x * this.tile_width;
            const dy = board_y * this.tile_height;

            ctx.save();
            if (state === TILE.active && i === this.hoverIdx) {
                ctx.shadowBlur = 10;
                ctx.shadowColor = 'rgba(255, 255, 255, 0.5)';
                ctx.globalAlpha = 0.9;
            }

            if (state == TILE.selected) {
                ctx.shadowBlur = 15 * selectionGlow;
                ctx.shadowColor = '#a29bfe';
                // Subtle lift effect
                ctx.translate(dx + this.tile_width/2, dy + this.tile_height/2);
                ctx.scale(1.05, 1.05);
                ctx.translate(-(dx + this.tile_width/2), -(dy + this.tile_height/2));
            }

            let ss = this.sheet.dark_image;
            if (state == TILE.selected && !spriteIdx) {
                ss = this.sheet.light_image;
            }

            ctx.drawImage(
                ss,
                sx, sy, this.sheet.tile_width, this.sheet.tile_height,
                dx, dy, this.tile_width, this.tile_height);
            
            ctx.restore();
        }

        this.#drawArrowPath(ctx);
        this.#drawAnimations(ctx);
        
        requestAnimationFrame(() => this.draw(ctx));
    }

    posToBoardIdx(x, y) {
        let tile_x = Math.floor(x / this.tile_width);
        let tile_y = Math.floor(y / this.tile_height);
        let idx = (tile_y * board.rows) + tile_x;
        return idx;
    }

    coordToPos(r, c) {
        let x = (board.tile_width * r);
        let y = (board.tile_height * c);
        return [x, y];
    }

    hasValidPath(p1, p2) {
        let [p1x, p1y] = this.idxToCoord(p1);
        let [p2x, p2y] = this.idxToCoord(p2);

        if (this.#isReachable(p1x, p1y, p2x, p2y)) {
            // point 1:
            this.arrows.push([ p1x, p1y, p2x, p2y ]);
            return true;
        }

        // check horizontal -> vertical:
        if (true) {
            this.arrows.length = 0;
            let valid_rows = this.#allValidRowsFromPoint(p1x, p1y);
            for (let r = 0; r < valid_rows.length; r++) {
                if (this.#isReachable(valid_rows[r], p1y, p2x, p2y)) {
                    // point 2:
                    this.arrows.push([ p1x, p1y, valid_rows[r], p1y ]);
                    this.arrows.push([ valid_rows[r], p1y, p2x, p2y ]);
                    return true;
                }

                let valid_cols = this.#allValidColsFromPoint(valid_rows[r], p1y)
                for (let c = 0; c < valid_cols.length; c++) {
                    if (this.#isReachable(valid_rows[r], valid_cols[c], p2x, p2y)) {
                        // point 3:
                        this.arrows.push([ p1x, p1y, valid_rows[r], p1y ]);
                        this.arrows.push([ valid_rows[r], p1y, valid_rows[r], valid_cols[c] ]);
                        this.arrows.push([ valid_rows[r], valid_cols[c], p2x, p2y ]);
                        return true;
                    }
                }
            }
        }

        // vertical -> horizontal:
        if (true) {
            this.arrows.length = 0;
            let valid_cols = this.#allValidColsFromPoint(p1x, p1y);
            for (let c = 0; c < valid_cols.length; c++) {
                if (this.#isReachable(p1x, valid_cols[c], p2x, p2y)) {
                    // point 2:
                    this.arrows.push([ p1x, p1y, p1x, valid_cols[c] ]);
                    this.arrows.push([ p1x, valid_cols[c], p2x, p2y ]);
                    return true;
                }

                let valid_rows = this.#allValidRowsFromPoint(p1x, valid_cols[c])
                for (let r = 0; r < valid_rows.length; r++) {
                    if (this.#isReachable(valid_rows[r], valid_cols[c], p2x, p2y)) {
                        // point 3:
                        this.arrows.push([ p1x, p1y, p1x, valid_cols[c] ]);
                        this.arrows.push([ p1x, valid_cols[c], valid_rows[r], valid_cols[c] ]);
                        this.arrows.push([ valid_rows[r], valid_cols[c], p2x, p2y ]);
                        return true;
                    }
                }
            }
        }

        return false;
    }

    shuffle(interactive = true, attempt = 0, shuffled = []) {
        attempt++;
        if (interactive && this.demo_mode) {
            console.log("can't shuffle while demo is active");
            return;
        }

        board.src_tile = -1;
        board.dst_tile = -1;
        for (let i = 0; i < this.tiles.length; i++) {
            const [ss_idx, state] = this.tiles[i]
            if (state == TILE.selected) {
                this.tiles[i] = [ss_idx, TILE.active];
            }
        }

        const t1_idx = this.#getRandomActiveTile();
        const [t1_ss_idx, t1_state] = this.tiles[t1_idx]
        let t2_idx = -1;
        for (let i = 0; i < this.tiles.length; i++) {
            const tmp_idx = this.#getRandomActiveTile();
            if (tmp_idx != t1_idx) {
                const [tmp_ss_idx, tmp_state] = this.tiles[tmp_idx]
                if (tmp_ss_idx != t1_ss_idx) {
                    t2_idx = tmp_idx;
                    break;
                }
            }
        }

        if (t2_idx == -1) {
            console.log("attempt:", attempt, "unable to find any tiles to swap");
            this.tiles = structuredClone(board_cpy);
            return false;
        }

        const tmp = this.tiles[t1_idx];
        this.tiles[t1_idx] = this.tiles[t2_idx]
        this.tiles[t2_idx] = tmp;
        shuffled.push(t1_idx);
        shuffled.push(t2_idx);

        const solvable = this.solve();
        if (!solvable) {
            console.log(attempt, ": not solvable, re-shuffling");
            return this.shuffle(false, attempt, shuffled);
        }

        console.log("shuffled:", shuffled.length);
        shuffled.forEach((elt) => {
            this.tiles[elt][1] = TILE.selected;
        });

        this.draw(ctx);
        this.unselectAll();

        if (interactive) {
            timer.elapsed += 60;
            triggerPenalty();
        }

        return true;
    }

    autosolveImpl() {
        const active_pre = this.#getNumActiveTiles();
        let valid = false;
        for (let sidx = 0; sidx < (this.rows * this.cols); sidx++) {
            let [src_tile_idx, src_tile_state] = this.tiles[sidx];
            if (src_tile_state != TILE.active)
                continue;

            for (let didx = 0; didx < (this.rows * this.cols); didx++) {
                if (didx == sidx)
                    continue;

                let [dst_tile_idx, dst_tile_state] = this.tiles[didx];
                if (dst_tile_state != TILE.active)
                    continue;

                if (src_tile_idx != dst_tile_idx)
                    continue;

                this.tiles[sidx][1] = TILE.selected;
                this.tiles[didx][1] = TILE.selected;
                valid = this.hasValidPath(sidx, didx);
                if (!valid) {
                    this.tiles[sidx][1] = TILE.active;
                    this.tiles[didx][1] = TILE.active;
                    continue;
                }

                return SOLVED.one;
            }
        }
        const active_post = this.#getNumActiveTiles();
        if (!active_post) {
            //console.log("[autosolve] this board was solved");
            return SOLVED.all;
        }

        if (active_pre != active_post) {
            //console.log("[autosolve] one move was solved");
            return SOLVED.one;
        }

        //console.log("[autosolve] this board is not solvable");
        return SOLVED.none;
    }

    solve() {
        const should_draw_arrows = this.draw_arrows;
        this.draw_arrows = false;
        const tmp_score = this.score;
        const board_clone = structuredClone(this.tiles);

        let status = SOLVED.none;
        for (let i = 0; i < this.tiles.length / 2; i++) {
            status = this.autosolveImpl();
            if (status != SOLVED.one)
                break;
        }

        this.tiles = structuredClone(board_clone);
        this.score = tmp_score;
        this.draw(ctx);
        this.draw_arrows = should_draw_arrows;
        return status == SOLVED.all;
    }

    hint(interactive = true) {
        if (this.have_hint) return true;

        if (interactive && this.demo_mode) {
            console.log("can't request hint while demo is active");
            return;
        }
        const should_draw_arrows = this.draw_arrows;
        board.draw_arrows = true;
        const status = this.autosolveImpl();
        board.draw(ctx);
        board.draw_arrows = should_draw_arrows;

        if (interactive) {
            if (status != SOLVED.none) {
                timer.elapsed += 60;
                triggerPenalty();
            }
            else {
                alert("no moves found, shuffling..");
                this.shuffle();
            }
            this.unselectAll();
        }

        //if (status) this.have_hint = true;
        return status;
    }

    mouseClick(board, xpos, ypos, interactive) {
        const board_width = (board.rows * this.tile_width);
        const board_height = (board.cols * this.tile_height);

        if ((xpos < 0) || (xpos > board_width)) {
            console.log("invalid xpos: ", xpos);
            return;
        }
        if ((ypos < 0) || (ypos > board_height)) {
            console.log("invalid ypos: ", ypos);
            return;
        }

        let board_idx = board.posToBoardIdx(xpos, ypos)
        let [board_row, board_col] = board.idxToCoord(board_idx);
        let [tile_idx, tile] = board.tiles[board_idx];

        let [x1, y1] = board.coordToPos(board_row, board_col);

        this.have_hint = false;
        board.dst_tile = -1;
        if (board.src_tile == -1) {
            if (tile == TILE.active) {
                board.src_tile = board_idx;
                board.tiles[board.src_tile][1] = TILE.selected;
            }
        } else {
            let [src_tile_idx, src_tile_state] = board.tiles[board.src_tile];

            if (tile != TILE.active) {
                board.tiles[board.src_tile][1] = TILE.active;
            } else {
                board.dst_tile = board_idx;

                let [dst_tile_idx, dst_tile_state] = board.tiles[board.dst_tile];

                if (src_tile_idx != dst_tile_idx) { // not matching tiles:
                    board.tiles[board.src_tile] = [src_tile_idx, TILE.active]
                    board.tiles[board.dst_tile] = [dst_tile_idx, TILE.active]
                } else {
                    board.tiles[board.dst_tile] = [dst_tile_idx, TILE.selected];
                    if (!board.hasValidPath(board.src_tile, board_idx)) {
                        board.tiles[board.src_tile] = [src_tile_idx, TILE.active]
                        board.tiles[board.dst_tile] = [dst_tile_idx, TILE.active]
                    } else {
                        // Success! Trigger animations
                        const [src_idx, src_state] = board.tiles[board.src_tile];
                        const [dst_idx, dst_state] = board.tiles[board.dst_tile];
                        
                        this.animations.push({
                            type: 'pop',
                            idx: board.src_tile,
                            tile_idx: src_idx,
                            start: Date.now(),
                            duration: 500
                        });
                        this.animations.push({
                            type: 'pop',
                            idx: board_idx,
                            tile_idx: dst_idx,
                            start: Date.now(),
                            duration: 500
                        });
                        
                        this.animations.push({
                            type: 'points',
                            x: xpos,
                            y: ypos,
                            start: Date.now(),
                            duration: 1000
                        });

                        board.tiles[board.src_tile] = [src_tile_idx, TILE.dead]
                        board.tiles[board.dst_tile] = [dst_tile_idx, TILE.dead]
                        board.score++;
                        next_hint = DEFAULT_TIMEOUT;

                        const remaining_pices = this.#getNumActiveTiles();
                        if (!remaining_pices) {
                            gameOver(timer.elapsed);
                            board.init();
                            return;
                        }
                    }
                }
            }
            board.src_tile = -1;
            board.dst_tile = -1;
        }

        board.draw(ctx);
    }


    // not related to sprite type
    #populateLevel(level)
    {
        console.assert(level == 0, "level: ", level, "is not implemented");

        if (level == 0) {
            for (let i = 0; i < board.active_size/2; i++) {
                let ss_tile = board.sheet.getRandomTile();

                let first_tile = board.getUnusedTile()
                board.tiles[first_tile] = [ss_tile, TILE.active]

                let second_tile = board.getUnusedTile()
                board.tiles[second_tile] = [ss_tile, TILE.active]
            }
        }
    }


    init(attempt = 0) {
        board.tiles = [];
        board.arrows = [];
        board.score = 0;

        if (levelParam) {
            console.log("using provided level");
            const empty_tile = 38;
            for (let i = 0; i < (board.cols * board.rows); i++) {
                board.tiles.push([empty_tile, TILE.unused]);
            }
            this.#populateInvisibleBorder();

            // decode:
            let new_board = decodeBoard(levelParam);
            for (let i = 0; i < new_board.length; i++) {
                let idx = activeIdxToBoard(i);
                board.tiles[idx][0] = new_board[i];
                board.tiles[idx][1] = TILE.active;
            }
        } else {
            const empty_tile = 38;
            for (let i = 0; i < (board.cols * board.rows); i++) {
                board.tiles.push([empty_tile, TILE.unused]);
            }
            this.#populateInvisibleBorder();

            this.#populateLevel(0);

            const solvable = this.solve();
            board.score = 0;
            attempt++;
            if (!solvable) {
                console.log("attempt:", attempt, "this board might not be solvable, generating new");
                return board.init(attempt);
                //this.shuffle();
            }
            console.log("attempt:", attempt, "this board is solvable");
        }

        encodeBoard();
        createQR();

        timer.init(updateScoreCanvas);
        board.src_tile = -1;
        board.dst_tile = -1;
        board.draw(ctx);
    }
}


function getSpriteIndex(idx)
{
    if (idx < 0 || idx > 1)
        idx = 0;

    switch (idx) {
        case 0: {
            let ss = new SpriteSheet(
                64, 64,
                5, 10,
                'assets/deck_mahjong_dark_0.png',
                'assets/deck_mahjong_light_0.png'
            );
            ss.empty_tile = 38; // 38: invisible, 49: block
            ss.unused_tiles = [ 38, 39, 48, 49 ];
            return ss;
        }

        case 1: {
            let ss = new SpriteSheet(
                64, 64,
                6, 12,
                'assets/chess.png',
                'assets/chess.png'
            );
            ss.empty_tile = 71;
            return ss;
        }


        case 2: {
            let ss = new SpriteSheet(
                84, 84,
                8, 4,
                'assets/pieces.png',
                'assets/pieces.png'
            );
            ss.empty_tile = 28;
            return ss;
        }

        case 3: {
            let ss = new SpriteSheet(
                48, 64,
                4, 16,
                'assets/cards.jpg',
                'assets/cards.jpg'
            );
            ss.empty_tile = 15;
            return ss;
        }
    }

    return undefined;
}


// globals:
const timer = {
    timerid: null,
    callback: null,
    elapsed: 0,
    start: function() {
        if (!this.timerid) {
            const timerTick = this.tick.bind(this);
            this.timerid = window.setInterval(() => {
              timerTick();
            }, 1000);
            //console.log("starting timer:", this.timerid);
        }
    },
    stop: function() {
        //console.log("stopping timer:", this.timerid);
        if (this.timerid) {
            clearInterval(this.timerid);
            this.timerid = null;
        }
    },
    init: function(callback) {
        this.elapsed = 0;
        this.callback = callback;
        this.callback(this); // Draw immediately
        this.start();
        
        // Ensure font is ready and redraw if it wasn't
        if (document.fonts) {
            document.fonts.ready.then(() => {
                this.callback(this);
            });
        }
        
        const timerStart = this.start.bind(this);
        window.onfocus = function () {
            //console.log("on focus");
            timerStart();
        };

        const timerStop = this.stop.bind(this);
        window.onblur = function () {
            //console.log("on blur");
            timerStop();
        };
    },
    tick: function() {
        this.elapsed++;
        this.callback(this);
    },
};


function triggerPenalty() {
    const scoreDiv = document.getElementById('score_div');
    scoreDiv.classList.remove('penalty');
    void scoreDiv.offsetWidth; // Trigger reflow
    scoreDiv.classList.add('penalty');
}

var board = new GameBoard(12, 16, getSpriteIndex(spriteIdx));
timer.init(updateScoreCanvas);


var next_hint = DEFAULT_TIMEOUT;
function updateScoreCanvas(timer)
{
    let xpos = 0;
    const canvas = document.getElementById('score_canvas');
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    const font_size = 24;
    ctx.font = font_size + "px Arial, sans-serif";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = "#fff";

    const date = new Date(timer.elapsed * 1000);
    const timeStr = timer.elapsed >= 3600 
        ? date.toISOString().slice(11, 19) // HH:MM:SS
        : date.toISOString().slice(14, 19); // MM:SS

    ctx.fillText(timeStr, canvas.width / 2, canvas.height / 2 + 1); // +1 for visual balance with Arial baseline

    next_hint--;
    if (next_hint <= 0) {
        next_hint = DEFAULT_TIMEOUT;
        console.log("scheduling autosolve");
        const status = board.hint(false);
        if (status == SOLVED.none) {
            alert("this board might not be solvable");
        }
    }
}


var demoId = null;
function demo(activate = true, delay = 1000) {
    if (activate) {
        if (board.demo_mode) {
            console.log("demo is already active");
            return;
        }

        if (demoId)
            return;

        //timer.stop();
        board.demo_mode = true;
        board.draw_arrows = true;
        demoId = setInterval(() => {
            const status = board.hint(false);
            switch (status) {
                case SOLVED.none:
                    console.log("unable to solve board, stopping demo");
                    clearInterval(demoId);
                    board.demo_mode = false;
                    break;
                case SOLVED.all:
                    console.log("board solved, resarting");
                    board.init();
                    break;
                case SOLVED.one:
                    window.setTimeout(() => {
                        board.removeSelectedTilePair();
                    }, delay / 2);
                    break;
            }
        }, delay);
    } else {
        board.demo_mode = false;
        board.init();

        if (!demoId)
            return;
        clearInterval(demoId);
        demoId = null;
    };
}

