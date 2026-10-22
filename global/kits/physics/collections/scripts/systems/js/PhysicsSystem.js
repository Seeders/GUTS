/**
 * PhysicsSystem - rigid-body physics on Rapier (@dimforge/rapier3d-compat; list "Rapier" in the
 * config's libraries and add the package to the project).
 *
 * Entities
 *   An entity with transform + collider gets a body: the rigidBody component says what kind
 *   (dynamic, fixed, kinematicPosition, kinematicVelocity); without one the body is fixed.
 *   Dynamic bodies own their transform (position and rotation) and, if the entity has one, its
 *   velocity (vx, vy, vz); kinematicPosition bodies follow their transform. A body is made the
 *   tick after its components appear and goes when they (or the entity) do. Changing a collider's
 *   numbers later needs rebuildPhysicsBody(id).
 *   An entity with characterController (and a kinematicPosition body) is moved by Rapier's
 *   character controller from its velocity: vx/vz are what it wants to walk, vy falls under
 *   gravity (set it positive to jump) and stops on the ground; characterController.grounded
 *   says whether it stands on something.
 *   A joint component (on any entity) links bodyA and bodyB once both have bodies.
 *
 * Events (game.triggerEvent, so any system can have the method)
 *   onCollisionStart / onCollisionEnd({ a, b })     colliders with "events": true touched / parted
 *   onTriggerEnter / onTriggerExit({ sensor, other }) something entered / left a sensor collider
 *   a and b are entity ids, or null for colliders that aren't entities (terrain, static geometry).
 *
 * The world
 *   Steps once per game tick (substeps when the tick is longer than maxStep), so a lockstep game
 *   gets the same result everywhere. The terrain (core TerrainSystem) becomes a triangle mesh after
 *   the scene loads. addStaticCollider adds level geometry that isn't an entity.
 *   Settings come from collections/settings/configs/physics.json, all optional:
 *     { "gravity": -314, "terrain": true, "terrainStep": 0, "maxStep": 0.0167, "debug": false }
 *   gravity is world units per second squared (the default is 9.81 m/s2 at 32 units to the metre);
 *   terrainStep is the terrain mesh's sample spacing (0 = gridSize / 2).
 *
 * Collision groups
 *   collider.groups (what it is) and collider.mask (what it hits) are 16-bit masks; two colliders
 *   touch when each one's groups meet the other's mask. Bit 1 (GROUP_WORLD) is the default for
 *   everything; bit 2 (GROUP_EFFECTS) is used by the client-only effects (RagdollSystem,
 *   DebrisSystem), which hit the world but not each other.
 */
class PhysicsSystem extends GUTS.BaseSystem {
    static services = [
        'getPhysicsWorld',
        'getPhysicsBody',
        'rebuildPhysicsBody',
        'applyImpulse',
        'applyForce',
        'applyTorqueImpulse',
        'setLinearVelocity',
        'getLinearVelocity',
        'teleportBody',
        'radialImpulse',
        'raycast',
        'shapeCast',
        'overlapSphere',
        'isGrounded',
        'addStaticCollider',
        'removeStaticColliders',
        'setGravity',
        'togglePhysicsDebug'
    ];

    // the kit's enums, for projects that don't list kits (so don't get its enums merged in)
    static ENUMS = {
        bodyType: { dynamic: 0, fixed: 1, kinematicPosition: 2, kinematicVelocity: 3 },
        colliderShape: { box: 0, sphere: 1, capsule: 2, cylinder: 3, cone: 4 },
        jointType: { fixed: 0, spherical: 1, revolute: 2, prismatic: 3 }
    };

    static GROUP_WORLD = 0x0001;
    static GROUP_EFFECTS = 0x0002;
    static DEFAULTS = { gravity: -314, terrain: true, terrainStep: 0, maxStep: 1 / 60, debug: false };

