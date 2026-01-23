/**
 * AIExecuteHeuristicBehaviorAction - Scores and executes actions for heuristic AI
 *
 * Based on the strategic plan and current game state, this action:
 * 1. Scores all possible building placements
 * 2. Scores all possible unit purchases
 * 3. Executes the highest-scored actions within resource constraints
 * 4. Issues move orders based on strategy
 *
 * Uses GameInterfaceSystem services (ui_*) just like a player would.
 */
class AIExecuteHeuristicBehaviorAction extends GUTS.BaseBehaviorAction {

    static serviceDependencies = [
        'getUnitTypeDef',
        'getSquadData',
        'getSquadCells',
        'ui_placeUnit',
        'worldToPlacementGrid',
        'isCellOccupied',
        'ui_purchaseUnit',
        'ui_issueMoveOrder',
        'getPlacementsForSide',
        'getStartingLocationsFromLevel',
        'tileToWorld',
        'getVisibleEnemiesInRange',
        'getEntityAbilities',
        'placementGridToWorld',
        'findBuildingAdjacentPosition',
        'getLevelUpCost',
        'getRampPositions',
        'upgradeBuildingRequest',
        'purchaseUpgrade',
        'levelSquad'
    ];

    execute(entityId, game) {
        const aiState = game.getComponent(entityId, 'aiHeuristicState');
        if (!aiState) {
            return this.failure();
        }

        const teamComp = game.getComponent(entityId, 'team');
        const aiTeam = teamComp?.team;
        if (aiTeam === undefined) {
            return this.failure();
        }

        const enums = game.getEnums();
        const collections = game.getCollections();
        const weights = collections.aiConfig?.heuristicWeights;
        const counters = collections.aiConfig?.counters;

        if (!weights || !counters) {
            return this.failure();
        }

        const playerId = aiTeam === enums.team.left ? 0 : 1;
        let gold = aiState.gold || 0;
        let supplyAvailable = aiState.supplyAvailable || 0;

        // Reset production progress for all buildings at the start of each round
        // (In headless mode, onPlacementPhaseStart event may not be triggered)
        this.resetBuildingProductionProgress(aiTeam, game);

        // Generate and score all possible actions
        const actions = [];

        // HIGHEST PRIORITY: Score peasant purchases for gold mining (5 per mine)
        const peasantActions = this.scorePeasantActions(aiState, gold, supplyAvailable, aiTeam, game, collections);
        actions.push(...peasantActions);

        // HIGH PRIORITY: Score cottage placements for supply
        const cottageActions = this.scoreCottageActions(aiState, gold, aiTeam, playerId, game, collections);
        actions.push(...cottageActions);

        // Score building placements
        const buildingActions = this.scoreBuildingActions(aiState, gold, aiTeam, playerId, game, collections, weights, counters);
        actions.push(...buildingActions);

        // Score unit purchases
        const unitActions = this.scoreUnitActions(aiState, gold, supplyAvailable, aiTeam, game, collections, weights, counters);
        actions.push(...unitActions);

        // Score town hall upgrades (townHall -> keep -> castle)
        const townHallUpgradeActions = this.scoreTownHallUpgradeActions(aiState, gold, aiTeam, game, collections);
        actions.push(...townHallUpgradeActions);

        // Score technology upgrades (peasantEfficiency, spellDamage, etc.)
        const techUpgradeActions = this.scoreTechUpgradeActions(aiState, gold, aiTeam, playerId, game, collections);
        actions.push(...techUpgradeActions);

        // Score unit level ups and specializations
        const levelUpActions = this.scoreLevelUpActions(aiState, gold, aiTeam, game, collections);
        actions.push(...levelUpActions);

        // Score sentry tower placements for base defense
        const sentryTowerActions = this.scoreSentryTowerActions(aiState, gold, aiTeam, playerId, game, collections);
        actions.push(...sentryTowerActions);

        // Sort by score (descending)
        actions.sort((a, b) => b.score - a.score);

        // Track used peasants to prevent assigning the same peasant to multiple buildings
        const usedPeasants = new Set();

        // Track reserved grid cells to prevent buildings from overlapping
        const reservedCells = new Set();

        // Track production capacity used per building this round
        const buildingCapacityUsed = new Map();

        // Execute actions in priority order while we have resources
        let executedCount = 0;
        for (const action of actions) {
            if (action.goldCost > gold) {
                continue;
            }
            if (action.supplyCost && action.supplyCost > supplyAvailable) {
                continue;
            }

            // For unit purchases, check production capacity
            if (action.type === 'PURCHASE_UNIT') {
                const buildingId = action.buildingEntityId;
                const capacityUsed = buildingCapacityUsed.get(buildingId) || 0;
                const buildTime = action.buildTime || 1;

                // Check if this building still has capacity
                if (capacityUsed + buildTime > 1 + 0.001) {
                    continue; // Skip - this building is at capacity
                }
            }

            // For building actions, check if the peasant is already used
            const isBuildingAction = action.type === 'PLACE_BUILDING' ||
                                     action.type === 'PLACE_COTTAGE' ||
                                     action.type === 'PLACE_SENTRY_TOWER';
            if (isBuildingAction) {
                if (usedPeasants.has(action.peasantId)) continue;
            }

            const result = this.executeAction(action, aiTeam, playerId, game, reservedCells);
            if (result) {
                executedCount++;
                gold -= action.goldCost || 0;
                supplyAvailable -= action.supplyCost || 0;

                // Track production capacity used for unit purchases
                if (action.type === 'PURCHASE_UNIT') {
                    const buildingId = action.buildingEntityId;
                    const capacityUsed = buildingCapacityUsed.get(buildingId) || 0;
                    buildingCapacityUsed.set(buildingId, capacityUsed + (action.buildTime || 1));
                }

                // Mark peasant as used for building actions
                if (isBuildingAction) {
                    usedPeasants.add(action.peasantId);

                    // Add the placed building's cells to reserved set
                    if (result.reservedCells) {
                        for (const cell of result.reservedCells) {
                            reservedCells.add(cell);
                        }
                    }
                }
            }
        }

        // Issue move orders based on strategy
        this.issueMoveOrders(aiState, aiTeam, game, weights);

        return this.success();
    }

    scoreBuildingActions(aiState, gold, aiTeam, playerId, game, collections, weights, counters) {
        const actions = [];
        const plan = aiState.strategicPlan;

        // Find all available peasants
        const availablePeasants = this.findAllAvailablePeasants(aiTeam, game);
        if (availablePeasants.length === 0) {
            return actions;
        }

        // Count how many production buildings we already have
        const ownedProductionBuildings = Object.keys(aiState.ownBuildings || {}).filter(
            b => counters.buildingPriority[b]
        ).length;

        // Get the focus building (produces our focus unit)
        const focusBuildingId = aiState.focusBuildingId;

        // Score each building we might want, assigning peasants round-robin
        let peasantIndex = 0;
        for (const [buildingId, buildingInfo] of Object.entries(counters.buildingPriority)) {
            const buildingDef = collections.buildings?.[buildingId];
            if (!buildingDef) continue;

            const cost = buildingDef.value || 50;
            if (cost > gold) continue;

            // SKIP buildings we already own - focus on units instead
            if (aiState.ownBuildings?.[buildingId]) {
                continue;
            }

            let score = 0;

            // High score ONLY for first 1-2 production buildings
            // After that, units are much more valuable
            if (ownedProductionBuildings === 0) {
                // First building is high priority - prefer focus building
                score = (buildingId === focusBuildingId) ? 120 : 100;
            } else if (ownedProductionBuildings === 1) {
                // Second building is medium priority
                score = 40;
            } else {
                // Third+ buildings are very low priority - units are better
                score = 5;
            }

            // Bonus if this building is in our strategic plan
            if (plan.targetBuildings && plan.targetBuildings.includes(buildingId)) {
                score += 15;
            }

            // Assign a peasant to this building action (round-robin through available peasants)
            const assignedPeasant = availablePeasants[peasantIndex % availablePeasants.length];
            peasantIndex++;

            actions.push({
                type: 'PLACE_BUILDING',
                buildingId: buildingId,
                peasantId: assignedPeasant,
                score: score,
                goldCost: cost,
                supplyCost: 0
            });
        }

        return actions;
    }

