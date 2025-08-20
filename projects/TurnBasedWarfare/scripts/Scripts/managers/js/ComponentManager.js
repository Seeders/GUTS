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

            // New StatusEffect component for tracking temporary effects
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
            })
        }
    }

    getComponentTypes() {
       return {
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
            TEAM: 'team',
            UNIT_TYPE: 'unitType',
            AI_STATE: 'aiState',
            ANIMATION: 'animation',
            HEALTH: 'health',
            COMBAT: 'combat',
            COLLISION: 'collision',
            PROJECTILE: 'projectile',
            LIFETIME: 'lifetime',
            HOMING_TARGET: 'homingTarget',
            ENTITY_TYPE: 'entityType',
            LEVEL_DATA: 'levelData',
            EQUIPMENT: 'equipment',
            EQUIPMENT_SLOT: 'equipmentSlot',
            EQUIPMENT_ITEM: 'equipmentItem',
            CORPSE: 'corpse',
            DEATH_STATE: 'deathState',
            STATUS_EFFECT: 'statusEffect',
            ELEMENTAL_RESISTANCE: 'elementalResistance',
        }
    }
}