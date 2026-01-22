class AudioManager {
    constructor(params = {}) {
        this.collections = params.collections || null;
        this.resourceBaseUrl = params.resourceBaseUrl || './resources/';
    }

    setCollections(collections) {
        this.collections = collections;
    }

    setResourceBaseUrl(url) {
        this.resourceBaseUrl = url;
    }

    getCollections() {
        return this.collections || {};
    }

    getResourceBaseUrl() {
        return this.resourceBaseUrl;
    }

    init() {
        this.isInitialized = false;
        this.bindInitialization();
    }

    bindInitialization() {
        const initHandler = () => {
            if (!this.isInitialized) {
                this.initialize();
            }
        };
        
        document.addEventListener('click', initHandler, { once: true });
        document.addEventListener('keydown', initHandler, { once: true });
    }

    async initialize() {
        class SoundPool {
            constructor(audioContext, destination, poolSize = 8) {
                this.audioContext = audioContext;
                this.destination = destination;
                this.poolSize = poolSize;
                this.sources = [];
                this.initializePool();
            }

            initializePool() {
                for (let i = 0; i < this.poolSize; i++) {
                    this.sources.push(this.createSource());
                }
            }

            createSource() {
                const source = {
                    active: false,
                    id: null,
                    envelopeGain: this.audioContext.createGain(),
                    gainNode: this.audioContext.createGain(),
                    filter: this.audioContext.createBiquadFilter(),
                    distortion: this.audioContext.createWaveShaper(),
                    compressor: this.audioContext.createDynamicsCompressor(),
                    pannerNode: this.audioContext.createStereoPanner(),
                    delay: this.audioContext.createDelay(5.0),
                    delayGain: this.audioContext.createGain(),
                    convolver: this.audioContext.createConvolver(),
                    reverbGain: this.audioContext.createGain(),
                    noiseFilter: this.audioContext.createBiquadFilter(),
                    noiseGain: this.audioContext.createGain(),
                    destination: this.destination
                };

                source.filter.type = 'lowpass';
                source.filter.frequency.setValueAtTime(20000, this.audioContext.currentTime);
                source.filter.Q.setValueAtTime(0.5, this.audioContext.currentTime);

                source.noiseFilter.type = 'lowpass';
                source.noiseFilter.frequency.setValueAtTime(2000, this.audioContext.currentTime);
                source.noiseFilter.Q.setValueAtTime(1, this.audioContext.currentTime);
                
                source.noiseGain.gain.setValueAtTime(0, this.audioContext.currentTime);

                source.distortion.curve = null;
                source.distortion.oversample = '4x';

                // Gentle limiting to prevent clipping, not for dynamics control
                source.compressor.threshold.setValueAtTime(-6, this.audioContext.currentTime);
                source.compressor.knee.setValueAtTime(10, this.audioContext.currentTime);
                source.compressor.ratio.setValueAtTime(4, this.audioContext.currentTime);
                source.compressor.attack.setValueAtTime(0.01, this.audioContext.currentTime);
                source.compressor.release.setValueAtTime(0.1, this.audioContext.currentTime);

                source.pannerNode.pan.setValueAtTime(0, this.audioContext.currentTime);

                source.delay.delayTime.setValueAtTime(0.3, this.audioContext.currentTime);
                source.delayGain.gain.setValueAtTime(0, this.audioContext.currentTime);

                source.reverbGain.gain.setValueAtTime(0, this.audioContext.currentTime);

                const chain = [
                    source.envelopeGain,
                    source.gainNode,
                    source.filter,
                    source.distortion,
                    source.compressor,
                    source.pannerNode
                ];

                for (let i = 0; i < chain.length - 1; i++) {
                    chain[i].connect(chain[i + 1]);
                }

                // Route delay and reverb after filter
                source.filter.connect(source.delay);
                source.delay.connect(source.delayGain);
                source.delayGain.connect(source.delay);
                source.delayGain.connect(source.pannerNode);

                source.filter.connect(source.convolver);
                source.convolver.connect(source.reverbGain);
                source.reverbGain.connect(source.pannerNode);

                source.pannerNode.connect(source.destination);

                return source;
            }

            getSource() {
                // First try to find an inactive source with some cooldown time
                let source = this.sources.find(src => !src.active && (!src.lastUsed || this.audioContext.currentTime - src.lastUsed > 0.1));
                // If none found, try any inactive source
                if (!source) {
                    source = this.sources.find(src => !src.active);
                }
                // If still none, expand the pool
                if (!source && this.sources.length < this.poolSize * 2) {
                    source = this.createSource();
                    this.sources.push(source);
                }
                if (source) {
                    source.active = true;
                    source.gainNode.gain.setValueAtTime(1, this.audioContext.currentTime);
                    source.envelopeGain.gain.setValueAtTime(0, this.audioContext.currentTime);
                    source.delayGain.gain.setValueAtTime(0, this.audioContext.currentTime);
                    source.reverbGain.gain.setValueAtTime(0, this.audioContext.currentTime);
                    source.noiseGain.gain.setValueAtTime(0, this.audioContext.currentTime);
                }
                return source;
            }

            releaseSource(source) {
                if (source) {
                    source.active = false;
                    source.id = null;
                    const now = this.audioContext.currentTime;
            
                    // Reset all nodes
                    source.filter.frequency.cancelScheduledValues(now);
                    source.filter.frequency.setValueAtTime(20000, now);
                    source.distortion.curve = null;
                    source.pannerNode.pan.setValueAtTime(0, now);
                    source.envelopeGain.gain.setValueAtTime(0, now);
                    source.gainNode.gain.setValueAtTime(1, now);
                    source.delayGain.gain.setValueAtTime(0, now);
                    source.reverbGain.gain.setValueAtTime(0, now);
                    source.noiseGain.gain.setValueAtTime(0, now);
            
                    // Disconnect and clear sources if they exist
                    if (source.source) {
                        try {
                            source.source.stop(now);
                            source.source.disconnect();
                        } catch (e) {
                            console.warn('Error stopping source:', e);
                        }
                        source.source = null;
                    }
                    
                    if (source.noiseSource) {
                        try {
                            source.noiseSource.stop(now);
                            source.noiseSource.disconnect();
                        } catch (e) {
                            console.warn('Error stopping noise source:', e);
                        }
                        source.noiseSource = null;
                    }
            
                    source.lastUsed = now;
                }
            }

            destroy() {
                this.sources.forEach(source => {
                    source.envelopeGain.disconnect();
                    source.gainNode.disconnect();
                    source.filter.disconnect();
                    source.distortion.disconnect();
                    source.compressor.disconnect();
                    source.pannerNode.disconnect();
                    source.delay.disconnect();
                    source.delayGain.disconnect();
                    source.convolver.disconnect();
                    source.reverbGain.disconnect();
                    source.noiseFilter.disconnect();
                    source.noiseGain.disconnect();
                });
                this.sources = [];
            }
        }
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.masterBus = this.createAudioBus('master');
        this.musicBus = this.createAudioBus('music');
        this.sfxBus = this.createAudioBus('sfx');
        this.ambientBus = this.createAudioBus('ambient', true); // Bypass compressor for ambient
        this.uiBus = this.createAudioBus('ui');
        this.musicBus.connect(this.masterBus);
        this.sfxBus.connect(this.masterBus);
        this.ambientBus.connect(this.masterBus);
        this.uiBus.connect(this.masterBus);
        this.masterBus.connect(this.audioContext.destination);
        this.soundPools = {
            sfx: new SoundPool(this.audioContext, this.sfxBus.input, 16),
            music: new SoundPool(this.audioContext, this.musicBus.input, 4),
            ui: new SoundPool(this.audioContext, this.uiBus.input, 6)
        };
        this.buffers = {};
        this.activeSounds = new Set();
        this.ambientSounds = new Map(); // Track looping ambient sounds by ID
        this.listenerPosition = { x: 0, y: 0, z: 0 };
        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }
        this.isInitialized = true;

        // Apply saved volume settings from localStorage
        this.loadAndApplySavedVolumeSettings();
    }

    /**
     * Load volume settings from localStorage and apply them to buses
     */
    loadAndApplySavedVolumeSettings() {
        try {
            const saved = localStorage.getItem('audioSettings');
            if (saved) {
                const settings = JSON.parse(saved);
                // Settings are stored as 0-100, convert to 0-1
                if (this.masterBus) this.masterBus.setVolume((settings.master ?? 100) / 100);
                if (this.musicBus) this.musicBus.setVolume((settings.music ?? 25) / 100);
                if (this.sfxBus) this.sfxBus.setVolume((settings.sfx ?? 100) / 100);
                if (this.ambientBus) this.ambientBus.setVolume((settings.sfx ?? 100) / 100);
                if (this.uiBus) this.uiBus.setVolume((settings.sfx ?? 100) / 100);
                console.log('[AudioManager] Applied saved volume settings:', settings);
            } else {
                // Apply defaults if no saved settings
                if (this.masterBus) this.masterBus.setVolume(1);
                if (this.musicBus) this.musicBus.setVolume(0.25);
                if (this.sfxBus) this.sfxBus.setVolume(1);
                if (this.ambientBus) this.ambientBus.setVolume(1);
                if (this.uiBus) this.uiBus.setVolume(1);
                console.log('[AudioManager] Applied default volume settings');
            }
        } catch (e) {
            console.warn('[AudioManager] Failed to load volume settings:', e);
        }
    }

    createAudioBus(name, bypassCompressor = false) {
        const bus = {
            name,
            input: this.audioContext.createGain(),
            compressor: this.audioContext.createDynamicsCompressor(),
            output: this.audioContext.createGain()
        };

        if (bypassCompressor) {
            // Direct connection for buses that don't need dynamics processing (e.g., ambient)
            bus.input.connect(bus.output);
        } else {
            // Configure bus compressor as a gentle limiter only (prevents clipping)
            // High threshold means it only kicks in to prevent distortion
            const now = this.audioContext.currentTime;
            bus.compressor.threshold.setValueAtTime(-3, now);
            bus.compressor.knee.setValueAtTime(6, now);
            bus.compressor.ratio.setValueAtTime(8, now);
            bus.compressor.attack.setValueAtTime(0.001, now);
            bus.compressor.release.setValueAtTime(0.05, now);

            bus.input.connect(bus.compressor);
            bus.compressor.connect(bus.output);
        }
        
        bus.connect = (destination) => {
            bus.output.connect(destination.input || destination);
        };
        
        bus.setVolume = (value) => {
            const now = this.audioContext.currentTime;
            bus.output.gain.cancelScheduledValues(now);
            bus.output.gain.setTargetAtTime(
                value <= 0 ? 0.000001 : value,
                now,
                0.02
            );
        };
        
        return bus;
    }

    getSynthSound(soundCollectionName, soundName) {
        const collections = this.getCollections();
        if (collections[soundCollectionName]?.[soundName]) {
            return collections[soundCollectionName][soundName].audio;
        }
        console.warn('sound not found', soundCollectionName, soundName);
        return null;
    }

    playSound(soundCollectionName, soundName) {
        let data = this.getSynthSound(soundCollectionName, soundName);
        if (data) {
            this.playSynthSound(`${soundCollectionName}_${soundName}`, data);
        }
    }

    async playSynthSound(soundId, soundConfig, options = {}) {
        if (!this.isInitialized) {
            await this.initialize();
        }

        const category = options.category || 'sfx';
        const pool = this.soundPools[category];

        if (!pool) {
            console.warn(`No sound pool for category ${category}`);
            return null;
        }

        let instanceCount = 0;
        this.activeSounds.forEach(sound => {
            if (sound.id === soundId) instanceCount++;
        });

        if (instanceCount >= (options.maxInstances || 3)) {
            console.warn(`Max instances reached for sound ${soundId}`);
            return null;
        }

        const sound = pool.getSource();
        if (!sound) {
            console.warn(`No available source for sound ${soundId}`);
            return null;
        }

        sound.id = soundId;
        sound.category = category;

        const duration = soundConfig.duration || 1;
        const masterVolume = soundConfig.volume !== undefined ? soundConfig.volume : 1;
        const layers = soundConfig.layers || [];
        const now = this.audioContext.currentTime;

        // Store layer sources for cleanup
        sound.layerSources = [];

        // Create a mixer gain for all layers before the envelope
        const layerMixer = this.audioContext.createGain();
        layerMixer.gain.setValueAtTime(masterVolume, now);
        layerMixer.connect(sound.envelopeGain);

        // Process each layer
        layers.forEach((layer, index) => {
            const layerGain = this.audioContext.createGain();
            layerGain.gain.setValueAtTime(layer.volume !== undefined ? layer.volume : 1, now);

            // Create source based on layer.source type
            const isNoise = ['white', 'pink', 'brown'].includes(layer.source);
            let source;

            if (isNoise) {
                source = this.createNoiseSource(layer.source);
            } else {
                source = this.audioContext.createOscillator();
                source.type = layer.source || 'sine';
                const baseFreq = layer.frequency || 440;
                source.frequency.setValueAtTime(baseFreq, now);

                // Apply pitch envelope if defined
                if (layer.pitchEnvelope) {
                    const startFreq = baseFreq * (layer.pitchEnvelope.start || 1);
                    const endFreq = baseFreq * (layer.pitchEnvelope.end || 1);
                    const envTime = layer.pitchEnvelope.time || duration;
                    source.frequency.setValueAtTime(startFreq, now);
                    source.frequency.exponentialRampToValueAtTime(Math.max(endFreq, 0.01), now + envTime);
                }
            }

            // Apply per-layer filter if defined
            if (layer.filter) {
                const filter = this.audioContext.createBiquadFilter();
                filter.type = layer.filter.type || 'lowpass';
                filter.frequency.setValueAtTime(layer.filter.frequency || 1000, now);
                filter.Q.setValueAtTime(layer.filter.Q || 1, now);
                source.connect(filter);
                filter.connect(layerGain);
            } else {
                source.connect(layerGain);
            }

            // Apply per-layer envelope if defined, otherwise connect directly
            if (layer.envelope) {
                const layerEnvGain = this.audioContext.createGain();
                this.createEnvelopeFromConfig(layer.envelope, layerEnvGain, duration);
                layerGain.connect(layerEnvGain);
                layerEnvGain.connect(layerMixer);
            } else {
                layerGain.connect(layerMixer);
            }

            sound.layerSources.push(source);

            // Use first layer as main source for onended callback
            if (index === 0) {
                sound.source = source;
            }
        });

        // If no per-layer envelopes, apply a default envelope to the mixer
        // Otherwise, set envelopeGain to 1 so per-layer envelopes pass through
        const hasLayerEnvelopes = layers.some(l => l.envelope);
        if (!hasLayerEnvelopes) {
            const defaultEnvelope = { attack: 0.01, decay: 0.1, sustain: 0.7, release: 0.3 };
            this.createEnvelopeFromConfig(defaultEnvelope, sound.envelopeGain, duration);
        } else {
            sound.envelopeGain.gain.setValueAtTime(1, now);
        }

        // Apply master effects
        if (soundConfig.effects) {
            this.applySynthEffects(sound, soundConfig.effects, soundConfig);
        }

        this.configureSoundInstance(sound, options);

        // Start all layer sources
        sound.layerSources.forEach(source => source.start(now));

        // Calculate total duration including release
        const maxRelease = Math.max(...layers.map(l => l.envelope?.release || 0.3), 0.3);
        let totalDuration = duration + maxRelease;

        if (soundConfig.effects?.delay?.time) {
            const delayTail = soundConfig.effects.delay.time * 3;
            if (totalDuration < delayTail) {
                totalDuration = delayTail;
            }
        }

        // Stop all layer sources
        sound.layerSources.forEach(source => source.stop(now + totalDuration + 0.02));

        this.activeSounds.add(sound);

        // Cleanup on end
        if (sound.source) {
            sound.source.onended = () => {
                setTimeout(() => {
                    sound.active = false;
                    this.activeSounds.delete(sound);
                    pool.releaseSource(sound);
                }, (soundConfig.effects?.delay?.time || 0) * 1000 * 3);
            };
        }

        return sound;
    }

    createSynthSource(config) {
        // Default to oscillator unless waveform is 'noise'
        const oscillator = config.waveform === 'noise'
            ? this.createNoiseSource('white') 
            : this.audioContext.createOscillator();
    
        if (config.waveform !== 'noise') {
            oscillator.type = config.waveform || 'sine';
            const baseFreq = config.frequency || 440;
            const now = this.audioContext.currentTime;
    
            // Initialize frequency
            oscillator.frequency.cancelScheduledValues(now);
            oscillator.frequency.setValueAtTime(baseFreq, now);
    
            // Apply pitch envelope if defined
            if (config.pitchEnvelope) {
                const startMultiplier = config.pitchEnvelope.start ?? 1;
                const endMultiplier = config.pitchEnvelope.end ?? 1;
                const envelopeTime = config.pitchEnvelope.time ?? config.duration ?? 1;
    
                if (startMultiplier !== 1 || endMultiplier !== 1) {
                    const startFreq = baseFreq * startMultiplier;
                    const endFreq = baseFreq * endMultiplier;
    
                    oscillator.frequency.setValueAtTime(startFreq, now);
                    oscillator.frequency.exponentialRampToValueAtTime(
                        Math.max(endFreq, 0.01),
                        now + envelopeTime
                    );
                }
            }
        }
    
        return oscillator;
    }

    applyNoiseToSound(sound, noiseConfig) {
        if (!noiseConfig || noiseConfig.amount <= 0) return;

        const noiseType = noiseConfig.type || 'white';
        const noiseAmount = Math.min(1, Math.max(0, noiseConfig.amount));
        
        // Create the noise source
        sound.noiseSource = this.createNoiseSource(noiseType);
        
        // Configure noise filter if specified
        if (noiseConfig.filter && noiseConfig.filter.type !== 'none') {
            sound.noiseFilter.type = noiseConfig.filter.type || 'lowpass';
            sound.noiseFilter.frequency.setValueAtTime(
                noiseConfig.filter.frequency || 2000, 
                this.audioContext.currentTime
            );
        }
        
        // Set noise gain based on the amount
        sound.noiseGain.gain.setValueAtTime(noiseAmount, this.audioContext.currentTime);
        
        // Connect noise through the filter and envelope
        sound.noiseSource.connect(sound.noiseFilter);
        sound.noiseFilter.connect(sound.noiseGain);
        sound.noiseGain.connect(sound.envelopeGain);
    }

    createNoiseSource(noiseType = 'white') {
        const bufferSize = this.audioContext.sampleRate * 2;
        const noiseBuffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
        const output = noiseBuffer.getChannelData(0);
        
        // Generate different types of noise
        switch (noiseType) {
            case 'pink':
                this.generatePinkNoise(output);
                break;
            case 'brown':
                this.generateBrownNoise(output);
                break;
            case 'white':
            default:
                this.generateWhiteNoise(output);
                break;
        }
        
        const source = this.audioContext.createBufferSource();
        source.buffer = noiseBuffer;
        source.loop = true;
        
        return source;
    }

    generateWhiteNoise(output) {
        for (let i = 0; i < output.length; i++) {
            output[i] = Math.random() * 2 - 1;
        }
    }

    generatePinkNoise(output) {
        // Pink noise algorithm (approximation using Paul Kellet's method)
        let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
        
        for (let i = 0; i < output.length; i++) {
            const white = Math.random() * 2 - 1;
            
            // Filter white noise to create pink noise
            b0 = 0.99886 * b0 + white * 0.0555179;
            b1 = 0.99332 * b1 + white * 0.0750759;
            b2 = 0.96900 * b2 + white * 0.1538520;
            b3 = 0.86650 * b3 + white * 0.3104856;
            b4 = 0.55000 * b4 + white * 0.5329522;
            b5 = -0.7616 * b5 - white * 0.0168980;
            
            output[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
            b6 = white * 0.115926;
        }
    }

    generateBrownNoise(output) {
        // Brown noise algorithm (random walk)
        let lastValue = 0;
        
        for (let i = 0; i < output.length; i++) {
            // Small random change from previous value
            const white = Math.random() * 2 - 1;
            lastValue = (lastValue + (0.02 * white)) / 1.02;
            
            // Keep within range
            output[i] = lastValue * 3.5; // Amplify to make it audible
        }
        
        // Normalize to prevent clipping
        const max = Math.max(...Array.from(output).map(Math.abs));
        if (max > 0) {
            for (let i = 0; i < output.length; i++) {
                output[i] /= max;
            }
        }
    }

    createEnvelopeFromConfig(envelope, gainNode, duration = 1) {
        if (!envelope) {
            console.warn('No envelope provided, using default');
            envelope = { attack: 0.01, decay: 0.1, sustain: 0.7, release: 0.3 };
        }
        
        const now = this.audioContext.currentTime;
        
        const attack = Math.max(0.01, envelope.attack || 0.01);
        const decay = Math.max(0, envelope.decay || 0.1);
        const sustain = Math.max(0, Math.min(1, envelope.sustain || 0.7));
        const release = Math.max(0.02, envelope.release || 0.3);
        
        gainNode.gain.cancelScheduledValues(now);
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(1, now + attack);
        gainNode.gain.linearRampToValueAtTime(sustain, now + attack + decay);
        gainNode.gain.setValueAtTime(sustain, now + duration);
        gainNode.gain.setTargetAtTime(0.0001, now + duration, release / 3);
        gainNode.gain.setValueAtTime(0, now + duration + release); // Absolute zero
    }

    applySynthEffects(sound, effectsConfig, soundConfig) {
        const now = this.audioContext.currentTime;
        
        // Filter
        if (effectsConfig.filter) {
            sound.filter.type = effectsConfig.filter.type || 'lowpass';
            sound.filter.frequency.setValueAtTime(effectsConfig.filter.frequency || 20000, now);
            sound.filter.Q.setValueAtTime(effectsConfig.filter.Q || 0.5, now);
            
            // Apply pitch envelope to filter for noise waveforms
            if (sound.source.buffer && soundConfig.pitchEnvelope && (soundConfig.pitchEnvelope.start !== 1 || soundConfig.pitchEnvelope.end !== 1)) {
                const baseFreq = soundConfig.frequency || 100;
                const startFreq = baseFreq * (soundConfig.pitchEnvelope.start + 1);
                const endFreq = baseFreq * soundConfig.pitchEnvelope.end;
                const duration = soundConfig.pitchEnvelope.time || soundConfig.duration || 1;
                
                sound.filter.frequency.cancelScheduledValues(now);
                sound.filter.frequency.setValueAtTime(startFreq, now);
                sound.filter.frequency.exponentialRampToValueAtTime(
                    Math.max(endFreq, 0.01),
                    now + duration
                );
                sound.filter.frequency.exponentialRampToValueAtTime(
                    Math.max(endFreq * 0.5, 0.01),
                    now + soundConfig.duration + (soundConfig.envelope?.release || 0.3)
                );
            }
        }
        
        // Distortion
        if (effectsConfig.distortion && effectsConfig.distortion > 0) {
            sound.distortion.curve = this.makeDistortionCurve(effectsConfig.distortion);
        } else {
            sound.distortion.curve = null;
        }
        
        // Delay
        if (effectsConfig.delay && effectsConfig.delay.feedback > 0) {
            sound.delay.delayTime.setValueAtTime(effectsConfig.delay.time || 0.3, now);
            sound.delayGain.gain.setValueAtTime(Math.min(effectsConfig.delay.feedback || 0, 0.8), now);
            sound.delayGain.gain.setTargetAtTime(0, now + soundConfig.duration + (soundConfig.envelope?.release || 0.3), 0.1);
        } else {
            sound.delayGain.gain.setValueAtTime(0, now);
        }
        
        // Reverb
        if (effectsConfig.reverb && effectsConfig.reverb > 0) {
            this.generateImpulseResponse(sound.convolver);
            sound.reverbGain.gain.setValueAtTime(Math.min(effectsConfig.reverb, 1), now);
            sound.reverbGain.gain.setTargetAtTime(0, now + soundConfig.duration + (soundConfig.envelope?.release || 0.3), 0.2);
        } else {
            sound.reverbGain.gain.setValueAtTime(0, now);
        }
        
        // Panning
        if (effectsConfig.pan !== undefined) {
            sound.pannerNode.pan.setValueAtTime(Math.max(-1, Math.min(1, effectsConfig.pan)), now);
        }
    }

    configureSoundInstance(sound, options) {
        const now = this.audioContext.currentTime;

        if (options.volume !== undefined) {
            sound.gainNode.gain.cancelScheduledValues(now);
            // Use setValueAtTime for immediate volume setting (important for short sounds)
            sound.gainNode.gain.setValueAtTime(
                options.volume <= 0 ? 0.000001 : Math.max(0, Math.min(options.volume, 1)),
                now
            );
        }
        
        if (options.position && sound.pannerNode.positionX) {
            const pos = options.position;
            sound.pannerNode.positionX.setValueAtTime(pos.x || 0, now);
            sound.pannerNode.positionY.setValueAtTime(pos.y || 0, now);
            sound.pannerNode.positionZ.setValueAtTime(pos.z || 0, now);
        }
        
        if (options.pitch && sound.source && sound.source.playbackRate) {
            sound.source.playbackRate.setValueAtTime(options.pitch, now);
        }
    }

    generateImpulseResponse(convolver) {
        const length = this.audioContext.sampleRate * 1.5; // Shorter impulse
        const impulse = this.audioContext.createBuffer(2, length, this.audioContext.sampleRate);
        
        for (let channel = 0; channel < 2; channel++) {
            const impulseData = impulse.getChannelData(channel);
            for (let i = 0; i < length; i++) {
                const decay = Math.pow(1 - i / length, 2);
                impulseData[i] = (Math.random() * 2 - 1) * decay;
            }
        }
        
        convolver.buffer = impulse;
    }

    makeDistortionCurve(amount) {
        const k = Math.max(amount, 0) * 10;
        const n_samples = 44100;
        const curve = new Float32Array(n_samples);
        const deg = Math.PI / 180;
        for (let i = 0; i < n_samples; i++) {
            const x = (i * 2) / n_samples - 1;
            curve[i] = (3 + k) * x * 20 * deg / (Math.PI + k * Math.abs(x));
        }
        return curve;
    }

    stopSound(sound) {
        if (!sound) return;
        
        const now = this.audioContext.currentTime;
        
        if (sound.gainNode) {
            sound.gainNode.gain.cancelScheduledValues(now);
            sound.gainNode.gain.setValueAtTime(sound.gainNode.gain.value || 0, now);
            sound.gainNode.gain.linearRampToValueAtTime(0, now + 0.05);
        }
        
        if (sound.source) {
            try {
                sound.source.stop(now + 0.06);
            } catch (e) {
                console.warn('Error stopping source:', e);
            }
        }
        
        if (sound.noiseSource) {
            try {
                sound.noiseSource.stop(now + 0.06);
            } catch (e) {
                console.warn('Error stopping noise source:', e);
            }
        }
        
        sound.active = false;
        this.activeSounds.delete(sound);
    }

    stopAllSounds() {
        this.activeSounds.forEach(sound => {
            this.stopSound(sound);
        });
        this.activeSounds.clear();
    }

    // ========== AMBIENT SOUND METHODS ==========

    /**
     * Set the listener position for distance-based volume calculations
     * @param {Object} position - { x, y, z } world position
     */
    setListenerPosition(position) {
        this.listenerPosition = position || { x: 0, y: 0, z: 0 };
        // Update all ambient sounds' volumes based on new listener position
        this.updateAmbientVolumes();
    }

    /**
     * Start a looping ambient sound at a world position
     * Uses the unified layers format
     * @param {string} ambientId - Unique ID for this ambient sound instance
     * @param {Object} soundDefinition - The full sound definition from collection (includes audio and ambient properties)
     * @param {Object} position - { x, y, z } world position of the sound source
     * @returns {Object|null} The ambient sound instance or null if failed
     */
    async startAmbientSound(ambientId, soundDefinition, position) {
        if (!this.isInitialized) {
            await this.initialize();
        }

        // Stop existing ambient sound with this ID if any
        if (this.ambientSounds.has(ambientId)) {
            this.stopAmbientSound(ambientId);
        }

        const audioConfig = soundDefinition.audio;
        const ambientConfig = soundDefinition.ambient || {};

        if (!audioConfig || !audioConfig.layers) {
            console.warn(`[AudioManager] No audio config or layers for ambient sound: ${ambientId}`);
            return null;
        }

        // Master gain for distance-based volume
        const masterGain = this.audioContext.createGain();
        masterGain.connect(this.ambientBus.input);

        // Calculate initial volume
        const baseVolume = ambientConfig.volume || 0.5;
        const distance = this.calculateDistance(position, this.listenerPosition);
        const volume = this.calculateDistanceVolume(distance, ambientConfig, baseVolume);
        masterGain.gain.value = volume;

        // Store all sources for cleanup
        const sources = [];
        const gainNodes = [];
        const filterNodes = [];

        // Process each layer
        audioConfig.layers.forEach(layer => {
            const layerGain = this.audioContext.createGain();
            layerGain.gain.value = layer.volume !== undefined ? layer.volume : 1;

            // Create noise source based on layer.source
            const noiseSource = this.createNoiseSource(layer.source);

            // Apply filter if defined
            if (layer.filter) {
                const filter = this.audioContext.createBiquadFilter();
                filter.type = layer.filter.type || 'lowpass';
                filter.frequency.value = layer.filter.frequency || 1000;
                filter.Q.value = layer.filter.Q || 1;
                noiseSource.connect(filter);
                filter.connect(layerGain);
                filterNodes.push(filter);
            } else {
                noiseSource.connect(layerGain);
            }

            layerGain.connect(masterGain);
            noiseSource.start();

            sources.push(noiseSource);
            gainNodes.push(layerGain);
        });

        // Process events (scheduled one-shot sounds)
        let eventIntervals = [];
        if (audioConfig.events) {
            audioConfig.events.forEach(event => {
                if (event.sound) {
                    const interval = this.startEventScheduler(masterGain, event);
                    eventIntervals.push(interval);
                }
            });
        }

        // Store the ambient sound with all components
        const ambient = {
            id: ambientId,
            sources: sources,
            gainNodes: gainNodes,
            filterNodes: filterNodes,
            gainNode: masterGain,
            eventIntervals: eventIntervals,
            position: { ...position },
            config: ambientConfig,
            baseVolume: baseVolume,
            active: true
        };

        this.ambientSounds.set(ambientId, ambient);
        return ambient;
    }

    /**
     * Schedule random event sounds (crackles, pops, etc.)
     * Uses the sound definition from the event config
     */
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

            // Schedule next event at random interval
            const nextInterval = minInterval + Math.random() * (maxInterval - minInterval);
            return setTimeout(scheduleEvent, nextInterval);
        };

        return scheduleEvent();
    }

    /**
     * Play a one-shot sound from an event definition, connecting to a destination node
     * Supports randomization of parameters defined in the sound config
     */
    playEventSound(destination, soundDef) {
        if (!this.audioContext) return;

        const now = this.audioContext.currentTime;

        // Clone the sound definition to apply randomization
        const config = JSON.parse(JSON.stringify(soundDef));
        const randomize = config.randomize || {};

        // Apply volume randomization
        if (randomize.volume) {
            const range = randomize.volume;
            config.volume *= range.min + Math.random() * (range.max - range.min);
        }

        // Apply filter frequency randomization to layers
        if (randomize.filterFrequency && config.layers) {
            config.layers.forEach(layer => {
                if (layer.filter) {
                    const range = randomize.filterFrequency;
                    layer.filter.frequency = range.min + Math.random() * (range.max - range.min);
                }
            });
        }

        // Apply pitch/frequency randomization to layers
        if (randomize.frequency && config.layers) {
            config.layers.forEach(layer => {
                if (layer.frequency !== undefined) {
                    const range = randomize.frequency;
                    layer.frequency *= range.min + Math.random() * (range.max - range.min);
                }
            });
        }

        // Create the sound using the unified layer system
        const duration = config.duration || 0.05;
        const masterVolume = config.volume !== undefined ? config.volume : 1;
        const layers = config.layers || [];

        // Master gain for this event sound
        const masterGain = this.audioContext.createGain();
        masterGain.gain.value = masterVolume;
        masterGain.connect(destination);

        // Process each layer
        layers.forEach(layer => {
            const source = layer.source || 'white';
            const layerVolume = layer.volume !== undefined ? layer.volume : 1;
            const envelope = layer.envelope || { attack: 0.001, decay: 0.01, sustain: 0, release: 0.01 };

            // Create gain node for this layer
            const layerGain = this.audioContext.createGain();
            layerGain.gain.value = 0;

            // Create source (noise or oscillator)
            let sourceNode;
            if (['white', 'pink', 'brown'].includes(source)) {
                sourceNode = this.createNoiseSource(source);
            } else {
                sourceNode = this.audioContext.createOscillator();
                sourceNode.type = source;
                sourceNode.frequency.value = layer.frequency || 440;
            }

            // Apply filter if defined
            let outputNode = sourceNode;
            if (layer.filter) {
                const filter = this.audioContext.createBiquadFilter();
                filter.type = layer.filter.type || 'lowpass';
                filter.frequency.value = layer.filter.frequency || 1000;
                filter.Q.value = layer.filter.Q || 1;
                sourceNode.connect(filter);
                outputNode = filter;
            }

            outputNode.connect(layerGain);
            layerGain.connect(masterGain);

            // Apply ADSR envelope
            const attackEnd = now + envelope.attack;
            const decayEnd = attackEnd + envelope.decay;
            const releaseStart = now + duration - envelope.release;
            const releaseEnd = now + duration;

            layerGain.gain.setValueAtTime(0, now);
            layerGain.gain.linearRampToValueAtTime(layerVolume, attackEnd);
            layerGain.gain.linearRampToValueAtTime(layerVolume * envelope.sustain, decayEnd);
            layerGain.gain.setValueAtTime(layerVolume * envelope.sustain, releaseStart);
            layerGain.gain.linearRampToValueAtTime(0, releaseEnd);

            // Start and stop the source
            sourceNode.start(now);
            sourceNode.stop(now + duration + 0.01);
        });
    }

    /**
     * Stop an ambient sound
     * @param {string} ambientId - The ID of the ambient sound to stop
     */
    stopAmbientSound(ambientId) {
        const ambient = this.ambientSounds.get(ambientId);
        if (!ambient) return;

        const now = this.audioContext.currentTime;

        // Fade out
        ambient.gainNode.gain.cancelScheduledValues(now);
        ambient.gainNode.gain.setValueAtTime(ambient.gainNode.gain.value, now);
        ambient.gainNode.gain.linearRampToValueAtTime(0, now + 0.3);

        // Clear event intervals (crackle schedulers, etc.)
        if (ambient.eventIntervals) {
            ambient.eventIntervals.forEach(interval => clearTimeout(interval));
        }

        // Stop source(s) after fade
        setTimeout(() => {
            try {
                // Stop all layer sources
                ambient.sources?.forEach(source => {
                    try {
                        source.stop();
                        source.disconnect();
                    } catch (e) {}
                });
                ambient.filterNodes?.forEach(filter => {
                    try { filter.disconnect(); } catch (e) {}
                });
                ambient.gainNodes?.forEach(gain => {
                    try { gain.disconnect(); } catch (e) {}
                });
                ambient.gainNode.disconnect();
            } catch (e) {
                // Source may already be stopped
            }
        }, 350);

        ambient.active = false;
        this.ambientSounds.delete(ambientId);
    }

    /**
     * Stop all ambient sounds
     */
    stopAllAmbientSounds() {
        for (const [id] of this.ambientSounds) {
            this.stopAmbientSound(id);
        }
    }

    /**
     * Update the position of an ambient sound source
     * @param {string} ambientId - The ID of the ambient sound
     * @param {Object} position - { x, y, z } new world position
     */
    updateAmbientPosition(ambientId, position) {
        const ambient = this.ambientSounds.get(ambientId);
        if (!ambient) return;

        ambient.position = { ...position };

        // Recalculate volume based on new position
        const distance = this.calculateDistance(position, this.listenerPosition);
        const volume = this.calculateDistanceVolume(distance, ambient.config, ambient.baseVolume);

        const now = this.audioContext.currentTime;
        ambient.gainNode.gain.setTargetAtTime(volume, now, 0.1);
    }

    /**
     * Update all ambient sound volumes based on current listener position
     */
    updateAmbientVolumes() {
        const now = this.audioContext.currentTime;

        for (const [id, ambient] of this.ambientSounds) {
            if (!ambient.active) continue;

            const distance = this.calculateDistance(ambient.position, this.listenerPosition);
            const volume = this.calculateDistanceVolume(distance, ambient.config, ambient.baseVolume);

            ambient.gainNode.gain.setTargetAtTime(volume, now, 0.1);
        }
    }

    /**
     * Calculate distance between two 3D points
     */
    calculateDistance(pos1, pos2) {
        const dx = (pos1.x || 0) - (pos2.x || 0);
        const dy = (pos1.y || 0) - (pos2.y || 0);
        const dz = (pos1.z || 0) - (pos2.z || 0);
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    /**
     * Calculate volume based on distance using rolloff model
     * Uses an inverse distance model similar to Web Audio API's PannerNode
     */
    calculateDistanceVolume(distance, config, baseVolume) {
        const refDistance = config.refDistance || 50;
        const maxDistance = config.maxDistance || 300;
        const rolloffFactor = config.rolloffFactor || 1.5;

        // Clamp distance to maxDistance
        if (distance >= maxDistance) {
            return 0;
        }

        // For distances less than reference, use full volume
        if (distance <= refDistance) {
            return baseVolume;
        }

        // Inverse distance rolloff
        // volume = baseVolume * refDistance / (refDistance + rolloffFactor * (distance - refDistance))
        const attenuation = refDistance / (refDistance + rolloffFactor * (distance - refDistance));
        return baseVolume * Math.max(0, Math.min(1, attenuation));
    }

    /**
     * Get an ambient sound definition from collections
     */
    getAmbientSound(soundName) {
        const collections = this.getCollections();
        console.log('[AudioManager] getAmbientSound - collections keys:', Object.keys(collections || {}));
        console.log('[AudioManager] collections.ambientSounds:', collections?.ambientSounds);
        console.log('[AudioManager] Looking for:', soundName);
        if (collections.ambientSounds?.[soundName]) {
            console.log('[AudioManager] Found sound:', collections.ambientSounds[soundName]);
            return collections.ambientSounds[soundName];
        }
        console.warn(`[AudioManager] Ambient sound not found: ${soundName}`);
        return null;
    }

    // ========== MUSIC PLAYBACK METHODS ==========

    /**
     * Load an audio file and return the buffer
     * @param {string} url - URL to the audio file
     * @returns {Promise<AudioBuffer>} The decoded audio buffer
     */
    async loadAudioFile(url) {
        if (this.buffers[url]) {
            return this.buffers[url];
        }

        try {
            const response = await fetch(url);
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
            this.buffers[url] = audioBuffer;
            return audioBuffer;
        } catch (error) {
            console.error(`[AudioManager] Failed to load audio file: ${url}`, error);
            return null;
        }
    }

    /**
     * Play background music from an audio file (loops by default)
     * @param {string} soundName - Name of the sound in the sounds collection
     * @param {Object} options - Playback options
     * @param {number} options.volume - Volume (0-1), default 0.5
     * @param {boolean} options.loop - Whether to loop, default true
     * @param {number} options.fadeInTime - Fade in duration in seconds, default 1
     * @returns {Object|null} Music instance for control, or null if failed
     */
    async playMusic(soundName, options = {}) {
        if (!this.isInitialized) {
            await this.initialize();
        }

        // Stop any existing music
        this.stopMusic();

        // Get sound definition from collections
        const collections = this.getCollections();
        const soundDef = collections.sounds?.[soundName];

        // Support both formats: audio.filePath (new) and audioFile (legacy)
        const filePath = soundDef?.audio?.filePath || soundDef?.audioFile;
        if (!filePath) {
            console.warn(`[AudioManager] Sound '${soundName}' not found or has no audio.filePath`);
            return null;
        }

        // Build the full URL - filePath is relative to resources folder
        const baseUrl = this.getResourceBaseUrl();
        const url = baseUrl + filePath;

        try {
            const buffer = await this.loadAudioFile(url);
            if (!buffer) return null;

            // Use volume from sound definition, then options, then default
            const volume = soundDef?.audio?.volume ?? options.volume ?? 0.5;
            const loop = options.loop ?? true;
            const fadeInTime = options.fadeInTime ?? 1;

            // Create source and gain nodes
            const source = this.audioContext.createBufferSource();
            source.buffer = buffer;
            source.loop = loop;

            const gainNode = this.audioContext.createGain();
            gainNode.gain.setValueAtTime(0, this.audioContext.currentTime);

            // Connect: source -> gain -> musicBus
            source.connect(gainNode);
            gainNode.connect(this.musicBus.input);

            // Fade in
            gainNode.gain.linearRampToValueAtTime(volume, this.audioContext.currentTime + fadeInTime);

            // Start playback
            source.start(0);

            // Store reference for stopping
            this.currentMusic = {
                source,
                gainNode,
                soundName,
                volume
            };

            console.log(`[AudioManager] Playing music: ${soundName}`);
            return this.currentMusic;
        } catch (error) {
            console.error(`[AudioManager] Failed to play music: ${soundName}`, error);
            return null;
        }
    }

    /**
     * Stop the currently playing background music
     * @param {number} fadeOutTime - Fade out duration in seconds, default 1
     */
    stopMusic(fadeOutTime = 1) {
        if (!this.currentMusic) return;

        const { source, gainNode } = this.currentMusic;
        const now = this.audioContext.currentTime;

        // Fade out
        gainNode.gain.cancelScheduledValues(now);
        gainNode.gain.setValueAtTime(gainNode.gain.value, now);
        gainNode.gain.linearRampToValueAtTime(0, now + fadeOutTime);

        // Stop after fade
        setTimeout(() => {
            try {
                source.stop();
                source.disconnect();
                gainNode.disconnect();
            } catch (e) {
                // Source may already be stopped
            }
        }, fadeOutTime * 1000 + 100);

        console.log(`[AudioManager] Stopping music: ${this.currentMusic.soundName}`);
        this.currentMusic = null;
    }

    /**
     * Set music volume
     * @param {number} volume - Volume (0-1)
     */
    setMusicVolume(volume) {
        if (!this.currentMusic) return;

        const now = this.audioContext.currentTime;
        this.currentMusic.gainNode.gain.cancelScheduledValues(now);
        this.currentMusic.gainNode.gain.setTargetAtTime(
            Math.max(0, Math.min(1, volume)),
            now,
            0.1
        );
        this.currentMusic.volume = volume;
    }

    /**
     * Check if music is currently playing
     * @returns {boolean}
     */
    isMusicPlaying() {
        return this.currentMusic !== null;
    }
}