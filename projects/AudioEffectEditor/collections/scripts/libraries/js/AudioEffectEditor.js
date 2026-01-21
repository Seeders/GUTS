/**
 * AudioEffectEditor - Layered Sound Effect Creation Tool
 * Creates complex layered sound effects with a visual timeline UI
 */
class AudioEffectEditor {
    constructor(game) {
        this.game = game;
        this.container = null;

        // Effect data - start with an example effect
        this.effectData = this.getDefaultEffect();

        // UI state
        this.selectedLayerIndex = -1;
        this.isPlaying = false;
        this.playbackPosition = 0;
        this.playbackStartTime = 0;
        this.animationFrameId = null;

        // Audio - uses AudioManager
        this.audioManager = null;
        this.masterGain = null;
        this.activeSources = [];
        this.activeIntervals = [];
        this.loopingLayers = []; // For continuous looping layers

        // Timeline settings
        this.timelineWidth = 600;
        this.pixelsPerSecond = 300;

        // Dragging state
        this.isDragging = false;
        this.dragLayerIndex = -1;
        this.dragStartX = 0;
        this.dragStartDelay = 0;

        // Sound library - loaded from collections
        this.soundLibrary = {};
    }

    async init() {
        this.container = document.getElementById('appContainer') || document.body;

        // Load sound library from collections
        await this.loadSoundLibrary();

        // Sync UI with data (UI structure is in HTML)
        this.syncUIFromData();
        this.populateSoundLibraryDropdown();
        this.setupEventListeners();

        // Initialize audio on first interaction
        this.initAudioOnInteraction();

        // Render timeline and select first layer
        this.renderTimeline();
        if (this.effectData.layers.length > 0) {
            this.selectedLayerIndex = 0;
            this.renderLayerEditor();
        }

        console.log('[AudioEffectEditor] Initialized with example effect');
    }

    syncUIFromData() {
        // Update form fields to match effect data
        document.getElementById('effect-title').value = this.effectData.title;
        document.getElementById('effect-category').value = this.effectData.category;
        document.getElementById('effect-tags').value = this.effectData.tags.join(', ');
        document.getElementById('effect-duration').value = this.effectData.duration;
    }

    populateSoundLibraryDropdown() {
        const select = document.getElementById('library-sound-select');
        const options = this.buildSoundLibraryOptions();
        // Keep the first empty option, add library options after
        select.innerHTML = '<option value="">-- Select from library --</option>' + options;
    }

    async loadSoundLibrary() {
        // Load sounds from GUTS data collections
        const collections = ['hitSounds', 'attackSounds', 'uiSounds', 'ambientSounds'];

        for (const collection of collections) {
            this.soundLibrary[collection] = {};

            // Try to load from GUTS.data if available
            if (window.GUTS && window.GUTS.data && window.GUTS.data[collection]) {
                const sounds = window.GUTS.data[collection];
                for (const [id, sound] of Object.entries(sounds)) {
                    this.soundLibrary[collection][id] = sound;
                }
            }
        }

        console.log('[AudioEffectEditor] Sound library loaded:', this.soundLibrary);
    }

    buildSoundLibraryOptions() {
        const collectionLabels = {
            hitSounds: 'Hit Sounds',
            attackSounds: 'Attack Sounds',
            uiSounds: 'UI Sounds',
            ambientSounds: 'Ambient Sounds'
        };

        let html = '';
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

        return html || '<option disabled>No sounds loaded</option>';
    }

