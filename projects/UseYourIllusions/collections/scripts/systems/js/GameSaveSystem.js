/**
 * GameSaveSystem - Saves and loads player progress to localStorage
 * Persists inventory, ability slots, and belt contents between levels
 */
class GameSaveSystem extends GUTS.BaseSystem {
    static serviceDependencies = [
        'addAbilitiesToUnit'
    ];

    static services = [
        'savePlayerState',
        'loadPlayerState',
        'clearSaveData',
        'hasSaveData',
        'getSaveData'
    ];

    constructor(game) {
        super(game);
        this.game.gameSaveSystem = this;
        this.SAVE_KEY = 'useYourIllusions_saveData';
    }

    init() {
        this.collections = this.game.getCollections();
    }

    start() {
        console.log('[GameSaveSystem] Initialized');
    }

    /**
     * Event handler - called when level is completed
     */
    onLevelComplete(data) {
        console.log('[GameSaveSystem] Level complete, saving state...');
        this.savePlayerState(data.playerId);
    }

    /**
     * Event handler - called when item is granted to player
     */
    onItemGranted(data) {
        console.log('[GameSaveSystem] Item granted, saving state...', data);
        this.savePlayerState(data.entityId);
    }

    /**
     * Event handler - called when ability slots change
     */
    onAbilitySlotsChanged(data) {
        console.log('[GameSaveSystem] Ability slots changed, saving state...');
        this.savePlayerState(data.entityId);
    }

    /**
     * Save player state to localStorage
     */
    savePlayerState(playerId) {
        if (!playerId) {
            // Try to find the player
            const players = this.game.getEntitiesWith('playerController');
            playerId = players[0];
        }

        if (!playerId) {
            console.warn('[GameSaveSystem] No player entity to save');
            return;
        }

        const saveData = this.extractPlayerState(playerId);
        if (!saveData) return;

        try {
            localStorage.setItem(this.SAVE_KEY, JSON.stringify(saveData));
            console.log('[GameSaveSystem] Player state saved:', saveData);
        } catch (e) {
            console.error('[GameSaveSystem] Failed to save to localStorage:', e);
        }
    }

    /**
     * Extract saveable state from player entity
     */
    extractPlayerState(playerId) {
        const inventory = this.game.getComponent(playerId, 'playerInventory');
        const abilitySlots = this.game.getComponent(playerId, 'abilitySlots');
        const magicBelt = this.game.getComponent(playerId, 'magicBelt');

        const saveData = {
            version: 1,
            timestamp: Date.now(),
            inventory: {
                items: inventory?.items ? [...inventory.items] : []
            },
            abilitySlots: {
                slotQ: abilitySlots?.slotQ || null,
                slotE: abilitySlots?.slotE || null,
                slotR: abilitySlots?.slotR || null
            }
        };

        // Save magic belt state if player has it
        if (magicBelt) {
            saveData.hasMagicBelt = true;
            saveData.magicBelt = {
                slot0: magicBelt.slot0,
                slot1: magicBelt.slot1,
                slot2: magicBelt.slot2,
                selectedSlot: magicBelt.selectedSlot,
                nextSlot: magicBelt.nextSlot,
                illusion0: magicBelt.illusion0,
                illusion1: magicBelt.illusion1,
                illusion2: magicBelt.illusion2
            };
        } else {
            saveData.hasMagicBelt = false;
        }

        return saveData;
    }

    /**
     * Load saved player state and apply to player entity
     */
    loadPlayerState(playerId) {
        if (!playerId) {
            console.warn('[GameSaveSystem] No player entity to load into');
            return false;
        }

        const saveData = this.getSaveData();
        if (!saveData) {
            console.log('[GameSaveSystem] No save data found');
            return false;
        }

        console.log('[GameSaveSystem] Loading player state:', saveData);

        // Restore inventory
        const inventory = this.game.getComponent(playerId, 'playerInventory');
        if (inventory && saveData.inventory) {
            inventory.items = saveData.inventory.items || [];
        }

        // Restore ability slots
        const abilitySlots = this.game.getComponent(playerId, 'abilitySlots');
        if (abilitySlots && saveData.abilitySlots) {
            abilitySlots.slotQ = saveData.abilitySlots.slotQ;
            abilitySlots.slotE = saveData.abilitySlots.slotE;
            abilitySlots.slotR = saveData.abilitySlots.slotR;
        }

        // Restore magic belt if player had it
        if (saveData.hasMagicBelt) {
            // Add magicBelt component if not present
            if (!this.game.hasComponent(playerId, 'magicBelt')) {
                this.game.addComponent(playerId, 'magicBelt', {});
            }

            const magicBelt = this.game.getComponent(playerId, 'magicBelt');
            if (magicBelt && saveData.magicBelt) {
                magicBelt.slot0 = saveData.magicBelt.slot0;
                magicBelt.slot1 = saveData.magicBelt.slot1;
                magicBelt.slot2 = saveData.magicBelt.slot2;
                magicBelt.selectedSlot = saveData.magicBelt.selectedSlot;
                magicBelt.nextSlot = saveData.magicBelt.nextSlot;
                magicBelt.illusion0 = saveData.magicBelt.illusion0;
                magicBelt.illusion1 = saveData.magicBelt.illusion1;
                magicBelt.illusion2 = saveData.magicBelt.illusion2;
            }

            // Re-grant abilities from saved items
            this.restoreAbilitiesFromItems(playerId, saveData.inventory.items);
        }

        // Trigger event so UI can update
        this.game.triggerEvent('onPlayerStateLoaded', { entityId: playerId });

        return true;
    }

    /**
     * Restore abilities from saved items
     */
    restoreAbilitiesFromItems(playerId, items) {
        if (!items || items.length === 0) return;

        for (const itemId of items) {
            const itemData = this.collections.items?.[itemId];
            if (!itemData) continue;

            // Grant abilities from item
            if (itemData.grantsAbilities && itemData.grantsAbilities.length > 0) {
                this.call.addAbilitiesToUnit(playerId, itemData.grantsAbilities);
            }
        }
    }

    /**
     * Get save data from localStorage
     */
    getSaveData() {
        try {
            const data = localStorage.getItem(this.SAVE_KEY);
            return data ? JSON.parse(data) : null;
        } catch (e) {
            console.error('[GameSaveSystem] Failed to load save data:', e);
            return null;
        }
    }

    /**
     * Check if save data exists
     */
    hasSaveData() {
        return localStorage.getItem(this.SAVE_KEY) !== null;
    }

    /**
     * Clear all save data (for new game)
     */
    clearSaveData() {
        try {
            localStorage.removeItem(this.SAVE_KEY);
            console.log('[GameSaveSystem] Save data cleared');
        } catch (e) {
            console.error('[GameSaveSystem] Failed to clear save data:', e);
        }
    }
}
