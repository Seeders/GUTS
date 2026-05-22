// Manages each player's hero party across rounds.
// Spawns hero entities at prep phase start and despawns them after battle.
// Each hero roster entry now stores: { heroClass, roundsPlayed, equipment }.
// Equipment persists between rounds via the roster entry; hero entities are
// created fresh each round with stored equipment re-applied.
class HeroRosterSystem extends GUTS.BaseSystem {

    static services = [
        'spawnHeroesForRound',
        'despawnBattleHeroes',
        'getHeroEntityId',
        'getRosterEntryForEntity',
        'snapshotHeroPositions'
    ];

    static serviceDependencies = [
        'getPlayerEntities',
        'spawnHeroUnitsForTeam',
        'addAbilitiesToUnit'
    ];

    static CLASS_SPAWN_MAP = {
        barbarian:  '1_s_barbarian',
        apprentice: '1_i_apprentice',
        archer:     '1_d_archer',
        acolyte:    '1_is_acolyte',
        soldier:    '1_sd_soldier',
        scout:      '1_di_scout'
    };

    // Maps roundsPlayed → hero level (checked in descending order)
    static LEVEL_THRESHOLDS = [
        { minRounds: 7, level: 7 },
        { minRounds: 5, level: 5 },
        { minRounds: 3, level: 3 },
        { minRounds: 0, level: 1 }
    ];

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
                .map(entry => HeroRosterSystem.CLASS_SPAWN_MAP[entry.heroClass || entry])
                .filter(Boolean);

            if (spawnTypes.length === 0) continue;

            const result = this.call.spawnHeroUnitsForTeam(spawnTypes, stats.team);
            if (!result?.units) continue;

            result.units.forEach((u, rosterIndex) => {
                if (!u.squadUnits) return;
                const rosterEntry = stats.heroRoster[rosterIndex] || {};
                const equipment   = rosterEntry.equipment || this._emptyEquipment();
                const level       = this._calcLevel(rosterEntry.roundsPlayed || 0);

                u.squadUnits.forEach(entityId => {
                    // Restore stored equipment (deep copy so mutations don't alias the stored data)
                    this.game.addComponent(entityId, 'heroEquipment', JSON.parse(JSON.stringify(equipment)));

                    // Tag with roster info so any system can look up this hero's persistent record
                    this.game.addComponent(entityId, 'heroRosterInfo', {
                        playerId:    stats.playerId,
                        rosterIndex,
                        level
                    });

                    // HeroArena is an autobattler — heroes should always see the whole battlefield
                    // so they can chase the nearest enemy regardless of distance.
                    const combat = this.game.getComponent(entityId, 'combat');
                    if (combat) {
                        combat.visionRange = 99999;
                        combat.awareness   = 100;
                    }

                    // Register gem-granted abilities so AbilitySystem can execute them.
                    // The hero keeps their default abilities and gains one additional ability per socketed gem.
                    const gemAbilityIds = (equipment.abilitySlots || [])
                        .filter(gem => gem?.abilityId)
                        .map(gem => gem.abilityId);
                    if (gemAbilityIds.length > 0) {
                        this.call.addAbilitiesToUnit(entityId, gemAbilityIds);
                    }

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
            });
        }
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
    // Syncs equipment back to roster entries, increments roundsPlayed, then destroys entities.
    despawnBattleHeroes() {
        const playerEntities = this.call.getPlayerEntities();

        for (const { entityId, playerId, rosterIndex } of this.battleHeroEntities) {
            // Sync current equipment to roster before destroying
            for (const playerEntityId of playerEntities) {
                const stats = this.game.getComponent(playerEntityId, 'playerStats');
                if (!stats || stats.playerId !== playerId) continue;

                const rosterEntry = stats.heroRoster?.[rosterIndex];
                if (rosterEntry) {
                    rosterEntry.roundsPlayed = (rosterEntry.roundsPlayed || 0) + 1;
                    const heroEquipment = this.game.getComponent(entityId, 'heroEquipment');
                    if (heroEquipment) {
                        rosterEntry.equipment = JSON.parse(JSON.stringify(heroEquipment));
                    }
                }
                break;
            }

            try { this.game.destroyEntity(entityId); } catch (_) {}
        }

        this.battleHeroEntities = [];
        this._entityToRoster.clear();
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
        for (const { minRounds, level } of HeroRosterSystem.LEVEL_THRESHOLDS) {
            if (roundsPlayed >= minRounds) return level;
        }
        return 1;
    }

    _emptyEquipment() {
        return {
            mainWeapon:   null,
            offhand:      null,
            bodyArmor:    null,
            helmet:       null,
            abilitySlots: [null, null, null, null]
        };
    }
}
