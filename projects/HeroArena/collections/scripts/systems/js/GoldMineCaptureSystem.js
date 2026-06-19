/**
 * GoldMineCaptureSystem — HeroArena's gold veins & player-built mines.
 *
 * Two neutral GOLD VEINS sit in the map corners that have no starting location
 * ((56,7) and (7,56) on forest — the bases are at (7,7)/(56,56)). Each vein is
 * guarded by a hostile red dragon. The economy loop is:
 *
 *   1. Kill the dragon (one-and-done — slain dragons never respawn).
 *   2. Hold the dragon-free vein with your units at battle's end: a GOLD MINE
 *      building auto-constructs there for the holding team next round.
 *   3. While that mine stands it pays its owner a flat gold bonus every round —
 *      no units need to camp it.
 *   4. The enemy can't take it by standing on it: they must DESTROY the mine
 *      building (it's an attackable team building), which frees the vein, and
 *      then hold it themselves to build their own.
 *
 * The vein itself is a neutral, unattackable worldObject (purely a map marker /
 * build site). The mine is a normal left/right team building, so enemy units
 * target and attack it through the usual FindNearestEnemy targeting.
 *
 * Per-vein state is tracked in this._veins: one entry per corner tile with the
 * vein entity, its guardian dragon, and the current mine (if any) + owner team.
 */
class GoldMineCaptureSystem extends GUTS.BaseSystem {
    static services = [
        'autoSpawnGoldMines',
        'resolveGoldMineCaptures',
        'getGoldMinePositions',
        'getContestableObjectives'
    ];

    static serviceDependencies = [
        'getPlayerEntities',
        'spawnSquad',
        'tileToWorld',
        'worldToPlacementGrid',
        'getNearbyUnits',
        'applySquadTargetPosition',
        'broadcastToRoom',
        'getEconomyEffects'
    ];

    // Mirrored corners of the two starting locations (forest level).
    static MINE_TILES = [{ x: 56, z: 7 }, { x: 7, z: 56 }];
    static CAPTURE_RADIUS = 300;   // ~6 tiles around the vein — "holding" range
    static MINE_INCOME = 5;        // gold per standing mine per round (base round income is 10; tunable)
    static GUARDIAN_UNIT = 'dragon_red';   // hostile creep guarding each vein
    static GUARDIAN_OFFSET = 130;          // spawn this far map-center-ward of the vein
    static MINE_OCCUPY_RADIUS = 60;        // a mine within this range of a vein counts as "on" it (visibility)

    constructor(game) {
        super(game);
        this.game.goldMineCaptureSystem = this;
        // One entry per corner: { tile, world, veinEntityId, dragonEntityId, mineEntityId, ownerTeam }
        this._veins = [];
    }

    _auth() {
        return this.game.isServer || this.game.state?.isLocalGame;
    }

    // True only if the entity is alive AND not mid/post-death. A building damaged to
    // 0 HP can linger with entityAlive===1 until it's culled (and our mines aren't in
    // playerStats.buildings, so the building cull never removes them) — so checking
    // entityAlive alone would keep paying income for a destroyed mine. Mirrors
    // BuildingSystem._isAlive (entityAlive + health + deathState).
    _alive(eid) {
        if (eid == null || this.game.entityAlive?.[eid] !== 1) return false;
        const h = this.game.getComponent(eid, 'health');
        if (h && h.current <= 0) return false;
        const ds = this.game.getComponent(eid, 'deathState');
        if (ds && ds.state !== this.game.getEnums().deathState?.alive) return false;
        return true;
    }

    // Client-side only: hide a vein marker while a living mine building sits on it
    // (the mine model replaces it), and show it again once the mine is gone. Derived
    // purely from synced entity state so it works in both local and networked play.
    update() {
        if (this.game.app?.isServer || this.game.isHeadless) return;

        const enums = this.game.getEnums();
        const veinType = enums.worldObjects?.goldVein ?? -1;
        const veinColl = enums.objectTypeDefinitions?.worldObjects ?? -1;

        const r2 = GoldMineCaptureSystem.MINE_OCCUPY_RADIUS * GoldMineCaptureSystem.MINE_OCCUPY_RADIUS;

        for (const eid of this.game.getEntitiesWith('worldObject', 'transform')) {
            const ut = this.game.getComponent(eid, 'unitType');
            if (!ut || ut.type !== veinType || ut.collection !== veinColl) continue;
            const t = this.game.getComponent(eid, 'transform');
            if (!t?.scale) continue;

            const hidden = this._mineOccupies(t.position, r2);
            const target = hidden ? 0 : 1;
            if (t.scale.x !== target) {
                t.scale.x = target;
                t.scale.y = target;
                t.scale.z = target;
            }
        }
    }

