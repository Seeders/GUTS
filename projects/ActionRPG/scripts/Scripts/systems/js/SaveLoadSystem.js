class SaveLoadSystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.saveLoadSystem = this;
        this.componentTypes = this.game.componentManager.getComponentTypes();
        this.SAVE_KEY = 'actionrpg_save';
    }

    init() {
        this.game.gameManager.register('saveGame', this.saveGame.bind(this));
        this.game.gameManager.register('loadGame', this.loadGame.bind(this));
        this.game.gameManager.register('hasSaveData', this.hasSaveData.bind(this));
        this.game.gameManager.register('deleteSave', this.deleteSave.bind(this));
    }

    hasSaveData() {
        return localStorage.getItem(this.SAVE_KEY) !== null;
    }

    saveGame() {
        const playerEntityId = this.game.gameManager.call('getPlayerEntity');
        if (!playerEntityId) return false;

        const CT = this.componentTypes;
        const health = this.game.getComponent(playerEntityId, CT.HEALTH);
        const combat = this.game.getComponent(playerEntityId, CT.COMBAT);
        const resources = this.game.getComponent(playerEntityId, CT.RESOURCE_POOL);
        const position = this.game.getComponent(playerEntityId, CT.POSITION);
        const unitType = this.game.getComponent(playerEntityId, CT.UNIT_TYPE);

        const saveData = {
            version: 1,
            timestamp: Date.now(),
            player: {
                className: unitType?.className || 'warrior',
                level: this.game.gameManager.call('getEntityLevel', playerEntityId) || 1,
                experience: this.game.gameManager.call('getEntityExperience', playerEntityId),
                health: { max: health?.max, current: health?.current },
                mana: { max: resources?.maxMana, current: resources?.mana },
                combat: {
                    damage: combat?.damage,
                    armor: combat?.armor,
                    attackSpeed: combat?.attackSpeed
                },
                position: { x: position?.x, y: position?.y, z: position?.z }
            },
            game: {
                gold: this.game.gameManager.call('getPlayerGold'),
                kills: this.game.gameManager.call('getPlayerKills'),
                dungeonLevel: this.game.gameManager.call('getCurrentLevel')
            },
            inventory: this.game.gameManager.call('getInventory', playerEntityId),
            skills: this.game.gameManager.call('getEntitySkills', playerEntityId),
            potions: this.game.gameManager.call('getPotionInventory', playerEntityId)
        };

        try {
            localStorage.setItem(this.SAVE_KEY, JSON.stringify(saveData));
            this.game.gameManager.call('showMessage', 'Game saved!');
            return true;
        } catch (e) {
            console.error('Failed to save:', e);
            return false;
        }
    }

    loadGame() {
        try {
            const data = localStorage.getItem(this.SAVE_KEY);
            if (!data) return false;

            const saveData = JSON.parse(data);

            // Select class and create player
            this.game.gameManager.call('selectClass', saveData.player.className);
            this.game.gameManager.call('startARPG');

            const playerEntityId = this.game.gameManager.call('getPlayerEntity');
            if (!playerEntityId) return false;

            const CT = this.componentTypes;

            // Restore stats
            const health = this.game.getComponent(playerEntityId, CT.HEALTH);
            if (health && saveData.player.health) {
                health.max = saveData.player.health.max;
                health.current = saveData.player.health.current;
            }

            const resources = this.game.getComponent(playerEntityId, CT.RESOURCE_POOL);
            if (resources && saveData.player.mana) {
                resources.maxMana = saveData.player.mana.max;
                resources.mana = saveData.player.mana.current;
            }

            const combat = this.game.getComponent(playerEntityId, CT.COMBAT);
            if (combat && saveData.player.combat) {
                combat.damage = saveData.player.combat.damage;
                combat.armor = saveData.player.combat.armor;
                combat.attackSpeed = saveData.player.combat.attackSpeed;
            }

            // Restore position
            const position = this.game.getComponent(playerEntityId, CT.POSITION);
            if (position && saveData.player.position) {
                position.x = saveData.player.position.x;
                position.y = saveData.player.position.y;
                position.z = saveData.player.position.z;
            }

            // Restore game state
            if (saveData.game) {
                if (this.game.arpgGameSystem) {
                    this.game.arpgGameSystem.playerGold = saveData.game.gold || 0;
                    this.game.arpgGameSystem.playerKills = saveData.game.kills || 0;
                }
                this.game.gameManager.call('setDungeonLevel', saveData.game.dungeonLevel || 1);
            }

            this.game.gameManager.call('showMessage', 'Game loaded!');
            return true;
        } catch (e) {
            console.error('Failed to load:', e);
            return false;
        }
    }

    deleteSave() {
        localStorage.removeItem(this.SAVE_KEY);
        this.game.gameManager.call('showMessage', 'Save deleted');
    }

    update() {}
}
