class ComponentManager {
    constructor(game) {
        this.game = game;
        this.game.componentManager = this;
    }

    getComponents() {
        return {
            Position: (x = 0, y = 0, z = 0) => ({ x, y, z }),
            Velocity: (vx = 0, vy = 0, vz = 0, maxSpeed = 100) => ({ vx, vy, vz, maxSpeed }),
            Facing: (angle) => ({ angle: angle || 0 }),
            Renderable: (objectType, spawnType) => ({ objectType, spawnType }),
            Collision: (radius = 1) => ({ radius }),
            Health: (max = 100) => ({ max, current: max }),
            
            // Enhanced Combat component with elemental damage and defenses
            Combat: (
                damage = 0, 
                range = 1, 
                attackSpeed = 1, 
                projectile = null, 
                lastAttack = 0,
                element = 'physical',
                armor = 0,
                fireResistance = 0,
                coldResistance = 0,
                lightningResistance = 0,
                poisonResistance = 0
            ) => ({
                damage,
                range,
                attackSpeed,
                projectile,
                lastAttack,
                element,
                armor,
                fireResistance,
                coldResistance,
                lightningResistance,
                poisonResistance
            }),
            
            Team: (team = 'neutral') => ({ team }),
            UnitType: (id = 'default', type = 'basic', value = 10) => ({ id, type, value }),
            AIState: (state = 'idle', target = null, lastStateChange = 0) => 
                ({ state, target, lastStateChange }),
            Animation: (scale = 1, rotation = 0, flash = 0) => ({ scale, rotation, flash }),
            
            // Enhanced Projectile component with element support
            Projectile: (
                damage = 10, 
                speed = 200, 
                range = 100, 
                target = null, 
                source = null, 
                startTime = 0,
                element = 'physical'
            ) => ({
                damage,
                speed,
                range,
                target,
                source,
                startTime,
                element
            }),
            
            Lifetime: (duration = 5, startTime = 0) => ({ duration, startTime }),
            HomingTarget: (targetId = null, homingStrength = 0.5, lastKnownPosition = null) => 
                ({ targetId, homingStrength, lastKnownPosition }),
            
            // Enhanced Equipment component that can provide resistances
            Equipment: (slots = {}) => ({ 
                slots: {
                    mainHand: null,
                    offHand: null,
                    helmet: null,
                    chest: null,
                    legs: null,
                    feet: null,
                    back: null,
                    ...slots
                }
            }),
            
            EquipmentSlot: (slotType, itemId = null, attachmentPoint = null, offset = { x: 0, y: 0, z: 0 }, rotation = { x: 0, y: 0, z: 0 }) => ({
                slotType,
                itemId,
                attachmentPoint,
                offset,
                rotation
            }),
            
            // Enhanced EquipmentItem with defensive stats
            EquipmentItem: (
                itemType, 
                modelPath, 
                stats = {},
                armor = 0,
                fireResistance = 0,
                coldResistance = 0,
                lightningResistance = 0,
                poisonResistance = 0,
                element = null  // Weapon element
            ) => ({
                itemType,
                modelPath,
                stats: {
                    ...stats,
                    armor,
                    fireResistance,
                    coldResistance,
                    lightningResistance,
                    poisonResistance,
                    element
                },
                attachmentData: {
                    mainHand: {
                        bone: 'Hand_R',
                        offset: { x: 0, y: 0, z: 0 },
                        rotation: { x: 0, y: 0, z: 0 }
                    },
                    offHand: {
                        bone: 'Hand_L', 
                        offset: { x: 0, y: 0, z: 0 },
                        rotation: { x: 0, y: 0, z: 0 }
                    }
                }
            }),
            
            Corpse: (originalUnitType = null, deathTime = 0, teamAtDeath = 'neutral') => ({ 
                originalUnitType, 
                deathTime, 
                teamAtDeath,
                isCorpse: true 
            }),
            
            DeathState: (isDying = false, deathStartTime = 0, deathAnimationDuration = 2.0) => ({ 
                isDying, 
                deathStartTime, 
                deathAnimationDuration 
            }),

            // Status effect component for tracking temporary effects
            StatusEffect: (
                effectType = 'buff',
                element = null,
                duration = 0,
                startTime = 0,
                sourceId = null,
                stacks = 1,
                maxStacks = 1
            ) => ({
                effectType,  // 'buff', 'debuff', 'dot', 'immunity'
                element,
                duration,
                startTime,
                sourceId,
                stacks,
                maxStacks
            }),

            // Resistance component for temporary resistances/immunities
            ElementalResistance: (
                fireResistance = 0,
                coldResistance = 0,
                lightningResistance = 0,
                poisonResistance = 0,
                physicalResistance = 0,
                divineResistance = 0,
                duration = null,
                permanent = true
            ) => ({
                fireResistance,
                coldResistance,
                lightningResistance,
                poisonResistance,
                physicalResistance,
                divineResistance,
                duration,
                permanent
            }),

            // =============================================
            // TACTICAL ABILITY COMPONENTS (from original)
            // =============================================
            
            MindControlled: (originalTeam = 'neutral', controller = null, endTime = 0) => ({
                originalTeam,
                controller,
                endTime,
                isControlled: true
            }),
            
            MirrorImage: (originalEntity = null, isIllusion = true, createdTime = 0) => ({
                originalEntity,
                isIllusion,
                createdTime: createdTime || Date.now() / 1000
            }),
            
            Trap: (
                damage = 50, 
                radius = 80, 
                triggerRadius = 30, 
                element = 'physical', 
                caster = null, 
                triggered = false, 
                maxTriggers = 1
            ) => ({
                damage,
                radius,
                triggerRadius,
                element,
                caster,
                triggered,
                triggerCount: 0,
                maxTriggers
            }),
            
            Summoned: (summoner = null, summonType = 'generic', originalStats = null, createdTime = 0) => ({
                summoner,
                summonType,
                originalStats,
                createdTime: createdTime || Date.now() / 1000,
                isSummoned: true
            }),
            
            TemporaryEffect: (effectType = 'generic', data = {}, createdTime = 0) => ({
                effectType,
                data,
                createdTime: createdTime || Date.now() / 1000
            }),
            
            Thorns: (reflectionPercent = 0.5, endTime = 0, totalReflected = 0) => ({
                reflectionPercent,
                endTime: endTime || Date.now() / 1000 + 20,
                totalReflected,
                isActive: true
            }),
            
            Taunt: (taunter = null, endTime = 0, radius = 0, isTaunted = true) => ({
                taunter,
                endTime: endTime || Date.now() / 1000 + 5,
                radius,
                isTaunted
            }),
            
            ShieldWall: (damageReduction = 0.75, endTime = 0, tauntRadius = 200, originalArmor = 0) => ({
                damageReduction,
                endTime: endTime || Date.now() / 1000 + 10,
                tauntRadius,
                originalArmor,
                isActive: true
            }),
            
            // =============================================
            // ENHANCED BUFF SYSTEM FOR NEW SPELLS
            // =============================================
            
            Buff: (
                buffType = 'generic', 
                modifiers = {}, 
                endTime = 0, 
                stackable = false, 
                stacks = 1, 
                appliedTime = 0
            ) => ({
                buffType,
                modifiers,
                endTime: endTime || Date.now() / 1000 + 30,
                stackable,
                stacks,
                appliedTime: appliedTime || Date.now() / 1000,
                isActive: true,
                
                // Specific buff properties based on type
                ...(buffType === 'rallied' && {
                    damageMultiplier: modifiers.damageMultiplier || 1.3,
                    moralBoost: true,
                    fearImmunity: true
                }),
                
                ...(buffType === 'intimidated' && {
                    damageReduction: modifiers.damageReduction || 0.25,
                    accuracyReduction: modifiers.accuracyReduction || 0.2
                }),
                
                ...(buffType === 'phalanx' && {
                    armorMultiplier: modifiers.armorMultiplier || 1.0,
                    counterAttackChance: modifiers.counterAttackChance || 0.2,
                    formationSize: modifiers.formationSize || 1
                }),
                
                ...(buffType === 'marked' && {
                    damageTakenMultiplier: modifiers.damageTakenMultiplier || 1.25,
                    revealed: true,
                    markedBy: modifiers.markedBy || null
                }),
                
                ...(buffType === 'poison_weapon' && {
                    poisonDamage: modifiers.poisonDamage || 25,
                    poisonDuration: modifiers.poisonDuration || 6,
                    attacksRemaining: modifiers.attacksRemaining || 5
                }),
                
                ...(buffType === 'disrupted' && {
                    abilitiesDisabled: true,
                    accuracyReduction: modifiers.accuracyReduction || 0.4,
                    movementSlowed: modifiers.movementSlowed || 0.6
                }),
                
                ...(buffType === 'magic_weapon' && {
                    weaponElement: modifiers.weaponElement || 'fire',
                    elementalDamage: modifiers.elementalDamage || 15,
                    glowing: true
                }),
                
                ...(buffType === 'dark_empowerment' && {
                    damageMultiplier: modifiers.damageMultiplier || 1.3,
                    attackSpeedMultiplier: modifiers.attackSpeedMultiplier || 1.2
                }),
                
                ...(buffType === 'rage' && {
                    damageMultiplier: modifiers.damageMultiplier || 1.5,
                    attackSpeedMultiplier: modifiers.attackSpeedMultiplier || 1.3
                }),
                
                ...(buffType === 'bloodlust' && {
                    lifeSteal: modifiers.lifeSteal || 0.3,
                    damagePerKill: modifiers.damagePerKill || 5,
                    maxStacks: modifiers.maxStacks || 10
                }),
                
                ...(buffType === 'stunned' && {
                    movementDisabled: true,
                    attackDisabled: true
                })
            }),
            
            Whirlwind: (
                damage = 30, 
                radius = 80, 
                endTime = 0, 
                hitInterval = 0.3, 
                lastHitTime = 0, 
                totalHits = 0
            ) => ({
                damage,
                radius,
                endTime: endTime || Date.now() / 1000 + 2,
                hitInterval,
                lastHitTime,
                totalHits,
                isActive: true
            }),

            // =============================================
            // FORMATION AND SQUAD COMPONENTS
            // =============================================
            
            Formation: (
                formationType = 'none',
                formationSize = 1,
                formationLeader = null,
                formationMembers = [],
                formationBonuses = {},
                isActive = false
            ) => ({
                formationType, // 'phalanx', 'wedge', 'line', 'circle', etc.
                formationSize,
                formationLeader,
                formationMembers,
                formationBonuses,
                isActive,
                createdTime: Date.now() / 1000
            }),
            
            SquadMember: (
                squadId = null,
                squadRole = 'member', // 'leader', 'member', 'specialist'
                squadPosition = { x: 0, z: 0 },
                squadBonuses = {}
            ) => ({
                squadId,
                squadRole,
                squadPosition,
                squadBonuses,
                joinedTime: Date.now() / 1000
            }),

            // =============================================
            // ABILITY COOLDOWN AND RESOURCE COMPONENTS
            // =============================================
            
            AbilityCooldowns: (cooldowns = {}) => ({
                cooldowns, // Map of abilityId -> cooldownEndTime
                lastAbilityUsed: null,
                lastAbilityTime: 0
            }),
            
            ResourcePool: (
                mana = 100,
                maxMana = 100,
                manaRegen = 5,
                stamina = 100,
                maxStamina = 100,
                staminaRegen = 10,
                focus = 100,
                maxFocus = 100
            ) => ({
                mana,
                maxMana,
                manaRegen,
                stamina,
                maxStamina, 
                staminaRegen,
                focus,
                maxFocus,
                lastRegenTick: Date.now() / 1000
            }),

            // =============================================
            // VISUAL EFFECT COMPONENTS
            // =============================================
            
            VisualEffect: (
                effectType = 'particle',
                effectData = {},
                duration = 1.0,
                startTime = 0,
                attachedTo = null
            ) => ({
                effectType,
                effectData,
                duration,
                startTime: startTime || Date.now() / 1000,
                attachedTo,
                isActive: true
            }),
            
            Aura: (
                auraType = 'generic',
                radius = 50,
                effects = {},
                visualEffect = null,
                persistent = true,
                pulseInterval = 1.0,
                lastPulse = 0
            ) => ({
                auraType,
                radius,
                effects,
                visualEffect,
                persistent,
                pulseInterval,
                lastPulse,
                createdTime: Date.now() / 1000
            }),

            // =============================================
            // TARGETING AND AI COMPONENTS
            // =============================================
            
            TargetingPreference: (
                preferredTargets = [],
                avoidedTargets = [],
                targetPriority = 'nearest',
                maxTargetRange = 200,
                requiresLineOfSight = false
            ) => ({
                preferredTargets,
                avoidedTargets,
                targetPriority, // 'nearest', 'weakest', 'strongest', 'marked', 'leader'
                maxTargetRange,
                requiresLineOfSight,
                currentTarget: null,
                targetLockTime: 0
            }),
            
            Threat: (
                threatLevel = 0,
                maxThreat = 100,
                threatDecay = 1,
                lastThreatUpdate = 0,
                threatSources = new Map()
            ) => ({
                threatLevel,
                maxThreat,
                threatDecay,
                lastThreatUpdate,
                threatSources
            }),

            // =============================================
            // SPECIAL ABILITY STATE COMPONENTS
            // =============================================
            
            Charging: (
                target = null,
                chargeSpeed = 100,
                chargeDamage = 50,
                chargeStartTime = 0,
                chargeDistance = 0,
                maxChargeDistance = 150
            ) => ({
                target,
                chargeSpeed,
                chargeDamage,
                chargeStartTime,
                chargeDistance,
                maxChargeDistance,
                isCharging: true
            }),
            
            Channeling: (
                abilityId = null,
                channelDuration = 3.0,
                channelStartTime = 0,
                canBeInterrupted = true,
                interruptThreshold = 10
            ) => ({
                abilityId,
                channelDuration,
                channelStartTime,
                canBeInterrupted,
                interruptThreshold,
                isChanneling: true
            }),
            
            Stealthed: (
                stealthLevel = 1.0, // 0.0 = invisible, 1.0 = fully visible
                detectionRadius = 30,
                stealthStartTime = 0,
                canAttackWhileStealth = false,
                breaksOnAttack = true
            ) => ({
                stealthLevel,
                detectionRadius,
                stealthStartTime,
                canAttackWhileStealth,
                breaksOnAttack,
                isStealth: true
            }),

            // =============================================
            // ENVIRONMENTAL INTERACTION COMPONENTS  
            // =============================================
            
            EnvironmentalHazard: (
                hazardType = 'generic',
                damagePerTick = 10,
                tickInterval = 1.0,
                element = 'physical',
                affectsTeams = ['all'],
                lastTickTime = 0
            ) => ({
                hazardType, // 'fire', 'poison_cloud', 'ice_field', 'lightning_storm', etc.
                damagePerTick,
                tickInterval,
                element,
                affectsTeams,
                lastTickTime,
                createdTime: Date.now() / 1000
            }),
            
            Consecrated: (
                consecrationLevel = 1.0,
                healPerTick = 5,
                damageToUndead = 10,
                tickInterval = 2.0,
                caster = null,
                lastTickTime = 0
            ) => ({
                consecrationLevel,
                healPerTick,
                damageToUndead,
                tickInterval,
                caster,
                lastTickTime,
                isConsecrated: true
            })
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
            TEAM: 'team',
            UNIT_TYPE: 'unitType',
            AI_STATE: 'aiState',
            ANIMATION: 'animation',
            HEALTH: 'health',
            COMBAT: 'combat',
            COLLISION: 'collision',
            
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
            
            // AI and Targeting
            TARGETING_PREFERENCE: 'targetingPreference',
            THREAT: 'threat',
            
            // Special States
            CHARGING: 'charging',
            CHANNELING: 'channeling',
            STEALTHED: 'stealthed',
            
            // Environmental
            ENVIRONMENTAL_HAZARD: 'environmentalHazard',
            CONSECRATED: 'consecrated'
        };
    }
}