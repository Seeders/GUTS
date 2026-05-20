import AudioSystem from '../../../../../../global/collections/scripts/systems/js/AudioSystem.js';

/**
 * AbandonedAudioSystem - Handles all audio playback for Abandoned
 * Extends the global AudioSystem to add game-specific sound methods
 */
class AbandonedAudioSystem extends AudioSystem {
    static services = [
        // Inherit base services
        ...AudioSystem.services,
        // Add Abandoned-specific services
        'playCardPickup', 'playCardPlace', 'playCardDraw',
        'playCardFlip', 'playCardInvalid', 'playCardShuffle',
        'playVictory', 'playDeath', 'playDamage', 'playHeal', 'playThreatResolve',
        'getSfxVolume', 'setSfxVolume'
    ];

    constructor(game) {
        super(game);
        this.soundsEnabled = true;
        this.masterVolume = 0.5; // Default SFX volume

        // Load saved SFX volume
        this.loadSfxVolume();
    }

    /**
     * Load SFX volume from localStorage
     */
    loadSfxVolume() {
        try {
            const saved = localStorage.getItem('abandonedSfxVolume');
            if (saved !== null) {
                this.masterVolume = parseFloat(saved);
            }
        } catch (e) {
            // Ignore localStorage errors
        }
    }

    /**
     * Save SFX volume to localStorage
     */
    saveSfxVolume() {
        try {
            localStorage.setItem('abandonedSfxVolume', this.masterVolume.toString());
        } catch (e) {
            // Ignore localStorage errors
        }
    }

    /**
     * Get current SFX volume (0-1)
     */
    getSfxVolume() {
        return this.masterVolume;
    }

    /**
     * Set SFX volume (0-1)
     */
    setSfxVolume(volume) {
        this.masterVolume = Math.max(0, Math.min(1, volume));
        this.saveSfxVolume();
    }

    init() {
        super.init();
        this.loadSoundConfigs();
    }

    loadSoundConfigs() {
        // Get sound configurations from collections
        const collections = this.game.getCollections?.() || {};
        this.sounds = collections.sounds || {};
    }

    /**
     * Play a sound by ID from the sounds collection
     */
    playSoundEffect(soundId, volumeMultiplier = 1.0) {
        if (!this.soundsEnabled) return;

        const soundData = this.sounds[soundId];
        if (!soundData || !soundData.audio) {
            return;
        }

        // Clone the config to avoid modifying the original
        const config = JSON.parse(JSON.stringify(soundData.audio));

        // Apply volume multiplier
        config.volume = (config.volume || 0.5) * this.masterVolume * volumeMultiplier;

        // Generate unique ID for this sound instance
        const uniqueId = `${soundId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        try {
            this.playSynthSound(uniqueId, config);
        } catch (e) {
            // Ignore audio errors
        }
    }

    // ============================================
    // SOUND SERVICES - Called by other systems
    // ============================================

    playCardPickup() {
        this.playSoundEffect('card_pickup');
    }

    playCardPlace() {
        this.playSoundEffect('card_place');
    }

    playCardDraw() {
        this.playSoundEffect('card_draw');
    }

    playCardFlip() {
        this.playSoundEffect('card_flip');
    }

    playCardInvalid() {
        this.playSoundEffect('card_invalid');
    }

    playCardShuffle() {
        this.playSoundEffect('card_shuffle');
    }

    playVictory() {
        this.playSoundEffect('victory');
    }

    playDeath() {
        this.playSoundEffect('card_invalid'); // TODO: Add death sound
    }

    playDamage() {
        this.playSoundEffect('card_invalid'); // TODO: Add damage sound
    }

    playHeal() {
        this.playSoundEffect('card_place'); // TODO: Add heal sound
    }

    playThreatResolve() {
        this.playSoundEffect('card_place'); // TODO: Add threat resolve sound
    }

    // ============================================
    // EVENT HANDLERS - React to game events
    // ============================================

    onCardPickedUp(data) {
        this.playCardPickup();
    }

    onCardDrawn(data) {
        this.playCardDraw();
    }

    onInvalidMove(data) {
        this.playCardInvalid();
    }

    onDamageTaken(data) {
        this.playDamage();
    }

    onDamageHealed(data) {
        this.playHeal();
    }

    onThreatResolved(data) {
        this.playThreatResolve();
    }

    onGameWon(data) {
        this.playVictory();
    }

    onPlayerDeath(data) {
        this.playDeath();
    }

    onNewGame(data) {
        this.playCardShuffle();
    }
}

export default AbandonedAudioSystem;
