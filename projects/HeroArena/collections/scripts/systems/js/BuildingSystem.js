// HeroArena building layer. SERVER-AUTHORITATIVE.
//
// Buildings are a parallel structure to the hero army with a DIFFERENT lifecycle:
//   • Placed once, instantly (no peasant/construction), within BUILD_RADIUS of the player's
//     Town Hall (which is auto-created at the team's starting location).
//   • Draggable only during the round they were placed; locked from the next round on.
//   • Persist across rounds (NOT respawned each prep like heroes) and KEEP their battle
//     damage — buildings never heal between rounds. A building destroyed in battle is culled
//     PERMANENTLY and everything it granted (its unlocked units + upgrades) is lost.
//   • Destroying the enemy Town Hall wins the game (see AutobattlerRoundSystem._checkGameOver
//     and ServerBattlePhaseSystem.checkForBattleEnd).
//   • Town Hall → Keep → Castle upgrade chain gates unit tiers (see ArmyShopSystem).
//
// Building entities are tagged with a `buildingOwner` component {playerId, buildingId,
// placementId, roundPlaced} so they can be found/owned/move-gated without being treated as
// heroes. Per-player ownership is mirrored on playerStats.buildings for fast queries + the shop.
class BuildingSystem extends GUTS.BaseSystem {

    static services = [
        'placeBuilding',
        'placeBuildingAuto',
        'moveBuilding',
        'cancelPendingBuilding',
        'autoSpawnTownHalls',
        'spawnCommandBuildings',
        'autoSpawnStartingSentries',
        'cullDestroyedBuildings',
        'getOwnedBuildingIds',
        'getOwnedBuildingArchetypes',
        'townhallLevel',
        'upgradeTownHall',
        'canMoveBuilding'
    ];

    static serviceDependencies = [
        'getPlayerEntities',
        'getLeaderDef',
        'broadcastToRoom',
        'getStartingLocationsFromLevel',
        'spawnSquad',
        'moveHero',
        'tileToWorld',
        'worldToPlacementGrid',
        'getTerrainHeight',
        'replaceUnit',
        'getShopStateForPlayer'
    ];

    // World-space radius around the Town Hall within which other buildings may be placed/moved.
    static BUILD_RADIUS = 450;

    // Town Hall upgrade chain and the unit-tier each tier unlocks.
    static TOWNHALL_CHAIN = { townHall: 'keep', keep: 'castle' };
    static TOWNHALL_LEVEL = { townHall: 1, keep: 2, castle: 3 };

    constructor(game) {
        super(game);
        this.game.buildingSystem = this;
    }

    // ─── Lifecycle hooks (called by AutobattlerRoundSystem) ──────────────────────

    // Create a Town Hall per player at their starting location, once, at game start.
    // Which production building a leader commands (Mechabellum-style tech tower).
    static PRODUCTION_BY_ARCHETYPE = {
        str: 'barracks', int: 'mageTower', dex: 'fletchersHall'
    };

    productionBuildingFor(stats) {
        const leader = this.call.getLeaderDef?.(stats.leaderId);
        return BuildingSystem.PRODUCTION_BY_ARCHETYPE[leader?.archetype] || 'barracks';
    }

