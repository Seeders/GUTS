/**
 * EnemyPackSystem - Spawns a zone's monster population from generated markers.
 *
 * D2-style rarity tiers:
 * - Normal packs (3-5 monsters at the zone's monster level)
 * - Champion packs (~20%): a champion (bigger, buffed, named) + minions
 * - Zone boss: heavily scaled unique with guaranteed loot
 * - Quest objects (e.g. Pyre Totems): stationary destructibles
 */
class EnemyPackSystem extends GUTS.BaseSystem {
    static services = [
        'populateZone',
        'getMonsterName'
    ];

    static serviceDependencies = [
        'createEntityFromPrefab',
        'addAbilitiesToUnit'
    ];

    static CHAMPION_PREFIXES = ['Gorefang', 'Ironhide', 'Doomherald', 'Ashborn', 'Vilespawn', 'Grimjaw', 'Blightbone', 'Cindershade'];
    static CHAMPION_TITLES = ['the Cruel', 'the Unyielding', 'the Swift', 'the Vile', 'the Burning', 'the Cold', 'the Mad', 'the Hungry'];

    constructor(game) {
        super(game);
        this.game.enemyPackSystem = this;
        this.monsterNames = new Map();   // entityId -> display name
        this.bossEntityId = null;
    }

    init() {}

    getMonsterName(entityId) {
        return this.monsterNames.get(entityId) || null;
    }

    // ─── Zone population ──────────────────────────────────────────────────────

    populateZone(zone, level, helpers) {
        const arpg = level?.arpg;
        const mlvl = zone.monsterLevel || 1;
        const monsterTeam = this.enums.team.right;

        // Pack spawn points: generated markers, or scattered for fixed levels
        let spawnPoints = (arpg?.packSpawns || []).map(m => helpers.toWorld(m)).filter(Boolean);
        if (!spawnPoints.length) {
            spawnPoints = this.scatteredPoints(level, zone.packCount || 8, helpers.entrance);
        }

        // Trim/repeat to target pack count
        const packCount = Math.min(zone.packCount || 8, Math.max(4, spawnPoints.length));
        const points = [];
        for (let i = 0; i < packCount; i++) {
            points.push(spawnPoints[i % spawnPoints.length]);
        }

        for (const p of points) {
            if (Math.random() < 0.2 && (zone.championTypes || []).length) {
                this.spawnChampionPack(zone, p, mlvl, monsterTeam);
            } else {
                this.spawnNormalPack(zone, p, mlvl, monsterTeam);
            }
        }

        // Zone boss
        if (zone.boss) {
            const bossPos = arpg?.bossSpawn ? helpers.toWorld(arpg.bossSpawn)
                : this.farthestPoint(spawnPoints, helpers.entrance) || helpers.entrance;
            this.spawnBoss(zone, bossPos, mlvl, monsterTeam);
        }

        // Quest objects (stationary destructibles)
        if (zone.questObjects) {
            const count = zone.questObjects.count || 3;
            const spots = this.pickSpread(spawnPoints, count);
            let i = 1;
            for (const p of spots) {
                this.spawnQuestObject(zone, p, mlvl, monsterTeam, i++);
            }
        }

        this.game.state.zoneBossAlive = !!zone.boss;
    }

    scatteredPoints(level, count, entrance) {
        const size = level?.tileMap?.size || 64;
        const gridSize = this.collections.configs?.game?.gridSize || 48;
        const half = size * gridSize / 2;
        const points = [];
        for (let i = 0; i < count; i++) {
            const x = -half * 0.7 + Math.random() * half * 1.4;
            const z = -half * 0.7 + Math.random() * half * 1.4;
            if (entrance && Math.hypot(x - entrance.x, z - entrance.z) < 300) continue;
            points.push({ x, y: 0, z });
        }
        return points;
    }

    farthestPoint(points, from) {
        let best = null, bestD = -1;
        for (const p of points) {
            const d = Math.hypot(p.x - from.x, p.z - from.z);
            if (d > bestD) { bestD = d; best = p; }
        }
        return best;
    }

    pickSpread(points, count) {
        if (points.length <= count) return points.slice(0, count);
        const out = [];
        const step = Math.floor(points.length / count);
        for (let i = 0; i < count; i++) out.push(points[i * step]);
        return out;
    }

    // ─── Spawning ─────────────────────────────────────────────────────────────

