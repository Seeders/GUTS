class ComponentManager {

    constructor(game) {
        this.game = game;
        this.game.componentManager = this;
    }

    getComponents() {
        return  {
            Position: (x = 0, y = 0, z = 0) => ({ x, y, z }),
            Velocity: (vx = 0, vy = 0, vz = 0, maxSpeed = 100) => ({ vx, vy, vz, maxSpeed }),
            Facing: (angle) => ({ angle: angle || 0 }),
            Renderable: ( objectType, spawnType ) => ({ objectType, spawnType }),
            Collision: (radius = 1) => ({ radius }),
            Health: (max = 100) => ({ max, current: max }),
            Combat: (damage = 10, range = 1, attackSpeed = 1, projectile = null, lastAttack = 0) => 
                ({ damage, range, attackSpeed, projectile, lastAttack }),
            Team: (team = 'neutral') => ({ team }),
            UnitType: (id = 'default', type = 'basic', value = 10) => ({ id, type, value }),
            AIState: (state = 'idle', target = null, lastStateChange = 0) => 
                ({ state, target, lastStateChange }),
            Animation: (scale = 1, rotation = 0, flash = 0) => ({ scale, rotation, flash }),
            Projectile: (damage = 10, speed = 200, range = 100, target = null, source = null, startTime = 0) => 
                ({ damage, speed, range, target, source, startTime }),
            Lifetime: (duration = 5, startTime = 0) => ({ duration, startTime }),
            HomingTarget: (targetId = null, homingStrength = 0.5, lastKnownPosition = null) => 
                ({ targetId, homingStrength, lastKnownPosition }),
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
            EquipmentItem: (itemType, modelPath, stats = {}) => ({
                itemType,
                modelPath,
                stats,
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
        }
    }
}