    scoreUnitActions(aiState, gold, supplyAvailable, aiTeam, game, collections, weights, counters) {
        const actions = [];
        const plan = aiState.strategicPlan;
        const decisionWeights = weights.decisionScoring;
        const round = game.state.round || 1;

        // Get focus unit for this AI (adds variety between games)
        const focusUnitId = aiState.focusUnitId;

        // Count total combat units for composition decisions
        const totalCombatUnits = Object.entries(aiState.ownUnits || {})
            .filter(([id, _]) => id !== 'peasant')
            .reduce((sum, [_, count]) => sum + count, 0);

        // Calculate urgency bonus - if we have few units, boost production priority
        const targetWaveSize = aiState.attackWaveSize || 3;
        const armyDeficit = Math.max(0, targetWaveSize - totalCombatUnits);
        const urgencyBonus = armyDeficit * 15; // Big bonus when below target army size

        // Find ALL production buildings with available capacity
        const productionBuildings = this.findAllProductionBuildings(aiTeam, game, collections);

        // Score units from each building that can produce them
        for (const building of productionBuildings) {
            const buildingDef = collections.buildings?.[building.type];
            if (!buildingDef?.units) continue;

            // Score each unit this building can produce
            for (const unitId of buildingDef.units) {
                const unitDef = collections.units?.[unitId];
                if (!unitDef) continue;

                // Skip peasants - they're not combat units
                if (unitId === 'peasant') continue;

                // Check if we have the required buildings for this unit
                if (!this.hasRequiredBuildings(unitDef, aiState.ownBuildings)) continue;

                // Check production capacity
                const buildTime = unitDef.buildTime || 1;
                if (buildTime > building.remainingCapacity + 0.001) continue;

                const cost = unitDef.value || 35;
                const supplyCost = unitDef.supplyCost || 2;

                if (cost > gold) continue;
                if (supplyCost > supplyAvailable) continue;

                // Base score for units - always high priority (we need combat power!)
                let score = 50;

                // Urgency bonus - need to rebuild army after losses
                score += urgencyBonus;

                // Focus unit bonus - AI prefers its chosen unit type
                // This creates ~60% focus unit, 40% variety composition
                if (unitId === focusUnitId) {
                    score += 30; // Strong preference for focus unit
                }

                // Base combat power score
                const combatPower = this.calculateUnitPower(unitDef);
                score += combatPower * (decisionWeights.valueEfficiencyWeight || 1.5);

                // Counter bonus - does this unit counter visible enemies?
                const counterScore = this.calculateCounterScore(unitId, aiState.visibleEnemyUnits, counters);
                score += counterScore * (decisionWeights.counterBonusWeight || 2.0);

                // Strategy alignment bonus
                if (plan.targetUnits && plan.targetUnits[unitId]) {
                    const targetCount = plan.targetUnits[unitId];
                    const currentCount = aiState.ownUnits?.[unitId] || 0;
                    if (currentCount < targetCount) {
                        score += (targetCount - currentCount) * 5;
                    }
                }

                // Composition variety - encourage some non-focus units
                const currentCount = aiState.ownUnits?.[unitId] || 0;
                const focusCount = aiState.ownUnits?.[focusUnitId] || 0;

                // If we have many focus units, slightly boost variety
                if (unitId !== focusUnitId && focusCount >= 3 && totalCombatUnits >= 4) {
                    score += 10; // Encourage some variety
                }

                // Soft cap on any single unit type (but don't prevent it entirely)
                // Allow more units as the game progresses
                const maxDuplicates = Math.max(6, 4 + Math.floor(round / 5));
                if (currentCount >= maxDuplicates) {
                    score *= 0.8; // Small penalty, still keep producing
                }

                // Value efficiency - combat power per gold spent
                const efficiency = combatPower / cost;
                score += efficiency * 2;

                actions.push({
                    type: 'PURCHASE_UNIT',
                    unitId: unitId,
                    buildingEntityId: building.entityId,
                    score: score,
                    goldCost: cost,
                    supplyCost: supplyCost,
                    buildTime: buildTime
                });
            }
        }

        return actions;
    }

    /**
     * Find all production buildings for the AI team, along with their remaining capacity
     */
    findAllProductionBuildings(aiTeam, game, collections) {
        const buildings = [];
        const entities = game.getEntitiesWith('unitType', 'team', 'placement');

        for (const entityId of entities) {
            const teamComp = game.getComponent(entityId, 'team');
            if (teamComp?.team !== aiTeam) continue;

            const placement = game.getComponent(entityId, 'placement');
            // Skip buildings under construction
            if (placement?.isUnderConstruction) continue;

            const unitTypeComp = game.getComponent(entityId, 'unitType');
            const unitDef = this.call.getUnitTypeDef( unitTypeComp);
            if (!unitDef) continue;

            // Check if this is a production building
            const buildingDef = collections.buildings?.[unitDef.id];
            if (!buildingDef?.units || buildingDef.units.length === 0) continue;

            // Get production progress (capacity used this round)
            const productionProgress = placement?.productionProgress || 0;
            const remainingCapacity = 1 - productionProgress;

            buildings.push({
                entityId: entityId,
                type: unitDef.id,
                remainingCapacity: remainingCapacity
            });
        }

        return buildings;
    }

    /**
     * Reset production progress for all buildings belonging to this AI's team.
     * This ensures each round starts fresh with full production capacity.
     * Called at the start of each AI turn since the normal onPlacementPhaseStart
     * event may not fire properly in headless mode.
     */
    resetBuildingProductionProgress(aiTeam, game) {
        const entities = game.getEntitiesWith('unitType', 'team', 'placement');

        for (const entityId of entities) {
            const teamComp = game.getComponent(entityId, 'team');
            if (teamComp?.team !== aiTeam) continue;

            const unitTypeComp = game.getComponent(entityId, 'unitType');
            const unitDef = this.call.getUnitTypeDef( unitTypeComp);

            // Only reset buildings (not units) - buildings have footprintWidth
            const isBuilding = unitDef?.footprintWidth !== undefined;
            if (!isBuilding) continue;

            const placement = game.getComponent(entityId, 'placement');
            if (placement) {
                placement.productionProgress = 0;
            }
        }
    }

