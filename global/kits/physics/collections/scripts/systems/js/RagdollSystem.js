/**
 * RagdollSystem - bodies that go limp (client only; a look, never game state).
 *
 * spawnRagdoll(root, opts) takes a model that is in the scene and posed as it should start (e.g. the
 * first frame of its death clip): every bone of its rig becomes a capsule, joined to its parent by a
 * ball joint, and from then on the bones follow the physics. A model without the rig's bones
 * tumbles as one box. Ragdolls hit the world (terrain, static geometry, entity colliders) but not
 * each other, settle, and after `life` seconds sink into the ground and go.
 *
 *   opts.velocity   { x, y, z }  how it's thrown (world units per second)
 *   opts.spin       { x, y, z }  how its chest (or the whole body) turns as it goes (radians per second)
 *   opts.rig        a rig name (collections.ragdollRigs, or 'humanoid') or a rig object
 *   opts.life       seconds before it sinks (default 25); handle.expire() starts that sooner
 *   opts.onGone     called once it has gone
 *
 * The handle: { root, kind ('rig' | 'tumble'), bones (name -> bone), chest (the Rapier body that takes a
 * blow: the rig's chest, or the tumbling body), nearestBone(point), expire(), remove() }.
 *
 * A rig: { segments: [[bone, toBone, radius (share of the model's height), parentBone], ...] }.
 * The built-in 'humanoid' rig uses Mixamo bone names; "mixamorig:" style prefixes are ignored.
 * Settings (collections/settings/configs/physics.json): "maxRagdolls" (default 14).
 */
class RagdollSystem extends GUTS.BaseSystem {
    static services = ['spawnRagdoll', 'clearRagdolls'];
    static serviceDependencies = ['getPhysicsWorld'];

    static RIGS = {
        humanoid: {
            segments: [
                ['Hips', 'Spine1', 0.075, null],
                ['Spine1', 'Neck', 0.08, 'Hips'],
                ['Head', 'HeadTop_End', 0.06, 'Spine1'],
                ['LeftArm', 'LeftForeArm', 0.035, 'Spine1'],
                ['LeftForeArm', 'LeftHand', 0.03, 'LeftArm'],
                ['RightArm', 'RightForeArm', 0.035, 'Spine1'],
                ['RightForeArm', 'RightHand', 0.03, 'RightArm'],
                ['LeftUpLeg', 'LeftLeg', 0.045, 'Hips'],
                ['LeftLeg', 'LeftFoot', 0.04, 'LeftUpLeg'],
                ['RightUpLeg', 'RightLeg', 0.045, 'Hips'],
                ['RightLeg', 'RightFoot', 0.04, 'RightUpLeg']
            ]
        }
    };

    constructor(game) {
        super(game);
        this.game.ragdollSystem = this;
        this.ragdolls = [];
    }

    get maxRagdolls() { return this.collections.configs?.physics?.maxRagdolls ?? 14; }

    onSceneUnload() {
        this.clearRagdolls();
    }

    clearRagdolls() {
        for (const r of this.ragdolls) this.drop(r);
        this.ragdolls = [];
    }

    static boneName(name) {
        return name.replace(/^mixamorig\d*[:_]?/, '');
    }

    spawnRagdoll(root, opts = {}) {
        const pw = this.call.getPhysicsWorld();
        if (!pw || !root || this.game.isServer) return null;
        root.updateMatrixWorld(true);
        const bones = new Map();
        root.traverse(o => { if (o.isBone) bones.set(RagdollSystem.boneName(o.name), o); });
        const rig = typeof opts.rig === 'object' && opts.rig ? opts.rig
            : this.collections.ragdollRigs?.[opts.rig] || RagdollSystem.RIGS[opts.rig || 'humanoid'] || RagdollSystem.RIGS.humanoid;
        const segs = rig.segments || [];
        const usable = segs.length && segs.filter(s => s[3] == null).every(s => bones.has(s[0])) && segs.filter(s => bones.has(s[0])).length >= 3;
        const v = opts.velocity || { x: 0, y: 0, z: 0 }, spin = opts.spin || null;
        const r = usable ? this.buildRig(pw, root, bones, segs, v, spin) : this.buildTumble(pw, root, v, spin);
        Object.assign(r, { root, bones, age: 0, life: opts.life ?? 25, onGone: opts.onGone || null });
        const handle = {
            root, kind: r.kind, bones, chest: r.chest,
            nearestBone: (p) => this.nearestBone(r, p),
            expire: () => { r.life = Math.min(r.life, r.age); },
            remove: () => this.drop(r)
        };
        r.handle = handle;
        this.ragdolls.push(r);
        while (this.ragdolls.length > this.maxRagdolls) this.drop(this.ragdolls.shift());
        return handle;
    }

    groups() {
        const P = GUTS.PhysicsSystem;
        return ((P?.GROUP_EFFECTS ?? 2) << 16) | (P?.GROUP_WORLD ?? 1);
    }