    _mineOccupies(veinPos, r2) {
        const enums = this.game.getEnums();
        const mineType = enums.buildings?.goldMine ?? -1;
        const mineColl = enums.objectTypeDefinitions?.buildings ?? -1;
        for (const eid of this.game.getEntitiesWith('unitType', 'transform')) {
            const ut = this.game.getComponent(eid, 'unitType');
            if (!ut || ut.type !== mineType || ut.collection !== mineColl) continue;
            if (!this._alive(eid)) continue;
            const p = this.game.getComponent(eid, 'transform')?.position;
            if (!p) continue;
            const dx = p.x - veinPos.x, dz = p.z - veinPos.z;
            if (dx * dx + dz * dz <= r2) return true;
        }
        return false;
    }

    // Spawn the neutral veins + guardian dragons once at the start of the game
    // (round 1 only; idempotent — adopts any veins/mines that already exist, e.g.
    // after a save load). Keeps the legacy service name for the round-system hook.
    autoSpawnGoldMines() {
        if (!this._auth()) return;
        if ((this.game.state.round || 1) !== 1) return;

        this._adoptExisting();
        if (this._veins.length > 0) return;

        for (const tile of GoldMineCaptureSystem.MINE_TILES) {
            const world = this.call.tileToWorld(tile.x, tile.z);
            const veinEntityId = this._spawnVein(world);
            if (veinEntityId == null) {
                console.error('[GoldMineCapture] failed to spawn vein at', tile);
                continue;
            }
            const dragonEntityId = this._spawnGuardian(world);
            this._veins.push({
                tile,
                world: { x: world.x, z: world.z },
                veinEntityId,
                dragonEntityId,
                mineEntityId: null,
                ownerTeam: null
            });
        }
    }

    // Spawn a neutral goldVein worldObject (build site / map marker). worldObjects
    // flow through spawnSquad just like units/buildings (UnitCreationSystem maps the
    // worldObjects collection to a worldObject component).
    _spawnVein(world) {
        const enums = this.game.getEnums();
        const neutralTeam = enums.team?.neutral ?? 0;
        const collectionIndex = enums.objectTypeDefinitions?.worldObjects ?? -1;
        const typeIndex = enums.worldObjects?.goldVein ?? -1;
        const unitType = this.game.getUnitTypeDef({ collection: collectionIndex, type: typeIndex });
        if (!unitType) {
            console.error('[GoldMineCapture] goldVein worldObject def not found');
            return null;
        }
        const placement = {
            gridPosition: this.call.worldToPlacementGrid(world.x, world.z),
            unitTypeId: typeIndex,
            collection: collectionIndex,
            team: neutralTeam,
            isStartingState: true,
            unitType: { ...unitType, id: 'goldVein', collection: 'worldObjects' }
        };
        const result = this.call.spawnSquad(placement, neutralTeam, null, null);
        const entityId = result?.squad?.squadUnits?.[0];
        return (result?.success && entityId != null) ? entityId : null;
    }