    constructor(game) {
        super(game);
        this.game.physicsSystem = this;
        this.R = null;
        this.world = null;
        this.events = null;
        this.bodies = new Map();         // entity id -> { body, colliders: [], controller }
        this.joints = new Map();         // joint entity id -> Rapier joint
        this.owners = new Map();         // collider handle -> entity id
        this.statics = new Map();        // tag -> [rigid body]
        this.terrainBody = null;
        this.debugLines = null;
        this.config = { ...PhysicsSystem.DEFAULTS };
    }

    enumOf(name) {
        return this.enums?.[name] || PhysicsSystem.ENUMS[name];
    }

    // ==================== LIFECYCLE ====================

    async onSceneLoad() {
        this.config = { ...PhysicsSystem.DEFAULTS, ...(this.collections.configs?.physics || {}) };
        const R = GUTS.RAPIER;
        if (!R?.init) { console.warn('[physics] Rapier is not bundled: list "Rapier" in the libraries and install @dimforge/rapier3d-compat'); return; }
        await R.init();
        this.R = R;
        this.world = new R.World({ x: 0, y: this.config.gravity, z: 0 });
        this.events = new R.EventQueue(true);
        if (this.config.debug) this.togglePhysicsDebug(true);
    }

    postSceneLoad() {
        if (this.world && this.config.terrain) this.buildTerrain();
    }

    onSceneUnload() {
        this.togglePhysicsDebug(false);
        this.world?.free?.();
        this.events?.free?.();
        this.world = null;
        this.events = null;
        this.bodies.clear();
        this.joints.clear();
        this.owners.clear();
        this.statics.clear();
        this.terrainBody = null;
    }

    entityDestroyed(id) {
        this.removeBody(id);
        this.removeJoint(id);
    }

    update() {
        if (!this.world) return;
        this.syncBodies();
        this.syncJoints();
        this.pushKinematics();
        const dt = this.game.state.deltaTime || 1 / 20;
        const steps = Math.max(1, Math.ceil(dt / this.config.maxStep - 1e-6));
        this.world.timestep = dt / steps;
        for (let i = 0; i < steps; i++) {
            this.world.step(this.events);
            this.drainEvents();
        }
        this.pullDynamics();
    }

    render() {
        if (this.debugLines) this.drawDebug();
    }

    // ==================== ENTITY BODIES ====================

    /** Bodies for entities that just got transform + collider; none for those that lost them. */
    syncBodies() {
        const ids = this.game.getEntitiesWith('transform', 'collider');
        const seen = this._seen || (this._seen = new Set());
        seen.clear();
        for (let i = 0; i < ids.length; i++) {
            const id = ids[i];
            seen.add(id);
            if (!this.bodies.has(id)) this.createBody(id);
        }
        if (seen.size !== this.bodies.size) {
            for (const id of [...this.bodies.keys()]) if (!seen.has(id)) this.removeBody(id);
        }
    }

    createBody(id) {
        const R = this.R, W = this.world, E = this.enumOf('bodyType');
        const t = this.game.getComponent(id, 'transform');
        const rb = this.game.getComponent(id, 'rigidBody');
        const c = this.game.getComponent(id, 'collider');
        const type = rb ? rb.type : E.fixed;
        const desc = type === E.dynamic ? R.RigidBodyDesc.dynamic()
            : type === E.kinematicPosition ? R.RigidBodyDesc.kinematicPositionBased()
            : type === E.kinematicVelocity ? R.RigidBodyDesc.kinematicVelocityBased()
            : R.RigidBodyDesc.fixed();
        const q = PhysicsSystem.eulerToQuat(t.rotation);
        desc.setTranslation(t.position.x, t.position.y, t.position.z).setRotation(q);
        if (rb) {
            desc.setLinearDamping(rb.linearDamping).setAngularDamping(rb.angularDamping)
                .setGravityScale(rb.gravityScale).setCcdEnabled(!!rb.ccd).setCanSleep(!!rb.canSleep)
                .setAngvel({ x: rb.angularVelocity.x, y: rb.angularVelocity.y, z: rb.angularVelocity.z });
            const lr = rb.lockRotation;
            if (lr.x || lr.y || lr.z) desc.enabledRotations(!lr.x, !lr.y, !lr.z);
            const v = this.game.getComponent(id, 'velocity');
            if (v) desc.setLinvel(v.vx, v.vy, v.vz);
        }
        const body = W.createRigidBody(desc);
        const cd = this.colliderDesc(c);
        if (rb && rb.mass > 0) cd.setMass(rb.mass);
        const collider = W.createCollider(cd, body);
        this.owners.set(collider.handle, id);
        const entry = { body, colliders: [collider], controller: null };
        const cc = this.game.getComponent(id, 'characterController');
        if (cc) entry.controller = this.makeController(cc);
        this.bodies.set(id, entry);
    }

