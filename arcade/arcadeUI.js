/**
 * arcade/arcadeUI.js
 *
 * The Kaj Arcade app shell: a lobby of game tiles, and a game screen (controls and board) with your
 * balance up top and a Back button. Games (games/*.js) are modules of the shape
 *
 *   { id, name, cat, blurb, icon, tint: [from, to], mount(stage, ctx) -> { destroy?, busy?, leave? } }
 *
 * and get a `ctx` with what every game needs: the wallet (wager / payout), sounds, a bet panel,
 * buttons, segmented pickers, playing-card elements, result banners and timers that stop when you
 * leave the game. `busy()` says a round is in progress; `leave()` settles it when you walk away
 * (cash-out games pay out, everything else forfeits the stake).
 */

import { formatMoney } from './wallet.js';
import { ArcadeSfx } from './sfx.js';
import { rand, randInt, SUITS, rankName, isRed } from './cards.js';

const CSS = `
#arcade { color-scheme: dark; position: fixed; inset: 0; z-index: 600; display: flex; flex-direction: column;
  padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
  --cz-bg: #0c0a12; --cz-panel: #161221; --cz-panel2: #1f1930; --cz-panel3: #2a2240; --cz-line: rgba(255,255,255,0.08);
  --cz-text: #f4effc; --cz-dim: #a99fc0; --cz-faint: #6d6585; --cz-gold: #f6c544; --cz-gold2: #c8901c;
  --cz-green: #2fe39a; --cz-red: #ff4f6e; --cz-blue: #4fa3ff; --cz-felt: #0e5236; --cz-felt2: #0a3a27;
  background: radial-gradient(ellipse at 50% -10%, #2b1747 0%, var(--cz-bg) 60%) fixed, var(--cz-bg);
  color: var(--cz-text); font-family: "Segoe UI", Roboto, Helvetica, Arial, sans-serif; font-size: 14px;
  user-select: none; -webkit-user-select: none; -webkit-tap-highlight-color: transparent; touch-action: manipulation; overscroll-behavior: none; }
/* Lobby */
.cz-stand { background: linear-gradient(180deg, #ffd666, #e0a526); color: #2a1a00; border-radius: 10px; padding: 8px 14px; font-weight: 800; }
.cz-stand[hidden] { display: none; }
#arcade * { box-sizing: border-box; }
#arcade button { font: inherit; color: inherit; cursor: pointer; border: none; }
#arcade button:disabled { cursor: not-allowed; opacity: 0.45; }
.cz-top { display: flex; align-items: center; gap: 12px; padding: 10px 16px; background: rgba(10,8,16,0.85);
  border-bottom: 1px solid var(--cz-line); flex: none; }
.cz-logo { font-family: Georgia, "Times New Roman", serif; font-weight: 700; font-size: 22px; letter-spacing: 3px;
  background: linear-gradient(180deg, #ffe9a3, var(--cz-gold) 45%, var(--cz-gold2)); -webkit-background-clip: text;
  background-clip: text; color: transparent; white-space: nowrap; cursor: pointer; }
.cz-logo span { font-size: 13px; letter-spacing: 6px; }
.cz-crumb { color: var(--cz-dim); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cz-spacer { flex: 1; }
.cz-balance { display: flex; align-items: center; gap: 8px; background: var(--cz-panel2); border: 1px solid var(--cz-line);
  border-radius: 999px; padding: 6px 14px 6px 8px; font-weight: 700; font-variant-numeric: tabular-nums; font-size: 16px; }
.cz-balance i { width: 22px; height: 22px; border-radius: 50%; background: radial-gradient(circle at 35% 35%, #7dffc6, #13a866);
  display: grid; place-items: center; font-style: normal; font-size: 13px; color: #04331f; font-weight: 900; }
.cz-balance.flash-up { animation: czFlashUp 0.6s; } .cz-balance.flash-down { animation: czFlashDown 0.6s; }
@keyframes czFlashUp { 30% { box-shadow: 0 0 0 3px rgba(47,227,154,0.6); } }
@keyframes czFlashDown { 30% { box-shadow: 0 0 0 3px rgba(255,79,110,0.5); } }
.cz-iconbtn { background: var(--cz-panel2); border-radius: 10px; padding: 8px 12px; font-weight: 600; }
.cz-iconbtn:hover { background: var(--cz-panel3); }
.cz-exit { background: linear-gradient(180deg, #ff6b81, #d93554); border-radius: 10px; padding: 8px 14px; font-weight: 700; }
.cz-body { flex: 1; min-height: 0; overflow: auto; -webkit-overflow-scrolling: touch; }
.cz-lobby { padding: 14px; max-width: 1000px; margin: 0 auto; }
.cz-cats { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 12px; scrollbar-width: none; }
.cz-cats::-webkit-scrollbar { display: none; }
.cz-cats button { flex: none; background: var(--cz-panel2); color: var(--cz-dim); border-radius: 999px; padding: 8px 16px; font-weight: 700; }
.cz-cats button.on { background: var(--cz-gold); color: #2a1a00; }
.cz-tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; }
.cz-tile { position: relative; aspect-ratio: 1 / 1.05; border-radius: 16px; padding: 12px; text-align: left; display: flex; flex-direction: column;
  justify-content: flex-end; overflow: hidden; background: linear-gradient(145deg, var(--a), var(--b)); box-shadow: 0 6px 18px rgba(0,0,0,0.4); }
.cz-tile:active { transform: scale(0.97); }
.cz-tile .ic { position: absolute; top: 8px; left: 12px; font-size: 44px; filter: drop-shadow(0 3px 4px rgba(0,0,0,0.4)); }
.cz-tile .nm { font-weight: 800; font-size: 16px; text-shadow: 0 1px 3px rgba(0,0,0,0.6); }
.cz-tile .bl { font-size: 11px; opacity: 0.85; line-height: 1.3; margin-top: 2px; text-shadow: 0 1px 2px rgba(0,0,0,0.6); }
.cz-tile .hot { position: absolute; top: 10px; right: 10px; background: var(--cz-red); font-size: 10px; font-weight: 900; letter-spacing: 1px; padding: 3px 7px; border-radius: 999px; }
.cz-foot { text-align: center; color: var(--cz-faint); font-size: 12px; padding: 18px 0 8px; }
/* Game */
.cz-game { display: flex; gap: 14px; padding: 14px; height: 100%; min-height: 560px; }
.cz-side { width: 290px; flex: none; background: var(--cz-panel); border-radius: 14px; padding: 14px; display: flex;
  flex-direction: column; gap: 12px; overflow: auto; }
.cz-stage { flex: 1; min-width: 0; position: relative; background: var(--cz-panel); border-radius: 14px; overflow: hidden;
  display: flex; flex-direction: column; }
.cz-label { font-size: 12px; color: var(--cz-dim); font-weight: 600; margin-bottom: 6px; display: flex; justify-content: space-between; }
.cz-field { display: flex; align-items: stretch; background: var(--cz-panel3); border-radius: 10px; overflow: hidden; border: 1px solid var(--cz-line); }
.cz-field input { flex: 1; min-width: 0; background: transparent; border: none; color: var(--cz-text); font: inherit; font-weight: 700;
  padding: 10px 10px; font-variant-numeric: tabular-nums; outline: none; }
.cz-field .pre { padding: 10px 0 10px 12px; color: var(--cz-green); font-weight: 800; }
.cz-field button { background: var(--cz-panel2); padding: 0 12px; font-weight: 700; border-left: 1px solid var(--cz-line); }
.cz-field button:hover { background: #3a3056; }
.cz-chips { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
.cz-chip { --c: #5b8cff; width: 40px; height: 40px; border-radius: 50%; font-size: 11px; font-weight: 800; color: #fff;
  background: radial-gradient(circle, var(--c) 52%, transparent 53%), repeating-conic-gradient(var(--c) 0 20deg, #fff 20deg 40deg);
  box-shadow: inset 0 0 0 3px rgba(0,0,0,0.25), 0 2px 4px rgba(0,0,0,0.4); text-shadow: 0 1px 1px rgba(0,0,0,0.6); }
.cz-chip.sel { outline: 3px solid var(--cz-gold); outline-offset: 2px; }
/* The button the phone keys are on (navKey), and an input being adjusted with left / right */
#arcade .cz-nav { outline: 3px solid #fff !important; outline-offset: 2px; box-shadow: 0 0 0 6px rgba(255,255,255,0.25) !important; }
#arcade .cz-nav.cz-adjust { outline-color: var(--cz-gold) !important; }
.cz-btn { border-radius: 10px; padding: 12px 14px; font-weight: 800; font-size: 15px; background: var(--cz-panel3); transition: filter 0.1s, transform 0.05s; }
.cz-btn:hover:not(:disabled) { filter: brightness(1.15); }
.cz-btn:active:not(:disabled) { transform: translateY(1px); }
.cz-btn.go { background: linear-gradient(180deg, #3cf2a9, #19b877); color: #062a1a; }
.cz-btn.gold { background: linear-gradient(180deg, #ffd666, #e0a526); color: #2a1a00; }
.cz-btn.red { background: linear-gradient(180deg, #ff6b81, #d93554); }
.cz-btn.blue { background: linear-gradient(180deg, #6db7ff, #2f7fe0); }
.cz-btn.big { padding: 15px; font-size: 17px; }
.cz-row { display: flex; gap: 8px; } .cz-row > * { flex: 1; }
.cz-seg { display: flex; background: var(--cz-panel3); border-radius: 10px; padding: 3px; gap: 3px; }
.cz-seg button { flex: 1; padding: 8px 4px; border-radius: 8px; background: transparent; color: var(--cz-dim); font-weight: 700; font-size: 12px; }
.cz-seg button.on { background: var(--cz-panel); color: var(--cz-text); box-shadow: 0 1px 3px rgba(0,0,0,0.4); }
.cz-info { font-size: 12px; color: var(--cz-dim); line-height: 1.5; }
.cz-info b { color: var(--cz-text); }
.cz-stat { display: flex; justify-content: space-between; background: var(--cz-panel2); border-radius: 10px; padding: 9px 12px; font-weight: 700; font-variant-numeric: tabular-nums; }
.cz-stat span:first-child { color: var(--cz-dim); font-weight: 600; }
.cz-banner { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%) scale(0.6); opacity: 0; pointer-events: none; z-index: 20;
  background: rgba(14,10,22,0.92); border: 2px solid var(--cz-green); border-radius: 16px; padding: 16px 28px; text-align: center;
  transition: transform 0.25s cubic-bezier(.2,1.6,.4,1), opacity 0.2s; box-shadow: 0 10px 40px rgba(0,0,0,0.6); min-width: 170px; }
.cz-banner.show { transform: translate(-50%, -50%) scale(1); opacity: 1; }
.cz-banner .t { font-size: 13px; font-weight: 800; letter-spacing: 2px; color: var(--cz-dim); text-transform: uppercase; }
.cz-banner .a { font-size: 30px; font-weight: 900; color: var(--cz-green); font-variant-numeric: tabular-nums; }
.cz-banner .m { font-size: 14px; font-weight: 700; color: var(--cz-text); }
.cz-banner.lose { border-color: var(--cz-red); } .cz-banner.lose .a { color: var(--cz-red); }
.cz-banner.big { border-color: var(--cz-gold); } .cz-banner.big .a { color: var(--cz-gold); font-size: 40px; }
.cz-toast { position: fixed; left: 50%; top: 70px; transform: translateX(-50%); background: #2a2240; border: 1px solid var(--cz-line);
  padding: 10px 16px; border-radius: 10px; font-weight: 700; z-index: 700; box-shadow: 0 8px 20px rgba(0,0,0,0.5); animation: czToast 2.2s forwards; }
@keyframes czToast { 0% { opacity: 0; transform: translate(-50%, -8px); } 10%, 85% { opacity: 1; transform: translate(-50%, 0); } 100% { opacity: 0; } }
.cz-modal { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: grid; place-items: center; z-index: 650; }
.cz-modal > div { background: var(--cz-panel); border-radius: 16px; padding: 20px; max-width: 360px; width: calc(100% - 32px); }
.cz-modal h3 { margin: 0 0 8px; }
.cz-modal p { color: var(--cz-dim); margin: 0 0 16px; }
.cz-felt { background: radial-gradient(ellipse at 50% 40%, #13704a, var(--cz-felt) 50%, var(--cz-felt2)); }
/* Playing cards */
.cz-card { position: relative; width: var(--cw, 74px); height: calc(var(--cw, 74px) * 1.4); border-radius: calc(var(--cw, 74px) * 0.09);
  background: #fdfcf8; color: #17151f; box-shadow: 0 3px 8px rgba(0,0,0,0.45); flex: none; font-weight: 800;
  transform-style: preserve-3d; transition: transform 0.35s; animation: czDeal 0.3s ease-out; }
.cz-card.red { color: #d3213c; }
.cz-card .c1, .cz-card .c2 { position: absolute; line-height: 0.95; text-align: center; font-size: calc(var(--cw, 74px) * 0.22); }
.cz-card .c1, .cz-card .c2, .cz-card .mid { backface-visibility: hidden; transition: visibility 0s 0.17s; }
.cz-card.down .c1, .cz-card.down .c2, .cz-card.down .mid { visibility: hidden; }
.cz-card .c1 { left: 6%; top: 5%; } .cz-card .c2 { right: 6%; bottom: 5%; transform: rotate(180deg); }
.cz-card .c1 small, .cz-card .c2 small { display: block; font-size: 0.85em; }
.cz-card .mid { position: absolute; inset: 0; display: grid; place-items: center; font-size: calc(var(--cw, 74px) * 0.48); }
.cz-card .back { position: absolute; inset: 0; border-radius: inherit; backface-visibility: hidden; transform: rotateY(180deg);
  background: repeating-linear-gradient(45deg, #b32646 0 6px, #8d1733 6px 12px); border: 4px solid #fff; }
.cz-card .back::after { content: 'K'; position: absolute; inset: 0; display: grid; place-items: center; color: rgba(255,255,255,0.85);
  font-family: Georgia, serif; font-size: calc(var(--cw, 74px) * 0.4); }
.cz-card.down { transform: rotateY(180deg); }
.cz-card.win { box-shadow: 0 0 0 3px var(--cz-gold), 0 3px 12px rgba(246,197,68,0.6); }
.cz-card.dim { filter: brightness(0.55); }
@keyframes czDeal { from { transform: translate(40px, -60px) rotate(8deg); opacity: 0; } }
.cz-card.down { animation-name: czDealDown; }
@keyframes czDealDown { from { transform: translate(40px, -60px) rotateY(180deg) rotate(8deg); opacity: 0; } }
.cz-pill { display: inline-block; background: rgba(0,0,0,0.55); border-radius: 999px; padding: 3px 10px; font-weight: 800; font-size: 13px;
  font-variant-numeric: tabular-nums; }
.cz-hist { display: flex; gap: 6px; padding: 10px 12px; overflow: hidden; flex: none; flex-wrap: nowrap; }
.cz-hist span { flex: none; padding: 4px 9px; border-radius: 8px; font-weight: 800; font-size: 12px; background: var(--cz-panel3); }
.cz-hist .g { background: rgba(47,227,154,0.18); color: var(--cz-green); } .cz-hist .r { background: rgba(255,79,110,0.18); color: var(--cz-red); }
.cz-hist .y { background: rgba(246,197,68,0.2); color: var(--cz-gold); }
@media (max-width: 760px) {
  .cz-game { flex-direction: column-reverse; height: auto; min-height: 0; padding: 10px; }
  .cz-side { width: 100%; }
  .cz-stage { min-height: min(380px, 42vh); }   /* (leaves the bet and play buttons on a short screen) */
  .cz-crumb { display: none; }
  .cz-logo { font-size: 17px; letter-spacing: 1px; } .cz-logo span { letter-spacing: 2px; font-size: 11px; }
  .cz-top { padding: 8px 10px; gap: 8px; }
}
`;