    buildRig({ R, world: W }, root, bones, segments, v, spin) {
        const segs = new Map();
        const wp = (b) => b.getWorldPosition(new THREE.Vector3());
        const box = new THREE.Box3().setFromObject(root), height = Math.max(20, box.max.y - box.min.y);
        const groups = this.groups();
        for (const [name, toName, rad, parent] of segments) {
            const bone = bones.get(name);
            if (!bone) continue;
            const a = wp(bone);
            const to = bones.get(toName) || bone.children.find(c => c.isBone);
            const bEnd = to ? wp(to) : a.clone().add(new THREE.Vector3(0, height * 0.12, 0));
            const dir = bEnd.clone().sub(a), len = Math.max(4, dir.length());
            const r = Math.max(3, height * rad);
            const mid = a.clone().add(bEnd).multiplyScalar(0.5);
            const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
            const body = W.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(mid.x, mid.y, mid.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
                .setLinvel(v.x, v.y, v.z).setLinearDamping(0.4).setAngularDamping(1.2).setCcdEnabled(true));
            W.createCollider(R.ColliderDesc.capsule(Math.max(0.5, len / 2 - r * 0.5), r).setDensity(1).setFriction(0.9).setRestitution(0.05).setCollisionGroups(groups), body);
            // the bone follows the body: its world rotation is the body's turned by this offset
            const offset = q.clone().invert().multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
            const local = a.clone().sub(mid).applyQuaternion(q.clone().invert());          // the bone's origin in the body's frame
            segs.set(name, { bone, body, offset, local });
            const ps = parent && segs.get(parent);
            if (ps) {
                // a ball joint at this bone's origin, in each body's frame
                const pr = ps.body.rotation();
                const inP = a.clone().sub(ps.body.translation()).applyQuaternion(new THREE.Quaternion(pr.x, pr.y, pr.z, pr.w).invert());
                W.createImpulseJoint(R.JointData.spherical({ x: inP.x, y: inP.y, z: inP.z }, { x: local.x, y: local.y, z: local.z }), ps.body, body, true);
            }
        }
        // the chest takes the blow (or the hips, if the rig has no chest)
        const chest = (segs.get(segments[1]?.[0]) || segs.get(segments[0][0]))?.body;
        if (spin) chest?.setAngvel(spin, true);
        return { kind: 'rig', segs, order: [...segs.keys()], chest };
    }

    buildTumble({ R, world: W }, root, v, spin) {
        const box = new THREE.Box3().setFromObject(root), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
        const body = W.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(c.x, c.y, c.z).setLinvel(v.x, v.y, v.z).setAngularDamping(0.8)
            .setRotation({ x: root.quaternion.x, y: root.quaternion.y, z: root.quaternion.z, w: root.quaternion.w }));
        W.createCollider(R.ColliderDesc.cuboid(Math.max(4, size.x / 2), Math.max(4, size.y / 2), Math.max(4, size.z / 2)).setDensity(1).setFriction(0.8).setCollisionGroups(this.groups()), body);
        if (spin) body.setAngvel(spin, true);
        // the model's origin, in the body's frame
        const offset = root.position.clone().sub(c).applyQuaternion(root.quaternion.clone().invert());
        return { kind: 'tumble', body, offset, chest: body };
    }

    render() {
        if (!this.ragdolls.length) return;
        const dt = this.game.state.deltaTime || 1 / 60;
        for (const r of this.ragdolls) this.sync(r, dt);
        this.ragdolls = this.ragdolls.filter(r => !r.gone);
    }

    sync(r, dt) {
        r.age += dt;
        if (r.age > r.life) {
            // sink into the ground and go (the bodies go first, so the bones stop following them)
            this.releaseBodies(r);
            r.sinking = (r.sinking || 0) + dt;
            r.root.position.y -= 18 * dt;
            if (r.sinking > 3) this.drop(r);
            return;
        }
        if (r.kind === 'tumble') {
            const t = r.body.translation(), q = r.body.rotation(), Q = new THREE.Quaternion(q.x, q.y, q.z, q.w);
            r.root.quaternion.copy(Q);
            r.root.position.set(t.x, t.y, t.z).add(r.offset.clone().applyQuaternion(Q));
        } else {
            const BQ = new THREE.Quaternion(), parentQ = new THREE.Quaternion(), wpos = new THREE.Vector3();
            for (let i = 0; i < r.order.length; i++) {
                const s = r.segs.get(r.order[i]), q = s.body.rotation();
                BQ.set(q.x, q.y, q.z, q.w);
                const bone = s.bone;
                bone.parent.getWorldQuaternion(parentQ);
                bone.quaternion.copy(parentQ.invert().multiply(BQ.clone().multiply(s.offset)));
                if (i === 0) {                                                 // the root bone also moves
                    const t = s.body.translation();
                    wpos.copy(s.local).applyQuaternion(BQ).add(new THREE.Vector3(t.x, t.y, t.z));
                    bone.parent.worldToLocal(wpos);
                    bone.position.copy(wpos);
                }
                bone.updateMatrixWorld(true);
            }
        }
    }

    releaseBodies(r) {
        if (r.released) return;
        r.released = true;
        const W = this.call.getPhysicsWorld()?.world;
        if (!W) return;
        try {
            if (r.kind === 'tumble') W.removeRigidBody(r.body);
            else for (const s of r.segs.values()) W.removeRigidBody(s.body);
        } catch (e) { /* the world went with the scene */ }
    }

    nearestBone(r, p) {
        if (r.kind !== 'rig') return r.root;
        const wp = new THREE.Vector3(), P = new THREE.Vector3(p.x, p.y, p.z);
        let best = null, bestD = Infinity;
        for (const s of r.segs.values()) {
            const d = s.bone.getWorldPosition(wp).distanceTo(P);
            if (d < bestD) { bestD = d; best = s.bone; }
        }
        return best || r.root;
    }

    drop(r) {
        if (r.gone) return;
        r.gone = true;
        r.root?.parent?.remove(r.root);
        this.releaseBodies(r);
        r.onGone?.(r.handle);
    }
}

if (typeof global !== 'undefined') { if (!global.GUTS) global.GUTS = {}; global.GUTS.RagdollSystem = RagdollSystem; }
if (typeof window !== 'undefined') { if (!window.GUTS) window.GUTS = {}; window.GUTS.RagdollSystem = RagdollSystem; }
export default RagdollSystem;
export { RagdollSystem };