    spawnMonster(unitId, pos, mlvl, team, opts = {}) {
        const entityId = this.call.createEntityFromPrefab({
            prefab: 'unit',
            type: unitId,
            collection: 'units',
            team,
            componentOverrides: {
                transform: { position: { x: pos.x, y: pos.y || 0, z: pos.z } }
            }
        });
        if (entityId == null) return null;

        // Level scaling
        const hpMult = (1 + (mlvl - 1) * 0.22) * (opts.hpMult || 1);
        const dmgMult = (1 + (mlvl - 1) * 0.13) * (opts.dmgMult || 1);
        const health = this.game.getComponent(entityId, 'health');
        if (health) {
            health.max = Math.round(health.max * hpMult);
            health.current = health.max;
        }
        const combat = this.game.getComponent(entityId, 'combat');
        if (combat) {
            combat.damage = Math.round(combat.damage * dmgMult);
            if (opts.armorBonus) combat.armor = (combat.armor || 0) + opts.armorBonus;
        }

        // Visual scale for champions/bosses
        if (opts.scale && opts.scale !== 1) {
            const transform = this.game.getComponent(entityId, 'transform');
            if (transform?.scale) {
                transform.scale.x = opts.scale;
                transform.scale.y = opts.scale;
                transform.scale.z = opts.scale;
            }
            const collision = this.game.getComponent(entityId, 'collision');
            if (collision) collision.radius = Math.round((collision.radius || 20) * opts.scale);
        }

        this.game.addComponent(entityId, 'neutralMonster', {
            lootTable: opts.lootTable || 'common',
            lootChance: opts.lootChance ?? 0.3,
            guaranteedLoot: opts.guaranteedLoot ? 1 : 0,
            monsterLevel: mlvl,
            rarityBonus: opts.rarityBonus || 0
        });

        if (opts.name) this.monsterNames.set(entityId, opts.name);
        return entityId;
    }

    spawnNormalPack(zone, pos, mlvl, team) {
        const unitId = this.pickRandom(zone.monsters || ['0_skeleton']);
        const count = 3 + Math.floor(Math.random() * 3);
        for (let i = 0; i < count; i++) {
            this.spawnMonster(unitId, {
                x: pos.x + (Math.random() - 0.5) * 120,
                y: pos.y,
                z: pos.z + (Math.random() - 0.5) * 120
            }, mlvl, team);
        }
    }

    spawnChampionPack(zone, pos, mlvl, team) {
        const championType = this.pickRandom(zone.championTypes);
        const name = `${this.pickRandom(EnemyPackSystem.CHAMPION_PREFIXES)} ${this.pickRandom(EnemyPackSystem.CHAMPION_TITLES)}`;

        this.spawnMonster(championType, pos, mlvl + 1, team, {
            hpMult: 2.2, dmgMult: 1.4, scale: 1.3, armorBonus: 5,
            rarityBonus: 1, lootChance: 1, name
        });

        // Minions
        const minionType = this.pickRandom(zone.monsters || ['0_skeleton']);
        const count = 2 + Math.floor(Math.random() * 2);
        for (let i = 0; i < count; i++) {
            this.spawnMonster(minionType, {
                x: pos.x + (Math.random() - 0.5) * 140,
                y: pos.y,
                z: pos.z + (Math.random() - 0.5) * 140
            }, mlvl, team);
        }
    }

    spawnBoss(zone, pos, mlvl, team) {
        const boss = zone.boss;
        const entityId = this.spawnMonster(boss.unit, pos, mlvl + 2, team, {
            hpMult: 6, dmgMult: 1.6, scale: boss.scale || 1.6, armorBonus: 10,
            rarityBonus: 2, guaranteedLoot: true, lootTable: 'boss',
            name: boss.name
        });
        if (entityId != null) {
            this.game.addComponent(entityId, 'boss', { isBoss: 1 });
            this.bossEntityId = entityId;
        }
        return entityId;
    }

    spawnQuestObject(zone, pos, mlvl, team, index) {
        const q = zone.questObjects;
        const entityId = this.spawnMonster(q.unit, pos, mlvl, team, {
            hpMult: 2.5, dmgMult: 0, name: `${q.name} ${index}`,
            lootChance: 0.8
        });
        if (entityId != null) {
            // Stationary: anchor it
            const vel = this.game.getComponent(entityId, 'velocity');
            if (vel) { vel.anchored = true; vel.maxSpeed = 0; }
            this.game.addComponent(entityId, 'trap', { isQuestObject: 1 });
            this.game.removeComponent(entityId, 'aiState'); // totems don't think
            this.monsterNames.set(entityId, `${q.name} ${index}`);
            this.game.triggerEvent('onQuestObjectSpawned', { entityId, questId: q.questId });
        }
        return entityId;
    }

    pickRandom(arr) {
        if (!arr?.length) return null;
        return arr[Math.floor(Math.random() * arr.length)];
    }

    // ─── Kill tracking ────────────────────────────────────────────────────────

    onUnitKilled(deadEntityId) {
        if (!this.game.state.isAdventure) return;

        if (deadEntityId === this.bossEntityId) {
            this.bossEntityId = null;
            this.game.state.zoneBossAlive = false;
            this.game.triggerEvent('onZoneBossKilled', {
                zoneId: this.game.state.currentZoneId,
                name: this.monsterNames.get(deadEntityId)
            });
        }

        const trap = this.game.getComponent(deadEntityId, 'trap');
        if (trap?.isQuestObject) {
            this.game.triggerEvent('onQuestObjectDestroyed', {
                zoneId: this.game.state.currentZoneId,
                entityId: deadEntityId
            });
        }

        this.monsterNames.delete(deadEntityId);
    }

    onSceneUnload() {
        this.monsterNames.clear();
        this.bossEntityId = null;
    }
}
