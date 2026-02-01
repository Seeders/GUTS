/**
 * MusicSystem - A data-driven music sequencer for procedural/synth music
 *
 * Loads music tracks from collections and plays them using the Web Audio API.
 * Designed to be extended by project-specific music systems.
 *
 * Music data structure (in collections):
 * - music/tracks: Song definitions with tempo, scale, instruments, patterns
 * - music/instruments: Synth instrument definitions (oscillator, envelope, effects)
 * - music/patterns: Reusable melodic/rhythmic patterns
 */
class MusicSystem extends GUTS.BaseSystem {
    static services = [
        'playTrack',
        'stopTrack',
        'pauseTrack',
        'resumeTrack',
        'isPlaying',
        'setMusicVolume',
        'getMusicVolume',
        'getCurrentTrack'
    ];

    static serviceDependencies = ['getAudioManager'];

    constructor(game) {
        super(game);

        // Audio state
        this.audioContext = null;
        this.musicGain = null;
        this.musicLimiter = null;
        this.musicOutput = null; // The node where voices connect (gain or limiter)
        this.musicVolume = 0.3; // Lower default to leave headroom for SFX

        // Playback state
        this.isInitialized = false;
        this.playing = false;
        this.paused = false;
        this.currentTrack = null;

        // Sequencer state
        this.schedulerTimer = null;
        this.nextNoteTime = 0;
        this.currentStep = 0;
        this.scheduleAheadTime = 0.1; // Schedule 100ms ahead
        this.lookahead = 25; // Check every 25ms

        // Collections cache
        this.tracks = {};
        this.instruments = {};
        this.patterns = {};

        // Musical constants
        this.noteFrequencies = this.buildNoteFrequencies();
    }

    init() {
        console.log('[MusicSystem] Initializing...');
        this.loadMusicCollections();
    }

    /**
     * Load music data from collections
     */
    loadMusicCollections() {
        const collections = this.game.getCollections?.() || {};

        // Load tracks, instruments, patterns from collections
        this.tracks = collections.tracks || {};
        this.instruments = collections.instruments || {};
        this.patterns = collections.patterns || {};

        console.log('[MusicSystem] Loaded:', {
            tracks: Object.keys(this.tracks).length,
            instruments: Object.keys(this.instruments).length,
            patterns: Object.keys(this.patterns).length
        });
    }

    /**
     * Build frequency lookup table for all notes (C0 to B8)
     */
    buildNoteFrequencies() {
        const notes = {};
        const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

        // A4 = 440 Hz, which is note index 57 (4 * 12 + 9)
        for (let octave = 0; octave <= 8; octave++) {
            for (let i = 0; i < 12; i++) {
                const noteIndex = octave * 12 + i;
                const noteName = noteNames[i] + octave;
                // Frequency = 440 * 2^((n-57)/12) where n is note index
                notes[noteName] = 440 * Math.pow(2, (noteIndex - 57) / 12);
            }
        }

        return notes;
    }

    /**
     * Get frequency for a note name (e.g., "C4", "F#3")
     */
    getNoteFrequency(noteName) {
        return this.noteFrequencies[noteName] || 440;
    }