export const CHIP_COLORS = { 1: '#8a8f98', 5: '#e0473e', 10: '#3f7de8', 25: '#2e9e5b', 100: '#222', 500: '#7b3fd0', 1000: '#e0a526', 5000: '#d23d8c' };

/** <tag class=cls>text</tag> */
export function el(tag, cls = '', text = '') {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== '' && text !== null && text !== undefined) e.textContent = text;
    return e;
}

/** A playing card element (face down until .reveal() / class 'down' removed). */
export function cardEl(card, { down = false, width = null } = {}) {
    const e = el('div', 'cz-card' + (card && isRed(card) ? ' red' : '') + (down ? ' down' : ''));
    if (width) e.style.setProperty('--cw', width + 'px');
    if (card) {
        const r = rankName(card.r), s = SUITS[card.s];
        const c1 = el('div', 'c1'); c1.append(r, el('small', '', s));
        const c2 = el('div', 'c2'); c2.append(r, el('small', '', s));
        e.append(c1, el('div', 'mid', s), c2);
    }
    e.append(el('div', 'back'));
    e.card = card;
    return e;
}

export class ArcadeUI {
    /**
     * @param {Object} o
     * @param {import('../money.js').Wallet} o.wallet
     * @param {Array} o.games game modules
     * @param {Function} [o.onClose] embedded in another page (the in-game phone): starts hidden (show() / hide()),
     *   and the lobby gets a button that calls this
     * @param {string} [o.title] the logo's second word
     */
    constructor({ wallet, games, onClose = null, title = 'ARCADE' }) {
        this.wallet = wallet;
        this.games = games;
        this.onClose = onClose;
        this.sfx = new ArcadeSfx();
        this.current = null;     // { game, inst, ctx }
        this.category = 'All';

        if (!document.getElementById('arcade-style')) {
            const st = el('style');
            st.id = 'arcade-style';
            st.textContent = CSS;
            document.head.appendChild(st);
        }
        this.root = el('div');
        this.root.id = 'arcade';
        const top = el('div', 'cz-top');
        this.logo = el('div', 'cz-logo');
        this.logo.append('KAJ ', el('span', '', title));
        this.logo.onclick = () => this.requestExit();
        this.crumb = el('div', 'cz-crumb');
        this.balanceEl = el('div', 'cz-balance');
        this.balanceEl.append(el('i', '', '$'), el('span'));
        this.muteBtn = el('button', 'cz-iconbtn', '🔊');
        this.muteBtn.title = 'Sound';
        this.muteBtn.onclick = () => {
            this.sfx.muted = !this.sfx.muted;
            this.muteBtn.textContent = this.sfx.muted ? '🔇' : '🔊';
        };
        this.back = el('button', 'cz-stand', '‹ Lobby');
        this.back.hidden = true;
        this.back.onclick = () => (this.current ? this.requestExit() : this.onClose && this.onClose());
        top.append(this.back, this.logo, this.crumb, el('div', 'cz-spacer'), this.balanceEl, this.muteBtn);
        this.body = el('div', 'cz-body');
        this.root.append(top, this.body);
        document.body.appendChild(this.root);

        // Esc leaves the game, or (embedded) the app. In a page that has its own keys, nothing typed here reaches them.
        const onKey = (e) => {
            if (e.key !== 'Escape' || this.root.style.display === 'none' || document.querySelector('.cz-modal')) return;
            e.preventDefault();
            if (this.current) this.requestExit(); else if (this.onClose) this.onClose();
        };
        window.addEventListener('keydown', onKey);
        if (onClose) {
            this.root.style.display = 'none';
            this.root.addEventListener('keydown', (e) => { e.stopPropagation(); onKey(e); });
            this.root.addEventListener('keyup', (e) => e.stopPropagation());
        } else {
            // The phone's back button / swipe leaves the game instead of the app
            window.addEventListener('popstate', () => {
                if (this.current) this._confirmLeaveGame(() => this.showLobby(), () => history.pushState({ game: this.current.game.id }, ''));
            });
        }

        wallet.onChange((bal, delta) => {
            this._renderBalance();
            if (delta) {
                this.balanceEl.classList.remove('flash-up', 'flash-down');
                void this.balanceEl.offsetWidth;
                this.balanceEl.classList.add(delta > 0 ? 'flash-up' : 'flash-down');
            }
        });
        this._renderBalance();
        this.showLobby();
    }