    // Each side fields TWO command buildings, spaced evenly across its half:
    // the Town Hall on one flank, the leader's production building on the
    // other. Both hold global upgrade trees; losing one mid-battle breaks the
    // army's morale. Called every prep — respawns any building that died last
    // battle (fresh HP), Mechabellum-tower style.
    spawnCommandBuildings() {
        if (!this._auth()) return;
        for (const entityId of this.call.getPlayerEntities()) {
            const stats = this.game.getComponent(entityId, 'playerStats');
            if (!stats) continue;
            if (!Array.isArray(stats.buildings)) stats.buildings = [];

            const loc = this._startLoc(stats.team);
            if (!loc) continue;
            const my = this.call.tileToWorld(loc.x, loc.z);

            // Enemy direction → across axis, so flank spots work on any map.
            const locs = this.call.getStartingLocationsFromLevel();
            const enemyTeam = Object.keys(locs || {}).map(Number).find(t => t !== stats.team);
            const en = enemyTeam != null ? this.call.tileToWorld(locs[enemyTeam].x, locs[enemyTeam].z) : { x: -my.x, z: -my.z };
            const fdx = en.x - my.x, fdz = en.z - my.z;
            const flen = Math.hypot(fdx, fdz) || 1;
            const a = { x: -fdz / flen, z: fdx / flen };   // across the field
            const FLANK = 400;

            const wanted = [
                { buildingId: 'townHall', x: my.x + a.x * FLANK, z: my.z + a.z * FLANK },
                { buildingId: this.productionBuildingFor(stats), x: my.x - a.x * FLANK, z: my.z - a.z * FLANK }
            ];
            for (const w of wanted) {
                const rec = (stats.buildings || []).find(b => b.buildingId === w.buildingId);
                const live = rec && this._findBuildingEntity(stats.playerId, rec.placementId);
                if (live != null && this.game.entityAlive?.[live] === 1) {
                    // Mechabellum: surviving towers heal to full between rounds
                    const hp = this.game.getComponent(live, 'health');
                    if (hp) hp.current = hp.max;
                    continue;
                }
                if (rec) stats.buildings = stats.buildings.filter(b => b !== rec);
                this._createBuilding(w.buildingId, stats, w.x, w.z, 0);
            }
        }
    }

    // A command building fell mid-battle: Mechabellum tower rules — the whole
    // army hits for 10%, moves at half speed, and takes double damage for 9s;
    // losing the second building EXTENDS the window by another 9s.
    static MORALE_DEBUFF_DURATION = 9;

    onDestroyBuilding(destroyedEntityId) {
        if (!this._auth()) return;
        if (this.game.state.phase !== this.enums.gamePhase.battle) return;
        const owner = this.game.getComponent(destroyedEntityId, 'buildingOwner');
        if (!owner) return;
        // Only the two command buildings break morale (not sentries/mines).
        const bid = owner.buildingId;
        if (!BuildingSystem.TOWNHALL_LEVEL[bid]
            && !Object.values(BuildingSystem.PRODUCTION_BY_ARCHETYPE).includes(bid)) return;

        const buffType = this.enums.buffTypes?.moraleBroken;
        if (buffType == null) return;
        const now = this.game.state.now;
        const dur = BuildingSystem.MORALE_DEBUFF_DURATION;

        for (const id of this.game.getEntitiesWith('heroRosterInfo')) {
            if (this.game.entityAlive?.[id] !== 1) continue;
            const info = this.game.getComponent(id, 'heroRosterInfo');
            if (info?.playerId !== owner.playerId) continue;
            const existing = this.game.buffEffectsSystem?.getBuffOfType(id, buffType);
            if (existing) {
                // Second building: durations ADD (Mechabellum), effects don't stack
                existing.endTime = Math.max(existing.endTime, now) + dur;
            } else {
                this.game.buffEffectsSystem?.applyBuff(id, {
                    buffType, endTime: now + dur, appliedTime: now, stacks: 1
                });
            }
            // Expiry handled centrally by BuffEffectsSystem._reapExpiredBuffs.
        }
        this.call.broadcastToRoom?.(null, 'MORALE_BROKEN', { playerId: owner.playerId, buildingId: bid });
    }

    autoSpawnTownHalls() {
        if (!this._auth()) return;
        for (const entityId of this.call.getPlayerEntities()) {
            const stats = this.game.getComponent(entityId, 'playerStats');
            if (!stats) continue;
            if (!Array.isArray(stats.buildings)) stats.buildings = [];
            if (this._townHallRecord(stats)) continue; // already has one
            const loc = this._startLoc(stats.team);
            if (!loc) continue;
            const world = this.call.tileToWorld(loc.x, loc.z);
            // roundPlaced 0 → Town Hall is fixed (never draggable).
            this._createBuilding('townHall', stats, world.x, world.z, 0);
        }
    }

