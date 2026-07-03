// Manages each player's hero party across rounds.
// Spawns hero entities at prep phase start and despawns them after battle.
// Each hero roster entry stores: { heroClass, roundsPlayed, level }.
// Hero entities are created fresh each round; all combat/health stats come
// directly from the class's unitType definition (see CLASS_SPAWN_MAP).
class HeroRosterSystem extends GUTS.BaseSystem {

    static services = [
        'spawnHeroesForRound',
        'spawnPurchasedUnit',
        'respawnRosterEntry',
        'removeRosterEntry',
        'despawnBattleHeroes',
        'getHeroEntityId',
        'getHeroEntityIds',
        'getRosterEntryForEntity',
        'snapshotHeroPositions',
        'reapplyStandingOrders',
        'isUnitLocked',
        'setSquadFormation'
    ];

    static serviceDependencies = [
        'getPlayerEntities',
        'spawnHeroUnitsForTeam',
        'replaceUnit',
        'applyArmyUpgrades',
        'applyArmyAbilities',
        'applyLeaderBonuses',
        'applyLevelScaling',
        'applySquadTargetPosition',
        'getStartingLocationsFromLevel',
        'tileToWorld'
    ];

    static CLASS_SPAWN_MAP = {
        barbarian:  '1_s_barbarian',
        apprentice: '1_i_apprentice',
        archer:     '1_d_archer',
        acolyte:    '1_is_acolyte',
        soldier:    '1_sd_soldier',
        scout:      '1_di_scout'
    };

    // Linear hero level: hero starts at level 1, gains 1 level per round survived.
    static MAX_LEVEL = 30;

    constructor(game) {
        super(game);
        this.game.heroRosterSystem = this;
        // Array of { entityId, playerId, rosterIndex } for all heroes on the battlefield
        this.battleHeroEntities = [];
        // Fast lookup: entityId → { playerId, rosterIndex }
        this._entityToRoster = new Map();
    }

    // Called by AutobattlerRoundSystem before each prep phase.
    spawnHeroesForRound() {
        const playerEntities = this.call.getPlayerEntities();

        for (const playerEntityId of playerEntities) {
            const stats = this.game.getComponent(playerEntityId, 'playerStats');
            if (!stats || !Array.isArray(stats.heroRoster) || stats.heroRoster.length === 0) continue;

            const spawnTypes = stats.heroRoster
                .map(entry => HeroRosterSystem.resolveSpawnType(entry))
                .filter(Boolean);

            if (spawnTypes.length === 0) continue;

            const result = this.call.spawnHeroUnitsForTeam(spawnTypes, stats.team);
            if (!result?.units) continue;

            result.units.forEach((u, rosterIndex) => this._registerSpawnedUnit(stats, u, rosterIndex));
        }
    }

    // Spawn a single just-purchased roster entry into the CURRENT prep phase, so the
    // player can position it before battle. Called by ArmyShopSystem on a buy.
    spawnPurchasedUnit(numericPlayerId, rosterIndex) {
        const playerEntities = this.call.getPlayerEntities();
        for (const playerEntityId of playerEntities) {
            const stats = this.game.getComponent(playerEntityId, 'playerStats');
            if (!stats || stats.playerId !== numericPlayerId) continue;
            const entry = stats.heroRoster?.[rosterIndex];
            if (!entry) return { success: false, reason: 'no_entry' };
            const spawnType = HeroRosterSystem.resolveSpawnType(entry);
            if (!spawnType) return { success: false, reason: 'no_spawn_type' };
            const result = this.call.spawnHeroUnitsForTeam([spawnType], stats.team);
            const u = result?.units?.[0];
            if (!u) return { success: false, reason: 'spawn_failed' };
            this._registerSpawnedUnit(stats, u, rosterIndex);
            return { success: true };
        }
        return { success: false, reason: 'no_player' };
    }

