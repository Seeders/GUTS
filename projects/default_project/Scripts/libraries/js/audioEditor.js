class AudioEditor {
    constructor(gameEditor) {
        this.gameEditor = gameEditor;

        this.audioContext = null;
        this.sampleRate = 44100; // Default until initialized
        this.isContextSuspended = true;
        
        // Initialize on first user interaction
        this.initializeAudioContext = () => {
            if (!this.audioContext) {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                this.sampleRate = this.audioContext.sampleRate;
                this.masterGainNode = this.audioContext.createGain();
                this.currentSource = null;
                this.isPlaying = false;
                this.visualizer = null;
                this.activeNotes = new Map(); // Track currently playing notes for keyboard
                this.setupEffects();
                this.loadPresetsFromStorage();
                this.setupEventListeners();
           //     this.setupKeyboard();
            } else if (this.audioContext.state === 'suspended') {
                this.audioContext.resume().then(() => {
                    this.isContextSuspended = false;
                });
            }
        };

        // Set up event listeners for user activation
        document.addEventListener('click', this.initializeAudioContext, { once: true });
        document.addEventListener('keydown', this.initializeAudioContext, { once: true });
    }

    setupEventListeners() {
        const updateStatus = (message, type = 'default') => {
            const status = document.getElementById('status-message');
            if (status) {
                status.textContent = message;
                status.className = type === 'success' ? 'success' : type === 'error' ? 'error' : '';
            }
        };

        const updateSliderDisplay = (sliderId, formatFn) => {
            const slider = document.getElementById(sliderId);
            if (slider) {
                const updateDisplayValue = () => {
                    const display = slider.nextElementSibling;
                    if (display && display.classList.contains('value-display')) {
                        display.textContent = formatFn(parseFloat(slider.value));
                    }
                };
                
                slider.addEventListener('input', updateDisplayValue);
                updateDisplayValue();
            }
        };

        document.body.addEventListener('editAudio', (event) => {
            try {
                const settings = event.detail.data;
                this.updateUIFromSettings(settings);                
                updateStatus('Audio settings imported', 'success');
            } catch (err) {
                updateStatus('Error importing audio settings: ' + err.message, 'error');
            }
        });

        const playBtn = document.getElementById('playBtn');
        const stopBtn = document.getElementById('stopBtn');
        
        playBtn?.addEventListener('click', () => {
            this.stopAllAudio();
            this.playCurrentSound();
            updateStatus('Playing audio...');
            playBtn.disabled = true;
            stopBtn.disabled = false;
        });

        stopBtn?.addEventListener('click', () => {
            this.stopAllAudio();
            updateStatus('Audio stopped');
            playBtn.disabled = false;
            stopBtn.disabled = true;
        });

        document.getElementById('exportBtn')?.addEventListener('click', () => {
            const settings = this.getUISettings();
            const jsonString = JSON.stringify(settings, null, 2);
            document.getElementById('jsonOutput').value = jsonString;
            this.saveAudio(settings);
            updateStatus('Audio settings exported', 'success');
        });

        this.setupUIControls(updateSliderDisplay);

        document.getElementById('presetSelect')?.addEventListener('change', (e) => {
            const presetName = e.target.value;
            if (presetName && this.presets[presetName]) {
                this.loadPreset(presetName);
                updateStatus(`Loaded preset: ${presetName}`, 'success');
            }
        });

        document.getElementById('savePresetBtn')?.addEventListener('click', () => {
            const presetName = document.getElementById('presetName').value.trim();
            if (presetName) {
                this.savePreset(presetName);
                updateStatus(`Preset "${presetName}" saved`, 'success');
                this.updatePresetsDropdown();
                document.getElementById('presetSelect').value = presetName;
            } else {
                updateStatus('Please enter a preset name', 'error');
            }
        });

        const canvas = document.getElementById('waveformCanvas');
        if (canvas) {
            this.visualizer = new AudioVisualizer(canvas, this.audioContext);
        }
        
        this.updatePresetsDropdown();
    }
    setVolume(value) {
        const now = this.audioContext.currentTime;
        
        // For complete mute, use special near-zero value
        const safeValue = value <= 0 ? 0.000001 : value;
        
        // Cancel any pending volume changes
        this.masterGainNode.gain.cancelScheduledValues(now);
        
        // Smooth transition to avoid clicks
        this.masterGainNode.gain.setTargetAtTime(
            safeValue,
            now,
            0.02 // 20ms smoothing
        );
    }
    setupUIControls(updateSliderDisplay) {
        updateSliderDisplay('volume', (val) => `${Math.round(val * 100)}%`);
        document.getElementById('volume')?.addEventListener('input', (e) => {
            const volume = parseFloat(e.target.value);
            this.setVolume(volume, e);
        });

        updateSliderDisplay('frequency', (val) => `${val} Hz`);
        updateSliderDisplay('duration', (val) => `${val.toFixed(2)} s`);
        
        updateSliderDisplay('attack', (val) => `${val.toFixed(3)} s`);
        updateSliderDisplay('decay', (val) => `${val.toFixed(2)} s`);
        updateSliderDisplay('sustain', (val) => `${Math.round(val * 100)}%`);
        updateSliderDisplay('release', (val) => `${val.toFixed(2)} s`);
        
        updateSliderDisplay('pitchEnvStart', (val) => `${val.toFixed(2)}x`);
        updateSliderDisplay('pitchEnvEnd', (val) => `${val.toFixed(2)}x`);
        
        document.getElementById('filterType')?.addEventListener('change', (e) => {
            this.filter.type = e.target.value;
        });
        
        updateSliderDisplay('filterFreq', (val) => `${val} Hz`);
        document.getElementById('filterFreq')?.addEventListener('input', (e) => {
            this.filter.frequency.value = parseFloat(e.target.value);
        });
        
        updateSliderDisplay('filterQ', (val) => `Q: ${val.toFixed(1)}`);
        document.getElementById('filterQ')?.addEventListener('input', (e) => {
            this.filter.Q.value = parseFloat(e.target.value);
        });
        
        updateSliderDisplay('distortion', (val) => `${Math.round(val)}%`);
        document.getElementById('distortion')?.addEventListener('input', (e) => {
            const amount = parseFloat(e.target.value);
            this.distortion.curve = this.makeDistortionCurve(amount);
        });
        
        updateSliderDisplay('delayTime', (val) => `${val.toFixed(2)} s`);
        document.getElementById('delayTime')?.addEventListener('input', (e) => {
            this.delay.delayTime.value = parseFloat(e.target.value);
        });
        
        updateSliderDisplay('delayFeedback', (val) => `${Math.round(val * 100)}%`);
        document.getElementById('delayFeedback')?.addEventListener('input', (e) => {
            this.delayGain.gain.value = parseFloat(e.target.value);
        });
        
        updateSliderDisplay('reverbAmount', (val) => `${Math.round(val * 100)}%`);
        document.getElementById('reverbAmount')?.addEventListener('input', (e) => {
            this.reverbGain.gain.value = parseFloat(e.target.value);
        });
        
        updateSliderDisplay('bitcrusher', (val) => `${Math.round(val * 100)}%`);
        document.getElementById('bitcrusher')?.addEventListener('input', (e) => {
          //  this.bitcrusherGain.gain.value = parseFloat(e.target.value);
            const amount = parseFloat(e.target.value);
            this.updateBitcrusher(amount);
        });
        
        updateSliderDisplay('panning', (val) => {
            if (val === 0) return "Center";
            return val < 0 ? `${Math.abs(Math.round(val * 100))}% Left` : `${Math.round(val * 100)}% Right`;
        });
        document.getElementById('panning')?.addEventListener('input', (e) => {
            this.panner.pan.value = parseFloat(e.target.value);
        });
    }

    getUISettings() {
        return {
            waveform: document.getElementById('waveform')?.value || 'sine',
            frequency: parseFloat(document.getElementById('frequency')?.value || 440),
            duration: parseFloat(document.getElementById('duration')?.value || 1),
            envelope: {
                attack: parseFloat(document.getElementById('attack')?.value || 0.01),
                decay: parseFloat(document.getElementById('decay')?.value || 0.1),
                sustain: parseFloat(document.getElementById('sustain')?.value || 0.7),
                release: parseFloat(document.getElementById('release')?.value || 0.3),
            },
            pitchEnvelope: {
                start: parseFloat(document.getElementById('pitchEnvStart')?.value || 1),
                end: parseFloat(document.getElementById('pitchEnvEnd')?.value || 1),
                time: parseFloat(document.getElementById('duration')?.value || 1)
            },
            effects: {
                filter: {
                    type: document.getElementById('filterType')?.value || 'lowpass',
                    frequency: parseFloat(document.getElementById('filterFreq')?.value || 1000),
                    Q: parseFloat(document.getElementById('filterQ')?.value || 1)
                },
                distortion: parseFloat(document.getElementById('distortion')?.value || 0),
                delay: {
                    time: parseFloat(document.getElementById('delayTime')?.value || 0.3),
                    feedback: parseFloat(document.getElementById('delayFeedback')?.value || 0)
                },
                reverb: parseFloat(document.getElementById('reverbAmount')?.value || 0),
                bitcrusher: parseFloat(document.getElementById('bitcrusher')?.value || 0),
                pan: parseFloat(document.getElementById('panning')?.value || 0)
            }
        };
    }

    updateUIFromSettings(settings) {
        if (!settings) return;
        
        this.setElementValue('waveform', settings.waveform);
        this.setElementValue('frequency', settings.frequency);
        this.setElementValue('duration', settings.duration);
        
        if (settings.envelope) {
            this.setElementValue('attack', settings.envelope.attack);
            this.setElementValue('decay', settings.envelope.decay);
            this.setElementValue('sustain', settings.envelope.sustain);
            this.setElementValue('release', settings.envelope.release);
        }
        
        if (settings.pitchEnvelope) {
            this.setElementValue('pitchEnvStart', settings.pitchEnvelope.start);
            this.setElementValue('pitchEnvEnd', settings.pitchEnvelope.end);
        }
        
        if (settings.effects) {
            if (settings.effects.filter) {
                this.setElementValue('filterType', settings.effects.filter.type);
                this.setElementValue('filterFreq', settings.effects.filter.frequency);
                this.setElementValue('filterQ', settings.effects.filter.Q);
                
                this.filter.type = settings.effects.filter.type;
                this.filter.frequency.value = settings.effects.filter.frequency;
                this.filter.Q.value = settings.effects.filter.Q;
            }
            
            this.setElementValue('distortion', settings.effects.distortion);
            this.distortion.curve = this.makeDistortionCurve(settings.effects.distortion);
            
            if (settings.effects.delay) {
                this.setElementValue('delayTime', settings.effects.delay.time);
                this.setElementValue('delayFeedback', settings.effects.delay.feedback);
                
                this.delay.delayTime.value = settings.effects.delay.time;
                this.delayGain.gain.value = settings.effects.delay.feedback;
            }
            
            this.setElementValue('reverbAmount', settings.effects.reverb);
            this.reverbGain.gain.value = settings.effects.reverb;
            
            this.setElementValue('bitcrusher', settings.effects.bitcrusher);
         //   this.bitcrusherGain.gain.value = settings.effects.bitcrusher;
            this.updateBitcrusher(settings.effects.bitcrusher);
            
            this.setElementValue('panning', settings.effects.pan);
            this.panner.pan.value = settings.effects.pan;
        }
        
        document.querySelectorAll('input[type="range"]').forEach(el => {
            el.dispatchEvent(new Event('input'));
        });
    }

    setupKeyboard() {
        const keyboard = document.getElementById('keyboard');
        if (!keyboard) return;
        
        keyboard.innerHTML = '';
        
        const keyboardLayout = [
            { note: 'C4', key: 'a', frequency: 261.63, type: 'white' },
            { note: 'C#4', key: 'w', frequency: 277.18, type: 'black' },
            { note: 'D4', key: 's', frequency: 293.66, type: 'white' },
            { note: 'D#4', key: 'e', frequency: 311.13, type: 'black' },
            { note: 'E4', key: 'd', frequency: 329.63, type: 'white' },
            { note: 'F4', key: 'f', frequency: 349.23, type: 'white' },
            { note: 'F#4', key: 't', frequency: 369.99, type: 'black' },
            { note: 'G4', key: 'g', frequency: 392.00, type: 'white' },
            { note: 'G#4', key: 'y', frequency: 415.30, type: 'black' },
            { note: 'A4', key: 'h', frequency: 440.00, type: 'white' },
            { note: 'A#4', key: 'u', frequency: 466.16, type: 'black' },
            { note: 'B4', key: 'j', frequency: 493.88, type: 'white' },
            { note: 'C5', key: 'k', frequency: 523.25, type: 'white' }
        ];
        
        keyboardLayout.forEach(note => {
            const key = document.createElement('div');
            key.className = `key ${note.type}`;
            key.dataset.note = note.note;
            key.dataset.frequency = note.frequency;
            key.innerHTML = `<span>${note.note}</span><span class="key-label">${note.key}</span>`;
            
            key.addEventListener('mousedown', () => {
                key.classList.add('active');
                this.playNote(note.frequency);
            });
            key.addEventListener('mouseup', () => {
                key.classList.remove('active');
                this.stopNote(note.frequency);
            });
            key.addEventListener('mouseleave', () => {
                if (key.classList.contains('active')) {
                    key.classList.remove('active');
                    this.stopNote(note.frequency);
                }
            });
            
            keyboard.appendChild(key);
        });
        
        const keyToNote = {};
        keyboardLayout.forEach(note => {
            keyToNote[note.key] = note.frequency;
        });
        
        window.addEventListener('keydown', (e) => {
            if (e.repeat) return;
            const key = e.key.toLowerCase();
            if (keyToNote[key]) {
                this.playNote(keyToNote[key]);
                const keyElement = Array.from(keyboard.children).find(
                    k => k.dataset.frequency == keyToNote[key]
                );
                if (keyElement) keyElement.classList.add('active');
            }
        });
        
        window.addEventListener('keyup', (e) => {
            const key = e.key.toLowerCase();
            if (keyToNote[key]) {
                this.stopNote(keyToNote[key]);
                const keyElement = Array.from(keyboard.children).find(
                    k => k.dataset.frequency == keyToNote[key]
                );
                if (keyElement) keyElement.classList.remove('active');
            }
        });
    }

    setElementValue(id, value) {
        const element = document.getElementById(id);
        if (element) element.value = value;
    }

    loadPresetsFromStorage() {
        try {
            const savedPresets = localStorage.getItem('audioEditorPresets');
            this.presets = savedPresets ? JSON.parse(savedPresets) : this.createDefaultPresets();
        } catch (e) {
            console.error("Error loading presets:", e);
            this.presets = this.createDefaultPresets();
        }
    }

    savePreset(presetName) {
        const settings = this.getUISettings();
        this.presets[presetName] = settings;
        
        try {
            localStorage.setItem('audioEditorPresets', JSON.stringify(this.presets));
        } catch (e) {
            console.error("Error saving preset:", e);
        }
    }

    loadPreset(presetName) {
        const preset = this.presets[presetName];
        if (preset) {
            this.updateUIFromSettings(preset);
            this.playCurrentSound();
        }
    }

    updatePresetsDropdown() {
        const select = document.getElementById('presetSelect');
        if (!select) return;
        
        select.innerHTML = '<option value="">Select Preset</option>';
        Object.keys(this.presets).forEach(presetName => {
            const option = document.createElement('option');
            option.value = presetName;
            option.textContent = presetName;
            select.appendChild(option);
        });
    }
    saveAudio(settingsObj) {
        document.body.dispatchEvent(new CustomEvent('saveAudio', {   
            detail: { data: settingsObj, propertyName: 'audio' },
        }));
    }

    playSequence(notes, tempo = 120) {
        this.stopAllAudio();
        
        const secondsPerBeat = 60 / tempo;
        let currentTime = this.audioContext.currentTime;
        
        notes.forEach(note => {
            if (!note.frequency || !note.duration) return;
            
            const settings = this.getUISettings();
            settings.frequency = note.frequency;
            settings.duration = note.duration * secondsPerBeat;
            
            const oscillator = this.createOscillator(settings);
            const envelopeGain = this.createEnvelopeGain(settings.envelope);
            
            oscillator.connect(envelopeGain);
            envelopeGain.connect(this.filter);
            
            oscillator.start(currentTime);
            oscillator.stop(currentTime + settings.duration + settings.envelope.release);
            
            currentTime += settings.duration;
        });
    }
    playCurrentSound() {
        const settings = this.getUISettings();
        this.playAudio(settings);
    }
    
    playNote(frequency) {
        if (this.activeNotes.has(frequency)) {
            this.stopNote(frequency);
        }
        
        const settings = this.getUISettings();
        settings.frequency = frequency;
        
        const now = this.audioContext.currentTime;
        const oscillator = this.createOscillator(settings);
        oscillator.connect(this.filter);
        oscillator.start(now);
        
        this.activeNotes.set(frequency, {
            oscillator,
            envelopeGain: this.masterGainNode,
            startTime: now
        });
        
        this.connectVisualizer(oscillator);
    }
    
    playAudio(settings) {
        this.stopAllAudio();
        let volume = this.masterGainNode.gain.value;      
        this.masterGainNode = this.audioContext.createGain();
        this.masterGainNode.gain.value = volume;
        const now = this.audioContext.currentTime;
        const oscillator = this.createOscillator(settings);
        oscillator.connect(this.masterGainNode).connect(this.filter).connect(this.audioContext.destination);
        oscillator.start(now);
        oscillator.stop(now + settings.duration + (settings.envelope.release || 0.3));
        this.currentSource = oscillator;
        this.isPlaying = true;
    
      //  this.connectVisualizer(oscillator);
    
        oscillator.onended = () => {
            this.handlePlaybackEnd();
        };
    }
    
    connectVisualizer(source) {
        if (this.visualizer) {
            this.visualizer.connectSource(source);
        }
    }
    
    handlePlaybackEnd() {
        this.isPlaying = false;
        this.currentSource = null;
        
        const playBtn = document.getElementById('playBtn');
        const stopBtn = document.getElementById('stopBtn');
        if (playBtn && stopBtn) {
            playBtn.disabled = false;
            stopBtn.disabled = true;
        }
    }

    stopNote(frequency) {
        if (!this.activeNotes.has(frequency)) return;
        
        const note = this.activeNotes.get(frequency);
        const now = this.audioContext.currentTime;
        const settings = this.getUISettings();
        const release = settings.envelope.release;
        
        note.envelopeGain.gain.cancelScheduledValues(now);
        note.envelopeGain.gain.setValueAtTime(note.envelopeGain.gain.value, now);
        note.envelopeGain.gain.linearRampToValueAtTime(0, now + release);
        
        note.oscillator.stop(now + release + 0.1);
        
        setTimeout(() => {
            this.activeNotes.delete(frequency);
        }, (release + 0.2) * 1000);
    }

    stopAllAudio() {
        this.activeNotes.forEach((note, frequency) => {
            this.stopNote(frequency);
        });
        this.activeNotes.clear();
        
        if (this.currentSource) {
            try {
                this.currentSource.stop();
            } catch (e) {
                console.warn("Error stopping source:", e);
            }
            this.currentSource = null;
        }
        
        this.isPlaying = false;
    }
   
    setupEffects() {
  
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
    
        // 4. Build the ONLY permitted connection path
        const chain = [
            this.filter,
            this.distortion,
            this.compressor,
            this.panner
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
      //  this.bitcrusher = this.createBitcrusher();
     //   this.bitcrusherGain = this.audioContext.createGain();
    
        // Build reverb impulse response
        this.buildImpulseResponse(2, 2);
    
        const parallelEffects = [
            { node: this.delay, gain: this.delayGain },
            { node: this.convolver, gain: this.reverbGain }
          //  { node: this.bitcrusher, gain: this.bitcrusherGain }
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
      //  this.bitcrusherGain.gain.value = 0;
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

    createEnvelopeGain(envelope, duration = 1) {
        const envelopeGain = this.audioContext.createGain();
        const now = this.audioContext.currentTime;

        const attack = Math.max(0.001, envelope.attack || 0.01);
        const decay = Math.max(0, envelope.decay || 0.1);
        const sustain = Math.max(0, Math.min(1, envelope.sustain || 0.7));
        const release = Math.max(0.001, envelope.release || 0.3);

        envelopeGain.gain.setValueAtTime(0, now);
        envelopeGain.gain.linearRampToValueAtTime(1, now + attack);
        envelopeGain.gain.linearRampToValueAtTime(sustain, now + attack + decay);
        envelopeGain.gain.setValueAtTime(sustain, now + duration); // Maintain sustain
        envelopeGain.gain.linearRampToValueAtTime(0, now + duration + release);

        return envelopeGain;
    }

    createBitcrusher() {
        // const bufferSize = 4096;
        // const bitcrusher = this.audioContext.createScriptProcessor(bufferSize, 1, 1);
    
        // bitcrusher.bits = 8;
        // bitcrusher.normfreq = 0.1;
    
        // bitcrusher.onaudioprocess = (e) => {
        //     const input = e.inputBuffer.getChannelData(0);
        //     const output = e.outputBuffer.getChannelData(0);
        //     const step = Math.pow(0.5, bitcrusher.bits);
    
        //     for (let i = 0; i < input.length; i++) {
        //         output[i] = step * Math.floor(input[i] / step); // Apply consistently
        //     }
        // };
    
        // return bitcrusher;
    }
    updateBitcrusher(amount) {
        // this.bitcrusher.disconnect();
        // this.bitcrusher = this.createBitcrusher();
        // this.compressor.connect(this.bitcrusher);
        // this.bitcrusher.connect(this.bitcrusherGain);
        
        // this.bitcrusher.bits = Math.floor(16 - amount * 12);
        // this.bitcrusher.normfreq = 0.05 + amount * 0.15;
    }

    makeDistortionCurve(amount) {
        const k = amount * 10; // Reduced from 100 to 10 for subtler distortion
        const n_samples = 44100;
        const curve = new Float32Array(n_samples);
        const deg = Math.PI / 180;
    
        for (let i = 0; i < n_samples; i++) {
            const x = (i * 2) / n_samples - 1;
            curve[i] = (3 + k) * x * 20 * deg / (Math.PI + k * Math.abs(x));
        }
    
        return curve;
    }
    buildImpulseResponse(duration, decay) {
        const sampleRate = this.audioContext.sampleRate;
        const length = sampleRate * duration;
        const impulse = this.audioContext.createBuffer(2, length, sampleRate);
        const left = impulse.getChannelData(0);
        const right = impulse.getChannelData(1);
        
        for (let i = 0; i < length; i++) {
            const n = length - i;
            left[i] = (Math.random() * 2 - 1) * Math.pow(n / length, decay);
            right[i] = (Math.random() * 2 - 1) * Math.pow(n / length, decay);
        }
        
        this.convolver.buffer = impulse;
    }

    
    createDefaultPresets() {
        return {
            "Laser": {
              "waveform": "sine",
              "frequency": 20,
              "duration": 0.1,
              "envelope": {
                "attack": 2,
                "decay": 0,
                "sustain": 0,
                "release": 0.043
              },
              "pitchEnvelope": {
                "start": 2.09,
                "end": 2.08,
                "time": 0.1
              },
              "effects": {
                "filter": {
                  "type": "lowpass",
                  "frequency": 20,
                  "Q": 0.1
                },
                "distortion": 3,
                "delay": {
                  "time": 0.32,
                  "feedback": 0.26
                },
                "reverb": 0.21,
                "bitcrusher": 0,
                "pan": 0
              }
            },
            "Explosion": {
              "waveform": "triangle",
              "frequency": 48,
              "duration": 0.1,
              "envelope": {
                "attack": 2,
                "decay": 0,
                "sustain": 0,
                "release": 0.001
              },
              "pitchEnvelope": {
                "start": 0.73,
                "end": 0.82,
                "time": 0.1
              },
              "effects": {
                "filter": {
                  "type": "lowpass",
                  "frequency": 500,
                  "Q": 1
                },
                "distortion": 15,
                "delay": {
                  "time": 0.42,
                  "feedback": 0.08
                },
                "reverb": 0.61,
                "bitcrusher": 0,
                "pan": 0
              }
            },
            "Jump": {
              "waveform": "sine",
              "frequency": 221,
              "duration": 0.1,
              "envelope": {
                "attack": 0.962,
                "decay": 0.976,
                "sustain": 1,
                "release": 0.043
              },
              "pitchEnvelope": {
                "start": 0.5,
                "end": 2.18,
                "time": 0.1
              },
              "effects": {
                "filter": {
                  "type": "lowpass",
                  "frequency": 320,
                  "Q": 1
                },
                "distortion": 5,
                "delay": {
                  "time": 0.12,
                  "feedback": 0
                },
                "reverb": 0.01,
                "bitcrusher": 0,
                "pan": 0
              }
            },
            "Coin": {
              "waveform": "sine",
              "frequency": 518,
              "duration": 0.1,
              "envelope": {
                "attack": 2,
                "decay": 0.05,
                "sustain": 0,
                "release": 0.043
              },
              "pitchEnvelope": {
                "start": 0.34,
                "end": 1.89,
                "time": 0.1
              },
              "effects": {
                "filter": {
                  "type": "highpass",
                  "frequency": 569,
                  "Q": 0.1
                },
                "distortion": 8,
                "delay": {
                  "time": 0.27,
                  "feedback": 0.01
                },
                "reverb": 0,
                "bitcrusher": 0,
                "pan": 0
              }
            },
            "Hit": {
              "waveform": "triangle",
              "frequency": 200,
              "duration": 0.1,
              "envelope": {
                "attack": 0.001,
                "decay": 0,
                "sustain": 0,
                "release": 0.001
              },
              "pitchEnvelope": {
                "start": 0.73,
                "end": 0.28,
                "time": 0.1
              },
              "effects": {
                "filter": {
                  "type": "lowpass",
                  "frequency": 400,
                  "Q": 1
                },
                "distortion": 20,
                "delay": {
                  "time": 0,
                  "feedback": 0.2
                },
                "reverb": 0,
                "bitcrusher": 0.1,
                "pan": 0
              }
            },
            "Attack": {
              "waveform": "triangle",
              "frequency": 200,
              "duration": 0.1,
              "envelope": {
                "attack": 0.001,
                "decay": 0,
                "sustain": 0,
                "release": 0.001
              },
              "pitchEnvelope": {
                "start": 0.34,
                "end": 1.89,
                "time": 0.1
              },
              "effects": {
                "filter": {
                  "type": "lowpass",
                  "frequency": 400,
                  "Q": 1
                },
                "distortion": 20,
                "delay": {
                  "time": 0,
                  "feedback": 0.2
                },
                "reverb": 0,
                "bitcrusher": 0.1,
                "pan": 0
              }
            }
          };
    }
}

// Audio Visualizer class
class AudioVisualizer {
    constructor(canvas, audioContext) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.audioContext = audioContext;
        this.analyzer = audioContext.createAnalyser();
        this.analyzer.fftSize = 2048;
        this.bufferLength = this.analyzer.frequencyBinCount;
        this.dataArray = new Uint8Array(this.bufferLength);
        this.analyzer.connect(audioContext.destination);
        
      
        
        // Start visualization loop
        this.visualize();
    }
    
    connectSource(source) {
        source.connect(this.analyzer);
    }
    
    drawWaveform(audioBuffer) {
        const data = audioBuffer.getChannelData(0);
        const step = Math.ceil(data.length / this.canvas.width);
        const amp = this.canvas.height / 2;
        
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.beginPath();
        this.ctx.moveTo(0, amp);
        
        for (let i = 0; i < this.canvas.width; i++) {
            const idx = Math.floor(i * step);
            const y = amp + data[idx] * amp;
            this.ctx.lineTo(i, y);
        }
        
        this.ctx.strokeStyle = '#2196F3';
        this.ctx.stroke();
    }
    
    visualize() {
        requestAnimationFrame(() => this.visualize());
        
        this.analyzer.getByteTimeDomainData(this.dataArray);
        
        this.ctx.fillStyle = 'rgb(200, 200, 200)';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        this.ctx.lineWidth = 2;
        this.ctx.strokeStyle = 'rgb(0, 0, 0)';
        this.ctx.beginPath();
        
        const sliceWidth = this.canvas.width * 1.0 / this.bufferLength;
        let x = 0;
        
        for (let i = 0; i < this.bufferLength; i++) {
            const v = this.dataArray[i] / 128.0;
            const y = v * this.canvas.height / 2;
            
            if (i === 0) {
                this.ctx.moveTo(x, y);
            } else {
                this.ctx.lineTo(x, y);
            }
            
            x += sliceWidth;
        }
        
        this.ctx.lineTo(this.canvas.width, this.canvas.height / 2);
        this.ctx.stroke();
    }
    
}