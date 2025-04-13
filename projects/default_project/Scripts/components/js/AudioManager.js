class AudioManager extends engine.Component {
    constructor(game, parent, params) {
        super(game, parent, params);
    }

    init(){
        this.isInitialized = false;
        // Initialize once user interacts
        this.bindInitialization();
    }
    
    bindInitialization() {
        const initHandler = () => {
            if (!this.isInitialized) {
                this.initialize();            }
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
                
                // Initialize pool
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
                    gainNode: this.audioContext.createGain(),
                    pannerNode: this.audioContext.createPanner(),
                    destination: this.destination
                };
                
                // Configure panner for 3D audio
                source.pannerNode.panningModel = 'HRTF';
                source.pannerNode.distanceModel = 'inverse';
                source.pannerNode.refDistance = 1;
                source.pannerNode.maxDistance = 10000;
                source.pannerNode.rolloffFactor = 1;
                
                // Connect nodes
                source.gainNode.connect(source.pannerNode);
                source.pannerNode.connect(source.destination);
                
                return source;
            }
            
            getSource() {
                // Find an inactive source
                let source = this.sources.find(src => !src.active);
                
                if (!source) {
                    // All sources are active, create a new one if below max pool size
                    if (this.sources.length < this.poolSize * 2) {
                        source = this.createSource();
                        this.sources.push(source);
                    } else {
                        // Return null if we hit the limit
                        return null;
                    }
                }
                
                // Mark as active and reset properties
                source.active = true;
                source.gainNode.gain.value = 1;
                
                return source;
            }
            
            releaseSource(source) {
                if (source) {
                    source.active = false;
                    source.id = null;
                }
            }
            
            destroy() {
                // Disconnect all nodes
                this.sources.forEach(source => {
                    source.gainNode.disconnect();
                    source.pannerNode.disconnect();
                });
                this.sources = [];
            }
        }

        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        // Create main audio buses
        this.masterBus = this.createAudioBus('master');
        this.musicBus = this.createAudioBus('music');
        this.sfxBus = this.createAudioBus('sfx');
        this.uiBus = this.createAudioBus('ui');
        
        // Connect buses
        this.musicBus.connect(this.masterBus);
        this.sfxBus.connect(this.masterBus);
        this.uiBus.connect(this.masterBus);
        this.masterBus.connect(this.audioContext.destination);
        
        // Add compression
        this.setupCompression();
        
        // Sound pools
        this.soundPools = {
            sfx: new SoundPool(this.audioContext, this.sfxBus.input, 6),
            music: new SoundPool(this.audioContext, this.musicBus.input, 2),
            ui: new SoundPool(this.audioContext, this.uiBus.input, 3)
        };
        
        // Sound buffers cache
        this.buffers = {};        

        // Currently active sounds
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
        
        // Set up internal routing
        bus.input.connect(bus.compressor);
        bus.compressor.connect(bus.output);
        
        // Helper method to connect this bus to another destination
        bus.connect = (destination) => {
            bus.output.connect(destination.input || destination);
        };
        
        // Volume control
        bus.setVolume = (value) => {
            bus.output.gain.setValueAtTime(value, this.audioContext.currentTime);
        };
        
        return bus;
    }
    
    setupCompression() {
        // Configure master compressor to prevent clipping
        const master = this.masterBus.compressor;
        master.threshold.setValueAtTime(-15, this.audioContext.currentTime);
        master.knee.setValueAtTime(30, this.audioContext.currentTime);
        master.ratio.setValueAtTime(12, this.audioContext.currentTime);
        master.attack.setValueAtTime(0.003, this.audioContext.currentTime);
        master.release.setValueAtTime(0.25, this.audioContext.currentTime);
        
        // Configure SFX compressor for explosions, impacts, etc.
        const sfx = this.sfxBus.compressor;
        sfx.threshold.setValueAtTime(-20, this.audioContext.currentTime);
        sfx.knee.setValueAtTime(10, this.audioContext.currentTime);
        sfx.ratio.setValueAtTime(5, this.audioContext.currentTime);
        sfx.attack.setValueAtTime(0.01, this.audioContext.currentTime);
        sfx.release.setValueAtTime(0.2, this.audioContext.currentTime);
    }

    getSynthSound(soundCollectionName, soundName) {        
        if(this.game.config[soundCollectionName][soundName]){
            const data = this.game.config[soundCollectionName][soundName].audio;
            return data;
        }
        console.warn('sound not found', soundCollectionName, soundName);
        return null;
    }

    playSound(soundCollectionName, soundName){
        let data = this.getSynthSound(soundCollectionName, soundName);
        this.playSynthSound(`${soundCollectionName}_${soundName}`, data);
    }
    
    playSynthSound(soundId, soundConfig, options = {}) {
        if (!this.isInitialized) {
            // Initialize and then retry
            this.initialize();
            return this.playSynthSound(soundId, soundConfig, options);
        }
        
        const category = options.category || 'sfx';
        const pool = this.soundPools[category];
        
        if (!pool) {
            console.warn(`No sound pool for category ${category}`);
            return null;
        }
        
        // Check if we're already playing too many of this sound
        let instanceCount = 0;
        this.activeSounds.forEach(sound => {
            if (sound.id === soundId) instanceCount++;
        });
        
        if (instanceCount >= (options.maxInstances || 3)) {
            // Too many instances already playing, skip this one
            return null;
        }
        
        // Get a source from the pool
        const sound = pool.getSource();
        
        if (!sound) {
            // No available sources in the pool
            return null;
        }
        
        // Configure the sound
        sound.id = soundId;
        sound.category = category;
        
        // Create oscillator and connect to sound's gain node
        const oscillator = this.createSynthSource(soundConfig);
        
        // Apply envelope to gain node
        this.createEnvelopeFromConfig(soundConfig.envelope, sound.gainNode, soundConfig.duration);
        
        // Connect the oscillator to the sound's gain node
        oscillator.connect(sound.gainNode);
        
        // Apply effects from config
        if (soundConfig.effects) {
            this.applySynthEffects(sound, soundConfig.effects);
        }
        
        // Apply additional options
        this.configureSoundInstance(sound, options);
        
        // Start playback
        const now = this.audioContext.currentTime;
        oscillator.start(now);
        
        // Calculate total sound duration
        const duration = soundConfig.duration || 1;
        const release = (soundConfig.envelope && soundConfig.envelope.release) || 0.3;
        const totalDuration = duration + release;
        
        // Stop after duration + release
        oscillator.stop(now + totalDuration);
        sound.source = oscillator; // Store reference to stop it later
        
        this.activeSounds.add(sound);
        
        // Handle sound ending
        oscillator.onended = () => {
            sound.active = false;
            this.activeSounds.delete(sound);
        };
        
        return sound;
    }
    
    createSynthSource(config) {
        const oscillator = config.waveform === 'noise' 
            ? this.createNoiseSource() 
            : this.audioContext.createOscillator();
        
        if (config.waveform !== 'noise') {
            oscillator.type = config.waveform;
            oscillator.frequency.value = config.frequency;
            
            // Apply pitch envelope if configured
            if (config.pitchEnvelope && (config.pitchEnvelope.start !== 1 || config.pitchEnvelope.end !== 1)) {
                const startFreq = config.frequency * config.pitchEnvelope.start;
                const endFreq = config.frequency * config.pitchEnvelope.end;
                const duration = config.pitchEnvelope.time || config.duration;
                const now = this.audioContext.currentTime;
                
                oscillator.frequency.setValueAtTime(startFreq, now);
                oscillator.frequency.exponentialRampToValueAtTime(
                    Math.max(endFreq, 0.01), 
                    now + duration
                );
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
        if (!envelope) return;
        
        const now = this.audioContext.currentTime;
        
        const attack = Math.max(0.001, envelope.attack || 0.01);
        const decay = Math.max(0, envelope.decay || 0.1);
        const sustain = Math.max(0, Math.min(1, envelope.sustain || 0.7));
        const release = Math.max(0.001, envelope.release || 0.3);
        
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(1, now + attack);
        gainNode.gain.linearRampToValueAtTime(sustain, now + attack + decay);
        gainNode.gain.setValueAtTime(sustain, now + duration);
        gainNode.gain.linearRampToValueAtTime(0, now + duration + release);
    }
    
    configureSoundInstance(sound, options) {
        const now = this.audioContext.currentTime;
        
        // Apply volume
        if (options.volume !== undefined) {
            sound.gainNode.gain.setValueAtTime(options.volume, now);
        }
        
        // Apply position if specified
        if (options.position && sound.pannerNode) {
            const pos = options.position;
            sound.pannerNode.positionX.setValueAtTime(pos.x || 0, now);
            sound.pannerNode.positionY.setValueAtTime(pos.y || 0, now);
            sound.pannerNode.positionZ.setValueAtTime(pos.z || 0, now);
        }
        
        // Apply pitch if specified
        if (options.pitch && sound.source && sound.source.playbackRate) {
            sound.source.playbackRate.setValueAtTime(options.pitch, now);
        }
    }
    
    applySynthEffects(sound, effectsConfig) {
        // Create temporary effect nodes for this sound instance
        const filter = this.audioContext.createBiquadFilter();
        const distortion = this.audioContext.createWaveShaper();
        const panner = this.audioContext.createStereoPanner();
        const delay = this.audioContext.createDelay(5.0);
        const delayGain = this.audioContext.createGain();
        const reverbGain = this.audioContext.createGain();
        const convolver = this.audioContext.createConvolver();
        
        // Configure filter
        if (effectsConfig.filter) {
            filter.type = effectsConfig.filter.type || 'lowpass';
            filter.frequency.value = effectsConfig.filter.frequency || 1000;
            filter.Q.value = effectsConfig.filter.Q || 1;
        }
        
        // Configure distortion
        if (effectsConfig.distortion) {
            distortion.curve = this.makeDistortionCurve(effectsConfig.distortion);
        }
        
        // Configure panning
        if (effectsConfig.pan !== undefined) {
            panner.pan.value = effectsConfig.pan;
        }
        
        // Configure delay
        if (effectsConfig.delay) {
            delay.delayTime.value = effectsConfig.delay.time || 0.3;
            delayGain.gain.value = effectsConfig.delay.feedback || 0;
        }
        
        // Configure reverb (if available)
        if (effectsConfig.reverb) {
            reverbGain.gain.value = effectsConfig.reverb;
            this.generateImpulseResponse(convolver);
        }
        
        // Build effect chain
        const chain = [
            sound.gainNode,
            filter,
            distortion,
            panner
        ];
        
        // Connect main effect chain
        for (let i = 0; i < chain.length - 1; i++) {
            chain[i].connect(chain[i+1]);
        }
        
        // Connect last node to destination
        chain[chain.length - 1].connect(sound.destination || this.sfxBus.input);
        
        // Setup parallel effects (delay and reverb)
        if (effectsConfig.delay && effectsConfig.delay.feedback > 0) {
            sound.gainNode.connect(delay);
            delay.connect(delayGain);
            delayGain.connect(delay); // Feedback loop
            delayGain.connect(panner);
        }
        
        if (effectsConfig.reverb > 0) {
            sound.gainNode.connect(convolver);
            convolver.connect(reverbGain);
            reverbGain.connect(panner);
        }
        
        // Store references to nodes for cleanup
        sound.effectNodes = [...chain, delay, delayGain, reverbGain, convolver];
    }
    
    generateImpulseResponse(convolver) {
        const length = this.audioContext.sampleRate * 2; // 2 seconds
        const impulse = this.audioContext.createBuffer(2, length, this.audioContext.sampleRate);
        
        for (let channel = 0; channel < 2; channel++) {
            const impulseData = impulse.getChannelData(channel);
            
            for (let i = 0; i < length; i++) {
                // Decay curve
                const decay = Math.pow(1 - i / length, 2);
                // Random values between -1 and 1
                impulseData[i] = (Math.random() * 2 - 1) * decay;
            }
        }
        
        convolver.buffer = impulse;
    }
    
    makeDistortionCurve(amount) {
        amount = Math.min(Math.max(amount, 0), 100);
        const k = amount / 100;
        const n_samples = 44100;
        const curve = new Float32Array(n_samples);
        const deg = Math.PI / 180;
        
        for (let i = 0; i < n_samples; i++) {
            const x = i * 2 / n_samples - 1;
            curve[i] = (3 + k) * x * 20 * deg / (Math.PI + k * Math.abs(x));
        }
        
        return curve;
    }
    
    stopSound(sound) {
        if (!sound) return;
        
        const now = this.audioContext.currentTime;
        
        // Fade out to avoid clicks
        if (sound.gainNode) {
            sound.gainNode.gain.cancelScheduledValues(now);
            sound.gainNode.gain.setValueAtTime(sound.gainNode.gain.value || 0, now);
            sound.gainNode.gain.linearRampToValueAtTime(0, now + 0.05);
        }
        
        // Stop the source after fade out
        if (sound.source) {
            try {
                sound.source.stop(now + 0.06);
            } catch (e) {
                // Source might already be stopped
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
