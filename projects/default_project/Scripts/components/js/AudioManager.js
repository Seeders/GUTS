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
                    destination: this.destination
                };

                source.filter.type = 'lowpass';
                source.filter.frequency.setValueAtTime(20000, this.audioContext.currentTime);
                source.filter.Q.setValueAtTime(1, this.audioContext.currentTime);

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

                source.gainNode.connect(source.delay);
                source.delay.connect(source.delayGain);
                source.delayGain.connect(source.delay);
                source.delayGain.connect(source.pannerNode);

                source.gainNode.connect(source.convolver);
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
                    source.envelopeGain.gain.setValueAtTime(0, this.audioContext.currentTime); // Start at 0
                }
                return source;
            }

            releaseSource(source) {
                if (source) {
                    source.active = false;
                    source.id = null;
                    source.filter.frequency.setValueAtTime(20000, this.audioContext.currentTime);
                    source.distortion.curve = null;
                    source.pannerNode.pan.setValueAtTime(0, this.audioContext.currentTime);
                    source.lastUsed = this.audioContext.currentTime;
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
        if (this.game.config[soundCollectionName]?.[soundName]) {
            return this.game.config[soundCollectionName][soundName].audio;
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
        
        const oscillator = this.createSynthSource(soundConfig);
        oscillator.connect(sound.envelopeGain);
        
        this.createEnvelopeFromConfig(soundConfig.envelope, sound.envelopeGain, soundConfig.duration);
        
        if (soundConfig.effects) {
            this.applySynthEffects(sound, soundConfig.effects);
            console.log(`Applied effects for ${soundId}:`, soundConfig.effects);
        } else {
            console.log(`No effects specified for ${soundId}`);
        }
        
        this.configureSoundInstance(sound, options);
        
        const now = this.audioContext.currentTime;
        oscillator.start(now);
        
        const duration = soundConfig.duration || 1;
        const release = (soundConfig.envelope?.release) || 0.3;
        let totalDuration = duration + release;
        
        // Extend duration for delay tail
        if (soundConfig.effects?.delay?.time) {
            const delayTail = soundConfig.effects.delay.time * 3;
            if (totalDuration < delayTail) {
                totalDuration = delayTail;
                console.log(`Extended duration to ${totalDuration}s to accommodate delay tail`);
            }
        }
        
        // Add small buffer to ensure envelope completes
        oscillator.stop(now + totalDuration + 0.02);
        sound.source = oscillator;
        
        this.activeSounds.add(sound);
        
        oscillator.onended = () => {
            setTimeout(() => {
                sound.active = false;
                this.activeSounds.delete(sound);
                pool.releaseSource(sound);
                console.log(`Sound ${soundId} ended`);
            }, (soundConfig.effects?.delay?.time || 0) * 1000 * 3); // Wait for 3 delay cycles
        };
        
        console.log(`Playing sound ${soundId} with duration ${totalDuration}s`);
        return sound;
    }

    createSynthSource(config) {
        const oscillator = config.waveform === 'noise'
            ? this.createNoiseSource()
            : this.audioContext.createOscillator();
        
        if (config.waveform !== 'noise') {
            oscillator.type = config.waveform || 'sine';
            oscillator.frequency.setValueAtTime(config.frequency || 440, this.audioContext.currentTime);
            
            if (config.pitchEnvelope && (config.pitchEnvelope.start !== 1 || config.pitchEnvelope.end !== 1)) {
                const startFreq = (config.frequency || 440) * config.pitchEnvelope.start;
                const endFreq = (config.frequency || 440) * config.pitchEnvelope.end;
                const duration = config.pitchEnvelope.time || config.duration || 1;
                const now = this.audioContext.currentTime;
                
                oscillator.frequency.setValueAtTime(startFreq, now);
                oscillator.frequency.exponentialRampToValueAtTime(
                    Math.max(endFreq, 0.01),
                    now + duration
                );
                console.log(`Pitch envelope applied: ${startFreq}Hz to ${endFreq}Hz over ${duration}s`);
            }
        }
        
        return oscillator;
    }

    createNoiseSource() {
        const bufferSize = this.audioContext.sampleRate * 2;
        const noiseBuffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
        const output = noiseBuffer.getChannelData(0);
        
        for (let i = 0; i < bufferSize; i++) {
            output[i] = Math.random() * 2 - 1;
        }
        
        const source = this.audioContext.createBufferSource();
        source.buffer = noiseBuffer;
        source.loop = true;
        
        return source;
    }

    createEnvelopeFromConfig(envelope, gainNode, duration = 1) {
        if (!envelope) {
            console.warn('No envelope provided, using default');
            envelope = { attack: 0.01, decay: 0.1, sustain: 0.7, release: 0.3 };
        }
        
        const now = this.audioContext.currentTime;
        
        const attack = Math.max(0.001, envelope.attack || 0.01);
        const decay = Math.max(0, envelope.decay || 0.1);
        const sustain = Math.max(0, Math.min(1, envelope.sustain || 0.7));
        const release = Math.max(0.02, envelope.release || 0.3); // Minimum 20ms release
        
        gainNode.gain.cancelScheduledValues(now);
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(1, now + attack);
        gainNode.gain.linearRampToValueAtTime(sustain, now + attack + decay);
        gainNode.gain.setValueAtTime(sustain, now + duration);
        gainNode.gain.setTargetAtTime(0, now + duration, release / 4); // Smooth exponential decay
        
        console.log(`Envelope applied: A=${attack}, D=${decay}, S=${sustain}, R=${release}`);
    }

    applySynthEffects(sound, effectsConfig) {
        const now = this.audioContext.currentTime;
        
        if (effectsConfig.filter) {
            sound.filter.type = effectsConfig.filter.type || 'lowpass';
            sound.filter.frequency.setValueAtTime(effectsConfig.filter.frequency || 20000, now);
            sound.filter.Q.setValueAtTime(effectsConfig.filter.Q || 1, now);
            console.log(`Filter: ${sound.filter.type}, ${effectsConfig.filter.frequency}Hz, Q=${effectsConfig.filter.Q}`);
        }
        
        if (effectsConfig.distortion && effectsConfig.distortion > 0) {
            sound.distortion.curve = this.makeDistortionCurve(effectsConfig.distortion);
            console.log(`Distortion: ${effectsConfig.distortion}`);
        } else {
            sound.distortion.curve = null;
        }
        
        if (effectsConfig.delay && effectsConfig.delay.feedback > 0) {
            sound.delay.delayTime.setValueAtTime(effectsConfig.delay.time || 0.3, now);
            sound.delayGain.gain.setValueAtTime(Math.min(effectsConfig.delay.feedback || 0, 0.8), now);
            console.log(`Delay: ${effectsConfig.delay.time}s, feedback=${effectsConfig.delay.feedback}`);
        } else {
            sound.delayGain.gain.setValueAtTime(0, now);
        }
        
        if (effectsConfig.reverb && effectsConfig.reverb > 0) {
            this.generateImpulseResponse(sound.convolver);
            sound.reverbGain.gain.setValueAtTime(Math.min(effectsConfig.reverb, 1), now);
            console.log(`Reverb: ${effectsConfig.reverb}`);
        } else {
            sound.reverbGain.gain.setValueAtTime(0, now);
        }
        
        if (effectsConfig.pan !== undefined) {
            sound.pannerNode.pan.setValueAtTime(Math.max(-1, Math.min(1, effectsConfig.pan)), now);
            console.log(`Pan: ${effectsConfig.pan}`);
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
            console.log(`Volume: ${options.volume}`);
        }
        
        if (options.position && sound.pannerNode.positionX) {
            const pos = options.position;
            sound.pannerNode.positionX.setValueAtTime(pos.x || 0, now);
            sound.pannerNode.positionY.setValueAtTime(pos.y || 0, now);
            sound.pannerNode.positionZ.setValueAtTime(pos.z || 0, now);
            console.log(`Position: x=${pos.x}, y=${pos.y}, z=${pos.z}`);
        }
        
        if (options.pitch && sound.source && sound.source.playbackRate) {
            sound.source.playbackRate.setValueAtTime(options.pitch, now);
            console.log(`Pitch: ${options.pitch}`);
        }
    }

    generateImpulseResponse(convolver) {
        const length = this.audioContext.sampleRate * 2;
        const impulse = this.audioContext.createBuffer(2, length, this.audioContext.sampleRate);
        
        for (let channel = 0; channel < 2; channel++) {
            const impulseData = impulse.getChannelData(channel);
            for (let i = 0; i < length; i++) {
                const decay = Math.pow(1 - i / length, 2);
                impulseData[i] = (Math.random() * 2 - 1) * decay;
            }
        }
        
        convolver.buffer = impulse;
        console.log('Reverb impulse response generated');
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
        
        sound.active = false;
        this.activeSounds.delete(sound);
        console.log(`Stopped sound ${sound.id}`);
    }

    stopAllSounds() {
        this.activeSounds.forEach(sound => {
            this.stopSound(sound);
        });
        this.activeSounds.clear();
        console.log('All sounds stopped');
    }
}