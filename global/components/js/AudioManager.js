class AudioManager extends engine.Component {
    constructor(game, parent, params) {
        super(game, parent, params);
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

                source.compressor.threshold.setValueAtTime(-24, this.audioContext.currentTime);
                source.compressor.knee.setValueAtTime(30, this.audioContext.currentTime);
                source.compressor.ratio.setValueAtTime(12, this.audioContext.currentTime);
                source.compressor.attack.setValueAtTime(0.003, this.audioContext.currentTime);
                source.compressor.release.setValueAtTime(0.25, this.audioContext.currentTime);

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
                let source = this.sources.find(src => !src.active && (!src.lastUsed || this.audioContext.currentTime - src.lastUsed > 1));
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
        this.uiBus = this.createAudioBus('ui');
        this.musicBus.connect(this.masterBus);
        this.sfxBus.connect(this.masterBus);
        this.uiBus.connect(this.masterBus);
        this.masterBus.connect(this.audioContext.destination);
        this.soundPools = {
            sfx: new SoundPool(this.audioContext, this.sfxBus.input, 6),
            music: new SoundPool(this.audioContext, this.musicBus.input, 2),
            ui: new SoundPool(this.audioContext, this.uiBus.input, 3)
        };
        this.buffers = {};
        this.activeSounds = new Set();
        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }
        this.isInitialized = true;
    }

    createAudioBus(name) {
        const bus = {
            name,
            input: this.audioContext.createGain(),
            compressor: this.audioContext.createDynamicsCompressor(),
            output: this.audioContext.createGain()
        };
        
        bus.input.connect(bus.compressor);
        bus.compressor.connect(bus.output);
        
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
            sound.gainNode.gain.setTargetAtTime(
                options.volume <= 0 ? 0.000001 : Math.max(0, Math.min(options.volume, 1)),
                now,
                0.02
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
}