    // Starting defenses, spawned once at game start (round 1) per player:
    //   • one sentry guarding the base, just base-ward of the nearest ramp
    //   • one forward-outpost sentry ~65% of the way to map center
    // Sentries are ONE-AND-DONE: not buyable in the shop, never respawned (this
    // only runs on round 1), culled permanently when destroyed, and never
    // draggable (roundPlaced 0).
    autoSpawnStartingSentries() {
        if (!this._auth()) return;
        if ((this.game.state.round || 1) !== 1) return;
        for (const entityId of this.call.getPlayerEntities()) {
            const stats = this.game.getComponent(entityId, 'playerStats');
            if (!stats) continue;
            if (!Array.isArray(stats.buildings)) stats.buildings = [];
            if (stats.buildings.some(b => b.buildingId === 'sentryTower')) continue; // already spawned
            const loc = this._startLoc(stats.team);
            if (!loc) continue;
            for (const tile of this._startingSentryTiles(loc)) {
                const world = this.call.tileToWorld(tile.x, tile.z);
                this._createBuilding('sentryTower', stats, world.x, world.z, 0);
            }
        }
    }

    // Tile positions for the starting sentries (see autoSpawnStartingSentries).
    _startingSentryTiles(loc) {
        const tiles = [];
        const tileMap = this._currentLevel()?.tileMap;

        // Guard sentry: 2 tiles base-ward of the ramp nearest the start location.
        const ramps = tileMap?.ramps || [];
        let ramp = null, bestDistSq = Infinity;
        for (const r of ramps) {
            const d = (r.gridX - loc.x) ** 2 + (r.gridZ - loc.z) ** 2;
            if (d < bestDistSq) { bestDistSq = d; ramp = r; }
        }
        if (ramp) {
            const dx = loc.x - ramp.gridX, dz = loc.z - ramp.gridZ;
            const len = Math.hypot(dx, dz) || 1;
            tiles.push({
                x: Math.round(ramp.gridX + (dx / len) * 2),
                z: Math.round(ramp.gridZ + (dz / len) * 2)
            });
        }

        // Forward outpost: 65% of the way from the base to map center.
        const center = (tileMap?.size || 64) / 2;
        tiles.push({
            x: Math.round(loc.x + (center - loc.x) * 0.65),
            z: Math.round(loc.z + (center - loc.z) * 0.65)
        });
        return tiles;
    }

    // Resolve the current level definition from the terrain entity (same
    // lookup PlacementSystem.getStartingLocationsFromLevel uses).
    _currentLevel() {
        const terrainEntities = this.game.getEntitiesWith('terrain');
        if (!terrainEntities.length) return null;
        const terrain = this.game.getComponent(terrainEntities[0], 'terrain');
        const levelKey = this.reverseEnums.levels?.[terrain?.level];
        return levelKey ? this.collections.levels?.[levelKey] : null;
    }

    // Permanently remove buildings destroyed in the just-finished battle and drop any
    // upgrades that are no longer backed by a surviving building.
    cullDestroyedBuildings() {
        if (!this._auth()) return;
        for (const entityId of this.call.getPlayerEntities()) {
            const stats = this.game.getComponent(entityId, 'playerStats');
            if (!stats || !Array.isArray(stats.buildings)) continue;

            const survivors = [];
            for (const rec of stats.buildings) {
                const eid = this._findBuildingEntity(stats.playerId, rec.placementId);
                if (eid != null && this._isAlive(eid)) {
                    survivors.push(rec);
                } else if (eid != null) {
                    try { this.game.destroyEntity(eid); } catch (_) {}
                }
            }
            stats.buildings = survivors;

            // Drop upgrades whose required building no longer exists.
            if (Array.isArray(stats.ownedUpgrades)) {
                stats.ownedUpgrades = stats.ownedUpgrades.filter(id =>
                    this._upgradeBuildingsSatisfied(stats, id));
            }
        }
    }

    // ─── Purchase / placement (server-authoritative) ─────────────────────────────

