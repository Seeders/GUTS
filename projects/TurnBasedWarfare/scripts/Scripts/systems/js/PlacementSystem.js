class PlacementSystem {
    constructor(app) {
        this.game = app;
        this.game.placementSystem = this;
        // 3D mouse picking
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.canvas = document.getElementById('gameCanvas');
    }
    
    handleCanvasClick(event) {
        const state = this.game.state;
        
        if (state.phase !== 'placement' || !state.selectedUnitType) return;
        
        if (state.playerGold < state.selectedUnitType.value) {
            this.game.battleLogSystem.add('Not enough gold!', 'log-damage');
            return;
        }
        
        const worldPosition = this.getWorldPositionFromMouse(event);
        if (!worldPosition) return;
        
        if (!this.isValidPlayerPlacement(worldPosition)) {
            this.game.battleLogSystem.add('Invalid placement - must be on your side!', 'log-damage');
            return;
        }
        
        // Create unit and update state
        this.createUnit(worldPosition.x, worldPosition.z, state.selectedUnitType, 'player');
        state.playerGold -= state.selectedUnitType.value;
        
        this.game.battleLogSystem.add(`Deployed ${state.selectedUnitType.title}`, 'log-victory');
        this.game.effectsSystem.showPlacementEffect(
            event.clientX - this.canvas.getBoundingClientRect().left,
            event.clientY - this.canvas.getBoundingClientRect().top
        );
    }
    
    getWorldPositionFromMouse(event) {
        if (!this.game.scene || !this.game.camera) return null;
        
        const rect = this.canvas.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        
        this.raycaster.setFromCamera(this.mouse, this.game.camera);
        const ground = this.getGroundMesh();
        if (!ground) return null;
        
        const intersects = this.raycaster.intersectObject(ground, false);
        return intersects.length > 0 ? intersects[0].point : null;
    }
    
    getGroundMesh() {
        if (this.game.worldSystem?.ground) {
            return this.game.worldSystem.ground;
        }
        
        // Fallback search
        for (let child of this.game.scene.children) {
            if (child.isMesh && child.geometry?.type === 'PlaneGeometry') {
                return child;
            }
        }
        return null;
    }
    
    isValidPlayerPlacement(worldPosition) {
        const terrainSize = this.game.worldSystem?.terrainSize || 768;
        const halfSize = terrainSize / 2;
        
        // Check bounds
        const withinBounds = worldPosition.x >= -halfSize && worldPosition.x <= halfSize &&
                           worldPosition.z >= -halfSize && worldPosition.z <= halfSize;
        
        // Player side is left half (x <= 0)
        return withinBounds && worldPosition.x <= 0;
    }
    
    createUnit(worldX, worldZ, unitType, team) {
        const entity = this.game.createEntity();
        const ComponentTypes = this.game.componentManager.getComponentTypes();
        const Components = this.game.componentManager.getComponents();
        
        // Add components
        this.game.addComponent(entity, ComponentTypes.POSITION, Components.Position(worldX, worldZ));
        this.game.addComponent(entity, ComponentTypes.VELOCITY, Components.Velocity(0, 0, unitType.speed * 20));
        this.game.addComponent(entity, ComponentTypes.RENDERABLE, Components.Renderable(unitType.color, unitType.size, 'circle'));
        this.game.addComponent(entity, ComponentTypes.COLLISION, Components.Collision(unitType.size));
        this.game.addComponent(entity, ComponentTypes.HEALTH, Components.Health(unitType.hp));
        this.game.addComponent(entity, ComponentTypes.COMBAT, Components.Combat(unitType.damage, unitType.range, unitType.attackSpeed));
        this.game.addComponent(entity, ComponentTypes.TEAM, Components.Team(team));
        this.game.addComponent(entity, ComponentTypes.UNIT_TYPE, Components.UnitType(unitType.id, unitType.title, unitType.value));
        this.game.addComponent(entity, ComponentTypes.AI_STATE, Components.AIState('idle'));
        this.game.addComponent(entity, ComponentTypes.ANIMATION, Components.Animation());
        
        return entity;
    }
    
    placeEnemyUnits() {
        const unitCount = 3 + Math.floor(this.game.state.round / 2);
        const UnitTypes = this.game.getCollections().units;
        const availableUnits = Object.values(UnitTypes);
        const availableUnitKeys = Object.keys(UnitTypes);
        const terrainSize = this.game.worldSystem?.terrainSize || 768;
        
        // Enemy placement area (right half)
        const padding = 20;
        const enemyMinX = padding;
        const enemyMaxX = terrainSize / 2 - padding;
        const enemyMinZ = -terrainSize / 2 + padding;
        const enemyMaxZ = terrainSize / 2 - padding;

        for (let i = 0; i < unitCount; i++) {
            const chosen = Math.floor(Math.random() * availableUnits.length);
            const unitType = availableUnits[chosen];
            const unitId = availableUnitKeys[chosen];
            
            const worldX = enemyMinX + Math.random() * (enemyMaxX - enemyMinX);
            const worldZ = enemyMinZ + Math.random() * (enemyMaxZ - enemyMinZ);
            
            this.createUnit(worldX, worldZ, { id: unitId, ...unitType }, 'enemy');
        }
        
        this.game.battleLogSystem.add(`Enemy deployed ${unitCount} units!`);
    }
}