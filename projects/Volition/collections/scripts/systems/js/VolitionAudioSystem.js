import AudioSystem from '../../../../../../global/collections/scripts/systems/js/AudioSystem.js';

/**
 * VolitionAudioSystem - Handles all audio playback for Volition
 * Extends the global AudioSystem to add game-specific sound methods
 */
class VolitionAudioSystem extends AudioSystem {
    static services = [
        // Inherit base services
        ...AudioSystem.services,
        // Add Volition-specific services
        'playCardPickup', 'playCardPlace', 'playCardFoundation', 'playCardDraw',
        'playCardFlip', 'playCardInvalid', 'playCardShuffle', 'playVictory', 'playHarbingerAppear'
    ];

    constructor(game) {
        super(game);
        this.soundsEnabled = true;
        this.masterVolume = 1.0;
    }

    init() {
        super.init();
        console.log('VolitionAudioSystem initializing...');
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
            console.warn(`AudioSystem: Sound '${soundId}' not found`);
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
            console.warn(`AudioSystem: Failed to play sound '${soundId}':`, e);
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

    playCardFoundation() {
        // Disabled for now - needs better sound design
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

    playHarbingerAppear() {
        // Disabled for now - sounds like a drum
    }

    // ============================================
    // EVENT HANDLERS - React to game events
    // ============================================

    onCardPlayedToTableau(data) {
        this.playCardPlace();
    }

    onCardPickedUp(data) {
        this.playCardPickup();
    }

    onCardDrawn(data) {
        this.playCardDraw();
    }

    onInvalidMove(data) {
        this.playCardInvalid();
    }

    onHarbingerAppear(data) {
        this.playHarbingerAppear();
    }

    onGameWon(data) {
        this.playVictory();
    }

    onNewGame(data) {
        this.playCardShuffle();
    }
}