    /** A Rapier collider description from a collider component (or any object with its fields). */
    colliderDesc(c) {
        const R = this.R, S = this.enumOf('colliderShape');
        const he = c.halfExtents || {}, r = c.radius ?? 16, hh = c.halfHeight ?? 16;
        const shape = typeof c.shape === 'string' ? S[c.shape] : c.shape;
        const desc = shape === S.sphere ? R.ColliderDesc.ball(r)
            : shape === S.capsule ? R.ColliderDesc.capsule(hh, r)
            : shape === S.cylinder ? R.ColliderDesc.cylinder(hh, r)
            : shape === S.cone ? R.ColliderDesc.cone(hh, r)
            : R.ColliderDesc.cuboid(he.x ?? 16, he.y ?? 16, he.z ?? 16);
        const o = c.offset;
        if (o && (o.x || o.y || o.z)) desc.setTranslation(o.x, o.y, o.z);
        desc.setFriction(c.friction ?? 0.5).setRestitution(c.restitution ?? 0).setDensity(c.density ?? 1)
            .setSensor(!!c.sensor)
            .setCollisionGroups(((c.groups ?? 1) << 16) | (c.mask ?? 0xffff));
        if (c.events || c.sensor) desc.setActiveEvents(R.ActiveEvents.COLLISION_EVENTS);
        if (c.sensor) desc.setActiveCollisionTypes(R.ActiveCollisionTypes.DEFAULT | R.ActiveCollisionTypes.KINEMATIC_FIXED);
        return desc;
    }

    makeController(cc) {
        const ctl = this.world.createCharacterController(cc.skin || 0.5);
        ctl.setMaxSlopeClimbAngle((cc.maxSlope || 45) * Math.PI / 180);
        ctl.setMinSlopeSlideAngle((cc.minSlideAngle || 30) * Math.PI / 180);
        ctl.setSlideEnabled(cc.slideOnSteep !== false);
        if (cc.stepHeight > 0) ctl.enableAutostep(cc.stepHeight, cc.stepMinWidth || 1, true);
        if (cc.snapToGround > 0) ctl.enableSnapToGround(cc.snapToGround);
        ctl.setApplyImpulsesToDynamicBodies(true);
        return ctl;
    }

    removeBody(id) {
        const entry = this.bodies.get(id);
        if (!entry) return;
        for (const c of entry.colliders) this.owners.delete(c.handle);
        if (entry.controller) this.world?.removeCharacterController(entry.controller);
        if (this.world) this.world.removeRigidBody(entry.body);
        this.bodies.delete(id);
    }

    rebuildPhysicsBody(id) {
        this.removeBody(id);
        if (this.world && this.game.hasComponent(id, 'collider') && this.game.hasComponent(id, 'transform')) this.createBody(id);
    }

    getPhysicsBody(id) {
        return this.bodies.get(id)?.body || null;
    }

    /** Kinematic bodies follow their transform; character controllers walk by their velocity. */
    pushKinematics() {
        const dt = this.game.state.deltaTime || 1 / 20;
        for (const [id, entry] of this.bodies) {
            const body = entry.body;
            if (entry.controller) { this.moveCharacter(id, entry, dt); continue; }
            if (!body.isKinematic()) continue;
            const t = this.game.getComponent(id, 'transform');
            if (body.bodyType() === this.R.RigidBodyType.KinematicPositionBased) {
                body.setNextKinematicTranslation({ x: t.position.x, y: t.position.y, z: t.position.z });
                body.setNextKinematicRotation(PhysicsSystem.eulerToQuat(t.rotation));
            } else {
                const v = this.game.getComponent(id, 'velocity');
                if (v) body.setLinvel({ x: v.vx, y: v.vy, z: v.vz }, true);
            }
        }
    }