    /**
     * Score peasant purchases - HIGHEST PRIORITY
     * AI needs 5 peasants per gold mine for optimal income
     */
    scorePeasantActions(aiState, gold, supplyAvailable, aiTeam, game, collections) {
        const actions = [];

        const peasantDef = collections.units?.peasant;
        if (!peasantDef) return actions;

        const cost = peasantDef.value || 35;
        const supplyCost = peasantDef.supplyCost || 1;

        if (cost > gold) return actions;
        if (supplyCost > supplyAvailable) return actions;

        // Find town hall to purchase peasants from
        const townHall = this.findTownHall(aiTeam, game);
        if (!townHall) return actions;

        // Count current peasants
        const currentPeasants = aiState.ownUnits?.peasant || 0;

        // Count gold mines owned by this team
        const ownedGoldMines = this.countOwnedGoldMines(aiTeam, game);

        // Target: 5 peasants per gold mine (for optimal mining)
        const targetPeasants = Math.max(5, ownedGoldMines * 5);
        const peasantDeficit = targetPeasants - currentPeasants;

        if (peasantDeficit <= 0) return actions;

        // Very high priority score - peasants are essential for economy
        // Score 200+ ensures this is the highest priority action
        let score = 200 + (peasantDeficit * 20);

        // Even higher priority if we have no peasants mining
        if (currentPeasants < 5) {
            score += 100;
        }

        actions.push({
            type: 'PURCHASE_UNIT',
            unitId: 'peasant',
            buildingEntityId: townHall,
            score: score,
            goldCost: cost,
            supplyCost: supplyCost
        });

        return actions;
    }

    /**
     * Count gold mines owned by a team
     */
    countOwnedGoldMines(aiTeam, game) {
        let count = 0;
        const goldMineEntities = game.getEntitiesWith('goldMine', 'team');

        for (const mineId of goldMineEntities) {
            const teamComp = game.getComponent(mineId, 'team');
            if (teamComp?.team === aiTeam) {
                count++;
            }
        }

        return Math.max(1, count); // Assume at least 1 mine
    }

    /**
     * Score cottage placements - HIGH PRIORITY
     * AI needs cottages to support army supply requirements
     */
    scoreCottageActions(aiState, gold, aiTeam, playerId, game, collections) {
        const actions = [];

        const cottageDef = collections.buildings?.cottage;
        if (!cottageDef) return actions;

        const cost = cottageDef.value || 50;
        if (cost > gold) return actions;

        // Find available peasants to build
        const availablePeasants = this.findAllAvailablePeasants(aiTeam, game);
        if (availablePeasants.length === 0) return actions;

        // Calculate supply situation
        const supplyUsed = aiState.supplyUsed || 0;
        const supplyMax = aiState.supplyMax || 0;
        const supplyAvailable = supplyMax - supplyUsed;

        // Calculate target army size based on wave size
        // Wave size grows over time, so we need more supply as the game progresses
        const targetWaveSize = aiState.attackWaveSize || 3;
        // Each combat unit costs ~2 supply, plus 5 peasants (1 supply each)
        // Add buffer for ongoing production - we want supply headroom
        const targetSupply = (targetWaveSize * 2) + 10; // Army + peasants + buffer

        // Calculate how much more supply we need
        const supplyNeeded = targetSupply - supplyMax;

        // Count current cottages
        const currentCottages = aiState.ownBuildings?.cottage || 0;

        // Cottage provides 8 supply
        const cottageSupply = cottageDef.supplyProvided || 8;

        // Build cottage if:
        // 1. We're close to supply cap (< 6 available) - URGENT
        // 2. OR we need more supply for our target army
        // 3. OR we have fewer than minimum cottages for the current round
        // 4. OR proactive building when we have some headroom but could use more
        let score = 0;

        const round = game.state.round || 1;
        // Target 1 cottage per 8-10 rounds, minimum 1
        const minCottagesForRound = Math.max(1, Math.floor(round / 8));

        if (supplyAvailable < 6) {
            // Urgent - almost supply capped
            score = 150;
        } else if (supplyNeeded > 0) {
            // Need more supply for target army
            score = 100 + Math.min(supplyNeeded * 5, 50);
        } else if (currentCottages < minCottagesForRound) {
            // Build proactively based on game progress
            score = 90;
        } else if (supplyAvailable < 10) {
            // Proactive - build before we need it
            score = 60;
        } else if (supplyAvailable < 15 && gold > 150) {
            // We have excess gold, might as well expand supply
            score = 30;
        }

        if (score > 0) {
            actions.push({
                type: 'PLACE_COTTAGE',
                buildingId: 'cottage',
                peasantId: availablePeasants[0],
                score: score,
                goldCost: cost,
                supplyCost: 0
            });
        }

        return actions;
    }

    calculateUnitPower(unitDef) {
        const hp = unitDef.hp || 100;
        const damage = unitDef.damage || 10;
        const attackSpeed = unitDef.attackSpeed || 1;
        const armor = unitDef.armor || 0;
        const range = unitDef.range || 5;

        const dps = damage * attackSpeed;
        const effectiveHP = hp * (1 + armor / 100);
        const rangeBonus = Math.min(range / 50, 2);

        return (effectiveHP * 0.4) + (dps * 10 * 0.4) + (rangeBonus * 10 * 0.2);
    }

    calculateCounterScore(unitId, visibleEnemyUnits, counters) {
        const unitInfo = counters.units?.[unitId];
        if (!unitInfo || !visibleEnemyUnits) return 0;

        let score = 0;

        for (const [enemyType, count] of Object.entries(visibleEnemyUnits)) {
            if (unitInfo.strongAgainst && unitInfo.strongAgainst.includes(enemyType)) {
                score += count * unitInfo.counterWeight;
            }
            if (unitInfo.weakAgainst && unitInfo.weakAgainst.includes(enemyType)) {
                score -= count * 0.5;
            }
        }

        return score;
    }

    canAlreadyProduceUnit(unitId, ownBuildings, counters) {
        if (!ownBuildings) return false;

        for (const [buildingId, buildingInfo] of Object.entries(counters.buildingPriority)) {
            if (ownBuildings[buildingId] && buildingInfo.providesUnits.includes(unitId)) {
                return true;
            }
        }
        return false;
    }

    hasRequiredBuildings(unitDef, ownBuildings) {
        // If no requirements, unit can be built
        if (!unitDef.requiresBuildings || unitDef.requiresBuildings.length === 0) {
            return true;
        }

        // Check each required building
        for (const requiredBuilding of unitDef.requiresBuildings) {
            // Check if we own this building (or its upgraded versions)
            if (requiredBuilding === 'keep') {
                // Keep requirement is satisfied by keep or castle
                if (!ownBuildings?.keep && !ownBuildings?.castle) {
                    return false;
                }
            } else if (requiredBuilding === 'castle') {
                // Castle requirement only satisfied by castle
                if (!ownBuildings?.castle) {
                    return false;
                }
            } else {
                // Generic building check
                if (!ownBuildings?.[requiredBuilding]) {
                    return false;
                }
            }
        }

        return true;
    }

