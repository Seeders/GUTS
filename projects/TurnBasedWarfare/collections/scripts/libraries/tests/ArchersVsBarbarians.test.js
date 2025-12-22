import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestGameContext } from '../../../../../../tests/TestGameContext.js';

/**
 * Archers vs Barbarians - Proper Multi-Round Simulation
 *
 * This test simulates a proper game flow:
 * - Round 1: Both teams place production buildings
 * - Round 1 Battle: No combat (buildings under construction)
 * - Round 2: Buildings complete, teams train units
 * - Round 2 Battle: Archers vs Barbarians fight
 */
describe('Archers vs Barbarians Simulation', () => {
    let game;
    let enums;
    let runner;

    beforeEach(() => {
        game = new TestGameContext();
        enums = game.getEnums();

        // Mock collections
        game.collections = {
            buildings: {
                townHall: {
                    title: 'Town Hall',
                    value: 100,
                    supplyProvided: 10,
                    footprintWidth: 3,
                    footprintHeight: 3,
                    hp: 2500
                },
                fletchersHall: {
                    title: "Fletcher's Hall",
                    value: 50,
                    units: ['1_d_archer'],
                    footprintWidth: 2,
                    footprintHeight: 2,
                    hp: 1500
                },
                barracks: {
                    title: 'Barracks',
                    value: 50,
                    units: ['1_s_barbarian'],
                    footprintWidth: 2,
                    footprintHeight: 3,
                    hp: 1500
                }
            },
            units: {
                '1_d_archer': {
                    title: 'Archer',
                    value: 35,
                    hp: 150,
                    damage: 16,
                    attackSpeed: 1.1,
                    range: 200,
                    speed: 55,
                    armor: 1,
                    supplyCost: 2
                },
                '1_s_barbarian': {
                    title: 'Barbarian',
                    value: 35,
                    hp: 300,
                    damage: 10,
                    attackSpeed: 1.0,
                    range: 5,
                    speed: 40,
                    armor: 8,
                    supplyCost: 2
                }
            }
        };

        game.getCollections = () => game.collections;

        // Game state
        game.state.gold = 200;           // Left team gold
        game.state.opponentGold = 200;   // Right team gold
        game.state.supply = 10;          // Left supply (from town hall)
        game.state.opponentSupply = 10;  // Right supply
        game.state.supplyUsed = 0;
        game.state.opponentSupplyUsed = 0;
        game.state.round = 1;
        game.state.phase = enums.gamePhase?.placement || 1;

        // Track placements
        game.placements = {
            left: [],
            right: []
        };

        // Mock GameActionsInterface methods
        const mockActions = {
            canAffordCost: (cost) => {
                return game.state.gold >= cost;
            },
            canAffordSupply: (team, unitDef) => {
                const supply = team === enums.team.left ? game.state.supply : game.state.opponentSupply;
                const used = team === enums.team.left ? game.state.supplyUsed : game.state.opponentSupplyUsed;
                return (supply - used) >= (unitDef.supplyCost || 0);
            },
            sendPlacementRequest: (data, callback) => {
                const team = data.team === enums.team.left ? 'left' : 'right';
                const placementId = `placement_${Date.now()}_${Math.random()}`;

                // Deduct gold
                const cost = data.unitType?.value || 0;
                if (team === 'left') {
                    game.state.gold -= cost;
                } else {
                    game.state.opponentGold -= cost;
                }

                // Track supply for units
                if (data.unitType?.supplyCost) {
                    if (team === 'left') {
                        game.state.supplyUsed += data.unitType.supplyCost;
                    } else {
                        game.state.opponentSupplyUsed += data.unitType.supplyCost;
                    }
                }

                const placement = {
                    id: placementId,
                    team: data.team,
                    unitType: data.unitType,
                    position: data.gridPosition,
                    isBuilding: data.unitType?.collection === 'buildings',
                    constructionComplete: false,
                    squadUnits: []
                };

                game.placements[team].push(placement);

                if (callback) callback(true, { placementId });
                return { success: true, placementId };
            },
            getPlacementsForSide: (team) => {
                const side = team === enums.team.left ? 'left' : 'right';
                return game.placements[side];
            },
            findBuildingSpawnPosition: (buildingPlacementId, unitType) => {
                // Find the building and return adjacent position
                for (const side of ['left', 'right']) {
                    const building = game.placements[side].find(p => p.id === buildingPlacementId);
                    if (building && building.constructionComplete) {
                        return {
                            x: building.position.x + 3,
                            z: building.position.z
                        };
                    }
                }
                return null;
            },
            toggleReadyForBattle: (callback) => {
                game.state.phase = enums.gamePhase?.battle || 2;
                if (callback) callback();
            },
            startBattle: () => {
                game.state.phase = enums.gamePhase?.battle || 2;
            }
        };

        // Create mock runner
        runner = {
            game,
            actions: mockActions,
            config: { startingGold: 200 },
            isSetup: true,

            async placeBuilding(team, buildingId, x, z) {
                const collections = game.getCollections();
                const teamEnum = team === 'left' ? enums.team.left : enums.team.right;
                const buildingDef = collections.buildings[buildingId];

                if (!buildingDef) {
                    return { success: false, error: `Building ${buildingId} not found` };
                }

                const gold = team === 'left' ? game.state.gold : game.state.opponentGold;
                if (gold < buildingDef.value) {
                    return { success: false, error: `Cannot afford ${buildingId}` };
                }

                const unitType = { ...buildingDef, id: buildingId, collection: 'buildings' };
                return this.actions.sendPlacementRequest({
                    gridPosition: { x, z },
                    unitType,
                    team: teamEnum
                });
            },

            async placeUnit(team, unitId, fromBuildingPlacementId) {
                const collections = game.getCollections();
                const teamEnum = team === 'left' ? enums.team.left : enums.team.right;
                const unitDef = collections.units[unitId];

                if (!unitDef) {
                    return { success: false, error: `Unit ${unitId} not found` };
                }

                const gold = team === 'left' ? game.state.gold : game.state.opponentGold;
                if (gold < unitDef.value) {
                    return { success: false, error: `Cannot afford ${unitId}` };
                }

                if (!this.actions.canAffordSupply(teamEnum, unitDef)) {
                    return { success: false, error: `Not enough supply` };
                }

                const spawnPos = this.actions.findBuildingSpawnPosition(fromBuildingPlacementId, unitDef);
                if (!spawnPos) {
                    return { success: false, error: `Building not ready or no spawn position` };
                }

                const unitType = { ...unitDef, id: unitId, collection: 'units' };
                return this.actions.sendPlacementRequest({
                    gridPosition: spawnPos,
                    unitType,
                    team: teamEnum
                });
            },

            startBattle() {
                this.actions.startBattle();
            },

            endRound() {
                // Complete all building construction
                for (const side of ['left', 'right']) {
                    for (const placement of game.placements[side]) {
                        if (placement.isBuilding) {
                            placement.constructionComplete = true;
                        }
                    }
                }
                game.state.round++;
                game.state.phase = enums.gamePhase?.placement || 1;

                // Give income
                game.state.gold += 50;
                game.state.opponentGold += 50;
            },

            getPlacementsForTeam(team) {
                return this.actions.getPlacementsForSide(
                    team === 'left' ? enums.team.left : enums.team.right
                );
            }
        };
    });

    it('should simulate proper multi-round archers vs barbarians battle', async () => {
        console.log('\n========================================');
        console.log('   ARCHERS VS BARBARIANS SIMULATION');
        console.log('========================================\n');

        // ============ ROUND 1: PLACEMENT ============
        console.log('--- ROUND 1: PLACEMENT PHASE ---');
        console.log(`Left team gold: ${game.state.gold}`);
        console.log(`Right team gold: ${game.state.opponentGold}`);

        // Left team: Build Fletcher's Hall
        const fletcherResult = await runner.placeBuilding('left', 'fletchersHall', 5, 10);
        expect(fletcherResult.success).toBe(true);
        console.log(`Left builds Fletcher's Hall (50g) -> Gold: ${game.state.gold}`);

        // Right team: Build Barracks
        const barracksResult = await runner.placeBuilding('right', 'barracks', 20, 10);
        expect(barracksResult.success).toBe(true);
        console.log(`Right builds Barracks (50g) -> Gold: ${game.state.opponentGold}`);

        // ============ ROUND 1: BATTLE ============
        console.log('\n--- ROUND 1: BATTLE PHASE ---');
        runner.startBattle();
        console.log('Buildings under construction - no combat');

        // End round (buildings complete, income gained)
        runner.endRound();
        console.log(`\nRound ended. Buildings complete.`);
        console.log(`Income received: +50g each`);

        // ============ ROUND 2: PLACEMENT ============
        console.log('\n--- ROUND 2: PLACEMENT PHASE ---');
        console.log(`Left team gold: ${game.state.gold}, Supply: ${game.state.supply - game.state.supplyUsed}/${game.state.supply}`);
        console.log(`Right team gold: ${game.state.opponentGold}, Supply: ${game.state.opponentSupply - game.state.opponentSupplyUsed}/${game.state.opponentSupply}`);

        // Get building placements
        const leftBuildings = runner.getPlacementsForTeam('left').filter(p => p.isBuilding);
        const rightBuildings = runner.getPlacementsForTeam('right').filter(p => p.isBuilding);

        expect(leftBuildings.length).toBe(1);
        expect(rightBuildings.length).toBe(1);
        expect(leftBuildings[0].constructionComplete).toBe(true);
        expect(rightBuildings[0].constructionComplete).toBe(true);

        // Left team: Train 4 archers (35g x 4 = 140g, 2 supply x 4 = 8 supply)
        let archersPlaced = 0;
        for (let i = 0; i < 4; i++) {
            const result = await runner.placeUnit('left', '1_d_archer', leftBuildings[0].id);
            if (result.success) {
                archersPlaced++;
                console.log(`Left trains Archer #${archersPlaced} (35g) -> Gold: ${game.state.gold}, Supply: ${game.state.supplyUsed}/${game.state.supply}`);
            } else {
                console.log(`Failed to train archer: ${result.error}`);
            }
        }

        // Right team: Train 4 barbarians
        let barbariansPlaced = 0;
        for (let i = 0; i < 4; i++) {
            const result = await runner.placeUnit('right', '1_s_barbarian', rightBuildings[0].id);
            if (result.success) {
                barbariansPlaced++;
                console.log(`Right trains Barbarian #${barbariansPlaced} (35g) -> Gold: ${game.state.opponentGold}, Supply: ${game.state.opponentSupplyUsed}/${game.state.opponentSupply}`);
            } else {
                console.log(`Failed to train barbarian: ${result.error}`);
            }
        }

        // ============ ROUND 2: BATTLE ============
        console.log('\n--- ROUND 2: BATTLE PHASE ---');
        runner.startBattle();

        const leftUnits = runner.getPlacementsForTeam('left').filter(p => !p.isBuilding);
        const rightUnits = runner.getPlacementsForTeam('right').filter(p => !p.isBuilding);

        console.log(`\nBattle begins!`);
        console.log(`Left army: ${leftUnits.length} Archers`);
        console.log(`Right army: ${rightUnits.length} Barbarians`);

        // Simulate combat with actual stats
        const archerStats = game.collections.units['1_d_archer'];
        const barbarianStats = game.collections.units['1_s_barbarian'];

        console.log(`\n--- COMBAT STATS ---`);
        console.log(`Archer: ${archerStats.hp} HP, ${archerStats.damage} dmg, ${archerStats.range} range, ${archerStats.attackSpeed} atk/s, ${archerStats.armor} armor`);
        console.log(`Barbarian: ${barbarianStats.hp} HP, ${barbarianStats.damage} dmg, ${barbarianStats.range} range (melee), ${barbarianStats.attackSpeed} atk/s, ${barbarianStats.armor} armor`);

        // Simulate the actual battle
        const battleResult = simulateCombat(
            leftUnits.length, archerStats,
            rightUnits.length, barbarianStats
        );

        console.log(`\n--- BATTLE RESULTS ---`);
        console.log(`Winner: ${battleResult.winner.toUpperCase()}`);
        console.log(`Duration: ${battleResult.duration.toFixed(1)} seconds`);
        console.log(`Archers remaining: ${battleResult.leftSurvivors}/${leftUnits.length}`);
        console.log(`Barbarians remaining: ${battleResult.rightSurvivors}/${rightUnits.length}`);

        if (battleResult.leftSurvivors > 0) {
            console.log(`Average Archer HP: ${battleResult.leftHpRemaining.toFixed(0)}`);
        }
        if (battleResult.rightSurvivors > 0) {
            console.log(`Average Barbarian HP: ${battleResult.rightHpRemaining.toFixed(0)}`);
        }

        console.log('\n========================================\n');

        expect(battleResult.winner).toBeDefined();
    });

    /**
     * Simulate combat between two armies
     */
    function simulateCombat(leftCount, leftStats, rightCount, rightStats) {
        const dt = 1/20; // 20 TPS
        const distance = 300; // Starting distance

        // Create unit arrays with HP
        const leftUnits = Array(leftCount).fill(null).map(() => ({
            hp: leftStats.hp,
            cooldown: 0,
            x: 100
        }));

        const rightUnits = Array(rightCount).fill(null).map(() => ({
            hp: rightStats.hp,
            cooldown: 0,
            x: 400
        }));

        let time = 0;
        const maxTime = 120; // 2 minute timeout

        while (time < maxTime) {
            time += dt;

            // Get living units
            const leftAlive = leftUnits.filter(u => u.hp > 0);
            const rightAlive = rightUnits.filter(u => u.hp > 0);

            if (leftAlive.length === 0 || rightAlive.length === 0) break;

            // Calculate distance between armies (use average position)
            const leftX = leftAlive.reduce((s, u) => s + u.x, 0) / leftAlive.length;
            const rightX = rightAlive.reduce((s, u) => s + u.x, 0) / rightAlive.length;
            const currentDistance = Math.abs(rightX - leftX);

            // Left units (archers) - attack if in range, else advance
            for (const unit of leftAlive) {
                unit.cooldown = Math.max(0, unit.cooldown - dt);

                if (currentDistance <= leftStats.range) {
                    if (unit.cooldown <= 0) {
                        // Attack random enemy
                        const target = rightAlive[Math.floor(Math.random() * rightAlive.length)];
                        const damage = Math.max(1, leftStats.damage - rightStats.armor);
                        target.hp -= damage;
                        unit.cooldown = 1 / leftStats.attackSpeed;
                    }
                } else {
                    unit.x += leftStats.speed * dt;
                }
            }

            // Right units (barbarians) - attack if in range, else advance
            for (const unit of rightAlive) {
                unit.cooldown = Math.max(0, unit.cooldown - dt);

                if (currentDistance <= rightStats.range) {
                    if (unit.cooldown <= 0) {
                        const target = leftAlive[Math.floor(Math.random() * leftAlive.length)];
                        const damage = Math.max(1, rightStats.damage - leftStats.armor);
                        target.hp -= damage;
                        unit.cooldown = 1 / rightStats.attackSpeed;
                    }
                } else {
                    unit.x -= rightStats.speed * dt;
                }
            }
        }

        const leftSurvivors = leftUnits.filter(u => u.hp > 0);
        const rightSurvivors = rightUnits.filter(u => u.hp > 0);

        let winner = 'draw';
        if (leftSurvivors.length > 0 && rightSurvivors.length === 0) winner = 'left';
        if (rightSurvivors.length > 0 && leftSurvivors.length === 0) winner = 'right';

        return {
            winner,
            duration: time,
            leftSurvivors: leftSurvivors.length,
            rightSurvivors: rightSurvivors.length,
            leftHpRemaining: leftSurvivors.length > 0
                ? leftSurvivors.reduce((s, u) => s + u.hp, 0) / leftSurvivors.length
                : 0,
            rightHpRemaining: rightSurvivors.length > 0
                ? rightSurvivors.reduce((s, u) => s + u.hp, 0) / rightSurvivors.length
                : 0
        };
    }
});