    moveCharacter(id, entry, dt) {
        const t = this.game.getComponent(id, 'transform');
        const v = this.game.getComponent(id, 'velocity');
        const cc = this.game.getComponent(id, 'characterController');
        if (!t || !cc) return;
        const g = this.world.gravity.y;
        let vx = 0, vy = 0, vz = 0;
        if (v) {
            if (v.affectedByGravity !== false && !(cc.grounded && v.vy <= 0)) v.vy += g * dt;
            vx = v.vx; vy = v.vy; vz = v.vz;
        }
        const collider = entry.colliders[0];
        const ctl = entry.controller;
        ctl.computeColliderMovement(collider, { x: vx * dt, y: vy * dt, z: vz * dt }, this.R.QueryFilterFlags.EXCLUDE_SENSORS);
        const m = ctl.computedMovement();
        const p = entry.body.translation();
        const next = { x: p.x + m.x, y: p.y + m.y, z: p.z + m.z };
        entry.body.setNextKinematicTranslation(next);
        t.position.x = next.x; t.position.y = next.y; t.position.z = next.z;
        cc.grounded = ctl.computedGrounded();
        if (v && cc.grounded && v.vy < 0) v.vy = 0;
        if (v && !cc.grounded && vy > 0 && m.y < vy * dt * 0.5) v.vy = 0;        // (hit its head)
    }

    /** Dynamic bodies write back where they went. */
    pullDynamics() {
        for (const [id, entry] of this.bodies) {
            const body = entry.body;
            if (!body.isDynamic() || body.isSleeping()) continue;
            const t = this.game.getComponent(id, 'transform');
            if (!t) continue;
            const p = body.translation();
            t.position.x = p.x; t.position.y = p.y; t.position.z = p.z;
            PhysicsSystem.quatToEuler(body.rotation(), t.rotation);
            const v = this.game.getComponent(id, 'velocity');
            if (v) { const lv = body.linvel(); v.vx = lv.x; v.vy = lv.y; v.vz = lv.z; }
            const rb = this.game.getComponent(id, 'rigidBody');
            if (rb) { const av = body.angvel(); rb.angularVelocity.x = av.x; rb.angularVelocity.y = av.y; rb.angularVelocity.z = av.z; }
        }
    }

    // ==================== JOINTS ====================

    syncJoints() {
        const ids = this.game.getEntitiesWith('joint');
        for (let i = 0; i < ids.length; i++) {
            const id = ids[i];
            if (this.joints.has(id)) continue;
            const j = this.game.getComponent(id, 'joint');
            const a = this.bodies.get(j.bodyA)?.body, b = this.bodies.get(j.bodyB)?.body;
            if (!a || !b) continue;
            this.joints.set(id, this.createJoint(j, a, b));
        }
        if (this.joints.size) for (const id of [...this.joints.keys()]) if (!this.game.hasComponent(id, 'joint')) this.removeJoint(id);
    }

    createJoint(j, a, b) {
        const R = this.R, J = this.enumOf('jointType');
        const pa = { x: j.anchorA.x, y: j.anchorA.y, z: j.anchorA.z }, pb = { x: j.anchorB.x, y: j.anchorB.y, z: j.anchorB.z };
        const axis = { x: j.axis.x, y: j.axis.y, z: j.axis.z };
        const data = j.type === J.spherical ? R.JointData.spherical(pa, pb)
            : j.type === J.revolute ? R.JointData.revolute(pa, pb, axis)
            : j.type === J.prismatic ? R.JointData.prismatic(pa, pb, axis)
            : R.JointData.fixed(pa, { x: 0, y: 0, z: 0, w: 1 }, pb, { x: 0, y: 0, z: 0, w: 1 });
        if (j.limits && (j.type === J.revolute || j.type === J.prismatic)) { data.limitsEnabled = true; data.limits = [j.min, j.max]; }
        const joint = this.world.createImpulseJoint(data, a, b, true);
        joint.setContactsEnabled?.(!!j.collideConnected);
        if (j.motorFactor > 0 && joint.configureMotorVelocity) joint.configureMotorVelocity(j.motorVelocity, j.motorFactor);
        return joint;
    }