    getDefaultEffect() {
        return {
            title: 'Fire Crackle',
            category: 'ambient',
            tags: ['fire', 'crackle', 'campfire'],
            duration: 2.0,
            layers: [
                {
                    id: 1,
                    name: 'Low Rumble',
                    custom: true,
                    delay: 0,
                    volume: 0.3,
                    pan: 0,
                    pitchShift: 1.0,
                    audio: {
                        waveform: 'noise',
                        frequency: 150,
                        duration: 2.0,
                        envelope: {
                            attack: 0.1,
                            decay: 0.2,
                            sustain: 0.9,
                            release: 0.3
                        },
                        filter: {
                            type: 'lowpass',
                            frequency: 150,
                            Q: 0.5
                        },
                        noise: {
                            enabled: true,
                            type: 'brown',
                            amount: 1.0
                        }
                    }
                },
                {
                    id: 2,
                    name: 'Mid Crackle',
                    custom: true,
                    delay: 0,
                    volume: 0.15,
                    pan: 0,
                    pitchShift: 1.0,
                    audio: {
                        waveform: 'noise',
                        frequency: 1200,
                        duration: 2.0,
                        envelope: {
                            attack: 0.05,
                            decay: 0.2,
                            sustain: 0.8,
                            release: 0.3
                        },
                        filter: {
                            type: 'bandpass',
                            frequency: 1200,
                            Q: 1.5
                        },
                        noise: {
                            enabled: true,
                            type: 'pink',
                            amount: 1.0
                        }
                    }
                },
                {
                    id: 3,
                    name: 'High Hiss',
                    custom: true,
                    delay: 0,
                    volume: 0.05,
                    pan: 0,
                    pitchShift: 1.0,
                    audio: {
                        waveform: 'noise',
                        frequency: 3000,
                        duration: 2.0,
                        envelope: {
                            attack: 0.1,
                            decay: 0.2,
                            sustain: 0.7,
                            release: 0.4
                        },
                        filter: {
                            type: 'highpass',
                            frequency: 3000,
                            Q: 0.3
                        },
                        noise: {
                            enabled: true,
                            type: 'white',
                            amount: 1.0
                        }
                    }
                },
                {
                    id: 4,
                    name: 'Crackle Pop 1',
                    custom: true,
                    delay: 0.2,
                    volume: 0.5,
                    pan: -0.3,
                    pitchShift: 1.0,
                    audio: {
                        waveform: 'noise',
                        frequency: 1500,
                        duration: 0.04,
                        envelope: {
                            attack: 0.001,
                            decay: 0.015,
                            sustain: 0.1,
                            release: 0.02
                        },
                        filter: {
                            type: 'bandpass',
                            frequency: 1500,
                            Q: 2
                        },
                        noise: {
                            enabled: true,
                            type: 'white',
                            amount: 1.0
                        }
                    }
                },
                {
                    id: 5,
                    name: 'Crackle Pop 2',
                    custom: true,
                    delay: 0.55,
                    volume: 0.45,
                    pan: 0.2,
                    pitchShift: 1.2,
                    audio: {
                        waveform: 'noise',
                        frequency: 1800,
                        duration: 0.04,
                        envelope: {
                            attack: 0.001,
                            decay: 0.015,
                            sustain: 0.1,
                            release: 0.02
                        },
                        filter: {
                            type: 'bandpass',
                            frequency: 1800,
                            Q: 2.5
                        },
                        noise: {
                            enabled: true,
                            type: 'white',
                            amount: 1.0
                        }
                    }
                },
                {
                    id: 6,
                    name: 'Crackle Pop 3',
                    custom: true,
                    delay: 0.95,
                    volume: 0.55,
                    pan: 0.1,
                    pitchShift: 0.9,
                    audio: {
                        waveform: 'noise',
                        frequency: 1300,
                        duration: 0.04,
                        envelope: {
                            attack: 0.001,
                            decay: 0.015,
                            sustain: 0.1,
                            release: 0.02
                        },
                        filter: {
                            type: 'bandpass',
                            frequency: 1300,
                            Q: 2
                        },
                        noise: {
                            enabled: true,
                            type: 'white',
                            amount: 1.0
                        }
                    }
                },
                {
                    id: 7,
                    name: 'Crackle Pop 4',
                    custom: true,
                    delay: 1.4,
                    volume: 0.48,
                    pan: -0.15,
                    pitchShift: 1.1,
                    audio: {
                        waveform: 'noise',
                        frequency: 2000,
                        duration: 0.04,
                        envelope: {
                            attack: 0.001,
                            decay: 0.015,
                            sustain: 0.1,
                            release: 0.02
                        },
                        filter: {
                            type: 'bandpass',
                            frequency: 2000,
                            Q: 2
                        },
                        noise: {
                            enabled: true,
                            type: 'white',
                            amount: 1.0
                        }
                    }
                },
                {
                    id: 8,
                    name: 'Crackle Pop 5',
                    custom: true,
                    delay: 1.7,
                    volume: 0.42,
                    pan: 0.25,
                    pitchShift: 1.0,
                    audio: {
                        waveform: 'noise',
                        frequency: 1600,
                        duration: 0.04,
                        envelope: {
                            attack: 0.001,
                            decay: 0.015,
                            sustain: 0.1,
                            release: 0.02
                        },
                        filter: {
                            type: 'bandpass',
                            frequency: 1600,
                            Q: 2
                        },
                        noise: {
                            enabled: true,
                            type: 'white',
                            amount: 1.0
                        }
                    }
                }
            ]
        };
    }

    initAudioOnInteraction() {
        // Create AudioManager instance
        this.audioManager = new GUTS.AudioManager(null, null, {});
        this.audioManager.init();

        // Once AudioManager initializes, set up our master gain
        const initHandler = () => {
            if (this.audioManager.isInitialized && !this.masterGain) {
                this.masterGain = this.audioManager.audioContext.createGain();
                this.masterGain.connect(this.audioManager.sfxBus.input);
                console.log('[AudioEffectEditor] Audio initialized via AudioManager');
            }
        };

        document.addEventListener('click', initHandler, { once: true });
        document.addEventListener('keydown', initHandler, { once: true });
    }


