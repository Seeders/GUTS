/**
 * AIAnalyzeGameStateBehaviorAction - Gathers game state information for heuristic AI
 *
 * Collects:
 * - Own gold and supply
 * - Own buildings and units
 * - Visible enemy units (respecting fog of war via VisionSystem)
 * - Visible enemy buildings
 *
 * Stores all findings in the aiHeuristicState component for use by other AI actions.
 */
class AIAnalyzeGameStateBehaviorAction extends GUTS.BaseBehaviorAction {

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

        const enums = game.call('getEnums');
        const collections = game.getCollections();
        const round = game.state.round || 1;

        // Skip if already analyzed this round
        if (aiState.lastAnalyzedRound === round) {
            return this.success();
        }

        // Get own resources
        const playerId = aiTeam === enums.team.left ? 0 : 1;
        const playerStats = this.getPlayerStats(playerId, game);
        aiState.gold = playerStats?.gold || 0;

        // Get own supply info
        const supplyInfo = this.getSupplyInfo(aiTeam, game);
        aiState.supplyUsed = supplyInfo.used;
        aiState.supplyMax = supplyInfo.max;
        aiState.supplyAvailable = supplyInfo.max - supplyInfo.used;

        // Get own buildings and units
        const ownAssets = this.getOwnAssets(aiTeam, game, collections);
        aiState.ownBuildings = ownAssets.buildings;
        aiState.ownUnits = ownAssets.units;
        aiState.ownArmyPower = ownAssets.armyPower;

        // Get visible enemy information (respecting fog of war)
        const enemyTeam = aiTeam === enums.team.left ? enums.team.right : enums.team.left;
        const visibleEnemyInfo = this.getVisibleEnemyInfo(aiTeam, enemyTeam, game, collections);
        aiState.visibleEnemyUnits = visibleEnemyInfo.units;
        aiState.visibleEnemyBuildings = visibleEnemyInfo.buildings;
        aiState.estimatedEnemyPower = visibleEnemyInfo.estimatedPower;

        // Pick a focus unit once per game (adds variety between AI players)
        // Use team-based seed so each AI gets a different strategy
        if (!aiState.focusUnitId) {
            const focusChoice = this.pickRandomFocusUnit(collections, aiTeam, game);
            aiState.focusUnitId = focusChoice.unitId;
            aiState.focusBuildingId = focusChoice.buildingId;

            // Initialize attack wave size (starts small, grows over game)
            aiState.attackWaveSize = 3;
            aiState.lastAttackRound = 0;
            aiState.unitsInWave = 0;
            aiState.isAttacking = false;
            aiState.waveNumber = 0;
        }

        aiState.lastAnalyzedRound = round;

