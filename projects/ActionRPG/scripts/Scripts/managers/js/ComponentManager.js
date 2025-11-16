class ComponentManager {
    constructor(game) {
        this.game = game;
        this.game.componentManager = this;
        this.models = this.game.getCollections().models;
        this.game.componentTypes = this.getComponentTypes();
    }

    deepMerge(target, source) {
        const result = { ...target };

        for (const key in source) {
            if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                result[key] = this.deepMerge(result[key] || {}, source[key]);
            } else {
                result[key] = source[key] == 'null' ? null : source[key];
            }
        }

        return result;
    }

    getModels() {
        let components = {};
        Object.keys(this.models).forEach((modelId) => {
            const data = this.models[modelId];
            components[modelId] = (params = {}) => {
                return this.deepMerge(data, params);
            };
        });
        return components;
    }

    getComponents() {
        return {
            // Core components
            Position: (x = 0, y = 0, z = 0) => ({ x, y, z }),
            Velocity: (vx = 0, vy = 0, vz = 0, maxSpeed = 5, affectedByGravity = true, anchored = false) =>
                ({ vx, vy, vz, maxSpeed, affectedByGravity, anchored }),
            Facing: (angle = 0) => ({ angle }),
            Renderable: (objectType, spawnType, capacity = 128) => ({ objectType, spawnType, capacity }),
            Collision: (radius = 0.5, height = 2) => ({ radius, height }),
            Health: (max = 100, current = null) => ({ max, current: current !== null ? current : max }),
            Mana: (max = 100, current = null, regen = 1) => ({ max, current: current !== null ? current : max, regen }),

            // Player-specific components
            PlayerController: (
                moveSpeed = 5,
                isMoving = false,
                targetPosition = null,
                attackTarget = null,
                selectedSkill = null
            ) => ({
                moveSpeed,
                isMoving,
                targetPosition,
                attackTarget,
                selectedSkill
            }),

            // Combat components
            Combat: (
                damage = 10,
                range = 1.5,
                attackSpeed = 1.0,
                element = 'physical',
                armor = 0,
                fireResistance = 0,
                coldResistance = 0,
                lightningResistance = 0,
                poisonResistance = 0,
                critChance = 0.05,
                critMultiplier = 1.5,
                lastAttack = 0
            ) => ({
                damage,
                range,
                attackSpeed,
                element,
                armor,
                fireResistance,
                coldResistance,
                lightningResistance,
                poisonResistance,
                critChance,
                critMultiplier,
                lastAttack
            }),

            // Character stats
            Stats: (
                strength = 10,
                dexterity = 10,
                intelligence = 10,
                vitality = 10,
                level = 1,
                experience = 0,
                experienceToNextLevel = 100
            ) => ({
                strength,
                dexterity,
                intelligence,
                vitality,
                level,
                experience,
                experienceToNextLevel
            }),

            // Inventory system
            Inventory: (capacity = 40, gold = 0) => ({
                items: [],
                capacity,
                gold
            }),

            Equipment: (slots = {}) => ({
                slots: {
                    weapon: null,
                    offhand: null,
                    helmet: null,
                    chest: null,
                    legs: null,
                    boots: null,
                    gloves: null,
                    amulet: null,
                    ring1: null,
                    ring2: null,
                    ...slots
                }
            }),

            Item: (
                itemType,
                name,
                rarity = 'common',
                stats = {},
                stackSize = 1,
                maxStack = 1,
                value = 0
            ) => ({
                itemType,
                name,
                rarity,
                stats,
                stackSize,
                maxStack,
                value
            }),

            // Skills and abilities
            Skills: (skills = []) => ({ skills, cooldowns: {} }),

            Skill: (
                skillId,
                name,
                manaCost = 10,
                cooldown = 1,
                damage = 0,
                range = 5,
                areaOfEffect = 0,
                element = 'physical',
                effects = []
            ) => ({
                skillId,
                name,
                manaCost,
                cooldown,
                damage,
                range,
                areaOfEffect,
                element,
                effects
            }),

            // Enemy AI components
            EnemyAI: (
                aggroRange = 10,
                chaseRange = 15,
                attackRange = 1.5,
                state = 'idle',
                target = null,
                patrolPath = [],
                currentPatrolIndex = 0
            ) => ({
                aggroRange,
                chaseRange,
                attackRange,
                state,
                target,
                patrolPath,
                currentPatrolIndex
            }),

            // Loot drops
            LootTable: (items = [], goldMin = 0, goldMax = 10, dropChance = 1.0) => ({
                items,
                goldMin,
                goldMax,
                dropChance
            }),

            // Visual effects
            Animation: (scale = 1, rotation = 0, flash = 0) => ({ scale, rotation, flash }),

            Projectile: (
                damage = 10,
                speed = 10,
                range = 10,
                target = null,
                source = null,
                startTime = 0,
                element = 'physical',
                piercing = false
            ) => ({
                damage,
                speed,
                range,
                target,
                source,
                startTime,
                element,
                piercing
            }),

            ParticleEffect: (
                effectType = 'explosion',
                duration = 1,
                startTime = 0,
                color = 0xff0000
            ) => ({
                effectType,
                duration,
                startTime,
                color
            }),

            // Status effects
            StatusEffect: (
                effectType = 'poison',
                duration = 5,
                tickDamage = 5,
                tickRate = 1,
                lastTick = 0,
                startTime = 0,
                slowAmount = 0,
                stunned = false
            ) => ({
                effectType,
                duration,
                tickDamage,
                tickRate,
                lastTick,
                startTime,
                slowAmount,
                stunned
            }),

            // Misc components
            Team: (team = 'neutral') => ({ team }),
            Lifetime: (duration = 5, startTime = 0) => ({ duration, startTime }),
            ExperienceReward: (amount = 10) => ({ amount }),
            FollowTarget: (targetId = null, offset = { x: 0, y: 0, z: 0 }) => ({ targetId, offset }),
            Nameplate: (name = '', color = 0xffffff) => ({ name, color }),
            MinimapIcon: (iconType = 'enemy', color = 0xff0000) => ({ iconType, color }),
        };
    }

    getComponentTypes() {
        const components = this.getComponents();
        const models = this.getModels();
        return { ...components, ...models };
    }
}