    _renderBalance() {
        this.balanceEl.lastChild.textContent = formatMoney(this.wallet.balance, { cents: true });
    }

    /** Leaves the current game (asks first when a stake would be lost) and goes back to the lobby. */
    // ---- Phone keys (embedded: the game keeps the mouse, so the app is worked from the keyboard) ---------
    /** What the phone keys can land on: buttons, sliders / number fields and clickable tiles. */
    _navTargets(scope) {
        const out = [];
        for (const e of scope.querySelectorAll('*')) {
            const tag = e.tagName;
            const ok = (tag === 'BUTTON' && !e.disabled) || (tag === 'INPUT' && !e.disabled && (e.type === 'range' || e.type === 'number')) ||
                (tag !== 'BUTTON' && tag !== 'INPUT' && typeof e.onclick === 'function');
            if (!ok || e.hidden) continue;
            const r = e.getBoundingClientRect();
            if (r.width < 2 || r.height < 2 || getComputedStyle(e).visibility === 'hidden') continue;
            // A range input stretched invisibly over a custom track (dice) is still the thing to adjust
            out.push(e);
        }
        return out;
    }

    _setNav(e) {
        if (this._nav && this._nav !== e) this._nav.classList.remove('cz-nav', 'cz-adjust');
        this._nav = e;
        this._adjust = false;
        if (!e) return;
        e.classList.add('cz-nav');
        e.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }

