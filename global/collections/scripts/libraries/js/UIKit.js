/**
 * UIKit — shared client UI building blocks: modal, confirm dialog, toast,
 * icon and the settings panel, so every screen gets the same ones instead of
 * per-system inline styles and native alert()/confirm() boxes.
 *
 * This class only builds markup and behaviour; the game styles it (the sk-*
 * and ico-* classes) in its own stylesheet. Settings are saved in
 * localStorage under game.json "settingsKey" (default guts_settings_v1).
 * The music volume goes to the running music system's class, if it has a
 * static volumeFromSettings().
 */
class UIKit {
    static get SETTINGS_KEY() {
        const configs = typeof window !== 'undefined' ? window.COMPILED_GAME?.collections?.configs : null;
        return configs?.game?.settingsKey || 'guts_settings_v1';
    }

    /** The running game (the engine's gameInstance), or null. */
    static _game() {
        return typeof window !== 'undefined' ? window.APP?.gameInstance || null : null;
    }
    static DEFAULT_SETTINGS = { uiScale: 1, damageNumbers: true, reduceMotion: false, uiSounds: true, volume: 100, musicVolume: 60 };

    /** Inline icon markup: <i class="ico ico-NAME">. Names are the .ico-* classes in loading.css. */
    static icon(name, extraClass = '') {
        return `<i class="ico ico-${name}${extraClass ? ' ' + extraClass : ''}" aria-hidden="true"></i>`;
    }

    static escape(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    /**
     * Open a modal. `body` is HTML. `actions` are buttons along the bottom:
     * { label, variant: 'primary'|'danger'|'', value, onClick }. Clicking one
     * closes the modal (unless onClick returns false) and resolves `result`
     * with its `value`. Escape and the backdrop resolve with null.
     */
    static modal({ title = '', body = '', actions = [], className = '', dismissible = true } = {}) {
        const root = document.createElement('div');
        root.className = `sk-modal ${className}`.trim();
        root.setAttribute('role', 'dialog');
        root.setAttribute('aria-modal', 'true');
        root.innerHTML = `
            <div class="sk-modal__backdrop"></div>
            <div class="sk-modal__card sk-panel">
                ${title ? `<h2 class="sk-modal__title">${UIKit.escape(title)}</h2>` : ''}
                ${dismissible ? `<button type="button" class="sk-modal__close sk-btn sk-btn--ghost sk-btn--icon" aria-label="Close">${UIKit.icon('close')}</button>` : ''}
                <div class="sk-modal__body">${body}</div>
                ${actions.length ? `<div class="sk-modal__actions"></div>` : ''}
            </div>`;

        let resolve;
        const result = new Promise(r => { resolve = r; });
        const onKey = (e) => {
            if (e.key === 'Escape' && dismissible) { e.stopPropagation(); close(null); }
        };
        const close = (value = null) => {
            if (!root.isConnected) return;
            document.removeEventListener('keydown', onKey, true);
            root.remove();
            UIKit._cue('close');
            resolve(value);
        };

        const bar = root.querySelector('.sk-modal__actions');
        for (const a of actions) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = `sk-btn ${a.variant ? 'sk-btn--' + a.variant : ''}`.trim();
            b.innerHTML = a.icon ? `${UIKit.icon(a.icon)}<span>${UIKit.escape(a.label)}</span>` : UIKit.escape(a.label);
            b.addEventListener('click', () => {
                if (a.onClick && a.onClick(root) === false) return;
                close(a.value ?? a.label);
            });
            bar.appendChild(b);
        }
        if (dismissible) {
            root.querySelector('.sk-modal__backdrop').addEventListener('click', () => close(null));
            root.querySelector('.sk-modal__close').addEventListener('click', () => close(null));
        }
        document.addEventListener('keydown', onKey, true);
        document.body.appendChild(root);
        UIKit._cue('open');
        (root.querySelector('.sk-btn--primary') || root.querySelector('.sk-modal__actions .sk-btn'))?.focus();
        return { el: root, close, result };
    }