    // A hostile dragon guards each vein: anchored defend order at its spawn, so it
    // fights anything entering its vision of the vein and returns home after (the
    // completed-move-order anchor mechanic). One-and-done: slain dragons never
    // respawn, permanently opening the vein for building. Returns its entity id so
    // we can later detect its death (the gate for auto-building).
    _spawnGuardian(veinWorldPos) {
        const enums = this.game.getEnums();
        const hostileTeam = enums.team?.hostile;
        if (hostileTeam == null) {
            console.error('[GoldMineCapture] no hostile team in enums — skipping guardian');
            return null;
        }
        const collectionIndex = enums.objectTypeDefinitions?.units ?? -1;
        const typeIndex = enums.units?.[GoldMineCaptureSystem.GUARDIAN_UNIT] ?? -1;
        const unitType = this.game.getUnitTypeDef({ collection: collectionIndex, type: typeIndex });
        if (!unitType) {
            console.error('[GoldMineCapture] guardian def not found:', GoldMineCaptureSystem.GUARDIAN_UNIT);
            return null;
        }

        // Spawn between the vein and the map center so it screens the approach.
        const len = Math.hypot(veinWorldPos.x, veinWorldPos.z) || 1;
        const pos = {
            x: veinWorldPos.x - (veinWorldPos.x / len) * GoldMineCaptureSystem.GUARDIAN_OFFSET,
            z: veinWorldPos.z - (veinWorldPos.z / len) * GoldMineCaptureSystem.GUARDIAN_OFFSET
        };
        const placement = {
            gridPosition: this.call.worldToPlacementGrid(pos.x, pos.z),
            unitTypeId: typeIndex,
            collection: collectionIndex,
            team: hostileTeam,
            isStartingState: true,
            unitType: { ...unitType, id: GoldMineCaptureSystem.GUARDIAN_UNIT, collection: 'units' }
        };
        const result = this.call.spawnSquad(placement, hostileTeam, null, null);
        const placementId = result?.squad?.placementId;
        const entityId = result?.squad?.squadUnits?.[0];
        if (!result?.success || placementId == null) {
            console.error('[GoldMineCapture] failed to spawn guardian', result?.error);
            return null;
        }

        // Defend anchor at the spawn spot (completes instantly — see
        // FindNearestEnemy/HasTarget anchor handling). Mirror to online clients
        // through the same broadcast standing orders use.
        this.call.applySquadTargetPosition(placementId,
            { x: pos.x, z: pos.z }, { isMoveOrder: true }, this.game.state.now);
        if (!this.game.state.isLocalGame) {
            this.call.broadcastToRoom(null, 'OPPONENT_SQUAD_TARGETS_SET', {
                placementIds: [placementId],
                targetPositions: [{ x: pos.x, z: pos.z }],
                meta: { isMoveOrder: true },
                issuedTime: this.game.state.now
            });
        }
        return entityId;
    }

    // World positions of every living vein — used by anything that just needs the
    // vein locations. Order follows _veins (stable) for deterministic tie-breaks.
    getGoldMinePositions() {
        const out = [];
        for (const vein of this._veins) {
            const pos = this._veinPos(vein);
            if (pos) out.push({ entityId: vein.veinEntityId, x: pos.x, z: pos.z });
        }
        return out;
    }

    // The objectives `team` should contest, in stable order:
    //   • vein with a living dragon  → kill it (entity = dragon)
    //   • dragon-free vein with no mine, OR with an enemy mine → take/destroy it
    //     (entity = enemy mine if one stands, else the vein)
    // Veins where `team` already owns a standing mine are skipped (nothing to do).
    // The AI issues plain move orders at these; FindNearestEnemy handles whether
    // the units end up fighting the dragon, the enemy mine, or simply holding.
    getContestableObjectives(team) {
        const out = [];
        for (const vein of this._veins) {
            const pos = this._veinPos(vein);
            if (!pos) continue;

            const mineAlive = this._alive(vein.mineEntityId);
            const dragonAlive = this._alive(vein.dragonEntityId);

            if (mineAlive) {
                if (vein.ownerTeam === team) continue;   // already ours
                out.push({ entityId: vein.mineEntityId, x: pos.x, z: pos.z });
            } else if (dragonAlive) {
                out.push({ entityId: vein.dragonEntityId, x: pos.x, z: pos.z });
            } else {
                out.push({ entityId: vein.veinEntityId, x: pos.x, z: pos.z });
            }
        }
        return out;
    }

    // Round-end resolution (called after battle, before heroes despawn):
    //   1. Pay flat income for every mine that survived the battle.
    //   2. Free any vein whose mine was destroyed this battle.
    //   3. Auto-build a mine for the team holding a dragon-free, mine-free vein.
    // Keeps the legacy service name for the round-system hook. Deterministic.
    resolveGoldMineCaptures() {
        if (!this._auth()) return;
        const enums = this.game.getEnums();
        const reverseEnums = this.game.getReverseEnums();
        const neutralTeam = enums.team?.neutral ?? 0;

        for (const vein of this._veins) {
            // 1. Standing mine → income to its owner.
            if (vein.mineEntityId != null && this._alive(vein.mineEntityId)) {
                this._grantIncome(vein, reverseEnums);
                continue;
            }

            // 2. Mine was destroyed this battle → free the vein.
            if (vein.mineEntityId != null) {
                this._onMineDestroyed(vein, reverseEnums);
            }

            // 3. Dragon must be dead before anyone can build.
            if (this._alive(vein.dragonEntityId)) {
                continue;
            }

            // Strict-majority holder (living, non-building player units in range) builds.
            const winner = this._holdingTeam(vein, neutralTeam, enums);
            if (winner == null) continue;
            this._buildMineFor(winner, vein, enums, reverseEnums);
        }
    }

