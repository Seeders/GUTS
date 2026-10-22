/**
 * DebrisSystem - things that fly apart and clatter down (client only; a look, never game state).
 *
 * spawnDebris(position, type, opts)
 *   Bursts a debris type into pieces at position: boxes thrown out and up, bouncing off the world,
 *   fading after a while. type is a name (collections.debrisTypes, or one given to
 *   registerDebrisType) or a type object:
 *     { color, count, size: [x, y, z], lift, spread, speed: [min, max], upSpeed: [min, max],
 *       spin, life, roughness, extra: { colors: [...], count, size } }
 *   size is a piece's largest size (each is 60-140% of it); lift raises where they start;
 *   extra adds pieces of other colours (a bookcase's books). opts.count overrides count; opts.parent
 *   is the Object3D to add them to (default: the RenderSystem's scene).
 *
 * simulateObject(object, opts)
 *   Hands any Object3D in the scene to the physics for a while (an arrow that missed, a dropped
 *   shield): it falls, bounces and comes to rest, then fades (or stays: life Infinity).
 *     opts: { position, velocity, angularVelocity, halfExtents (default: from its bounding box),
 *             shape ('box' | 'sphere'), radius, density, friction, restitution, linearDamping,
 *             angularDamping, life, fade ('shrink' | 'sink' | 'none'), dispose, onGone }
 *   Returns { object, body, remove() }.
 *
 * Pieces hit the world but not each other. Settings (configs/physics.json): "maxDebris" (default 200).
 */
class DebrisSystem extends GUTS.BaseSystem {
    static services = ['spawnDebris', 'simulateObject', 'registerDebrisType', 'clearDebris'];
    static serviceDependencies = ['getPhysicsWorld'];

    static DEFAULT_TYPE = { color: 0x7a6a55, count: 8, size: [8, 8, 8], lift: 20, spread: 8, speed: [120, 280], upSpeed: [140, 320], spin: 20, life: 7, roughness: 0.9 };

    constructor(game) {
        super(game);
        this.game.debrisSystem = this;
        this.items = [];
        this.types = new Map();
    }

    get maxDebris() { return this.collections.configs?.physics?.maxDebris ?? 200; }

    onSceneUnload() {
        this.clearDebris();
    }

    clearDebris() {
        for (const d of this.items) this.drop(d);
        this.items = [];
    }

    registerDebrisType(name, def) {
        this.types.set(name, def);
    }

    typeOf(type) {
        const def = typeof type === 'object' && type ? type : (this.types.get(type) || this.collections.debrisTypes?.[type]);
        return { ...DebrisSystem.DEFAULT_TYPE, ...(def || {}) };
    }

    scene() {
        return this.game.renderSystem?.scene || this.game.worldSystem?.worldRenderer?.scene || null;
    }