        return this.success();
    }

    /**
     * Pick a random combat unit to focus on for army composition variety.
     * Uses team-based seeding so different AIs get different strategies.
     * Returns the unit ID and the building that produces it.
     */
    pickRandomFocusUnit(collections, aiTeam, game) {
        // List of combat units and their production buildings
        const focusOptions = [
            { unitId: '1_s_barbarian', buildingId: 'barracks' },
            { unitId: '1_sd_soldier', buildingId: 'barracks' },
            { unitId: '1_d_archer', buildingId: 'fletchersHall' },
            { unitId: '1_di_scout', buildingId: 'fletchersHall' },
            { unitId: '1_i_apprentice', buildingId: 'mageTower' },
            { unitId: '1_is_acolyte', buildingId: 'mageTower' }
        ];

        // Filter to only valid units that exist in collections
        const validOptions = focusOptions.filter(opt =>
            collections.units?.[opt.unitId] && collections.buildings?.[opt.buildingId]
        );

        if (validOptions.length === 0) {
            return { unitId: null, buildingId: null };
        }

        // Use team-based random selection so each AI picks independently
        // Combine game seed with team to get unique randomness per AI
        const gameSeed = game.state?.gameSeed || Date.now();
        const teamSeed = gameSeed + (aiTeam * 12345);

        // Simple seeded random using the team seed
        const seededRandom = this.seededRandom(teamSeed);
        const randomIndex = Math.floor(seededRandom * validOptions.length);

        return validOptions[randomIndex];
    }

    /**
     * Generate a seeded random number between 0 and 1
     */
    seededRandom(seed) {
        // Simple mulberry32 PRNG
        let t = seed + 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }

    getPlayerStats(playerId, game) {
        const entities = game.getEntitiesWith('playerStats');
        for (const entityId of entities) {
            const stats = game.getComponent(entityId, 'playerStats');
            if (stats?.playerId === playerId) {
                return stats;
            }
        }
        return null;
    }

    getSupplyInfo(aiTeam, game) {
        // Use the game's SupplySystem services for accurate, dynamic supply tracking
        // This properly accounts for dead units and reflects current ECS state
        const max = game.call('getCurrentSupply', aiTeam) || 0;
        const used = game.call('getCurrentPopulation', aiTeam) || 0;

        return { used, max };
    }

    getOwnAssets(aiTeam, game, collections) {
        const buildings = {};  // buildingType -> count
        const units = {};      // unitType -> count
        let armyPower = 0;

        const enums = game.call('getEnums');
        const entities = game.getEntitiesWith('unitType', 'team', 'placement');
        for (const entityId of entities) {
            const teamComp = game.getComponent(entityId, 'team');
            if (teamComp?.team !== aiTeam) continue;

            // Skip dead or dying units (same check as SupplySystem)
            const health = game.getComponent(entityId, 'health');
            if (health && health.current <= 0) continue;

            const deathState = game.getComponent(entityId, 'deathState');
            if (deathState && deathState.state !== enums.deathState.alive) continue;

            const placement = game.getComponent(entityId, 'placement');
            if (placement?.isUnderConstruction) continue;

            const unitTypeComp = game.getComponent(entityId, 'unitType');
            const unitDef = game.call('getUnitTypeDef', unitTypeComp);
            if (!unitDef) continue;

            const unitId = unitDef.id;
            const isBuilding = unitDef.footprintWidth !== undefined;

            if (isBuilding) {
                buildings[unitId] = (buildings[unitId] || 0) + 1;
            } else {
                units[unitId] = (units[unitId] || 0) + 1;
                // Only count combat units toward army power (not peasants)
                if (unitId !== 'peasant') {
                    armyPower += this.calculateUnitPower(unitDef);
                }
            }
        }

        return { buildings, units, armyPower };
    }

    getVisibleEnemyInfo(aiTeam, enemyTeam, game, collections) {
        const units = {};      // unitType -> count
        const buildings = [];  // list of building types
        let estimatedPower = 0;
        const seenEntities = new Set();

        // Get all AI units to use as vision sources
        const aiEntities = game.getEntitiesWith('unitType', 'team', 'transform');

        for (const viewerEntityId of aiEntities) {
            const viewerTeam = game.getComponent(viewerEntityId, 'team');
            if (viewerTeam?.team !== aiTeam) continue;

            const viewerUnitTypeComp = game.getComponent(viewerEntityId, 'unitType');
            const viewerUnitDef = game.call('getUnitTypeDef', viewerUnitTypeComp);
            const visionRange = viewerUnitDef?.visionRange || 500;

            // Use VisionSystem to get visible enemies (respects fog of war, stealth, LOS)
            const visibleEnemyIds = game.call('getVisibleEnemiesInRange', viewerEntityId, visionRange);
            if (!visibleEnemyIds) continue;

            for (const enemyId of visibleEnemyIds) {
                if (seenEntities.has(enemyId)) continue;
                seenEntities.add(enemyId);

                const enemyUnitTypeComp = game.getComponent(enemyId, 'unitType');
                const enemyDef = game.call('getUnitTypeDef', enemyUnitTypeComp);
                if (!enemyDef) continue;

                const enemyType = enemyDef.id;
                const isBuilding = enemyDef.footprintWidth !== undefined;

                if (isBuilding) {
                    if (!buildings.includes(enemyType)) {
                        buildings.push(enemyType);
                    }
                } else {
                    units[enemyType] = (units[enemyType] || 0) + 1;
                    estimatedPower += this.calculateUnitPower(enemyDef);
                }
            }
        }

        return { units, buildings, estimatedPower };
    }

    calculateUnitPower(unitDef) {
        // Simple power calculation based on unit stats
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
}