    // Living, non-building left/right unit with the strict-most presence in range
    // wins the vein. Ties (incl. 0-0) win nothing. Deterministic (sorted teams).
    _holdingTeam(vein, neutralTeam, enums) {
        const pos = this._veinPos(vein);
        if (!pos) return null;

        const counts = new Map();
        const nearby = this.call.getNearbyUnits(
            { x: pos.x, y: 0, z: pos.z }, GoldMineCaptureSystem.CAPTURE_RADIUS, null) || [];
        for (const id of nearby) {
            if (this.game.entityAlive?.[id] !== 1) continue;
            if (this.game.getComponent(id, 'buildingOwner')) continue; // buildings don't hold
            const team = this.game.getComponent(id, 'team')?.team;
            if (team == null || team === neutralTeam) continue;
            const health = this.game.getComponent(id, 'health');
            if (!health || health.current <= 0) continue;
            const ds = this.game.getComponent(id, 'deathState');
            if (ds && ds.state !== enums.deathState?.alive) continue;
            counts.set(team, (counts.get(team) || 0) + 1);
        }

        let winner = null, best = 0, tie = false;
        for (const [team, count] of [...counts.entries()].sort((a, b) => a[0] - b[0])) {
            if (count > best) { winner = team; best = count; tie = false; }
            else if (count === best) tie = true;
        }
        if (winner == null || best === 0 || tie) return null;
        return winner;
    }

    // Auto-construct a goldMine building for `team` on the vein. It's a normal team
    // building (attackable by the enemy) tagged with buildingOwner so unit tallies
    // and building systems treat it as a building. roundPlaced 0 => never draggable.
    _buildMineFor(team, vein, enums, reverseEnums) {
        const pos = this._veinPos(vein);
        if (!pos) return;

        const collectionIndex = enums.objectTypeDefinitions?.buildings ?? -1;
        const typeIndex = enums.buildings?.goldMine ?? -1;
        const unitType = this.game.getUnitTypeDef({ collection: collectionIndex, type: typeIndex });
        if (!unitType) {
            console.error('[GoldMineCapture] goldMine building def not found');
            return;
        }

        const stats = this._playerStatsForTeam(team);
        const placement = {
            gridPosition: this.call.worldToPlacementGrid(pos.x, pos.z),
            unitTypeId: typeIndex,
            collection: collectionIndex,
            team,
            isStartingState: true,
            unitType: { ...unitType, id: 'goldMine', collection: 'buildings' }
        };
        const result = this.call.spawnSquad(placement, team, stats?.playerId ?? null, null);
        const entityId = result?.squad?.squadUnits?.[0];
        if (!result?.success || entityId == null) {
            console.error('[GoldMineCapture] failed to build mine', result?.error);
            return;
        }

        this.game.addComponent(entityId, 'buildingOwner', {
            playerId: stats?.playerId ?? null,
            buildingId: 'goldMine',
            placementId: result.squad.placementId,
            roundPlaced: 0
        });

        vein.mineEntityId = entityId;
        vein.ownerTeam = team;

        this.game.triggerEvent('onGoldMineBuilt', {
            team,
            teamName: reverseEnums.team?.[team] || String(team),
            playerId: stats?.playerId ?? null,
            mineEntityId: entityId
        });
    }

    _onMineDestroyed(vein, reverseEnums) {
        const lostTeam = vein.ownerTeam;
        const stats = lostTeam != null ? this._playerStatsForTeam(lostTeam) : null;
        vein.mineEntityId = null;
        vein.ownerTeam = null;
        this.game.triggerEvent('onGoldMineDestroyed', {
            team: lostTeam,
            teamName: lostTeam != null ? (reverseEnums.team?.[lostTeam] || String(lostTeam)) : null,
            playerId: stats?.playerId ?? null
        });
    }

