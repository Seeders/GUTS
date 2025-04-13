class AudioEditor {
    constructor(gameEditor, config, {}) {
        this.gameEditor = gameEditor;
        let configObj = { state: {}, config: this.gameEditor.getCollections() };

        this.audioManager = new (this.gameEditor.scriptContext.getComponent("AudioManager"))(configObj, null, {} );
        this.audioManager.init();
        this.volume = 1;

        this.loadPresetsFromStorage();
        this.setupEventListeners();
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
        
        playBtn?.addEventListener('click', () => {
            this.playCurrentSound();
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
           // this.visualizer = new AudioVisualizer(canvas, this.audioContext);
        }
        
        this.updatePresetsDropdown();
    }
    setVolume(value) {
        this.volume = value;
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
        

        updateSliderDisplay('filterFreq', (val) => `${val} Hz`);

        
        updateSliderDisplay('filterQ', (val) => `Q: ${val.toFixed(1)}`);
        
        updateSliderDisplay('distortion', (val) => `${Math.round(val)}%`);

        
        updateSliderDisplay('delayTime', (val) => `${val.toFixed(2)} s`);
 
        
        updateSliderDisplay('delayFeedback', (val) => `${Math.round(val * 100)}%`);

        
        updateSliderDisplay('reverbAmount', (val) => `${Math.round(val * 100)}%`);
   
        
        updateSliderDisplay('bitcrusher', (val) => `${Math.round(val * 100)}%`);

        
        updateSliderDisplay('panning', (val) => {
            if (val === 0) return "Center";
            return val < 0 ? `${Math.abs(Math.round(val * 100))}% Left` : `${Math.round(val * 100)}% Right`;
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
                
            }
            
            this.setElementValue('distortion', settings.effects.distortion);
            
            if (settings.effects.delay) {
                this.setElementValue('delayTime', settings.effects.delay.time);
                this.setElementValue('delayFeedback', settings.effects.delay.feedback);
            }
            
            this.setElementValue('reverbAmount', settings.effects.reverb);
            
            this.setElementValue('bitcrusher', settings.effects.bitcrusher);

            this.setElementValue('panning', settings.effects.pan);
        }
        
        document.querySelectorAll('input[type="range"]').forEach(el => {
            el.dispatchEvent(new Event('input'));
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

    playCurrentSound() {
        const settings = this.getUISettings();
        this.audioManager.playSynthSound('audioEditorSound', settings);
    }
    
 
    connectVisualizer(source) {
        if (this.visualizer) {
            this.visualizer.connectSource(source);
        }
    }
    
    
    createDefaultPresets() {
        return {
            "Laser": {
              "waveform": "triangle",
              "frequency": 197,
              "duration": 0.3,
              "envelope": {
                "attack": 0.001,
                "decay": 0.076,
                "sustain": 0.9,
                "release": 0.001
              },
              "pitchEnvelope": {
                "start": 3.41,
                "end": 0.23,
                "time": 0.3
              },
              "effects": {
                "filter": {
                  "type": "lowpass",
                  "frequency": 400,
                  "Q": 1
                },
                "distortion": 100,
                "delay": {
                  "time": 0.27,
                  "feedback": 0.17
                },
                "reverb": 0,
                "bitcrusher": 0.28,
                "pan": 0
              }
            },
            "Explosion": {
              "waveform": "noise",
              "frequency": 100,
              "duration": 1,
              "envelope": {
                "attack": 0.005,
                "decay": 0.2,
                "sustain": 0.3,
                "release": 0.3
              },
              "pitchEnvelope": {
                "start": 2,
                "end": 0.5,
                "time": 1
              },
              "effects": {
                "filter": {
                  "type": "lowpass",
                  "frequency": 800,
                  "Q": 1
                },
                "distortion": 3,
                "delay": {
                  "time": 0.15,
                  "feedback": 0.25
                },
                "reverb": 0.5,
                "bitcrusher": 0.5,
                "pan": 0
              }
            },
            "Jump": {
              "waveform": "sine",
              "frequency": 197,
              "duration": 0.2,
              "envelope": {
                "attack": 0.005,
                "decay": 0.05,
                "sustain": 0,
                "release": 0.05
              },
              "pitchEnvelope": {
                "start": 1,
                "end": 2,
                "time": 0.2
              },
              "effects": {
                "filter": {
                  "type": "highpass",
                  "frequency": 800,
                  "Q": 0.5
                },
                "distortion": 2,
                "delay": {
                  "time": 0,
                  "feedback": 0
                },
                "reverb": 0,
                "bitcrusher": 0.5,
                "pan": 0
              }
            },
            "Coin": {
              "waveform": "sine",
              "frequency": 1047,
              "duration": 0.1,
              "envelope": {
                "attack": 0.001,
                "decay": 0.08,
                "sustain": 0,
                "release": 0.01
              },
              "pitchEnvelope": {
                "start": 1,
                "end": 1.5,
                "time": 0.1
              },
              "effects": {
                "filter": {
                  "type": "bandpass",
                  "frequency": 1300,
                  "Q": 1
                },
                "distortion": 0,
                "delay": {
                  "time": 0,
                  "feedback": 0
                },
                "reverb": 0,
                "bitcrusher": 0.5,
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