class PlacementSystem {
    constructor(app) {
        this.game = app;
        this.game.placementSystem = this;
        
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.canvas = document.getElementById('gameCanvas');
        
        this.playerPlacements = [];
        this.enemyPlacements = [];
        
        // Add undo functionality
        this.undoStack = [];
        this.maxUndoSteps = 10; // Maximum number of undo steps
        
        // Add enemy strategy tracking
        this.enemyStrategies = {
            current: null,
            history: [],
            playerCounters: new Map(), // Track what player uses to counter it
        };
        
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
        
        this.ELEMENT_TYPES = {
            PHYSICAL: 'physical',
            FIRE: 'fire',
            COLD: 'cold',
            LIGHTNING: 'lightning',
            POISON: 'poison',
            DIVINE: 'divine'
        };
        
        // Strategy definitions
        this.buildStrategies = {
            balanced: {
                name: 'Balanced',
                weights: { hp: 0.3, damage: 0.4, range: 0.2, speed: 0.1 },
                unitTypePreferences: {},
                description: 'Well-rounded army composition'
            },
            counter: {
                name: 'Counter Strategy',
                weights: {},
                unitTypePreferences: {},
                description: 'Counters player\'s last strategy'
            },
            starter: {
                name: 'Opening Gambit',
                weights: { hp: 0, damage: 0, range: 0, speed: 0 },
                unitTypePreferences: {},
                maxUnitsToPlace: 2, // Only place 2 units
                description: 'Simple opening with 2 random units'
            }
        };
        
        // Bind keyboard event listener
        this.initializeKeyboardControls();
    }
    
    initializeKeyboardControls() {
        document.addEventListener('keydown', (event) => {
            // Check for Ctrl+Z (or Cmd+Z on Mac)
            if ((event.ctrlKey || event.metaKey) && event.key === 'z') {
                event.preventDefault();
                this.undoLastPlacement();
            }
        });
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
        
        // Store undo information BEFORE making changes
        const undoInfo = {
            type: 'placement',
            entityId: entityId,
            unitType: { ...state.selectedUnitType },
            cost: state.selectedUnitType.value,
            position: { x: worldPosition.x, y: unitY, z: worldPosition.z },
            placementIndex: this.playerPlacements.length // Index where unit will be added
        };
        
        // Add to undo stack
        this.addToUndoStack(undoInfo);
        
        // Make the actual changes
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
        
        if (this.game.effectsSystem) {
            // this.game.effectsSystem.showPlacementEffect(
            //     worldPosition.x, 
            //     unitY + 25,
            //     worldPosition.z
            // );
        }
    }
    
    addToUndoStack(undoInfo) {
        this.undoStack.push(undoInfo);
        
        // Limit undo stack size
        if (this.undoStack.length > this.maxUndoSteps) {
            this.undoStack.shift(); // Remove oldest undo step
        }
    }
    
    undoLastPlacement() {
        const state = this.game.state;
        
        // Only allow undo during placement phase
        if (state.phase !== 'placement') {
            this.game.battleLogSystem.add('Can only undo during placement phase!', 'log-damage');
            return;
        }
        
        // Check if there's anything to undo
        if (this.undoStack.length === 0) {
            this.game.battleLogSystem.add('Nothing to undo!', 'log-damage');
            return;
        }
        
        const undoInfo = this.undoStack.pop();
        
        if (undoInfo.type === 'placement') {
            // Remove the unit from the game world
            if (this.game.destroyEntity) {
                this.game.destroyEntity(undoInfo.entityId);
            }
            
            // Refund the gold
            state.playerGold += undoInfo.cost;
            
            // Remove from playerPlacements array
            const placementIndex = this.playerPlacements.findIndex(p => p.entityId === undoInfo.entityId);
            if (placementIndex !== -1) {
                this.playerPlacements.splice(placementIndex, 1);
            }
            
            // Show undo effect
            if (this.game.effectsSystem) {
                this.game.effectsSystem.createParticleEffect(
                    undoInfo.position.x,
                    undoInfo.position.y + 15,
                    undoInfo.position.z,
                    'magic', // Blue particles for undo
                    { count: 6, speedMultiplier: 0.7 }
                );
            }
            
            this.game.battleLogSystem.add(`Undid placement of ${undoInfo.unitType.title} (+${undoInfo.cost}g)`, 'log-victory');
        }
    }
    