    spawnDebris(position, type, opts = {}) {
        const scene = opts.parent || this.scene();
        if (!scene || this.game.isServer || !this.call.getPhysicsWorld()) return [];
        const D = this.typeOf(type);
        const rnd = (a, b) => a + Math.random() * (b - a);
        const parts = [];
        const mat = new THREE.MeshStandardMaterial({ color: D.color, roughness: D.roughness });
        const n = opts.count ?? D.count;
        for (let i = 0; i < n; i++) parts.push([D.size, mat]);
        if (D.extra) {
            const mats = (D.extra.colors || [D.color]).map(c => new THREE.MeshStandardMaterial({ color: c, roughness: D.roughness }));
            for (let i = 0; i < (D.extra.count || 0); i++) parts.push([D.extra.size || D.size, mats[i % mats.length]]);
        }
        const out = [];
        const sp = D.speed, up = D.upSpeed;
        for (const [size, m] of parts) {
            const sx = size[0] * rnd(0.6, 1.4), sy = size[1] * rnd(0.6, 1.4), sz = size[2] * rnd(0.6, 1.4);
            const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m);
            mesh.castShadow = true;
            scene.add(mesh);
            const a = Math.random() * Math.PI * 2, s = rnd(sp[0], sp[1]);
            out.push(this.simulateObject(mesh, {
                position: { x: position.x + Math.cos(a) * D.spread, y: position.y + D.lift + Math.random() * 14, z: position.z + Math.sin(a) * D.spread },
                velocity: { x: Math.cos(a) * s, y: rnd(up[0], up[1]), z: Math.sin(a) * s },
                angularVelocity: { x: (Math.random() - 0.5) * D.spin, y: (Math.random() - 0.5) * D.spin, z: (Math.random() - 0.5) * D.spin },
                halfExtents: { x: sx / 2, y: sy / 2, z: sz / 2 },
                density: 0.6, restitution: 0.3, friction: 0.8, linearDamping: 0, angularDamping: 0,
                life: D.life, fade: 'shrink', dispose: true
            }));
        }
        return out.filter(Boolean);
    }

    simulateObject(object, opts = {}) {
        const pw = this.call.getPhysicsWorld();
        if (!pw || !object || this.game.isServer) return null;
        const { R, world: W } = pw;
        const P = GUTS.PhysicsSystem;
        if (opts.position) object.position.set(opts.position.x, opts.position.y, opts.position.z);
        object.updateMatrixWorld(true);
        const q = object.quaternion, v = opts.velocity || { x: 0, y: 0, z: 0 };
        const desc = R.RigidBodyDesc.dynamic().setTranslation(object.position.x, object.position.y, object.position.z)
            .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setLinvel(v.x, v.y, v.z)
            .setLinearDamping(opts.linearDamping ?? 0.1).setAngularDamping(opts.angularDamping ?? 0.3).setCcdEnabled(true);
        if (opts.angularVelocity) desc.setAngvel(opts.angularVelocity);
        const body = W.createRigidBody(desc);
        let cd;
        if (opts.shape === 'sphere') {
            cd = R.ColliderDesc.ball(opts.radius ?? Math.max(2, new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3()).length() / 4));
        } else {
            let he = opts.halfExtents;
            if (!he) {
                // the object's own size, measured unturned
                const saved = object.quaternion.clone();
                object.quaternion.identity(); object.updateMatrixWorld(true);
                const size = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3());
                object.quaternion.copy(saved); object.updateMatrixWorld(true);
                he = { x: Math.max(1, size.x / 2), y: Math.max(1, size.y / 2), z: Math.max(1, size.z / 2) };
            }
            cd = R.ColliderDesc.cuboid(he.x, he.y, he.z);
        }
        W.createCollider(cd.setDensity(opts.density ?? 0.6).setRestitution(opts.restitution ?? 0.3).setFriction(opts.friction ?? 0.7)
            .setCollisionGroups(((P?.GROUP_EFFECTS ?? 2) << 16) | (P?.GROUP_WORLD ?? 1)), body);
        const d = { object, body, age: 0, life: opts.life ?? 10, fade: opts.fade || 'shrink', dispose: !!opts.dispose, onGone: opts.onGone || null };
        d.handle = { object, body, remove: () => this.drop(d) };
        this.items.push(d);
        while (this.items.length > this.maxDebris) this.drop(this.items.shift());
        return d.handle;
    }

    render() {
        if (!this.items.length) return;
        const dt = this.game.state.deltaTime || 1 / 60;
        for (const d of this.items) this.sync(d, dt);
        this.items = this.items.filter(d => !d.gone);
    }

    sync(d, dt) {
        d.age += dt;
        if (!d.released) {
            const t = d.body.translation(), q = d.body.rotation();
            d.object.position.set(t.x, t.y, t.z);
            d.object.quaternion.set(q.x, q.y, q.z, q.w);
        }
        if (d.age <= d.life) return;
        if (d.fade === 'none') { this.drop(d); return; }
        if (d.fade === 'sink') {
            this.release(d);
            d.object.position.y -= 18 * dt;
            if (d.age > d.life + 3) this.drop(d);
        } else {
            d.object.scale.multiplyScalar(Math.pow(0.94, dt * 60));
            if (d.age > d.life + 1.2) this.drop(d);
        }
    }

    release(d) {
        if (d.released) return;
        d.released = true;
        try { this.call.getPhysicsWorld()?.world.removeRigidBody(d.body); } catch (e) { /* the world went with the scene */ }
    }

    drop(d) {
        if (d.gone) return;
        d.gone = true;
        d.object.parent?.remove(d.object);
        if (d.dispose) d.object.geometry?.dispose?.();
        this.release(d);
        d.onGone?.(d.handle);
    }
}

if (typeof global !== 'undefined') { if (!global.GUTS) global.GUTS = {}; global.GUTS.DebrisSystem = DebrisSystem; }
if (typeof window !== 'undefined') { if (!window.GUTS) window.GUTS = {}; window.GUTS.DebrisSystem = DebrisSystem; }
export default DebrisSystem;
export { DebrisSystem };