    executeAction(action, aiTeam, playerId, game, reservedCells = new Set()) {
        switch (action.type) {
            case 'PLACE_BUILDING':
                return this.executePlaceBuilding(action, aiTeam, playerId, game, reservedCells);
            case 'PLACE_COTTAGE':
                return this.executePlaceCottage(action, aiTeam, playerId, game, reservedCells);
            case 'PURCHASE_UNIT':
                return this.executePurchaseUnit(action, aiTeam, game);
            case 'UPGRADE_TOWNHALL':
                return this.executeUpgradeTownHall(action, aiTeam, game);
            case 'PURCHASE_UPGRADE':
                return this.executePurchaseUpgrade(action, aiTeam, game);
            case 'LEVEL_UP_SQUAD':
                return this.executeLevelUpSquad(action, aiTeam, game);
            case 'PLACE_SENTRY_TOWER':
                return this.executePlaceSentryTower(action, aiTeam, playerId, game, reservedCells);
            default:
                return false;
        }
    }

    executePlaceBuilding(action, aiTeam, playerId, game, reservedCells = new Set()) {
        const collections = game.getCollections();
        const buildingDef = collections.buildings?.[action.buildingId];
        if (!buildingDef) {
            return false;
        }

        // Find position near town hall, avoiding reserved cells
        const gridPos = this.findBuildingPosition(aiTeam, buildingDef, action.buildingId, game, reservedCells);
        if (!gridPos) {
            return false;
        }

        // Calculate this building's footprint cells to reserve
        const buildingDefWithCollection = { ...buildingDef, id: action.buildingId, collection: 'buildings' };
        const squadData = this.call.getSquadData( buildingDefWithCollection);
        const buildingCells = this.call.getSquadCells( gridPos, squadData) || [];
        const cellStrings = buildingCells.map(cell => `${cell.x},${cell.z}`);

        // Prepare unit type and peasant info
        const unitType = { ...buildingDef, id: action.buildingId, collection: 'buildings' };
        const peasantInfo = {
            peasantId: action.peasantId,
            buildTime: buildingDef.buildTime || 1
        };

        // Call ui_placeUnit
        this.call.ui_placeUnit( gridPos, unitType, aiTeam, playerId, peasantInfo, (success, response) => {
            // Callback handled silently
        });

        // Return the reserved cells so they can be tracked
        return { success: true, reservedCells: cellStrings };
    }

    /**
     * Execute cottage placement near town hall for supply.
     */
    executePlaceCottage(action, aiTeam, playerId, game, reservedCells = new Set()) {
        const collections = game.getCollections();
        const buildingDef = collections.buildings?.cottage;
        if (!buildingDef) {
            return false;
        }

        // Find position near town hall
        const gridPos = this.findBuildingPosition(aiTeam, buildingDef, 'cottage', game, reservedCells);
        if (!gridPos) {
            return false;
        }

        // Calculate this building's footprint cells to reserve
        const buildingDefWithCollection = { ...buildingDef, id: 'cottage', collection: 'buildings' };
        const squadData = this.call.getSquadData( buildingDefWithCollection);
        const buildingCells = this.call.getSquadCells( gridPos, squadData) || [];
        const cellStrings = buildingCells.map(cell => `${cell.x},${cell.z}`);

        // Prepare unit type and peasant info
        const unitType = { ...buildingDef, id: 'cottage', collection: 'buildings' };
        const peasantInfo = {
            peasantId: action.peasantId,
            buildTime: buildingDef.buildTime || 1
        };

        // Call ui_placeUnit
        this.call.ui_placeUnit( gridPos, unitType, aiTeam, playerId, peasantInfo, (success, response) => {
            // Callback handled silently
        });

        return { success: true, reservedCells: cellStrings };
    }

    /**
     * Execute sentry tower placement near a ramp for base defense.
     */
    executePlaceSentryTower(action, aiTeam, playerId, game, reservedCells = new Set()) {
        const collections = game.getCollections();
        const buildingDef = collections.buildings?.sentryTower;
        if (!buildingDef) {
            return false;
        }

        // Convert the target world position to grid position
        const targetWorldPos = action.rampPosition;
        if (!targetWorldPos) {
            return false;
        }

        // Find a valid grid position near the target ramp position
        const gridPos = this.findSentryTowerPosition(aiTeam, targetWorldPos, buildingDef, game, reservedCells);
        if (!gridPos) {
            return false;
        }

        // Calculate this building's footprint cells to reserve
        const buildingDefWithCollection = { ...buildingDef, id: 'sentryTower', collection: 'buildings' };
        const squadData = this.call.getSquadData( buildingDefWithCollection);
        const buildingCells = this.call.getSquadCells( gridPos, squadData) || [];
        const cellStrings = buildingCells.map(cell => `${cell.x},${cell.z}`);

        // Prepare unit type and peasant info
        const unitType = { ...buildingDef, id: 'sentryTower', collection: 'buildings' };
        const peasantInfo = {
            peasantId: action.peasantId,
            buildTime: buildingDef.buildTime || 1
        };

        // Call ui_placeUnit
        this.call.ui_placeUnit( gridPos, unitType, aiTeam, playerId, peasantInfo, (success, response) => {
            // Callback handled silently
        });

        return { success: true, reservedCells: cellStrings };
    }

    /**
     * Find a valid grid position for a sentry tower near the target world position.
     */
    findSentryTowerPosition(aiTeam, targetWorldPos, buildingDef, game, reservedCells = new Set()) {
        // Convert world position to grid position
        const targetGridPos = this.call.worldToPlacementGrid( targetWorldPos.x, targetWorldPos.z);
        if (!targetGridPos) return null;

        // Get building squad data for collision checking
        const buildingDefWithCollection = { ...buildingDef, id: 'sentryTower', collection: 'buildings' };
        const squadData = this.call.getSquadData( buildingDefWithCollection);

        // Search in expanding rings around the target position
        const maxSearchRadius = 10;
        for (let radius = 0; radius <= maxSearchRadius; radius++) {
            for (let dx = -radius; dx <= radius; dx++) {
                for (let dz = -radius; dz <= radius; dz++) {
                    // Only check positions on the current ring's edge
                    if (Math.abs(dx) !== radius && Math.abs(dz) !== radius) continue;

                    const testPos = {
                        x: targetGridPos.x + dx,
                        z: targetGridPos.z + dz
                    };

                    // Check if all cells are available
                    const buildingCells = this.call.getSquadCells( testPos, squadData) || [];
                    let valid = true;

                    for (const cell of buildingCells) {
                        const cellKey = `${cell.x},${cell.z}`;

                        // Check reserved cells from other buildings placed this turn
                        if (reservedCells.has(cellKey)) {
                            valid = false;
                            break;
                        }

                        // Check if cell is already occupied
                        if (this.call.isCellOccupied( cell.x, cell.z)) {
                            valid = false;
                            break;
                        }
                    }

                    if (valid) {
                        return testPos;
                    }
                }
            }
        }

        return null;
    }

    executePurchaseUnit(action, aiTeam, game) {
        // Verify the building still exists and is valid
        const buildingEntityId = action.buildingEntityId;
        const buildingPlacement = game.getComponent(buildingEntityId, 'placement');

        if (!buildingPlacement) {
            return false;
        }

        // Call ui_purchaseUnit
        let purchaseSuccess = false;
        this.call.ui_purchaseUnit( action.unitId, buildingEntityId, aiTeam, (success, response) => {
            purchaseSuccess = success;
        });

        return purchaseSuccess;
    }

