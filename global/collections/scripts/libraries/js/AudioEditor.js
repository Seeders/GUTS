/**
 * AudioEditor - Editor for synthesized audio effects
 *
 * Uses AudioManager for consistent sound playback across the engine.
 */
class AudioEditor {
    constructor(controller, moduleConfig, GUTS) {
        this.controller = controller;
        this.moduleConfig = moduleConfig;
        this.GUTS = GUTS;

        this.currentData = null;
        this.propertyName = null;
        this.objectData = null;

        // Create AudioManager for preview playback
        this.audioManager = new GUTS.AudioManager({}, null, {});
        this.audioManager.init();

        // Loading flag to prevent saves during UI updates
        this._isLoading = false;

        this.setupEventListeners();
    }

    setupEventListeners() {
        // Listen for load hook
        document.body.addEventListener(this.moduleConfig.loadHook, (event) => {
            this.loadAudio(event.detail);
        });

        // Listen for unload event
        document.body.addEventListener(this.moduleConfig.unloadHook, () => {
            this.handleUnload();
        });

        // Get container
        const container = document.getElementById(this.moduleConfig.container);
        if (!container) return;

        // Play button
        document.getElementById('playBtn')?.addEventListener('click', () => this.playSound());

        // Save button
        document.getElementById('exportBtn')?.addEventListener('click', () => this.saveCurrentData());

        // Randomize button
        document.getElementById('randomSoundBtn')?.addEventListener('click', () => {
            this.randomizeSound();
            this.playSound();
        });

        // Setup input listeners
        this.setupInputListeners();
    }