    // Transform the live unit for a roster index into its (possibly changed) entry
    // unit type — used when a unit specializes. Uses the engine's replaceUnit so the
    // render instance is properly swapped (removeInstance + createPlacement, same
    // entity id) and position/HP% are preserved; then re-applies hero tagging/bonuses
    // since replaceUnit rebuilds the entity from the new unit definition.
    respawnRosterEntry(numericPlayerId, rosterIndex, animationType = null) {
        const stats = this._statsByPlayerId(numericPlayerId);
        const entry = stats?.heroRoster?.[rosterIndex];
        if (!entry) return { success: false, reason: 'no_entry' };
        const newSpawnType = HeroRosterSystem.resolveSpawnType(entry);
        if (!newSpawnType) return { success: false, reason: 'no_spawn_type' };

        const liveIds = this.getHeroEntityIds(numericPlayerId, rosterIndex);
        if (liveIds.length > 0 && this.game.hasService?.('replaceUnit')) {
            let ok = 0;
            for (const liveId of liveIds) {
                const newId = this.call.replaceUnit(liveId, newSpawnType,
                    animationType ? { animationType } : undefined);
                if (newId == null) continue;
                ok++;
                const level = entry.level || this._calcLevel(entry.roundsPlayed || 0);
                this._tagHeroEntity(newId, numericPlayerId, rosterIndex, level);
                // replaceUnit reuses the same id, so the battle-hero mapping still holds;
                // guard in case a future impl returns a fresh id.
                if (!this._entityToRoster.has(newId)) {
                    this.battleHeroEntities.push({ entityId: newId, playerId: numericPlayerId, rosterIndex });
                    this._entityToRoster.set(newId, { playerId: numericPlayerId, rosterIndex });
                }
            }
            if (ok > 0) return { success: true };
        }
        // Not on the field (or replaceUnit unavailable) → spawn a fresh copy.
        return this.spawnPurchasedUnit(numericPlayerId, rosterIndex);
    }

    // Apply hero-specific components/bonuses to a (re)created hero entity.
    _tagHeroEntity(entityId, playerId, rosterIndex, level) {
        this.game.addComponent(entityId, 'heroRosterInfo', { playerId, rosterIndex, level });
        // NOTE: heroes use their unit-def visionRange/awareness like everyone
        // else. The old "see the whole battlefield" override (visionRange
        // 99999) predates fog of war and broke it completely: every hero
        // acquired cross-map targets at battle start, ignored its move orders
        // (the order tree yields whenever an enemy is "in vision"), and chase
        // leashes — measured in vision range — never released.
        // Per-level scaling, then per-type upgrades + granted abilities.
        this.call.applyLevelScaling?.(entityId);
        this.call.applyArmyUpgrades?.(entityId);
        this.call.applyArmyAbilities?.(entityId);
        // Leader passive (archetype-targeted stat bonus); composes with the above.
        this.call.applyLeaderBonuses?.(entityId);
    }

    // Re-apply each hero's persisted order (snapshotted at last battle start)
    // to its fresh respawn, so orders repeat round to round until the player
    // changes or clears them. Returns what was applied so the caller can
    // mirror it to online clients via the squad-targets broadcast.
    reapplyStandingOrders() {
        const applied = { placementIds: [], targetPositions: [] };
        for (const { entityId, playerId, rosterIndex } of this.battleHeroEntities) {
            const stats = this._statsByPlayerId(playerId);
            const order = stats?.heroRoster?.[rosterIndex]?.standingOrder;
            if (!order) continue;
            const placementId = this.game.getComponent(entityId, 'placement')?.placementId;
            if (placementId == null) continue;
            this.call.applySquadTargetPosition(placementId,
                { x: order.x, z: order.z }, { isMoveOrder: true }, this.game.state.now);
            applied.placementIds.push(placementId);
            applied.targetPositions.push({ x: order.x, z: order.z });
        }
        return applied;
    }

    _statsByPlayerId(numericPlayerId) {
        for (const entityId of this.call.getPlayerEntities()) {
            const stats = this.game.getComponent(entityId, 'playerStats');
            if (stats?.playerId === numericPlayerId) return stats;
        }
        return null;
    }

