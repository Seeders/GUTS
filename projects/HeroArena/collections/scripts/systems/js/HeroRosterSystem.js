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
        'despawnBattleHeroes',
        'getHeroEntityId',
        'getRosterEntryForEntity',
        'snapshotHeroPositions'
    ];

    static serviceDependencies = [
        'getPlayerEntities',
        'spawnHeroUnitsForTeam',
        'replaceUnit',
        'applyArmyUpgrades',
        'applyArmyAbilities',
        'applyLevelScaling'
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
    respawnRosterEntry(numericPlayerId, rosterIndex) {
        const stats = this._statsByPlayerId(numericPlayerId);
        const entry = stats?.heroRoster?.[rosterIndex];
        if (!entry) return { success: false, reason: 'no_entry' };
        const newSpawnType = HeroRosterSystem.resolveSpawnType(entry);
        if (!newSpawnType) return { success: false, reason: 'no_spawn_type' };

        const liveId = this.getHeroEntityId(numericPlayerId, rosterIndex);
        if (liveId != null && this.game.hasService?.('replaceUnit')) {
            const newId = this.call.replaceUnit(liveId, newSpawnType);
            if (newId != null) {
                const level = entry.level || this._calcLevel(entry.roundsPlayed || 0);
                this._tagHeroEntity(newId, numericPlayerId, rosterIndex, level);
                // replaceUnit reuses the same id, so the battle-hero mapping still holds;
                // guard in case a future impl returns a fresh id.
                if (!this._entityToRoster.has(newId)) {
                    this.battleHeroEntities.push({ entityId: newId, playerId: numericPlayerId, rosterIndex });
                    this._entityToRoster.set(newId, { playerId: numericPlayerId, rosterIndex });
                }
                return { success: true };
            }
        }
        // Not on the field (or replaceUnit unavailable) → spawn a fresh copy.
        return this.spawnPurchasedUnit(numericPlayerId, rosterIndex);
    }

    // Apply hero-specific components/bonuses to a (re)created hero entity.
    _tagHeroEntity(entityId, playerId, rosterIndex, level) {
        this.game.addComponent(entityId, 'heroRosterInfo', { playerId, rosterIndex, level });
        // Autobattler: heroes see the whole battlefield so they chase the nearest enemy.
        const combat = this.game.getComponent(entityId, 'combat');
        if (combat) {
            combat.visionRange = 99999;
            combat.awareness   = 100;
        }
        // Per-level scaling, then per-type upgrades + granted abilities.
        this.call.applyLevelScaling?.(entityId);
        this.call.applyArmyUpgrades?.(entityId);
        this.call.applyArmyAbilities?.(entityId);
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

        u.squadUnits.forEach(entityId => {
            // Tag with roster info + apply autobattler vision, level scaling, upgrades, abilities.
            this._tagHeroEntity(entityId, stats.playerId, rosterIndex, level);

            // If the player positioned this hero last round (via drag), respawn
            // them at the saved spot instead of the default starting location.
            if (rosterEntry.lastPosition && this.game.placementSystem) {
                this.game.placementSystem.moveHero(
                    entityId,
                    rosterEntry.lastPosition.x,
                    rosterEntry.lastPosition.z
                );
            }

            this.battleHeroEntities.push({ entityId, playerId: stats.playerId, rosterIndex });
            this._entityToRoster.set(entityId, { playerId: stats.playerId, rosterIndex });
        });
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
        const playerEntities = this.call.getPlayerEntities();

        for (const { entityId, playerId, rosterIndex } of this.battleHeroEntities) {
            const transform = this.game.getComponent(entityId, 'transform');
            const pos = transform?.position;
            if (!pos) continue;

            for (const peid of playerEntities) {
                const stats = this.game.getComponent(peid, 'playerStats');
                if (stats && stats.playerId === playerId) {
                    const entry = stats.heroRoster?.[rosterIndex];
                    if (entry) {
                        entry.lastPosition = { x: pos.x, z: pos.z };
                    }
                    break;
                }
            }
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

    // Returns the current entityId for a player's hero at the given roster index.
    getHeroEntityId(playerId, rosterIndex) {
        for (const entry of this.battleHeroEntities) {
            if (entry.playerId === playerId && entry.rosterIndex === rosterIndex) {
                return entry.entityId;
            }
        }
        return null;
    }

    // Returns { playerId, rosterIndex } for an entity, or null if not a battle hero.
    getRosterEntryForEntity(entityId) {
        return this._entityToRoster.get(entityId) || null;
    }

    // ─── Private helpers ─────────────────────────────────────────────────────

    _calcLevel(roundsPlayed) {
        // Smooth linear progression: round 1 → level 1, round 5 → level 5, etc.
        // Capped so endgame scaling stays sane.
        const r = Math.max(0, roundsPlayed | 0);
        return Math.max(1, Math.min(HeroRosterSystem.MAX_LEVEL, r + 1));
    }
}