    removeJoint(id) {
        const joint = this.joints.get(id);
        if (!joint) return;
        if (this.world && joint.isValid?.() !== false) { try { this.world.removeImpulseJoint(joint, true); } catch (e) { /* went with a body */ } }
        this.joints.delete(id);
    }

    // ==================== EVENTS ====================

    drainEvents() {
        this.events.drainCollisionEvents((h1, h2, started) => {
            const c1 = this.world.getCollider(h1), c2 = this.world.getCollider(h2);
            const a = this.owners.get(h1) ?? null, b = this.owners.get(h2) ?? null;
            const s1 = c1?.isSensor(), s2 = c2?.isSensor();
            if (s1 || s2) {
                const name = started ? 'onTriggerEnter' : 'onTriggerExit';
                if (s1) this.game.triggerEvent(name, { sensor: a, other: b });
                if (s2) this.game.triggerEvent(name, { sensor: b, other: a });
            } else {
                this.game.triggerEvent(started ? 'onCollisionStart' : 'onCollisionEnd', { a, b });
            }
        });
    }

    // ==================== TERRAIN AND STATIC GEOMETRY ====================

    /**
     * The core terrain as a triangle mesh (rebuilt on each scene load). A mesh rather than Rapier's
     * heightfield: in Rapier 0.14 rays that run exactly along a heightfield's rows pass through it.
     */
    buildTerrain() {
        const g = this.game;
        if (!g.hasService('hasTerrain') || !g.call('hasTerrain')) return;
        const size = g.call('getTerrainExtendedSize');
        if (!(size > 0)) return;
        const gridSize = this.collections.configs?.game?.gridSize || 48;
        const step = this.config.terrainStep > 0 ? this.config.terrainStep : gridSize / 2;
        const n = Math.max(1, Math.round(size / step)), cell = size / n, half = size / 2, row = n + 1;
        const vertices = new Float32Array(row * row * 3), indices = new Uint32Array(n * n * 6);
        for (let zi = 0; zi <= n; zi++) {
            for (let xi = 0; xi <= n; xi++) {
                const x = Math.min(size - 1e-3, xi * cell) - half, z = Math.min(size - 1e-3, zi * cell) - half;
                const k = (zi * row + xi) * 3;
                vertices[k] = xi * cell - half;
                vertices[k + 1] = g.call('getTerrainHeightAtPositionSmooth', x, z) || 0;
                vertices[k + 2] = zi * cell - half;
            }
        }
        let k = 0;
        for (let zi = 0; zi < n; zi++) {
            for (let xi = 0; xi < n; xi++) {
                const a = zi * row + xi, b = a + 1, c = a + row, d = c + 1;
                indices[k++] = a; indices[k++] = c; indices[k++] = b;
                indices[k++] = b; indices[k++] = c; indices[k++] = d;
            }
        }
        if (this.terrainBody) this.world.removeRigidBody(this.terrainBody);
        this.terrainBody = this.world.createRigidBody(this.R.RigidBodyDesc.fixed());
        this.world.createCollider(this.R.ColliderDesc.trimesh(vertices, indices)
            .setFriction(0.8).setCollisionGroups((PhysicsSystem.GROUP_WORLD << 16) | 0xffff), this.terrainBody);
    }