    issueMoveOrders(aiState, aiTeam, game, weights) {
        const enums = game.getEnums();
        const enemyTeam = aiTeam === enums.team.left ? enums.team.right : enums.team.left;
        const round = game.state.round || 1;

        // Get all combat unit placements categorized by role
        const { scouts, mainArmy } = this.categorizeUnits(aiTeam, game);

        // Always send scouts toward enemy base to gather intel
        if (scouts.length > 0) {
            const scoutTarget = this.getEnemyBasePosition(enemyTeam, game);
            if (scoutTarget) {
                this.call.ui_issueMoveOrder( scouts, scoutTarget, () => {});
            }
        }

        // Attack wave management - only attack when we have enough units
        const currentArmySize = mainArmy.length;
        const requiredWaveSize = aiState.attackWaveSize || 3;

        // Determine if we should attack
        let shouldAttack = false;
        const roundsSinceLastAttack = round - (aiState.lastAttackRound || 0);

        if (currentArmySize >= requiredWaveSize) {
            // We have enough units for a wave attack
            shouldAttack = true;
        } else if (roundsSinceLastAttack >= 10 && currentArmySize >= 2) {
            // Been too long since last attack, go with what we have
            shouldAttack = true;
        } else if (aiState.isAttacking && currentArmySize >= Math.max(2, Math.floor(requiredWaveSize * 0.5))) {
            // Already attacking - only continue if we still have at least half our wave size
            // This prevents sending reinforcements one at a time
            shouldAttack = true;
        }

        // Reset attack state if army is too depleted - need to rebuild
        // This prevents trickling units one by one after a wave is wiped out
        if (aiState.isAttacking && currentArmySize < Math.max(2, Math.floor(requiredWaveSize * 0.3))) {
            aiState.isAttacking = false;
        }

        // Main army behavior
        if (mainArmy.length > 0 && shouldAttack) {
            let targetPos = null;

            // Try to find enemy buildings to attack (prioritize town hall)
            const enemyTownHall = this.findEnemyTownHall(enemyTeam, game);
            if (enemyTownHall) {
                const townHallTransform = game.getComponent(enemyTownHall, 'transform');
                if (townHallTransform) {
                    targetPos = { x: townHallTransform.position.x, z: townHallTransform.position.z };
                }
            }

            // If no visible town hall, look for any visible enemy building
            if (!targetPos) {
                const enemyBuilding = this.findVisibleEnemyBuilding(aiTeam, enemyTeam, game);
                if (enemyBuilding) {
                    const buildingTransform = game.getComponent(enemyBuilding, 'transform');
                    if (buildingTransform) {
                        targetPos = { x: buildingTransform.position.x, z: buildingTransform.position.z };
                    }
                }
            }

            // If no visible buildings, head toward enemy base
            if (!targetPos) {
                targetPos = this.getEnemyBasePosition(enemyTeam, game);
            }

            if (targetPos) {
                this.call.ui_issueMoveOrder( mainArmy, targetPos, () => {});

                // If we weren't attacking before, this is a new wave - increase next wave size
                if (!aiState.isAttacking) {
                    // Track wave number (how many attacks we've launched)
                    aiState.waveNumber = (aiState.waveNumber || 0) + 1;

                    // Grow wave size by an increasing amount each time
                    // Wave 1: +2-3, Wave 2: +3-4, Wave 3: +4-5, etc.
                    const baseGrowth = 1 + aiState.waveNumber;
                    const waveGrowth = baseGrowth + Math.floor(Math.random() * 2);
                    aiState.attackWaveSize = (aiState.attackWaveSize || 3) + waveGrowth;
                }

                aiState.isAttacking = true;
                aiState.lastAttackRound = round;
            }
        } else if (mainArmy.length > 0 && !shouldAttack) {
            // Rally units at a defensive position while building up
            const rallyPos = this.getDefensiveRallyPoint(aiTeam, game);
            if (rallyPos) {
                this.call.ui_issueMoveOrder( mainArmy, rallyPos, () => {});
            }
            aiState.isAttacking = false;
        }

        // Track units for next decision
        aiState.unitsInWave = currentArmySize;
    }

    /**
     * Get a defensive rally point for units to gather before attacking
     */
    getDefensiveRallyPoint(aiTeam, game) {
        const townHall = this.findTownHall(aiTeam, game);
        if (!townHall) return null;

        const townHallTransform = game.getComponent(townHall, 'transform');
        if (!townHallTransform?.position) return null;

        const basePos = townHallTransform.position;
        const enums = game.getEnums();

        // Rally point is slightly toward the enemy from our base
        const direction = aiTeam === enums.team.left ? 1 : -1;
        return {
            x: basePos.x + direction * 200,
            z: basePos.z
        };
    }

    categorizeUnits(aiTeam, game) {
        const placements = this.call.getPlacementsForSide( aiTeam) || [];
        const scouts = [];
        const mainArmy = [];

        for (const placement of placements) {
            if (!placement.squadUnits || placement.squadUnits.length === 0) continue;

            const entityId = placement.squadUnits[0];
            const unitTypeComp = game.getComponent(entityId, 'unitType');
            const unitDef = this.call.getUnitTypeDef( unitTypeComp);

            // Skip buildings
            if (unitDef?.footprintWidth !== undefined) continue;
            // Skip peasants
            if (unitDef?.id === 'peasant') continue;

            // Fast units or units with high vision are scouts
            const isScout = unitDef?.id?.includes('scout') ||
                           (unitDef?.speed && unitDef.speed >= 150) ||
                           (unitDef?.visionRange && unitDef.visionRange >= 600);

            if (isScout) {
                scouts.push(placement.placementId);
            } else {
                mainArmy.push(placement.placementId);
            }
        }

        return { scouts, mainArmy };
    }

    getEnemyBasePosition(enemyTeam, game) {
        const startingLocations = this.call.getStartingLocationsFromLevel();
        if (!startingLocations) return null;

        const enemyLoc = startingLocations[enemyTeam];
        if (!enemyLoc) return null;

        return this.call.tileToWorld( enemyLoc.x, enemyLoc.z);
    }

    findEnemyTownHall(enemyTeam, game) {
        const entities = game.getEntitiesWith('unitType', 'team', 'placement');

        for (const entityId of entities) {
            const teamComp = game.getComponent(entityId, 'team');
            if (teamComp?.team !== enemyTeam) continue;

            const unitTypeComp = game.getComponent(entityId, 'unitType');
            const unitDef = this.call.getUnitTypeDef( unitTypeComp);

            if (unitDef?.id === 'townHall' || unitDef?.id === 'keep' || unitDef?.id === 'castle') {
                return entityId;
            }
        }

        return null;
    }