    // Finalize a building purchase by placing it. The buy step (ArmyShopSystem.buyOffer)
    // sets stats.pendingBuilding {buildingId, offerIndex, cost} without charging; gold is
    // charged here once a valid location is chosen.
    placeBuilding(numericPlayerId, buildingId, worldX, worldZ) {
        if (!this._auth()) return { success: false, reason: 'no_auth' };
        const stats = this._stats(numericPlayerId);
        if (!stats) return { success: false, reason: 'no_player' };
        if (!this._inPlacement()) return { success: false, reason: 'wrong_phase' };

        const pending = stats.pendingBuilding;
        if (!pending || pending.buildingId !== buildingId) return { success: false, reason: 'no_pending' };

        const def = this.collections.buildings?.[buildingId];
        if (!def || def.buyable !== true) return { success: false, reason: 'not_buyable' };
        if (this._ownsBuilding(stats, buildingId)) return { success: false, reason: 'already_owned' };
        if (!this._withinRadius(stats, worldX, worldZ)) return { success: false, reason: 'out_of_radius' };
        if ((stats.gold || 0) < (pending.cost || 0)) return { success: false, reason: 'insufficient_gold' };

        const round = this.game.state?.round || 1;
        const created = this._createBuilding(buildingId, stats, worldX, worldZ, round);
        if (!created) return { success: false, reason: 'spawn_failed' };

        stats.gold -= pending.cost || 0;
        const offer = stats.currentOffers?.[pending.offerIndex];
        if (offer) offer.consumed = true;
        stats.pendingBuilding = null;

        return {
            success: true,
            placementId: created.placementId,
            entityId: created.entityId,
            state: this._shopState(numericPlayerId)
        };
    }

    // Buy-and-place in one step (no placement mode): the building is auto-positioned near
    // the Town Hall and is then draggable for the rest of this round (like a purchased unit).
    // Gold is charged by the caller (ArmyShopSystem.buyOffer) on success. Validation mirrors
    // placeBuilding minus the radius check (the auto position is always within radius).
    placeBuildingAuto(numericPlayerId, buildingId) {
        if (!this._auth()) return { success: false, reason: 'no_auth' };
        const stats = this._stats(numericPlayerId);
        if (!stats) return { success: false, reason: 'no_player' };
        if (!this._inPlacement()) return { success: false, reason: 'wrong_phase' };

        const def = this.collections.buildings?.[buildingId];
        if (!def || def.buyable !== true) return { success: false, reason: 'not_buyable' };
        if (this._ownsBuilding(stats, buildingId)) return { success: false, reason: 'already_owned' };

        const pos = this._autoPlacePosition(stats);
        if (!pos) return { success: false, reason: 'no_townhall' };

        const round = this.game.state?.round || 1;
        const created = this._createBuilding(buildingId, stats, pos.x, pos.z, round);
        if (!created) return { success: false, reason: 'spawn_failed' };

        return { success: true, placementId: created.placementId, entityId: created.entityId };
    }

    // Pick a default spot for an auto-placed building: a short row in front of the Town Hall
    // (toward map center), spread laterally so multiple buildings don't stack. Stays well
    // within BUILD_RADIUS; the player can then drag it anywhere in radius this round.
    _autoPlacePosition(stats) {
        const th = this._townHallPos(stats);
        if (!th) return null;
        const len = Math.hypot(th.x, th.z) || 1;
        const fwd = { x: -th.x / len, z: -th.z / len };   // toward map center
        const right = { x: fwd.z, z: -fwd.x };            // perpendicular
        const count = (stats.buildings || []).filter(b => !BuildingSystem.TOWNHALL_LEVEL[b.buildingId]).length;
        const FORWARD = 170;
        const lateral = (count - 1.5) * 130;              // center a row of ~4 around the forward line
        return {
            x: th.x + fwd.x * FORWARD + right.x * lateral,
            z: th.z + fwd.z * FORWARD + right.z * lateral
        };
    }

    // Abort a pending building purchase (no charge, slot stays available).
    cancelPendingBuilding(numericPlayerId) {
        const stats = this._stats(numericPlayerId);
        if (stats) stats.pendingBuilding = null;
        return { success: true, state: this._shopState(numericPlayerId) };
    }