    /** Arrow keys move between buttons, Enter presses (or starts adjusting a slider), Backspace goes back. */
    navKey(key) {
        const modal = this.root.querySelector('.cz-modal');
        const scope = modal || this.root;
        const targets = this._navTargets(scope);
        let cur = this._nav && scope.contains(this._nav) && targets.includes(this._nav) ? this._nav : null;
        if (!cur && this._nav) this._setNav(null);

        if (key === 'Backspace') {
            if (this._adjust) { this._adjust = false; cur.classList.remove('cz-adjust'); return; }
            if (modal) { const b = modal.querySelector('button'); if (b) b.click(); return; }
            if (this.current) this.requestExit(); else if (this.onClose) this.onClose();
            this._setNav(null);
            return;
        }
        if (!cur) {
            // Start on the first thing below the top bar (the first lobby tile, or the game's main control)
            const top = this.root.querySelector('.cz-top');
            const below = targets.filter((e) => !top || !top.contains(e));
            const go = below.find((e) => e.classList.contains('go')) || below.find((e) => e.classList.contains('cz-tile'));
            this._setNav(modal ? targets[targets.length - 1] : go || below[0] || targets[0] || null);
            return;   // the first key only shows where you are
        }
        if (this._adjust && (key === 'ArrowLeft' || key === 'ArrowRight')) {
            const dir = key === 'ArrowRight' ? 1 : -1;
            if (cur.type === 'range') {
                const min = Number(cur.min) || 0, max = Number(cur.max) || 100;
                const step = Math.max(Number(cur.step) || 1, (max - min) / 40);
                cur.value = String(Math.max(min, Math.min(max, Number(cur.value) + dir * step)));
            } else {
                const v = Number(cur.value) || 1;
                cur.value = String(Math.round((dir > 0 ? v * 1.25 : v / 1.25) * 100) / 100);
            }
            cur.dispatchEvent(new Event('input', { bubbles: true }));
            cur.dispatchEvent(new Event('change', { bubbles: true }));
            return;
        }
        if (key === 'Enter') {
            if (cur.tagName === 'INPUT') {
                this._adjust = !this._adjust;
                cur.classList.toggle('cz-adjust', this._adjust);
                return;
            }
            this.sfx.play('click');
            cur.click();
            return;
        }
        const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[key];
        if (!d) return;
        if (this._adjust) { this._adjust = false; cur.classList.remove('cz-adjust'); }
        // Nearest target in that direction; sideways distance counts double
        const a = cur.getBoundingClientRect();
        const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
        let best = null, bestScore = Infinity;
        for (const e of targets) {
            if (e === cur) continue;
            const r = e.getBoundingClientRect();
            const dx = r.left + r.width / 2 - ax, dy = r.top + r.height / 2 - ay;
            const along = dx * d[0] + dy * d[1];
            if (along <= 2) continue;
            const side = Math.abs(d[0] ? dy : dx);
            const score = along + side * 2;
            if (score < bestScore) { bestScore = score; best = e; }
        }
        if (best) this._setNav(best);
    }

