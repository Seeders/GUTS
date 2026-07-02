/**
 * ArpgLootSystem - Renders ground loot as glowing markers with D2-style
 * clickable name labels, and handles pickup.
 */
class ArpgLootSystem extends GUTS.BaseSystem {
    static services = [];

    static serviceDependencies = [
        'getCamera',
        'getWorldScene',
        'pickupGroundItem',
        'getGroundItemInfo',
        'getPlayerCharacter'
    ];

    static PICKUP_RANGE = 120;

    constructor(game) {
        super(game);
        this.game.arpgLootSystem = this;
        this.labels = new Map();   // entityId -> DOM element
        this.meshes = new Map();   // entityId -> THREE.Mesh
        this.container = null;
        this._v = null;
    }

    init() {}

    onSceneLoad() {
        if (!this.game.state.isAdventure) return;
        this.container = document.getElementById('arpgLootLabels');
        if (!this.container) {
            this.container = document.createElement('div');
            this.container.id = 'arpgLootLabels';
            document.getElementById('gameContainer')?.appendChild(this.container);
        }
        this._v = new THREE.Vector3();
    }

    update() {
        if (!this.game.state.isAdventure || !this.container) return;

        const lootEntities = this.game.getEntitiesWith('loot', 'transform', 'lootVisual');
        const camera = this.call.getCamera?.();
        const canvas = document.getElementById('gameCanvas');
        if (!camera || !canvas) return;
        const rect = canvas.getBoundingClientRect();
        const seen = new Set();

        for (const entityId of lootEntities) {
            const info = this.call.getGroundItemInfo?.(entityId);
            if (!info) continue;
            seen.add(entityId);

            // Beam mesh
            if (!this.meshes.has(entityId)) this.createBeam(entityId, info);

            // Label
            let label = this.labels.get(entityId);
            if (!label) {
                label = document.createElement('div');
                label.className = 'arpg-loot-label';
                label.textContent = info.label;
                label.style.color = info.color;
                label.style.borderColor = info.color + '55';
                label.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.tryPickup(entityId);
                });
                this.container.appendChild(label);
                this.labels.set(entityId, label);
            }

            // Project to screen
            const t = this.game.getComponent(entityId, 'transform');
            if (!t?.position) continue;
            this._v.set(t.position.x, (t.position.y || 0) + 18, t.position.z);
            this._v.project(camera);
            if (this._v.z > 1) {
                label.style.display = 'none';
                continue;
            }
            const sx = rect.left + (this._v.x + 1) / 2 * rect.width;
            const sy = rect.top + (-this._v.y + 1) / 2 * rect.height;
            label.style.display = 'block';
            label.style.left = `${Math.round(sx)}px`;
            label.style.top = `${Math.round(sy)}px`;
        }

        // Cleanup for removed entities
        for (const [entityId, label] of this.labels) {
            if (!seen.has(entityId)) {
                label.remove();
                this.labels.delete(entityId);
            }
        }
        for (const [entityId, mesh] of this.meshes) {
            if (!seen.has(entityId)) {
                this.removeBeam(entityId);
            }
        }
    }

    createBeam(entityId, info) {
        const scene = this.call.getWorldScene?.() || this.game.renderSystem?.scene;
        if (!scene) return;
        const t = this.game.getComponent(entityId, 'transform');
        if (!t?.position) return;

        const color = new THREE.Color(info.color);
        const geo = new THREE.CylinderGeometry(1.6, 1.6, 34, 6, 1, true);
        const mat = new THREE.MeshBasicMaterial({
            color, transparent: true, opacity: 0.45, depthWrite: false
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(t.position.x, (t.position.y || 0) + 17, t.position.z);
        scene.add(mesh);
        this.meshes.set(entityId, mesh);
    }

    removeBeam(entityId) {
        const mesh = this.meshes.get(entityId);
        if (mesh) {
            mesh.parent?.remove(mesh);
            mesh.geometry?.dispose();
            mesh.material?.dispose();
            this.meshes.delete(entityId);
        }
    }

    tryPickup(entityId) {
        // Range check against the player
        const playerId = this.call.getPlayerCharacter?.();
        const pt = playerId != null ? this.game.getComponent(playerId, 'transform') : null;
        const lt = this.game.getComponent(entityId, 'transform');
        if (pt?.position && lt?.position) {
            const d = Math.hypot(lt.position.x - pt.position.x, lt.position.z - pt.position.z);
            if (d > ArpgLootSystem.PICKUP_RANGE * 3) return; // way out of reach
        }
        this.call.pickupGroundItem(entityId);
    }

    onSceneUnload() {
        for (const label of this.labels.values()) label.remove();
        this.labels.clear();
        for (const entityId of [...this.meshes.keys()]) this.removeBeam(entityId);
        this.container = null;
    }
}