    // Reposition a building — allowed only during the round it was placed, in placement phase,
    // and only if the new spot is still within BUILD_RADIUS of the Town Hall.
    moveBuilding(numericPlayerId, placementId, worldX, worldZ) {
        if (!this._auth()) return { success: false, reason: 'no_auth' };
        const stats = this._stats(numericPlayerId);
        if (!stats) return { success: false, reason: 'no_player' };
        if (!this._inPlacement()) return { success: false, reason: 'wrong_phase' };

        const eid = this._findBuildingEntity(numericPlayerId, placementId);
        if (eid == null) return { success: false, reason: 'not_found' };
        if (!this.canMoveBuilding(eid)) return { success: false, reason: 'locked' };
        if (!this._withinRadius(stats, worldX, worldZ)) return { success: false, reason: 'out_of_radius' };

        const res = this.call.moveHero(eid, worldX, worldZ);
        if (res?.success) {
            const rec = (stats.buildings || []).find(b => b.placementId === placementId);
            if (rec) rec.gridPosition = this.call.worldToPlacementGrid(worldX, worldZ);
        }
        return res ?? { success: false };
    }

    // A building can be dragged only on the round it was placed (Town Hall, roundPlaced 0,
    // is never movable).
    canMoveBuilding(entityId) {
        const owner = this.game.getComponent(entityId, 'buildingOwner');
        if (!owner) return false;
        const round = this.game.state?.round || 1;
        return owner.roundPlaced > 0 && owner.roundPlaced === round;
    }

    // Swap the player's Town Hall to the next tier in place (Town Hall→Keep→Castle).
    // Gold is charged by the caller (ArmyShopSystem.buyOffer). Returns the new tier id.
    upgradeTownHall(numericPlayerId) {
        if (!this._auth()) return { success: false, reason: 'no_auth' };
        const stats = this._stats(numericPlayerId);
        if (!stats) return { success: false, reason: 'no_player' };
        const rec = this._townHallRecord(stats);
        if (!rec) return { success: false, reason: 'no_townhall' };
        const next = BuildingSystem.TOWNHALL_CHAIN[rec.buildingId];
        if (!next) return { success: false, reason: 'max_tier' };

        const eid = this._findBuildingEntity(numericPlayerId, rec.placementId);
        if (eid == null) return { success: false, reason: 'not_found' };

        if (this.game.hasService?.('replaceUnit')) {
            const newId = this.call.replaceUnit(eid, next);
            const finalId = (newId != null) ? newId : eid;
            const owner = this.game.getComponent(finalId, 'buildingOwner');
            if (owner) { owner.buildingId = next; }
            else { this.game.addComponent(finalId, 'buildingOwner', {
                playerId: numericPlayerId, buildingId: next, placementId: rec.placementId, roundPlaced: 0 }); }
        }
        rec.buildingId = next;
        return { success: true, buildingId: next };
    }

    // ─── Queries (used by the shop) ─────────────────────────────────────────────

    getOwnedBuildingIds(numericPlayerId) {
        const stats = this._stats(numericPlayerId);
        return (stats?.buildings || []).map(b => b.buildingId);
    }

    getOwnedBuildingArchetypes(numericPlayerId) {
        const out = new Set();
        for (const id of this.getOwnedBuildingIds(numericPlayerId)) {
            const a = this.collections.buildings?.[id]?.archetype;
            if (a) out.add(a);
        }
        return [...out];
    }

    // 0 = none, 1 = Town Hall, 2 = Keep, 3 = Castle.
    townhallLevel(numericPlayerId) {
        let lvl = 0;
        for (const id of this.getOwnedBuildingIds(numericPlayerId)) {
            lvl = Math.max(lvl, BuildingSystem.TOWNHALL_LEVEL[id] || 0);
        }
        return lvl;
    }

    // ─── Private ────────────────────────────────────────────────────────────────

    _auth() {
        return this.game.isServer || this.game.state?.isLocalGame;
    }

    _inPlacement() {
        return this.game.state?.phase === this.enums.gamePhase.placement;
    }

