class ComponentManager {
    constructor(game) {
        this.game = game;
        this.game.componentManager = this;
        this.models = this.game.getCollections().models;
        this.game.componentTypes = this.getComponentTypes();
        this.commandIdCounter = 0; // Deterministic counter for command IDs
        //this.models.position == { x: 0, y: 0, z: 0 };
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
    getComponents(){
        // Get base models from collection
        const models = this.getModels();

        // Create factory functions that accept positional parameters for backwards compatibility
        return {
            Position: (x = 0, y = 0, z = 0) => models.position({ x, y, z }),
            Velocity: (vx = 0, vy = 0, vz = 0, maxSpeed = 100, affectedByGravity = true, anchored = false) =>
                models.velocity({ vx, vy, vz, maxSpeed, affectedByGravity, anchored }),
            Facing: (angle = 0) => models.facing({ angle }),
            Renderable: (objectType, spawnType, capacity = 128) => models.renderable({ objectType, spawnType, capacity }),
            Collision: (radius = 1, height = 50) => models.collision({ radius, height }),
            Health: (max = 100) => models.health({ max, current: max }),
            Building: (type) => models.building({ type }),
            Combat: (
                damage = 0, range = 1, attackSpeed = 1, projectile = null, lastAttack = 0,
                element = 'physical', armor = 0, fireResistance = 0, coldResistance = 0,
                lightningResistance = 0, poisonResistance = 0, visionRange = 300
            ) => models.combat({
                damage, range, attackSpeed, projectile, lastAttack, element, armor,
                fireResistance, coldResistance, lightningResistance, poisonResistance, visionRange
            }),
            Placement: (placement = null) => placement,
            Team: (team = 'neutral') => models.team({ team }),
            UnitType: (unitType) => ({ ...unitType }),
            AIState: (state = 'idle', targetPosition = null, target = null, aiControllerId = null, meta = {}) =>
                models.aiState({ state, targetPosition, target, aiControllerId, meta }),
            Animation: (scale = 1, rotation = 0, flash = 0) => models.animation({ scale, rotation, flash }),
            Projectile: (damage = 10, speed = 200, range = 100, target = null, source = null, startTime = 0, element = 'physical') =>
                models.projectile({ damage, speed, range, target, source, startTime, element }),
            Lifetime: (duration = 5, startTime = 0) => models.lifetime({ duration, startTime }),
            HomingTarget: (targetId = null, homingStrength = 0.5, lastKnownPosition = null) =>
                models.homingTarget({ targetId, homingStrength, lastKnownPosition }),
            Equipment: (slots = {}) => models.equipment({ slots: { ...models.equipment().slots, ...slots } }),
            EquipmentSlot: (slotType, itemId = null, attachmentPoint = null, offset = { x: 0, y: 0, z: 0 }, rotation = { x: 0, y: 0, z: 0 }) =>
                models.equipmentSlot({ slotType, itemId, attachmentPoint, offset, rotation }),
            EquipmentItem: (itemType, modelPath, stats = {}, armor = 0, fireResistance = 0, coldResistance = 0, lightningResistance = 0, poisonResistance = 0, element = null) => {
                const base = models.equipmentItem();
                return {
                    ...base,
                    itemType, modelPath,
                    stats: { ...base.stats, ...stats, armor, fireResistance, coldResistance, lightningResistance, poisonResistance, element }
                };
            },
            Corpse: (originalUnitType = null, deathTime = 0, teamAtDeath = 'neutral') =>
                models.corpse({ originalUnitType, deathTime, teamAtDeath }),
            DeathState: (isDying = false, deathStartTime = 0, deathAnimationDuration = 2.0) =>
                models.deathState({ isDying, deathStartTime, deathAnimationDuration }),
            StatusEffect: (effectType = 'buff', element = null, duration = 0, startTime = 0, sourceId = null, stacks = 1, maxStacks = 1) =>
                models.statusEffect({ effectType, element, duration, startTime, sourceId, stacks, maxStacks }),
            ElementalResistance: (fireResistance = 0, coldResistance = 0, lightningResistance = 0, poisonResistance = 0, physicalResistance = 0, divineResistance = 0, duration = null, permanent = true) =>
                models.elementalResistance({ fireResistance, coldResistance, lightningResistance, poisonResistance, physicalResistance, divineResistance, duration, permanent }),
            MiningState: (state, targetMine, targetTownHall, hasGold, miningStartTime, depositStartTime, team, entityId) =>
                models.miningState({ state, targetMine, targetTownHall, hasGold, miningStartTime, depositStartTime, team, entityId }),
            BuildingState: (state, targetBuildingEntityId, targetBuildingPosition, constructionStartTime) =>
                models.buildingState({ state, targetBuildingEntityId, targetBuildingPosition, constructionStartTime }),
            MindControlled: (originalTeam = 'neutral', controller = null, endTime = 0) =>
                models.mindControlled({ originalTeam, controller, endTime }),
            MirrorImage: (originalEntity = null, isIllusion = true, createdTime = 0) =>
                models.mirrorImage({ originalEntity, isIllusion, createdTime: createdTime || (this.game.state.now || 0) }),
            Trap: (damage = 50, radius = 80, triggerRadius = 30, element = 'physical', caster = null, triggered = false, maxTriggers = 1) =>
                models.trap({ damage, radius, triggerRadius, element, caster, triggered, maxTriggers }),
            Summoned: (summoner = null, summonType = 'generic', originalStats = null, createdTime = 0) =>
                models.summoned({ summoner, summonType, originalStats, createdTime: createdTime || (this.game.state.now || 0) }),
            TemporaryEffect: (effectType = 'generic', data = {}, createdTime = 0) =>
                models.temporaryEffect({ effectType, data, createdTime: createdTime || (this.game.state.now || 0) }),
            Thorns: (reflectionPercent = 0.5, endTime = 0, totalReflected = 0) =>
                models.thorns({ reflectionPercent, endTime: endTime || (this.game.state.now || 0) + 20, totalReflected }),
            Taunt: (taunter = null, endTime = 0, radius = 0, isTaunted = true) =>
                models.taunt({ taunter, endTime: endTime || (this.game.state.now || 0) + 5, radius, isTaunted }),
            ShieldWall: (damageReduction = 0.75, endTime = 0, tauntRadius = 200, originalArmor = 0) =>
                models.shieldWall({ damageReduction, endTime: endTime || (this.game.state.now || 0) + 10, tauntRadius, originalArmor }),
            Buff: (buffType = 'generic', modifiers = {}, endTime = 0, stackable = false, stacks = 1, appliedTime = 0) => {
                const base = models.buff({
                    buffType, modifiers,
                    endTime: endTime || (this.game.state.now || 0) + 30,
                    stackable, stacks,
                    appliedTime: appliedTime || (this.game.state.now || 0)
                });
                // Add buff-type specific properties
                const typeSpecific = {};
                if (buffType === 'rallied') Object.assign(typeSpecific, { damageMultiplier: modifiers.damageMultiplier || 1.3, moralBoost: true, fearImmunity: true });
                if (buffType === 'intimidated') Object.assign(typeSpecific, { damageReduction: modifiers.damageReduction || 0.25, accuracyReduction: modifiers.accuracyReduction || 0.2 });
                if (buffType === 'phalanx') Object.assign(typeSpecific, { armorMultiplier: modifiers.armorMultiplier || 1.0, counterAttackChance: modifiers.counterAttackChance || 0.2, formationSize: modifiers.formationSize || 1 });
                if (buffType === 'marked') Object.assign(typeSpecific, { damageTakenMultiplier: modifiers.damageTakenMultiplier || 1.25, revealed: true, markedBy: modifiers.markedBy || null });
                if (buffType === 'poison_weapon') Object.assign(typeSpecific, { poisonDamage: modifiers.poisonDamage || 25, poisonDuration: modifiers.poisonDuration || 6, attacksRemaining: modifiers.attacksRemaining || 5 });
                if (buffType === 'disrupted') Object.assign(typeSpecific, { abilitiesDisabled: true, accuracyReduction: modifiers.accuracyReduction || 0.4, movementSlowed: modifiers.movementSlowed || 0.6 });
                if (buffType === 'magic_weapon') Object.assign(typeSpecific, { weaponElement: modifiers.weaponElement || 'fire', elementalDamage: modifiers.elementalDamage || 15, glowing: true });
                if (buffType === 'dark_empowerment') Object.assign(typeSpecific, { damageMultiplier: modifiers.damageMultiplier, attackSpeedMultiplier: modifiers.attackSpeedMultiplier });
                if (buffType === 'ice_armor') Object.assign(typeSpecific, { armorMultiplier: modifiers.armorMultiplier });
                if (buffType === 'rage') Object.assign(typeSpecific, { damageMultiplier: modifiers.damageMultiplier || 1.5, attackSpeedMultiplier: modifiers.attackSpeedMultiplier || 1.3 });
                if (buffType === 'bloodlust') Object.assign(typeSpecific, { lifeSteal: modifiers.lifeSteal || 0.3, damagePerKill: modifiers.damagePerKill || 5, maxStacks: modifiers.maxStacks || 10 });
                if (buffType === 'stunned') Object.assign(typeSpecific, { movementDisabled: true, attackDisabled: true });
                return { ...base, ...typeSpecific };
            },
            Whirlwind: (damage = 30, radius = 80, endTime = 0, hitInterval = 0.3, lastHitTime = 0, totalHits = 0) =>
                models.whirlwind({ damage, radius, endTime: endTime || (this.game.state.now || 0) + 2, hitInterval, lastHitTime, totalHits }),
            Formation: (formationType = 'none', formationSize = 1, formationLeader = null, formationMembers = [], formationBonuses = {}, isActive = false) =>
                models.formation({ formationType, formationSize, formationLeader, formationMembers, formationBonuses, isActive, createdTime: (this.game.state.now || 0) }),
            SquadMember: (squadId = null, squadRole = 'member', squadPosition = { x: 0, z: 0 }, squadBonuses = {}) =>
                models.squadMember({ squadId, squadRole, squadPosition, squadBonuses, joinedTime: (this.game.state.now || 0) }),
            AbilityCooldowns: (cooldowns = {}) => models.abilityCooldowns({ cooldowns }),
            ResourcePool: (mana = 100, maxMana = 100, manaRegen = 5, stamina = 100, maxStamina = 100, staminaRegen = 10, focus = 100, maxFocus = 100) =>
                models.resourcePool({ mana, maxMana, manaRegen, stamina, maxStamina, staminaRegen, focus, maxFocus, lastRegenTick: (this.game.state.now || 0) }),
            VisualEffect: (effectType = 'particle', effectData = {}, duration = 1.0, startTime = 0, attachedTo = null) =>
                models.visualEffect({ effectType, effectData, duration, startTime: startTime || (this.game.state.now || 0), attachedTo }),
            Aura: (auraType = 'generic', radius = 50, effects = {}, visualEffect = null, persistent = true, pulseInterval = 1.0, lastPulse = 0) =>
                models.aura({ auraType, radius, effects, visualEffect, persistent, pulseInterval, lastPulse, createdTime: (this.game.state.now || 0) }),
            TargetingPreference: (preferredTargets = [], avoidedTargets = [], targetPriority = 'nearest', maxTargetRange = 200, requiresLineOfSight = false) =>
                models.targetingPreference({ preferredTargets, avoidedTargets, targetPriority, maxTargetRange, requiresLineOfSight }),
            Threat: (threatLevel = 0, maxThreat = 100, threatDecay = 1, lastThreatUpdate = 0, threatSources = {}) =>
                models.threat({ threatLevel, maxThreat, threatDecay, lastThreatUpdate, threatSources }),
            Charging: (target = null, chargeSpeed = 100, chargeDamage = 50, chargeStartTime = 0, chargeDistance = 0, maxChargeDistance = 150) =>
                models.charging({ target, chargeSpeed, chargeDamage, chargeStartTime, chargeDistance, maxChargeDistance }),
            Channeling: (abilityId = null, channelDuration = 3.0, channelStartTime = 0, canBeInterrupted = true, interruptThreshold = 10) =>
                models.channeling({ abilityId, channelDuration, channelStartTime, canBeInterrupted, interruptThreshold }),
            Stealthed: (stealthLevel = 1.0, detectionRadius = 30, stealthStartTime = 0, canAttackWhileStealth = false, breaksOnAttack = true) =>
                models.stealthed({ stealthLevel, detectionRadius, stealthStartTime, canAttackWhileStealth, breaksOnAttack }),
            EnvironmentalHazard: (hazardType = 'generic', damagePerTick = 10, tickInterval = 1.0, element = 'physical', affectsTeams = ['all'], lastTickTime = 0) =>
                models.environmentalHazard({ hazardType, damagePerTick, tickInterval, element, affectsTeams, lastTickTime, createdTime: (this.game.state.now || 0) }),
            Consecrated: (consecrationLevel = 1.0, healPerTick = 5, damageToUndead = 10, tickInterval = 2.0, caster = null, lastTickTime = 0) =>
                models.consecrated({ consecrationLevel, healPerTick, damageToUndead, tickInterval, caster, lastTickTime }),
            CommandQueue: (commands = [], currentCommand = null, commandHistory = []) =>
                models.commandQueue({ commands, currentCommand, commandHistory }),
            Command: (type = 'move', controllerId = null, targetPosition = null, target = null, meta = {}, priority = 0, interruptible = true, createdTime = 0) => {
                const ct = createdTime || (this.game.state.now || 0);
                return models.command({
                    type, controllerId, targetPosition, target, meta, priority, interruptible,
                    createdTime: ct,
                    id: `cmd_${ct}_${++this.commandIdCounter}`
                });
            }
        };
    }

    getComponentTypes() {
        return {
            // Basic Components
            TRANSFORM: 'transform',
            POSITION: 'position',
            FACING: 'facing',
            VELOCITY: 'velocity',
            SCALE: 'scale',
            RENDERABLE: 'renderable',
            MAP_RENDERER: 'mapRenderer',
            SPRITE: 'sprite',
            MAP_MANAGER: 'mapManager',
            WORLD_OBJECT: 'worldObject',
            ENVIRONMENT_OBJECT: 'environmentObject',
            
            // Unit Components
            PLACEMENT: 'placement',
            TEAM: 'team',
            UNIT_TYPE: 'unitType',
            AI_STATE: 'aiState',
            ANIMATION: 'animation',
            HEALTH: 'health',
            COMBAT: 'combat',
            COLLISION: 'collision',
            BUILDING: 'building',
            
            // Projectile System
            PROJECTILE: 'projectile',
            LIFETIME: 'lifetime',
            HOMING_TARGET: 'homingTarget',
            
            // Entity System
            ENTITY_TYPE: 'entityType',
            LEVEL_DATA: 'levelData',
            
            // Equipment System
            EQUIPMENT: 'equipment',
            EQUIPMENT_SLOT: 'equipmentSlot',
            EQUIPMENT_ITEM: 'equipmentItem',
            
            // Death System
            CORPSE: 'corpse',
            DEATH_STATE: 'deathState',
            
            // Status Effects
            STATUS_EFFECT: 'statusEffect',
            ELEMENTAL_RESISTANCE: 'elementalResistance',

            // =============================================
            // TACTICAL ABILITY COMPONENT TYPES
            // =============================================
            MIND_CONTROLLED: 'mindControlled',
            MIRROR_IMAGE: 'mirrorImage',
            TRAP: 'trap',
            SUMMONED: 'summoned',
            TEMPORARY_EFFECT: 'temporaryEffect',
            THORNS: 'thorns',
            TAUNT: 'taunt',
            SHIELD_WALL: 'shieldWall',
            BUFF: 'buff',
            WHIRLWIND: 'whirlwind',

            // =============================================
            // NEW SPELL SUPPORT COMPONENT TYPES
            // =============================================
            
            // Formation and Squad
            FORMATION: 'formation',
            SQUAD_MEMBER: 'squadMember',
            
            // Ability Resources
            ABILITY_COOLDOWNS: 'abilityCooldowns',
            RESOURCE_POOL: 'resourcePool',
            
            // Visual Effects
            VISUAL_EFFECT: 'visualEffect',
            AURA: 'aura',
            MINING_STATE: 'miningState',
            BUILDING_STATE: 'buildingState',
            // AI and Targeting
            TARGETING_PREFERENCE: 'targetingPreference',
            THREAT: 'threat',
            
            // Special States
            CHARGING: 'charging',
            CHANNELING: 'channeling',
            STEALTHED: 'stealthed',
            
            // Environmental
            ENVIRONMENTAL_HAZARD: 'environmentalHazard',
            CONSECRATED: 'consecrated',

            // Command Queue
            COMMAND_QUEUE: 'commandQueue'
        };
    }
}