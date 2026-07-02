/**
 * PlayerControllerSystem - WASD movement + mouse aim for the ARPG player character.
 *
 * - WASD moves the character relative to the camera view
 * - The mouse cursor aims: a ground raycast tracks the aim point each frame
 * - Holding left mouse performs basic attacks toward the aim point
 *   (melee swing or projectile, mirroring AttackEnemyBehaviorAction's recipe)
 * - The character faces movement direction while moving, aim direction while attacking
 *
 * Movement itself is applied by MovementSystem, which reads the playerControlled
 * component's moveX/moveZ as the desired velocity (see MovementSystem override).
 */
class PlayerControllerSystem extends GUTS.BaseSystem {
    static services = [
        'getAimPosition'
    ];

    static serviceDependencies = [
        'getPlayerCharacter',
        'getCamera',
        'getWorldScene',
        'scheduleDamage',
        'fireProjectile',
        'triggerSinglePlayAnimation',
        'getNearbyUnits',
        'getTerrainHeightAtPosition',
        'useAbility'
    ];

    constructor(game) {
        super(game);
        this.game.playerControllerSystem = this;

        this.keys = {};
        this.mouseScreen = { x: 0, y: 0 };
        this.mouseDown = { left: false, right: false };
        this.aimPos = { x: 0, y: 0, z: 0 };
        this.raycastHelper = null;
        this.canvas = null;

        this._boundKeyDown = null;
        this._boundKeyUp = null;
        this._boundMouseMove = null;
        this._boundMouseDown = null;
        this._boundMouseUp = null;
        this._boundContextMenu = null;
        this._boundBlur = null;
    }

    init() {}

    onSceneLoad() {
        if (!this.game.state.isAdventure) return;
        this.canvas = document.getElementById('gameCanvas');
        this.setupListeners();
    }

    setupListeners() {
        this.teardownListeners();

        this._boundKeyDown = (e) => {
            if (this.isTypingInInput(e)) return;
            this.keys[e.code] = true;
        };
        this._boundKeyUp = (e) => {
            this.keys[e.code] = false;
        };
        this._boundMouseMove = (e) => {
            this.mouseScreen.x = e.clientX;
            this.mouseScreen.y = e.clientY;
        };
        this._boundMouseDown = (e) => {
            if (e.target !== this.canvas) return;
            if (e.button === 0) this.mouseDown.left = true;
            if (e.button === 2) this.mouseDown.right = true;
        };
        this._boundMouseUp = (e) => {
            if (e.button === 0) this.mouseDown.left = false;
            if (e.button === 2) this.mouseDown.right = false;
        };
        this._boundContextMenu = (e) => {
            if (e.target === this.canvas) e.preventDefault();
        };
        this._boundBlur = () => {
            this.keys = {};
            this.mouseDown.left = false;
            this.mouseDown.right = false;
        };

        document.addEventListener('keydown', this._boundKeyDown);
        document.addEventListener('keyup', this._boundKeyUp);
        document.addEventListener('mousemove', this._boundMouseMove);
        document.addEventListener('mousedown', this._boundMouseDown);
        document.addEventListener('mouseup', this._boundMouseUp);
        document.addEventListener('contextmenu', this._boundContextMenu);
        window.addEventListener('blur', this._boundBlur);
    }

    teardownListeners() {
        if (this._boundKeyDown) document.removeEventListener('keydown', this._boundKeyDown);
        if (this._boundKeyUp) document.removeEventListener('keyup', this._boundKeyUp);
        if (this._boundMouseMove) document.removeEventListener('mousemove', this._boundMouseMove);
        if (this._boundMouseDown) document.removeEventListener('mousedown', this._boundMouseDown);
        if (this._boundMouseUp) document.removeEventListener('mouseup', this._boundMouseUp);
        if (this._boundContextMenu) document.removeEventListener('contextmenu', this._boundContextMenu);
        if (this._boundBlur) window.removeEventListener('blur', this._boundBlur);
    }

    isTypingInInput(e) {
        const tag = e.target?.tagName;
        return tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable;
    }

