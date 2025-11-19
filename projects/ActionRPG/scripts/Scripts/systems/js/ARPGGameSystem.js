class ARPGGameSystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.arpgGameSystem = this;
        this.componentTypes = this.game.componentManager.getComponentTypes();

        // Game state
        this.gameStarted = false;
        this.gamePaused = false;
        this.currentLevel = 1;
        this.currentDungeon = 'forest';

        // Player stats
        this.playerGold = 0;
        this.playerKills = 0;

        // Spawn configuration
        this.spawnWaves = [];
        this.currentWave = 0;
        this.enemiesAlive = 0;
        this.totalEnemiesKilled = 0;

        // Difficulty scaling
        this.difficultyMultiplier = 1.0;
        this.DIFFICULTY_SCALE_PER_LEVEL = 0.1;
    }

    init() {
        // Register game management functions
        this.game.gameManager.register('startARPG', this.startGame.bind(this));
        this.game.gameManager.register('pauseARPG', this.pauseGame.bind(this));
        this.game.gameManager.register('resumeARPG', this.resumeGame.bind(this));
        this.game.gameManager.register('getPlayerGold', () => this.playerGold);
        this.game.gameManager.register('addPlayerGold', this.addGold.bind(this));
        this.game.gameManager.register('spendPlayerGold', this.spendGold.bind(this));
        this.game.gameManager.register('getPlayerKills', () => this.playerKills);
        this.game.gameManager.register('incrementKills', this.incrementKills.bind(this));
        this.game.gameManager.register('getCurrentLevel', () => this.currentLevel);
        this.game.gameManager.register('setDungeonLevel', this.setDungeonLevel.bind(this));
        this.game.gameManager.register('getDifficultyMultiplier', () => this.difficultyMultiplier);

        // Listen for death events to track kills
        this.game.gameManager.register('onEnemyDeath', this.onEnemyDeath.bind(this));

        // Force the game into battle phase for ARPG (real-time combat)
        this.game.state.phase = 'battle';
    }

    startGame() {
        this.gameStarted = true;
        this.gamePaused = false;

        // Ensure we're in battle phase
        this.game.state.phase = 'battle';

        // Initialize player
        this.initializePlayer();

        // Trigger game start event
        this.game.triggerEvent('onARPGGameStart', {
            level: this.currentLevel,
            dungeon: this.currentDungeon
        });
    }

    pauseGame() {
        this.gamePaused = true;
        this.game.triggerEvent('onARPGGamePause');
    }

    resumeGame() {
        this.gamePaused = false;
        this.game.triggerEvent('onARPGGameResume');
    }

    initializePlayer() {
        // Create or find the player entity
        const playerEntityId = this.game.gameManager.call('getPlayerEntity');

        if (!playerEntityId) {
            // Use CharacterClassSystem to create player with selected class
            if (this.game.characterClassSystem) {
                const selectedClass = this.game.gameManager.call('getSelectedClass');
                if (selectedClass) {
                    this.game.gameManager.call('createPlayerWithClass', selectedClass);
                } else {
                    // Default to warrior if no class selected
                    this.game.gameManager.call('selectClass', 'warrior');
                    this.game.gameManager.call('createPlayerWithClass', 'warrior');
                }
            } else {
                // Fallback if CharacterClassSystem not available
                this.createPlayerCharacter();
            }
        }
    }

    createPlayerCharacter() {
        // Fallback method - use CharacterClassSystem if available
        if (this.game.characterClassSystem) {
            this.game.gameManager.call('selectClass', 'warrior');
            this.game.gameManager.call('createPlayerWithClass', 'warrior');
            return;
        }

        const CT = this.componentTypes;
        const Components = this.game.componentManager.getComponents();
        const collections = this.game.getCollections();

        // Default player unit type (use actual unit ID from prefabs)
        const playerUnitType = '1_s_barbarian';
        const unitData = collections.units[playerUnitType];

        if (!unitData) {
            console.warn('Player unit type not found:', playerUnitType);
            return;
        }

        // Create player entity with descriptive string ID
        const timestamp = this.game.state.now || Date.now();
        const entityId = this.game.createEntity(`player_${playerUnitType}_${timestamp}`);

        // Add core components
        this.game.addComponent(entityId, CT.POSITION, Components.Position(0, 0, 0));
        this.game.addComponent(entityId, CT.VELOCITY, Components.Velocity(0, 0, 0, 150, false, false));
        this.game.addComponent(entityId, CT.FACING, Components.Facing(0));
        this.game.addComponent(entityId, CT.COLLISION, Components.Collision(unitData.size || 25, 50));

        // Health and combat from unit data
        this.game.addComponent(entityId, CT.HEALTH, Components.Health(unitData.hp || 500));
        this.game.addComponent(entityId, CT.COMBAT, Components.Combat(
            unitData.damage || 25,
            unitData.range || 30,
            unitData.attackSpeed || 1.0,
            unitData.projectile || null,
            0,
            unitData.element || 'physical',
            unitData.armor || 5,
            unitData.fireResistance || 0,
            unitData.coldResistance || 0,
            unitData.lightningResistance || 0,
            unitData.poisonResistance || 0,
            unitData.visionRange || 500
        ));

        // Team and type
        this.game.addComponent(entityId, CT.TEAM, Components.Team('player'));
        this.game.addComponent(entityId, CT.UNIT_TYPE, Components.UnitType({ id: playerUnitType, ...unitData }));

        // AI state (needed for combat system)
        this.game.addComponent(entityId, CT.AI_STATE, Components.AIState('idle', null, null, null, { initialized: true }));

        // Resource pools for abilities
        this.game.addComponent(entityId, CT.RESOURCE_POOL, Components.ResourcePool(
            100, 100, 5,  // mana
            100, 100, 10  // stamina
        ));

        // Ability cooldowns
        this.game.addComponent(entityId, CT.ABILITY_COOLDOWNS, Components.AbilityCooldowns({}));

        // Equipment
        this.game.addComponent(entityId, CT.EQUIPMENT, Components.Equipment({}));

        // Set up renderable if unit has model data
        if (unitData.render) {
            this.game.addComponent(entityId, CT.RENDERABLE, Components.Renderable(
                'units',
                playerUnitType,
                128
            ));
        }

        // Register as player entity
        this.game.gameManager.call('setPlayerEntity', entityId);

        // Add abilities from unit data
        if (unitData.abilities && this.game.abilitySystem) {
            for (const abilityId of unitData.abilities) {
                this.game.gameManager.call('addAbilityToEntity', entityId, abilityId);
            }
        }

        return entityId;
    }

    addGold(amount) {
        this.playerGold += amount;
        this.game.triggerEvent('onGoldChanged', this.playerGold);
    }

    spendGold(amount) {
        if (this.playerGold >= amount) {
            this.playerGold -= amount;
            this.game.triggerEvent('onGoldChanged', this.playerGold);
            return true;
        }
        return false;
    }

    incrementKills() {
        this.playerKills++;
        this.totalEnemiesKilled++;
        this.game.triggerEvent('onKillCountChanged', this.playerKills);
    }

    onEnemyDeath(entityId, killerEntityId) {
        const team = this.game.getComponent(entityId, this.componentTypes.TEAM);

        if (team && team.team === 'enemy') {
            this.enemiesAlive--;
            this.incrementKills();

            // Award XP and gold
            const unitType = this.game.getComponent(entityId, this.componentTypes.UNIT_TYPE);
            const xpValue = unitType?.xpValue || 10;
            const goldValue = unitType?.goldValue || 5;

            // Award to player if they killed it
            const playerEntityId = this.game.gameManager.call('getPlayerEntity');
            if (killerEntityId === playerEntityId || killerEntityId === null) {
                this.game.gameManager.call('awardExperience', playerEntityId, xpValue * this.difficultyMultiplier);
                this.addGold(Math.floor(goldValue * this.difficultyMultiplier));

                // Trigger loot drop
                const pos = this.game.getComponent(entityId, this.componentTypes.POSITION);
                if (pos) {
                    this.game.gameManager.call('spawnLoot', pos.x, pos.z, unitType?.lootTable || 'common');
                }
            }
        }
    }

    setDungeonLevel(level) {
        this.currentLevel = level;
        this.difficultyMultiplier = 1.0 + (level - 1) * this.DIFFICULTY_SCALE_PER_LEVEL;

        this.game.triggerEvent('onDungeonLevelChanged', {
            level: this.currentLevel,
            difficulty: this.difficultyMultiplier
        });
    }

    update() {
        if (!this.gameStarted || this.gamePaused) return;

        // Keep game in battle phase
        if (this.game.state.phase !== 'battle') {
            this.game.state.phase = 'battle';
        }

        // Check for player death
        this.checkPlayerStatus();

        // Regenerate player resources
        this.regeneratePlayerResources();
    }

    checkPlayerStatus() {
        const playerEntityId = this.game.gameManager.call('getPlayerEntity');
        if (!playerEntityId) return;

        const health = this.game.getComponent(playerEntityId, this.componentTypes.HEALTH);
        if (health && health.current <= 0) {
            this.onPlayerDeath();
        }
    }

    onPlayerDeath() {
        this.game.triggerEvent('onPlayerDeath', {
            kills: this.playerKills,
            gold: this.playerGold,
            level: this.currentLevel
        });

        // Could implement respawn, game over screen, etc.
    }

    regeneratePlayerResources() {
        const playerEntityId = this.game.gameManager.call('getPlayerEntity');
        if (!playerEntityId) return;

        const resourcePool = this.game.getComponent(playerEntityId, this.componentTypes.RESOURCE_POOL);
        if (!resourcePool) return;

        const now = this.game.state.now;
        const deltaTime = this.game.state.deltaTime;

        // Regenerate mana
        if (resourcePool.mana < resourcePool.maxMana) {
            resourcePool.mana = Math.min(
                resourcePool.maxMana,
                resourcePool.mana + resourcePool.manaRegen * deltaTime
            );
        }

        // Regenerate stamina
        if (resourcePool.stamina < resourcePool.maxStamina) {
            resourcePool.stamina = Math.min(
                resourcePool.maxStamina,
                resourcePool.stamina + resourcePool.staminaRegen * deltaTime
            );
        }

        // Regenerate health slowly out of combat
        const aiState = this.game.getComponent(playerEntityId, this.componentTypes.AI_STATE);
        if (aiState && aiState.state === 'idle') {
            const health = this.game.getComponent(playerEntityId, this.componentTypes.HEALTH);
            if (health && health.current < health.max) {
                health.current = Math.min(
                    health.max,
                    health.current + 1 * deltaTime // Very slow regen
                );
            }
        }
    }
}