    /** Embedded: opens at the lobby. */
    show() {
        this.root.style.display = 'flex';
        this.showLobby();
    }

    /** Embedded: closes (a round in progress is settled first). */
    hide() {
        if (this.current && this.current.inst.busy && this.current.inst.busy() && this.current.inst.leave) this.current.inst.leave();
        this._closeGame();
        this.root.style.display = 'none';
    }

    requestExit() {
        if (!this.current) return;
        if (!this.onClose && history.state && history.state.game) history.back(); // popstate does the leaving
        else this._confirmLeaveGame(() => this.showLobby());
    }

    // ---- The lobby -----------------------------------------------------------------------------------
    showLobby() {
        this._closeGame();
        this.crumb.textContent = '';
        this.back.hidden = !this.onClose;
        this.back.textContent = '✕ Phone';
        this.logo.style.display = '';
        this.body.textContent = '';
        const lobby = el('div', 'cz-lobby');
        const cats = ['All', ...new Set(this.games.map((g) => g.cat))];
        const catRow = el('div', 'cz-cats');
        const tiles = el('div', 'cz-tiles');
        const draw = () => {
            for (const b of catRow.children) b.classList.toggle('on', b.textContent === this.category);
            tiles.textContent = '';
            for (const g of this.games) {
                if (this.category !== 'All' && g.cat !== this.category) continue;
                const t = el('button', 'cz-tile');
                t.style.setProperty('--a', g.tint[0]);
                t.style.setProperty('--b', g.tint[1]);
                t.append(el('div', 'ic', g.icon), el('div', 'nm', g.name), el('div', 'bl', g.blurb));
                if (g.hot) t.append(el('div', 'hot', 'HOT'));
                t.onclick = () => { this.sfx.play('click'); this.openGame(g.id); };
                tiles.append(t);
            }
        };
        for (const c of cats) {
            const b = el('button', '', c);
            b.onclick = () => { this.category = c; draw(); };
            catRow.append(b);
        }
        draw();
        lobby.append(catRow, tiles, el('div', 'cz-foot', 'Play money only: no real cash, no real prizes.'));
        this.body.append(lobby);
    }