    getAimPosition() {
        return { ...this.aimPos };
    }

    // ─── Frame update ─────────────────────────────────────────────────────────

    update() {
        if (!this.game.state.isAdventure) return;

        const entityId = this.call.getPlayerCharacter?.();
        if (entityId == null) return;

        const pc = this.game.getComponent(entityId, 'playerControlled');
        if (!pc) return;

        const deathState = this.game.getComponent(entityId, 'deathState');
        if (deathState && deathState.state !== this.enums.deathState.alive) {
            pc.moveX = 0;
            pc.moveZ = 0;
            pc.attacking = 0;
            return;
        }

        this.updateAim(entityId, pc);
        this.updateMovement(entityId, pc);
        this.updateAttack(entityId, pc);
        this.updateSkillCasting(entityId);
    }

    // ─── Skill casting (RMB + 1-4) ───────────────────────────────────────────

    updateSkillCasting(entityId) {
        const slots = [];
        if (this.mouseDown.right) slots.push('rmb');
        if (this.keys['Digit1']) slots.push('s1');
        if (this.keys['Digit2']) slots.push('s2');
        if (this.keys['Digit3']) slots.push('s3');
        if (this.keys['Digit4']) slots.push('s4');
        for (const slot of slots) {
            this.castSkillSlot(entityId, slot);
        }
    }

    castSkillSlot(entityId, slot) {
        const sheet = this.game.getComponent(entityId, 'characterSheet');
        const skillId = sheet?.skillBar?.[slot];
        if (!skillId) return false;

        const sts = this.game.skillTreeSystem;
        const found = sts?.getSkillDef?.(sheet.classId, skillId);
        if (!found?.skill?.ability) return false;

        // Face the aim point
        const transform = this.game.getComponent(entityId, 'transform');
        const pos = transform?.position;
        if (pos && transform.rotation) {
            const dx = this.aimPos.x - pos.x;
            const dz = this.aimPos.z - pos.z;
            if (dx !== 0 || dz !== 0) {
                transform.rotation.y = Math.round(Math.atan2(dz, dx) * 1000000) / 1000000;
            }
        }

        // Prefer the enemy nearest the cursor as the ability target
        const myTeam = this.game.getComponent(entityId, 'team')?.team;
        const target = this.closestEnemyTo(this.aimPos, 150, myTeam, entityId);

        return this.call.useAbility(entityId, found.skill.ability, target ?? null);
    }

    // Camera-relative WASD direction, normalized
    updateMovement(entityId, pc) {
        let ix = 0, iz = 0;
        if (this.keys['KeyW']) iz -= 1;
        if (this.keys['KeyS']) iz += 1;
        if (this.keys['KeyA']) ix -= 1;
        if (this.keys['KeyD']) ix += 1;

        if (ix === 0 && iz === 0) {
            pc.moveX = 0;
            pc.moveZ = 0;
            return;
        }

        // Project camera forward onto ground plane to get "screen up" in world space
        let fwdX = 0, fwdZ = -1;
        const camera = this.call.getCamera?.();
        if (camera) {
            const dir = new THREE.Vector3();
            camera.getWorldDirection(dir);
            // Ground-plane projection
            let fx = dir.x, fz = dir.z;
            const len = Math.sqrt(fx * fx + fz * fz);
            if (len > 0.0001) {
                fwdX = fx / len;
                fwdZ = fz / len;
            }
        }
        // Right vector (perpendicular on ground plane)
        const rightX = -fwdZ;
        const rightZ = fwdX;

        // Screen up = camera forward, screen right = camera right
        let mx = rightX * ix + fwdX * (-iz);
        let mz = rightZ * ix + fwdZ * (-iz);
        const mlen = Math.sqrt(mx * mx + mz * mz);
        if (mlen > 0.0001) {
            mx /= mlen;
            mz /= mlen;
        }

        pc.moveX = mx;
        pc.moveZ = mz;
    }

