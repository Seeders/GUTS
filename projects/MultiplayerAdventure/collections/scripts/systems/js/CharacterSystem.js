/**
 * CharacterSystem - Manages player character progression
 *
 * Handles:
 * - Experience and leveling
 * - Stats calculation
 * - Class abilities
 * - Character persistence
 */
class CharacterSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.characterSystem = this;

        // Experience table (exp required to reach each level)
        this.experienceTable = this.generateExpTable(50);

        // Base stats per class
        this.classStats = {
            warrior: { health: 150, damage: 15, defense: 10, speed: 100 },
            mage: { health: 80, damage: 25, defense: 5, speed: 110 },
            rogue: { health: 100, damage: 20, defense: 7, speed: 140 },
            healer: { health: 90, damage: 10, defense: 8, speed: 105 }
        };

        // Class abilities
        this.classAbilities = {
            warrior: ['basic_attack', 'shield_bash', 'whirlwind', 'battle_cry'],
            mage: ['basic_attack', 'fireball', 'ice_nova', 'arcane_shield'],
            rogue: ['basic_attack', 'backstab', 'smoke_bomb', 'poison_blade'],
            healer: ['basic_attack', 'heal', 'holy_light', 'resurrection']
        };
    }

    init(params) {
        this.params = params || {};
        console.log('[CharacterSystem] Initializing...');
        this.registerServices();
    }

    registerServices() {
        // Experience
        this.game.register('awardExperience', this.awardExperience.bind(this));
        this.game.register('awardPartyExperience', this.awardPartyExperience.bind(this));
        this.game.register('getExperienceForLevel', this.getExperienceForLevel.bind(this));
        this.game.register('getExperienceProgress', this.getExperienceProgress.bind(this));

        // Gold
        this.game.register('awardGold', this.awardGold.bind(this));
        this.game.register('spendGold', this.spendGold.bind(this));
        this.game.register('getGold', () => this.game.state.playerGold || 0);

        // Stats
        this.game.register('getPlayerStats', this.getPlayerStats.bind(this));
        this.game.register('calculateStats', this.calculateStats.bind(this));

        // Abilities
        this.game.register('getPlayerAbilities', this.getPlayerAbilities.bind(this));
        this.game.register('getClassAbilities', (classId) => this.classAbilities[classId] || []);

        // Character data
        this.game.register('saveCharacter', this.saveCharacter.bind(this));
        this.game.register('loadCharacter', this.loadCharacter.bind(this));
    }

    generateExpTable(maxLevel) {
        const table = [0];
        for (let level = 1; level <= maxLevel; level++) {
            // Exponential curve: each level requires more XP
            const xp = Math.floor(100 * Math.pow(1.5, level - 1));
            table.push(table[level - 1] + xp);
        }
        return table;
    }

    getExperienceForLevel(level) {
        if (level < 1) return 0;
        if (level >= this.experienceTable.length) {
            return this.experienceTable[this.experienceTable.length - 1];
        }
        return this.experienceTable[level];
    }

    getExperienceProgress() {
        const level = this.game.state.playerLevel || 1;
        const currentXP = this.game.state.playerExperience || 0;
        const xpForCurrentLevel = this.getExperienceForLevel(level);
        const xpForNextLevel = this.getExperienceForLevel(level + 1);
        const xpNeeded = xpForNextLevel - xpForCurrentLevel;
        const xpProgress = currentXP - xpForCurrentLevel;

        return {
            level,
            currentXP,
            xpForNextLevel,
            xpProgress,
            xpNeeded,
            percentage: xpNeeded > 0 ? (xpProgress / xpNeeded) * 100 : 100
        };
    }

    awardExperience(amount) {
        if (!this.game.state.playerExperience) {
            this.game.state.playerExperience = 0;
        }

        this.game.state.playerExperience += amount;
        this.game.call('showNotification', `+${amount} XP`, 'info');

        // Check for level up
        this.checkLevelUp();
    }

    awardPartyExperience(amountPerMember) {
        // Award to local player
        this.awardExperience(amountPerMember);

        // Server will award to other party members
    }

    checkLevelUp() {
        const currentLevel = this.game.state.playerLevel || 1;
        const currentXP = this.game.state.playerExperience || 0;
        const xpForNextLevel = this.getExperienceForLevel(currentLevel + 1);

        if (currentXP >= xpForNextLevel && currentLevel < this.experienceTable.length - 1) {
            this.game.state.playerLevel = currentLevel + 1;

            // Heal to full on level up
            const localPlayer = this.game.call('getLocalPlayerEntity');
            if (localPlayer) {
                const health = this.game.getComponent(localPlayer, 'health');
                if (health) {
                    // Recalculate max health based on new level
                    const stats = this.calculateStats(currentLevel + 1);
                    health.max = stats.health;
                    health.current = health.max;
                }

                // Update player character level
                const playerChar = this.game.getComponent(localPlayer, 'playerCharacter');
                if (playerChar) {
                    playerChar.level = currentLevel + 1;
                }
            }

            this.game.call('showNotification', `Level Up! You are now level ${currentLevel + 1}!`, 'success');
            this.game.triggerEvent('onLevelUp', { newLevel: currentLevel + 1 });

            // Check for more level ups
            this.checkLevelUp();
        }
    }

    awardGold(amount) {
        if (!this.game.state.playerGold) {
            this.game.state.playerGold = 0;
        }
        this.game.state.playerGold += amount;
        this.game.call('showNotification', `+${amount} Gold`, 'success');
    }

    spendGold(amount) {
        if ((this.game.state.playerGold || 0) < amount) {
            this.game.call('showNotification', 'Not enough gold!', 'error');
            return false;
        }
        this.game.state.playerGold -= amount;
        return true;
    }

    getPlayerStats() {
        const localPlayer = this.game.call('getLocalPlayerEntity');
        if (!localPlayer) return null;

        const playerChar = this.game.getComponent(localPlayer, 'playerCharacter');
        const health = this.game.getComponent(localPlayer, 'health');

        return {
            level: playerChar?.level || this.game.state.playerLevel || 1,
            characterClass: playerChar?.characterClass || 'warrior',
            health: health ? { current: health.current, max: health.max } : { current: 100, max: 100 },
            experience: this.game.state.playerExperience || 0,
            gold: this.game.state.playerGold || 0
        };
    }

    calculateStats(level, characterClass = 'warrior') {
        const baseStats = this.classStats[characterClass] || this.classStats.warrior;
        const levelMultiplier = 1 + (level - 1) * 0.1; // 10% increase per level

        return {
            health: Math.floor(baseStats.health * levelMultiplier),
            damage: Math.floor(baseStats.damage * levelMultiplier),
            defense: Math.floor(baseStats.defense * levelMultiplier),
            speed: baseStats.speed // Speed doesn't scale with level
        };
    }

    getPlayerAbilities() {
        const localPlayer = this.game.call('getLocalPlayerEntity');
        if (!localPlayer) return ['basic_attack'];

        const playerChar = this.game.getComponent(localPlayer, 'playerCharacter');
        const characterClass = playerChar?.characterClass || 'warrior';

        // Return abilities based on class and level
        const classAbils = this.classAbilities[characterClass] || ['basic_attack'];
        const level = playerChar?.level || 1;

        // Unlock abilities at certain levels
        const unlockedCount = Math.min(classAbils.length, Math.floor(level / 5) + 2);
        return classAbils.slice(0, unlockedCount);
    }

    saveCharacter() {
        const stats = this.getPlayerStats();
        const inventory = this.game.call('getInventory') || [];
        const equipment = this.game.call('getEquipment') || {};

        const saveData = {
            playerName: this.game.call('getPlayerName'),
            level: stats?.level || 1,
            experience: this.game.state.playerExperience || 0,
            gold: this.game.state.playerGold || 0,
            characterClass: stats?.characterClass || 'warrior',
            inventory,
            equipment,
            timestamp: Date.now()
        };

        localStorage.setItem('character_save', JSON.stringify(saveData));
        console.log('[CharacterSystem] Character saved');
        return true;
    }

    loadCharacter() {
        const saveDataStr = localStorage.getItem('character_save');
        if (!saveDataStr) return null;

        try {
            const saveData = JSON.parse(saveDataStr);

            // Restore state
            this.game.state.playerLevel = saveData.level || 1;
            this.game.state.playerExperience = saveData.experience || 0;
            this.game.state.playerGold = saveData.gold || 0;

            // Restore inventory
            if (saveData.inventory) {
                this.game.call('setInventory', saveData.inventory);
            }

            // Restore equipment
            if (saveData.equipment) {
                this.game.call('setEquipment', saveData.equipment);
            }

            console.log('[CharacterSystem] Character loaded');
            return saveData;
        } catch (error) {
            console.error('[CharacterSystem] Failed to load character:', error);
            return null;
        }
    }

    update() {
        // Periodic save (every 60 seconds)
        if (!this.lastSaveTime) this.lastSaveTime = 0;
        if (this.game.state.now - this.lastSaveTime > 60) {
            this.saveCharacter();
            this.lastSaveTime = this.game.state.now;
        }
    }
}
