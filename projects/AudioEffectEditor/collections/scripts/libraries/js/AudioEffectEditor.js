/**
 * AudioEffectEditor - Layered Sound Effect Creation Tool
 * Creates complex layered sound effects with a visual timeline UI
 * Uses AudioManager for all sound synthesis (not duplicating audio code)
 */
class AudioEffectEditor {
    constructor(game) {
        this.game = game;
        this.container = null;

        // Effect data - uses same format as game JSON files
        this.effectData = this.getDefaultEffect();

        // UI state
        this.selectedLayerIndex = -1;
        this.isPlaying = false;

        // Audio - uses AudioManager for all playback
        this.audioManager = null;

        // Layer counter for unique IDs
        this._layerIdCounter = 0;

        // Loop playback state
        this._isLooping = false;
        this._continuousSources = [];
        this._eventIntervals = [];

        // Sound library - loaded from collections
        this.soundLibrary = {};
    }

    async init() {
        this.container = document.getElementById('appContainer') || document.body;

        // Load sound library from collections
        await this.loadSoundLibrary();

        // Populate the library dropdown
        this.populateSoundLibraryDropdown();

        // Setup event listeners
        this.setupEventListeners();

        // Initialize audio on first interaction
        this.initAudioOnInteraction();

        // Load initial data into UI
        this.loadDataIntoUI(this.effectData.audio);

        console.log('[AudioEffectEditor] Initialized');
    }

    async loadSoundLibrary() {
        const collections = ['sounds', 'hitSounds', 'attackSounds', 'uiSounds', 'ambientSounds'];

        for (const collection of collections) {
            this.soundLibrary[collection] = {};

            if (window.GUTS && window.GUTS.data && window.GUTS.data[collection]) {
                const sounds = window.GUTS.data[collection];
                for (const [id, sound] of Object.entries(sounds)) {
                    this.soundLibrary[collection][id] = sound;
                }
            }
        }

        console.log('[AudioEffectEditor] Sound library loaded:', this.soundLibrary);
    }

    populateSoundLibraryDropdown() {
        const select = document.getElementById('library-sound-select');
        if (!select) return;

        const collectionLabels = {
            sounds: 'Sounds',
            hitSounds: 'Hit Sounds',
            attackSounds: 'Attack Sounds',
            uiSounds: 'UI Sounds',
            ambientSounds: 'Ambient Sounds'
        };

        let html = '<option value="">-- Load from library --</option>';
        for (const [collection, sounds] of Object.entries(this.soundLibrary)) {
            const entries = Object.entries(sounds);
            if (entries.length === 0) continue;

            html += `<optgroup label="${collectionLabels[collection] || collection}">`;
            for (const [id, sound] of entries) {
                const title = sound.title || id;
                html += `<option value="${collection}:${id}">${title}</option>`;
            }
            html += '</optgroup>';
        }

        select.innerHTML = html;
    }

