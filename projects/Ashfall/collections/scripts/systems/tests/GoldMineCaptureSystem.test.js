// Load HeroArena's own bundle first so GUTS.GoldMineCaptureSystem and HeroArena's
// enums (goldVein/goldMine) are the ones in scope — the shared setup.js loads the
// TurnBasedWarfare bundle, which lacks this HeroArena-only system.
import '../../../../dist/client/game.js';
import { describe, it, expect, beforeEach } from 'vitest';
import { TestGameContext } from '../../../../../../tests/TestGameContext.js';

/**
 * Covers the build/income economy loop: standing mines pay their owner, a
 * dragon-free vein auto-builds a mine for its strict-majority holder, and a
 * destroyed mine frees its vein.
 */
describe('GoldMineCaptureSystem', () => {
    let game, system, enums;
    let nearbyUnits;        // entity ids returned by the mocked getNearbyUnits
    let nextPlacementId;

    beforeEach(() => {
        game = new TestGameContext();
        game.state.isLocalGame = true;   // satisfies _auth()
        game.state.round = 2;            // not round 1 (autoSpawn is round-1 only)
        enums = game.getEnums();
        nearbyUnits = [];
        nextPlacementId = 1;

        game.register('getPlayerEntities', () => game._players || []);
        game.register('getNearbyUnits', () => nearbyUnits);
        game.register('worldToPlacementGrid', (x, z) => ({ x: Math.floor(x / 50), z: Math.floor(z / 50) }));
        game.register('tileToWorld', (x, z) => ({ x: x * 50, z: z * 50 }));
        game.register('applySquadTargetPosition', () => {});
        game.register('broadcastToRoom', () => {});
        if (!game.hasService('getUnitTypeDef')) game.register('getUnitTypeDef', () => ({}));

        // spawnSquad mock: materialises a real entity so addComponent/entityAlive work.
        game.register('spawnSquad', (placement, team) => {
            const eid = game.createEntityWith({
                transform: { position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
                team: { team },
                unitType: { collection: placement.collection, type: placement.unitTypeId }
            });
            return { success: true, squad: { squadUnits: [eid], placementId: nextPlacementId++ } };
        });

        system = game.createSystem(GUTS.GoldMineCaptureSystem);
        // createSystem doesn't wire serviceDependencies onto system.call — do it here
        // (lazy getters resolve against the mocks registered above).
        game.getServiceDependencies(system);
    });

    // ── helpers ────────────────────────────────────────────────────────────────
    function addPlayer(team, gold = 0, playerId = team) {
        const eid = game.createEntityWith({ playerStats: { team, gold, playerId } });
        (game._players ||= []).push(eid);
        return eid;
    }

    function makeVein(x = 2800, z = 350) {
        return game.createEntityWith({
            worldObject: {},
            transform: { position: { x, y: 0, z }, scale: { x: 1, y: 1, z: 1 } },
            unitType: {
                collection: enums.objectTypeDefinitions.worldObjects,
                type: enums.worldObjects.goldVein
            }
        });
    }

    function makeUnit(team) {
        return game.createEntityWith({
            team: { team },
            health: { current: 100, max: 100 },
            deathState: { state: enums.deathState.alive }
        });
    }

    function makeEntity() {
        return game.createEntityWith({ transform: { position: { x: 0, y: 0, z: 0 } } });
    }

    function pushVein({ veinEntityId, dragonEntityId = null, mineEntityId = null, ownerTeam = null }) {
        const vein = { tile: null, world: { x: 2800, z: 350 }, veinEntityId, dragonEntityId, mineEntityId, ownerTeam };
        system._veins.push(vein);
        return vein;
    }

    // ── income ───────────────────────────────────────────────────────────────
    it('pays flat income to the owner of a standing mine', () => {
        addPlayer(enums.team.left, 10);
        const mine = makeEntity();
        pushVein({ veinEntityId: makeVein(), mineEntityId: mine, ownerTeam: enums.team.left });

        system.resolveGoldMineCaptures();

        const stats = game.getComponent(game._players[0], 'playerStats');
        expect(stats.gold).toBe(10 + GUTS.GoldMineCaptureSystem.MINE_INCOME);
    });

    it('does not auto-build over a vein that already has a standing mine', () => {
        addPlayer(enums.team.left, 0);
        const mine = makeEntity();
        const vein = pushVein({ veinEntityId: makeVein(), mineEntityId: mine, ownerTeam: enums.team.left });
        nearbyUnits = [makeUnit(enums.team.right), makeUnit(enums.team.right)]; // enemies on the point

        system.resolveGoldMineCaptures();

        expect(vein.mineEntityId).toBe(mine);          // unchanged — must be destroyed first
        expect(vein.ownerTeam).toBe(enums.team.left);
    });

    // ── auto-build ─────────────────────────────────────────────────────────────
    it('auto-builds a mine for the strict-majority holder of a dragon-free vein', () => {
        addPlayer(enums.team.left, 0);
        const deadDragon = makeEntity();
        game.entityAlive[deadDragon] = 0;
        const vein = pushVein({ veinEntityId: makeVein(), dragonEntityId: deadDragon });
        nearbyUnits = [makeUnit(enums.team.left), makeUnit(enums.team.left), makeUnit(enums.team.right)];

        system.resolveGoldMineCaptures();

        expect(vein.mineEntityId).not.toBeNull();
        expect(vein.ownerTeam).toBe(enums.team.left);
        // Built as a proper team building.
        expect(game.getComponent(vein.mineEntityId, 'buildingOwner')).toBeTruthy();
        expect(game.getComponent(vein.mineEntityId, 'team').team).toBe(enums.team.left);
    });

    it('does not build on a tie', () => {
        addPlayer(enums.team.left, 0);
        addPlayer(enums.team.right, 0);
        const deadDragon = makeEntity();
        game.entityAlive[deadDragon] = 0;
        const vein = pushVein({ veinEntityId: makeVein(), dragonEntityId: deadDragon });
        nearbyUnits = [makeUnit(enums.team.left), makeUnit(enums.team.right)];

        system.resolveGoldMineCaptures();

        expect(vein.mineEntityId).toBeNull();
    });

    it('does not build while the guardian dragon is alive', () => {
        addPlayer(enums.team.left, 0);
        const dragon = makeEntity();          // entityAlive defaults to 1
        const vein = pushVein({ veinEntityId: makeVein(), dragonEntityId: dragon });
        nearbyUnits = [makeUnit(enums.team.left), makeUnit(enums.team.left)];

        system.resolveGoldMineCaptures();

        expect(vein.mineEntityId).toBeNull();
    });

    // ── destruction frees the vein ───────────────────────────────────────────────
    it('frees the vein when its mine has been destroyed', () => {
        addPlayer(enums.team.left, 0);
        const mine = makeEntity();
        game.entityAlive[mine] = 0;           // destroyed in battle
        const deadDragon = makeEntity();
        game.entityAlive[deadDragon] = 0;
        const vein = pushVein({
            veinEntityId: makeVein(), dragonEntityId: deadDragon,
            mineEntityId: mine, ownerTeam: enums.team.left
        });

        system.resolveGoldMineCaptures();

        expect(vein.mineEntityId).toBeNull();
        expect(vein.ownerTeam).toBeNull();
    });

    // ── AI objectives ────────────────────────────────────────────────────────────
    it('reports the right objective for the asking team', () => {
        const liveDragon = makeEntity();
        const veinA = pushVein({ veinEntityId: makeVein(), dragonEntityId: liveDragon });        // kill dragon
        const enemyMine = makeEntity();
        const veinB = pushVein({ veinEntityId: makeVein(2800, 2800), mineEntityId: enemyMine, ownerTeam: enums.team.right }); // destroy mine

        const objs = system.getContestableObjectives(enums.team.left);
        const ids = objs.map(o => o.entityId);
        expect(ids).toContain(liveDragon);
        expect(ids).toContain(enemyMine);

        // A vein the asking team already owns is skipped.
        const ownMine = makeEntity();
        pushVein({ veinEntityId: makeVein(), mineEntityId: ownMine, ownerTeam: enums.team.left });
        const own = system.getContestableObjectives(enums.team.left).map(o => o.entityId);
        expect(own).not.toContain(ownMine);
    });
});