    /**
     * Initialize audio context (must be called after user interaction)
     */
    async initAudio() {
        if (this.isInitialized) return true;

        try {
            // Try to get audio context from AudioManager
            const audioManager = this.call.getAudioManager?.();
            if (audioManager?.audioContext) {
                this.audioContext = audioManager.audioContext;

                // Create gain node for volume control - connect directly to musicBus
                // The musicBus already has a compressor/limiter, no need for another one
                this.musicGain = this.audioContext.createGain();
                this.musicGain.gain.value = this.musicVolume;

                // Connect to music bus if available (it has its own limiter)
                if (audioManager.musicBus) {
                    this.musicGain.connect(audioManager.musicBus.input);
                } else {
                    this.musicGain.connect(this.audioContext.destination);
                }

                // Set musicOutput as the target for note connections
                this.musicOutput = this.musicGain;

                this.isInitialized = true;
                console.log('[MusicSystem] Audio initialized via AudioManager');
                return true;
            }

            // Fallback: create our own context
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();

            // Create a simple limiter only when not using AudioManager
            this.musicLimiter = this.audioContext.createDynamicsCompressor();
            this.musicLimiter.threshold.setValueAtTime(-6, this.audioContext.currentTime);
            this.musicLimiter.knee.setValueAtTime(6, this.audioContext.currentTime);
            this.musicLimiter.ratio.setValueAtTime(12, this.audioContext.currentTime);
            this.musicLimiter.attack.setValueAtTime(0.003, this.audioContext.currentTime);
            this.musicLimiter.release.setValueAtTime(0.25, this.audioContext.currentTime);

            this.musicGain = this.audioContext.createGain();
            this.musicGain.gain.value = this.musicVolume;
            this.musicLimiter.connect(this.musicGain);
            this.musicGain.connect(this.audioContext.destination);

            // Set musicOutput as the target for note connections
            this.musicOutput = this.musicLimiter;

            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }

            this.isInitialized = true;
            console.log('[MusicSystem] Audio initialized with new context');
            return true;
        } catch (e) {
            console.error('[MusicSystem] Failed to initialize audio:', e);
            return false;
        }
    }

    /**
     * Play a track by name
     * @param {string} trackName - Name of the track in collections
     */
    async playTrack(trackName) {
        // Initialize audio if needed
        if (!this.isInitialized) {
            const success = await this.initAudio();
            if (!success) return false;
        }

        // Get track data
        const track = this.tracks[trackName];
        if (!track) {
            console.warn(`[MusicSystem] Track not found: ${trackName}`);
            return false;
        }

        // Stop current track if playing
        if (this.playing) {
            this.stopTrack();
        }

        // Set up track
        this.currentTrack = {
            name: trackName,
            data: track,
            bpm: track.bpm || 120,
            stepsPerBeat: track.stepsPerBeat || 4,
            totalSteps: track.totalSteps || 64
        };

        // Parse track instruments
        this.currentTrack.voices = this.parseTrackVoices(track);

        // Start playback
        this.playing = true;
        this.paused = false;
        this.currentStep = 0;
        this.nextNoteTime = this.audioContext.currentTime + 0.1;

        console.log(`[MusicSystem] Playing track: ${trackName}`);
        this.schedulerLoop();

        return true;
    }

    /**
     * Parse track voices (instruments + patterns)
     */
    parseTrackVoices(track) {
        const voices = [];

        if (!track.voices) return voices;

        for (const voiceConfig of track.voices) {
            // Get instrument definition
            const instrument = this.instruments[voiceConfig.instrument] || this.getDefaultInstrument();

            // Get or parse pattern
            let pattern = voiceConfig.pattern;
            if (typeof pattern === 'string') {
                pattern = this.patterns[pattern]?.notes || [];
            }

            voices.push({
                name: voiceConfig.name || 'voice',
                instrument: instrument,
                pattern: pattern,
                volume: voiceConfig.volume ?? 1.0,
                octaveShift: voiceConfig.octaveShift || 0
            });
        }

        return voices;
    }

    /**
     * Get a default instrument if none specified
     */
    getDefaultInstrument() {
        return {
            oscillator: 'sine',
            envelope: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.3 },
            filter: { type: 'lowpass', frequency: 2000, Q: 1 }
        };
    }

    /**
     * Stop the current track
     */
    stopTrack() {
        this.playing = false;
        this.paused = false;

        if (this.schedulerTimer) {
            clearTimeout(this.schedulerTimer);
            this.schedulerTimer = null;
        }

        console.log('[MusicSystem] Track stopped');
    }

    /**
     * Pause the current track
     */
    pauseTrack() {
        if (!this.playing || this.paused) return;

        this.paused = true;
        if (this.schedulerTimer) {
            clearTimeout(this.schedulerTimer);
            this.schedulerTimer = null;
        }

        console.log('[MusicSystem] Track paused');
    }

    /**
     * Resume the current track
     */
    resumeTrack() {
        if (!this.paused) return;

        this.paused = false;
        this.nextNoteTime = this.audioContext.currentTime + 0.05;
        this.schedulerLoop();

        console.log('[MusicSystem] Track resumed');
    }

    /**
     * Check if music is currently playing
     */
    isPlaying() {
        return this.playing && !this.paused;
    }

    /**
     * Get current track name
     */
    getCurrentTrack() {
        return this.currentTrack?.name || null;
    }

    /**
     * Set music volume (0-1)
     */
    setMusicVolume(volume) {
        this.musicVolume = Math.max(0, Math.min(1, volume));
        if (this.musicGain) {
            const now = this.audioContext.currentTime;
            this.musicGain.gain.setTargetAtTime(this.musicVolume, now, 0.05);
        }
    }

    /**
     * Get current music volume
     */
    getMusicVolume() {
        return this.musicVolume;
    }

    /**
     * Main scheduler loop - schedules notes ahead of time
     */
    schedulerLoop() {
        if (!this.playing || this.paused) return;

        const currentTime = this.audioContext.currentTime;

        // Schedule notes until we're past the lookahead window
        while (this.nextNoteTime < currentTime + this.scheduleAheadTime) {
            this.scheduleStep(this.currentStep, this.nextNoteTime);
            this.advanceStep();
        }

        // Schedule next check
        this.schedulerTimer = setTimeout(() => this.schedulerLoop(), this.lookahead);
    }

    /**
     * Schedule all voices for a given step
     */
    scheduleStep(step, time) {
        if (!this.currentTrack?.voices) return;

        for (const voice of this.currentTrack.voices) {
            const patternStep = step % voice.pattern.length;
            const note = voice.pattern[patternStep];

            if (note && note !== '-' && note !== null) {
                this.playNote(voice, note, time);
            }
        }
    }

    /**
     * Play a single note with an instrument
     */
    playNote(voice, noteName, startTime) {
        if (!this.audioContext || !this.musicOutput) return;

        const instrument = voice.instrument;

        // Handle chord notation (e.g., "C4,E4,G4")
        const notes = noteName.split(',').map(n => n.trim());

        for (const note of notes) {
            // Get frequency
            let frequency = this.getNoteFrequency(note);

            // Apply octave shift
            if (voice.octaveShift) {
                frequency *= Math.pow(2, voice.octaveShift);
            }

            // Create oscillator
            const osc = this.audioContext.createOscillator();
            osc.type = instrument.oscillator || 'sine';
            osc.frequency.setValueAtTime(frequency, startTime);

            // Create envelope gain - use setTargetAtTime for stable sustained notes
            const envGain = this.audioContext.createGain();
            envGain.gain.setValueAtTime(0.0001, startTime);

            // Create volume gain (reduced to prevent clipping)
            const volGain = this.audioContext.createGain();
            volGain.gain.setValueAtTime(voice.volume * 0.5, startTime);

            // Apply envelope using setTargetAtTime for more stable automation
            // setTargetAtTime doesn't have timing edge cases like ramps do
            const env = instrument.envelope || { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.3 };
            const secondsPerBeat = 60 / this.currentTrack.bpm;
            const noteDuration = instrument.duration || (secondsPerBeat * 0.8);

            const attack = Math.max(env.attack, 0.005);
            const decay = Math.max(env.decay, 0.01);
            const sustain = Math.max(env.sustain, 0.001);
            const release = Math.max(env.release, 0.01);
            const releaseStart = startTime + noteDuration;
            const releaseEnd = releaseStart + release;

            // Attack: rise to 1.0 (time constant = attack/3 means ~95% in attack time)
            envGain.gain.setTargetAtTime(1, startTime, attack / 3);
            // Decay: drop to sustain level after attack
            envGain.gain.setTargetAtTime(sustain, startTime + attack, decay / 3);
            // Release: fade out to near-zero
            envGain.gain.setTargetAtTime(0.0001, releaseStart, release / 3);

            // Create filter if specified
            let outputNode = osc;
            let filter = null;
            if (instrument.filter) {
                filter = this.audioContext.createBiquadFilter();
                filter.type = instrument.filter.type || 'lowpass';
                filter.frequency.setValueAtTime(instrument.filter.frequency || 2000, startTime);
                filter.Q.setValueAtTime(instrument.filter.Q || 1, startTime);
                osc.connect(filter);
                outputNode = filter;
            }

            // Connect chain: osc -> (filter) -> envGain -> volGain -> musicOutput (gain or limiter)
            outputNode.connect(envGain);
            envGain.connect(volGain);
            volGain.connect(this.musicOutput);

            // Start and stop
            osc.start(startTime);
            osc.stop(releaseEnd + 0.1);

            // CRITICAL: Clean up nodes after oscillator ends to prevent audio graph buildup
            osc.onended = () => {
                try {
                    osc.disconnect();
                    if (filter) filter.disconnect();
                    envGain.disconnect();
                    volGain.disconnect();
                } catch (e) {
                    // Ignore disconnect errors (node may already be disconnected)
                }
            };
        }
    }

    /**
     * Advance to the next step
     */
    advanceStep() {
        const secondsPerBeat = 60 / this.currentTrack.bpm;
        const secondsPerStep = secondsPerBeat / this.currentTrack.stepsPerBeat;

        this.nextNoteTime += secondsPerStep;
        this.currentStep = (this.currentStep + 1) % this.currentTrack.totalSteps;
    }

    /**
     * Clean up on scene unload
     */
    onSceneUnload() {
        this.stopTrack();
    }

    /**
     * Clean up on destroy
     */
    destroy() {
        this.stopTrack();
        if (this.musicLimiter) {
            try { this.musicLimiter.disconnect(); } catch (e) {}
        }
        if (this.musicGain) {
            try { this.musicGain.disconnect(); } catch (e) {}
        }
        this.musicOutput = null;
    }
}

// Assign to global.GUTS for server
if (typeof global !== 'undefined') {
    if (!global.GUTS) global.GUTS = {};
    global.GUTS.MusicSystem = MusicSystem;
}

// Assign to window.GUTS for browser
if (typeof window !== 'undefined') {
    if (!window.GUTS) window.GUTS = {};
    window.GUTS.MusicSystem = MusicSystem;
}

export default MusicSystem;
export { MusicSystem };