    getDefaultEffect() {
        return {
            title: 'New Sound Effect',
            audio: {
                duration: 0.5,
                volume: 0.7,
                layers: [
                    {
                        source: 'sine',
                        frequency: 440,
                        volume: 1.0,
                        envelope: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.2 }
                    }
                ]
            }
        };
    }

    initAudioOnInteraction() {
        this.audioManager = new GUTS.AudioManager();
        this.audioManager.init();

        const initHandler = () => {
            if (this.audioManager.isInitialized) {
                console.log('[AudioEffectEditor] Audio initialized via AudioManager');
            }
        };

        document.addEventListener('click', initHandler, { once: true });
        document.addEventListener('keydown', initHandler, { once: true });
    }

    setupEventListeners() {
        // Effect info
        document.getElementById('effect-title')?.addEventListener('change', (e) => {
            this.effectData.title = e.target.value;
        });

        // Master settings
        this.setupMasterListeners();

        // Add layer/event buttons
        document.getElementById('add-layer-btn')?.addEventListener('click', () => this.addLayer());
        document.getElementById('add-event-btn')?.addEventListener('click', () => this.addEvent());

        // Load from library
        document.getElementById('load-library-btn')?.addEventListener('click', () => this.loadFromLibrary());

        // Playback
        document.getElementById('play-btn')?.addEventListener('click', () => this.playEffect());
        document.getElementById('stop-btn')?.addEventListener('click', () => this.stopPlayback());

        // Loop toggle
        document.getElementById('loop-toggle')?.addEventListener('change', (e) => {
            this._isLooping = e.target.checked;
            if (!this._isLooping) {
                this.stopPlayback();
            }
        });

        // Randomize
        document.getElementById('randomize-btn')?.addEventListener('click', () => {
            this.randomizeSound();
            this.playEffect();
        });

        // Export/Import
        document.getElementById('export-json')?.addEventListener('click', () => this.exportEffect());
        document.getElementById('import-json')?.addEventListener('click', () => document.getElementById('import-input').click());
        document.getElementById('import-input')?.addEventListener('change', (e) => this.importEffect(e.target.files[0]));
    }

    setupMasterListeners() {
        const masterInputs = [
            { id: 'master-duration', display: 'duration-display', format: v => `${v.toFixed(2)} s` },
            { id: 'master-volume', display: 'volume-display', format: v => `${Math.round(v * 100)}%` },
            { id: 'master-filter-freq', display: 'master-filter-freq-display', format: v => `${Math.round(v)} Hz` },
            { id: 'master-filter-q', display: 'master-filter-q-display', format: v => v.toFixed(1) },
            { id: 'master-distortion', display: 'master-distortion-display', format: v => `${Math.round(v)}%` },
            { id: 'master-delay-time', display: 'master-delay-time-display', format: v => `${v.toFixed(2)} s` },
            { id: 'master-delay-feedback', display: 'master-delay-feedback-display', format: v => `${Math.round(v * 100)}%` },
            { id: 'master-reverb', display: 'master-reverb-display', format: v => `${Math.round(v * 100)}%` },
            { id: 'master-pan', display: 'master-pan-display', format: v => v === 0 ? 'Center' : (v < 0 ? `L ${Math.round(Math.abs(v) * 100)}%` : `R ${Math.round(v * 100)}%`) }
        ];

        masterInputs.forEach(({ id, display, format }) => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('input', () => {
                    const displayEl = document.getElementById(display);
                    if (displayEl) {
                        displayEl.textContent = format(parseFloat(el.value));
                    }
                });
            }
        });
    }

    loadDataIntoUI(data) {
        // Title
        const titleEl = document.getElementById('effect-title');
        if (titleEl) titleEl.value = this.effectData.title || 'New Sound Effect';

        // Master settings
        this.setMasterValue('master-duration', data.duration || 0.5, 'duration-display', v => `${v.toFixed(2)} s`);
        this.setMasterValue('master-volume', data.volume !== undefined ? data.volume : 0.7, 'volume-display', v => `${Math.round(v * 100)}%`);

        // Master effects
        const effects = data.effects || {};
        const filter = effects.filter || {};

        const filterType = document.getElementById('master-filter-type');
        if (filterType) filterType.value = filter.type || 'none';

        this.setMasterValue('master-filter-freq', filter.frequency || 20000, 'master-filter-freq-display', v => `${Math.round(v)} Hz`);
        this.setMasterValue('master-filter-q', filter.Q || 1, 'master-filter-q-display', v => v.toFixed(1));
        this.setMasterValue('master-distortion', effects.distortion || 0, 'master-distortion-display', v => `${Math.round(v)}%`);

        const delay = effects.delay || {};
        this.setMasterValue('master-delay-time', delay.time || 0, 'master-delay-time-display', v => `${v.toFixed(2)} s`);
        this.setMasterValue('master-delay-feedback', delay.feedback || 0, 'master-delay-feedback-display', v => `${Math.round(v * 100)}%`);

        this.setMasterValue('master-reverb', effects.reverb || 0, 'master-reverb-display', v => `${Math.round(v * 100)}%`);
        this.setMasterValue('master-pan', effects.pan || 0, 'master-pan-display', v => v === 0 ? 'Center' : (v < 0 ? `L ${Math.round(Math.abs(v) * 100)}%` : `R ${Math.round(v * 100)}%`));

        // Clear existing layers
        const layersContainer = document.getElementById('layers-container');
        if (layersContainer) layersContainer.innerHTML = '';

        // Add layers
        (data.layers || []).forEach(layer => this.addLayerUI(layer));

        // Clear existing events
        const eventsContainer = document.getElementById('events-container');
        if (eventsContainer) eventsContainer.innerHTML = '';

        // Add events
        (data.events || []).forEach(event => this.addEventUI(event));
    }

    setMasterValue(inputId, value, displayId, format) {
        const input = document.getElementById(inputId);
        const display = document.getElementById(displayId);
        if (input) input.value = value;
        if (display && format) display.textContent = format(value);
    }

    addLayer(layerData = null) {
        const defaultLayer = {
            source: 'sine',
            frequency: 440,
            volume: 1.0,
            envelope: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.2 }
        };
        this.addLayerUI(layerData || defaultLayer);
    }

    addLayerUI(layerData) {
        const container = document.getElementById('layers-container');
        if (!container) return;

        const layerId = `layer-${this._layerIdCounter++}`;
        const isNoise = ['white', 'pink', 'brown'].includes(layerData.source);

        const layerEl = document.createElement('div');
        layerEl.className = 'aee-layer';
        layerEl.dataset.layerId = layerId;

        layerEl.innerHTML = `
            <div class="aee-layer-header">
                <span class="aee-layer-title">Layer</span>
                <button class="aee-btn aee-btn-danger aee-btn-small aee-layer-delete">Delete</button>
            </div>
            <div class="aee-layer-content">
                <div class="aee-form-row">
                    <label>Source:</label>
                    <select class="layer-source">
                        <option value="sine" ${layerData.source === 'sine' ? 'selected' : ''}>Sine</option>
                        <option value="square" ${layerData.source === 'square' ? 'selected' : ''}>Square</option>
                        <option value="sawtooth" ${layerData.source === 'sawtooth' ? 'selected' : ''}>Sawtooth</option>
                        <option value="triangle" ${layerData.source === 'triangle' ? 'selected' : ''}>Triangle</option>
                        <option value="white" ${layerData.source === 'white' ? 'selected' : ''}>White Noise</option>
                        <option value="pink" ${layerData.source === 'pink' ? 'selected' : ''}>Pink Noise</option>
                        <option value="brown" ${layerData.source === 'brown' ? 'selected' : ''}>Brown Noise</option>
                    </select>
                </div>
                <div class="aee-form-row layer-freq-row" ${isNoise ? 'style="display:none"' : ''}>
                    <label>Frequency: <span class="layer-freq-display">${layerData.frequency || 440} Hz</span></label>
                    <input type="range" class="layer-frequency" min="20" max="2000" value="${layerData.frequency || 440}" step="1">
                </div>
                <div class="aee-form-row">
                    <label>Volume: <span class="layer-volume-display">${Math.round((layerData.volume || 1) * 100)}%</span></label>
                    <input type="range" class="layer-volume" min="0" max="1" value="${layerData.volume || 1}" step="0.01">
                </div>

                <div class="aee-layer-section">
                    <div class="aee-layer-section-title">Envelope</div>
                    <div class="aee-form-row">
                        <label>Attack: <span class="layer-attack-display">${((layerData.envelope?.attack || 0.01) * 1000).toFixed(0)} ms</span></label>
                        <input type="range" class="layer-attack" min="0.001" max="2" value="${layerData.envelope?.attack || 0.01}" step="0.001">
                    </div>
                    <div class="aee-form-row">
                        <label>Decay: <span class="layer-decay-display">${((layerData.envelope?.decay || 0.1) * 1000).toFixed(0)} ms</span></label>
                        <input type="range" class="layer-decay" min="0" max="2" value="${layerData.envelope?.decay || 0.1}" step="0.001">
                    </div>
                    <div class="aee-form-row">
                        <label>Sustain: <span class="layer-sustain-display">${Math.round((layerData.envelope?.sustain !== undefined ? layerData.envelope.sustain : 0.5) * 100)}%</span></label>
                        <input type="range" class="layer-sustain" min="0" max="1" value="${layerData.envelope?.sustain !== undefined ? layerData.envelope.sustain : 0.5}" step="0.01">
                    </div>
                    <div class="aee-form-row">
                        <label>Release: <span class="layer-release-display">${((layerData.envelope?.release || 0.2) * 1000).toFixed(0)} ms</span></label>
                        <input type="range" class="layer-release" min="0.001" max="5" value="${layerData.envelope?.release || 0.2}" step="0.001">
                    </div>
                </div>

                <div class="aee-layer-section layer-pitch-section" ${isNoise ? 'style="display:none"' : ''}>
                    <div class="aee-layer-section-title">Pitch Envelope</div>
                    <div class="aee-form-row">
                        <label>Start: <span class="layer-pitch-start-display">${(layerData.pitchEnvelope?.start || 1).toFixed(2)}x</span></label>
                        <input type="range" class="layer-pitch-start" min="0.1" max="4" value="${layerData.pitchEnvelope?.start || 1}" step="0.01">
                    </div>
                    <div class="aee-form-row">
                        <label>End: <span class="layer-pitch-end-display">${(layerData.pitchEnvelope?.end || 1).toFixed(2)}x</span></label>
                        <input type="range" class="layer-pitch-end" min="0.1" max="4" value="${layerData.pitchEnvelope?.end || 1}" step="0.01">
                    </div>
                </div>

                <div class="aee-layer-section">
                    <div class="aee-layer-section-title">Layer Filter</div>
                    <div class="aee-form-row">
                        <label>Type:</label>
                        <select class="layer-filter-type">
                            <option value="none" ${!layerData.filter ? 'selected' : ''}>None</option>
                            <option value="lowpass" ${layerData.filter?.type === 'lowpass' ? 'selected' : ''}>Low Pass</option>
                            <option value="highpass" ${layerData.filter?.type === 'highpass' ? 'selected' : ''}>High Pass</option>
                            <option value="bandpass" ${layerData.filter?.type === 'bandpass' ? 'selected' : ''}>Band Pass</option>
                            <option value="notch" ${layerData.filter?.type === 'notch' ? 'selected' : ''}>Notch</option>
                        </select>
                    </div>
                    <div class="aee-form-row">
                        <label>Freq: <span class="layer-filter-freq-display">${layerData.filter?.frequency || 1000} Hz</span></label>
                        <input type="range" class="layer-filter-freq" min="20" max="20000" value="${layerData.filter?.frequency || 1000}" step="1">
                    </div>
                    <div class="aee-form-row">
                        <label>Q: <span class="layer-filter-q-display">${(layerData.filter?.Q || 1).toFixed(1)}</span></label>
                        <input type="range" class="layer-filter-q" min="0.1" max="20" value="${layerData.filter?.Q || 1}" step="0.1">
                    </div>
                </div>
            </div>
        `;

        container.appendChild(layerEl);
        this.setupLayerListeners(layerEl);
    }

    setupLayerListeners(layerEl) {
        // Delete button
        layerEl.querySelector('.aee-layer-delete')?.addEventListener('click', () => {
            layerEl.remove();
        });

        // Source change (show/hide frequency and pitch envelope)
        const sourceSelect = layerEl.querySelector('.layer-source');
        sourceSelect?.addEventListener('change', () => {
            const isNoise = ['white', 'pink', 'brown'].includes(sourceSelect.value);
            const freqRow = layerEl.querySelector('.layer-freq-row');
            const pitchSection = layerEl.querySelector('.layer-pitch-section');
            if (freqRow) freqRow.style.display = isNoise ? 'none' : '';
            if (pitchSection) pitchSection.style.display = isNoise ? 'none' : '';
        });

        // Slider displays
        const sliderConfigs = [
            { slider: '.layer-frequency', display: '.layer-freq-display', format: v => `${Math.round(v)} Hz` },
            { slider: '.layer-volume', display: '.layer-volume-display', format: v => `${Math.round(v * 100)}%` },
            { slider: '.layer-attack', display: '.layer-attack-display', format: v => `${(v * 1000).toFixed(0)} ms` },
            { slider: '.layer-decay', display: '.layer-decay-display', format: v => `${(v * 1000).toFixed(0)} ms` },
            { slider: '.layer-sustain', display: '.layer-sustain-display', format: v => `${Math.round(v * 100)}%` },
            { slider: '.layer-release', display: '.layer-release-display', format: v => `${(v * 1000).toFixed(0)} ms` },
            { slider: '.layer-pitch-start', display: '.layer-pitch-start-display', format: v => `${v.toFixed(2)}x` },
            { slider: '.layer-pitch-end', display: '.layer-pitch-end-display', format: v => `${v.toFixed(2)}x` },
            { slider: '.layer-filter-freq', display: '.layer-filter-freq-display', format: v => `${Math.round(v)} Hz` },
            { slider: '.layer-filter-q', display: '.layer-filter-q-display', format: v => v.toFixed(1) }
        ];

        sliderConfigs.forEach(({ slider, display, format }) => {
            const sliderEl = layerEl.querySelector(slider);
            const displayEl = layerEl.querySelector(display);
            if (sliderEl && displayEl) {
                sliderEl.addEventListener('input', () => {
                    displayEl.textContent = format(parseFloat(sliderEl.value));
                });
            }
        });
    }

    addEvent(eventData = null) {
        const defaultEvent = {
            minInterval: 50,
            maxInterval: 200,
            chance: 0.7,
            sound: {
                duration: 0.05,
                volume: 0.5,
                layers: [
                    {
                        source: 'white',
                        volume: 1.0,
                        envelope: { attack: 0.001, decay: 0.02, sustain: 0, release: 0.02 },
                        filter: { type: 'bandpass', frequency: 1500, Q: 1 }
                    }
                ]
            }
        };
        this.addEventUI(eventData || defaultEvent);
    }

    addEventUI(eventData) {
        const container = document.getElementById('events-container');
        if (!container) return;

        const eventId = `event-${this._layerIdCounter++}`;
        const sound = eventData.sound || {};
        const soundLayer = sound.layers?.[0] || {};
        const randomize = sound.randomize || {};

        const eventEl = document.createElement('div');
        eventEl.className = 'aee-event';
        eventEl.dataset.eventId = eventId;

        eventEl.innerHTML = `
            <div class="aee-layer-header">
                <span class="aee-layer-title">Event (Random Sound)</span>
                <button class="aee-btn aee-btn-danger aee-btn-small aee-event-delete">Delete</button>
            </div>
            <div class="aee-event-content">
                <div class="aee-layer-section">
                    <div class="aee-layer-section-title">Timing</div>
                    <div class="aee-form-row">
                        <label>Min Interval: <span class="event-min-interval-display">${eventData.minInterval || 50} ms</span></label>
                        <input type="range" class="event-min-interval" min="10" max="1000" value="${eventData.minInterval || 50}" step="10">
                    </div>
                    <div class="aee-form-row">
                        <label>Max Interval: <span class="event-max-interval-display">${eventData.maxInterval || 200} ms</span></label>
                        <input type="range" class="event-max-interval" min="10" max="2000" value="${eventData.maxInterval || 200}" step="10">
                    </div>
                    <div class="aee-form-row">
                        <label>Chance: <span class="event-chance-display">${Math.round((eventData.chance || 0.7) * 100)}%</span></label>
                        <input type="range" class="event-chance" min="0" max="1" value="${eventData.chance || 0.7}" step="0.05">
                    </div>
                </div>
                <div class="aee-layer-section">
                    <div class="aee-layer-section-title">Sound</div>
                    <div class="aee-form-row">
                        <label>Duration: <span class="event-duration-display">${((sound.duration || 0.05) * 1000).toFixed(0)} ms</span></label>
                        <input type="range" class="event-duration" min="0.01" max="0.5" value="${sound.duration || 0.05}" step="0.01">
                    </div>
                    <div class="aee-form-row">
                        <label>Volume: <span class="event-volume-display">${Math.round((sound.volume || 0.5) * 100)}%</span></label>
                        <input type="range" class="event-volume" min="0" max="1" value="${sound.volume || 0.5}" step="0.05">
                    </div>
                    <div class="aee-form-row">
                        <label>Source:</label>
                        <select class="event-source">
                            <option value="white" ${soundLayer.source === 'white' ? 'selected' : ''}>White Noise</option>
                            <option value="pink" ${soundLayer.source === 'pink' ? 'selected' : ''}>Pink Noise</option>
                            <option value="brown" ${soundLayer.source === 'brown' ? 'selected' : ''}>Brown Noise</option>
                        </select>
                    </div>
                    <div class="aee-form-row">
                        <label>Filter:</label>
                        <select class="event-filter-type">
                            <option value="none" ${!soundLayer.filter ? 'selected' : ''}>None</option>
                            <option value="lowpass" ${soundLayer.filter?.type === 'lowpass' ? 'selected' : ''}>Low Pass</option>
                            <option value="highpass" ${soundLayer.filter?.type === 'highpass' ? 'selected' : ''}>High Pass</option>
                            <option value="bandpass" ${soundLayer.filter?.type === 'bandpass' ? 'selected' : ''}>Band Pass</option>
                        </select>
                    </div>
                    <div class="aee-form-row">
                        <label>Filter Freq: <span class="event-filter-freq-display">${soundLayer.filter?.frequency || 1500} Hz</span></label>
                        <input type="range" class="event-filter-freq" min="100" max="10000" value="${soundLayer.filter?.frequency || 1500}" step="50">
                    </div>
                </div>
                <div class="aee-layer-section">
                    <div class="aee-layer-section-title">Randomization</div>
                    <div class="aee-form-row">
                        <label>Volume Min: <span class="event-rand-vol-min-display">${Math.round((randomize.volume?.min || 0.3) * 100)}%</span></label>
                        <input type="range" class="event-rand-vol-min" min="0" max="1" value="${randomize.volume?.min || 0.3}" step="0.05">
                    </div>
                    <div class="aee-form-row">
                        <label>Volume Max: <span class="event-rand-vol-max-display">${Math.round((randomize.volume?.max || 1) * 100)}%</span></label>
                        <input type="range" class="event-rand-vol-max" min="0" max="1" value="${randomize.volume?.max || 1}" step="0.05">
                    </div>
                    <div class="aee-form-row">
                        <label>Filter Min: <span class="event-rand-freq-min-display">${randomize.filterFrequency?.min || 500} Hz</span></label>
                        <input type="range" class="event-rand-freq-min" min="100" max="10000" value="${randomize.filterFrequency?.min || 500}" step="50">
                    </div>
                    <div class="aee-form-row">
                        <label>Filter Max: <span class="event-rand-freq-max-display">${randomize.filterFrequency?.max || 3000} Hz</span></label>
                        <input type="range" class="event-rand-freq-max" min="100" max="10000" value="${randomize.filterFrequency?.max || 3000}" step="50">
                    </div>
                </div>
            </div>
        `;

        container.appendChild(eventEl);
        this.setupEventUIListeners(eventEl);
    }

    setupEventUIListeners(eventEl) {
        // Delete button
        eventEl.querySelector('.aee-event-delete')?.addEventListener('click', () => {
            eventEl.remove();
        });

        // Slider displays
        const sliderConfigs = [
            { slider: '.event-min-interval', display: '.event-min-interval-display', format: v => `${Math.round(v)} ms` },
            { slider: '.event-max-interval', display: '.event-max-interval-display', format: v => `${Math.round(v)} ms` },
            { slider: '.event-chance', display: '.event-chance-display', format: v => `${Math.round(v * 100)}%` },
            { slider: '.event-duration', display: '.event-duration-display', format: v => `${(v * 1000).toFixed(0)} ms` },
            { slider: '.event-volume', display: '.event-volume-display', format: v => `${Math.round(v * 100)}%` },
            { slider: '.event-filter-freq', display: '.event-filter-freq-display', format: v => `${Math.round(v)} Hz` },
            { slider: '.event-rand-vol-min', display: '.event-rand-vol-min-display', format: v => `${Math.round(v * 100)}%` },
            { slider: '.event-rand-vol-max', display: '.event-rand-vol-max-display', format: v => `${Math.round(v * 100)}%` },
            { slider: '.event-rand-freq-min', display: '.event-rand-freq-min-display', format: v => `${Math.round(v)} Hz` },
            { slider: '.event-rand-freq-max', display: '.event-rand-freq-max-display', format: v => `${Math.round(v)} Hz` }
        ];

        sliderConfigs.forEach(({ slider, display, format }) => {
            const sliderEl = eventEl.querySelector(slider);
            const displayEl = eventEl.querySelector(display);
            if (sliderEl && displayEl) {
                sliderEl.addEventListener('input', () => {
                    displayEl.textContent = format(parseFloat(sliderEl.value));
                });
            }
        });
    }

    getEventsConfig() {
        const events = [];
        const eventEls = document.querySelectorAll('.aee-event');

        eventEls.forEach(eventEl => {
            const source = eventEl.querySelector('.event-source')?.value || 'white';
            const filterType = eventEl.querySelector('.event-filter-type')?.value;
            const filterFreq = parseFloat(eventEl.querySelector('.event-filter-freq')?.value || 1500);

            const soundLayer = {
                source,
                volume: 1.0,
                envelope: { attack: 0.001, decay: 0.02, sustain: 0, release: 0.02 }
            };

            if (filterType && filterType !== 'none') {
                soundLayer.filter = {
                    type: filterType,
                    frequency: filterFreq,
                    Q: 1
                };
            }

            const event = {
                minInterval: parseFloat(eventEl.querySelector('.event-min-interval')?.value || 50),
                maxInterval: parseFloat(eventEl.querySelector('.event-max-interval')?.value || 200),
                chance: parseFloat(eventEl.querySelector('.event-chance')?.value || 0.7),
                sound: {
                    duration: parseFloat(eventEl.querySelector('.event-duration')?.value || 0.05),
                    volume: parseFloat(eventEl.querySelector('.event-volume')?.value || 0.5),
                    layers: [soundLayer],
                    randomize: {
                        volume: {
                            min: parseFloat(eventEl.querySelector('.event-rand-vol-min')?.value || 0.3),
                            max: parseFloat(eventEl.querySelector('.event-rand-vol-max')?.value || 1)
                        },
                        filterFrequency: {
                            min: parseFloat(eventEl.querySelector('.event-rand-freq-min')?.value || 500),
                            max: parseFloat(eventEl.querySelector('.event-rand-freq-max')?.value || 3000)
                        }
                    }
                }
            };

            events.push(event);
        });

        return events;
    }

    getAudioConfig() {
        const duration = parseFloat(document.getElementById('master-duration')?.value || 0.5);
        const volume = parseFloat(document.getElementById('master-volume')?.value || 0.7);

        // Gather layers
        const layers = [];
        const layerEls = document.querySelectorAll('.aee-layer');

        layerEls.forEach(layerEl => {
            const source = layerEl.querySelector('.layer-source')?.value || 'sine';
            const isNoise = ['white', 'pink', 'brown'].includes(source);

            const layer = {
                source,
                volume: parseFloat(layerEl.querySelector('.layer-volume')?.value || 1)
            };

            if (!isNoise) {
                layer.frequency = parseFloat(layerEl.querySelector('.layer-frequency')?.value || 440);
            }

            // Envelope
            const attack = parseFloat(layerEl.querySelector('.layer-attack')?.value || 0.01);
            const decay = parseFloat(layerEl.querySelector('.layer-decay')?.value || 0.1);
            const sustain = parseFloat(layerEl.querySelector('.layer-sustain')?.value || 0.5);
            const release = parseFloat(layerEl.querySelector('.layer-release')?.value || 0.2);

            if (attack > 0 || decay > 0 || sustain < 1 || release > 0) {
                layer.envelope = { attack, decay, sustain, release };
            }

            // Pitch envelope (oscillators only)
            if (!isNoise) {
                const pitchStart = parseFloat(layerEl.querySelector('.layer-pitch-start')?.value || 1);
                const pitchEnd = parseFloat(layerEl.querySelector('.layer-pitch-end')?.value || 1);
                if (pitchStart !== 1 || pitchEnd !== 1) {
                    layer.pitchEnvelope = { start: pitchStart, end: pitchEnd, time: duration };
                }
            }

            // Layer filter
            const filterType = layerEl.querySelector('.layer-filter-type')?.value;
            if (filterType && filterType !== 'none') {
                layer.filter = {
                    type: filterType,
                    frequency: parseFloat(layerEl.querySelector('.layer-filter-freq')?.value || 1000),
                    Q: parseFloat(layerEl.querySelector('.layer-filter-q')?.value || 1)
                };
            }

            layers.push(layer);
        });

        const config = { duration, volume, layers };

        // Master effects
        const effects = {};

        const filterType = document.getElementById('master-filter-type')?.value;
        const filterFreq = parseFloat(document.getElementById('master-filter-freq')?.value || 20000);
        if (filterType && filterType !== 'none' && filterFreq < 20000) {
            effects.filter = {
                type: filterType,
                frequency: filterFreq,
                Q: parseFloat(document.getElementById('master-filter-q')?.value || 1)
            };
        }

        const distortion = parseFloat(document.getElementById('master-distortion')?.value || 0);
        if (distortion > 0) {
            effects.distortion = distortion;
        }

        const delayFeedback = parseFloat(document.getElementById('master-delay-feedback')?.value || 0);
        if (delayFeedback > 0) {
            effects.delay = {
                time: parseFloat(document.getElementById('master-delay-time')?.value || 0),
                feedback: delayFeedback
            };
        }

        const reverb = parseFloat(document.getElementById('master-reverb')?.value || 0);
        if (reverb > 0) {
            effects.reverb = reverb;
        }

        const pan = parseFloat(document.getElementById('master-pan')?.value || 0);
        if (pan !== 0) {
            effects.pan = pan;
        }

        if (Object.keys(effects).length > 0) {
            config.effects = effects;
        }

        // Add events if any
        const events = this.getEventsConfig();
        if (events.length > 0) {
            config.events = events;
        }

        return config;
    }

    loadFromLibrary() {
        const select = document.getElementById('library-sound-select');
        const soundValue = select?.value;

        if (!soundValue) {
            alert('Please select a sound from the library');
            return;
        }

        const [collection, soundId] = soundValue.split(':');
        const soundData = this.soundLibrary[collection]?.[soundId];

        if (!soundData || !soundData.audio) {
            alert('Sound not found in library');
            return;
        }

        // Copy the entire sound data
        this.effectData = JSON.parse(JSON.stringify(soundData));
        this.loadDataIntoUI(this.effectData.audio);

        select.value = '';
        console.log('[AudioEffectEditor] Loaded from library:', this.effectData.title);
    }

    // Playback - uses AudioManager for all synthesis
    async playEffect() {
        if (!this.audioManager || !this.audioManager.isInitialized) {
            alert('Click anywhere first to enable audio');
            return;
        }

        this.stopPlayback();
        this.isPlaying = true;

        const config = this.getAudioConfig();

        if (this._isLooping) {
            // For looping, use continuous sources
            await this.startContinuousPlayback(config);
        } else {
            // For one-shot, use AudioManager's playSynthSound
            await this.audioManager.playSynthSound('audioEffectEditorPreview', config);
        }
    }

    async startContinuousPlayback(config) {
        if (!this.audioManager.isInitialized) {
            await this.audioManager.initialize();
        }

        const ctx = this.audioManager.audioContext;
        if (!ctx) return;

        // Create master gain
        const masterGain = ctx.createGain();
        masterGain.gain.value = config.volume || 0.7;
        masterGain.connect(ctx.destination);

        // Create continuous sources for each layer
        (config.layers || []).forEach(layer => {
            const layerGain = ctx.createGain();
            layerGain.gain.value = layer.volume !== undefined ? layer.volume : 1;

            const isNoise = ['white', 'pink', 'brown'].includes(layer.source);
            let source;

            if (isNoise) {
                source = this.audioManager.createNoiseSource(layer.source);
            } else {
                source = ctx.createOscillator();
                source.type = layer.source || 'sine';
                source.frequency.value = layer.frequency || 440;
            }

            // Apply filter if defined
            if (layer.filter && layer.filter.type) {
                const filter = ctx.createBiquadFilter();
                filter.type = layer.filter.type;
                filter.frequency.value = layer.filter.frequency || 1000;
                filter.Q.value = layer.filter.Q || 1;
                source.connect(filter);
                filter.connect(layerGain);
            } else {
                source.connect(layerGain);
            }

            layerGain.connect(masterGain);
            source.start();

            this._continuousSources.push({ source, layerGain, masterGain });
        });

        // Start event schedulers if events exist
        const events = this.getEventsConfig();
        if (events && events.length > 0) {
            events.forEach(event => {
                if (event.sound) {
                    const intervalId = this.startEventScheduler(masterGain, event);
                    this._eventIntervals.push(intervalId);
                }
            });
        }
    }

    startEventScheduler(destination, eventConfig) {
        const minInterval = eventConfig.minInterval || 50;
        const maxInterval = eventConfig.maxInterval || 300;
        const chance = eventConfig.chance || 0.7;
        const soundDef = eventConfig.sound;

        if (!soundDef) return null;

        const scheduleEvent = () => {
            if (Math.random() < chance) {
                this.playEventSound(destination, soundDef);
            }
            const nextInterval = minInterval + Math.random() * (maxInterval - minInterval);
            return setTimeout(scheduleEvent, nextInterval);
        };

        return scheduleEvent();
    }

    playEventSound(destination, soundDef) {
        const ctx = this.audioManager.audioContext;
        if (!ctx) return;

        const now = ctx.currentTime;

        // Clone and apply randomization
        const config = JSON.parse(JSON.stringify(soundDef));
        const randomize = config.randomize || {};

        if (randomize.volume) {
            const range = randomize.volume;
            config.volume *= range.min + Math.random() * (range.max - range.min);
        }

        if (randomize.filterFrequency && config.layers) {
            config.layers.forEach(layer => {
                if (layer.filter) {
                    const range = randomize.filterFrequency;
                    layer.filter.frequency = range.min + Math.random() * (range.max - range.min);
                }
            });
        }

        const duration = config.duration || 0.1;
        const masterVolume = config.volume || 1;

        // Create event sound
        const eventGain = ctx.createGain();
        eventGain.gain.value = masterVolume;
        eventGain.connect(destination);

        (config.layers || []).forEach(layer => {
            const layerGain = ctx.createGain();
            layerGain.gain.value = layer.volume || 1;

            const isNoise = ['white', 'pink', 'brown'].includes(layer.source);
            let source;

            if (isNoise) {
                source = this.audioManager.createNoiseSource(layer.source);
            } else {
                source = ctx.createOscillator();
                source.type = layer.source || 'sine';
                source.frequency.value = layer.frequency || 440;
            }

            // Apply envelope
            const env = layer.envelope || {};
            const attack = env.attack || 0.001;
            const decay = env.decay || 0.01;
            const sustain = env.sustain !== undefined ? env.sustain : 0.5;
            const release = env.release || 0.01;

            layerGain.gain.setValueAtTime(0, now);
            layerGain.gain.linearRampToValueAtTime(layer.volume || 1, now + attack);
            layerGain.gain.linearRampToValueAtTime((layer.volume || 1) * sustain, now + attack + decay);
            layerGain.gain.linearRampToValueAtTime(0, now + duration + release);

            // Apply filter
            if (layer.filter && layer.filter.type) {
                const filter = ctx.createBiquadFilter();
                filter.type = layer.filter.type;
                filter.frequency.value = layer.filter.frequency || 1000;
                filter.Q.value = layer.filter.Q || 1;
                source.connect(filter);
                filter.connect(layerGain);
            } else {
                source.connect(layerGain);
            }

            layerGain.connect(eventGain);
            source.start(now);
            source.stop(now + duration + release + 0.1);
        });
    }

    stopPlayback() {
        this.isPlaying = false;

        // Stop continuous sources
        this._continuousSources.forEach(({ source }) => {
            try {
                source.stop();
            } catch (e) {
                // Source may already be stopped
            }
        });
        this._continuousSources = [];

        // Stop event intervals
        this._eventIntervals.forEach(intervalId => {
            if (intervalId) clearTimeout(intervalId);
        });
        this._eventIntervals = [];

        // Stop any one-shot sounds
        this.audioManager.stopAllSounds?.();
    }

    randomizeSound() {
        const sources = ['sine', 'square', 'sawtooth', 'triangle', 'white', 'pink', 'brown'];
        const filterTypes = ['lowpass', 'highpass', 'bandpass'];

        // Random number of layers (1-4)
        const numLayers = 1 + Math.floor(Math.random() * 4);
        const layers = [];

        for (let i = 0; i < numLayers; i++) {
            const source = sources[Math.floor(Math.random() * sources.length)];
            const isNoise = ['white', 'pink', 'brown'].includes(source);

            const layer = {
                source,
                volume: 0.3 + Math.random() * 0.7,
                envelope: {
                    attack: 0.001 + Math.random() * 0.5,
                    decay: Math.random() * 0.5,
                    sustain: Math.random(),
                    release: 0.01 + Math.random() * 1
                }
            };

            if (!isNoise) {
                layer.frequency = 50 + Math.random() * 1000;
                if (Math.random() > 0.5) {
                    layer.pitchEnvelope = {
                        start: 0.2 + Math.random() * 3,
                        end: 0.2 + Math.random() * 3
                    };
                }
            }

            // Random filter on some layers
            if (Math.random() > 0.5) {
                layer.filter = {
                    type: filterTypes[Math.floor(Math.random() * filterTypes.length)],
                    frequency: 100 + Math.random() * 5000,
                    Q: 0.5 + Math.random() * 5
                };
            }

            layers.push(layer);
        }

        const randomConfig = {
            duration: 0.1 + Math.random() * 2,
            volume: 0.3 + Math.random() * 0.5,
            layers
        };

        // Random master effects
        if (Math.random() > 0.5) {
            randomConfig.effects = {};

            if (Math.random() > 0.5) {
                randomConfig.effects.filter = {
                    type: filterTypes[Math.floor(Math.random() * filterTypes.length)],
                    frequency: 100 + Math.random() * 5000,
                    Q: 0.5 + Math.random() * 10
                };
            }
            if (Math.random() > 0.7) {
                randomConfig.effects.distortion = Math.random() * 50;
            }
            if (Math.random() > 0.7) {
                randomConfig.effects.delay = {
                    time: Math.random() * 0.5,
                    feedback: Math.random() * 0.5
                };
            }
            if (Math.random() > 0.7) {
                randomConfig.effects.reverb = Math.random() * 0.5;
            }
        }

        this.effectData.audio = randomConfig;
        this.loadDataIntoUI(randomConfig);
    }

    // Export/Import
    exportEffect() {
        const title = document.getElementById('effect-title')?.value || 'sound_effect';
        const audioConfig = this.getAudioConfig();

        const exportData = {
            title: title,
            audio: audioConfig
        };

        const data = JSON.stringify(exportData, null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const link = document.createElement('a');
        link.download = `${title.replace(/\s+/g, '_').toLowerCase()}.json`;
        link.href = URL.createObjectURL(blob);
        link.click();
    }

    async importEffect(file) {
        if (!file) return;

        try {
            const text = await file.text();
            const data = JSON.parse(text);

            if (!data.audio || !data.audio.layers) {
                alert('Invalid sound file format. Expected { title, audio: { duration, volume, layers, ... } }');
                return;
            }

            this.effectData = data;
            this.loadDataIntoUI(this.effectData.audio);

            console.log('[AudioEffectEditor] Imported effect:', this.effectData.title);
        } catch (err) {
            console.error('[AudioEffectEditor] Error importing effect:', err);
            alert('Error importing effect file');
        }
    }
}

// Export for GUTS
if (typeof window !== 'undefined') {
    window.AudioEffectEditor = AudioEffectEditor;
}