    toast(text) {
        const t = el('div', 'cz-toast', text);
        document.body.appendChild(t);
        setTimeout(() => t.remove(), 2300);
    }

    confirm(title, text, yes, no = 'Cancel') {
        return new Promise((resolve) => {
            const m = el('div', 'cz-modal');
            const box = el('div');
            const row = el('div', 'cz-row');
            const a = el('button', 'cz-btn', no);
            const b = el('button', 'cz-btn red', yes);
            a.onclick = () => { m.remove(); resolve(false); };
            b.onclick = () => { m.remove(); resolve(true); };
            row.append(a, b);
            box.append(el('h3', '', title), el('p', '', text), row);
            m.append(box);
            this.root.append(m);
        });
    }

    /** A round in progress: settle it (or ask first when the stake would be lost). */
    _confirmLeaveGame(then, cancel = () => {}) {
        const cur = this.current;
        if (!cur || !cur.inst.busy || !cur.inst.busy()) return then();
        if (cur.inst.leave) {
            cur.inst.leave();
            return then();
        }
        this.confirm('Leave mid-round?', 'Your bet on the current round will be lost.', 'Leave').then((ok) => (ok ? then() : cancel()));
    }

    _closeGame() {
        const cur = this.current;
        if (!cur) return;
        this.current = null;
        cur.ctx._kill();
        try { if (cur.inst.destroy) cur.inst.destroy(); } catch (e) { console.error(e); }
    }