    setupEventListeners() {
        // Effect info
        document.getElementById('effect-title').addEventListener('change', (e) => {
            this.effectData.title = e.target.value;
        });

        document.getElementById('effect-category').addEventListener('change', (e) => {
            this.effectData.category = e.target.value;
        });

        document.getElementById('effect-tags').addEventListener('change', (e) => {
            this.effectData.tags = e.target.value.split(',').map(t => t.trim()).filter(t => t);
        });

        document.getElementById('effect-duration').addEventListener('change', (e) => {
            this.effectData.duration = parseFloat(e.target.value) || 2.0;
            this.renderTimeline();
        });

        // Add layer buttons
        document.getElementById('add-custom-layer').addEventListener('click', () => this.addCustomLayer());
        document.getElementById('add-library-layer').addEventListener('click', () => this.addLibraryLayer());

        // Playback
        document.getElementById('play-btn').addEventListener('click', () => this.playEffect());
        document.getElementById('stop-btn').addEventListener('click', () => this.stopPlayback());
        document.getElementById('loop-btn').addEventListener('click', () => this.toggleLoop());

        // Export/Import
        document.getElementById('export-json').addEventListener('click', () => this.exportEffect());
        document.getElementById('import-json').addEventListener('click', () => document.getElementById('import-input').click());
        document.getElementById('import-input').addEventListener('change', (e) => this.importEffect(e.target.files[0]));

        // Timeline click
        document.getElementById('timeline-container').addEventListener('mousedown', (e) => this.handleTimelineMouseDown(e));
        document.addEventListener('mousemove', (e) => this.handleTimelineMouseMove(e));
        document.addEventListener('mouseup', () => this.handleTimelineMouseUp());
    }

    // Layer Management
    addCustomLayer() {
        const layer = {
            id: Date.now(),
            name: `Layer ${this.effectData.layers.length + 1}`,
            custom: true,
            delay: 0,
            volume: 1.0,
            pan: 0,
            pitchShift: 1.0,
            audio: {
                waveform: 'sine',
                frequency: 440,
                duration: 0.5,
                envelope: {
                    attack: 0.01,
                    decay: 0.1,
                    sustain: 0.5,
                    release: 0.2
                },
                filter: {
                    type: 'lowpass',
                    frequency: 2000,
                    Q: 1
                },
                noise: {
                    enabled: false,
                    type: 'white',
                    amount: 0.3
                }
            }
        };

        this.effectData.layers.push(layer);
        this.selectedLayerIndex = this.effectData.layers.length - 1;
        this.renderTimeline();
        this.renderLayerEditor();
    }

    addLibraryLayer() {
        const select = document.getElementById('library-sound-select');
        const soundValue = select.value;

        if (!soundValue) {
            alert('Please select a sound from the library');
            return;
        }

        // Parse collection:id format
        const [collection, soundId] = soundValue.split(':');
        const soundData = this.soundLibrary[collection]?.[soundId];

        if (!soundData) {
            alert('Sound not found in library');
            return;
        }

        // Create layer from library sound data
        const audio = soundData.audio || {};
        const layer = {
            id: Date.now(),
            name: soundData.title || soundId,
            custom: true, // Treat as custom since we have the full audio config
            delay: 0,
            volume: 1.0,
            pan: audio.effects?.pan || 0,
            pitchShift: 1.0,
            audio: {
                waveform: audio.waveform || 'sine',
                frequency: audio.frequency || 440,
                duration: audio.duration || 0.5,
                envelope: audio.envelope || {
                    attack: 0.01,
                    decay: 0.1,
                    sustain: 0.5,
                    release: 0.2
                },
                pitchEnvelope: audio.pitchEnvelope || null,
                filter: audio.effects?.filter || {
                    type: 'lowpass',
                    frequency: 2000,
                    Q: 1
                },
                noise: {
                    enabled: audio.noise?.amount > 0 || audio.waveform === 'noise',
                    type: audio.noise?.type || 'white',
                    amount: audio.noise?.amount || (audio.waveform === 'noise' ? 1.0 : 0)
                },
                effects: audio.effects || {}
            },
            sourceCollection: collection,
            sourceId: soundId
        };

        this.effectData.layers.push(layer);
        this.selectedLayerIndex = this.effectData.layers.length - 1;
        this.renderTimeline();
        this.renderLayerEditor();

        select.value = '';
    }

    removeLayer(index) {
        this.effectData.layers.splice(index, 1);
        if (this.selectedLayerIndex >= this.effectData.layers.length) {
            this.selectedLayerIndex = this.effectData.layers.length - 1;
        }
        this.renderTimeline();
        this.renderLayerEditor();
    }

