/**
 * ZoneSystem - The act's zone graph: WFC generation, zone travel, portals,
 * and waypoints.
 *
 * Zones are defined in data/zones/*.json. Generated zones render into
 * placeholder level slots (gen_zone_a..d) via WFCLevelGenerator; generated
 * layouts are cached in game.state.generatedZones for the session so
 * revisiting a zone shows the same map.
 */
class ZoneSystem extends GUTS.BaseSystem {
    static services = [
        'travelToZone',
        'getZoneDef',
        'getCurrentZoneId',
        'interactWith',
        'openWaypointDialog'
    ];

    static serviceDependencies = [
        'getPlayerCharacter',
        'getCamera',
        'createEntityFromPrefab'
    ];

    static INTERACT_RANGE = 140;

    constructor(game) {
        super(game);
        this.game.zoneSystem = this;
        this.labels = new Map();     // entityId -> DOM label
        this.meshes = new Map();     // entityId -> THREE mesh
        this.container = null;
        this._v = null;
    }

    init() {}

    getZoneDef(zoneId) {
        return this.collections.zones?.[zoneId] || null;
    }

    getCurrentZoneId() {
        return this.game.state.currentZoneId || null;
    }

    // ─── Zone travel ──────────────────────────────────────────────────────────

    /**
     * Generate (or reuse) the zone level and switch the adventure scene to it.
     * @param {string} zoneId
     * @param {Object} opts - { spawnAt: 'entrance'|'exit'|'waypoint' }
     */
    travelToZone(zoneId, opts = {}) {
        const zone = this.getZoneDef(zoneId);
        if (!zone) {
            console.error('[ZoneSystem] Unknown zone:', zoneId);
            return false;
        }

        let levelKey;
        if (zone.fixedLevel) {
            levelKey = zone.fixedLevel;
        } else {
            levelKey = zone.genSlot;
            const cache = this.game.state.generatedZones = this.game.state.generatedZones || {};
            if (!cache[zoneId]) {
                const gen = new GUTS.WFCLevelGenerator(this.collections, Math.random);
                const level = gen.generate({
                    set: zone.set,
                    sizePieces: zone.sizePieces || 6,
                    title: zone.title,
                    world: zone.world,
                    hasWaypoint: zone.hasWaypoint
                });
                if (!level) return false;
                cache[zoneId] = level;
            }
            // Install into the placeholder slot (enum index already exists)
            this.collections.levels[levelKey] = cache[zoneId];
        }

        const levelIndex = this.enums.levels?.[levelKey] ?? 0;
        this.game.state.level = levelIndex;
        this.game.state.currentZoneId = zoneId;
        this.game.state.gameMode = this.game.state.gameMode || {
            id: 'adventure', title: 'Adventure', description: 'Ashfall adventure'
        };

        const classId = this.game.state.savedCharacterSheet
            ? (this.game.state.savedCharacterSheet.ascension ||
               this.collections.classes?.[this.game.state.savedCharacterSheet.classId]?.unitType)
            : this.game.state.adventureClassId;

        this.game.switchScene('adventure', {
            isAdventure: true,
            zoneId,
            classId: classId || '1_s_barbarian',
            spawnAt: opts.spawnAt || 'entrance'
        });
        return true;
    }

    // ─── Zone population (called by ArpgGameSystem.postSceneLoad) ─────────────

    setupZone(zoneId, params = {}) {
        const zone = this.getZoneDef(zoneId);
        if (!zone) return;

        const levelKey = zone.fixedLevel || zone.genSlot;
        const level = this.collections.levels?.[levelKey];
        const arpg = level?.arpg;

        // Marker positions (tile coords -> world via grid system)
        const toWorld = (marker) => {
            if (!marker) return null;
            const t = this.tileToWorld(marker.gridX, marker.gridZ, level);
            return t;
        };

        // Fixed levels (e.g. the throne room) use startingLocations as entrance/exit
        const entrance = arpg?.entrance
            ? toWorld(arpg.entrance)
            : this.startLocWorld(level, 0);
        const exit = arpg?.exit
            ? toWorld(arpg.exit)
            : this.startLocWorld(level, 1);

        // Portals
        if (zone.prev) {
            this.spawnInteractable('portal', entrance, {
                target: zone.prev,
                label: `⬅ ${this.getZoneDef(zone.prev)?.title || zone.prev}`,
                color: '#7fc7ff', spawnAt: 'exit'
            });
        }
        if (zone.next && !zone.boss?.actBoss) {
            this.spawnInteractable('portal', exit, {
                target: zone.next,
                label: `${this.getZoneDef(zone.next)?.title || zone.next} ➡`,
                color: '#7fc7ff', spawnAt: 'entrance'
            });
        } else if (zone.next && zone.boss?.actBoss) {
            // Act boss zone: exit portal appears after the boss dies (see onZoneBossKilled)
            this._pendingVictoryPortal = { zone, exit };
        }

        // Waypoint
        if (zone.hasWaypoint) {
            const wpPos = arpg?.waypoint ? toWorld(arpg.waypoint) : entrance;
            this.spawnInteractable('waypoint', { x: wpPos.x + 60, z: wpPos.z + 60 }, {
                target: zoneId,
                label: `◆ Waypoint`,
                color: '#7fe0c3'
            });
            const discovered = this.game.state.discoveredWaypoints = this.game.state.discoveredWaypoints || [];
            if (!discovered.includes(zoneId)) discovered.push(zoneId);
        }

        // Monsters (EnemyPackSystem) — towns are safe
        const packs = this.game.enemyPackSystem;
        if (packs && !zone.isTown && (zone.monsters || []).length) {
            packs.populateZone(zone, level, {
                entrance,
                toWorld: (m) => toWorld(m)
            });
        }

        // Town NPCs
        if (this.game.npcSystem) {
            this.game.npcSystem.spawnZoneNpcs(level, (m) => toWorld(m));
        }
    }