    // Tag + position a freshly spawned squad and record it as a battle hero.
    _registerSpawnedUnit(stats, u, rosterIndex) {
        if (!u.squadUnits) return;
        const rosterEntry = stats.heroRoster[rosterIndex] || {};
        // Level is XP-driven (HeroExperienceSystem) and stored on the roster entry;
        // fall back to the legacy rounds-survived curve for entries without XP yet.
        const level       = rosterEntry.level || this._calcLevel(rosterEntry.roundsPlayed || 0);

        const def = this.collections.units?.[HeroRosterSystem.resolveSpawnType(rosterEntry)] || {};
        const fw = rosterEntry.formation?.w || def.squadWidth || 1;
        const fh = rosterEntry.formation?.h || def.squadHeight || 1;
        const basis = this.formationBasis(stats.team);

        // Anchor: saved battle position for veterans, the fresh spawn's own
        // centroid for new buys (either way, members form up around it facing
        // the enemy — never the world-aligned single file spawnSquad produces).
        let anchor = rosterEntry.lastPosition;
        if (!anchor) {
            let cx = 0, cz = 0, n = 0;
            for (const id of u.squadUnits) {
                const p = this.game.getComponent(id, 'transform')?.position;
                if (!p) continue;
                cx += p.x; cz += p.z; n++;
            }
            if (n > 0) anchor = { x: cx / n, z: cz / n };
        }
        // Snap the anchor to a deployment cell center — member offsets are
        // whole cells, so every spawned unit lands exactly on the grid and
        // its selection square is centered.
        if (anchor) {
            const CELL = 24.5;
            anchor = {
                x: Math.floor(anchor.x / CELL) * CELL + CELL / 2,
                z: Math.floor(anchor.z / CELL) * CELL + CELL / 2
            };
        }

        u.squadUnits.forEach((entityId, memberIndex) => {
            // Tag with roster info + apply autobattler vision, level scaling, upgrades, abilities.
            this._tagHeroEntity(entityId, stats.playerId, rosterIndex, level);

            if (anchor && this.game.placementSystem) {
                const off = HeroRosterSystem.memberOffset(memberIndex, fw, fh, basis);
                this.game.placementSystem.moveHero(
                    entityId, anchor.x + off.x, anchor.z + off.z);
            }

            this.battleHeroEntities.push({ entityId, playerId: stats.playerId, rosterIndex });
            this._entityToRoster.set(entityId, { playerId: stats.playerId, rosterIndex });
        });
    }

    // Rearrange a squad's live members into a w x h grid around their current
    // centroid, and persist the choice on the roster entry so every future
    // respawn keeps it. Prep-phase only; locked (fought) squads hold formation.
    setSquadFormation(numericPlayerId, rosterIndex, w, h) {
        if (this.game.state.phase !== this.enums.gamePhase.placement) {
            return { success: false, reason: 'wrong_phase' };
        }
        const stats = this._statsByPlayerId(numericPlayerId);
        const entry = stats?.heroRoster?.[rosterIndex];
        if (!entry) return { success: false, reason: 'no_entry' };
        if (entry.lastPosition) return { success: false, reason: 'deployment_locked' };

        const members = this.getHeroEntityIds(numericPlayerId, rosterIndex);
        if (members.length === 0) return { success: false, reason: 'not_on_field' };
        const W = Math.max(1, w | 0), H = Math.max(1, h | 0);
        if (W * H < members.length) return { success: false, reason: 'formation_too_small' };

        entry.formation = { w: W, h: H };

        // Reposition around the current centroid, SNAPPED to a cell center —
        // offsets are whole cells, so every member lands exactly on the grid.
        const CELL = 24.5;
        let cx = 0, cz = 0;
        for (const id of members) {
            const p = this.game.getComponent(id, 'transform')?.position;
            cx += p?.x || 0; cz += p?.z || 0;
        }
        cx /= members.length; cz /= members.length;
        cx = Math.floor(cx / CELL) * CELL + CELL / 2;
        cz = Math.floor(cz / CELL) * CELL + CELL / 2;

        const basis = this.formationBasis(stats.team);
        const moves = [];
        members.forEach((id, i) => {
            const off = HeroRosterSystem.memberOffset(i, W, H, basis);
            this.game.placementSystem?.moveHero(id, cx + off.x, cz + off.z);
            moves.push({ entityId: id, x: cx + off.x, z: cz + off.z });
        });
        return { success: true, formation: { w: W, h: H }, moves };
    }

