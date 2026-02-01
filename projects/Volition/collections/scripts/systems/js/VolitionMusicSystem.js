import MusicSystem from '../../../../../../global/collections/scripts/systems/js/MusicSystem.js';

/**
 * VolitionMusicSystem - Music system for the Volition card game
 * Extends the global MusicSystem to add game-specific music behaviors
 */
class VolitionMusicSystem extends MusicSystem {
    static services = [
        ...MusicSystem.services,
        'toggleMusic',
        'isMusicEnabled',
        'startTitleMusic',
        'startGameMusic',
        'playTriumphMusic',
        'getMusicVolume',
        'setMusicVolume',
        'fadeOutMusic'
    ];

    constructor(game) {
        super(game);
        this.musicEnabled = true;
        this.hasStartedMusic = false;

        // Default music volume
        this.musicVolume = 0.4;

        // Fade-in duration in seconds
        this.fadeInDuration = 3.0;

        // Load saved music preference and volume
        this.loadMusicPreference();
    }

    /**
     * Load music preference from localStorage
     */
    loadMusicPreference() {
        try {
            const saved = localStorage.getItem('volitionMusicEnabled');
            if (saved !== null) {
                this.musicEnabled = saved === 'true';
            }
            const savedVolume = localStorage.getItem('volitionMusicVolume');
            if (savedVolume !== null) {
                this.musicVolume = parseFloat(savedVolume);
            }
        } catch (e) {
            // Ignore localStorage errors
        }
    }

    /**
     * Save music preference to localStorage
     */
    saveMusicPreference() {
        try {
            localStorage.setItem('volitionMusicEnabled', this.musicEnabled.toString());
            localStorage.setItem('volitionMusicVolume', this.musicVolume.toString());
        } catch (e) {
            // Ignore localStorage errors
        }
    }

    /**
     * Get current music volume (0-1)
     */
    getMusicVolume() {
        return this.musicVolume;
    }

    /**
     * Set music volume (0-1) and apply it immediately
     */
    setMusicVolume(volume) {
        this.musicVolume = Math.max(0, Math.min(1, volume));
        this.saveMusicPreference();

        // Apply to current music gain if playing
        if (this.musicGain && this.audioContext) {
            this.musicGain.gain.setTargetAtTime(this.musicVolume, this.audioContext.currentTime, 0.05);
        }
    }

    /**
     * Toggle music on/off
     */
    toggleMusic() {
        this.musicEnabled = !this.musicEnabled;
        this.saveMusicPreference();

        if (this.musicEnabled) {
            this.startGameMusic();
        } else {
            this.stopTrack();
        }

        return this.musicEnabled;
    }

    /**
     * Check if music is enabled
     */
    isMusicEnabled() {
        return this.musicEnabled;
    }

    /**
     * Override initAudio to start with gain at 0 for fade-in
     */
    async initAudio() {
        console.log('[VolitionMusic] initAudio called, isInitialized:', this.isInitialized);
        const result = await super.initAudio();

        // After parent creates musicGain, force it to 0 for fade-in
        if (result && this.musicGain) {
            console.log('[VolitionMusic] initAudio: setting musicGain to 0');
            this.musicGain.gain.value = 0;
        } else {
            console.warn('[VolitionMusic] initAudio: no musicGain!', { result, musicGain: this.musicGain });
        }

        return result;
    }

    /**
     * Fade in the music from silence to target volume
     */
    fadeInMusic() {
        if (!this.musicGain || !this.audioContext) {
            console.warn('[VolitionMusic] fadeInMusic: no musicGain or audioContext');
            return;
        }

        const now = this.audioContext.currentTime;

        console.log('[VolitionMusic] fadeInMusic: starting fade from 0 to', this.musicVolume, 'over', this.fadeInDuration, 'seconds');

        // Cancel any existing automation
        this.musicGain.gain.cancelScheduledValues(0);

        // Force gain to 0 immediately
        this.musicGain.gain.value = 0;
        this.musicGain.gain.setValueAtTime(0, now);

        // Use linear ramp for more predictable fade
        this.musicGain.gain.linearRampToValueAtTime(this.musicVolume, now + this.fadeInDuration);

        console.log('[VolitionMusic] fadeInMusic: scheduled ramp to', this.musicVolume, 'at time', now + this.fadeInDuration);
    }

