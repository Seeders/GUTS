class AudioPlayer extends engine.Component {
    constructor(game, parent, params) {
        super(game, parent, params);
        // Pre-bind methods to avoid creating functions in render loops
        this.handlePlaybackEnd = this.handlePlaybackEnd.bind(this);
        this.initializeAudioContext = this.initializeAudioContext.bind(this);
    }
    
    init() {        
        this.audioContext = null;
        this.sampleRate = 44100; // Default until initialized
        this.isContextSuspended = true;
        this.stats = this.getComponent('stats').stats;
        this.audioData = this.game.config.sounds[this.stats.sound];
        this.isInitialized = false;
        this.activeNotes = new Map(); // Track currently playing notes for keyboard

        // Add listeners only once during init
        document.addEventListener('click', this.initializeAudioContext.bind(this), { once: true });
        document.addEventListener('keydown', this.initializeAudioContext.bind(this), { once: true });
    }

    async initializeAudioContext() {
        if (this.isInitialized) return Promise.resolve();

        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.sampleRate = this.audioContext.sampleRate;
            this.masterGainNode = this.audioContext.createGain();
            this.masterGainNode.connect(this.audioContext.destination);
            this.currentSource = null;
            this.isPlaying = false;
            
            this.audioData = this.game.config.sounds[this.stats.sound];
            // Create the audio graph
            this.setupEffects();
            
            this.isInitialized = true;
            if(this.audioData?.audio){
                this.applyAudioSettings(this.audioData.audio);
            }
            
            return Promise.resolve();
        } else if (this.audioContext.state === 'suspended') {
            return this.audioContext.resume().then(() => {
                this.isContextSuspended = false;
            });
        }
        
        return Promise.resolve();
    }

    setupEffects() {
        // 1. Completely reset ALL audio nodes
        this.masterGainNode.disconnect();
        
        // 2. Create fresh nodes (don't reuse old ones)
        this.filter = this.audioContext.createBiquadFilter();
        this.compressor = this.audioContext.createDynamicsCompressor();
        this.compressor.threshold.setValueAtTime(-24, this.audioContext.currentTime);
        this.compressor.knee.setValueAtTime(30, this.audioContext.currentTime);
        this.compressor.ratio.setValueAtTime(12, this.audioContext.currentTime);
        this.compressor.attack.setValueAtTime(0.003, this.audioContext.currentTime);
        this.compressor.release.setValueAtTime(0.25, this.audioContext.currentTime);

        this.distortion = this.audioContext.createWaveShaper();
        this.panner = this.audioContext.createStereoPanner();
        
        // 3. Create NEW master gain (this is crucial)
        this.masterGainNode = this.audioContext.createGain();
        
        // 4. Build the ONLY permitted connection path
        const chain = [
            this.filter,
            this.distortion,
            this.compressor,
            this.panner,
            this.masterGainNode,
            this.audioContext.destination
        ];
        
        // Connect them in order
        for (let i = 0; i < chain.length - 1; i++) {
            chain[i].connect(chain[i+1]);
        }
        
        // 5. Initialize parallel effects PROPERLY
        this.setupParallelEffects();
        
        // 6. Set initial volume (use this special method)
        this.setVolume(0.7);
    }
    
    setupParallelEffects() {
        this.delay = this.audioContext.createDelay(5.0);
        this.delayGain = this.audioContext.createGain();
        this.convolver = this.audioContext.createConvolver();
        this.reverbGain = this.audioContext.createGain();
        this.bitcrusher = this.createBitcrusher();
        this.bitcrusherGain = this.audioContext.createGain();
    
        // Build reverb impulse response
        this.buildImpulseResponse(2, 2);
    
        const parallelEffects = [
            { node: this.delay, gain: this.delayGain },
            { node: this.convolver, gain: this.reverbGain },
            { node: this.bitcrusher, gain: this.bitcrusherGain }
        ];
    
        parallelEffects.forEach(effect => {
            // Connect from filter (main chain) to effect node
            this.filter.connect(effect.node);
            // Effect node to its gain control
            effect.node.connect(effect.gain);
            // Gain control back to panner (main chain)
            effect.gain.connect(this.panner);
    
            // Special case: delay feedback
            if (effect.node === this.delay) {
                this.delayGain.connect(this.delay);
            }
        });
    
        // Initialize gain values
        this.delayGain.gain.value = 0;
        this.reverbGain.gain.value = 0;
        this.bitcrusherGain.gain.value = 0;
    }
    

    createBitcrusher() {
        const bufferSize = 4096;
        const bitcrusher = this.audioContext.createScriptProcessor(bufferSize, 1, 1);
    
        bitcrusher.bits = 8;
        bitcrusher.normfreq = 0.1;
    
        bitcrusher.onaudioprocess = (e) => {
            const input = e.inputBuffer.getChannelData(0);
            const output = e.outputBuffer.getChannelData(0);
            const step = Math.pow(0.5, bitcrusher.bits);
    
            for (let i = 0; i < input.length; i++) {
                output[i] = step * Math.floor(input[i] / step); // Apply consistently
            }
        };
    
        return bitcrusher;
    }
    buildImpulseResponse(duration, decay) {
        // Cache buffer size to avoid recalculation
        const sampleRate = this.audioContext.sampleRate;
        const length = sampleRate * duration;
        const impulse = this.audioContext.createBuffer(2, length, sampleRate);
        
        // Get both channels at once
        const left = impulse.getChannelData(0);
        const right = impulse.getChannelData(1);
        
        // Process both channels in a single loop
        for (let i = 0; i < length; i++) {
            const n = length - i;
            const factor = Math.pow(n / length, decay);
            left[i] = (Math.random() * 2 - 1) * factor;
            right[i] = (Math.random() * 2 - 1) * factor;
        }
        
        this.convolver.buffer = impulse;
    }
    
    makeDistortionCurve(amount) {
        // Use smaller sample size for distortion curve
        const k = amount * 10;
        const n_samples = 2048; // Reduced from 44100
        const curve = new Float32Array(n_samples);
        const deg = Math.PI / 180;
        
        // Pre-calculate constants
        const scale = (3 + k) * 20 * deg;
        
        for (let i = 0; i < n_samples; i++) {
            const x = (i * 2) / n_samples - 1;
            curve[i] = scale * x / (Math.PI + k * Math.abs(x));
        }
        
        return curve;
    }
    
    applyAudioSettings(settings) {
        if (!settings || !this.audioContext || !this.isInitialized) return;
        
        const now = this.audioContext.currentTime;
        
        // Group parameter changes to minimize overhead
        if (settings.effects?.filter) {
            this.filter.type = settings.effects.filter.type;
            this.filter.frequency.setValueAtTime(settings.effects.filter.frequency, now);
            this.filter.Q.setValueAtTime(settings.effects.filter.Q, now);
        }
        
        // Apply distortion (only when needed)
        if (settings.effects?.distortion !== undefined) {
            // Only recreate curve if amount has changed
            if (this._lastDistortionAmount !== settings.effects.distortion) {
                this.distortion.curve = this.makeDistortionCurve(settings.effects.distortion);
                this._lastDistortionAmount = settings.effects.distortion;
            }
        }
        
        // Apply effect levels in batch
        if (settings.effects) {
            // Delay
            if (settings.effects.delay) {
                this.delay.delayTime.setValueAtTime(settings.effects.delay.time, now);
                this.delayGain.gain.setValueAtTime(settings.effects.delay.feedback, now);
            }
            
            // Reverb
            if (settings.effects.reverb !== undefined) {
                this.reverbGain.gain.setValueAtTime(settings.effects.reverb, now);
            }
            
            // Bitcrusher
            if (settings.effects.bitcrusher !== undefined) {
                this.bitcrusherGain.gain.setValueAtTime(settings.effects.bitcrusher, now);
                this.bitcrusher.bits = Math.max(1, 16 - (settings.effects.bitcrusher * 15));
                this.bitcrusher.normfreq = settings.effects.bitcrusher * 0.5;
            }
            
            // Panning
            if (settings.effects.pan !== undefined) {
                this.panner.pan.setValueAtTime(settings.effects.pan, now);
            }
        }
    }
    
    setVolume(value) {
        if (!this.audioContext || !this.masterGainNode) return;
        
        const now = this.audioContext.currentTime;
        
        // For complete mute, use special near-zero value
        const safeValue = value <= 0 ? 0.000001 : value;
        
        // Cancel any pending volume changes
        this.masterGainNode.gain.cancelScheduledValues(now);
        
        // Smooth transition to avoid clicks
        this.masterGainNode.gain.setTargetAtTime(safeValue, now, 0.02); // 20ms smoothing
    }
    
    update() {
        // Empty implementation - no need to run anything on every frame
    }
    
    play(audio) {
        if (!this.isInitialized) {
            // Initialize and then play when ready
            this.initializeAudioContext().then(() => {
                if (audio || this.audioData?.audio) {
                    this.playAudio(audio || this.audioData.audio);
                }
            });
        } else {
            // Already initialized, play immediately
            if (audio || this.audioData?.audio) {
                this.playAudio(audio || this.audioData.audio);
            }
        }
    }
    
    playAudio(settings) {
        this.stopAllAudio();
        let volume = this.masterGainNode.gain.value;      
        this.masterGainNode = this.audioContext.createGain();
        this.masterGainNode.gain.value = volume;
        const now = this.audioContext.currentTime;
        const oscillator = this.createOscillator(settings);
        oscillator.connect(this.filter).connect(this.masterGainNode).connect(this.audioContext.destination);
        oscillator.start(now);
        oscillator.stop(now + settings.duration + (settings.envelope.release || 0.3));
        this.currentSource = oscillator;
        this.isPlaying = true;    
    
        oscillator.onended = () => {
            this.handlePlaybackEnd();
        };
    }
    
    createOscillator(settings) {
        const oscillator = settings.waveform === 'noise' 
            ? this.createNoiseSource() 
            : this.audioContext.createOscillator();
        
        if (settings.waveform !== 'noise') {
            oscillator.type = settings.waveform;
            oscillator.frequency.value = settings.frequency;
            
            if (settings.pitchEnvelope && (settings.pitchEnvelope.start !== 1 || settings.pitchEnvelope.end !== 1)) {
                const startFreq = settings.frequency * settings.pitchEnvelope.start;
                const endFreq = settings.frequency * settings.pitchEnvelope.end;
                const duration = settings.pitchEnvelope.time || settings.duration;
                const now = this.audioContext.currentTime;
                
                // Batch frequency changes
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
        // This method is referenced but not implemented in the original
        // Adding a placeholder implementation
        const bufferSize = 2 * this.sampleRate;
        const noiseBuffer = this.audioContext.createBuffer(1, bufferSize, this.sampleRate);
        const output = noiseBuffer.getChannelData(0);
        
        // Generate white noise in chunks for better performance
        const chunkSize = 1024;
        for (let i = 0; i < bufferSize; i += chunkSize) {
            const end = Math.min(i + chunkSize, bufferSize);
            for (let j = i; j < end; j++) {
                output[j] = Math.random() * 2 - 1;
            }
        }
        
        const source = this.audioContext.createBufferSource();
        source.buffer = noiseBuffer;
        source.loop = true;
        
        return source;
    }
    
    createEnvelopeGain(envelope, duration = 1) {
        const envelopeGain = this.audioContext.createGain();
        const now = this.audioContext.currentTime;

        // Clamp values to avoid invalid audio params
        const attack = Math.max(0.001, envelope.attack || 0.01);
        const decay = Math.max(0, envelope.decay || 0.1);
        const sustain = Math.max(0, Math.min(1, envelope.sustain || 0.7));
        const release = Math.max(0.001, envelope.release || 0.3);

        // Batch automation events
        envelopeGain.gain.setValueAtTime(0, now);
        envelopeGain.gain.linearRampToValueAtTime(1, now + attack);
        envelopeGain.gain.linearRampToValueAtTime(sustain, now + attack + decay);
        envelopeGain.gain.setValueAtTime(sustain, now + duration);
        envelopeGain.gain.linearRampToValueAtTime(0, now + duration + release);

        return envelopeGain;
    }
    
    handlePlaybackEnd() {
        this.isPlaying = false;
        this.currentSource = null;
        
        // Use querySelector instead of getElementById for better performance
        const playBtn = document.querySelector('#playBtn');
        const stopBtn = document.querySelector('#stopBtn');
        
        if (playBtn) playBtn.disabled = false;
        if (stopBtn) stopBtn.disabled = true;
    }
    
    // Clean up resources when component is destroyed
    destroy() {
        // Remove event listeners
        document.removeEventListener('click', this.initializeAudioContext);
        document.removeEventListener('keydown', this.initializeAudioContext);
        
        // Clean up audio nodes
        if (this.audioContext) {
            // Stop any current playback
            if (this.currentSource) {
                this.currentSource.onended = null;
                this.currentSource.disconnect();
                this.currentSource.stop();
            }
            
            // Clean up the script processor node
            if (this.bitcrusher) {
                this.bitcrusher.onaudioprocess = null;
                this.bitcrusher.disconnect();
            }
            
            // Attempt to close AudioContext
            if (this.audioContext.state !== 'closed') {
                this.audioContext.close().catch(e => console.warn('Error closing AudioContext:', e));
            }
        }
        
        // Clear references
        this.activeNotes = null;
        this.audioData = null;
    }
}