    findVisibleEnemyBuilding(aiTeam, enemyTeam, game) {
        // Check what our units can see
        const aiEntities = game.getEntitiesWith('unitType', 'team', 'transform');
        const seenBuildings = new Set();

        for (const viewerEntityId of aiEntities) {
            const viewerTeam = game.getComponent(viewerEntityId, 'team');
            if (viewerTeam?.team !== aiTeam) continue;

            const viewerUnitTypeComp = game.getComponent(viewerEntityId, 'unitType');
            const viewerUnitDef = this.call.getUnitTypeDef( viewerUnitTypeComp);
            const visionRange = viewerUnitDef?.visionRange || 500;

            const visibleEnemyIds = this.call.getVisibleEnemiesInRange( viewerEntityId, visionRange);
            if (!visibleEnemyIds) continue;

            for (const enemyId of visibleEnemyIds) {
                const enemyUnitTypeComp = game.getComponent(enemyId, 'unitType');
                const enemyDef = this.call.getUnitTypeDef( enemyUnitTypeComp);

                // Is it a building?
                if (enemyDef?.footprintWidth !== undefined) {
                    seenBuildings.add(enemyId);
                }
            }
        }

        // Return first visible building (could prioritize by type)
        for (const buildingId of seenBuildings) {
            return buildingId;
        }

        return null;
    }

    getAllUnitPlacementIds(aiTeam, game) {
        const placements = this.call.getPlacementsForSide( aiTeam) || [];
        const placementIds = [];

        for (const placement of placements) {
            if (!placement.squadUnits || placement.squadUnits.length === 0) continue;

            // Check if this is a combat unit (not a building or peasant)
            const entityId = placement.squadUnits[0];
            const unitTypeComp = game.getComponent(entityId, 'unitType');
            const unitDef = this.call.getUnitTypeDef( unitTypeComp);

            // Skip buildings
            if (unitDef?.footprintWidth !== undefined) continue;

            // Skip peasants
            if (unitDef?.id === 'peasant') continue;

            placementIds.push(placement.placementId);
        }

        return placementIds;
    }

    // ==================== Helper Methods (reused from AIExecuteBuildOrderBehaviorAction) ====================

    findAllAvailablePeasants(aiTeam, game) {
        const availablePeasants = [];
        const entities = game.getEntitiesWith('unitType', 'team', 'placement');

        for (const entityId of entities) {
            const teamComp = game.getComponent(entityId, 'team');
            if (teamComp.team !== aiTeam) continue;

            const unitTypeComp = game.getComponent(entityId, 'unitType');
            const unitDef = this.call.getUnitTypeDef( unitTypeComp);
            if (unitDef?.id !== 'peasant') continue;

            // Check if peasant has build ability and is not already building
            const abilities = this.call.getEntityAbilities( entityId);
            if (!abilities) continue;

            const buildAbility = abilities.find(a => a.id === 'BuildAbility');
            if (!buildAbility) continue;

            // Skip if already building
            if (buildAbility.isBuilding || buildAbility.targetBuildingId) continue;

            availablePeasants.push(entityId);
        }

        return availablePeasants;
    }

    findAvailablePeasant(aiTeam, game) {
        const peasants = this.findAllAvailablePeasants(aiTeam, game);
        return peasants.length > 0 ? peasants[0] : null;
    }

    findBuildingPosition(aiTeam, buildingDef, buildingId, game, reservedCells = new Set()) {
        // Find town hall for team
        const townHall = this.findTownHall(aiTeam, game);
        if (!townHall) {
            return null;
        }

        const townHallPlacement = game.getComponent(townHall, 'placement');
        const townHallGridPos = townHallPlacement?.gridPosition;
        if (!townHallGridPos) {
            return null;
        }

        // Get town hall cells to avoid
        const townHallUnitType = game.getComponent(townHall, 'unitType');
        const townHallDef = this.call.getUnitTypeDef( townHallUnitType);
        const townHallSquadData = this.call.getSquadData( townHallDef);
        const townHallCells = this.call.getSquadCells( townHallGridPos, townHallSquadData);
        const occupiedCellSet = new Set(townHallCells.map(cell => `${cell.x},${cell.z}`));

        // Add reserved cells (from other buildings being placed this turn) to occupied set
        for (const cell of reservedCells) {
            occupiedCellSet.add(cell);
        }

        // Find adjacent position for new building
        const enums = game.getEnums();
        const startingLocations = this.call.getStartingLocationsFromLevel();

        let preferredDirX = 0;
        let preferredDirZ = 0;

        if (startingLocations) {
            const leftLoc = startingLocations[enums.team.left];
            const rightLoc = startingLocations[enums.team.right];

            if (leftLoc && rightLoc) {
                const centerX = (leftLoc.x + rightLoc.x) / 2;
                const centerZ = (leftLoc.z + rightLoc.z) / 2;

                const myLoc = aiTeam === enums.team.left ? leftLoc : rightLoc;
                preferredDirX = Math.sign(centerX - myLoc.x);
                preferredDirZ = Math.sign(centerZ - myLoc.z);
            }
        }

        const buildingWorldPos = this.call.placementGridToWorld( townHallGridPos.x, townHallGridPos.z);
        const targetWorldPos = {
            x: buildingWorldPos.x + preferredDirX * 1000,
            z: buildingWorldPos.z + preferredDirZ * 1000
        };

        const buildingDefWithCollection = { ...buildingDef, id: buildingId, collection: 'buildings' };

        return this.call.findBuildingAdjacentPosition( townHallGridPos, occupiedCellSet, buildingDefWithCollection, targetWorldPos);
    }

    findTownHall(aiTeam, game) {
        const entities = game.getEntitiesWith('unitType', 'team', 'placement');

        for (const entityId of entities) {
            const teamComp = game.getComponent(entityId, 'team');
            if (teamComp.team !== aiTeam) continue;

            const unitTypeComp = game.getComponent(entityId, 'unitType');
            const unitDef = this.call.getUnitTypeDef( unitTypeComp);

            if (unitDef?.id === 'townHall' || unitDef?.id === 'keep' || unitDef?.id === 'castle') {
                return entityId;
            }
        }

        return null;
    }

    findBuildingByType(buildingType, aiTeam, game) {
        const entities = game.getEntitiesWith('unitType', 'team', 'placement');

        for (const entityId of entities) {
            const teamComp = game.getComponent(entityId, 'team');
            if (teamComp.team !== aiTeam) continue;

            const placement = game.getComponent(entityId, 'placement');
            // Skip buildings under construction
            if (placement?.isUnderConstruction) continue;

            const unitTypeComp = game.getComponent(entityId, 'unitType');
            const unitDef = this.call.getUnitTypeDef( unitTypeComp);

            if (unitDef?.id === buildingType) {
                return entityId;
            }
        }

        return null;
    }

    resolveTarget(target, aiTeam, game) {
        const enums = game.getEnums();

        if (target === 'center') {
            return { x: 0, z: 0 };
        }

        if (target === 'enemy') {
            const startingLocations = this.call.getStartingLocationsFromLevel();
            if (!startingLocations) return null;

            const enemyTeam = aiTeam === enums.team.left ? enums.team.right : enums.team.left;
            const enemyLoc = startingLocations[enemyTeam];
            if (!enemyLoc) return null;

            return this.call.tileToWorld( enemyLoc.x, enemyLoc.z);
        }

        // If target is an object with x/z, use it directly
        if (typeof target === 'object' && target.x !== undefined && target.z !== undefined) {
            return target;
        }

        return null;
    }

    // ==================== Tech Upgrade Methods ====================

