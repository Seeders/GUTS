class ComponentManager {

    constructor(game) {
        this.game = game;
        this.game.componentManager = this;
    }

    getComponents() {
        return  {
            Position: (x = 0, y = 0) => ({ x, y }),
            Velocity: (vx = 0, vy = 0, maxSpeed = 100) => ({ vx, vy, maxSpeed }),
            Renderable: (color = '#fff', size = 10, shape = 'circle') => ({ color, size, shape }),
            Collision: (radius = 10) => ({ radius }),
            Health: (max = 100) => ({ max, current: max }),
            Combat: (damage = 10, range = 50, attackSpeed = 1, lastAttack = 0) => 
                ({ damage, range, attackSpeed, lastAttack }),
            Team: (team = 'neutral') => ({ team }),
            UnitType: (id = 'default', type = 'basic', value = 10) => ({ id, type, value }),
            AIState: (state = 'idle', target = null, lastStateChange = 0) => 
                ({ state, target, lastStateChange }),
            Animation: (scale = 1, rotation = 0, flash = 0) => ({ scale, rotation, flash })
        }
    }

    getComponentTypes() {
       return {
            // Transform components
            TRANSFORM: 'transform',
            POSITION: 'position',
            ROTATION: 'rotation',
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
            
            // Metadata
            ENTITY_TYPE: 'entityType',
            LEVEL_DATA: 'levelData'
        }
    }
}