    // ---- A game --------------------------------------------------------------------------------------
    openGame(id) {
        const game = this.games.find((g) => g.id === id);
        if (!game) return;
        this._closeGame();
        this.crumb.textContent = game.name;
        this.back.hidden = false;
        this.back.textContent = '‹ Lobby';
        this.logo.style.display = 'none';
        if (!this.onClose && !(history.state && history.state.game)) history.pushState({ game: id }, '');
        this.body.textContent = '';
        const wrap = el('div', 'cz-game');
        const side = el('div', 'cz-side');
        const stage = el('div', 'cz-stage');
        wrap.append(side, stage);
        this.body.append(wrap);
        const ctx = this._makeCtx(game, side, stage);
        let inst = {};
        try {
            inst = game.mount(stage, ctx) || {};
        } catch (e) {
            console.error(e);
            this.toast('That table is closed right now');
        }
        this.current = { game, inst, ctx };
    }

    _makeCtx(game, side, stage) {
        const ui = this;
        const wallet = this.wallet;
        const timers = new Set();
        const frames = new Set();
        let alive = true;
        const ctx = {
            game, side, stage, wallet, sfx: this.sfx, rand, randInt, el, cardEl,
            get alive() { return alive; },
            toast: (t) => ui.toast(t),
            /** Hook for anything that wants to watch game events (nothing does yet). */
            emit: (event, data) => { if (ui.onEvent) ui.onEvent(game.id, event, data); },
            confirm: (...a) => ui.confirm(...a),
            money: (n, o) => formatMoney(n, o),
            _kill() {
                alive = false;
                for (const t of timers) clearTimeout(t);
                for (const f of frames) cancelAnimationFrame(f);
                timers.clear();
                frames.clear();
            },
            /** Resolves after ms (never, if the game was closed meanwhile). */
            wait(ms) {
                return new Promise((res) => {
                    const t = setTimeout(() => { timers.delete(t); if (alive) res(); }, ms);
                    timers.add(t);
                });
            },
            /** Calls fn(dt seconds, t seconds) every frame until it returns false or the game closes. */
            loop(fn) {
                let last = performance.now();
                const t0 = last;
                const step = (now) => {
                    frames.delete(id);
                    if (!alive) return;
                    const dt = Math.min(0.1, (now - last) / 1000);
                    last = now;
                    if (fn(dt, (now - t0) / 1000) === false) return;
                    id = requestAnimationFrame(step);
                    frames.add(id);
                };
                let id = requestAnimationFrame(step);
                frames.add(id);
                return () => { cancelAnimationFrame(id); frames.delete(id); };
            },
            /** Takes the stake; false (with a message) if it can't be placed. */
            wager(amount, min = 0.01) {
                amount = Math.round(amount * 100) / 100;
                if (!(amount >= min)) { ui.toast(`Minimum bet is ${formatMoney(min)}`); return false; }
                if (!wallet.spend(amount, game.id)) {
                    ui.toast(`Not enough money (you have ${formatMoney(wallet.balance, { cents: true })})`);
                    ui.sfx.play('lose');
                    return false;
                }
                ui.sfx.play('chip');
                return true;
            },
            /** Pays out `amount` (the whole return, stake included) and records the round. */
            payout(amount, stake = 0) {
                amount = Math.round(amount * 100) / 100;
                if (amount > 0) wallet.add(amount, game.id);
                wallet.recordWin(amount - stake);
                return amount;
            },
            /** Big result banner over the stage. */
            banner(title, amount, { mult = null, lose = false, big = false, ms = 1700 } = {}) {
                const b = el('div', 'cz-banner' + (lose ? ' lose' : '') + (big ? ' big' : ''));
                b.append(el('div', 't', title));
                if (amount !== null && amount !== undefined) b.append(el('div', 'a', typeof amount === 'string' ? amount : formatMoney(amount, { cents: 'auto' })));
                if (mult) b.append(el('div', 'm', mult));
                stage.append(b);
                requestAnimationFrame(() => b.classList.add('show'));
                setTimeout(() => { b.classList.remove('show'); setTimeout(() => b.remove(), 300); }, ms);
                if (!lose) ui.sfx.play(big ? 'bigwin' : 'win');
            },
            label(text, right = '') {
                const l = el('div', 'cz-label');
                l.append(el('span', '', text));
                const r = el('span', '', right);
                l.append(r);
                l.right = r;
                return l;
            },
            button(text, cls, onClick) {
                const b = el('button', 'cz-btn ' + (cls || ''), text);
                b.onclick = (e) => { ui.sfx.play('click'); onClick(e); };
                return b;
            },
            /** Picker of { value: label } options. */
            segmented(options, value, onChange) {
                const s = el('div', 'cz-seg');
                const set = (v) => {
                    s.value = v;
                    for (const b of s.children) b.classList.toggle('on', b.dataset.v === String(v));
                };
                for (const [v, label] of Object.entries(options)) {
                    const b = el('button', '', label);
                    b.dataset.v = v;
                    b.onclick = () => {
                        if (s.disabled) return;
                        ui.sfx.play('click');
                        set(isNaN(Number(v)) ? v : Number(v));
                        onChange(s.value);
                    };
                    s.append(b);
                }
                set(value);
                s.set = set;
                s.lock = (on) => { s.disabled = on; s.style.opacity = on ? 0.5 : 1; };
                return s;
            },
            stat(label, value = '') {
                const d = el('div', 'cz-stat');
                const v = el('span', '', value);
                d.append(el('span', '', label), v);
                d.set = (t) => { v.textContent = t; };
                return d;
            },
            /** Bet amount field with ½ / 2× and chips; .value, .set(v), .lock(on). */
            betPanel({ label = 'Bet amount', initial = 10, min = 0.1, chips = [1, 5, 25, 100, 500] } = {}) {
                const box = el('div');
                const lab = ctx.label(label, '');
                const field = el('div', 'cz-field');
                const input = el('input');
                input.type = 'number';
                input.min = String(min);
                input.step = '0.01';
                input.inputMode = 'decimal';
                const half = el('button', '', '½');
                const dbl = el('button', '', '2×');
                const max = el('button', '', 'Max');
                field.append(el('span', 'pre', '$'), input, half, dbl, max);
                const chipRow = el('div', 'cz-chips');
                const clamp = (v) => {
                    v = Math.round((Number(v) || 0) * 100) / 100;
                    return Math.max(min, Math.min(v, Math.max(min, Math.floor(wallet.balance * 100) / 100)));
                };
                const set = (v) => {
                    box.value = clamp(v);
                    input.value = String(box.value);
                };
                input.onchange = () => set(input.value);
                half.onclick = () => { ui.sfx.play('click'); set(box.value / 2); };
                dbl.onclick = () => { ui.sfx.play('click'); set(box.value * 2); };
                max.onclick = () => { ui.sfx.play('click'); set(wallet.balance); };
                for (const c of chips) {
                    const b = el('button', 'cz-chip', c >= 1000 ? c / 1000 + 'K' : String(c));
                    b.style.setProperty('--c', CHIP_COLORS[c] || '#555');
                    b.onclick = () => { ui.sfx.play('chip'); set(c); };
                    chipRow.append(b);
                }
                box.append(lab, field, chipRow);
                set(initial);
                box.set = set;
                box.lock = (on) => {
                    for (const e of [input, half, dbl, max, ...chipRow.children]) e.disabled = on;
                };
                return box;
            },
            /** Row of past results. */
            history(max = 14) {
                const h = el('div', 'cz-hist');
                h.push = (text, cls = '') => {
                    h.prepend(el('span', cls, text));
                    while (h.children.length > max) h.lastChild.remove();
                };
                return h;
            }
        };
        return ctx;
    }
}
