class AudioEditor {
    constructor(gameEditor) {
        this.gameEditor = gameEditor;
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 96000 }); // Higher sample rate
        this.sampleRate = 96000; // 96 kHz for professional quality
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
        // Enhanced compressor settings
        this.compressor = this.audioContext.createDynamicsCompressor();
        this.compressor.threshold.value = -24; // dB
        this.compressor.knee.value = 30; // dB
        this.compressor.ratio.value = 12; // 12:1
        this.compressor.attack.value = 0.003; // seconds
        this.compressor.release.value = 0.25; // seconds

        // High-quality biquad filter
        this.biquadFilter = this.audioContext.createBiquadFilter();
        this.biquadFilter.type = "lowpass";
        this.biquadFilter.frequency.value = 1000;
        this.biquadFilter.Q.value = 1.0; // Add resonance control

        // Delay with feedback limiting
        this.delay = this.audioContext.createDelay(5.0);
        this.delay.delayTime.value = 0.3;
        this.delayGain = this.audioContext.createGain();
        this.delayGain.gain.value = 0.3;

        // Connect effect chain with feedback loop
        this.delay.connect(this.delayGain);
        this.delayGain.connect(this.delay); // Feedback loop
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
        // Helper function to update status message
        const updateStatus = (message, type = 'default') => {
            const status = document.getElementById('status-message');
            if (status) {
                status.textContent = message;
                status.className = type === 'success' ? 'success' : type === 'error' ? 'error' : '';
            }
        };

        // Update slider displays dynamically
        const updateSliderDisplay = (sliderId, formatFn) => {
            const slider = document.getElementById(sliderId);
            if (slider) {
                slider.addEventListener('input', (e) => {
                    const display = slider.nextElementSibling;
                    if (display && display.classList.contains('value-display')) {
                        display.textContent = formatFn(parseFloat(e.target.value));
                    }
                });
            }
        };

        // Import audio event
        document.body.addEventListener('editAudio', async (event) => {
            this.stopAudio();
            this.audioDataBase64 = event.detail.data;
            this.savePropertyName = event.detail.propertyName;
            try {
                this.audioBuffer = await this.importFromBase64(this.audioDataBase64);
                this.updateUIFromAudio();
                this.playAudioBuffer(this.audioBuffer);
                if (this.visualizer) this.visualizer.drawWaveform(this.audioBuffer);
                updateStatus('Audio imported and playing', 'success');
            } catch (err) {
                updateStatus('Error importing audio', 'error');
            }
        });

        // Play button event
        const playBtn = document.getElementById('playBtn');
        const stopBtn = document.getElementById('stopBtn');
        playBtn?.addEventListener('click', () => {
            this.stopAudio();
            const waveform = document.getElementById('waveform').value;
            const frequency = parseFloat(document.getElementById('frequency').value);
            const duration = parseFloat(document.getElementById('duration').value);
            const attack = parseFloat(document.getElementById('attack').value || 0.01);
            const decay = parseFloat(document.getElementById('decay').value || 0.1);
            const sustain = parseFloat(document.getElementById('sustain').value || 0.7);
            const release = parseFloat(document.getElementById('release').value || 0.3);

            this.playAudio(waveform, frequency, duration, { attack, decay, sustain, release });
            updateStatus('Playing audio...');
            playBtn.disabled = true;
            stopBtn.disabled = false;
        });

        // Stop button event
        stopBtn?.addEventListener('click', () => {
            this.stopAudio();
            updateStatus('Audio stopped');
            playBtn.disabled = false;
            stopBtn.disabled = true;
        });

        // Export button event
        document.getElementById('exportBtn')?.addEventListener('click', () => {
            const waveform = document.getElementById('waveform').value;
            const frequency = parseFloat(document.getElementById('frequency').value);
            const duration = parseFloat(document.getElementById('duration').value);
            const attack = parseFloat(document.getElementById('attack').value || 0.01);
            const decay = parseFloat(document.getElementById('decay').value || 0.1);
            const sustain = parseFloat(document.getElementById('sustain').value || 0.7);
            const release = parseFloat(document.getElementById('release').value || 0.3);
            const effects = this.getEffectsSettings();

            const base64String = this.exportToBase64(waveform, frequency, duration, { attack, decay, sustain, release }, effects);
            document.getElementById('jsonOutput').value = base64String;
            this.saveAudio(base64String);
            updateStatus('Audio saved successfully', 'success');
        });

        // Volume slider
        updateSliderDisplay('volume', (val) => `${Math.round(val * 100)}%`);
        document.getElementById('volume')?.addEventListener('input', (e) => {
            const volume = parseFloat(e.target.value);
            this.masterGainNode.gain.setValueAtTime(volume, this.audioContext.currentTime);
        });

        // Other sliders
        updateSliderDisplay('frequency', (val) => `${val} Hz`);
        updateSliderDisplay('duration', (val) => `${val.toFixed(1)} s`);
        updateSliderDisplay('attack', (val) => `${val.toFixed(2)} s`);
        updateSliderDisplay('decay', (val) => `${val.toFixed(2)} s`);
        updateSliderDisplay('sustain', (val) => `${Math.round(val * 100)}%`);
        updateSliderDisplay('release', (val) => `${val.toFixed(2)} s`);
        updateSliderDisplay('filterCutoff', (val) => `${val} Hz`);
        updateSliderDisplay('delayAmount', (val) => `${Math.round(val * 100)}%`);

        // Filter cutoff
        document.getElementById('filterCutoff')?.addEventListener('input', (e) => {
            this.biquadFilter.frequency.value = parseFloat(e.target.value);
        });

        // Delay amount
        document.getElementById('delayAmount')?.addEventListener('input', (e) => {
            this.delayGain.gain.value = parseFloat(e.target.value);
        });

        // Preset selection
        document.getElementById('presetSelect')?.addEventListener('change', (e) => {
            const presetName = e.target.value;
            if (presetName && this.presets[presetName]) {
                this.loadPreset(presetName);
                updateStatus(`Loaded preset: ${presetName}`, 'success');
            }
        });

        // Save preset button
        document.getElementById('savePresetBtn')?.addEventListener('click', () => {
            const presetName = document.getElementById('presetName').value.trim();
            if (presetName) {
                this.savePreset(presetName);
                updateStatus(`Preset "${presetName}" saved`, 'success');
            } else {
                updateStatus('Please enter a preset name', 'error');
            }
        });

        // Initialize visualizer
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
        const playBtn = document.getElementById('playBtn');
        const stopBtn = document.getElementById('stopBtn');
        if (playBtn) playBtn.disabled = false;
        if (stopBtn) stopBtn.disabled = true;
    }

    playAudioBuffer(buffer) {
        this.stopAudio();

        const source = this.audioContext.createBufferSource();
        source.buffer = buffer;

        // Connect processing chain correctly
        source.connect(this.biquadFilter); // Start with filter
        // biquadFilter -> compressor -> masterGainNode (already connected in setupEffects)
        if (parseFloat(document.getElementById('delayAmount').value) > 0) {
            this.compressor.connect(this.delay); // Add delay if enabled
        }

        source.start();
        this.currentSource = source;
        this.isPlaying = true;

        if (this.visualizer) {
            this.visualizer.connectSource(source);
        }

        const playBtn = document.getElementById('playBtn');
        if (playBtn) playBtn.textContent = "Playing...";

        source.onended = () => {
            this.isPlaying = false;
            this.currentSource = null;
            if (playBtn) playBtn.textContent = "Play";
        };
    }

    playAudio(waveform, frequency, duration, envelope) {
        this.stopAudio();

        const oscillator = this.audioContext.createOscillator();
        oscillator.type = waveform;

        const now = this.audioContext.currentTime;
        oscillator.frequency.setValueAtTime(frequency, now);
        oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.9, now + duration);

        const envelopeGain = this.audioContext.createGain();
        envelopeGain.gain.setValueAtTime(0, now);
        envelopeGain.gain.linearRampToValueAtTime(1, now + envelope.attack + 0.005); // 5ms fade-in
        envelopeGain.gain.linearRampToValueAtTime(envelope.sustain, now + envelope.attack + envelope.decay);
        envelopeGain.gain.setValueAtTime(envelope.sustain, now + duration);
        const releaseEndTime = now + duration + envelope.release + 0.2; // 200ms buffer
        envelopeGain.gain.linearRampToValueAtTime(0, releaseEndTime);

        // Set filter and delay
        this.biquadFilter.frequency.value = parseFloat(document.getElementById('filterCutoff').value) || 1000;
        this.delay.delayTime.value = 0.25;
        const initialDelayGain = parseFloat(document.getElementById('delayAmount').value) || 0;
        this.delayGain.gain.setValueAtTime(initialDelayGain, now);

        // Connect processing chain
        oscillator.connect(envelopeGain);
        envelopeGain.connect(this.biquadFilter);
        this.biquadFilter.connect(this.compressor);
        this.compressor.connect(this.masterGainNode);
        this.compressor.connect(this.delay);
        this.delay.connect(this.delayGain);
        this.delayGain.connect(this.masterGainNode); // Ensure delay output goes to master

        // Start oscillator
        oscillator.start(now);
        const stopTime = releaseEndTime + 0.2; // 200ms after envelope fade
        oscillator.stop(stopTime);

        // Fade out delay and master gain, extending to cover release
        const fadeOutTime = now + duration + envelope.release + 1.0; // 1-second fade-out
        this.delayGain.gain.linearRampToValueAtTime(0, fadeOutTime);
        this.masterGainNode.gain.linearRampToValueAtTime(0, fadeOutTime);
        this.masterGainNode.gain.linearRampToValueAtTime(
            parseFloat(document.getElementById('volume').value) || 0.7,
            fadeOutTime + 0.1
        ); // Restore volume

        this.currentSource = oscillator;
        this.isPlaying = true;

        if (this.visualizer) {
            this.visualizer.connectSource(oscillator);
        }

        const playBtn = document.getElementById('playBtn');
        const stopBtn = document.getElementById('stopBtn');
        if (playBtn) playBtn.disabled = true;
        if (stopBtn) stopBtn.disabled = false;

        oscillator.onended = () => {
            this.isPlaying = false;
            this.currentSource = null;
            if (playBtn) playBtn.disabled = false;
            if (stopBtn) stopBtn.disabled = true;

            // Safe cleanup
            envelopeGain.gain.setValueAtTime(0.001, this.audioContext.currentTime);
            this.delayGain.gain.setValueAtTime(0.001, this.audioContext.currentTime);
            try {
                this.delay.disconnect(this.delayGain); 
            } catch (e) {
                console.log("Delay disconnect skipped:", e.message); // Log if already disconnected
            }
        };

        // Debug logging
        console.log("Now:", now);
        console.log("Release End:", releaseEndTime);
        console.log("Stop Time:", stopTime);
        console.log("Fade Out Time:", fadeOutTime);
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
    polyBLEP(t, dt) {
        if (t < dt) {
            const x = t / dt;
            return x + x - x * x - 1;
        } else if (t > 1 - dt) {
            const x = (t - 1) / dt;
            return x + x + x * x + 1;
        }
        return 0;
    }
    downsampleBuffer(buffer, factor) {
        const targetLength = Math.floor(buffer.length / factor);
        const result = new Float32Array(targetLength);

        for (let i = 0; i < targetLength; i++) {
            const srcIdx = i * factor;
            result[i] = buffer[srcIdx]; // Basic decimation (could use better filtering)
        }
        return result;
    }
    generateAudioBuffer(waveform, frequency, duration, envelope) {
        const oversampleFactor = 4;
        const totalSamples = Math.floor(this.sampleRate * (duration + envelope.release) * oversampleFactor);
        const buffer = new Float32Array(totalSamples);

        const attackSamples = Math.floor(this.sampleRate * envelope.attack * oversampleFactor);
        const decaySamples = Math.floor(this.sampleRate * envelope.decay * oversampleFactor);
        const sustainSamples = Math.floor(this.sampleRate * (duration - envelope.attack - envelope.decay) * oversampleFactor);
        const releaseSamples = Math.floor(this.sampleRate * envelope.release * oversampleFactor);

        for (let i = 0; i < totalSamples; i++) {
            const t = i / (this.sampleRate * oversampleFactor);
            let amplitude = 0;

            if (i < attackSamples) {
                amplitude = i / attackSamples;
            } else if (i < attackSamples + decaySamples) {
                const decayProgress = (i - attackSamples) / decaySamples;
                amplitude = 1 - (1 - envelope.sustain) * decayProgress;
            } else if (i < attackSamples + decaySamples + sustainSamples) {
                amplitude = envelope.sustain;
            } else {
                const releaseProgress = (i - (attackSamples + decaySamples + sustainSamples)) / releaseSamples;
                amplitude = envelope.sustain * (1 - releaseProgress);
            }

            buffer[i] = this.generateWaveform(waveform, frequency, t, oversampleFactor) * amplitude;
        }

        // Downsample to target sample rate
        return this.downsampleBuffer(buffer, oversampleFactor);
    }

    applyEffectsToBuffer(buffer, effects) {
        let processedBuffer = new Float32Array(buffer);

        // Apply filter (simplified IIR lowpass for demonstration)
        if (effects.filter && effects.filter.frequency < 20000) {
            const cutoff = effects.filter.frequency / this.sampleRate;
            const alpha = Math.sin(Math.PI * cutoff) / (2 * 0.707); // Q = 0.707
            const cosw = Math.cos(Math.PI * cutoff);
            const a0 = 1 + alpha;
            const b0 = ((1 - cosw) / 2) / a0;
            const b1 = (1 - cosw) / a0;
            const b2 = b0;
            const a1 = (-2 * cosw) / a0;
            const a2 = (1 - alpha) / a0;

            const output = new Float32Array(buffer.length);
            output[0] = b0 * buffer[0];
            output[1] = b0 * buffer[1] + b1 * buffer[0] - a1 * output[0];

            for (let i = 2; i < buffer.length; i++) {
                output[i] = (b0 * buffer[i] + b1 * buffer[i - 1] + b2 * buffer[i - 2] -
                            a1 * output[i - 1] - a2 * output[i - 2]);
            }
            processedBuffer = output;
        }

        // Apply delay (simplified)
        if (effects.delay && effects.delay.feedback > 0) {
            const delaySamples = Math.floor(this.sampleRate * effects.delay.time);
            const output = new Float32Array(processedBuffer.length);
            for (let i = 0; i < processedBuffer.length; i++) {
                const delayedIdx = i - delaySamples;
                output[i] = processedBuffer[i] + (delayedIdx >= 0 ? effects.delay.feedback * output[delayedIdx] : 0);
            }
            processedBuffer = output;
        }

        return processedBuffer;
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
    generateWaveform(type, frequency, t, oversampleFactor = 4) {
        const effectiveSampleRate = this.sampleRate * oversampleFactor;
        const angularFrequency = 2 * Math.PI * frequency;

        switch (type) {
            case 'sine':
                return Math.sin(angularFrequency * t);
            case 'square':
                const sine = Math.sin(angularFrequency * t);
                const p = 2 * frequency / effectiveSampleRate;
                return sine > 0 ? 1 - this.polyBLEP(t, p) : -1 + this.polyBLEP(t, p);
            case 'sawtooth':
                const saw = 2 * (t * frequency - Math.floor(t * frequency + 0.5));
                return saw - this.polyBLEP(t, frequency / effectiveSampleRate);
            case 'triangle':
                return 2 * Math.abs(2 * (t * frequency - Math.floor(t * frequency + 0.5))) - 1;
            case 'noise':
                return Math.random() * 2 - 1;
            default:
                return 0;
        }
    }

    // Create WAV file (mono, 16-bit PCM)
    createWavFile(buffer, sampleRate) {
        const numSamples = buffer.length;
        const byteRate = sampleRate * 3; // 24-bit mono
        const blockAlign = 3; // 24-bit mono
        const dataSize = numSamples * 3;

        const arrayBuffer = new ArrayBuffer(44 + dataSize);
        const view = new DataView(arrayBuffer);

        // RIFF header
        this.writeString(view, 0, 'RIFF');
        view.setUint32(4, 36 + dataSize, true);
        this.writeString(view, 8, 'WAVE');

        // fmt chunk
        this.writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true); // PCM
        view.setUint16(22, 1, true); // Mono
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, byteRate, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, 24, true); // 24-bit

        // data chunk
        this.writeString(view, 36, 'data');
        view.setUint32(40, dataSize, true);

        // Write 24-bit PCM samples
        for (let i = 0; i < numSamples; i++) {
            const sample = Math.max(-1, Math.min(1, buffer[i]));
            const intSample = Math.floor(sample * 0x7FFFFF); // 24-bit range
            view.setUint8(44 + i * 3, intSample & 0xFF);
            view.setUint8(45 + i * 3, (intSample >> 8) & 0xFF);
            view.setUint8(46 + i * 3, (intSample >> 16) & 0xFF);
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