    startLocWorld(level, index) {
        const loc = level?.tileMap?.startingLocations?.[index]
            || level?.tileMap?.startingLocations?.[0]
            || { gridX: 4, gridZ: 4 };
        return this.tileToWorld(loc.gridX, loc.gridZ, level);
    }

    tileToWorld(tx, tz, level) {
        const gridSize = this.collections.configs?.game?.gridSize || 48;
        const size = level?.tileMap?.size || 64;
        const terrainSize = size * gridSize;
        return {
            x: tx * gridSize - terrainSize / 2 + gridSize / 2,
            y: 0,
            z: tz * gridSize - terrainSize / 2 + gridSize / 2
        };
    }

    // ─── Interactable entities ────────────────────────────────────────────────

    spawnInteractable(kind, pos, opts = {}) {
        if (!pos) return null;
        const entityId = this.game.createEntity();
        this.game.addComponents(entityId, {
            transform: {
                position: { x: pos.x, y: pos.y || 0, z: pos.z },
                rotation: { x: 0, y: 0, z: 0 },
                scale: { x: 1, y: 1, z: 1 }
            },
            interactable: {
                kind,
                target: opts.target || '',
                label: opts.label || kind,
                data: { color: opts.color || '#ffffff', spawnAt: opts.spawnAt || 'entrance' }
            }
        });
        return entityId;
    }

    interactWith(entityId) {
        const inter = this.game.getComponent(entityId, 'interactable');
        if (!inter) return false;

        // Range check
        const playerId = this.call.getPlayerCharacter?.();
        const pt = playerId != null ? this.game.getComponent(playerId, 'transform') : null;
        const it = this.game.getComponent(entityId, 'transform');
        if (pt?.position && it?.position) {
            const d = Math.hypot(it.position.x - pt.position.x, it.position.z - pt.position.z);
            if (d > ZoneSystem.INTERACT_RANGE * 2.5) return false;
        }

        if (inter.kind === 'portal') {
            this.travelToZone(inter.target, { spawnAt: inter.data?.spawnAt || 'entrance' });
            return true;
        }
        if (inter.kind === 'waypoint') {
            this.openWaypointDialog();
            return true;
        }
        // npc / chest handled by their systems via event
        this.game.triggerEvent('onInteract', { entityId, interactable: inter });
        return true;
    }

    onZoneBossKilled() {
        // Act boss died: spawn the victory/exit portal if pending
        if (this._pendingVictoryPortal) {
            const { zone, exit } = this._pendingVictoryPortal;
            this.spawnInteractable('portal', exit, {
                target: zone.next,
                label: `${this.getZoneDef(zone.next)?.title || zone.next} ➡`,
                color: '#f0cf70', spawnAt: 'entrance'
            });
            this._pendingVictoryPortal = null;
        }
    }

    // ─── Waypoint dialog ──────────────────────────────────────────────────────

