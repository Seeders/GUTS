class PlacementSystem {
    constructor(app) {
        this.game = app;
        this.game.placementSystem = this;
        
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.canvas = document.getElementById('gameCanvas');
        
        this.playerPlacements = [];
        this.enemyPlacements = [];
        
        this.config = {
            maxUnitsPerRound: 10,
            maxCombinationsToCheck: 10000,
            unitPlacementDelay: 200,
            terrainPadding: 20,
            unitEfficiencyWeights: {
                hp: 0.3,
                damage: 0.4,
                range: 0.2,
                speed: 0.1
            }
        };
        
        // Element types for reference
        this.ELEMENT_TYPES = {
            PHYSICAL: 'physical',
            FIRE: 'fire',
            COLD: 'cold',
            LIGHTNING: 'lightning',
            POISON: 'poison',
            DIVINE: 'divine'
        };
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
        
        const terrainHeight = this.getTerrainHeightAtPosition(worldPosition.x, worldPosition.z);
        const unitY = terrainHeight !== null ? terrainHeight : 0;
        
        const entityId = this.createUnit(worldPosition.x, unitY, worldPosition.z, state.selectedUnitType, 'player');
        state.playerGold -= state.selectedUnitType.value;
        
        this.playerPlacements.push({
            x: worldPosition.x,
            y: unitY,
            z: worldPosition.z,
            unitType: { ...state.selectedUnitType },
            roundPlaced: state.round,
            entityId: entityId
        });
        
        this.game.battleLogSystem.add(`Deployed ${state.selectedUnitType.title}`, 'log-victory');
        this.game.effectsSystem.showPlacementEffect(
            event.clientX - this.canvas.getBoundingClientRect().left,
            event.clientY - this.canvas.getBoundingClientRect().top
        );
    }
    
    respawnPlayerUnits() {
        this.respawnUnits(this.playerPlacements, 'player');
        if (this.playerPlacements.length > 0) {
            this.game.battleLogSystem.add(`Respawned ${this.playerPlacements.length} player units from previous rounds`);
        }
    }
    
    respawnEnemyUnits() {
        this.respawnUnits(this.enemyPlacements, 'enemy');
        if (this.enemyPlacements.length > 0) {
            this.game.battleLogSystem.add(`Enemy respawned ${this.enemyPlacements.length} units from previous rounds`);
        }
    }
    
    respawnUnits(placements, team) {
        placements.forEach(placement => {
            const entityId = this.createUnit(placement.x, placement.y, placement.z, placement.unitType, team);
            placement.entityId = entityId;
        });
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
        
        const withinBounds = worldPosition.x >= -halfSize && worldPosition.x <= halfSize &&
                           worldPosition.z >= -halfSize && worldPosition.z <= halfSize;
        
        return withinBounds && worldPosition.x <= 0;
    }
    
    getTerrainHeightAtPosition(worldX, worldZ) {
        if (this.game.worldSystem && this.game.worldSystem.getTerrainHeightAtPosition) {
            return this.game.worldSystem.getTerrainHeightAtPosition(worldX, worldZ);
        }
        return 0;
    }
    
    calculateInitialFacing(team) {
        return team === 'player' ? 0 : Math.PI;
    }
    
    createUnit(worldX, worldY, worldZ, unitType, team) {
        const entity = this.game.createEntity();
        const ComponentTypes = this.game.componentManager.getComponentTypes();
        const Components = this.game.componentManager.getComponents();
        
        const initialFacing = this.calculateInitialFacing(team);
        
        // Add basic components
        this.game.addComponent(entity, ComponentTypes.POSITION, Components.Position(worldX, worldY, worldZ));
        this.game.addComponent(entity, ComponentTypes.VELOCITY, Components.Velocity(0, 0, 0, unitType.speed * 20));
        this.game.addComponent(entity, ComponentTypes.RENDERABLE, Components.Renderable("units", unitType.id));
        this.game.addComponent(entity, ComponentTypes.COLLISION, Components.Collision(unitType.size));
        this.game.addComponent(entity, ComponentTypes.HEALTH, Components.Health(unitType.hp));
        
        // Enhanced Combat component with elemental properties
        this.game.addComponent(entity, ComponentTypes.COMBAT, Components.Combat(
            unitType.damage || 10,
            unitType.range || 25, 
            unitType.attackSpeed || 1.0,
            unitType.projectile || null,
            0, // lastAttack
            unitType.element || this.ELEMENT_TYPES.PHYSICAL,
            unitType.armor || 0,
            unitType.fireResistance || 0,
            unitType.coldResistance || 0,
            unitType.lightningResistance || 0
        ));
        
        this.game.addComponent(entity, ComponentTypes.TEAM, Components.Team(team));
        this.game.addComponent(entity, ComponentTypes.UNIT_TYPE, Components.UnitType(unitType.id, unitType.title, unitType.value));
        this.game.addComponent(entity, ComponentTypes.AI_STATE, Components.AIState('idle'));
        this.game.addComponent(entity, ComponentTypes.ANIMATION, Components.Animation());
        this.game.addComponent(entity, ComponentTypes.FACING, Components.Facing(initialFacing));
        this.game.addComponent(entity, ComponentTypes.EQUIPMENT, Components.Equipment());
        
        this.equipUnitFromDefinition(entity, unitType);
        
        return entity;
    }
    
    async equipUnitFromDefinition(entityId, unitType) {
        if (!this.game.equipmentSystem || !unitType?.render?.equipment) return;
        
        setTimeout(async () => {
            for (const equippedItem of unitType.render.equipment) {
                const itemData = this.getItemFromCollection(equippedItem.item);
                if (itemData) {
                    try {
                        await this.game.equipmentSystem.equipItem(entityId, equippedItem, itemData, equippedItem.item);
                    } catch (error) {
                        console.warn(`Failed to equip ${equippedItem.item} on slot ${equippedItem.slot}:`, error);
                    }
                }
            }
        }, 100);
    }
    
    getItemFromCollection(itemId) {
        const collections = this.game.getCollections();
        if (!collections || !collections.items || !collections.items[itemId]) {
            console.warn(`Item ${itemId} not found in collections`);
            return null;
        }
        
        return collections.items[itemId];
    }
    
    placeEnemyUnits(onComplete) {
        this.respawnEnemyUnits();
        
        const round = this.game.state.round;
        const enemyTotalGold = this.calculateEnemyTotalGold(round);
        const existingValue = this.calculateExistingEnemyValue();
        const availableGold = Math.max(0, enemyTotalGold - existingValue);
        
        console.log(`Enemy Round ${round}: ${enemyTotalGold} total budget, ${existingValue} existing value, ${availableGold} available for new units`);
        
        this.addNewEnemyUnitsWithOptimalBudget(availableGold, onComplete);
    }
    
    calculateExistingEnemyValue() {
        return this.enemyPlacements.reduce((total, placement) => total + (placement.unitType.value || 0), 0);
    }
    
    calculateEnemyTotalGold(round) {
        let totalGold = 0;
        for (let r = 1; r <= round; r++) {
            totalGold += this.game.phaseSystem.calculateRoundGold(r);
        }
        return totalGold;
    }
    
    findOptimalUnitCombination(budget, availableUnits, maxUnits = this.config.maxUnitsPerRound) {
        const units = availableUnits.map((unit, index) => ({
            id: Object.keys(this.game.getCollections().units)[availableUnits.indexOf(unit)],
            ...unit,
            index: index
        })).filter(unit => unit.value <= budget);
        
        if (units.length === 0) {
            return { units: [], totalCost: 0, efficiency: 0 };
        }
        
        const validCombinations = this.generateValidCombinations(units, budget, maxUnits);
        
        let bestCombination = { units: [], totalCost: 0, efficiency: 0 };
        
        for (const combination of validCombinations) {
            const efficiency = combination.totalCost / budget;
            if (efficiency > bestCombination.efficiency) {
                bestCombination = combination;
            }
        }
        
        return bestCombination;
    }
    
    generateValidCombinations(units, budget, maxUnits) {
        const combinations = [];
        
        combinations.push(this.getGreedyCombination(units, budget, maxUnits));
        
        this.generateCombinationsRecursive(units, budget, maxUnits, [], 0, 0, 0, combinations, this.config.maxCombinationsToCheck);
        
        return combinations;
    }
    
    generateCombinationsRecursive(units, budget, maxUnits, currentUnits, currentCost, currentCount, startIndex, combinations, maxCombinations) {
        if (combinations.length >= maxCombinations) return;
        
        if (currentUnits.length > 0 && currentCost <= budget) {
            combinations.push({
                units: [...currentUnits],
                totalCost: currentCost,
                efficiency: currentCost / budget
            });
        }
        
        for (let i = startIndex; i < units.length && currentCount < maxUnits; i++) {
            const unit = units[i];
            const newCost = currentCost + unit.value;
            
            if (newCost > budget) continue;
            
            currentUnits.push(unit);
            this.generateCombinationsRecursive(
                units, budget, maxUnits, currentUnits, newCost, currentCount + 1, i, combinations, maxCombinations
            );
            currentUnits.pop();
        }
    }
    
    getGreedyCombination(units, budget, maxUnits) {
        const sortedUnits = [...units].sort((a, b) => {
            const aEfficiency = this.calculateUnitEfficiency(a);
            const bEfficiency = this.calculateUnitEfficiency(b);
            return bEfficiency - aEfficiency;
        });
        
        const selectedUnits = [];
        let remainingBudget = budget;
        let unitsPlaced = 0;
        
        for (const unit of sortedUnits) {
            while (remainingBudget >= unit.value && unitsPlaced < maxUnits) {
                selectedUnits.push(unit);
                remainingBudget -= unit.value;
                unitsPlaced++;
            }
        }
        
        return {
            units: selectedUnits,
            totalCost: budget - remainingBudget,
            efficiency: (budget - remainingBudget) / budget
        };
    }
    
    calculateUnitEfficiency(unit) {
        const weights = this.config.unitEfficiencyWeights;
        const hp = unit.hp || 100;
        const damage = unit.damage || 10;
        const range = unit.range || 1;
        const speed = unit.speed || 1;
        
        // Enhanced efficiency calculation that considers elemental properties
        let combatValue = (hp * weights.hp) + (damage * weights.damage) + (range * weights.range) + (speed * weights.speed);
        
        // Bonus for defensive capabilities
        const armor = unit.armor || 0;
        const fireResist = unit.fireResistance || 0;
        const coldResist = unit.coldResistance || 0;
        const lightningResist = unit.lightningResistance || 0;
        
        // Calculate defensive value (armor counts more since it's linear reduction)
        const defensiveValue = (armor * 2) + (fireResist * 20) + (coldResist * 20) + (lightningResist * 20);
        combatValue += defensiveValue * 0.15; // 15% weight for defensive capabilities
        
        // Bonus for special elements
        if (unit.element === this.ELEMENT_TYPES.DIVINE) {
            combatValue *= 1.2; // Divine damage is unresistable
        } else if (unit.element === this.ELEMENT_TYPES.POISON) {
            combatValue *= 1.1; // Poison ignores armor
        }
        
        return combatValue / unit.value;
    }
    
    addNewEnemyUnitsWithOptimalBudget(budget, onComplete) {
        const UnitTypes = this.game.getCollections().units;
        const availableUnits = Object.values(UnitTypes);
        
        if (budget <= 0) {
            if (onComplete && typeof onComplete === 'function') {
                onComplete();
            }
            return;
        }
        
        const optimalCombination = this.findOptimalUnitCombination(budget, availableUnits);
        
        if (optimalCombination.units.length === 0) {
            if (onComplete && typeof onComplete === 'function') {
                onComplete();
            }
            return;
        }
        
        const unitsToPlace = this.prepareUnitsForPlacement(optimalCombination.units);
        this.placeUnitsWithTiming(unitsToPlace, optimalCombination, budget, onComplete);
    }
    
    prepareUnitsForPlacement(units) {
        const { enemyMinX, enemyMaxX, enemyMinZ, enemyMaxZ } = this.getEnemyPlacementBounds();
        
        return units.map(unit => {
            const worldX = enemyMinX + Math.random() * (enemyMaxX - enemyMinX);
            const worldZ = enemyMinZ + Math.random() * (enemyMaxZ - enemyMinZ);
            const terrainHeight = this.getTerrainHeightAtPosition(worldX, worldZ);
            const worldY = terrainHeight !== null ? terrainHeight : 0;
            
            return {
                worldX, worldY, worldZ,
                fullUnitType: unit,
                round: this.game.state.round
            };
        });
    }
    
    getEnemyPlacementBounds() {
        const terrainSize = this.game.worldSystem?.terrainSize || 768;
        const padding = this.config.terrainPadding;
        
        return {
            enemyMinX: padding,
            enemyMaxX: terrainSize / 2 - padding,
            enemyMinZ: -terrainSize / 2 + padding,
            enemyMaxZ: terrainSize / 2 - padding
        };
    }
    
    placeUnitsWithTiming(unitsToPlace, optimalCombination, budget, onComplete) {
        let placedCount = 0;
        
        const placeNextUnit = () => {
            if (placedCount >= unitsToPlace.length) {
                const totalEnemyUnits = this.enemyPlacements.length;
                const efficiency = (optimalCombination.totalCost / budget * 100).toFixed(1);
                this.game.battleLogSystem.add(
                    `Enemy deployed ${unitsToPlace.length} new units (${totalEnemyUnits} total)! Budget: ${optimalCombination.totalCost}/${budget}g (${efficiency}% efficiency)`
                );
                
                if (onComplete && typeof onComplete === 'function') {
                    onComplete();
                }
                return;
            }
            
            const unit = unitsToPlace[placedCount];
            const entityId = this.createUnit(unit.worldX, unit.worldY, unit.worldZ, unit.fullUnitType, 'enemy');
            
            this.enemyPlacements.push({
                x: unit.worldX,
                y: unit.worldY,
                z: unit.worldZ,
                unitType: unit.fullUnitType,
                roundPlaced: unit.round,
                entityId: entityId
            });
            
            placedCount++;
            
            if (placedCount < unitsToPlace.length) {
                setTimeout(placeNextUnit, this.config.unitPlacementDelay);
            } else {
                placeNextUnit();
            }
        };
        
        placeNextUnit();
    }
    
    startNewPlacementPhase() {
        this.respawnPlayerUnits();
        
        if (this.playerPlacements.length > 0) {
            this.game.battleLogSystem.add(`Your army: ${this.playerPlacements.length} units ready for battle!`);
        } else {
            this.game.battleLogSystem.add(`Place your first units to build your army!`);
        }
    }
    
    resetAllPlacements() {
        this.playerPlacements = [];
        this.enemyPlacements = [];
        this.game.battleLogSystem.add('All unit placements cleared');
    }
    
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
    
    // Debug method to test unit creation with elemental properties
    debugUnitCreation(unitType, team = 'player') {
        console.log('Creating unit with properties:', {
            damage: unitType.damage,
            element: unitType.element,
            armor: unitType.armor,
            fireResistance: unitType.fireResistance,
            coldResistance: unitType.coldResistance,
            lightningResistance: unitType.lightningResistance
        });
        
        const entityId = this.createUnit(0, 0, 0, unitType, team);
        const combat = this.game.getComponent(entityId, this.game.componentManager.getComponentTypes().COMBAT);
        
        console.log('Created unit combat component:', combat);
        return entityId;
    }
}