    // Squad members stand in a width x depth grid around the anchor (30 world
    // units apart). WIDTH runs across the battlefield (shoulder to shoulder,
    // facing the enemy) and DEPTH runs toward the enemy — pass the team's
    // formation basis to orient it; defaults to world axes (across = z).
    static memberOffset(memberIndex, squadWidth, squadHeight, basis = null) {
        const w = Math.max(1, squadWidth | 0), h = Math.max(1, squadHeight | 0);
        if (w * h <= 1) return { x: 0, z: 0 };
        const SPACING = 24.5;   // one deployment cell — members sit on adjacent cells
        const col = memberIndex % w, row = Math.floor(memberIndex / w);
        // INTEGER cell steps (even widths must not straddle half-cells: every
        // member has to land on a grid cell center for the markers to line up)
        const ax = (col - Math.floor((w - 1) / 2)) * SPACING;   // across the line
        const az = (row - Math.floor((h - 1) / 2)) * SPACING;   // toward the enemy
        const b = basis || { across: { x: 0, z: 1 }, forward: { x: 1, z: 0 } };
        return {
            x: b.across.x * ax + b.forward.x * az,
            z: b.across.z * ax + b.forward.z * az
        };
    }

    // Formation basis for a team: forward points at the enemy start, across is
    // its perpendicular — squads line up shoulder to shoulder facing the enemy.
    formationBasis(team) {
        const locs = this.call.getStartingLocationsFromLevel?.();
        if (locs && locs[team] != null) {
            const enemyTeam = Object.keys(locs).map(Number).find(t => t !== team);
            if (enemyTeam != null && locs[enemyTeam] != null) {
                const my = this.call.tileToWorld(locs[team].x, locs[team].z);
                const en = this.call.tileToWorld(locs[enemyTeam].x, locs[enemyTeam].z);
                const dx = en.x - my.x, dz = en.z - my.z;
                const len = Math.hypot(dx, dz) || 1;
                const f = { x: dx / len, z: dz / len };
                return { across: { x: -f.z, z: f.x }, forward: f };
            }
        }
        return { across: { x: 0, z: 1 }, forward: { x: 1, z: 0 } };
    }

    // Resolve a roster entry → unit spawnType. entry.spawnType is authoritative
    // (set for starter picks, shop buys, AND specializations); CLASS_SPAWN_MAP is
    // only a fallback for legacy entries that predate the spawnType field. This
    // ordering matters: a specialized starter keeps heroClass:'archer' but its
    // spawnType becomes e.g. '2_d_ranger' — spawnType must win.
    static resolveSpawnType(entry) {
        if (!entry) return null;
        return entry.spawnType
            || HeroRosterSystem.CLASS_SPAWN_MAP[entry.heroClass]
            || entry.heroClass
            || entry;
    }

    // Called by ServerBattlePhaseSystem.startBattle right before combat begins.
    // Records each live hero's current transform position to the roster entry so
    // their next-round spawn uses that position instead of the team default.
    snapshotHeroPositions() {
        if (!this.game.isServer && !this.game.state?.isLocalGame) return;

        // A squad's saved anchor is its FIRST member's position — member 0 has
        // offset (0,0), so next round's respawn reproduces the exact layout on
        // the same grid cells. (A centroid lands on cell BOUNDARIES for even
        // member counts, drifting units off their selection squares.)
        const seen = new Set();
        for (const { entityId, playerId, rosterIndex } of this.battleHeroEntities) {
            const key = `${playerId}:${rosterIndex}`;
            if (seen.has(key)) continue;
            const pos = this.game.getComponent(entityId, 'transform')?.position;
            if (!pos) continue;
            seen.add(key);
            const stats = this._statsByPlayerId(playerId);
            const entry = stats?.heroRoster?.[rosterIndex];
            if (entry) entry.lastPosition = { x: pos.x, z: pos.z };
        }
    }

    // Called by AutobattlerRoundSystem after battle resolves.
    // Increments roundsPlayed on each roster entry, then destroys the entities.
    despawnBattleHeroes() {
        const playerEntities = this.call.getPlayerEntities();

        for (const { entityId, playerId, rosterIndex } of this.battleHeroEntities) {
            for (const playerEntityId of playerEntities) {
                const stats = this.game.getComponent(playerEntityId, 'playerStats');
                if (!stats || stats.playerId !== playerId) continue;

                const rosterEntry = stats.heroRoster?.[rosterIndex];
                if (rosterEntry) {
                    rosterEntry.roundsPlayed = (rosterEntry.roundsPlayed || 0) + 1;
                }
                break;
            }

            try { this.game.destroyEntity(entityId); } catch (_) {}
        }

        this.battleHeroEntities = [];
        this._entityToRoster.clear();

        // Also clean up any summoned units (wolves, etc) so they don't stack
        // round after round. Anything tagged with the `summoned` component is
        // a per-battle entity owned by a hero ability — it should not persist.
        const summoned = this.game.getEntitiesWith('summoned') || [];
        for (const eid of summoned) {
            try { this.game.destroyEntity(eid); } catch (_) {}
        }
    }