    /**
     * Fade out the music over the specified duration
     * @param {number} duration - Fade duration in seconds (default: 1)
     * @returns {Promise} Resolves when fade is complete
     */
    fadeOutMusic(duration = 1.0) {
        return new Promise((resolve) => {
            if (!this.musicGain || !this.audioContext || !this.playing) {
                resolve();
                return;
            }

            const now = this.audioContext.currentTime;
            const currentVolume = this.musicGain.gain.value;

            console.log('[VolitionMusic] fadeOutMusic: fading from', currentVolume, 'to 0 over', duration, 'seconds');

            // Cancel any existing automation
            this.musicGain.gain.cancelScheduledValues(now);

            // Start from current volume and fade to 0
            this.musicGain.gain.setValueAtTime(currentVolume, now);
            this.musicGain.gain.linearRampToValueAtTime(0, now + duration);

            // Resolve after fade completes
            setTimeout(() => {
                this.stopTrack();
                // Reset flag so music can start again in new scene
                this.hasStartedMusic = false;

                resolve();
            }, duration * 1000);
        });
    }

    /**
     * Start the title music (same as game music)
     */
    async startTitleMusic() {
        console.log('[VolitionMusic] startTitleMusic called, hasStartedMusic:', this.hasStartedMusic);

        // Prevent multiple calls - set flag FIRST to avoid race condition
        if (this.hasStartedMusic) {
            console.log('[VolitionMusic] startTitleMusic: already started, returning');
            return;
        }
        this.hasStartedMusic = true;

        if (!this.musicEnabled) {
            console.log('[VolitionMusic] startTitleMusic: music disabled, returning');
            return;
        }

        // Initialize audio first so musicGain exists
        if (!this.isInitialized) {
            console.log('[VolitionMusic] startTitleMusic: calling initAudio');
            await this.initAudio();
        }

        // Force gain to 0 before playing
        if (this.musicGain) {
            console.log('[VolitionMusic] startTitleMusic: setting gain to 0');
            this.musicGain.gain.cancelScheduledValues(0);
            this.musicGain.gain.value = 0;
        }

        // Play the war track
        console.log('[VolitionMusic] startTitleMusic: calling playTrack');
        await this.playTrack('volition_war');

        // Now fade in
        console.log('[VolitionMusic] startTitleMusic: calling fadeInMusic');
        this.fadeInMusic();
    }

    /**
     * Start the intense game music
     */
    async startGameMusic() {
        console.log('[VolitionMusic] startGameMusic called, hasStartedMusic:', this.hasStartedMusic);

        // Prevent multiple calls - set flag FIRST to avoid race condition
        if (this.hasStartedMusic) {
            console.log('[VolitionMusic] startGameMusic: already started, returning');
            return;
        }
        this.hasStartedMusic = true;

        if (!this.musicEnabled) return;

        // Initialize audio first so musicGain exists
        if (!this.isInitialized) {
            await this.initAudio();
        }

        // Force gain to 0 before playing
        if (this.musicGain) {
            this.musicGain.gain.cancelScheduledValues(0);
            this.musicGain.gain.value = 0;
        }

        // Play the war track
        await this.playTrack('volition_war');

        // Now fade in
        this.fadeInMusic();
    }

    /**
     * Play the triumphant victory music (plays war track)
     */
    async playTriumphMusic() {
        // Just keep playing war track
    }

    /**
     * Called after all systems init - start music on first user interaction
     */
    postAllInit() {
        // Set up first interaction listener to start music
        const startMusicOnInteraction = async () => {
            if (!this.hasStartedMusic && this.musicEnabled) {
                await this.startGameMusic();
            }
        };

        // Listen for first click/touch to start music (needed for autoplay policy)
        document.addEventListener('click', startMusicOnInteraction, { once: true });
        document.addEventListener('touchstart', startMusicOnInteraction, { once: true });
    }

    /**
     * React to new game event - restart music
     */
    onNewGame() {
        if (this.musicEnabled && !this.isPlaying()) {
            this.startGameMusic();
        }
    }

    /**
     * React to game won event - play triumphant music
     */
    onGameWon() {
        // Switch to triumphant victory music
        this.playTriumphMusic();
    }
}

export default VolitionMusicSystem;