    /** Styled replacement for window.confirm. Resolves true/false. */
    static confirm({ title = 'Are you sure?', message = '', confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false } = {}) {
        const m = UIKit.modal({
            title,
            className: 'sk-modal--confirm',
            body: message ? `<p class="sk-modal__text">${UIKit.escape(message)}</p>` : '',
            actions: [
                { label: cancelLabel, value: false },
                { label: confirmLabel, value: true, variant: danger ? 'danger' : 'primary' }
            ]
        });
        return m.result.then(v => v === true);
    }

    /** Toast via the shared NotificationSystem (falls back to console). */
    static toast(message, type = 'info', duration) {
        GUTS.GameAudioSystem?.onToast?.(type);
        if (GUTS.NotificationSystem?.show) return GUTS.NotificationSystem.show(message, type, duration);
        console.log(`[${type}] ${message}`);
    }

    // ── Settings ────────────────────────────────────────────────────────

    // Read on hot paths (every damage number), so parsed once and cached.
    static _settings = null;
    static _settingsKey = null;

    static getSettings() {
        // Cached per key: this file loads before the game's configs, which name the key.
        const key = UIKit.SETTINGS_KEY;
        if (!UIKit._settings || UIKit._settingsKey !== key) {
            let saved = {};
            try { saved = JSON.parse(localStorage.getItem(key) || '{}'); } catch { /* private mode */ }
            UIKit._settings = { ...UIKit.DEFAULT_SETTINGS, ...saved };
            UIKit._settingsKey = key;
        }
        return { ...UIKit._settings };
    }

    static saveSettings(settings) {
        UIKit._settings = { ...UIKit.DEFAULT_SETTINGS, ...settings };
        try { localStorage.setItem(UIKit.SETTINGS_KEY, JSON.stringify(UIKit._settings)); } catch { /* private mode */ }
        UIKit.applySettings(settings);
    }

    static _cue(name) {
        GUTS.GameAudioSystem?.current?.playCue(name);
    }

    // Master volume lives where AudioManager reads it at startup
    // (localStorage audioSettings, 0-100) and is pushed live to the bus.
    static applyVolume(volume) {
        try {
            const saved = JSON.parse(localStorage.getItem('audioSettings') || '{}');
            localStorage.setItem('audioSettings', JSON.stringify({ ...saved, master: volume }));
        } catch { /* private mode */ }
        const game = UIKit._game();
        if (game?.hasService?.('setMasterVolume')) game.call.setMasterVolume(volume / 100);
    }

    static applyMusicVolume() {
        const game = UIKit._game();
        const M = game?.musicSystem?.constructor;
        if (M?.volumeFromSettings) game.musicSystem.setMusicVolume(M.volumeFromSettings());
    }

    /** Push settings into the page: CSS custom property + body classes. */
    static applySettings(settings = UIKit.getSettings()) {
        const root = document.documentElement;
        root.style.setProperty('--ui-scale', String(settings.uiScale || 1));
        document.body?.classList.toggle('sk-reduce-motion', !!settings.reduceMotion);
    }