    // Returns the current entityId for a player's hero at the given roster index
    // (first squad member for multi-member squads).
    getHeroEntityId(playerId, rosterIndex) {
        for (const entry of this.battleHeroEntities) {
            if (entry.playerId === playerId && entry.rosterIndex === rosterIndex) {
                return entry.entityId;
            }
        }
        return null;
    }

    // All live member entityIds of a roster entry (a squad is 1..N entities).
    getHeroEntityIds(playerId, rosterIndex) {
        const ids = [];
        for (const entry of this.battleHeroEntities) {
            if (entry.playerId === playerId && entry.rosterIndex === rosterIndex) {
                ids.push(entry.entityId);
            }
        }
        return ids;
    }

    // Returns { playerId, rosterIndex } for an entity, or null if not a battle hero.
    getRosterEntryForEntity(entityId) {
        return this._entityToRoster.get(entityId) || null;
    }

    // Deployment is permanent: a unit that has fought a battle (its roster entry
    // carries a snapshotted lastPosition) can no longer be repositioned or sold.
    // Units bought this prep have no lastPosition yet and are freely placeable.
    isUnitLocked(entityId) {
        // Campaign: every node is a fresh field — nothing is ever locked.
        if (this.game.campaignRunSystem?.isCampaignMode?.()) return false;
        const ref = this._entityToRoster.get(entityId);
        if (!ref) return false;
        const stats = this._statsByPlayerId(ref.playerId);
        const entry = stats?.heroRoster?.[ref.rosterIndex];
        return !!entry?.lastPosition;
    }

    // Remove a roster entry (used by ArmyShopSystem.sellUnit): splice it out, despawn
    // its live unit, and shift every higher index down by one — on the roster, on the
    // live entities' heroRosterInfo components, and in this system's tracking maps —
    // so indices stay consistent for the rest of this prep and next round's respawn.
    removeRosterEntry(numericPlayerId, rosterIndex) {
        const stats = this._statsByPlayerId(numericPlayerId);
        if (!stats || !Array.isArray(stats.heroRoster)) return { success: false, reason: 'no_roster' };
        if (rosterIndex < 0 || rosterIndex >= stats.heroRoster.length) {
            return { success: false, reason: 'bad_index' };
        }

        // Despawn every live squad member for this entry, if on the field.
        for (const liveId of this.getHeroEntityIds(numericPlayerId, rosterIndex)) {
            try { this.game.destroyEntity(liveId); } catch (_) {}
        }

        // Drop the roster entry.
        stats.heroRoster.splice(rosterIndex, 1);

        // Reconcile battle-hero tracking: drop the removed hero, shift higher indices.
        const next = [];
        this._entityToRoster.clear();
        for (const e of this.battleHeroEntities) {
            if (e.playerId === numericPlayerId && e.rosterIndex === rosterIndex) continue; // removed
            if (e.playerId === numericPlayerId && e.rosterIndex > rosterIndex) {
                e.rosterIndex -= 1;
                const info = this.game.getComponent(e.entityId, 'heroRosterInfo');
                if (info) info.rosterIndex = e.rosterIndex;
            }
            next.push(e);
            this._entityToRoster.set(e.entityId, { playerId: e.playerId, rosterIndex: e.rosterIndex });
        }
        this.battleHeroEntities = next;
        return { success: true };
    }

    // ─── Private helpers ─────────────────────────────────────────────────────

    _calcLevel(roundsPlayed) {
        // Smooth linear progression: round 1 → level 1, round 5 → level 5, etc.
        // Capped so endgame scaling stays sane.
        const r = Math.max(0, roundsPlayed | 0);
        return Math.max(1, Math.min(HeroRosterSystem.MAX_LEVEL, r + 1));
    }
}