    /**
     * Level geometry that isn't an entity, under a tag (removeStaticColliders(tag) takes them all away).
     * desc: { shape: 'box'|'sphere'|'capsule'|'cylinder'|'cone', halfExtents, radius, halfHeight,
     *         position, rotation (euler), friction, restitution, groups, mask }
     *    or { trimesh: { vertices: Float32Array, indices: Uint32Array }, friction, ... }
     * Several colliders can share one call: pass an array. Returns how many were made.
     */
    addStaticCollider(desc, tag = 'default') {
        if (!this.world) return 0;
        const R = this.R, list = Array.isArray(desc) ? desc : [desc];
        let bodies = this.statics.get(tag);
        if (!bodies) this.statics.set(tag, bodies = []);
        const body = this.world.createRigidBody(R.RigidBodyDesc.fixed());
        bodies.push(body);
        for (const d of list) {
            let cd;
            if (d.trimesh) {
                cd = R.ColliderDesc.trimesh(d.trimesh.vertices, d.trimesh.indices)
                    .setFriction(d.friction ?? 0.8).setRestitution(d.restitution ?? 0)
                    .setCollisionGroups(((d.groups ?? PhysicsSystem.GROUP_WORLD) << 16) | (d.mask ?? 0xffff));
            } else {
                cd = this.colliderDesc({ groups: PhysicsSystem.GROUP_WORLD, friction: 0.8, ...d, offset: null });
            }
            const p = d.position;
            if (p) cd.setTranslation(p.x || 0, p.y || 0, p.z || 0);
            if (d.rotation) cd.setRotation(PhysicsSystem.eulerToQuat(d.rotation));
            const col = this.world.createCollider(cd, body);
            if (d.entityId != null) this.owners.set(col.handle, d.entityId);
            if (d.onCollider) d.onCollider(col);
        }
        return list.length;
    }

    removeStaticColliders(tag = 'default') {
        const bodies = this.statics.get(tag);
        if (!bodies) return;
        for (const b of bodies) if (this.world) this.world.removeRigidBody(b);
        this.statics.delete(tag);
    }

    // ==================== FORCES ====================

    applyImpulse(id, impulse, point = null) {
        const b = this.getPhysicsBody(id);
        if (!b) return false;
        if (point) b.applyImpulseAtPoint(impulse, point, true); else b.applyImpulse(impulse, true);
        return true;
    }

    applyForce(id, force, point = null) {
        const b = this.getPhysicsBody(id);
        if (!b) return false;
        if (point) b.addForceAtPoint(force, point, true); else b.addForce(force, true);
        return true;
    }

    applyTorqueImpulse(id, torque) {
        const b = this.getPhysicsBody(id);
        if (!b) return false;
        b.applyTorqueImpulse(torque, true);
        return true;
    }

    setLinearVelocity(id, v) {
        const b = this.getPhysicsBody(id);
        if (!b) return false;
        b.setLinvel(v, true);
        const vel = this.game.getComponent(id, 'velocity');
        if (vel) { vel.vx = v.x; vel.vy = v.y; vel.vz = v.z; }
        return true;
    }

    getLinearVelocity(id) {
        const b = this.getPhysicsBody(id);
        if (!b) return null;
        const v = b.linvel();
        return { x: v.x, y: v.y, z: v.z };
    }

    /** Move a body (and its transform) straight to a place, dropping its speed unless keepVelocity. */
    teleportBody(id, position, rotation = null, keepVelocity = false) {
        const b = this.getPhysicsBody(id);
        const t = this.game.getComponent(id, 'transform');
        if (t) {
            t.position.x = position.x; t.position.y = position.y; t.position.z = position.z;
            if (rotation) { t.rotation.x = rotation.x || 0; t.rotation.y = rotation.y || 0; t.rotation.z = rotation.z || 0; }
        }
        if (!b) return false;
        b.setTranslation(position, true);
        if (rotation) b.setRotation(PhysicsSystem.eulerToQuat(rotation), true);
        if (!keepVelocity && b.isDynamic()) { b.setLinvel({ x: 0, y: 0, z: 0 }, true); b.setAngvel({ x: 0, y: 0, z: 0 }, true); }
        return true;
    }