    _grantIncome(vein, reverseEnums) {
        const stats = this._playerStatsForTeam(vein.ownerTeam);
        if (!stats) return;
        // Base mine income + the owner's Prospecting (economy tree) bonus, if any.
        const bonus = this.call.getEconomyEffects?.(stats)?.mineIncomeBonus || 0;
        const amount = GoldMineCaptureSystem.MINE_INCOME + bonus;
        stats.gold = (stats.gold || 0) + amount;
        this.game.triggerEvent('onGoldMineIncome', {
            team: vein.ownerTeam,
            teamName: reverseEnums.team?.[vein.ownerTeam] || String(vein.ownerTeam),
            playerId: stats.playerId,
            gold: amount,
            mineEntityId: vein.mineEntityId
        });
    }

    _playerStatsForTeam(team) {
        for (const peid of this.call.getPlayerEntities()) {
            const stats = this.game.getComponent(peid, 'playerStats');
            if (stats?.team === team) return stats;
        }
        return null;
    }

    _veinPos(vein) {
        const t = this.game.getComponent(vein.veinEntityId, 'transform')?.position;
        return t || vein.world || null;
    }

    // On reload, re-link veins, any standing mines, and surviving dragons so income
    // and free-vein logic keep working across a save/load.
    _adoptExisting() {
        if (this._veins.length > 0) return;
        const enums = this.game.getEnums();
        const veinType = enums.worldObjects?.goldVein ?? -1;
        const veinColl = enums.objectTypeDefinitions?.worldObjects ?? -1;
        const mineType = enums.buildings?.goldMine ?? -1;
        const mineColl = enums.objectTypeDefinitions?.buildings ?? -1;
        const guardianType = enums.units?.[GoldMineCaptureSystem.GUARDIAN_UNIT] ?? -1;
        const unitColl = enums.objectTypeDefinitions?.units ?? -1;
        const neutralTeam = enums.team?.neutral ?? 0;

        // Collect veins.
        for (const eid of this.game.getEntitiesWith('unitType', 'transform')) {
            const ut = this.game.getComponent(eid, 'unitType');
            if (ut?.type !== veinType || ut?.collection !== veinColl) continue;
            const p = this.game.getComponent(eid, 'transform')?.position;
            if (!p) continue;
            this._veins.push({
                tile: null,
                world: { x: p.x, z: p.z },
                veinEntityId: eid,
                dragonEntityId: null,
                mineEntityId: null,
                ownerTeam: null
            });
        }
        if (this._veins.length === 0) return;

        // Attach the nearest standing mine / surviving dragon to each vein.
        const r2 = GoldMineCaptureSystem.MINE_OCCUPY_RADIUS * GoldMineCaptureSystem.MINE_OCCUPY_RADIUS;
        const guardR2 = (GoldMineCaptureSystem.GUARDIAN_OFFSET * 2) * (GoldMineCaptureSystem.GUARDIAN_OFFSET * 2);
        for (const eid of this.game.getEntitiesWith('unitType', 'transform')) {
            const ut = this.game.getComponent(eid, 'unitType');
            const p = this.game.getComponent(eid, 'transform')?.position;
            if (!p) continue;

            if (ut?.type === mineType && ut?.collection === mineColl) {
                const vein = this._nearestVein(p, r2);
                if (vein && vein.mineEntityId == null) {
                    vein.mineEntityId = eid;
                    vein.ownerTeam = this.game.getComponent(eid, 'team')?.team ?? null;
                }
            } else if (ut?.type === guardianType && ut?.collection === unitColl
                && this.game.getComponent(eid, 'team')?.team !== neutralTeam) {
                const vein = this._nearestVein(p, guardR2);
                if (vein && vein.dragonEntityId == null) vein.dragonEntityId = eid;
            }
        }
    }

    _nearestVein(pos, maxR2) {
        let best = null, bestD = maxR2;
        for (const vein of this._veins) {
            const vp = this._veinPos(vein);
            if (!vp) continue;
            const dx = vp.x - pos.x, dz = vp.z - pos.z;
            const d = dx * dx + dz * dz;
            if (d <= bestD) { bestD = d; best = vein; }
        }
        return best;
    }
}