    /** The Settings dialog. Every option here is read by the game. */
    static openSettings() {
        // One Settings dialog at a time: a second open would stack an
        // identical copy that stays behind after Done.
        if (UIKit._settingsModal?.el?.isConnected) return UIKit._settingsModal;
        const s = UIKit.getSettings();
        const scales = [[0.9, 'Compact'], [1, 'Standard'], [1.15, 'Large'], [1.3, 'Largest']];
        const body = `
            <div class="sk-settings">
                <label class="sk-field">
                    <div class="sk-field__label">Volume
                        <span class="sk-field__hint">All game sound.</span></div>
                    <span class="sk-range"><input type="range" min="0" max="100" step="5" value="${s.volume}" data-setting="volume" aria-label="Volume"><output class="num">${s.volume}</output></span>
                </label>
                <label class="sk-field">
                    <div class="sk-field__label">Music
                        <span class="sk-field__hint">Background music, relative to the overall volume.</span></div>
                    <span class="sk-range"><input type="range" min="0" max="100" step="5" value="${s.musicVolume}" data-setting="musicVolume" aria-label="Music volume"><output class="num">${s.musicVolume}</output></span>
                </label>
                <label class="sk-field sk-field--toggle">
                    <div class="sk-field__label">Interface sounds
                        <span class="sk-field__hint">Clicks, hovers and purchase sounds. Battle sounds stay on.</span></div>
                    <input type="checkbox" class="sk-switch" data-setting="uiSounds" ${s.uiSounds ? 'checked' : ''}>
                </label>
                <div class="sk-field">
                    <div class="sk-field__label">Interface size
                        <span class="sk-field__hint">Scales the in-battle HUD.</span></div>
                    <div class="sk-segmented" role="radiogroup" data-setting="uiScale">
                        ${scales.map(([v, l]) => `<button type="button" role="radio" aria-checked="${s.uiScale === v}" data-value="${v}" class="${s.uiScale === v ? 'on' : ''}">${l}</button>`).join('')}
                    </div>
                </div>
                <label class="sk-field sk-field--toggle">
                    <div class="sk-field__label">Damage numbers
                        <span class="sk-field__hint">Floating numbers over units when they take damage.</span></div>
                    <input type="checkbox" class="sk-switch" data-setting="damageNumbers" ${s.damageNumbers ? 'checked' : ''}>
                </label>
                <label class="sk-field sk-field--toggle">
                    <div class="sk-field__label">Reduce motion
                        <span class="sk-field__hint">Turns off pulsing and sliding interface animation.</span></div>
                    <input type="checkbox" class="sk-switch" data-setting="reduceMotion" ${s.reduceMotion ? 'checked' : ''}>
                </label>
                <div class="sk-settings__keys">
                    <div class="sk-field__label">Controls</div>
                    <dl class="sk-keys">
                        <dt>Left drag</dt><dd>Move a squad during deployment</dd>
                        <dt>Q / E</dt><dd>Rotate the camera</dd>
                        <dt>Enter</dt><dd>Chat (online)</dd>
                        <dt>Esc</dt><dd>Cancel targeting, close dialogs</dd>
                    </dl>
                </div>
            </div>`;
        const m = UIKit._settingsModal = UIKit.modal({ title: 'Settings', body, className: 'sk-modal--settings', actions: [{ label: 'Done', variant: 'primary' }] });
        const el = m.el;
        el.querySelectorAll('.sk-segmented button').forEach(btn => btn.addEventListener('click', () => {
            const group = btn.parentElement;
            group.querySelectorAll('button').forEach(b => { b.classList.toggle('on', b === btn); b.setAttribute('aria-checked', String(b === btn)); });
            const next = UIKit.getSettings();
            next[group.dataset.setting] = parseFloat(btn.dataset.value);
            UIKit.saveSettings(next);
        }));
        el.querySelectorAll('input[type=range][data-setting]').forEach(inp => inp.addEventListener('input', () => {
            const v = parseInt(inp.value, 10);
            inp.nextElementSibling.textContent = v;
            const next = UIKit.getSettings();
            next[inp.dataset.setting] = v;
            UIKit.saveSettings(next);
            if (inp.dataset.setting === 'volume') UIKit.applyVolume(v);
            else UIKit.applyMusicVolume();
        }));
        el.querySelectorAll('input.sk-switch').forEach(inp => inp.addEventListener('change', () => {
            const next = UIKit.getSettings();
            next[inp.dataset.setting] = inp.checked;
            UIKit.saveSettings(next);
        }));
        return m;
    }
}

if (typeof document !== 'undefined') {
    // after the entry has set up COMPILED_GAME (the configs name the settings key)
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => UIKit.applySettings());
    else setTimeout(() => UIKit.applySettings());
}
