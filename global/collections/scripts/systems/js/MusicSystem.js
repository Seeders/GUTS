/**
 * MusicSystem - A data-driven step sequencer for synthesized music.
 *
 * Ported from GUTS global (as used by Volition) and extended for Hero Arena.
 * Everything is data in three audio collections:
 *
 *   tracks       bpm, stepsPerBeat, voices (instrument + mix), sections that
 *                assign a pattern to each voice over a step range, optional
 *                loopStart (the step to return to after the last one, so a
 *                track can have an intro that does not repeat)
 *   patterns     notes: one token per step, repeated to fill its section
 *   instruments  how a voice sounds
 *
 * Pattern tokens (one per step, "-" = rest):
 *   "D4"           a note          "D4,F4,A4"   a chord
 *   "D4:8"         held 8 steps    "D4@0.6"     played at 60% velocity
 *   "x" / "X"      an unpitched hit (drums) at the instrument's frequency;
 *                  "X" is accented. Length and velocity combine: "A3:4@0.8"
 *
 * Instrument fields (all optional; the old single-oscillator format still works):
 *   oscillator     'sine'|'triangle'|'square'|'sawtooth'
 *   noise          'white'|'pink'|'brown' — a noise voice instead
 *   layers         [{ oscillator|noise, volume, detune (cents), octave, filter }]
 *   frequency      pitch for "x" hits
 *   envelope       { attack, decay, sustain, release } (seconds / level)
 *   filter         { type, frequency, Q } after the layers are mixed
 *   filterEnvelope { start, end, time } — cutoff multipliers swept per note
 *   pitchEnvelope  { start, end, time } — pitch multipliers swept per note
 *   duration       fixed note length in seconds (else the token's length)
 *   legato         fraction of the token length a note sounds (default 0.9)
 *   gain           loudness trim for the instrument
 *
 * Voice fields: name, instrument, volume, octaveShift, pan (-1…1), reverb (send 0…1)
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
        'getCurrentTrack',
        'crossfadeTo'
    ];

    static serviceDependencies = ['getAudioManager'];

    constructor(game) {
        super(game);

        // Audio state
        this.audioContext = null;
        this.musicGain = null;
        this.musicLimiter = null;
        this.musicOutput = null; // where voice buses connect (gain or limiter)
        this.reverbSend = null;
        this.musicVolume = 0.3; // leaves headroom for SFX

        // Playback state
        this.isInitialized = false;
        this.playing = false;
        this.paused = false;
        this.currentTrack = null;

        // Sequencer state
        this.schedulerTimer = null;
        this.nextNoteTime = 0;
        this.currentStep = 0;
        this.scheduleAheadTime = 0.12; // schedule 120ms ahead
        this.lookahead = 25;           // check every 25ms

        // Collections cache
        this.tracks = {};
        this.instruments = {};
        this.patterns = {};

        this.noteFrequencies = this.buildNoteFrequencies();
    }

    init() {
        this.loadMusicCollections();
    }

    loadMusicCollections() {
        const collections = this.game.getCollections?.() || {};
        this.tracks = collections.tracks || {};
        this.instruments = collections.instruments || {};
        this.patterns = collections.patterns || {};
    }

    /** Frequency table C0..B8, with flat spellings (Bb4 = A#4). */
    buildNoteFrequencies() {
        const notes = {};
        const sharps = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        const flats  = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
        for (let octave = 0; octave <= 8; octave++) {
            for (let i = 0; i < 12; i++) {
                const f = 440 * Math.pow(2, (octave * 12 + i - 57) / 12);
                notes[sharps[i] + octave] = f;
                notes[flats[i] + octave] = f;
            }
        }
        return notes;
    }

    getNoteFrequency(noteName) {
        return this.noteFrequencies[noteName] || 440;
    }

    /** Hook to the shared AudioManager's context and music bus. Needs a user gesture to have happened. */
    async initAudio() {
        if (this.isInitialized) return true;
        try {
            const audioManager = this.call.getAudioManager?.();
            if (audioManager && !audioManager.isInitialized) await audioManager.initialize?.();
            if (audioManager?.audioContext) {
                this.audioContext = audioManager.audioContext;
                this.musicGain = this.audioContext.createGain();
                this.musicGain.gain.value = this.musicVolume;
                this.musicGain.connect(audioManager.musicBus ? audioManager.musicBus.input : this.audioContext.destination);
                this.musicOutput = this.musicGain;
                this._buildReverb(audioManager);
                this.isInitialized = true;
                return true;
            }

            // Fallback: own context with a safety limiter
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.musicLimiter = this.audioContext.createDynamicsCompressor();
            this.musicLimiter.threshold.setValueAtTime(-6, this.audioContext.currentTime);
            this.musicLimiter.ratio.setValueAtTime(12, this.audioContext.currentTime);
            this.musicGain = this.audioContext.createGain();
            this.musicGain.gain.value = this.musicVolume;
            this.musicLimiter.connect(this.musicGain);
            this.musicGain.connect(this.audioContext.destination);
            this.musicOutput = this.musicLimiter;
            this._buildReverb(null);
            if (this.audioContext.state === 'suspended') await this.audioContext.resume();
            this.isInitialized = true;
            return true;
        } catch (e) {
            console.error('[MusicSystem] Failed to initialize audio:', e);
            return false;
        }
    }

    // One shared hall for the whole track; voices feed it through their send.
    _buildReverb(audioManager) {
        const convolver = this.audioContext.createConvolver();
        if (audioManager?.generateImpulseResponse) audioManager.generateImpulseResponse(convolver);
        else {
            const len = this.audioContext.sampleRate * 2;
            const buf = this.audioContext.createBuffer(2, len, this.audioContext.sampleRate);
            for (let c = 0; c < 2; c++) {
                const d = buf.getChannelData(c);
                for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
            }
            convolver.buffer = buf;
        }
        const ret = this.audioContext.createGain();
        ret.gain.value = 0.6;
        convolver.connect(ret);
        ret.connect(this.musicOutput);
        this.reverbSend = convolver;
    }

    async playTrack(trackName) {
        if (!this.isInitialized) {
            const ok = await this.initAudio();
            if (!ok) return false;
        }
        const track = this.tracks[trackName];
        if (!track) {
            console.warn(`[MusicSystem] Track not found: ${trackName}`);
            return false;
        }
        if (this.playing) this.stopTrack();

        let totalSteps = track.totalSteps || 64;
        if (track.sections?.length) totalSteps = Math.max(...track.sections.map(s => s.endStep));

        this.currentTrack = {
            name: trackName,
            data: track,
            bpm: track.bpm || 120,
            stepsPerBeat: track.stepsPerBeat || 4,
            totalSteps,
            loopStart: track.loopStart || 0,
            sections: track.sections || null
        };
        this.currentTrack.voices = this.parseTrackVoices(track);

        this.playing = true;
        this.paused = false;
        this.currentStep = 0;
        this.nextNoteTime = this.audioContext.currentTime + 0.1;
        this.schedulerLoop();
        return true;
    }

    /**
     * Fade the current track out and the named one in. No-op if it is
     * already the track playing.
     */
    async crossfadeTo(trackName, fadeSeconds = 1.2) {
        if (this.playing && this.currentTrack?.name === trackName) return true;
        if (!this.isInitialized && !(await this.initAudio())) return false;
        const g = this.musicGain.gain;
        const now = this.audioContext.currentTime;
        const token = (this._fadeToken = (this._fadeToken || 0) + 1);
        if (this.playing) {
            g.cancelScheduledValues(now);
            g.setValueAtTime(g.value, now);
            g.linearRampToValueAtTime(0.0001, now + fadeSeconds / 2);
            await new Promise(r => setTimeout(r, fadeSeconds * 500));
            if (token !== this._fadeToken) return false;   // superseded by a newer request
        }
        const ok = await this.playTrack(trackName);
        const t = this.audioContext.currentTime;
        g.cancelScheduledValues(t);
        g.setValueAtTime(0.0001, t);
        g.linearRampToValueAtTime(this.musicVolume, t + fadeSeconds);
        return ok;
    }

    /** Fade out and stop. */
    async fadeOut(fadeSeconds = 1.2) {
        if (!this.playing || !this.musicGain) return;
        const token = (this._fadeToken = (this._fadeToken || 0) + 1);
        const g = this.musicGain.gain;
        const now = this.audioContext.currentTime;
        g.cancelScheduledValues(now);
        g.setValueAtTime(g.value, now);
        g.linearRampToValueAtTime(0.0001, now + fadeSeconds);
        await new Promise(r => setTimeout(r, fadeSeconds * 1000));
        if (token === this._fadeToken) this.stopTrack();
    }

    parseTrackVoices(track) {
        const voices = [];
        if (!track.voices) return voices;
        for (const vc of track.voices) {
            const instrument = this.instruments[vc.instrument] || this.getDefaultInstrument();
            let pattern = null;
            if (vc.pattern) {
                pattern = typeof vc.pattern === 'string' ? (this.patterns[vc.pattern]?.notes || []) : vc.pattern;
            }
            // Per-voice bus: pan + reverb send, shared by all its notes.
            const bus = this.audioContext.createGain();
            let out = bus;
            if (vc.pan) {
                const panner = this.audioContext.createStereoPanner();
                panner.pan.value = Math.max(-1, Math.min(1, vc.pan));
                bus.connect(panner);
                out = panner;
            }
            out.connect(this.musicOutput);
            if (vc.reverb && this.reverbSend) {
                const send = this.audioContext.createGain();
                send.gain.value = vc.reverb;
                out.connect(send);
                send.connect(this.reverbSend);
            }
            voices.push({
                name: vc.name || 'voice',
                instrument,
                pattern,
                volume: vc.volume ?? 1.0,
                octaveShift: vc.octaveShift || 0,
                bus
            });
        }
        return voices;
    }

    getSectionAtStep(step) {
        if (!this.currentTrack?.sections) return null;
        for (const section of this.currentTrack.sections) {
            if (step >= section.startStep && step < section.endStep) return section;
        }
        return null;
    }

    // Patterns restart at their section's first step so an 8-step drum loop
    // stays on the beat whatever step its section begins on.
    getPatternForVoiceAtStep(voice, step) {
        if (voice.pattern) return { notes: voice.pattern, offset: 0 };
        const section = this.getSectionAtStep(step);
        const patternName = section?.voicePatterns?.[voice.name];
        if (!patternName) return null;
        const notes = this.patterns[patternName]?.notes;
        return notes ? { notes, offset: section.startStep } : null;
    }

    getDefaultInstrument() {
        return {
            oscillator: 'sine',
            envelope: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.3 },
            filter: { type: 'lowpass', frequency: 2000, Q: 1 }
        };
    }

    stopTrack() {
        this.playing = false;
        this.paused = false;
        if (this.schedulerTimer) {
            clearTimeout(this.schedulerTimer);
            this.schedulerTimer = null;
        }
        // Release the voice buses once their last notes have rung out.
        const voices = this.currentTrack?.voices || [];
        setTimeout(() => voices.forEach(v => { try { v.bus.disconnect(); } catch (e) { /* gone */ } }), 4000);
    }

    pauseTrack() {
        if (!this.playing || this.paused) return;
        this.paused = true;
        if (this.schedulerTimer) {
            clearTimeout(this.schedulerTimer);
            this.schedulerTimer = null;
        }
    }

    resumeTrack() {
        if (!this.paused) return;
        this.paused = false;
        this.nextNoteTime = this.audioContext.currentTime + 0.05;
        this.schedulerLoop();
    }

    isPlaying() {
        return this.playing && !this.paused;
    }

    getCurrentTrack() {
        return this.currentTrack?.name || null;
    }

    setMusicVolume(volume) {
        this.musicVolume = Math.max(0, Math.min(1, volume));
        if (this.musicGain) this.musicGain.gain.setTargetAtTime(this.musicVolume, this.audioContext.currentTime, 0.05);
    }

    getMusicVolume() {
        return this.musicVolume;
    }

    schedulerLoop() {
        if (!this.playing || this.paused) return;
        const currentTime = this.audioContext.currentTime;
        // A backgrounded tab throttles timers; don't burst-schedule the gap.
        if (this.nextNoteTime < currentTime - 0.25) this.nextNoteTime = currentTime + 0.05;
        while (this.nextNoteTime < currentTime + this.scheduleAheadTime) {
            this.scheduleStep(this.currentStep, this.nextNoteTime);
            this.advanceStep();
        }
        this.schedulerTimer = setTimeout(() => this.schedulerLoop(), this.lookahead);
    }

    scheduleStep(step, time) {
        if (!this.currentTrack?.voices) return;
        for (const voice of this.currentTrack.voices) {
            const p = this.getPatternForVoiceAtStep(voice, step);
            if (!p || !p.notes.length) continue;
            const token = p.notes[(step - p.offset) % p.notes.length];
            if (token && token !== '-') this.playNote(voice, token, time);
        }
    }

    // "D4:8@0.6" → { notes: ['D4'], steps: 8, velocity: 0.6, hit: false }
    parseToken(token) {
        let rest = String(token);
        let velocity = 1, steps = 1;
        const at = rest.indexOf('@');
        if (at >= 0) { velocity = parseFloat(rest.slice(at + 1)) || 1; rest = rest.slice(0, at); }
        const colon = rest.indexOf(':');
        if (colon >= 0) { steps = parseFloat(rest.slice(colon + 1)) || 1; rest = rest.slice(0, colon); }
        if (rest === 'x' || rest === 'X') return { notes: [null], steps, velocity: velocity * (rest === 'X' ? 1.35 : 1), hit: true };
        return { notes: rest.split(',').map(n => n.trim()).filter(Boolean), steps, velocity, hit: false };
    }

    playNote(voice, token, startTime) {
        if (!this.audioContext || !this.musicOutput) return;
        const inst = voice.instrument;
        const ctx = this.audioContext;
        const { notes, steps, velocity, hit } = this.parseToken(token);

        const secondsPerStep = 60 / this.currentTrack.bpm / this.currentTrack.stepsPerBeat;
        const noteDuration = inst.duration || steps * secondsPerStep * (inst.legato ?? 0.9);
        const env = inst.envelope || { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.3 };
        const attack = Math.max(env.attack ?? 0.01, 0.003);
        const decay = Math.max(env.decay ?? 0.1, 0.01);
        const sustain = Math.max(env.sustain ?? 0.5, 0.0001);
        const release = Math.max(env.release ?? 0.3, 0.01);
        const releaseStart = startTime + Math.max(noteDuration, attack);
        const endTime = releaseStart + release * 1.5 + 0.05;

        const layers = inst.layers || [inst.noise ? { noise: inst.noise } : { oscillator: inst.oscillator || 'sine' }];
        // Chords share the voice's level instead of stacking it.
        const chordTrim = 1 / Math.sqrt(notes.length);
        // Cached: the AudioManager is shared across scenes, and a track kept
        // playing through a scene switch has no service to ask meanwhile.
        const audioManager = this._audioManager || (this._audioManager = this.call.getAudioManager?.());

        for (const note of notes) {
            let frequency = hit ? (inst.frequency || 100) : this.getNoteFrequency(note);
            if (voice.octaveShift) frequency *= Math.pow(2, voice.octaveShift);

            const nodes = [];
            const envGain = ctx.createGain();
            envGain.gain.setValueAtTime(0.0001, startTime);
            envGain.gain.setTargetAtTime(1, startTime, attack / 3);
            envGain.gain.setTargetAtTime(sustain, startTime + attack, decay / 3);
            envGain.gain.setTargetAtTime(0.0001, releaseStart, release / 3);
            const volGain = ctx.createGain();
            volGain.gain.value = voice.volume * 0.5 * velocity * chordTrim * (inst.gain ?? 1);
            nodes.push(envGain, volGain);

            // Instrument filter (optionally swept) after the layer mix
            let mixIn = envGain;
            if (inst.filter) {
                const filter = ctx.createBiquadFilter();
                filter.type = inst.filter.type || 'lowpass';
                const fc = inst.filter.frequency || 2000;
                filter.Q.setValueAtTime(inst.filter.Q ?? 1, startTime);
                if (inst.filterEnvelope) {
                    const fe = inst.filterEnvelope;
                    filter.frequency.setValueAtTime(Math.min(20000, fc * (fe.start ?? 1)), startTime);
                    filter.frequency.exponentialRampToValueAtTime(Math.max(20, fc * (fe.end ?? 1)), startTime + (fe.time ?? 0.2));
                } else {
                    filter.frequency.setValueAtTime(fc, startTime);
                }
                filter.connect(envGain);
                mixIn = filter;
                nodes.push(filter);
            }
            envGain.connect(volGain);
            volGain.connect(voice.bus || this.musicOutput);

            const sources = [];
            for (const layer of layers) {
                let src;
                if (layer.noise) {
                    src = audioManager?.createNoiseSource
                        ? audioManager.createNoiseSource(layer.noise)
                        : this._fallbackNoise();
                } else {
                    src = ctx.createOscillator();
                    src.type = layer.oscillator || 'sine';
                    const f = frequency * Math.pow(2, layer.octave || 0);
                    src.frequency.setValueAtTime(f, startTime);
                    if (layer.detune) src.detune.setValueAtTime(layer.detune, startTime);
                    if (inst.pitchEnvelope) {
                        const pe = inst.pitchEnvelope;
                        src.frequency.setValueAtTime(f * (pe.start ?? 1), startTime);
                        src.frequency.exponentialRampToValueAtTime(Math.max(1, f * (pe.end ?? 1)), startTime + (pe.time ?? 0.1));
                    }
                }
                const lg = ctx.createGain();
                lg.gain.value = layer.volume ?? 1;
                let head = src;
                if (layer.filter) {
                    const lf = ctx.createBiquadFilter();
                    lf.type = layer.filter.type || 'lowpass';
                    lf.frequency.value = layer.filter.frequency || 2000;
                    lf.Q.value = layer.filter.Q ?? 1;
                    src.connect(lf);
                    head = lf;
                    nodes.push(lf);
                }
                head.connect(lg);
                lg.connect(mixIn);
                nodes.push(src, lg);
                sources.push(src);
                src.start(startTime);
                src.stop(endTime);
            }
            // Free the note's nodes once it has rung out.
            sources[0].onended = () => {
                for (const n of nodes) { try { n.disconnect(); } catch (e) { /* already gone */ } }
            };
        }
    }

    _fallbackNoise() {
        if (!this._noiseBuffer) {
            const len = this.audioContext.sampleRate;
            this._noiseBuffer = this.audioContext.createBuffer(1, len, this.audioContext.sampleRate);
            const d = this._noiseBuffer.getChannelData(0);
            for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        }
        const src = this.audioContext.createBufferSource();
        src.buffer = this._noiseBuffer;
        src.loop = true;
        return src;
    }

    advanceStep() {
        const secondsPerStep = 60 / this.currentTrack.bpm / this.currentTrack.stepsPerBeat;
        this.nextNoteTime += secondsPerStep;
        this.currentStep++;
        if (this.currentStep >= this.currentTrack.totalSteps) this.currentStep = this.currentTrack.loopStart || 0;
    }

    onSceneUnload() {
        this.stopTrack();
    }

    destroy() {
        this.stopTrack();
        if (this.musicLimiter) { try { this.musicLimiter.disconnect(); } catch (e) { /* gone */ } }
        if (this.musicGain) { try { this.musicGain.disconnect(); } catch (e) { /* gone */ } }
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