    // Clear undo stack when starting new round or resetting
    clearUndoStack() {
        this.undoStack = [];
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
            
            if (this.game.effectsSystem) {
                const effectType = team === 'player' ? 'magic' : 'heal';
                this.game.effectsSystem.createParticleEffect(
                    placement.x, 
                    placement.y + 15, 
                    placement.z, 
                    effectType,
                    { count: 8, speedMultiplier: 0.6 }
                );
            }
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
        
        this.game.addComponent(entity, ComponentTypes.POSITION, Components.Position(worldX, worldY, worldZ));
        this.game.addComponent(entity, ComponentTypes.VELOCITY, Components.Velocity(0, 0, 0, unitType.speed * 20));
        this.game.addComponent(entity, ComponentTypes.RENDERABLE, Components.Renderable("units", unitType.id));
        this.game.addComponent(entity, ComponentTypes.COLLISION, Components.Collision(unitType.size));
        this.game.addComponent(entity, ComponentTypes.HEALTH, Components.Health(unitType.hp));
        
        this.game.addComponent(entity, ComponentTypes.COMBAT, Components.Combat(
            unitType.damage,
            unitType.range, 
            unitType.attackSpeed,
            unitType.projectile,
            0,
            unitType.element,
            unitType.armor,
            unitType.fireResistance,
            unitType.coldResistance,
            unitType.lightningResistance
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
        setTimeout(async () => {
            
            if (this.game.equipmentSystem && unitType?.render?.equipment) {            
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
            }
            if(this.game.abilitySystem && unitType?.abilities){
                this.game.abilitySystem.addAbilitiesToUnit(entityId, unitType.abilities);
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
    
    getAbilityFromCollection(abilityId) {
        const collections = this.game.getCollections();
        if (!collections || !collections.abilities || !collections.abilities[abilityId]) {
            console.warn(`Ability ${abilityId} not found in collections`);
            return null;
        }
        
        return collections.abilities[abilityId];
    }
    
    // Enhanced enemy placement with strategy support
    placeEnemyUnits(strategy = null, onComplete) {
        this.respawnEnemyUnits();
        
        const round = this.game.state.round;
        const enemyTotalGold = this.calculateEnemyTotalGold(round);
        const existingValue = this.calculateExistingEnemyValue();
        const availableGold = Math.max(0, enemyTotalGold - existingValue);
        
        // Determine strategy for this round
        const selectedStrategy = strategy || this.selectEnemyStrategy(round);
        this.enemyStrategies.current = selectedStrategy;
        this.enemyStrategies.history.push({ round, strategy: selectedStrategy });
        
        console.log(`Enemy Round ${round}: Using ${selectedStrategy} strategy with ${availableGold} gold`, this.getEnemyStrategyInfo());
        
        if (this.game.battleLogSystem) {
            this.game.battleLogSystem.add(
                `Enemy adopts ${this.buildStrategies[selectedStrategy]?.name || selectedStrategy} strategy!`,
                'log-damage'
            );
        }
        
        this.addNewEnemyUnitsWithStrategy(availableGold, selectedStrategy, onComplete);
    }
    
    // New strategy selection method - always try to counter
    selectEnemyStrategy(round) {
        // Always try to counter the player after round 1
        if (round > 1) {
            const counterStrategy = this.getCounterStrategy();
            if (counterStrategy) {
                return 'counter';
            }
        }
        
        // For round 1, use a special starter strategy
        return 'starter';
    }
    
    // Analyze player's army to determine counter strategy - enhanced for more aggressive countering
    getCounterStrategy() {
        const playerStats = this.analyzePlayerArmy();
        
        // If player has no units, use balanced
        if (this.playerPlacements.length === 0) {
            return null;
        }
        
        // Counter tank-heavy armies - FORCE mages only
        if (playerStats.tankHeavy) {
            this.buildStrategies.counter.unitTypePreferences = { 
                mage: 2  // Only mages allowed (filtering will handle this)
            };
            this.buildStrategies.counter.weights = { 
                elemental: 0.5, 
                damage: 0.5
            };
            this.buildStrategies.counter.description = 'Countering player tanks with mages ONLY';
            return 'counter';
        }
        
        // Counter ranged-heavy armies - FORCE tanks only
        if (playerStats.archerHeavy) {
            this.buildStrategies.counter.unitTypePreferences = { 
                tank: 2  // Only tanks allowed
            };
            this.buildStrategies.counter.weights = { 
                hp: 0.5, 
                armor: 0.5
            };
            this.buildStrategies.counter.description = 'Countering player ranged units with tanks ONLY';
            return 'counter';
        }
        
        // Counter mage-heavy armies - FORCE archers only
        if (playerStats.mageHeavy) {
            this.buildStrategies.counter.unitTypePreferences = { 
                archer: 2  // Only archers allowed
            };
            this.buildStrategies.counter.weights = { 
                damage: 0.5, 
                range: 0.5
            };
            this.buildStrategies.counter.description = 'Countering player mages with archers ONLY';
            return 'counter';
        }
        
        // Default counter for balanced armies
        this.buildStrategies.counter.unitTypePreferences = { 
            mage: 1.25, 
            archer: 1.25,
            tank: 1.5
        };
        this.buildStrategies.counter.weights = { 
            hp: 0.2, damage: 0.5, range: 0.2, speed: 0.1 
        };
        this.buildStrategies.counter.description = 'Countering balanced army with damage focus';
        return 'counter';
    }
    
    // Analyze player's current army composition
    analyzePlayerArmy() {
        const totalUnits = this.playerPlacements.length;
        
        if (totalUnits === 0) return {};
        
        let tankCount = 0;
        let mageCount = 0;
        let archerCount = 0;
        
        this.playerPlacements.forEach(placement => {
            const unit = placement.unitType;
            
            // Categorize using the same logic as categorizeUnit
            const category = this.categorizeUnit(unit);
            switch (category) {
                case 'tank': tankCount++; break;
                case 'archer': archerCount++; break;
                case 'mage': mageCount++; break;
            }
        });
        
        return {
            tankHeavy: tankCount / totalUnits > 0.5,
            mageHeavy: mageCount / totalUnits > 0.5,
            archerHeavy: archerCount / totalUnits > 0.5
        };
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
    
    // Strategy-enhanced enemy unit placement
    addNewEnemyUnitsWithStrategy(budget, strategy, onComplete) {
        const UnitTypes = this.game.getCollections().units;
        const availableUnits = Object.values(UnitTypes);
        
        if (budget <= 0) {
            if (onComplete && typeof onComplete === 'function') {
                onComplete();
            }
            return;
        }
        
        const strategyConfig = this.buildStrategies[strategy] || this.buildStrategies.balanced;
        const optimalCombination = this.findOptimalUnitCombinationWithStrategy(
            budget, 
            availableUnits, 
            strategyConfig
        );
        
        if (optimalCombination.units.length === 0) {
            if (onComplete && typeof onComplete === 'function') {
                onComplete();
            }
            return;
        }
        
        const unitsToPlace = this.prepareUnitsForPlacement(optimalCombination.units);
        this.placeUnitsWithTiming(unitsToPlace, optimalCombination, budget, onComplete);
    }
    
    // Enhanced unit combination finder with strategy support
    findOptimalUnitCombinationWithStrategy(budget, availableUnits, strategyConfig) {
        const maxUnits = Math.floor((this.config.maxUnitsPerRound || 10) * (strategyConfig.maxUnitsMultiplier || 1.0));
        
        const units = availableUnits.map((unit, index) => ({
            id: Object.keys(this.game.getCollections().units)[availableUnits.indexOf(unit)],
            ...unit,
            index: index,
            strategyScore: this.calculateUnitStrategyScore(unit, strategyConfig)
        })).filter(unit => {
            if (!unit.buyable || unit.value > budget) return false;
            
            // Apply value threshold for swarm strategy
            if (strategyConfig.valueThreshold) {
                const maxValue = budget * strategyConfig.valueThreshold;
                return unit.value <= maxValue;
            }
            
            return true;
        });
        
        if (units.length === 0) {
            return { units: [], totalCost: 0, efficiency: 0 };
        }
        
        // Generate combinations with strategy bias
        const validCombinations = this.generateStrategyCombinations(units, budget, maxUnits, strategyConfig);
        
        let bestCombination = { units: [], totalCost: 0, efficiency: 0 };
        
        for (const combination of validCombinations) {
            const efficiency = this.calculateCombinationEfficiency(combination, budget, strategyConfig);
            if (efficiency > bestCombination.efficiency) {
                bestCombination = combination;
                bestCombination.efficiency = efficiency;
            }
        }
        
        return bestCombination;
    }
    
    // Calculate how well a unit fits the current strategy
    calculateUnitStrategyScore(unit, strategyConfig) {
        let score = this.calculateUnitEfficiencyWithWeights(unit, strategyConfig.weights);
        
        // Apply unit type preferences
        if (strategyConfig.unitTypePreferences) {
            const unitCategory = this.categorizeUnit(unit);
            const multiplier = strategyConfig.unitTypePreferences[unitCategory];
            if (multiplier) {
                score *= multiplier;
            }
        }
        
        return score;
    }
    
    // Calculate unit efficiency with custom weights
    calculateUnitEfficiencyWithWeights(unit, weights) {
        const hp = unit.hp || 100;
        const damage = unit.damage || 10;
        const range = unit.range || 1;
        const speed = unit.speed || 1;
        const armor = unit.armor || 0;
        const element = (unit.element || 'physical');        
        const poison = element == 'poison' ? 1 : 0;
        const physical = element == 'physical' ? 1 : 0;
        const elemental = physical + poison == 0 ? 1 : 0;


        let combatValue = (hp * weights.hp) + (damage * weights.damage) + 
                         (range * weights.range) + (speed * weights.speed) + (elemental * weights.elemental ) + (armor * weights.armor) + (poison * weights.poison);
        
        
        return combatValue / unit.value;
    }
    
    // Generate combinations with strategy considerations
    generateStrategyCombinations(units, budget, maxUnits, strategyConfig) {
        const combinations = [];
        
        // Sort units by strategy score for greedy approach
        const sortedUnits = [...units].sort((a, b) => b.strategyScore - a.strategyScore);
        
        // Strategy-based greedy combination
        combinations.push(this.getStrategyGreedyCombination(sortedUnits, budget, maxUnits));
        
        // Add some randomized combinations for variety
        for (let i = 0; i < 5; i++) {
            const shuffledUnits = [...units].sort(() => Math.random() - 0.5);
            combinations.push(this.getStrategyGreedyCombination(shuffledUnits, budget, maxUnits));
        }
        
        // Original recursive approach with limited iterations
        this.generateCombinationsRecursive(
            units, budget, maxUnits, [], 0, 0, 0, combinations, 
            Math.min(this.config.maxCombinationsToCheck, 1000)
        );
        
        return combinations;
    }
    
    // Strategy-aware greedy combination
    getStrategyGreedyCombination(sortedUnits, budget, maxUnits) {
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
            totalCost: budget - remainingBudget
        };
    }
    
    // Calculate combination efficiency with strategy considerations
    calculateCombinationEfficiency(combination, budget, strategyConfig) {
        const budgetEfficiency = combination.totalCost / budget;
        
        // Calculate strategy alignment bonus
        let strategyAlignment = 0;
        const unitTypes = new Map();
        
        combination.units.forEach(unit => {
            const type = this.categorizeUnit(unit);
            unitTypes.set(type, (unitTypes.get(type) || 0) + 1);
        });
        
        // Bonus for having preferred unit types
        if (strategyConfig.unitTypePreferences) {
            for (const [type, preference] of Object.entries(strategyConfig.unitTypePreferences)) {
                const count = unitTypes.get(type) || 0;
                strategyAlignment += count * (preference - 1.0) * 0.1;
            }
        }
        
        return budgetEfficiency + strategyAlignment;
    }
    
    // Categorize units for strategy analysis
    categorizeUnit(unit) {
        const id = (unit.id || '').toLowerCase();
        
        if (id.includes('_s_') || (unit.hp > 200 && unit.armor > 5)) {
            return 'tank';
        }
        if (id.includes('_d_')) {
            return 'archer';
        }
        if (id.includes('_i_')) {
            return 'mage';
        }
        if (unit.range > 50) {
            return 'ranged';
        }
        if (unit.speed > 55) {
            return 'fast';
        }
        
        return 'melee';
    }
    
    // Legacy methods for backward compatibility
    findOptimalUnitCombination(budget, availableUnits, maxUnits = this.config.maxUnitsPerRound) {
        const units = availableUnits.map((unit, index) => ({
            id: Object.keys(this.game.getCollections().units)[availableUnits.indexOf(unit)],
            ...unit,
            index: index
        })).filter(unit => unit.value <= budget && unit.buyable);
        
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
        
        let combatValue = (hp * weights.hp) + (damage * weights.damage) + (range * weights.range) + (speed * weights.speed);
        
        const armor = unit.armor || 0;
        const fireResist = unit.fireResistance || 0;
        const coldResist = unit.coldResistance || 0;
        const lightningResist = unit.lightningResistance || 0;
        
        const defensiveValue = (armor * 2) + (fireResist * 20) + (coldResist * 20) + (lightningResist * 20);
        combatValue += defensiveValue * 0.15;
        
        if (unit.element === this.ELEMENT_TYPES.DIVINE) {
            combatValue *= 1.2;
        } else if (unit.element === this.ELEMENT_TYPES.POISON) {
            combatValue *= 1.1;
        }
        
        return combatValue / unit.value;
    }
    
    // Legacy method - kept for backward compatibility
    addNewEnemyUnitsWithOptimalBudget(budget, onComplete) {
        // Use balanced strategy as default for legacy calls
        this.addNewEnemyUnitsWithStrategy(budget, 'balanced', onComplete);
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
            
            if (this.game.effectsSystem) {
                this.game.effectsSystem.createParticleEffect(
                    unit.worldX, 
                    unit.worldY, 
                    unit.worldZ, 
                    'defeat',
                    { count: 8, speedMultiplier: 0.8 }
                );
            }
            
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
        
        // Don't clear undo stack here - allow undoing placements from current round
        
        if (this.playerPlacements.length > 0) {
            this.game.battleLogSystem.add(`Your army: ${this.playerPlacements.length} units ready for battle!`);
        } else {
            this.game.battleLogSystem.add(`Place your first units to build your army!`);
        }
    }
    
    resetAllPlacements() {
        if (this.game.effectsSystem) {
            [...this.playerPlacements, ...this.enemyPlacements].forEach(placement => {
                this.game.effectsSystem.createParticleEffect(
                    placement.x, 
                    placement.y + 5, 
                    placement.z, 
                    'explosion',
                    { count: 6, speedMultiplier: 0.5 }
                );
            });
        }
        
        this.playerPlacements = [];
        this.enemyPlacements = [];
        this.clearUndoStack(); // Clear undo stack when resetting everything
        this.enemyStrategies.history = []; // Clear strategy history
        this.enemyStrategies.current = null;
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
    
    showInvalidPlacementEffect(screenX, screenY) {
        if (this.game.effectsSystem) {
            const worldPos = this.game.effectsSystem.screenToWorldPosition(screenX, screenY);
            this.game.effectsSystem.createParticleEffect(
                worldPos.x, 
                worldPos.y, 
                worldPos.z, 
                'damage',
                { count: 5, speedMultiplier: 0.3, color: 0xff4444 }
            );
        }
    }
    
    showPlacementPreview(worldX, worldY, worldZ) {
        if (this.game.effectsSystem) {
            this.game.effectsSystem.createParticleEffect(
                worldX, 
                worldY + 5, 
                worldZ, 
                'heal',
                { count: 3, speedMultiplier: 0.2, scaleMultiplier: 0.5 }
            );
        }
    }
    
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
    
    // Method to get the current undo stack status (for UI display)
    getUndoStatus() {
        return {
            canUndo: this.undoStack.length > 0,
            undoCount: this.undoStack.length,
            lastAction: this.undoStack.length > 0 ? this.undoStack[this.undoStack.length - 1] : null
        };
    }
    
    // Add method to get current enemy strategy info (for UI/debugging)
    getEnemyStrategyInfo() {
        return {
            current: this.enemyStrategies.current,
            description: this.buildStrategies[this.enemyStrategies.current]?.description || 'Unknown',
            history: this.enemyStrategies.history.slice(-5) // Last 5 strategies
        };
    }
}