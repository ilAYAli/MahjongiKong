"use strict";

const sfx = (() => {
    let _ctx = null;
    let _enabled = localStorage.getItem('sfx') !== 'off';

    function ac() {
        if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)();
        // Resume if suspended (browser autoplay policy)
        if (_ctx.state === 'suspended') _ctx.resume();
        return _ctx;
    }

    function play(fn) {
        if (!_enabled) return;
        try { fn(ac()); } catch (e) {}
    }

    function updateBtn() {
        const btn = document.getElementById('sfxBtn');
        if (btn) btn.textContent = _enabled ? '🔊' : '🔇';
    }

    return {
        get enabled() { return _enabled; },

        toggle() {
            _enabled = !_enabled;
            localStorage.setItem('sfx', _enabled ? 'on' : 'off');
            updateBtn();
            return _enabled;
        },

        init() { updateBtn(); },

        // Soft click when selecting a tile
        select() {
            play(c => {
                const o = c.createOscillator();
                const g = c.createGain();
                o.connect(g); g.connect(c.destination);
                o.type = 'sine';
                o.frequency.value = 520;
                g.gain.setValueAtTime(0.12, c.currentTime);
                g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.07);
                o.start(); o.stop(c.currentTime + 0.07);
            });
        },

        // Dull thud for non-matching or no-path
        mismatch() {
            play(c => {
                const o = c.createOscillator();
                const g = c.createGain();
                o.connect(g); g.connect(c.destination);
                o.type = 'sine';
                o.frequency.setValueAtTime(200, c.currentTime);
                o.frequency.exponentialRampToValueAtTime(80, c.currentTime + 0.18);
                g.gain.setValueAtTime(0.18, c.currentTime);
                g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.18);
                o.start(); o.stop(c.currentTime + 0.18);
            });
        },

        // Chime on match; comboCount shifts pitch upward
        match(comboCount = 0) {
            play(c => {
                const base = 523.25 * Math.pow(1.10, Math.min(comboCount, 8));
                const ratios = [1, 1.26, 1.498];
                const delays = [0, 0.06, 0.12];
                ratios.forEach((r, i) => {
                    const o = c.createOscillator();
                    const g = c.createGain();
                    o.connect(g); g.connect(c.destination);
                    o.type = 'sine';
                    o.frequency.value = base * r;
                    const t = c.currentTime + delays[i];
                    g.gain.setValueAtTime(0, t);
                    g.gain.linearRampToValueAtTime(0.16, t + 0.02);
                    g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
                    o.start(t); o.stop(t + 0.45);
                });
            });
        },

        // Ascending 4-note fanfare on board clear
        boardClear() {
            play(c => {
                const notes  = [523.25, 659.25, 783.99, 1046.5];
                const timing = [0, 0.13, 0.26, 0.39];
                notes.forEach((freq, i) => {
                    const o = c.createOscillator();
                    const g = c.createGain();
                    o.connect(g); g.connect(c.destination);
                    o.type = 'sine';
                    o.frequency.value = freq;
                    const t = c.currentTime + timing[i];
                    g.gain.setValueAtTime(0, t);
                    g.gain.linearRampToValueAtTime(0.22, t + 0.03);
                    g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
                    o.start(t); o.stop(t + 0.55);
                });
            });
        },
    };
})();
