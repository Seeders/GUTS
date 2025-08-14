class ComponentManager {

    constructor(game) {
        this.game = game;
        this.game.componentManager = this;
    }

    getComponents() {
        return  {
            Position: (x = 0, y = 0, z = 0) => ({ x, y, z }),
            Velocity: (vx = 0, vy = 0, vz = 0, maxSpeed = 100) => ({ vx, vy, vz, maxSpeed }),
            Facing: (angle) => ({ angle: angle || 0 }), // Rotation angle in radians
            Renderable: ( objectType, spawnType ) => ({ objectType, spawnType }),
            Collision: (radius = 10) => ({ radius }),
            Health: (max = 100) => ({ max, current: max }),
            Combat: (damage = 10, range = 50, attackSpeed = 1, projectile = null, lastAttack = 0) => 
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
                ({ targetId, homingStrength, lastKnownPosition })
        }
    }

    getComponentTypes() {
       return {
            // Transform components
            TRANSFORM: 'transform',
            POSITION: 'position',
            FACING: 'facing',
            VELOCITY: 'velocity',
            SCALE: 'scale',
            
            // Rendering components
            RENDERABLE: 'renderable',
            MAP_RENDERER: 'mapRenderer',
            SPRITE: 'sprite',
            
            // Game logic components
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
            
            // Metadata
            ENTITY_TYPE: 'entityType',
            LEVEL_DATA: 'levelData',

        }
    }
}
