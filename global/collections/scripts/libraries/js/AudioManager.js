class AudioManager {
    constructor(game, parent, params) {
        this.game = game;
        this.parent = parent;
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
        if (this.game.getCollections()[soundCollectionName]?.[soundName]) {
            return this.game.getCollections()[soundCollectionName][soundName].audio;
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

    playSynthSound(soundId, soundConfig, options = {}) {
        if (!this.isInitialized) {
            this.initialize();
            return this.playSynthSound(soundId, soundConfig, options);
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
        
        // Create main oscillator
        const oscillator = this.createSynthSource(soundConfig);
        sound.source = oscillator;
        oscillator.connect(sound.envelopeGain);
        
        // Add noise generator if configured
        if (soundConfig.noise && soundConfig.noise.amount > 0) {
            this.applyNoiseToSound(sound, soundConfig.noise);
        }
        
        this.createEnvelopeFromConfig(soundConfig.envelope, sound.envelopeGain, soundConfig.duration);
        
        if (soundConfig.effects) {
            this.applySynthEffects(sound, soundConfig.effects, soundConfig);
        } 
        
        this.configureSoundInstance(sound, options);
        
        const now = this.audioContext.currentTime;
        oscillator.start(now);
        
        // Start noise generator if it exists
        if (sound.noiseSource) {
            sound.noiseSource.start(now);
        }
        
        const duration = soundConfig.duration || 1;
        const release = (soundConfig.envelope?.release) || 0.3;
        let totalDuration = duration + release;
        
        if (soundConfig.effects?.delay?.time) {
            const delayTail = soundConfig.effects.delay.time * 3;
            if (totalDuration < delayTail) {
                totalDuration = delayTail;
            }
        }
        
        oscillator.stop(now + totalDuration + 0.02);
        if (sound.noiseSource) {
            sound.noiseSource.stop(now + totalDuration + 0.02);
        }
        
        this.activeSounds.add(sound);
        
        oscillator.onended = () => {
            setTimeout(() => {
                sound.active = false;
                this.activeSounds.delete(sound);
                pool.releaseSource(sound);
            }, (soundConfig.effects?.delay?.time || 0) * 1000 * 3);
        };
        
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
     * @param {string} ambientId - Unique ID for this ambient sound instance
     * @param {Object} soundDefinition - The full sound definition from collection (includes audio and ambient properties)
     * @param {Object} position - { x, y, z } world position of the sound source
     * @returns {Object|null} The ambient sound instance or null if failed
     */
    startAmbientSound(ambientId, soundDefinition, position) {
        console.log('[AudioManager] startAmbientSound called:', ambientId, soundDefinition, position);
        console.log('[AudioManager] isInitialized:', this.isInitialized);

        if (!this.isInitialized) {
            console.log('[AudioManager] Not initialized, calling initialize()...');
            this.initialize();
            return this.startAmbientSound(ambientId, soundDefinition, position);
        }

        // Stop existing ambient sound with this ID if any
        if (this.ambientSounds.has(ambientId)) {
            this.stopAmbientSound(ambientId);
        }

        const audioConfig = soundDefinition.audio;
        const ambientConfig = soundDefinition.ambient || {};

        if (!audioConfig) {
            console.warn(`[AudioManager] No audio config for ambient sound: ${ambientId}`);
            return null;
        }

        // Check for special sound types
        if (audioConfig.type === 'fire') {
            return this.startFireAmbientSound(ambientId, soundDefinition, position);
        }

        // Create gain node for distance-based volume control
        const gainNode = this.audioContext.createGain();
        const filterNode = this.audioContext.createBiquadFilter();

        // Create noise source for the ambient sound
        const noiseType = audioConfig.noise?.type || 'brown';
        const noiseSource = this.createNoiseSource(noiseType);

        // Configure filter
        if (audioConfig.effects?.filter) {
            filterNode.type = audioConfig.effects.filter.type || 'bandpass';
            filterNode.frequency.value = audioConfig.effects.filter.frequency || 500;
            filterNode.Q.value = audioConfig.effects.filter.Q || 1;
        } else {
            filterNode.type = 'bandpass';
            filterNode.frequency.value = 500;
            filterNode.Q.value = 1;
        }

        // Connect: noise -> filter -> gain -> ambientBus (separate from sfx)
        noiseSource.connect(filterNode);
        filterNode.connect(gainNode);
        gainNode.connect(this.ambientBus.input);

        // Calculate initial volume based on distance
        const baseVolume = ambientConfig.volume || 0.5;
        const distance = this.calculateDistance(position, this.listenerPosition);
        const volume = this.calculateDistanceVolume(distance, ambientConfig, baseVolume);
        gainNode.gain.value = volume;

        // Start the noise source
        noiseSource.start();

        // Store the ambient sound
        const ambient = {
            id: ambientId,
            source: noiseSource,
            gainNode: gainNode,
            filterNode: filterNode,
            position: { ...position },
            config: ambientConfig,
            baseVolume: baseVolume,
            active: true
        };

        this.ambientSounds.set(ambientId, ambient);
        return ambient;
    }

    /**
     * Create a fire ambient sound with layered crackle synthesis
     */
    startFireAmbientSound(ambientId, soundDefinition, position) {
        const audioConfig = soundDefinition.audio;
        const ambientConfig = soundDefinition.ambient || {};
        const fireConfig = audioConfig.fire || {};

        // Master gain for distance-based volume
        const masterGain = this.audioContext.createGain();
        masterGain.connect(this.ambientBus.input);

        // Calculate initial volume
        const baseVolume = ambientConfig.volume || 0.15;
        const distance = this.calculateDistance(position, this.listenerPosition);
        const volume = this.calculateDistanceVolume(distance, ambientConfig, baseVolume);
        masterGain.gain.value = volume;

        // Store all sources for cleanup
        const sources = [];
        const gainNodes = [];
        const filterNodes = [];

        // Layer 1: Low rumble (brown noise, low-passed) - the base roar
        const rumbleGain = this.audioContext.createGain();
        const rumbleFilter = this.audioContext.createBiquadFilter();
        const rumbleSource = this.createNoiseSource('brown');
        rumbleFilter.type = 'lowpass';
        rumbleFilter.frequency.value = fireConfig.rumbleFreq || 150;
        rumbleFilter.Q.value = 0.5;
        rumbleGain.gain.value = fireConfig.rumbleVolume || 0.3;
        rumbleSource.connect(rumbleFilter);
        rumbleFilter.connect(rumbleGain);
        rumbleGain.connect(masterGain);
        rumbleSource.start();
        sources.push(rumbleSource);
        gainNodes.push(rumbleGain);
        filterNodes.push(rumbleFilter);

        // Layer 2: Mid crackle (pink noise, band-passed) - the body
        const crackleGain = this.audioContext.createGain();
        const crackleFilter = this.audioContext.createBiquadFilter();
        const crackleSource = this.createNoiseSource('pink');
        crackleFilter.type = 'bandpass';
        crackleFilter.frequency.value = fireConfig.crackleFreq || 1200;
        crackleFilter.Q.value = 1.5;
        crackleGain.gain.value = fireConfig.crackleVolume || 0.15;
        crackleSource.connect(crackleFilter);
        crackleFilter.connect(crackleGain);
        crackleGain.connect(masterGain);
        crackleSource.start();
        sources.push(crackleSource);
        gainNodes.push(crackleGain);
        filterNodes.push(crackleFilter);

        // Layer 3: High hiss (white noise, high-passed) - the sizzle
        const hissGain = this.audioContext.createGain();
        const hissFilter = this.audioContext.createBiquadFilter();
        const hissSource = this.createNoiseSource('white');
        hissFilter.type = 'highpass';
        hissFilter.frequency.value = fireConfig.hissFreq || 3000;
        hissFilter.Q.value = 0.3;
        hissGain.gain.value = fireConfig.hissVolume || 0.05;
        hissSource.connect(hissFilter);
        hissFilter.connect(hissGain);
        hissGain.connect(masterGain);
        hissSource.start();
        sources.push(hissSource);
        gainNodes.push(hissGain);
        filterNodes.push(hissFilter);

        // Layer 4: Random crackle pops using scheduled impulses
        const crackleInterval = this.startCrackleScheduler(masterGain, fireConfig);

        // Store the ambient sound with all components
        const ambient = {
            id: ambientId,
            sources: sources,
            gainNodes: gainNodes,
            filterNodes: filterNodes,
            gainNode: masterGain, // For volume updates
            crackleInterval: crackleInterval,
            position: { ...position },
            config: ambientConfig,
            baseVolume: baseVolume,
            active: true,
            isFireSound: true
        };

        this.ambientSounds.set(ambientId, ambient);
        return ambient;
    }

    /**
     * Schedule random crackle/pop sounds for fire
     */
    startCrackleScheduler(destination, fireConfig) {
        const minInterval = fireConfig.crackleMinInterval || 50;
        const maxInterval = fireConfig.crackleMaxInterval || 300;
        const crackleChance = fireConfig.crackleChance || 0.7;

        const scheduleCrackle = () => {
            if (Math.random() < crackleChance) {
                this.playCrackle(destination, fireConfig);
            }

            // Schedule next crackle at random interval
            const nextInterval = minInterval + Math.random() * (maxInterval - minInterval);
            return setTimeout(scheduleCrackle, nextInterval);
        };

        return scheduleCrackle();
    }

    /**
     * Play a single crackle/pop sound
     */
    playCrackle(destination, fireConfig) {
        if (!this.audioContext) return;

        const now = this.audioContext.currentTime;

        // Create a short burst of filtered noise for the crackle
        const bufferSize = Math.floor(this.audioContext.sampleRate * 0.03); // 30ms
        const buffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
        const data = buffer.getChannelData(0);

        // Generate crackle - starts loud, decays quickly with some randomness
        for (let i = 0; i < bufferSize; i++) {
            const decay = Math.exp(-i / (bufferSize * 0.15));
            const noise = (Math.random() * 2 - 1);
            // Add some impulse spikes
            const spike = Math.random() < 0.05 ? (Math.random() * 2 - 1) * 3 : 0;
            data[i] = (noise + spike) * decay;
        }

        const source = this.audioContext.createBufferSource();
        source.buffer = buffer;

        // Randomize the crackle characteristics
        const filter = this.audioContext.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 800 + Math.random() * 2000; // 800-2800 Hz
        filter.Q.value = 0.5 + Math.random() * 2;

        const gain = this.audioContext.createGain();
        const crackleVolume = (fireConfig.popVolume || 0.3) * (0.3 + Math.random() * 0.7);
        gain.gain.setValueAtTime(crackleVolume, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

        source.connect(filter);
        filter.connect(gain);
        gain.connect(destination);

        source.start(now);
        source.stop(now + 0.05);
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

        // Clear crackle interval if it's a fire sound
        if (ambient.crackleInterval) {
            clearTimeout(ambient.crackleInterval);
        }

        // Stop source(s) after fade
        setTimeout(() => {
            try {
                // Handle fire sounds with multiple sources
                if (ambient.isFireSound && ambient.sources) {
                    ambient.sources.forEach(source => {
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
                } else {
                    // Single source ambient
                    ambient.source.stop();
                    ambient.source.disconnect();
                    ambient.filterNode.disconnect();
                }
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
        const collections = this.game.getCollections();
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
}