    // Raycast the mouse cursor to a ground position
    updateAim(entityId, pc) {
        const camera = this.call.getCamera?.();
        const scene = this.call.getWorldScene?.();
        if (!camera || !this.canvas) return;

        if (!this.raycastHelper && scene) {
            this.raycastHelper = new GUTS.RaycastHelper(camera, scene);
        }
        if (!this.raycastHelper) return;

        this.raycastHelper.setCamera(camera);

        const rect = this.canvas.getBoundingClientRect();
        const ndcX = ((this.mouseScreen.x - rect.left) / rect.width) * 2 - 1;
        const ndcY = -((this.mouseScreen.y - rect.top) / rect.height) * 2 + 1;

        let worldPos = this.raycastHelper.rayCastGround(ndcX, ndcY);
        if (!worldPos) {
            worldPos = this.raycastHelper.rayCastFlatPlane?.(ndcX, ndcY, 0);
        }
        if (!worldPos) return;

        this.aimPos.x = worldPos.x;
        this.aimPos.y = worldPos.y || 0;
        this.aimPos.z = worldPos.z;

        pc.aimX = worldPos.x;
        pc.aimY = worldPos.y || 0;
        pc.aimZ = worldPos.z;
    }

    // ─── Basic attack (left mouse) ────────────────────────────────────────────

    updateAttack(entityId, pc) {
        pc.attacking = this.mouseDown.left ? 1 : 0;
        if (!this.mouseDown.left) return;

        const combat = this.game.getComponent(entityId, 'combat');
        const transform = this.game.getComponent(entityId, 'transform');
        const pos = transform?.position;
        if (!combat || !pos) return;

        // Attack cooldown from attack speed
        if (!combat.lastAttack) combat.lastAttack = 0;
        const attackSpeed = combat.attackSpeed || 1;
        if (attackSpeed > 0 &&
            (this.game.state.now - combat.lastAttack) < 1 / attackSpeed) {
            return;
        }

        // Face the aim point while attacking
        const adx = this.aimPos.x - pos.x;
        const adz = this.aimPos.z - pos.z;
        if (transform.rotation && (adx !== 0 || adz !== 0)) {
            transform.rotation.y = Math.round(Math.atan2(adz, adx) * 1000000) / 1000000;
        }

        const hasProjectile = combat.projectile !== null &&
            combat.projectile !== -1 &&
            combat.projectile !== undefined;

        // Find a target near the aim point (or in front of us for melee)
        const target = this.findAttackTarget(entityId, pos, combat, hasProjectile);
        if (target == null) return;

        combat.lastAttack = this.game.state.now;

        // Attack animation
        if (this.game.hasService('triggerSinglePlayAnimation') && attackSpeed > 0) {
            this.call.triggerSinglePlayAnimation(
                entityId,
                this.enums.animationType.attack,
                attackSpeed,
                1 / attackSpeed * 0.8
            );
        }

        const totalDamage = combat.damage || 0;
        const halfSwing = attackSpeed > 0 ? (1 / attackSpeed) * 0.5 : 0;

        if (hasProjectile) {
            this.game.schedulingSystem.scheduleAction(() => {
                this.firePlayerProjectile(entityId, target, combat, totalDamage);
            }, halfSwing, entityId);
        } else if (totalDamage > 0) {
            this.call.scheduleDamage(
                entityId,
                target,
                totalDamage,
                combat.element ?? this.enums.element.physical,
                halfSwing,
                { isMelee: true, weaponRange: (combat.range || 50) + 10 }
            );
        }
    }

    firePlayerProjectile(entityId, targetId, combat, damage) {
        const targetHealth = this.game.getComponent(targetId, 'health');
        if (!targetHealth || targetHealth.current <= 0) return;

        const projectileName = this.reverseEnums?.projectiles?.[combat.projectile];
        if (!projectileName) return;
        const projectileData = this.collections.projectiles?.[projectileName];
        if (!projectileData) return;

        this.call.fireProjectile(entityId, targetId, {
            id: projectileName,
            ...projectileData,
            damage
        });
    }