    _stats(numericPlayerId) {
        for (const entityId of this.call.getPlayerEntities()) {
            const stats = this.game.getComponent(entityId, 'playerStats');
            if (stats?.playerId === numericPlayerId) return stats;
        }
        return null;
    }

    _shopState(numericPlayerId) {
        return this.game.hasService?.('getShopStateForPlayer')
            ? this.call.getShopStateForPlayer(numericPlayerId) : null;
    }

    _startLoc(team) {
        const locs = this.call.getStartingLocationsFromLevel?.();
        return locs ? locs[team] : null;
    }

    _ownsBuilding(stats, buildingId) {
        return (stats.buildings || []).some(b => b.buildingId === buildingId);
    }

    _townHallRecord(stats) {
        return (stats.buildings || []).find(b => BuildingSystem.TOWNHALL_LEVEL[b.buildingId]);
    }

    _townHallPos(stats) {
        const rec = this._townHallRecord(stats);
        if (!rec) return null;
        const eid = this._findBuildingEntity(stats.playerId, rec.placementId);
        const pos = eid != null ? this.game.getComponent(eid, 'transform')?.position : null;
        return pos || null;
    }

    _withinRadius(stats, worldX, worldZ) {
        const th = this._townHallPos(stats);
        if (!th) return false;
        const dx = worldX - th.x, dz = worldZ - th.z;
        return (dx * dx + dz * dz) <= BuildingSystem.BUILD_RADIUS * BuildingSystem.BUILD_RADIUS;
    }

    _allBuildingEntities() {
        return this.game.getEntitiesWith('buildingOwner') || [];
    }

    _findBuildingEntity(playerId, placementId) {
        for (const eid of this._allBuildingEntities()) {
            const o = this.game.getComponent(eid, 'buildingOwner');
            if (o && o.playerId === playerId && o.placementId === placementId) return eid;
        }
        return null;
    }

    _isAlive(entityId) {
        if (this.game.entityAlive && this.game.entityAlive[entityId] !== 1) return false;
        const health = this.game.getComponent(entityId, 'health');
        if (health && health.current <= 0) return false;
        const ds = this.game.getComponent(entityId, 'deathState');
        if (ds && ds.state !== this.enums.deathState?.alive) return false;
        return true;
    }

    _upgradeBuildingsSatisfied(stats, upgradeId) {
        const def = this.collections.upgrades?.[upgradeId];
        const req = def?.requiresBuildings || [];
        if (req.length === 0) return true;
        const owned = new Set((stats.buildings || []).map(b => b.buildingId));
        return req.every(b => owned.has(b));
    }

    // Create a building entity at a world position and record ownership.
    _createBuilding(buildingId, stats, worldX, worldZ, roundPlaced) {
        const collection = 'buildings';
        const enums = this.game.getEnums();
        const collectionIndex = enums.objectTypeDefinitions?.[collection] ?? -1;
        const typeIndex = enums[collection]?.[buildingId] ?? -1;
        const unitType = this.game.getUnitTypeDef({ collection: collectionIndex, type: typeIndex });
        if (!unitType) {
            console.error('[BuildingSystem] Unknown building:', buildingId);
            return null;
        }
        const gridPos = this.call.worldToPlacementGrid(worldX, worldZ);
        const placement = {
            gridPosition: gridPos,
            unitTypeId: typeIndex,
            collection: collectionIndex,
            team: stats.team,
            isStartingState: true,
            unitType: { ...unitType, id: buildingId, collection }
        };
        const result = this.call.spawnSquad(placement, stats.team, stats.playerId, null);
        const entityId = result?.squad?.squadUnits?.[0];
        const placementId = result?.squad?.placementId;
        if (!result?.success || entityId == null) {
            console.error('[BuildingSystem] Failed to spawn building:', buildingId, result?.error);
            return null;
        }
        this.game.addComponent(entityId, 'buildingOwner', {
            playerId: stats.playerId, buildingId, placementId, roundPlaced
        });
        if (!Array.isArray(stats.buildings)) stats.buildings = [];
        stats.buildings.push({ buildingId, placementId, gridPosition: gridPos, roundPlaced });
        return { entityId, placementId, gridPosition: gridPos };
    }
}
