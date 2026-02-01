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
        'startGameMusic'
    ];

    constructor(game) {
        super(game);
        this.musicEnabled = true;
        this.hasStartedMusic = false;

        // Override music volume to be very low to avoid clipping with SFX
        this.musicVolume = 0.15;

        // Load saved music preference
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
        } catch (e) {
            // Ignore localStorage errors
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
     * Start the ambient game music
     */
    async startGameMusic() {
        if (!this.musicEnabled) return;

        // Play the ambient track
        await this.playTrack('volition_ambient');
        this.hasStartedMusic = true;
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
     * React to game won event - music continues
     */
    onGameWon() {
        // Keep playing ambient music on win
    }
}

export default VolitionMusicSystem;
