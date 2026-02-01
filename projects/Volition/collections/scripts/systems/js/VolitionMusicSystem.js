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
        'setMusicVolume'
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
     * Fade in the music from silence to target volume
     */
    fadeInMusic() {
        if (!this.musicGain || !this.audioContext) return;

        // Start at silence
        this.musicGain.gain.setValueAtTime(0, this.audioContext.currentTime);

        // Fade to target volume over fadeInDuration
        // Using setTargetAtTime with time constant = duration/3 reaches ~95% in duration
        this.musicGain.gain.setTargetAtTime(
            this.musicVolume,
            this.audioContext.currentTime,
            this.fadeInDuration / 3
        );
    }

    /**
     * Start the title music (same as game music)
     */
    async startTitleMusic() {
        if (!this.musicEnabled) return;

        // Play the war track
        await this.playTrack('volition_war');
        this.fadeInMusic();
        this.hasStartedMusic = true;
    }

    /**
     * Start the intense game music
     */
    async startGameMusic() {
        if (!this.musicEnabled) return;

        // Play the war track
        await this.playTrack('volition_war');
        this.fadeInMusic();
        this.hasStartedMusic = true;
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
