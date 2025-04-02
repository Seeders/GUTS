class AudioEditor {
    constructor(gameEditor) {
        this.gameEditor = gameEditor;
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.sampleRate = 44100; // Standard CD-quality sample rate
        this.setupEventListeners();
    }

    setupEventListeners() {

        document.body.addEventListener('editAudio', async (event) => {
            this.audioDataBase64 = event.detail.data;
          	this.savePropertyName = event.detail.propertyName;
            this.audioBuffer = await this.importFromBase64(this.audioDataBase64);
  
            const source = this.audioContext.createBufferSource();
            source.buffer = this.audioBuffer;
            source.connect(this.audioContext.destination);
            source.start();
        });
        // Play button event
        document.getElementById('playBtn').addEventListener('click', () => {
            const waveform = document.getElementById('waveform').value;
            const frequency = parseFloat(document.getElementById('frequency').value);
            const duration = parseFloat(document.getElementById('duration').value);
            this.playAudio(waveform, frequency, duration);
        });

        // Export button event
        document.getElementById('exportBtn').addEventListener('click', () => {
            const waveform = document.getElementById('waveform').value;
            const frequency = parseFloat(document.getElementById('frequency').value);
            const duration = parseFloat(document.getElementById('duration').value);
            const jsonData = this.exportToBase64(waveform, frequency, duration);
            this.saveAudio(jsonData);
        });
    }   

    // Play a audio with given waveform, frequency, and duration
    playAudio(waveform, frequency, duration) {
        const oscillator = this.audioContext.createOscillator();
        oscillator.type = waveform;
        oscillator.frequency.setValueAtTime(frequency, this.audioContext.currentTime);
        oscillator.connect(this.audioContext.destination);
        oscillator.start();
        oscillator.stop(this.audioContext.currentTime + duration);
    }

    // Export audio as Base64-encoded JSON
    exportToBase64(waveform, frequency, duration) {
        // Generate raw audio data
        const buffer = new Float32Array(Math.floor(this.sampleRate * duration));
        for (let i = 0; i < buffer.length; i++) {
            const t = i / this.sampleRate;
            buffer[i] = this.generateWaveform(waveform, frequency, t);
        }

        // Convert to WAV
        const wavData = this.createWavFile(buffer, this.sampleRate);
        const base64String = btoa(wavData);

        // Return JSON object
        return base64String;
    }
    async importFromBase64(base64String, mimeType = "audio/wav") {
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
        return fetch(url)
            .then(response => response.arrayBuffer())
            .then(arrayBuffer => this.audioContext.decodeAudioData(arrayBuffer))           
            .catch(err => console.error('Error importing Base64 audio:', err));
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

        // Write PCM samples
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
        if (!this.gameEditor.state.selectedObject) {
            console.warn("No selected object to save script to");
            return;
        }
        // Create a custom event with data
        const myCustomEvent = new CustomEvent('saveAudio', {
            detail: { data: audio, propertyName: this.savePropertyName }, 
            bubbles: true, 
            cancelable: true 
        });

        // Dispatch the event
        document.body.dispatchEvent(myCustomEvent);
    }
}