    setupInputListeners() {
        const inputIds = [
            'waveform', 'frequency', 'duration', 'volume',
            'noiseType', 'noiseAmount', 'noiseFilterType', 'noiseFilterFreq',
            'attack', 'decay', 'sustain', 'release',
            'pitchEnvStart', 'pitchEnvEnd',
            'filterType', 'filterFreq', 'filterQ',
            'distortion', 'delayTime', 'delayFeedback',
            'reverbAmount', 'bitcrusher', 'panning'
        ];

        inputIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                const eventType = el.tagName === 'SELECT' ? 'change' : 'input';
                el.addEventListener(eventType, () => this.onInputChange(id));
            }
        });
    }

    onInputChange(inputId) {
        if (this._isLoading) return;
        this.updateValueDisplay(inputId);
    }

    updateValueDisplay(inputId) {
        const el = document.getElementById(inputId);
        if (!el || el.tagName === 'SELECT') return;

        const label = el.closest('.editor-module__form-group')?.querySelector('.audio-editor__value-display');
        if (!label) return;

        const value = parseFloat(el.value);

        const formatters = {
            'frequency': v => `${Math.round(v)} Hz`,
            'duration': v => `${v.toFixed(2)} s`,
            'volume': v => `${Math.round(v * 100)}%`,
            'noiseAmount': v => `${Math.round(v * 100)}%`,
            'noiseFilterFreq': v => `${Math.round(v)} Hz`,
            'attack': v => `${v.toFixed(3)} s`,
            'decay': v => `${v.toFixed(2)} s`,
            'sustain': v => `${Math.round(v * 100)}%`,
            'release': v => `${v.toFixed(2)} s`,
            'pitchEnvStart': v => `${v.toFixed(2)}x`,
            'pitchEnvEnd': v => `${v.toFixed(2)}x`,
            'filterFreq': v => `${Math.round(v)} Hz`,
            'filterQ': v => `Q: ${v.toFixed(1)}`,
            'distortion': v => `${Math.round(v)}%`,
            'delayTime': v => `${v.toFixed(2)} s`,
            'delayFeedback': v => `${Math.round(v * 100)}%`,
            'reverbAmount': v => `${Math.round(v * 100)}%`,
            'bitcrusher': v => `${Math.round(v * 100)}%`,
            'panning': v => v === 0 ? 'Center' : (v < 0 ? `L ${Math.round(Math.abs(v) * 100)}%` : `R ${Math.round(v * 100)}%`)
        };

        if (formatters[inputId]) {
            label.textContent = formatters[inputId](value);
        }
    }

    loadAudio(detail) {
        this.propertyName = detail.propertyName;
        this.objectData = detail.objectData || this.controller?.getCurrentObject();
        this.currentData = detail.data || this.getDefaultAudioConfig();

        // Show the editor
        Object.values(document.getElementsByClassName('editor-module')).forEach((editor) => {
            editor.classList.remove('show');
        });
        document.getElementById(this.moduleConfig.container)?.classList.add('show');

        // Load data into UI
        this.loadDataIntoUI(this.currentData);

        this.updateStatus('Ready');
    }

    getDefaultAudioConfig() {
        return {
            waveform: 'sine',
            frequency: 440,
            duration: 1,
            volume: 0.7,
            envelope: {
                attack: 0.01,
                decay: 0.1,
                sustain: 0.7,
                release: 0.3
            }
        };
    }

    loadDataIntoUI(data) {
        this._isLoading = true;

        // Basic parameters
        this.setValue('waveform', data.waveform || 'sine');
        this.setValue('frequency', data.frequency || 440);
        this.setValue('duration', data.duration || 1);
        this.setValue('volume', data.volume !== undefined ? data.volume : 0.7);

        // Noise
        const noise = data.noise || {};
        this.setValue('noiseType', noise.type || 'white');
        this.setValue('noiseAmount', noise.amount || 0);
        this.setValue('noiseFilterType', noise.filter?.type || 'none');
        this.setValue('noiseFilterFreq', noise.filter?.frequency || 2000);

        // Envelope (ADSR)
        const env = data.envelope || {};
        this.setValue('attack', env.attack || 0.01);
        this.setValue('decay', env.decay || 0.1);
        this.setValue('sustain', env.sustain !== undefined ? env.sustain : 0.7);
        this.setValue('release', env.release || 0.3);

        // Pitch envelope
        const pitch = data.pitchEnvelope || {};
        this.setValue('pitchEnvStart', pitch.start || 1);
        this.setValue('pitchEnvEnd', pitch.end || 1);

        // Effects
        const effects = data.effects || {};
        const filter = effects.filter || {};
        this.setValue('filterType', filter.type || 'lowpass');
        this.setValue('filterFreq', filter.frequency || 1000);
        this.setValue('filterQ', filter.Q || 1);
        this.setValue('distortion', effects.distortion || 0);

        const delay = effects.delay || {};
        this.setValue('delayTime', delay.time || 0.3);
        this.setValue('delayFeedback', delay.feedback || 0);

        this.setValue('reverbAmount', effects.reverb || 0);
        this.setValue('bitcrusher', effects.bitcrusher || 0);
        this.setValue('panning', effects.pan || 0);

        // Update all value displays
        const inputIds = [
            'frequency', 'duration', 'volume', 'noiseAmount', 'noiseFilterFreq',
            'attack', 'decay', 'sustain', 'release', 'pitchEnvStart', 'pitchEnvEnd',
            'filterFreq', 'filterQ', 'distortion', 'delayTime', 'delayFeedback',
            'reverbAmount', 'bitcrusher', 'panning'
        ];
        inputIds.forEach(id => this.updateValueDisplay(id));

        this._isLoading = false;
    }

    setValue(id, value) {
        const el = document.getElementById(id);
        if (el) el.value = value;
    }

    getValue(id) {
        const el = document.getElementById(id);
        if (!el) return null;
        if (el.tagName === 'SELECT') return el.value;
        return parseFloat(el.value);
    }

    getUISettings() {
        const waveform = this.getValue('waveform');
        const frequency = this.getValue('frequency');
        const duration = this.getValue('duration');
        const volume = this.getValue('volume');

        const settings = {
            waveform,
            frequency,
            duration,
            volume
        };

        // Noise
        const noiseAmount = this.getValue('noiseAmount');
        if (noiseAmount > 0) {
            settings.noise = {
                type: this.getValue('noiseType'),
                amount: noiseAmount
            };
            const noiseFilterType = this.getValue('noiseFilterType');
            if (noiseFilterType !== 'none') {
                settings.noise.filter = {
                    type: noiseFilterType,
                    frequency: this.getValue('noiseFilterFreq')
                };
            }
        }

        // Envelope
        settings.envelope = {
            attack: this.getValue('attack'),
            decay: this.getValue('decay'),
            sustain: this.getValue('sustain'),
            release: this.getValue('release')
        };

        // Pitch envelope
        const pitchStart = this.getValue('pitchEnvStart');
        const pitchEnd = this.getValue('pitchEnvEnd');
        if (pitchStart !== 1 || pitchEnd !== 1) {
            settings.pitchEnvelope = {
                start: pitchStart,
                end: pitchEnd,
                time: duration
            };
        }

        // Effects
        const effects = {};

        const filterFreq = this.getValue('filterFreq');
        if (filterFreq < 20000) {
            effects.filter = {
                type: this.getValue('filterType'),
                frequency: filterFreq,
                Q: this.getValue('filterQ')
            };
        }

        const distortion = this.getValue('distortion');
        if (distortion > 0) {
            effects.distortion = distortion;
        }

        const delayFeedback = this.getValue('delayFeedback');
        if (delayFeedback > 0) {
            effects.delay = {
                time: this.getValue('delayTime'),
                feedback: delayFeedback
            };
        }

        const reverb = this.getValue('reverbAmount');
        if (reverb > 0) {
            effects.reverb = reverb;
        }

        const bitcrusher = this.getValue('bitcrusher');
        if (bitcrusher > 0) {
            effects.bitcrusher = bitcrusher;
        }

        const pan = this.getValue('panning');
        if (pan !== 0) {
            effects.pan = pan;
        }

        if (Object.keys(effects).length > 0) {
            settings.effects = effects;
        }

        return settings;
    }

    saveCurrentData() {
        if (this._isLoading) return;

        const settings = this.getUISettings();

        const saveEvent = new CustomEvent(this.moduleConfig.saveHook, {
            detail: {
                data: JSON.stringify(settings),
                propertyName: this.propertyName
            }
        });
        document.body.dispatchEvent(saveEvent);

        this.updateStatus('Saved');
    }

    handleUnload() {
        this.currentData = null;
        this.propertyName = null;
        this.objectData = null;
    }

    updateStatus(message) {
        const statusEl = document.getElementById('status-message');
        if (statusEl) statusEl.textContent = message;
    }

    playSound() {
        const settings = this.getUISettings();
        this.audioManager.playSynthSound('audioEditorPreview', settings);
    }

    randomizeSound() {
        const waveforms = ['sine', 'square', 'sawtooth', 'triangle', 'noise'];
        const noiseTypes = ['white', 'pink', 'brown'];
        const filterTypes = ['lowpass', 'highpass', 'bandpass', 'notch'];

        const randomConfig = {
            waveform: waveforms[Math.floor(Math.random() * waveforms.length)],
            frequency: 50 + Math.random() * 1000,
            duration: 0.1 + Math.random() * 2,
            volume: 0.3 + Math.random() * 0.5,
            noise: {
                type: noiseTypes[Math.floor(Math.random() * noiseTypes.length)],
                amount: Math.random() * 0.5,
                filter: {
                    type: filterTypes[Math.floor(Math.random() * filterTypes.length)],
                    frequency: 100 + Math.random() * 5000
                }
            },
            envelope: {
                attack: 0.001 + Math.random() * 0.5,
                decay: Math.random() * 0.5,
                sustain: Math.random(),
                release: 0.01 + Math.random() * 1
            },
            pitchEnvelope: {
                start: 0.2 + Math.random() * 3,
                end: 0.2 + Math.random() * 3
            },
            effects: {
                filter: {
                    type: filterTypes[Math.floor(Math.random() * filterTypes.length)],
                    frequency: 100 + Math.random() * 5000,
                    Q: 0.5 + Math.random() * 10
                },
                distortion: Math.random() * 50,
                delay: {
                    time: Math.random() * 0.5,
                    feedback: Math.random() * 0.5
                },
                reverb: Math.random() * 0.5,
                bitcrusher: Math.random() * 0.3,
                pan: (Math.random() * 2 - 1) * 0.5
            }
        };

        this.currentData = randomConfig;
        this.loadDataIntoUI(randomConfig);
        this.updateStatus('Randomized');
    }
}
