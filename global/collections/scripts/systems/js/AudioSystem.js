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
        'getAmbientSound',
        'setListenerPosition',
        'playMusic',
        'stopMusic',
        'stopAllSounds',
        'setMasterVolume',
        'setMusicVolume',
        'setSfxVolume',
        'getVolumeSettings',
        'getAudioManager'
    ];

    constructor(game) {
        super(game);
        this.game.audioSystem = this;

        // Create AudioManager instance with collections from game
        console.log('[AudioSystem] Creating AudioManager...');
        this.audioManager = new GUTS.AudioManager({
            collections: game.getCollections(),
            resourceBaseUrl: game.resourceBaseUrl || './resources/'
        });

    }

    init() {
        console.log('[AudioSystem] init() called');
        // Initialize audio manager (volume settings are applied in AudioManager.initialize()
        // when user interaction triggers audio context creation)
        if (this.audioManager.init) {
            this.audioManager.init();
        }
    }

    onSceneLoad(sceneData) {
        // Check for background music in scene config
        if (sceneData?.backgroundMusicSound) {
            console.log('[AudioSystem] Playing scene background music:', sceneData.backgroundMusicSound);
            this.playMusic(sceneData.backgroundMusicSound, { loop: true, fadeInTime: 1 });
        }
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
     * Get an ambient sound definition by name
     * @param {string} soundName - The ambient sound name
     * @returns {Object|null} The sound definition
     */
    getAmbientSound(soundName) {
        if (this.audioManager) {
            return this.audioManager.getAmbientSound(soundName);
        }
        return null;
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

    /**
     * Play background music
     * @param {string} soundName - The sound name to play as music
     * @param {Object} options - Playback options (volume, loop, fadeInTime)
     */
    playMusic(soundName, options) {
        if (this.audioManager) {
            return this.audioManager.playMusic(soundName, options);
        }
        return null;
    }

    /**
     * Stop background music
     * @param {number} fadeOutTime - Fade out duration in seconds
     */
    stopMusic(fadeOutTime = 1) {
        if (this.audioManager) {
            this.audioManager.stopMusic(fadeOutTime);
        }
    }

    /**
     * Stop all currently playing sounds
     */
    stopAllSounds() {
        if (this.audioManager) {
            this.audioManager.stopAllSounds();
        }
    }

    /**
     * Set master volume (affects all audio)
     * @param {number} volume - Volume level 0-1
     */
    setMasterVolume(volume) {
        if (this.audioManager?.masterBus) {
            this.audioManager.masterBus.setVolume(volume);
        }
    }

    /**
     * Set music volume
     * @param {number} volume - Volume level 0-1
     */
    setMusicVolume(volume) {
        if (this.audioManager?.musicBus) {
            this.audioManager.musicBus.setVolume(volume);
        }
    }

    /**
     * Set SFX volume (affects sfx, ambient, and UI sounds)
     * @param {number} volume - Volume level 0-1
     */
    setSfxVolume(volume) {
        if (this.audioManager?.sfxBus) {
            this.audioManager.sfxBus.setVolume(volume);
        }
        if (this.audioManager?.ambientBus) {
            this.audioManager.ambientBus.setVolume(volume);
        }
        if (this.audioManager?.uiBus) {
            this.audioManager.uiBus.setVolume(volume);
        }
    }

    /**
     * Get current volume settings
     * @returns {Object} Current volume levels
     */
    getVolumeSettings() {
        return {
            master: this.audioManager?.masterBus?.output?.gain?.value ?? 1,
            music: this.audioManager?.musicBus?.output?.gain?.value ?? 1,
            sfx: this.audioManager?.sfxBus?.output?.gain?.value ?? 1
        };
    }

    onSceneUnload() {
        // Stop background music when scene unloads
        this.stopMusic(0.5);

        // Stop all ambient sounds when scene unloads
        if (this.audioManager?.stopAllAmbientSounds) {
            this.audioManager.stopAllAmbientSounds();
        }
    }

    destroy() {
        this.onSceneUnload();
    }
}
