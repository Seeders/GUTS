/**
 * AudioSystem - Manages audio playback for the game
 *
 * Creates and manages an AudioManager instance and provides services
 * for playing sounds, ambient audio, and music.
 */
class AudioSystem extends GUTS.BaseSystem {
    static services = [
        'playSound',
        'playSynthSound',
        'startAmbientSound',
        'stopAmbientSound',
        'getAudioManager'
    ];

    constructor(game) {
        super(game);
        this.game.audioSystem = this;

        // Create AudioManager instance
        console.log('[AudioSystem] Creating AudioManager...');
        this.audioManager = new GUTS.AudioManager(game, null, {});

        // Make it accessible on game for other systems
        this.game.audioManager = this.audioManager;
        console.log('[AudioSystem] Set game.audioManager:', !!this.game.audioManager);
    }

    init() {
        console.log('[AudioSystem] init() called');
        // Initialize audio manager
        if (this.audioManager.init) {
            this.audioManager.init();
        }
    }

    onSceneLoad(sceneData) {
        // Audio manager is already initialized
    }

    /**
     * Get the AudioManager instance
     */
    getAudioManager() {
        return this.audioManager;
    }

    /**
     * Play a sound from a collection
     * @param {string} collectionName - The sound collection (e.g., 'sounds', 'attackSounds')
     * @param {string} soundName - The sound name within the collection
     */
    playSound(collectionName, soundName) {
        if (this.audioManager) {
            this.audioManager.playSound(collectionName, soundName);
        }
    }

    /**
     * Play a synthesized sound directly
     * @param {string} soundId - Unique identifier for the sound
     * @param {Object} soundConfig - The sound configuration
     * @param {Object} options - Playback options
     */
    playSynthSound(soundId, soundConfig, options) {
        if (this.audioManager) {
            return this.audioManager.playSynthSound(soundId, soundConfig, options);
        }
        return null;
    }

    /**
     * Start an ambient sound at a position
     * @param {string} ambientId - Unique ID for this ambient sound
     * @param {Object} soundDef - Sound definition from collection
     * @param {Object} position - World position {x, y, z}
     */
    startAmbientSound(ambientId, soundDef, position) {
        if (this.audioManager) {
            return this.audioManager.startAmbientSound(ambientId, soundDef, position);
        }
        return null;
    }

    /**
     * Stop an ambient sound
     * @param {string} ambientId - The ambient sound ID to stop
     */
    stopAmbientSound(ambientId) {
        if (this.audioManager) {
            this.audioManager.stopAmbientSound(ambientId);
        }
    }

    /**
     * Set the listener position for 3D audio
     * @param {Object} position - Listener position {x, y, z}
     */
    setListenerPosition(position) {
        if (this.audioManager) {
            this.audioManager.setListenerPosition(position);
        }
    }

    onSceneUnload() {
        // Stop all ambient sounds when scene unloads
        if (this.audioManager?.stopAllAmbientSounds) {
            this.audioManager.stopAllAmbientSounds();
        }
    }

    destroy() {
        this.onSceneUnload();
    }
}