    openWaypointDialog() {
        if (this.game.isServer) return;
        document.getElementById('arpgWaypointDialog')?.remove();

        const discovered = this.game.state.discoveredWaypoints || [];
        const targets = ['emberrest', ...discovered.filter(z => z !== 'emberrest')];

        const dialog = document.createElement('div');
        dialog.id = 'arpgWaypointDialog';
        dialog.className = 'arpg-panel';
        dialog.style.cssText = 'left:50%; top:30%; transform:translateX(-50%); width:300px; z-index:100;';
        dialog.innerHTML = `
            <div class="arpg-panel-titlebar"><span>Waypoints</span>
                <button class="arpg-panel-close">✕</button></div>
            <div class="arpg-panel-body" id="arpgWaypointList"></div>`;
        document.getElementById('gameContainer')?.appendChild(dialog);

        const list = dialog.querySelector('#arpgWaypointList');
        for (const zoneId of targets) {
            const zone = this.getZoneDef(zoneId);
            if (!zone) continue;
            const btn = document.createElement('button');
            btn.className = 'btn';
            btn.style.cssText = 'display:block; width:100%; margin-bottom:6px; text-align:left;';
            btn.textContent = zone.title || zoneId;
            btn.addEventListener('click', () => {
                dialog.remove();
                if (zoneId !== this.getCurrentZoneId()) {
                    this.travelToZone(zoneId, { spawnAt: zone.hasWaypoint ? 'waypoint' : 'entrance' });
                }
            });
            list.appendChild(btn);
        }
        dialog.querySelector('.arpg-panel-close').addEventListener('click', () => dialog.remove());
    }

    // ─── Client rendering: labels + beacon meshes ─────────────────────────────

    onSceneLoad() {
        if (this.game.isServer || !this.game.state.isAdventure) return;
        this.container = document.getElementById('arpgLootLabels') || document.getElementById('gameContainer');
        this._v = (typeof THREE !== 'undefined') ? new THREE.Vector3() : null;
    }

    update() {
        if (this.game.isServer || !this.game.state.isAdventure || !this._v) return;

        const entities = this.game.getEntitiesWith('interactable', 'transform');
        const camera = this.call.getCamera?.();
        const canvas = document.getElementById('gameCanvas');
        if (!camera || !canvas || !this.container) return;
        const rect = canvas.getBoundingClientRect();
        const seen = new Set();

        for (const entityId of entities) {
            const inter = this.game.getComponent(entityId, 'interactable');
            if (!inter) continue;
            seen.add(entityId);

            if (!this.meshes.has(entityId)) this.createBeacon(entityId, inter);

            let label = this.labels.get(entityId);
            if (!label) {
                label = document.createElement('div');
                label.className = 'arpg-loot-label arpg-interact-label';
                label.textContent = inter.label;
                label.style.color = inter.data?.color || '#fff';
                label.style.borderColor = (inter.data?.color || '#fff') + '66';
                label.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.interactWith(entityId);
                });
                this.container.appendChild(label);
                this.labels.set(entityId, label);
            }

            const t = this.game.getComponent(entityId, 'transform');
            this._v.set(t.position.x, (t.position.y || 0) + 46, t.position.z);
            this._v.project(camera);
            if (this._v.z > 1) { label.style.display = 'none'; continue; }
            label.style.display = 'block';
            label.style.left = `${Math.round(rect.left + (this._v.x + 1) / 2 * rect.width)}px`;
            label.style.top = `${Math.round(rect.top + (-this._v.y + 1) / 2 * rect.height)}px`;
        }

        for (const [entityId, label] of this.labels) {
            if (!seen.has(entityId)) { label.remove(); this.labels.delete(entityId); }
        }
        for (const [entityId] of this.meshes) {
            if (!seen.has(entityId)) this.removeBeacon(entityId);
        }
    }

    createBeacon(entityId, inter) {
        const scene = this.game.renderSystem?.scene;
        if (!scene || typeof THREE === 'undefined') return;
        const t = this.game.getComponent(entityId, 'transform');
        if (!t?.position) return;

        const color = new THREE.Color(inter.data?.color || '#ffffff');
        const group = new THREE.Group();

        const ringGeo = new THREE.TorusGeometry(26, 3, 8, 24);
        const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75 });
        const ring = new THREE.Mesh(ringGeo, mat);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 4;
        group.add(ring);

        const beamGeo = new THREE.CylinderGeometry(7, 12, 60, 8, 1, true);
        const beamMat = new THREE.MeshBasicMaterial({
            color, transparent: true, opacity: 0.28, depthWrite: false
        });
        const beam = new THREE.Mesh(beamGeo, beamMat);
        beam.position.y = 32;
        group.add(beam);

        group.position.set(t.position.x, t.position.y || 0, t.position.z);
        scene.add(group);
        this.meshes.set(entityId, group);
    }

    removeBeacon(entityId) {
        const group = this.meshes.get(entityId);
        if (group) {
            group.parent?.remove(group);
            group.traverse?.(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
            this.meshes.delete(entityId);
        }
    }

    onSceneUnload() {
        for (const label of this.labels.values()) label.remove();
        this.labels.clear();
        for (const entityId of [...this.meshes.keys()]) this.removeBeacon(entityId);
        this.container = null;
        this._pendingVictoryPortal = null;
        document.getElementById('arpgWaypointDialog')?.remove();
    }
}