    selectLayer(index) {
        this.selectedLayerIndex = index;
        this.renderTimeline();
        this.renderLayerEditor();
    }

    updateLayer(index, property, value) {
        if (index < 0 || index >= this.effectData.layers.length) return;

        const layer = this.effectData.layers[index];
        const parts = property.split('.');
        let target = layer;

        for (let i = 0; i < parts.length - 1; i++) {
            target = target[parts[i]];
        }
        target[parts[parts.length - 1]] = value;

        this.renderTimeline();
    }

    // Timeline Rendering
    renderTimeline() {
        this.renderTimelineRuler();
        this.renderTimelineTracks();
    }

    renderTimelineRuler() {
        const ruler = document.getElementById('timeline-ruler');
        const duration = this.effectData.duration;
        const width = duration * this.pixelsPerSecond;

        ruler.style.width = `${100 + width}px`;
        ruler.innerHTML = '';

        // Add tick marks
        const tickInterval = 0.1; // 100ms ticks
        for (let t = 0; t <= duration; t += tickInterval) {
            const isMajor = Math.abs(t - Math.round(t)) < 0.01;
            const x = 100 + t * this.pixelsPerSecond;

            const tick = document.createElement('div');
            tick.className = `aee-timeline-ruler-tick${isMajor ? ' major' : ''}`;
            tick.style.left = `${x}px`;
            ruler.appendChild(tick);

            if (isMajor) {
                const label = document.createElement('div');
                label.className = 'aee-timeline-ruler-label';
                label.style.left = `${x}px`;
                label.textContent = `${t.toFixed(1)}s`;
                ruler.appendChild(label);
            }
        }
    }