    /**
     * An explosion: every dynamic body (entities, ragdolls, debris) within radius of center is
     * pushed out from it, hardest near (falloff 0 = same everywhere, 1 = nothing at the edge), and
     * lifted by `up` (a share of the push). strength is a speed change: heavy and light go alike.
     */
    radialImpulse(center, radius, strength, { up = 0.7, falloff = 0.6, mask = 0xffff } = {}) {
        if (!this.world || !(radius > 0)) return 0;
        let n = 0;
        this.world.forEachRigidBody(body => {
            if (!body.isDynamic()) return;
            const col = body.numColliders() ? body.collider(0) : null;
            if (col && !((col.collisionGroups() >>> 16) & mask)) return;
            const p = body.translation(), dx = p.x - center.x, dy = p.y - (center.y ?? p.y), dz = p.z - center.z;
            const d = Math.hypot(dx, dy, dz);
            if (d > radius) return;
            const k = strength * (1 - (d / radius) * falloff) * body.mass();
            const ux = d > 1e-3 ? dx / d : 0, uz = d > 1e-3 ? dz / d : 0;
            body.applyImpulse({ x: ux * k, y: k * up, z: uz * k }, true);
            n++;
        });
        return n;
    }

    // ==================== QUERIES ====================

    _filter(opts) {
        const groups = ((opts.groups ?? 0xffff) << 16) | (opts.mask ?? 0xffff);
        const excl = opts.exclude != null ? this.getPhysicsBody(opts.exclude) : null;
        const flags = opts.sensors ? undefined : this.R.QueryFilterFlags.EXCLUDE_SENSORS;
        return { groups, excl, flags };
    }

    /**
     * The first collider along a ray: { entityId (null if not an entity), point, normal, distance }
     * or null. opts: { mask, exclude (an entity id), sensors (hit sensors too) }.
     */
    raycast(origin, dir, maxDistance = 1e5, opts = {}) {
        if (!this.world) return null;
        const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
        const d = { x: dir.x / len, y: dir.y / len, z: dir.z / len };
        const f = this._filter(opts);
        const hit = this.world.castRayAndGetNormal(new this.R.Ray(origin, d), maxDistance, true, f.flags, f.groups, undefined, f.excl);
        if (!hit) return null;
        const t = hit.timeOfImpact;
        return {
            entityId: this.owners.get(hit.collider.handle) ?? null,
            point: { x: origin.x + d.x * t, y: origin.y + d.y * t, z: origin.z + d.z * t },
            normal: { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z },
            distance: t
        };
    }

    /**
     * Sweep a shape ({ shape, halfExtents, radius, halfHeight } as on a collider) from origin along
     * dir: { entityId, point, normal, distance } of the first thing it would touch, or null.
     */
    shapeCast(shape, origin, dir, maxDistance = 1e5, opts = {}) {
        if (!this.world) return null;
        const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
        const d = { x: dir.x / len, y: dir.y / len, z: dir.z / len };
        const f = this._filter(opts);
        const rot = shape.rotation ? PhysicsSystem.eulerToQuat(shape.rotation) : { x: 0, y: 0, z: 0, w: 1 };
        const hit = this.world.castShape(origin, rot, d, this.shapeOf(shape), 0, maxDistance, true, f.flags, f.groups, undefined, f.excl);
        if (!hit) return null;
        return {
            entityId: this.owners.get(hit.collider.handle) ?? null,
            point: { x: hit.witness1.x, y: hit.witness1.y, z: hit.witness1.z },
            normal: { x: hit.normal1.x, y: hit.normal1.y, z: hit.normal1.z },
            distance: hit.time_of_impact
        };
    }

    shapeOf(c) {
        const R = this.R, S = this.enumOf('colliderShape');
        const shape = typeof c.shape === 'string' ? S[c.shape] : (c.shape ?? S.box);
        const he = c.halfExtents || {}, r = c.radius ?? 16, hh = c.halfHeight ?? 16;
        return shape === S.sphere ? new R.Ball(r)
            : shape === S.capsule ? new R.Capsule(hh, r)
            : shape === S.cylinder ? new R.Cylinder(hh, r)
            : shape === S.cone ? new R.Cone(hh, r)
            : new R.Cuboid(he.x ?? 16, he.y ?? 16, he.z ?? 16);
    }