    /**
     * Score town hall upgrade actions (townHall -> keep -> castle)
     * Upgrading unlocks advanced units like ballista (requires keep)
     */
    scoreTownHallUpgradeActions(aiState, gold, aiTeam, game, collections) {
        const actions = [];

        // Find our town hall/keep/castle
        const townHallEntity = this.findTownHall(aiTeam, game);
        if (!townHallEntity) return actions;

        const unitTypeComp = game.getComponent(townHallEntity, 'unitType');
        const currentBuildingDef = this.call.getUnitTypeDef( unitTypeComp);
        const currentBuildingId = currentBuildingDef?.id;

        // Check if there's an upgrade available
        const upgradesToBuilding = currentBuildingDef?.upgradesToBuilding;
        if (!upgradesToBuilding) return actions;

        const upgradeBuildingDef = collections.buildings?.[upgradesToBuilding];
        if (!upgradeBuildingDef) return actions;

        const upgradeCost = upgradeBuildingDef.value || 100;
        if (upgradeCost > gold) return actions;

        // Get placement info
        const placement = game.getComponent(townHallEntity, 'placement');
        if (!placement) return actions;

        // Score the upgrade based on game state
        let score = 0;
        const round = game.state.round || 1;

        // Count owned production buildings
        const ownedProductionBuildings = Object.keys(aiState.ownBuildings || {}).filter(
            b => ['barracks', 'fletchersHall', 'mageTower'].includes(b)
        ).length;

        // Only consider upgrade after we have at least 2 production buildings
        if (ownedProductionBuildings >= 2) {
            // Base score increases with round
            if (round >= 5) {
                score = 35; // Medium priority after round 5
            }
            if (round >= 8) {
                score = 55; // Higher priority after round 8
            }
            if (round >= 12) {
                score = 75; // High priority late game
            }

            // Bonus if upgrading to keep (unlocks ballista)
            if (upgradesToBuilding === 'keep') {
                score += 10;
            }

            // Bonus if upgrading to castle (unlocks dragons eventually)
            if (upgradesToBuilding === 'castle') {
                score += 15;
            }
        }

        if (score > 0) {
            actions.push({
                type: 'UPGRADE_TOWNHALL',
                buildingEntityId: townHallEntity,
                placementId: placement.placementId,
                targetBuildingId: upgradesToBuilding,
                score: score,
                goldCost: upgradeCost,
                supplyCost: 0
            });
        }

        return actions;
    }

    /**
     * Score technology upgrade purchases
     */
    scoreTechUpgradeActions(aiState, gold, aiTeam, playerId, game, collections) {
        const actions = [];
        const upgrades = collections.upgrades;
        if (!upgrades) return actions;

        // Get player's already purchased upgrades
        const playerEntity = this.findPlayerEntity(aiTeam, game);
        const playerStats = playerEntity ? game.getComponent(playerEntity, 'player') : null;
        const ownedUpgrades = playerStats?.upgrades || [];

        // Find a reference building for this team (used by server to verify team ownership)
        const townHall = this.findTownHall(aiTeam, game);

        for (const [upgradeId, upgradeDef] of Object.entries(upgrades)) {
            // Skip if already owned
            if (ownedUpgrades.includes(upgradeId)) continue;

            const cost = upgradeDef.value || 100;
            if (cost > gold) continue;

            // Check building requirements
            const requiredBuildings = upgradeDef.requiresBuildings || [];
            let hasRequirements = true;
            for (const req of requiredBuildings) {
                if (req === 'keep') {
                    if (!aiState.ownBuildings?.keep && !aiState.ownBuildings?.castle) {
                        hasRequirements = false;
                        break;
                    }
                } else if (req === 'castle') {
                    if (!aiState.ownBuildings?.castle) {
                        hasRequirements = false;
                        break;
                    }
                } else if (!aiState.ownBuildings?.[req]) {
                    hasRequirements = false;
                    break;
                }
            }
            if (!hasRequirements) continue;

            let score = 20; // Base score for upgrades

            // Bonus for spell damage if we have mages
            if (upgradeId === 'spellDamage') {
                const mageCount = (aiState.ownUnits?.['1_i_apprentice'] || 0) +
                                  (aiState.ownUnits?.['1_is_acolyte'] || 0);
                if (mageCount >= 2) {
                    score += mageCount * 5;
                }
            }

            // Peasant efficiency is good for economy
            if (upgradeId === 'peasantEfficiency') {
                score += 15;
            }

            actions.push({
                type: 'PURCHASE_UPGRADE',
                upgradeId: upgradeId,
                referenceBuildingId: townHall, // Used by server to determine team
                score: score,
                goldCost: cost,
                supplyCost: 0
            });
        }

        return actions;
    }

    /**
     * Score unit level up and specialization actions
     */
    scoreLevelUpActions(aiState, gold, aiTeam, game, collections) {
        const actions = [];

        // Get all squads for this team
        const placements = this.call.getPlacementsForSide( aiTeam) || [];

        for (const placement of placements) {
            if (!placement.squadUnits || placement.squadUnits.length === 0) continue;

            const entityId = placement.squadUnits[0];
            const unitTypeComp = game.getComponent(entityId, 'unitType');
            const unitDef = this.call.getUnitTypeDef( unitTypeComp);

            // Skip buildings and peasants
            if (unitDef?.footprintWidth !== undefined) continue;
            if (unitDef?.id === 'peasant') continue;

            // Get squad data
            const squadData = game.squadExperienceSystem?.getSquadExperience?.(placement.placementId);
            if (!squadData) continue;

            // Check if can level up
            const levelUpCost = this.call.getLevelUpCost( placement.placementId);
            if (levelUpCost < 0 || levelUpCost > gold) continue;

            let score = 25; // Base score for leveling up

            // Higher score for experienced units (more XP = more value to level)
            const xpProgress = squadData.currentXp / (squadData.xpToNextLevel || 100);
            score += xpProgress * 10;

            // Bonus for units with specializations available
            const specializations = unitDef?.specUnits || [];
            if (squadData.level === 1 && specializations.length > 0) {
                score += 40; // High priority - specialization is a major power spike
            }

            // Choose best specialization if at level 2
            let specializationId = null;
            if (squadData.level >= 1 && specializations.length > 0 && squadData.canLevelUp) {
                specializationId = this.chooseBestSpecialization(specializations, aiState, collections);
            }

            actions.push({
                type: 'LEVEL_UP_SQUAD',
                placementId: placement.placementId,
                specializationId: specializationId,
                score: score,
                goldCost: levelUpCost,
                supplyCost: 0
            });
        }

        return actions;
    }