    renderTimelineTracks() {
        const tracks = document.getElementById('timeline-tracks');
        const duration = this.effectData.duration;
        const width = duration * this.pixelsPerSecond;

        if (this.effectData.layers.length === 0) {
            tracks.innerHTML = '<div class="aee-timeline-empty">Add layers to begin</div>';
            return;
        }

        tracks.innerHTML = this.effectData.layers.map((layer, index) => {
            const blockLeft = 100 + layer.delay * this.pixelsPerSecond;
            const blockWidth = Math.max(20, (layer.audio?.duration || 0.5) * this.pixelsPerSecond);
            const isSelected = index === this.selectedLayerIndex;
            const isCustom = layer.custom;

            return `
                <div class="aee-timeline-track${isSelected ? ' selected' : ''}" data-index="${index}">
                    <div class="aee-timeline-track-label">${layer.name}</div>
                    <div class="aee-timeline-track-content" style="width: ${width}px;">
                        <div class="aee-timeline-block${isCustom ? ' custom' : ''}"
                             style="left: ${blockLeft}px; width: ${blockWidth}px;"
                             data-index="${index}"
                             title="${layer.name} (delay: ${layer.delay.toFixed(2)}s)">
                            ${layer.custom ? 'SYN' : 'LIB'}
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        // Add click handlers for track selection
        tracks.querySelectorAll('.aee-timeline-track').forEach(track => {
            track.addEventListener('click', (e) => {
                if (!e.target.classList.contains('aee-timeline-block')) {
                    this.selectLayer(parseInt(track.dataset.index));
                }
            });
        });
    }

    handleTimelineMouseDown(e) {
        const block = e.target.closest('.aee-timeline-block');
        if (block) {
            this.isDragging = true;
            this.dragLayerIndex = parseInt(block.dataset.index);
            this.dragStartX = e.clientX;
            this.dragStartDelay = this.effectData.layers[this.dragLayerIndex].delay;
            block.classList.add('dragging');
            this.selectLayer(this.dragLayerIndex);
        }
    }

    handleTimelineMouseMove(e) {
        if (!this.isDragging || this.dragLayerIndex < 0) return;

        const dx = e.clientX - this.dragStartX;
        const dt = dx / this.pixelsPerSecond;
        const newDelay = Math.max(0, this.dragStartDelay + dt);

        this.effectData.layers[this.dragLayerIndex].delay = newDelay;
        this.renderTimeline();
        this.renderLayerEditor();
    }

    handleTimelineMouseUp() {
        if (this.isDragging) {
            document.querySelectorAll('.aee-timeline-block').forEach(b => b.classList.remove('dragging'));
            this.isDragging = false;
            this.dragLayerIndex = -1;
        }
    }

    // Layer Editor
    renderLayerEditor() {
        const content = document.getElementById('layer-editor-content');

        if (this.selectedLayerIndex < 0 || this.selectedLayerIndex >= this.effectData.layers.length) {
            content.innerHTML = '<div class="aee-layer-controls-empty">Select a layer to edit</div>';
            return;
        }

        const layer = this.effectData.layers[this.selectedLayerIndex];
        const index = this.selectedLayerIndex;

        let html = `
            <div class="aee-form-row">
                <label>Name:</label>
                <input type="text" id="layer-name" value="${layer.name}">
            </div>
            <div class="aee-form-row">
                <label>Delay:</label>
                <input type="range" id="layer-delay" min="0" max="${this.effectData.duration}" step="0.01" value="${layer.delay}">
                <span class="value-display" id="layer-delay-value">${layer.delay.toFixed(2)}s</span>
            </div>
            <div class="aee-form-row">
                <label>Volume:</label>
                <input type="range" id="layer-volume" min="0" max="1" step="0.01" value="${layer.volume}">
                <span class="value-display" id="layer-volume-value">${Math.round(layer.volume * 100)}%</span>
            </div>
            <div class="aee-form-row">
                <label>Pan:</label>
                <input type="range" id="layer-pan" min="-1" max="1" step="0.01" value="${layer.pan}">
                <span class="value-display" id="layer-pan-value">${layer.pan.toFixed(2)}</span>
            </div>
            <div class="aee-form-row">
                <label>Pitch:</label>
                <input type="range" id="layer-pitch" min="0.5" max="2" step="0.01" value="${layer.pitchShift}">
                <span class="value-display" id="layer-pitch-value">${layer.pitchShift.toFixed(2)}x</span>
            </div>
        `;

        if (layer.custom) {
            html += this.buildSynthPanel(layer, index);
        }

        html += `
            <div style="margin-top: 15px; display: flex; gap: 10px;">
                <button id="preview-layer" class="aee-btn">Preview Layer</button>
                <button id="remove-layer" class="aee-btn aee-btn-danger">Remove</button>
            </div>
        `;

        content.innerHTML = html;

        // Bind events
        this.bindLayerEditorEvents(index, layer);
    }

    bindLayerEditorEvents(index, layer) {
        document.getElementById('layer-name').addEventListener('change', (e) => {
            this.updateLayer(index, 'name', e.target.value);
        });

        document.getElementById('layer-delay').addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            this.updateLayer(index, 'delay', value);
            document.getElementById('layer-delay-value').textContent = `${value.toFixed(2)}s`;
        });

        document.getElementById('layer-volume').addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            this.updateLayer(index, 'volume', value);
            document.getElementById('layer-volume-value').textContent = `${Math.round(value * 100)}%`;
        });

        document.getElementById('layer-pan').addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            this.updateLayer(index, 'pan', value);
            document.getElementById('layer-pan-value').textContent = value.toFixed(2);
        });

        document.getElementById('layer-pitch').addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            this.updateLayer(index, 'pitchShift', value);
            document.getElementById('layer-pitch-value').textContent = `${value.toFixed(2)}x`;
        });

        document.getElementById('preview-layer').addEventListener('click', () => this.previewLayer(index));
        document.getElementById('remove-layer').addEventListener('click', () => this.removeLayer(index));

        if (layer.custom) {
            this.bindSynthPanelEvents(index, layer);
        }
    }

    buildSynthPanel(layer, index) {
        const audio = layer.audio;
        const env = audio.envelope;

        return `
            <div class="aee-synth-panel">
                <h4>Synthesizer</h4>

                <div class="aee-synth-grid">
                    <div class="aee-synth-section">
                        <h5>Oscillator</h5>
                        <div class="aee-form-row">
                            <label>Wave:</label>
                            <div class="aee-waveform-btns">
                                <button class="aee-waveform-btn${audio.waveform === 'sine' ? ' active' : ''}" data-wave="sine">Sin</button>
                                <button class="aee-waveform-btn${audio.waveform === 'square' ? ' active' : ''}" data-wave="square">Sq</button>
                                <button class="aee-waveform-btn${audio.waveform === 'sawtooth' ? ' active' : ''}" data-wave="sawtooth">Saw</button>
                                <button class="aee-waveform-btn${audio.waveform === 'triangle' ? ' active' : ''}" data-wave="triangle">Tri</button>
                            </div>
                        </div>
                        <div class="aee-form-row">
                            <label>Freq:</label>
                            <input type="range" id="synth-freq" min="20" max="2000" value="${audio.frequency}">
                            <span class="value-display" id="synth-freq-value">${audio.frequency}Hz</span>
                        </div>
                        <div class="aee-form-row">
                            <label>Duration:</label>
                            <input type="range" id="synth-duration" min="0.05" max="3" step="0.05" value="${audio.duration}">
                            <span class="value-display" id="synth-duration-value">${audio.duration}s</span>
                        </div>
                    </div>

                    <div class="aee-synth-section">
                        <h5>Envelope (ADSR)</h5>
                        <div class="aee-adsr-visual">
                            <canvas id="adsr-canvas" class="aee-adsr-canvas"></canvas>
                        </div>
                        <div class="aee-form-row">
                            <label>Attack:</label>
                            <input type="range" id="synth-attack" min="0.001" max="1" step="0.001" value="${env.attack}">
                            <span class="value-display" id="synth-attack-value">${env.attack}s</span>
                        </div>
                        <div class="aee-form-row">
                            <label>Decay:</label>
                            <input type="range" id="synth-decay" min="0.001" max="1" step="0.001" value="${env.decay}">
                            <span class="value-display" id="synth-decay-value">${env.decay}s</span>
                        </div>
                        <div class="aee-form-row">
                            <label>Sustain:</label>
                            <input type="range" id="synth-sustain" min="0" max="1" step="0.01" value="${env.sustain}">
                            <span class="value-display" id="synth-sustain-value">${Math.round(env.sustain * 100)}%</span>
                        </div>
                        <div class="aee-form-row">
                            <label>Release:</label>
                            <input type="range" id="synth-release" min="0.001" max="2" step="0.001" value="${env.release}">
                            <span class="value-display" id="synth-release-value">${env.release}s</span>
                        </div>
                    </div>

                    <div class="aee-synth-section">
                        <h5>Filter</h5>
                        <div class="aee-form-row">
                            <label>Type:</label>
                            <select id="synth-filter-type">
                                <option value="lowpass"${audio.filter.type === 'lowpass' ? ' selected' : ''}>Low Pass</option>
                                <option value="highpass"${audio.filter.type === 'highpass' ? ' selected' : ''}>High Pass</option>
                                <option value="bandpass"${audio.filter.type === 'bandpass' ? ' selected' : ''}>Band Pass</option>
                            </select>
                        </div>
                        <div class="aee-form-row">
                            <label>Cutoff:</label>
                            <input type="range" id="synth-filter-freq" min="20" max="20000" value="${audio.filter.frequency}">
                            <span class="value-display" id="synth-filter-freq-value">${audio.filter.frequency}Hz</span>
                        </div>
                        <div class="aee-form-row">
                            <label>Q:</label>
                            <input type="range" id="synth-filter-q" min="0.1" max="20" step="0.1" value="${audio.filter.Q}">
                            <span class="value-display" id="synth-filter-q-value">${audio.filter.Q}</span>
                        </div>
                    </div>

                    <div class="aee-synth-section">
                        <h5>Noise</h5>
                        <div class="aee-form-row">
                            <label>Enabled:</label>
                            <input type="checkbox" id="synth-noise-enabled"${audio.noise.enabled ? ' checked' : ''}>
                        </div>
                        <div class="aee-form-row">
                            <label>Type:</label>
                            <select id="synth-noise-type">
                                <option value="white"${audio.noise.type === 'white' ? ' selected' : ''}>White</option>
                                <option value="pink"${audio.noise.type === 'pink' ? ' selected' : ''}>Pink</option>
                                <option value="brown"${audio.noise.type === 'brown' ? ' selected' : ''}>Brown</option>
                            </select>
                        </div>
                        <div class="aee-form-row">
                            <label>Amount:</label>
                            <input type="range" id="synth-noise-amount" min="0" max="1" step="0.01" value="${audio.noise.amount}">
                            <span class="value-display" id="synth-noise-amount-value">${Math.round(audio.noise.amount * 100)}%</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    bindSynthPanelEvents(index, layer) {
        const audio = layer.audio;

        // Waveform buttons
        document.querySelectorAll('.aee-waveform-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.aee-waveform-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this.updateLayer(index, 'audio.waveform', e.target.dataset.wave);
            });
        });

        // Oscillator
        document.getElementById('synth-freq').addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            this.updateLayer(index, 'audio.frequency', value);
            document.getElementById('synth-freq-value').textContent = `${Math.round(value)}Hz`;
        });

        document.getElementById('synth-duration').addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            this.updateLayer(index, 'audio.duration', value);
            document.getElementById('synth-duration-value').textContent = `${value.toFixed(2)}s`;
        });

        // Envelope
        ['attack', 'decay', 'sustain', 'release'].forEach(param => {
            const el = document.getElementById(`synth-${param}`);
            el.addEventListener('input', (e) => {
                const value = parseFloat(e.target.value);
                this.updateLayer(index, `audio.envelope.${param}`, value);
                if (param === 'sustain') {
                    document.getElementById(`synth-${param}-value`).textContent = `${Math.round(value * 100)}%`;
                } else {
                    document.getElementById(`synth-${param}-value`).textContent = `${value}s`;
                }
                this.drawADSR(layer.audio.envelope);
            });
        });

        // Filter
        document.getElementById('synth-filter-type').addEventListener('change', (e) => {
            this.updateLayer(index, 'audio.filter.type', e.target.value);
        });

        document.getElementById('synth-filter-freq').addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            this.updateLayer(index, 'audio.filter.frequency', value);
            document.getElementById('synth-filter-freq-value').textContent = `${Math.round(value)}Hz`;
        });

        document.getElementById('synth-filter-q').addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            this.updateLayer(index, 'audio.filter.Q', value);
            document.getElementById('synth-filter-q-value').textContent = value.toFixed(1);
        });

        // Noise
        document.getElementById('synth-noise-enabled').addEventListener('change', (e) => {
            this.updateLayer(index, 'audio.noise.enabled', e.target.checked);
        });

        document.getElementById('synth-noise-type').addEventListener('change', (e) => {
            this.updateLayer(index, 'audio.noise.type', e.target.value);
        });

        document.getElementById('synth-noise-amount').addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            this.updateLayer(index, 'audio.noise.amount', value);
            document.getElementById('synth-noise-amount-value').textContent = `${Math.round(value * 100)}%`;
        });

        // Draw initial ADSR
        setTimeout(() => this.drawADSR(audio.envelope), 50);
    }

    drawADSR(envelope) {
        const canvas = document.getElementById('adsr-canvas');
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const width = canvas.offsetWidth;
        const height = canvas.offsetHeight;

        canvas.width = width;
        canvas.height = height;

        ctx.clearRect(0, 0, width, height);

        const { attack, decay, sustain, release } = envelope;
        const totalTime = attack + decay + 0.3 + release; // 0.3 for sustain hold
        const pxPerSec = width / totalTime;

        ctx.strokeStyle = '#e94560';
        ctx.lineWidth = 2;
        ctx.beginPath();

        // Start at 0
        ctx.moveTo(0, height);

        // Attack
        const attackEnd = attack * pxPerSec;
        ctx.lineTo(attackEnd, 5);

        // Decay to sustain
        const decayEnd = attackEnd + decay * pxPerSec;
        const sustainY = height - (sustain * (height - 10));
        ctx.lineTo(decayEnd, sustainY);

        // Sustain
        const sustainEnd = decayEnd + 0.3 * pxPerSec;
        ctx.lineTo(sustainEnd, sustainY);

        // Release
        const releaseEnd = sustainEnd + release * pxPerSec;
        ctx.lineTo(releaseEnd, height);

        ctx.stroke();

        // Fill under curve
        ctx.lineTo(0, height);
        ctx.closePath();
        ctx.fillStyle = 'rgba(233, 69, 96, 0.2)';
        ctx.fill();
    }

    // Playback - uses AudioManager for synthesis
    playEffect() {
        if (!this.audioManager || !this.audioManager.isInitialized) {
            alert('Click anywhere first to enable audio');
            return;
        }

        this.stopPlayback();
        this.isPlaying = true;
        this.playbackPosition = 0;
        this.playbackStartTime = this.audioManager.audioContext.currentTime;

        const isLooping = document.getElementById('loop-btn').classList.contains('active');

        // For looping mode, start continuous layers
        if (isLooping) {
            this.startLoopingPlayback();
        } else {
            // One-shot mode: schedule all layers
            this.effectData.layers.forEach((layer) => {
                this.scheduleLayer(layer, layer.delay);
            });
        }

        // Start playback animation
        this.updatePlayback();
    }

    startLoopingPlayback() {
        // Start continuous noise layers and crackle scheduler
        this.effectData.layers.forEach((layer) => {
            if (layer.custom && layer.audio.noise.enabled) {
                // Start as looping noise layer
                this.startLoopingNoiseLayer(layer);
            } else {
                // Schedule one-shot layers to repeat
                this.scheduleLayer(layer, layer.delay);
            }
        });

        // Set up loop interval to re-trigger one-shot layers
        const loopInterval = setInterval(() => {
            if (!this.isPlaying) {
                clearInterval(loopInterval);
                return;
            }
            this.effectData.layers.forEach((layer) => {
                if (!layer.custom || !layer.audio.noise.enabled) {
                    this.scheduleLayer(layer, layer.delay);
                }
            });
        }, this.effectData.duration * 1000);

        this.activeIntervals.push(loopInterval);
    }

    startLoopingNoiseLayer(layer) {
        const ctx = this.audioManager.audioContext;
        const audio = layer.audio;

        // Create looping noise source using AudioManager's method
        const noiseSource = this.audioManager.createNoiseSource(audio.noise.type);

        // Filter
        const filter = ctx.createBiquadFilter();
        filter.type = audio.filter.type;
        filter.frequency.value = audio.filter.frequency;
        filter.Q.value = audio.filter.Q;

        // Gain
        const gain = ctx.createGain();
        gain.gain.value = layer.volume * audio.noise.amount;

        // Panner
        const panner = ctx.createStereoPanner();
        panner.pan.value = layer.pan;

        // Connect
        noiseSource.connect(filter);
        filter.connect(gain);
        gain.connect(panner);
        panner.connect(this.masterGain);

        noiseSource.start();
        this.activeSources.push(noiseSource);
        this.loopingLayers.push({ source: noiseSource, gain, filter, panner });
    }

    scheduleLayer(layer, delay) {
        if (layer.custom) {
            this.playCustomSound(layer, delay);
        } else {
            this.playLibrarySound(layer, delay);
        }
    }

    playCustomSound(layer, delay) {
        const audio = layer.audio;

        // Build sound config for AudioManager
        const soundConfig = {
            waveform: audio.waveform,
            frequency: audio.frequency,
            duration: audio.duration,
            envelope: audio.envelope,
            noise: audio.noise.enabled ? {
                type: audio.noise.type,
                amount: audio.noise.amount
            } : null
        };

        const effectsConfig = {
            filter: audio.filter,
            pan: layer.pan
        };

        // Use AudioManager to play the synth sound
        const soundId = this.audioManager.playSynthSound(soundConfig, {
            volume: layer.volume,
            pitch: layer.pitchShift,
            delay: delay
        }, effectsConfig);

        if (soundId) {
            this.activeSources.push(soundId);
        }
    }

    playLibrarySound(layer, delay) {
        // For library sounds, play a simple synth placeholder
        // In full implementation, would load from sound library
        const soundConfig = {
            waveform: 'sine',
            frequency: 880,
            duration: 0.3,
            envelope: { attack: 0.01, decay: 0.1, sustain: 0.3, release: 0.1 }
        };

        const soundId = this.audioManager.playSynthSound(soundConfig, {
            volume: layer.volume,
            pitch: layer.pitchShift,
            delay: delay
        }, { pan: layer.pan });

        if (soundId) {
            this.activeSources.push(soundId);
        }
    }

    previewLayer(index) {
        if (!this.audioManager || !this.audioManager.isInitialized) {
            alert('Click anywhere first to enable audio');
            return;
        }

        const layer = this.effectData.layers[index];
        if (!layer) return;

        this.scheduleLayer(layer, 0);
    }

    stopPlayback() {
        this.isPlaying = false;

        // Stop all active intervals
        this.activeIntervals.forEach(interval => clearInterval(interval));
        this.activeIntervals = [];

        // Stop looping layers
        this.loopingLayers.forEach(layer => {
            try {
                layer.source.stop();
            } catch (e) {}
        });
        this.loopingLayers = [];

        // Clear active sources (AudioManager handles cleanup)
        this.activeSources = [];

        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        this.playbackPosition = 0;
        document.getElementById('playback-position').textContent = '0.00s';
    }

    toggleLoop() {
        // Toggle loop mode (visual indicator only for now)
        const btn = document.getElementById('loop-btn');
        btn.classList.toggle('active');
    }

    updatePlayback() {
        if (!this.isPlaying) return;

        this.playbackPosition = this.audioManager.audioContext.currentTime - this.playbackStartTime;
        document.getElementById('playback-position').textContent = `${this.playbackPosition.toFixed(2)}s`;

        const isLooping = document.getElementById('loop-btn').classList.contains('active');

        if (this.playbackPosition >= this.effectData.duration) {
            if (isLooping) {
                // Reset position for visual, playback continues via intervals
                this.playbackStartTime = this.audioManager.audioContext.currentTime;
            } else {
                this.stopPlayback();
                return;
            }
        }

        this.animationFrameId = requestAnimationFrame(() => this.updatePlayback());
    }

    // Export/Import
    exportEffect() {
        const data = JSON.stringify(this.effectData, null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const link = document.createElement('a');
        link.download = `${this.effectData.title.replace(/\s+/g, '_')}.json`;
        link.href = URL.createObjectURL(blob);
        link.click();
    }

    async importEffect(file) {
        if (!file) return;

        try {
            const text = await file.text();
            const data = JSON.parse(text);

            this.effectData = {
                title: data.title || 'Imported Effect',
                category: data.category || 'sfx',
                tags: data.tags || [],
                duration: data.duration || 2.0,
                layers: data.layers || []
            };

            // Update UI from data
            this.syncUIFromData();
            this.selectedLayerIndex = this.effectData.layers.length > 0 ? 0 : -1;
            this.renderTimeline();
            this.renderLayerEditor();

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