    /** Entity ids whose colliders overlap a sphere (statics and effects aren't entities: left out). */
    overlapSphere(center, radius, opts = {}) {
        if (!this.world) return [];
        const f = this._filter(opts), out = [], seen = new Set();
        this.world.intersectionsWithShape(center, { x: 0, y: 0, z: 0, w: 1 }, new this.R.Ball(radius), col => {
            const id = this.owners.get(col.handle);
            if (id != null && !seen.has(id)) { seen.add(id); out.push(id); }
            return true;
        }, f.flags, f.groups, undefined, f.excl);
        return out;
    }

    isGrounded(id) {
        return !!this.game.getComponent(id, 'characterController')?.grounded;
    }

    // ==================== WORLD ====================

    /** { R: the Rapier module, world } for code that needs Rapier directly, or null before it starts. */
    getPhysicsWorld() {
        return this.world ? { R: this.R, world: this.world } : null;
    }

    setGravity(y) {
        this.config.gravity = y;
        if (this.world) this.world.gravity = { x: 0, y, z: 0 };
    }

    /** Draw every collider as lines (client only), into parent or the RenderSystem's scene. */
    togglePhysicsDebug(on = !this.debugLines, parent = null) {
        if (this.game.isServer || typeof THREE === 'undefined') return false;
        const scene = parent || this.game.renderSystem?.scene || this.game.worldSystem?.worldRenderer?.scene;
        if (on && !this.debugLines && scene) {
            const geo = new THREE.BufferGeometry();
            this.debugLines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.8 }));
            this.debugLines.frustumCulled = false;
            this.debugLines.renderOrder = 999;
            scene.add(this.debugLines);
        } else if (!on && this.debugLines) {
            this.debugLines.parent?.remove(this.debugLines);
            this.debugLines.geometry.dispose();
            this.debugLines.material.dispose();
            this.debugLines = null;
        }
        return !!this.debugLines;
    }

    drawDebug() {
        if (!this.world) return;
        const { vertices, colors } = this.world.debugRender();
        const geo = this.debugLines.geometry;
        geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 4));
        geo.computeBoundingSphere();
    }

    // ==================== ROTATION ====================

    /** transform.rotation (radians, applied yaw, then pitch, then roll: Euler 'YXZ') as a quaternion. */
    static eulerToQuat(e) {
        const x = (e?.x || 0) / 2, y = (e?.y || 0) / 2, z = (e?.z || 0) / 2;
        const c1 = Math.cos(x), c2 = Math.cos(y), c3 = Math.cos(z), s1 = Math.sin(x), s2 = Math.sin(y), s3 = Math.sin(z);
        return {
            x: s1 * c2 * c3 + c1 * s2 * s3,
            y: c1 * s2 * c3 - s1 * c2 * s3,
            z: c1 * c2 * s3 - s1 * s2 * c3,
            w: c1 * c2 * c3 + s1 * s2 * s3
        };
    }

    /** A quaternion back into an Euler 'YXZ' rotation, written into out. */
    static quatToEuler(q, out) {
        const { x, y, z, w } = q;
        const m11 = 1 - 2 * (y * y + z * z), m13 = 2 * (x * z + w * y);
        const m21 = 2 * (x * y + w * z), m22 = 1 - 2 * (x * x + z * z), m23 = 2 * (y * z - w * x);
        const m31 = 2 * (x * z - w * y), m33 = 1 - 2 * (x * x + y * y);
        out.x = Math.asin(-Math.max(-1, Math.min(1, m23)));
        if (Math.abs(m23) < 0.9999999) { out.y = Math.atan2(m13, m33); out.z = Math.atan2(m21, m22); }
        else { out.y = Math.atan2(-m31, m11); out.z = 0; }
        return out;
    }
}

if (typeof global !== 'undefined') { if (!global.GUTS) global.GUTS = {}; global.GUTS.PhysicsSystem = PhysicsSystem; }
if (typeof window !== 'undefined') { if (!window.GUTS) window.GUTS = {}; window.GUTS.PhysicsSystem = PhysicsSystem; }
export default PhysicsSystem;
export { PhysicsSystem };