    /**
     * Pick a basic-attack target:
     * 1. The living enemy closest to the cursor within a grab radius
     * 2. For melee: otherwise the nearest enemy within melee reach in the aim direction
     * 3. For ranged: otherwise the nearest enemy roughly along the aim direction, in range
     */
    findAttackTarget(entityId, pos, combat, isRanged) {
        const cursorGrabRadius = 60;
        const myTeam = this.game.getComponent(entityId, 'team')?.team;

        // 1. Enemy under/near cursor
        let best = this.closestEnemyTo(this.aimPos, cursorGrabRadius, myTeam, entityId);
        if (best != null) {
            // Ranged can hit anything near the cursor; melee needs it in reach
            if (isRanged) return best;
            const range = (combat.range || 50) + 30;
            const bpos = this.game.getComponent(best, 'transform')?.position;
            if (bpos) {
                const d = Math.hypot(bpos.x - pos.x, bpos.z - pos.z);
                if (d <= range + this.getRadius(best)) return best;
            }
            best = null;
        }

        // 2/3. Nearest enemy in the aim direction
        const searchRange = isRanged ? Math.max(combat.range || 300, 300) : (combat.range || 50) + 60;
        const nearby = this.call.getNearbyUnits(pos, searchRange, entityId) || [];

        const aimDx = this.aimPos.x - pos.x;
        const aimDz = this.aimPos.z - pos.z;
        const aimLen = Math.hypot(aimDx, aimDz);
        const aimNx = aimLen > 0.001 ? aimDx / aimLen : 1;
        const aimNz = aimLen > 0.001 ? aimDz / aimLen : 0;

        let bestScore = -Infinity;
        let bestId = null;
        for (const otherId of nearby) {
            if (!this.isAttackableEnemy(otherId, myTeam)) continue;
            const opos = this.game.getComponent(otherId, 'transform')?.position;
            if (!opos) continue;
            const dx = opos.x - pos.x;
            const dz = opos.z - pos.z;
            const dist = Math.hypot(dx, dz);
            if (dist > searchRange + this.getRadius(otherId)) continue;

            // Prefer targets in front of the aim direction, then closer ones
            const dot = dist > 0.001 ? (dx / dist) * aimNx + (dz / dist) * aimNz : 1;
            if (!isRanged && dot < 0.2) continue;     // melee: only swing forward
            if (isRanged && dot < 0.5) continue;      // ranged: fire along aim only
            const score = dot * 2 - dist / searchRange;
            if (score > bestScore) {
                bestScore = score;
                bestId = otherId;
            }
        }
        return bestId;
    }

    closestEnemyTo(point, radius, myTeam, selfId) {
        const nearby = this.call.getNearbyUnits(point, radius, selfId) || [];
        let bestId = null;
        let bestDist = Infinity;
        for (const otherId of nearby) {
            if (!this.isAttackableEnemy(otherId, myTeam)) continue;
            const opos = this.game.getComponent(otherId, 'transform')?.position;
            if (!opos) continue;
            const d = Math.hypot(opos.x - point.x, opos.z - point.z);
            if (d < bestDist && d <= radius + this.getRadius(otherId)) {
                bestDist = d;
                bestId = otherId;
            }
        }
        return bestId;
    }

    isAttackableEnemy(otherId, myTeam) {
        const team = this.game.getComponent(otherId, 'team');
        if (!team || team.team === myTeam || team.team === this.enums.team.neutral) return false;
        const health = this.game.getComponent(otherId, 'health');
        if (!health || health.current <= 0) return false;
        const deathState = this.game.getComponent(otherId, 'deathState');
        if (deathState && deathState.state !== this.enums.deathState.alive) return false;
        if (this.game.hasComponent(otherId, 'projectile')) return false;
        return true;
    }

    getRadius(entityId) {
        const collision = this.game.getComponent(entityId, 'collision');
        return collision?.radius || 25;
    }

    onSceneUnload() {
        this.teardownListeners();
        this.keys = {};
        this.mouseDown = { left: false, right: false };
        this.raycastHelper = null;
        this.canvas = null;
    }
}
