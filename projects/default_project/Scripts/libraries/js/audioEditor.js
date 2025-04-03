class AudioEditor {
    constructor(gameEditor) {
        this.gameEditor = gameEditor;
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.sampleRate = 44100; // Standard CD-quality sample rate
        this.masterGainNode = this.audioContext.createGain();
        this.masterGainNode.connect(this.audioContext.destination);
        this.currentSource = null;
        this.isPlaying = false;
        this.visualizer = null;
        this.setupEventListeners();
        this.setupEffects();
        this.presets = this.createDefaultPresets();
    }

    setupEffects() {
        // Create audio effects nodes
        this.compressor = this.audioContext.createDynamicsCompressor();
        this.biquadFilter = this.audioContext.createBiquadFilter();
        this.biquadFilter.type = "lowpass";
        this.biquadFilter.frequency.value = 1000;
        
        // Delay effect
        this.delay = this.audioContext.createDelay(5.0);
        this.delay.delayTime.value = 0.3;
        this.delayGain = this.audioContext.createGain();
        this.delayGain.gain.value = 0.3;
        
        // Connect effect chain
        this.delay.connect(this.delayGain);
        this.delayGain.connect(this.delay);
        this.delayGain.connect(this.masterGainNode);
    }

    createDefaultPresets() {
        return {
            "Bass Drum": { waveform: "sine", frequency: 60, duration: 0.3, envelope: { attack: 0.01, decay: 0.2, sustain: 0.2, release: 0.1 } },
            "Hi-Hat": { waveform: "square", frequency: 800, duration: 0.1, envelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.02 } },
            "Synth Lead": { waveform: "sawtooth", frequency: 440, duration: 1, envelope: { attack: 0.05, decay: 0.2, sustain: 0.6, release: 0.4 } },
            "Low Rumble": { waveform: "triangle", frequency: 40, duration: 2, envelope: { attack: 0.5, decay: 1, sustain: 0.5, release: 1 } }
        };
    }

    setupEventListeners() {
        // Import audio event
        document.body.addEventListener('editAudio', async (event) => {
            this.stopAudio(); // Stop any currently playing audio
            this.audioDataBase64 = event.detail.data;
            this.savePropertyName = event.detail.propertyName;
            this.audioBuffer = await this.importFromBase64(this.audioDataBase64);
            
            // Update UI with audio data
            this.updateUIFromAudio();
            
            // Play the imported audio
            this.playAudioBuffer(this.audioBuffer);
            
            // Draw waveform if visualizer is set up
            if (this.visualizer) {
                this.visualizer.drawWaveform(this.audioBuffer);
            }
        });

        // Play button event
        document.getElementById('playBtn').addEventListener('click', () => {
            this.stopAudio(); // Stop any currently playing sound
            
            const waveform = document.getElementById('waveform').value;
            const frequency = parseFloat(document.getElementById('frequency').value);
            const duration = parseFloat(document.getElementById('duration').value);
            
            // Get ADSR values
            const attack = parseFloat(document.getElementById('attack').value || 0.01);
            const decay = parseFloat(document.getElementById('decay').value || 0.1);
            const sustain = parseFloat(document.getElementById('sustain').value || 0.7);
            const release = parseFloat(document.getElementById('release').value || 0.3);
            
            this.playAudio(waveform, frequency, duration, { attack, decay, sustain, release });
        });

        // Stop button event
        document.getElementById('stopBtn').addEventListener('click', () => {
            this.stopAudio();
        });

        // Export button event
        document.getElementById('exportBtn').addEventListener('click', () => {
            const waveform = document.getElementById('waveform').value;
            const frequency = parseFloat(document.getElementById('frequency').value);
            const duration = parseFloat(document.getElementById('duration').value);
            
            // Get ADSR values
            const attack = parseFloat(document.getElementById('attack').value || 0.01);
            const decay = parseFloat(document.getElementById('decay').value || 0.1);
            const sustain = parseFloat(document.getElementById('sustain').value || 0.7);
            const release = parseFloat(document.getElementById('release').value || 0.3);
            
            // Get effects settings
            const effects = this.getEffectsSettings();
            
            const base64String = this.exportToBase64(waveform, frequency, duration, 
                { attack, decay, sustain, release }, effects);
            
            document.getElementById('jsonOutput').value = base64String;
            this.saveAudio(base64String);
        });

        // Volume slider event
        document.getElementById('volume').addEventListener('input', (e) => {
            const volume = parseFloat(e.target.value);
            this.masterGainNode.gain.value = volume;
        });

        // Filter cutoff event
        document.getElementById('filterCutoff').addEventListener('input', (e) => {
            this.biquadFilter.frequency.value = parseFloat(e.target.value);
        });

        // Delay amount event
        document.getElementById('delayAmount').addEventListener('input', (e) => {
            this.delayGain.gain.value = parseFloat(e.target.value);
        });

        // Preset selection
        document.getElementById('presetSelect').addEventListener('change', (e) => {
            const presetName = e.target.value;
            if (presetName && this.presets[presetName]) {
                this.loadPreset(presetName);
            }
        });

        // Save preset button
        document.getElementById('savePresetBtn').addEventListener('click', () => {
            const presetName = document.getElementById('presetName').value.trim();
            if (presetName) {
                this.savePreset(presetName);
            } else {
                alert("Please enter a preset name");
            }
        });

        // Initialize visualizer if canvas exists
        const canvas = document.getElementById('waveformCanvas');
        if (canvas) {
            this.visualizer = new AudioVisualizer(canvas, this.audioContext);
        }
    }

    getEffectsSettings() {
        return {
            filter: {
                type: document.getElementById('filterType').value,
                frequency: parseFloat(document.getElementById('filterCutoff').value)
            },
            delay: {
                time: this.delay.delayTime.value,
                feedback: this.delayGain.gain.value
            },
            compressor: {
                threshold: this.compressor.threshold.value,
                ratio: this.compressor.ratio.value
            }
        };
    }

    savePreset(name) {
        const waveform = document.getElementById('waveform').value;
        const frequency = parseFloat(document.getElementById('frequency').value);
        const duration = parseFloat(document.getElementById('duration').value);
        
        const attack = parseFloat(document.getElementById('attack').value || 0.01);
        const decay = parseFloat(document.getElementById('decay').value || 0.1);
        const sustain = parseFloat(document.getElementById('sustain').value || 0.7);
        const release = parseFloat(document.getElementById('release').value || 0.3);
        
        const effects = this.getEffectsSettings();
        
        this.presets[name] = {
            waveform,
            frequency,
            duration,
            envelope: { attack, decay, sustain, release },
            effects
        };
        
        // Update presets dropdown
        this.updatePresetsDropdown();
        
        // Save presets to localStorage
        localStorage.setItem('audioEditorPresets', JSON.stringify(this.presets));
    }
    
    loadPreset(name) {
        const preset = this.presets[name];
        if (!preset) return;
        
        // Update UI with preset values
        document.getElementById('waveform').value = preset.waveform;
        document.getElementById('frequency').value = preset.frequency;
        document.getElementById('duration').value = preset.duration;
        
        // Update ADSR if available
        if (preset.envelope) {
            document.getElementById('attack').value = preset.envelope.attack;
            document.getElementById('decay').value = preset.envelope.decay;
            document.getElementById('sustain').value = preset.envelope.sustain;
            document.getElementById('release').value = preset.envelope.release;
        }
        
        // Update effects if available
        if (preset.effects) {
            if (preset.effects.filter) {
                document.getElementById('filterType').value = preset.effects.filter.type;
                document.getElementById('filterCutoff').value = preset.effects.filter.frequency;
                this.biquadFilter.type = preset.effects.filter.type;
                this.biquadFilter.frequency.value = preset.effects.filter.frequency;
            }
            
            if (preset.effects.delay) {
                document.getElementById('delayAmount').value = preset.effects.delay.feedback;
                this.delay.delayTime.value = preset.effects.delay.time;
                this.delayGain.gain.value = preset.effects.delay.feedback;
            }
        }
    }
    
    updatePresetsDropdown() {
        const select = document.getElementById('presetSelect');
        // Clear existing options
        select.innerHTML = '<option value="">-- Select Preset --</option>';
        
        // Add options for each preset
        Object.keys(this.presets).forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            select.appendChild(option);
        });
    }

    updateUIFromAudio() {
        // This would analyze the audio buffer and update UI controls
        // Based on detected pitch, waveform type, etc.
        // This is a complex feature that would require audio analysis
        console.log("Audio analysis and UI update would happen here");
    }

    stopAudio() {
        if (this.currentSource) {
            this.currentSource.stop();
            this.currentSource = null;
        }
        this.isPlaying = false;
        
        // Update play button text/icon
        const playBtn = document.getElementById('playBtn');
        if (playBtn) {
            playBtn.textContent = "Play Sound";
        }
    }

    // Play audio buffer (for imported audio)
    playAudioBuffer(buffer) {
        this.stopAudio();
        
        const source = this.audioContext.createBufferSource();
        source.buffer = buffer;
        
        // Set up processing chain
        source.connect(this.biquadFilter);
        this.biquadFilter.connect(this.compressor);
        this.compressor.connect(this.masterGainNode);
        
        // Connect delay if enabled
        if (parseFloat(document.getElementById('delayAmount').value) > 0) {
            this.compressor.connect(this.delay);
        }
        
        // Start playback
        source.start();
        this.currentSource = source;
        this.isPlaying = true;
        
        // Connect to visualizer if available
        if (this.visualizer) {
            this.visualizer.connectSource(source);
        }
        
        // Update play button
        const playBtn = document.getElementById('playBtn');
        if (playBtn) {
            playBtn.textContent = "Playing...";
        }
        
        // Auto-stop when finished
        source.onended = () => {
            this.isPlaying = false;
            this.currentSource = null;
            if (playBtn) {
                playBtn.textContent = "Play Sound";
            }
        };
    }

    // Play a synthesized sound with given parameters
    playAudio(waveform, frequency, duration, envelope) {
        this.stopAudio();
        
        // Create oscillator
        const oscillator = this.audioContext.createOscillator();
        oscillator.type = waveform;
        oscillator.frequency.setValueAtTime(frequency, this.audioContext.currentTime);
        
        // Create envelope
        const envelopeGain = this.audioContext.createGain();
        envelopeGain.gain.setValueAtTime(0, this.audioContext.currentTime);
        
        // ADSR envelope implementation
        const now = this.audioContext.currentTime;
        envelopeGain.gain.linearRampToValueAtTime(1, now + envelope.attack);
        envelopeGain.gain.linearRampToValueAtTime(envelope.sustain, now + envelope.attack + envelope.decay);
        envelopeGain.gain.setValueAtTime(envelope.sustain, now + duration);
        envelopeGain.gain.linearRampToValueAtTime(0, now + duration + envelope.release);
        
        // Connect processing chain
        oscillator.connect(envelopeGain);
        envelopeGain.connect(this.biquadFilter);
        this.biquadFilter.connect(this.compressor);
        this.compressor.connect(this.masterGainNode);
        
        // Connect delay if enabled
        if (parseFloat(document.getElementById('delayAmount').value) > 0) {
            this.compressor.connect(this.delay);
        }
        
        // Start and schedule stop
        oscillator.start();
        oscillator.stop(this.audioContext.currentTime + duration + envelope.release);
        
        this.currentSource = oscillator;
        this.isPlaying = true;
        
        // Connect to visualizer if available
        if (this.visualizer) {
            this.visualizer.connectSource(oscillator);
        }
        
        // Update UI
        const playBtn = document.getElementById('playBtn');
        if (playBtn) {
            playBtn.textContent = "Playing...";
        }
        
        // Reset UI when finished
        oscillator.onended = () => {
            this.isPlaying = false;
            this.currentSource = null;
            if (playBtn) {
                playBtn.textContent = "Play Sound";
            }
        };
    }

    // Export audio as Base64-encoded JSON
    exportToBase64(waveform, frequency, duration, envelope, effects) {
        // Generate raw audio data
        const buffer = this.generateAudioBuffer(waveform, frequency, duration, envelope);
        
        // Apply effects to buffer if needed
        const processedBuffer = this.applyEffectsToBuffer(buffer, effects);
        
        // Convert to WAV
        const wavData = this.createWavFile(processedBuffer, this.sampleRate);
        const base64String = btoa(wavData);
        
        // Create metadata
        const metadata = {
            type: "audio",
            format: "wav",
            params: {
                waveform,
                frequency,
                duration,
                envelope,
                effects
            }
        };
        
        // Return just the base64 string (metadata could be included as needed)
        return base64String;
    }
    
    generateAudioBuffer(waveform, frequency, duration, envelope) {
        const totalSamples = Math.floor(this.sampleRate * (duration + envelope.release));
        const buffer = new Float32Array(totalSamples);
        
        const attackSamples = Math.floor(this.sampleRate * envelope.attack);
        const decaySamples = Math.floor(this.sampleRate * envelope.decay);
        const sustainSamples = Math.floor(this.sampleRate * (duration - envelope.attack - envelope.decay));
        const releaseSamples = Math.floor(this.sampleRate * envelope.release);
        
        for (let i = 0; i < buffer.length; i++) {
            const t = i / this.sampleRate;
            let amplitude = 0;
            
            // Apply ADSR envelope
            if (i < attackSamples) {
                // Attack phase
                amplitude = i / attackSamples;
            } else if (i < attackSamples + decaySamples) {
                // Decay phase
                const decayProgress = (i - attackSamples) / decaySamples;
                amplitude = 1 - (1 - envelope.sustain) * decayProgress;
            } else if (i < attackSamples + decaySamples + sustainSamples) {
                // Sustain phase
                amplitude = envelope.sustain;
            } else {
                // Release phase
                const releaseProgress = (i - (attackSamples + decaySamples + sustainSamples)) / releaseSamples;
                amplitude = envelope.sustain * (1 - releaseProgress);
            }
            
            buffer[i] = this.generateWaveform(waveform, frequency, t) * amplitude;
        }
        
        return buffer;
    }
    
    applyEffectsToBuffer(buffer, effects) {
        // This is a simplified version - in a real app, these would be proper DSP implementations
        // For now, we'll just return the original buffer
        return buffer;
        
        // Real implementation would apply filter, delay, etc. using DSP algorithms
        // Example (pseudocode):
        // let processedBuffer = applyFilter(buffer, effects.filter);
        // processedBuffer = applyDelay(processedBuffer, effects.delay);
        // return processedBuffer;
    }

    async importFromBase64(base64String, mimeType = "audio/wav") {
        try {
            // Decode Base64 to binary string
            const binaryString = atob(base64String);
            
            // Convert binary string to Uint8Array
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }

            // Create a Blob from the binary data
            const blob = new Blob([bytes], { type: mimeType });
            const url = URL.createObjectURL(blob);

            // Play using Web Audio API
            const response = await fetch(url);
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
            
            // Clean up
            URL.revokeObjectURL(url);
            
            return audioBuffer;
        } catch (err) {
            console.error('Error importing Base64 audio:', err);
            throw err;
        }
    }

    // Generate waveform sample
    generateWaveform(type, frequency, t) {
        const angularFrequency = 2 * Math.PI * frequency;
        switch (type) {
            case 'sine':
                return Math.sin(angularFrequency * t);
            case 'square':
                return Math.sin(angularFrequency * t) > 0 ? 1 : -1;
            case 'sawtooth':
                return 2 * (t * frequency - Math.floor(t * frequency + 0.5));
            case 'triangle':
                return 2 * Math.abs(2 * (t * frequency - Math.floor(t * frequency + 0.5))) - 1;
            case 'noise':
                return Math.random() * 2 - 1; // White noise
            default:
                return 0;
        }
    }

    // Create WAV file (mono, 16-bit PCM)
    createWavFile(buffer, sampleRate) {
        const numSamples = buffer.length;
        const byteRate = sampleRate * 2; // 16-bit mono
        const blockAlign = 2; // 16-bit mono
        const dataSize = numSamples * 2;

        const arrayBuffer = new ArrayBuffer(44 + dataSize);
        const view = new DataView(arrayBuffer);

        // RIFF header
        this.writeString(view, 0, 'RIFF');
        view.setUint32(4, 36 + dataSize, true);
        this.writeString(view, 8, 'WAVE');

        // fmt chunk
        this.writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true); // Subchunk size
        view.setUint16(20, 1, true); // PCM format
        view.setUint16(22, 1, true); // Mono
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, byteRate, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, 16, true); // Bits per sample

        // data chunk
        this.writeString(view, 36, 'data');
        view.setUint32(40, dataSize, true);

        // Write PCM samples with clipping prevention
        for (let i = 0; i < numSamples; i++) {
            const sample = Math.max(-1, Math.min(1, buffer[i]));
            view.setInt16(44 + i * 2, sample * 0x7FFF, true);
        }

        return String.fromCharCode.apply(null, new Uint8Array(arrayBuffer));
    }

    writeString(view, offset, string) {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    }

    saveAudio(audio) {
        if (!this.gameEditor.getCurrentObject()) {
            console.warn("No selected object to save audio to");
            return;
        }
        
        // Create a custom event with data
        const myCustomEvent = new CustomEvent('saveAudio', {
            detail: { 
                data: audio, 
                propertyName: this.savePropertyName || 'audio' 
            }, 
            bubbles: true, 
            cancelable: true 
        });

        // Dispatch the event
        document.body.dispatchEvent(myCustomEvent);
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