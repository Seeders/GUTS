class CharacterClassSystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.characterClassSystem = this;
        this.componentTypes = this.game.componentManager.getComponentTypes();

        // Available character classes
        this.classes = {
            warrior: {
                name: 'Warrior',
                description: 'A mighty melee fighter with high health and armor',
                icon: 'unit_barbarian',
                baseUnit: 'barbarian',
                baseStats: {
                    health: 500,
                    damage: 25,
                    armor: 10,
                    attackSpeed: 1.0,
                    moveSpeed: 140,
                    mana: 50,
                    manaRegen: 2
                },
                startingAbilities: ['ChargeAbility', 'ShieldWallAbility'],
                skillTree: 'warrior'
            },
            ranger: {
                name: 'Ranger',
                description: 'A swift ranged attacker with high dexterity',
                icon: 'unit_archer',
                baseUnit: 'archer',
                baseStats: {
                    health: 350,
                    damage: 20,
                    armor: 3,
                    attackSpeed: 1.3,
                    moveSpeed: 160,
                    mana: 80,
                    manaRegen: 4
                },
                startingAbilities: ['MultiShotAbility', 'PiercingShotAbility'],
                skillTree: 'ranger'
            },
            mage: {
                name: 'Mage',
                description: 'A powerful spellcaster with devastating magic',
                icon: 'unit_apprentice',
                baseUnit: 'apprentice',
                baseStats: {
                    health: 280,
                    damage: 15,
                    armor: 2,
                    attackSpeed: 0.8,
                    moveSpeed: 130,
                    mana: 150,
                    manaRegen: 8
                },
                startingAbilities: ['FireBallAbility', 'LightningBoltAbility'],
                skillTree: 'mage'
            },
            paladin: {
                name: 'Paladin',
                description: 'A holy warrior with healing and combat abilities',
                icon: 'unit_acolyte',
                baseUnit: 'acolyte',
                baseStats: {
                    health: 420,
                    damage: 18,
                    armor: 8,
                    attackSpeed: 0.9,
                    moveSpeed: 135,
                    mana: 100,
                    manaRegen: 5
                },
                startingAbilities: ['HealAbility', 'SmiteAbility'],
                skillTree: 'paladin'
            },
            assassin: {
                name: 'Assassin',
                description: 'A stealthy fighter with critical strikes',
                icon: 'unit_rogue',
                baseUnit: 'scout',
                baseStats: {
                    health: 320,
                    damage: 30,
                    armor: 4,
                    attackSpeed: 1.5,
                    moveSpeed: 180,
                    mana: 70,
                    manaRegen: 4
                },
                startingAbilities: ['ShadowStrikeAbility', 'ExplosiveTrapAbility'],
                skillTree: 'assassin'
            },
            necromancer: {
                name: 'Necromancer',
                description: 'A dark mage who commands the undead',
                icon: 'unit_apprentice',
                baseUnit: 'apprentice',
                baseStats: {
                    health: 300,
                    damage: 12,
                    armor: 3,
                    attackSpeed: 0.7,
                    moveSpeed: 125,
                    mana: 130,
                    manaRegen: 7
                },
                startingAbilities: ['RaiseDeadAbility', 'DrainLifeAbility'],
                skillTree: 'necromancer'
            }
        };

        // Selected class for player
        this.selectedClass = null;
    }

    init() {
        this.game.gameManager.register('getAvailableClasses', () => this.classes);
        this.game.gameManager.register('getClassData', (classId) => this.classes[classId]);
        this.game.gameManager.register('selectClass', this.selectClass.bind(this));
        this.game.gameManager.register('getSelectedClass', () => this.selectedClass);
        this.game.gameManager.register('createPlayerWithClass', this.createPlayerWithClass.bind(this));
    }

    selectClass(classId) {
        if (this.classes[classId]) {
            this.selectedClass = classId;
            this.game.triggerEvent('onClassSelected', {
                classId,
                classData: this.classes[classId]
            });
            return true;
        }
        return false;
    }

    createPlayerWithClass(classId = null) {
        const chosenClass = classId || this.selectedClass;
        if (!chosenClass || !this.classes[chosenClass]) {
            console.warn('No class selected, defaulting to warrior');
            this.selectedClass = 'warrior';
        }

        const classData = this.classes[this.selectedClass || chosenClass];
        const CT = this.componentTypes;
        const Components = this.game.componentManager.getComponents();
        const collections = this.game.getCollections();

        // Get base unit data for visuals
        const unitData = collections.units[classData.baseUnit] || {};

        // Create player entity
        const entityId = this.game.createEntity();

        // Add core components
        this.game.addComponent(entityId, CT.POSITION, Components.Position(0, 0, 0));
        this.game.addComponent(entityId, CT.VELOCITY, Components.Velocity(
            0, 0, 0,
            classData.baseStats.moveSpeed,
            false,
            false
        ));
        this.game.addComponent(entityId, CT.FACING, Components.Facing(0));
        this.game.addComponent(entityId, CT.COLLISION, Components.Collision(unitData.size || 25, 50));

        // Health and combat from class stats
        this.game.addComponent(entityId, CT.HEALTH, Components.Health(classData.baseStats.health));
        this.game.addComponent(entityId, CT.COMBAT, Components.Combat(
            classData.baseStats.damage,
            unitData.range || 30,
            classData.baseStats.attackSpeed,
            unitData.projectile || null,
            0,
            unitData.element || 'physical',
            classData.baseStats.armor,
            0, 0, 0, 0, // resistances
            unitData.visionRange || 500
        ));

        // Team and type
        this.game.addComponent(entityId, CT.TEAM, Components.Team('player'));
        this.game.addComponent(entityId, CT.UNIT_TYPE, Components.UnitType({
            id: classData.baseUnit,
            className: this.selectedClass || chosenClass,
            ...unitData
        }));

        // AI state
        this.game.addComponent(entityId, CT.AI_STATE, Components.AIState('idle', null, null, null, {
            initialized: true
        }));

        // Resource pools
        this.game.addComponent(entityId, CT.RESOURCE_POOL, Components.ResourcePool(
            classData.baseStats.mana,
            classData.baseStats.mana,
            classData.baseStats.manaRegen,
            100, 100, 10 // stamina
        ));

        // Ability cooldowns
        this.game.addComponent(entityId, CT.ABILITY_COOLDOWNS, Components.AbilityCooldowns({}));

        // Equipment
        this.game.addComponent(entityId, CT.EQUIPMENT, Components.Equipment({}));

        // Renderable
        if (unitData.render) {
            this.game.addComponent(entityId, CT.RENDERABLE, Components.Renderable(
                'units',
                classData.baseUnit,
                128
            ));
        }

        // Register as player entity
        this.game.gameManager.call('setPlayerEntity', entityId);

        // Add starting abilities
        if (this.game.abilitySystem) {
            for (const abilityId of classData.startingAbilities) {
                this.game.gameManager.call('addAbilityToEntity', entityId, abilityId);
            }
        }

        // Initialize skill tree
        if (this.game.skillTreeSystem) {
            this.game.gameManager.call('initializeSkillTree', entityId, classData.skillTree);
        }

        this.game.triggerEvent('onPlayerCreated', {
            entityId,
            classId: this.selectedClass || chosenClass,
            classData
        });

        return entityId;
    }

    update() {
        // No per-frame updates needed
    }
}
