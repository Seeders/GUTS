class PlacementSystem {
    constructor(app) {
        this.game = app;
        this.game.placementSystem = this;
        
        // 3D mouse picking
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.canvas = document.getElementById('gameCanvas');
        
        // Unit placement tracking
        this.playerPlacements = []; // Array of {x, y, z, unitType, roundPlaced}
        this.enemyPlacements = [];  // Array of {x, y, z, unitType, roundPlaced}
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
        
        // Get the terrain height at the clicked position
        const terrainHeight = this.getTerrainHeightAtPosition(worldPosition.x, worldPosition.z);
        const unitY = terrainHeight !== null ? terrainHeight : 0;
        
        // Create unit with proper 3D position using terrain height
        const entityId = this.createUnit(worldPosition.x, unitY, worldPosition.z, state.selectedUnitType, 'player');
        state.playerGold -= state.selectedUnitType.value;
        
        // Remember this placement for future rounds
        this.playerPlacements.push({
            x: worldPosition.x,
            y: unitY,
            z: worldPosition.z,
            unitType: { ...state.selectedUnitType }, // Clone the unit type
            roundPlaced: state.round,
            entityId: entityId
        });
        
        console.log(`Saved player placement at (${worldPosition.x.toFixed(1)}, ${unitY.toFixed(1)}, ${worldPosition.z.toFixed(1)})`);
        console.log(`Total player placements: ${this.playerPlacements.length}`);
        
        this.game.battleLogSystem.add(`Deployed ${state.selectedUnitType.title}`, 'log-victory');
        this.game.effectsSystem.showPlacementEffect(
            event.clientX - this.canvas.getBoundingClientRect().left,
            event.clientY - this.canvas.getBoundingClientRect().top
        );
    }
    
    // Respawn all previously placed units at the start of a new round
    respawnPlayerUnits() {
        console.log(`Respawning ${this.playerPlacements.length} player units for round ${this.game.state.round}`);
        
        this.playerPlacements.forEach((placement, index) => {
            const entityId = this.createUnit(placement.x, placement.y, placement.z, placement.unitType, 'player');
            // Update the entity ID for this placement
            placement.entityId = entityId;
            
            console.log(`Respawned player unit ${index + 1}: ${placement.unitType.title} at (${placement.x.toFixed(1)}, ${placement.y.toFixed(1)}, ${placement.z.toFixed(1)})`);
        });
        
        if (this.playerPlacements.length > 0) {
            this.game.battleLogSystem.add(`Respawned ${this.playerPlacements.length} player units from previous rounds`);
        }
    }
    
    // Respawn enemy units from previous rounds
    respawnEnemyUnits() {
        console.log(`Respawning ${this.enemyPlacements.length} enemy units for round ${this.game.state.round}`);
        
        this.enemyPlacements.forEach((placement, index) => {
            const entityId = this.createUnit(placement.x, placement.y, placement.z, placement.unitType, 'enemy');
            // Update the entity ID for this placement
            placement.entityId = entityId;
            
            console.log(`Respawned enemy unit ${index + 1}: ${placement.unitType.title} at (${placement.x.toFixed(1)}, ${placement.y.toFixed(1)}, ${placement.z.toFixed(1)})`);
        });
        
        if (this.enemyPlacements.length > 0) {
            this.game.battleLogSystem.add(`Enemy respawned ${this.enemyPlacements.length} units from previous rounds`);
        }
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
        
        // Check bounds (X and Z for horizontal plane)
        const withinBounds = worldPosition.x >= -halfSize && worldPosition.x <= halfSize &&
                           worldPosition.z >= -halfSize && worldPosition.z <= halfSize;
        
        // Player side is left half (x <= 0)
        return withinBounds && worldPosition.x <= 0;
    }
    
    getTerrainHeightAtPosition(worldX, worldZ) {
        // Delegate to WorldSystem
        if (this.game.worldSystem && this.game.worldSystem.getTerrainHeightAtPosition) {
            return this.game.worldSystem.getTerrainHeightAtPosition(worldX, worldZ);
        }
        return 0; // Fallback to flat ground
    }
    
    /**
     * Calculate the initial facing direction for a unit based on its team
     * @param {string} team - 'player' or 'enemy'
     * @returns {number} - Rotation angle in radians for Y-axis rotation
     */
    calculateInitialFacing(team) {
        if (team === 'player') {
            // Player units face right (towards positive X where enemies spawn)
            return 0; // Facing positive X direction
        } else if (team === 'enemy') {
            // Enemy units face left (towards negative X where players spawn)
            return Math.PI; // Facing negative X direction (180 degrees)
        }
        return 0; // Default facing
    }
    
    createUnit(worldX, worldY, worldZ, unitType, team) {
        const entity = this.game.createEntity();
        const ComponentTypes = this.game.componentManager.getComponentTypes();
        const Components = this.game.componentManager.getComponents();
        
        // Calculate initial facing direction
        const initialFacing = this.calculateInitialFacing(team);
        
        // Add components with full 3D position
        this.game.addComponent(entity, ComponentTypes.POSITION, Components.Position(worldX, worldY, worldZ));
        this.game.addComponent(entity, ComponentTypes.VELOCITY, Components.Velocity(0, 0, 0, unitType.speed * 20));
        this.game.addComponent(entity, ComponentTypes.RENDERABLE, Components.Renderable("units", unitType.id));
        this.game.addComponent(entity, ComponentTypes.COLLISION, Components.Collision(unitType.size));
        this.game.addComponent(entity, ComponentTypes.HEALTH, Components.Health(unitType.hp));
        this.game.addComponent(entity, ComponentTypes.COMBAT, Components.Combat(unitType.damage, unitType.range, unitType.attackSpeed, unitType.projectile, 0));
        this.game.addComponent(entity, ComponentTypes.TEAM, Components.Team(team));
        this.game.addComponent(entity, ComponentTypes.UNIT_TYPE, Components.UnitType(unitType.id, unitType.title, unitType.value));
        this.game.addComponent(entity, ComponentTypes.AI_STATE, Components.AIState('idle'));
        this.game.addComponent(entity, ComponentTypes.ANIMATION, Components.Animation());
        
        // Add initial facing component
        this.game.addComponent(entity, ComponentTypes.FACING, Components.Facing(initialFacing));
        
        if(unitType.projectile){
            console.log('created ranged Unit', entity, unitType, unitType.projectile);
        }
        return entity;
    }
    
    placeEnemyUnits(onComplete) {
        console.log('placeEnemyUnits called with callback:', !!onComplete);
        
        // First, respawn existing enemy units from previous rounds
        this.respawnEnemyUnits();
        
        // Calculate enemy gold budget for this round (same as player)
        const round = this.game.state.round;
        const enemyGoldBudget = 50 + (round * 50); // Same formula as player
        
        // Calculate how much they can spend on new units
        const existingValue = this.calculateExistingEnemyValue();
        const availableGold = Math.max(0, enemyGoldBudget - existingValue);
        
        console.log(`Enemy Round ${round}: ${enemyGoldBudget} total budget, ${existingValue} existing value, ${availableGold} available for new units`);
        
        // Add new enemy units within budget
        this.addNewEnemyUnitsWithBudget(availableGold, () => {
            console.log('Enemy unit placement completed');
            
            // Call the completion callback if provided
            if (onComplete && typeof onComplete === 'function') {
                console.log('Calling placement completion callback');
                onComplete();
            }
        });
    }
    
    calculateExistingEnemyValue() {
        let totalValue = 0;
        this.enemyPlacements.forEach(placement => {
            totalValue += placement.unitType.value || 0;
        });
        return totalValue;
    }
    
    addNewEnemyUnitsWithBudget(budget, onComplete) {
        const UnitTypes = this.game.getCollections().units;
        const availableUnits = Object.values(UnitTypes);
        const availableUnitKeys = Object.keys(UnitTypes);
        const terrainSize = this.game.worldSystem?.terrainSize || 768;
        
        // Enemy placement area (right half, using X and Z coordinates)
        const padding = 20;
        const enemyMinX = padding;
        const enemyMaxX = terrainSize / 2 - padding;
        const enemyMinZ = -terrainSize / 2 + padding;
        const enemyMaxZ = terrainSize / 2 - padding;

        let remainingBudget = budget;
        let newUnitsPlaced = 0;
        
        // Track units being placed for animation timing
        const unitsToPlace = [];
        
        // Pre-calculate all units to place
        while (remainingBudget > 0 && newUnitsPlaced < 10) { // Max 10 new units per round
            // Find units they can afford
            const affordableUnits = availableUnits.filter((unit, index) => {
                const unitData = { id: availableUnitKeys[index], ...unit };
                return unitData.value <= remainingBudget;
            });
            
            if (affordableUnits.length === 0) break; // Can't afford any more units
            
            // Choose a random affordable unit
            const chosen = Math.floor(Math.random() * affordableUnits.length);
            const unitType = affordableUnits[chosen];
            const unitId = availableUnitKeys[availableUnits.indexOf(unitType)];
            const fullUnitType = { id: unitId, ...unitType };
            
            const worldX = enemyMinX + Math.random() * (enemyMaxX - enemyMinX);
            const worldZ = enemyMinZ + Math.random() * (enemyMaxZ - enemyMinZ);
            
            // Get the terrain height at this position
            const terrainHeight = this.getTerrainHeightAtPosition(worldX, worldZ);
            const worldY = terrainHeight !== null ? terrainHeight : 0;
            
            unitsToPlace.push({
                worldX, worldY, worldZ, fullUnitType, round: this.game.state.round
            });
            
            remainingBudget -= fullUnitType.value;
            newUnitsPlaced++;
        }
        
        console.log(`Placing ${unitsToPlace.length} enemy units with staggered timing`);
        
        // Place units with small delays for visual effect
        let placedCount = 0;
        
        const placeNextUnit = () => {
            if (placedCount >= unitsToPlace.length) {
                // All units placed, log summary and call completion
                const totalEnemyUnits = this.enemyPlacements.length;
                this.game.battleLogSystem.add(`Enemy deployed ${newUnitsPlaced} new units (${totalEnemyUnits} total)! Budget: ${budget - remainingBudget}/${budget}g`);
                
                console.log('All enemy units placed, calling completion callback');
                if (onComplete && typeof onComplete === 'function') {
                    onComplete();
                }
                return;
            }
            
            const unit = unitsToPlace[placedCount];
            const entityId = this.createUnit(unit.worldX, unit.worldY, unit.worldZ, unit.fullUnitType, 'enemy');
            
            // Remember this enemy placement for future rounds
            this.enemyPlacements.push({
                x: unit.worldX,
                y: unit.worldY,
                z: unit.worldZ,
                unitType: unit.fullUnitType,
                roundPlaced: unit.round,
                entityId: entityId
            });
            
            console.log(`Enemy placed: ${unit.fullUnitType.title} (${unit.fullUnitType.value}g) - Unit ${placedCount + 1}/${unitsToPlace.length}`);
            
            placedCount++;
            
            // Place next unit after a short delay (for visual effect)
            if (placedCount < unitsToPlace.length) {
                setTimeout(placeNextUnit, 200); // 200ms between placements
            } else {
                // This was the last unit, call completion immediately
                placeNextUnit();
            }
        };
        
        // Start placing units
        if (unitsToPlace.length > 0) {
            placeNextUnit();
        } else {
            // No units to place, call completion immediately
            console.log('No enemy units to place, calling completion callback immediately');
            if (onComplete && typeof onComplete === 'function') {
                onComplete();
            }
        }
    }
    
    // Call this when starting a new placement phase (after any round result)
    startNewPlacementPhase() {
        console.log('Starting new placement phase - respawning player units');
        
        // ALWAYS respawn all existing player units, regardless of who won last round
        this.respawnPlayerUnits();
        
        // Show summary
        if (this.playerPlacements.length > 0) {
            this.game.battleLogSystem.add(`Your army: ${this.playerPlacements.length} units ready for battle!`);
        } else {
            this.game.battleLogSystem.add(`Place your first units to build your army!`);
        }
    }
    
    // Reset all placements (for game restart or defeat)
    resetAllPlacements() {
        console.log('Resetting all unit placements');
        this.playerPlacements = [];
        this.enemyPlacements = [];
        this.game.battleLogSystem.add('All unit placements cleared');
    }
    
    // Get placement statistics
    getPlacementStats() {
        return {
            playerUnits: this.playerPlacements.length,
            enemyUnits: this.enemyPlacements.length,
            playerUnitsByType: this.getUnitCountsByType(this.playerPlacements),
            enemyUnitsByType: this.getUnitCountsByType(this.enemyPlacements)
        };
    }
    
    getUnitCountsByType(placements) {
        const counts = {};
        placements.forEach(placement => {
            const type = placement.unitType.title || placement.unitType.id;
            counts[type] = (counts[type] || 0) + 1;
        });
        return counts;
    }
}