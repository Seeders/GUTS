import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestGameContext } from '../../../../../../tests/TestGameContext.js';

/**
 * Stealth System Unit Tests
 *
 * Tests the stealth/awareness mechanics including:
 * - Base unit stealth values
 * - Terrain-based stealth bonuses (forest +25)
 * - Hide action stealth bonus (+20)
 * - Combined stealth calculations
 * - Hidden units not searching for enemies
 */
describe('Stealth System', () => {
    let game;
    let enums;
    let findNearestEnemyAction;

    beforeEach(() => {
        game = new TestGameContext();
        enums = game.getEnums();

        // Mock HeadlessLogger
        if (!globalThis.GUTS.HeadlessLogger) {
            globalThis.GUTS.HeadlessLogger = {
                trace: vi.fn(),
                debug: vi.fn(),
                info: vi.fn(),
                warn: vi.fn(),
                error: vi.fn()
            };
        }

        // Create the behavior action instance
        findNearestEnemyAction = new GUTS.FindNearestEnemyBehaviorAction();
        findNearestEnemyAction.parameters = {};

        // Mock getUnitTypeDef service
        game.register('getUnitTypeDef', (unitTypeComp) => {
            return { id: 'testUnit' };
        });

        // Mock getNearbyUnits service
        game.register('getNearbyUnits', (pos, range, excludeId) => []);

        // Mock terrain services
        game.register('getTerrainTypeAtPosition', (x, z) => null);
        game.register('getTileMapTerrainType', (index) => null);

        // Mock hasLineOfSight service
        game.register('hasLineOfSight', () => true);

        // Mock isInRange from GameUtils (VisionSystem uses this)
        if (!globalThis.GUTS.GameUtils) {
            globalThis.GUTS.GameUtils = {};
        }
        globalThis.GUTS.GameUtils.isInRange = (game, entityId, targetId, range) => {
            const pos = game.getComponent(entityId, 'transform')?.position;
            const targetPos = game.getComponent(targetId, 'transform')?.position;
            if (!pos || !targetPos) return false;
            const dx = targetPos.x - pos.x;
            const dz = targetPos.z - pos.z;
            return Math.sqrt(dx * dx + dz * dz) <= range;
        };
        globalThis.GUTS.GameUtils.getCollisionRadius = () => 0;

        // Mock VisionSystem services (findNearestVisibleEnemy delegates to getVisibleEnemiesInRange)
        game.register('getVisibleEnemiesInRange', (entityId, range) => {
            const transform = game.getComponent(entityId, 'transform');
            const pos = transform?.position;
            const team = game.getComponent(entityId, 'team');
            const combat = game.getComponent(entityId, 'combat');
            const awareness = combat?.awareness ?? 50;

            if (!pos || !team) return [];

            const nearbyEntityIds = game.call('getNearbyUnits', pos, range, entityId);
            if (!nearbyEntityIds || nearbyEntityIds.length === 0) return [];

            const enemies = [];
            for (const targetId of nearbyEntityIds) {
                const targetTeam = game.getComponent(targetId, 'team');
                if (!targetTeam || targetTeam.team === team.team) continue;

                const targetHealth = game.getComponent(targetId, 'health');
                if (!targetHealth || targetHealth.current <= 0) continue;

                // Calculate target stealth
                const targetCombat = game.getComponent(targetId, 'combat');
                let targetStealth = targetCombat?.stealth ?? 0;

                const targetTransform = game.getComponent(targetId, 'transform');
                const targetPos = targetTransform?.position;
                if (!targetPos) continue;

                // Terrain stealth bonus
                const terrainTypeIndex = game.call('getTerrainTypeAtPosition', targetPos.x, targetPos.z);
                if (terrainTypeIndex !== null && terrainTypeIndex !== undefined) {
                    const terrainType = game.call('getTileMapTerrainType', terrainTypeIndex);
                    if (terrainType?.stealthBonus) {
                        targetStealth += terrainType.stealthBonus;
                    }
                }

                // Hiding stealth bonus
                const targetPlayerOrder = game.getComponent(targetId, 'playerOrder');
                if (targetPlayerOrder?.isHiding) {
                    targetStealth += 20;
                }

                if (targetStealth > awareness) continue;

                enemies.push(targetId);
            }

            return enemies;
        });

        game.register('findNearestVisibleEnemy', (entityId, range) => {
            const pos = game.getComponent(entityId, 'transform')?.position;
            if (!pos) return null;

            const visibleEnemyIds = game.call('getVisibleEnemiesInRange', entityId, range);
            if (!visibleEnemyIds || visibleEnemyIds.length === 0) return null;

            let nearest = null;
            let minDist = Infinity;
            for (const targetId of visibleEnemyIds) {
                const targetPos = game.getComponent(targetId, 'transform')?.position;
                if (!targetPos) continue;
                const dx = targetPos.x - pos.x;
                const dz = targetPos.z - pos.z;
                const dist = Math.sqrt(dx * dx + dz * dz);
                if (dist < minDist) {
                    minDist = dist;
                    nearest = { id: targetId, distance: dist };
                }
            }
            return nearest;
        });

        // Mock getBehaviorShared service (used by behavior actions to store shared state)
        const sharedStates = new Map();
        game.register('getBehaviorShared', (entityId) => {
            if (!sharedStates.has(entityId)) {
                sharedStates.set(entityId, {});
            }
            return sharedStates.get(entityId);
        });
    });

    // Helper function to check if result indicates success
    const isSuccess = (result) => result !== null && result.status === 'success';
    const isFailure = (result) => result === null;

    describe('Base Stealth Values', () => {
        it('should use default awareness of 50 when not specified', () => {
            const searcherId = game.createEntityWith({
                transform: { position: { x: 0, y: 0, z: 0 } },
                team: { team: enums.team.left },
                combat: { visionRange: 300 }  // No awareness specified
            });

            const targetId = game.createEntityWith({
                transform: { position: { x: 50, y: 0, z: 0 } },
                team: { team: enums.team.right },
                health: { current: 100, max: 100 },
                combat: { stealth: 49 }  // Just below default awareness
            });

            game.register('getNearbyUnits', () => [targetId]);

            const result = findNearestEnemyAction.execute(searcherId, game);

            expect(isSuccess(result)).toBe(true);
            expect(result.meta.target).toBe(targetId);
        });

        it('should not detect units with stealth higher than awareness', () => {
            const searcherId = game.createEntityWith({
                transform: { position: { x: 0, y: 0, z: 0 } },
                team: { team: enums.team.left },
                combat: { visionRange: 300, awareness: 50 }
            });

            const targetId = game.createEntityWith({
                transform: { position: { x: 50, y: 0, z: 0 } },
                team: { team: enums.team.right },
                health: { current: 100, max: 100 },
                combat: { stealth: 51 }  // Above awareness
            });

            game.register('getNearbyUnits', () => [targetId]);

            const result = findNearestEnemyAction.execute(searcherId, game);

            expect(isFailure(result)).toBe(true);
        });

        it('should detect units with stealth equal to awareness', () => {
            const searcherId = game.createEntityWith({
                transform: { position: { x: 0, y: 0, z: 0 } },
                team: { team: enums.team.left },
                combat: { visionRange: 300, awareness: 50 }
            });

            const targetId = game.createEntityWith({
                transform: { position: { x: 50, y: 0, z: 0 } },
                team: { team: enums.team.right },
                health: { current: 100, max: 100 },
                combat: { stealth: 50 }  // Equal to awareness
            });

            game.register('getNearbyUnits', () => [targetId]);

            const result = findNearestEnemyAction.execute(searcherId, game);

            expect(isSuccess(result)).toBe(true);
        });

        it('should handle units with high awareness detecting stealthy units', () => {
            const searcherId = game.createEntityWith({
                transform: { position: { x: 0, y: 0, z: 0 } },
                team: { team: enums.team.left },
                combat: { visionRange: 300, awareness: 80 }
            });

            const targetId = game.createEntityWith({
                transform: { position: { x: 50, y: 0, z: 0 } },
                team: { team: enums.team.right },
                health: { current: 100, max: 100 },
                combat: { stealth: 70 }  // High stealth but below awareness
            });

            game.register('getNearbyUnits', () => [targetId]);

            const result = findNearestEnemyAction.execute(searcherId, game);

            expect(isSuccess(result)).toBe(true);
        });
    });

    describe('Terrain Stealth Bonus', () => {
        it('should apply forest stealth bonus (+25)', () => {
            const searcherId = game.createEntityWith({
                transform: { position: { x: 0, y: 0, z: 0 } },
                team: { team: enums.team.left },
                combat: { visionRange: 300, awareness: 50 }
            });

            // Target with 30 base stealth (normally visible)
            const targetId = game.createEntityWith({
                transform: { position: { x: 50, y: 0, z: 0 } },
                team: { team: enums.team.right },
                health: { current: 100, max: 100 },
                combat: { stealth: 30 }
            });

            game.register('getNearbyUnits', () => [targetId]);

            // Mock forest terrain at target position
            game.register('getTerrainTypeAtPosition', (x, z) => {
                if (x === 50 && z === 0) return 5;  // Forest terrain index
                return 6;  // Grass
            });
            game.register('getTileMapTerrainType', (index) => {
                if (index === 5) return { type: 'forest', stealthBonus: 25 };
                return { type: 'grass' };
            });

            const result = findNearestEnemyAction.execute(searcherId, game);

            // 30 base + 25 forest = 55 stealth > 50 awareness = not visible
            expect(isFailure(result)).toBe(true);
        });

        it('should detect unit in forest with high enough awareness', () => {
            const searcherId = game.createEntityWith({
                transform: { position: { x: 0, y: 0, z: 0 } },
                team: { team: enums.team.left },
                combat: { visionRange: 300, awareness: 60 }
            });

            const targetId = game.createEntityWith({
                transform: { position: { x: 50, y: 0, z: 0 } },
                team: { team: enums.team.right },
                health: { current: 100, max: 100 },
                combat: { stealth: 30 }
            });

            game.register('getNearbyUnits', () => [targetId]);

            game.register('getTerrainTypeAtPosition', () => 5);
            game.register('getTileMapTerrainType', (index) => {
                if (index === 5) return { type: 'forest', stealthBonus: 25 };
                return null;
            });

            const result = findNearestEnemyAction.execute(searcherId, game);

            // 30 base + 25 forest = 55 stealth < 60 awareness = visible
            expect(isSuccess(result)).toBe(true);
        });

        it('should not apply stealth bonus on non-forest terrain', () => {
            const searcherId = game.createEntityWith({
                transform: { position: { x: 0, y: 0, z: 0 } },
                team: { team: enums.team.left },
                combat: { visionRange: 300, awareness: 50 }
            });

            const targetId = game.createEntityWith({
                transform: { position: { x: 50, y: 0, z: 0 } },
                team: { team: enums.team.right },
                health: { current: 100, max: 100 },
                combat: { stealth: 30 }
            });

            game.register('getNearbyUnits', () => [targetId]);

            // Grass terrain - no stealth bonus
            game.register('getTerrainTypeAtPosition', () => 6);
            game.register('getTileMapTerrainType', () => ({ type: 'grass' }));

            const result = findNearestEnemyAction.execute(searcherId, game);

            // 30 stealth < 50 awareness = visible
            expect(isSuccess(result)).toBe(true);
        });
    });

    describe('Hide Action Stealth Bonus', () => {
        it('should apply +20 stealth bonus when unit is hiding', () => {
            const searcherId = game.createEntityWith({
                transform: { position: { x: 0, y: 0, z: 0 } },
                team: { team: enums.team.left },
                combat: { visionRange: 300, awareness: 50 }
            });

            // Target with 35 base stealth
            const targetId = game.createEntityWith({
                transform: { position: { x: 50, y: 0, z: 0 } },
                team: { team: enums.team.right },
                health: { current: 100, max: 100 },
                combat: { stealth: 35 },
                playerOrder: { isHiding: true, enabled: true }
            });

            game.register('getNearbyUnits', () => [targetId]);

            const result = findNearestEnemyAction.execute(searcherId, game);

            // 35 base + 20 hiding = 55 stealth > 50 awareness = not visible
            expect(isFailure(result)).toBe(true);
        });

        it('should not apply hiding bonus when unit is not hiding', () => {
            const searcherId = game.createEntityWith({
                transform: { position: { x: 0, y: 0, z: 0 } },
                team: { team: enums.team.left },
                combat: { visionRange: 300, awareness: 50 }
            });

            const targetId = game.createEntityWith({
                transform: { position: { x: 50, y: 0, z: 0 } },
                team: { team: enums.team.right },
                health: { current: 100, max: 100 },
                combat: { stealth: 35 },
                playerOrder: { isHiding: false, enabled: true }
            });

            game.register('getNearbyUnits', () => [targetId]);

            const result = findNearestEnemyAction.execute(searcherId, game);

            // 35 stealth < 50 awareness = visible
            expect(isSuccess(result)).toBe(true);
        });

        it('should detect hiding unit with high awareness', () => {
            const searcherId = game.createEntityWith({
                transform: { position: { x: 0, y: 0, z: 0 } },
                team: { team: enums.team.left },
                combat: { visionRange: 300, awareness: 70 }
            });

            const targetId = game.createEntityWith({
                transform: { position: { x: 50, y: 0, z: 0 } },
                team: { team: enums.team.right },
                health: { current: 100, max: 100 },
                combat: { stealth: 40 },
                playerOrder: { isHiding: true }
            });

            game.register('getNearbyUnits', () => [targetId]);

            const result = findNearestEnemyAction.execute(searcherId, game);

            // 40 base + 20 hiding = 60 stealth < 70 awareness = visible
            expect(isSuccess(result)).toBe(true);
        });
    });

    describe('Combined Stealth Bonuses', () => {
        it('should stack terrain and hiding bonuses (scout in forest hiding)', () => {
            const searcherId = game.createEntityWith({
                transform: { position: { x: 0, y: 0, z: 0 } },
                team: { team: enums.team.left },
                combat: { visionRange: 300, awareness: 80 }
            });

            // Scout with 40 base stealth, hiding in forest
            const targetId = game.createEntityWith({
                transform: { position: { x: 50, y: 0, z: 0 } },
                team: { team: enums.team.right },
                health: { current: 100, max: 100 },
                combat: { stealth: 40 },
                playerOrder: { isHiding: true }
            });

            game.register('getNearbyUnits', () => [targetId]);

            // Forest terrain
            game.register('getTerrainTypeAtPosition', () => 5);
            game.register('getTileMapTerrainType', (index) => {
                if (index === 5) return { type: 'forest', stealthBonus: 25 };
                return null;
            });

            const result = findNearestEnemyAction.execute(searcherId, game);

            // 40 base + 25 forest + 20 hiding = 85 stealth > 80 awareness = not visible
            expect(isFailure(result)).toBe(true);
        });

        it('should be detected with very high awareness even with all bonuses', () => {
            const searcherId = game.createEntityWith({
                transform: { position: { x: 0, y: 0, z: 0 } },
                team: { team: enums.team.left },
                combat: { visionRange: 300, awareness: 90 }
            });

            // Scout with 40 base stealth, hiding in forest
            const targetId = game.createEntityWith({
                transform: { position: { x: 50, y: 0, z: 0 } },
                team: { team: enums.team.right },
                health: { current: 100, max: 100 },
                combat: { stealth: 40 },
                playerOrder: { isHiding: true }
            });

            game.register('getNearbyUnits', () => [targetId]);

            game.register('getTerrainTypeAtPosition', () => 5);
            game.register('getTileMapTerrainType', (index) => {
                if (index === 5) return { type: 'forest', stealthBonus: 25 };
                return null;
            });

            const result = findNearestEnemyAction.execute(searcherId, game);

            // 40 base + 25 forest + 20 hiding = 85 stealth < 90 awareness = visible
            expect(isSuccess(result)).toBe(true);
        });

        it('should handle zero base stealth with bonuses', () => {
            const searcherId = game.createEntityWith({
                transform: { position: { x: 0, y: 0, z: 0 } },
                team: { team: enums.team.left },
                combat: { visionRange: 300, awareness: 40 }
            });

            // Unit with 0 stealth, hiding in forest
            const targetId = game.createEntityWith({
                transform: { position: { x: 50, y: 0, z: 0 } },
                team: { team: enums.team.right },
                health: { current: 100, max: 100 },
                combat: { stealth: 0 },
                playerOrder: { isHiding: true }
            });

            game.register('getNearbyUnits', () => [targetId]);

            game.register('getTerrainTypeAtPosition', () => 5);
            game.register('getTileMapTerrainType', (index) => {
                if (index === 5) return { type: 'forest', stealthBonus: 25 };
                return null;
            });

            const result = findNearestEnemyAction.execute(searcherId, game);

            // 0 base + 25 forest + 20 hiding = 45 stealth > 40 awareness = not visible
            expect(isFailure(result)).toBe(true);
        });
    });

    describe('Hidden Units Behavior', () => {
        it('should not search for enemies when hiding', () => {
            const hiddenUnit = game.createEntityWith({
                transform: { position: { x: 0, y: 0, z: 0 } },
                team: { team: enums.team.left },
                combat: { visionRange: 300, awareness: 100 },
                playerOrder: { isHiding: true, enabled: true }
            });

            const enemyId = game.createEntityWith({
                transform: { position: { x: 50, y: 0, z: 0 } },
                team: { team: enums.team.right },
                health: { current: 100, max: 100 },
                combat: { stealth: 0 }  // No stealth at all
            });

            game.register('getNearbyUnits', () => [enemyId]);

            const result = findNearestEnemyAction.execute(hiddenUnit, game);

            // Hidden unit should return failure immediately - won't search
            expect(isFailure(result)).toBe(true);
        });

        it('should search for enemies when not hiding', () => {
            const unit = game.createEntityWith({
                transform: { position: { x: 0, y: 0, z: 0 } },
                team: { team: enums.team.left },
                combat: { visionRange: 300, awareness: 100 },
                playerOrder: { isHiding: false, enabled: true }
            });

            const enemyId = game.createEntityWith({
                transform: { position: { x: 50, y: 0, z: 0 } },
                team: { team: enums.team.right },
                health: { current: 100, max: 100 },
                combat: { stealth: 0 }
            });

            game.register('getNearbyUnits', () => [enemyId]);

            const result = findNearestEnemyAction.execute(unit, game);

            expect(isSuccess(result)).toBe(true);
            expect(result.meta.target).toBe(enemyId);
        });

        it('should search when playerOrder component is missing', () => {
            const unit = game.createEntityWith({
                transform: { position: { x: 0, y: 0, z: 0 } },
                team: { team: enums.team.left },
                combat: { visionRange: 300, awareness: 100 }
                // No playerOrder component
            });

            const enemyId = game.createEntityWith({
                transform: { position: { x: 50, y: 0, z: 0 } },
                team: { team: enums.team.right },
                health: { current: 100, max: 100 },
                combat: { stealth: 0 }
            });

            game.register('getNearbyUnits', () => [enemyId]);

            const result = findNearestEnemyAction.execute(unit, game);

            expect(isSuccess(result)).toBe(true);
        });
    });

    describe('Scout Unit Stealth (40 base)', () => {
        it('should have scout visible to default awareness units on grass', () => {
            // Scout has 40 stealth, default awareness is 50
            // On grass (no bonus): 40 < 50 = visible
            const searcherId = game.createEntityWith({
                transform: { position: { x: 0, y: 0, z: 0 } },
                team: { team: enums.team.left },
                combat: { visionRange: 300, awareness: 50 }
            });

            const scoutId = game.createEntityWith({
                transform: { position: { x: 50, y: 0, z: 0 } },
                team: { team: enums.team.right },
                health: { current: 100, max: 100 },
                combat: { stealth: 40 }  // Scout stealth
            });

            game.register('getNearbyUnits', () => [scoutId]);

            const result = findNearestEnemyAction.execute(searcherId, game);

            // 40 stealth < 50 awareness = visible on grass
            expect(isSuccess(result)).toBe(true);
        });

        it('should have scout invisible to default awareness units in forest', () => {
            const searcherId = game.createEntityWith({
                transform: { position: { x: 0, y: 0, z: 0 } },
                team: { team: enums.team.left },
                combat: { visionRange: 300, awareness: 50 }
            });

            const scoutId = game.createEntityWith({
                transform: { position: { x: 50, y: 0, z: 0 } },
                team: { team: enums.team.right },
                health: { current: 100, max: 100 },
                combat: { stealth: 40 }  // Scout stealth
            });

            game.register('getNearbyUnits', () => [scoutId]);
            game.register('getTerrainTypeAtPosition', () => 5);
            game.register('getTileMapTerrainType', () => ({ type: 'forest', stealthBonus: 25 }));

            const result = findNearestEnemyAction.execute(searcherId, game);

            // 40 + 25 forest = 65 stealth > 50 awareness = invisible
            expect(isFailure(result)).toBe(true);
        });

        it('should have hiding scout invisible to most units in forest', () => {
            const searcherId = game.createEntityWith({
                transform: { position: { x: 0, y: 0, z: 0 } },
                team: { team: enums.team.left },
                combat: { visionRange: 300, awareness: 80 }
            });

            const scoutId = game.createEntityWith({
                transform: { position: { x: 50, y: 0, z: 0 } },
                team: { team: enums.team.right },
                health: { current: 100, max: 100 },
                combat: { stealth: 40 },
                playerOrder: { isHiding: true }
            });

            game.register('getNearbyUnits', () => [scoutId]);
            game.register('getTerrainTypeAtPosition', () => 5);
            game.register('getTileMapTerrainType', () => ({ type: 'forest', stealthBonus: 25 }));

            const result = findNearestEnemyAction.execute(searcherId, game);

            // 40 + 25 forest + 20 hiding = 85 stealth > 80 awareness = invisible
            expect(isFailure(result)).toBe(true);
        });
    });

    describe('Edge Cases', () => {
        it('should handle missing terrain service gracefully', () => {
            const searcherId = game.createEntityWith({
                transform: { position: { x: 0, y: 0, z: 0 } },
                team: { team: enums.team.left },
                combat: { visionRange: 300, awareness: 50 }
            });

            const targetId = game.createEntityWith({
                transform: { position: { x: 50, y: 0, z: 0 } },
                team: { team: enums.team.right },
                health: { current: 100, max: 100 },
                combat: { stealth: 30 }
            });

            game.register('getNearbyUnits', () => [targetId]);
            game.register('getTerrainTypeAtPosition', () => null);
            game.register('getTileMapTerrainType', () => null);

            const result = findNearestEnemyAction.execute(searcherId, game);

            // Should still work, just no terrain bonus applied
            expect(isSuccess(result)).toBe(true);
        });

        it('should handle terrain type without stealthBonus property', () => {
            const searcherId = game.createEntityWith({
                transform: { position: { x: 0, y: 0, z: 0 } },
                team: { team: enums.team.left },
                combat: { visionRange: 300, awareness: 50 }
            });

            const targetId = game.createEntityWith({
                transform: { position: { x: 50, y: 0, z: 0 } },
                team: { team: enums.team.right },
                health: { current: 100, max: 100 },
                combat: { stealth: 45 }
            });

            game.register('getNearbyUnits', () => [targetId]);
            game.register('getTerrainTypeAtPosition', () => 6);
            game.register('getTileMapTerrainType', () => ({ type: 'grass' }));  // No stealthBonus

            const result = findNearestEnemyAction.execute(searcherId, game);

            // 45 stealth < 50 awareness = visible
            expect(isSuccess(result)).toBe(true);
        });

        it('should handle very high stealth values', () => {
            const searcherId = game.createEntityWith({
                transform: { position: { x: 0, y: 0, z: 0 } },
                team: { team: enums.team.left },
                combat: { visionRange: 300, awareness: 100 }
            });

            const targetId = game.createEntityWith({
                transform: { position: { x: 50, y: 0, z: 0 } },
                team: { team: enums.team.right },
                health: { current: 100, max: 100 },
                combat: { stealth: 200 }  // Very high stealth
            });

            game.register('getNearbyUnits', () => [targetId]);

            const result = findNearestEnemyAction.execute(searcherId, game);

            expect(isFailure(result)).toBe(true);
        });

        it('should prefer nearest visible enemy among multiple targets', () => {
            const searcherId = game.createEntityWith({
                transform: { position: { x: 0, y: 0, z: 0 } },
                team: { team: enums.team.left },
                combat: { visionRange: 300, awareness: 50 }
            });

            // Nearby stealthed enemy (invisible)
            const stealthedId = game.createEntityWith({
                transform: { position: { x: 30, y: 0, z: 0 } },
                team: { team: enums.team.right },
                health: { current: 100, max: 100 },
                combat: { stealth: 60 }
            });

            // Farther visible enemy
            const visibleId = game.createEntityWith({
                transform: { position: { x: 100, y: 0, z: 0 } },
                team: { team: enums.team.right },
                health: { current: 100, max: 100 },
                combat: { stealth: 20 }
            });

            game.register('getNearbyUnits', () => [stealthedId, visibleId]);

            const result = findNearestEnemyAction.execute(searcherId, game);

            // Should find the visible enemy, not the closer stealthed one
            expect(isSuccess(result)).toBe(true);
            expect(result.meta.target).toBe(visibleId);
        });
    });
});