    /**
     * Score sentry tower placements for base defense.
     * AI builds 1-2 sentry towers near the nearest ramp to defend their base.
     */
    scoreSentryTowerActions(aiState, gold, aiTeam, playerId, game, collections) {
        const actions = [];

        // Check if sentry tower exists in collections
        const sentryTowerDef = collections.buildings?.sentryTower;
        if (!sentryTowerDef) return actions;

        const cost = sentryTowerDef.value || 50;
        if (cost > gold) return actions;

        // Limit to 2 sentry towers
        const currentSentryCount = aiState.ownBuildings?.sentryTower || 0;
        const maxSentryTowers = 2;
        if (currentSentryCount >= maxSentryTowers) return actions;

        // Find available peasants
        const availablePeasants = this.findAllAvailablePeasants(aiTeam, game);
        if (availablePeasants.length === 0) return actions;

        // Find the nearest ramp to our base
        const rampPosition = this.findNearestRamp(aiTeam, game);
        if (!rampPosition) return actions;

        // Calculate score based on game state
        const round = game.state.round || 1;
        let score = 0;

        // Build first sentry tower early to defend against rushes
        // Higher priority than most units to ensure defensive coverage
        if (round >= 2 && currentSentryCount === 0) {
            score = 65; // First sentry tower - high priority for early defense
        } else if (round >= 4 && currentSentryCount === 1) {
            score = 50; // Second sentry tower for better coverage
        }

        if (score > 0) {
            actions.push({
                type: 'PLACE_SENTRY_TOWER',
                buildingId: 'sentryTower',
                peasantId: availablePeasants[0],
                rampPosition: rampPosition,
                score: score,
                goldCost: cost,
                supplyCost: 0
            });
        }

        return actions;
    }

    /**
     * Find the nearest ramp position to the AI's base.
     * Returns a world position near the ramp for defensive placement.
     */
    findNearestRamp(aiTeam, game) {
        // Get town hall position as base reference
        const townHall = this.findTownHall(aiTeam, game);
        if (!townHall) return null;

        const townHallTransform = game.getComponent(townHall, 'transform');
        if (!townHallTransform?.position) return null;

        const basePos = townHallTransform.position;

        // Get ramp positions from the level
        const ramps = this.call.getRampPositions();
        if (!ramps || ramps.length === 0) {
            // No ramps defined - place defensively between base and center
            const enums = game.getEnums();
            const direction = aiTeam === enums.team.left ? 1 : -1;
            return {
                x: basePos.x + direction * 300,
                z: basePos.z
            };
        }

        // Find closest ramp to our base
        let closestRamp = null;
        let closestDist = Infinity;

        for (const ramp of ramps) {
            const dx = ramp.x - basePos.x;
            const dz = ramp.z - basePos.z;
            const dist = Math.sqrt(dx * dx + dz * dz);

            if (dist < closestDist) {
                closestDist = dist;
                closestRamp = ramp;
            }
        }

        if (!closestRamp) return null;

        // Position the sentry tower between base and ramp, closer to ramp
        const dx = closestRamp.x - basePos.x;
        const dz = closestRamp.z - basePos.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        // Place at 70% of the way to the ramp
        const ratio = 0.7;
        return {
            x: basePos.x + dx * ratio,
            z: basePos.z + dz * ratio
        };
    }

    /**
     * Choose the best specialization for a unit based on current army composition,
     * enemy composition, and ability power.
     */
    chooseBestSpecialization(specializations, aiState, collections) {
        if (!specializations || specializations.length === 0) return null;

        const counters = collections.aiConfig?.counters;
        let bestSpec = null;
        let bestScore = -Infinity;

        for (const specId of specializations) {
            const specDef = collections.units?.[specId];
            if (!specDef) continue;

            let score = 0;

            // Base combat power score
            const combatPower = this.calculateUnitPower(specDef);
            score += combatPower * 0.5;

            // Ability bonus - units with abilities are more valuable
            const abilities = specDef.abilities || [];
            if (abilities.length > 0) {
                score += 20 * abilities.length;

                // Bonus for powerful AoE abilities
                for (const abilityName of abilities) {
                    if (abilityName.includes('Chain') || abilityName.includes('Meteor') ||
                        abilityName.includes('Raise') || abilityName.includes('Mind')) {
                        score += 15; // Strong abilities
                    }
                    if (abilityName.includes('Summon') || abilityName.includes('Trap')) {
                        score += 10; // Utility abilities
                    }
                    if (abilityName.includes('Heal') || abilityName.includes('Buff') ||
                        abilityName.includes('Cry') || abilityName.includes('Aura')) {
                        score += 12; // Support abilities
                    }
                }
            }

            // Counter score - does this spec counter visible enemies?
            if (counters?.units?.[specId] && aiState.visibleEnemyUnits) {
                const unitInfo = counters.units[specId];
                for (const [enemyType, count] of Object.entries(aiState.visibleEnemyUnits)) {
                    if (unitInfo.strongAgainst?.includes(enemyType)) {
                        score += count * 8;
                    }
                    if (unitInfo.weakAgainst?.includes(enemyType)) {
                        score -= count * 4;
                    }
                }
            }

            // Army composition balance - prefer specs we don't have many of
            const currentCount = aiState.ownUnits?.[specId] || 0;
            if (currentCount === 0) {
                score += 15; // Encourage diversity
            } else if (currentCount >= 3) {
                score -= 10; // Discourage too many of same spec
            }

            // Ranged vs melee balance
            const isRanged = (specDef.range && specDef.range > 50) || specDef.projectile;
            const totalRanged = Object.entries(aiState.ownUnits || {})
                .filter(([id, _]) => {
                    const def = collections.units?.[id];
                    return def && ((def.range && def.range > 50) || def.projectile);
                })
                .reduce((sum, [_, count]) => sum + count, 0);
            const totalMelee = Object.entries(aiState.ownUnits || {})
                .filter(([id, _]) => {
                    const def = collections.units?.[id];
                    return def && (!def.range || def.range <= 50) && !def.projectile;
                })
                .reduce((sum, [_, count]) => sum + count, 0);

            // Prefer to balance ranged/melee ratio (aim for ~40% ranged)
            if (isRanged && totalRanged < totalMelee * 0.6) {
                score += 10; // Need more ranged
            } else if (!isRanged && totalMelee < totalRanged * 1.5) {
                score += 10; // Need more melee
            }

            // Cost efficiency - prefer better value specs
            const cost = specDef.value || 100;
            const efficiency = combatPower / Math.max(cost, 1);
            score += efficiency * 5;

            if (score > bestScore) {
                bestScore = score;
                bestSpec = specId;
            }
        }

        return bestSpec;
    }

    /**
     * Execute town hall upgrade
     */
    executeUpgradeTownHall(action, aiTeam, game) {
        this.call.upgradeBuildingRequest( {
            buildingEntityId: action.buildingEntityId,
            placementId: action.placementId,
            targetBuildingId: action.targetBuildingId
        }, (success, response) => {
            // Callback handled silently
        });
        return true;
    }

    /**
     * Execute technology upgrade purchase
     */
    executePurchaseUpgrade(action, aiTeam, game) {
        this.call.purchaseUpgrade( {
            upgradeId: action.upgradeId,
            referenceBuildingId: action.referenceBuildingId // Server derives team from this
        }, (success, response) => {
            // Callback handled silently
        });
        return true;
    }

    /**
     * Execute squad level up
     */
    executeLevelUpSquad(action, aiTeam, game) {
        this.call.levelSquad( {
            placementId: action.placementId,
            specializationId: action.specializationId
        }, (success, response) => {
            // Callback handled silently
        });
        return true;
    }

    /**
     * Find player entity for a team
     */
    findPlayerEntity(aiTeam, game) {
        const playerEntities = game.getEntitiesWith('player', 'team');
        for (const entityId of playerEntities) {
            const teamComp = game.getComponent(entityId, 'team');
            if (teamComp?.team === aiTeam) {
                return entityId;
            }
        }
        return null;
    }
}
