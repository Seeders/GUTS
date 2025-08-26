class MindControlAbility extends engine.app.appClasses['BaseAbility'] {
  constructor(game, params = {}) {
    super(game, {
      id: 'mind_control',
      name: 'Mind Control',
      description: 'Charms enemy to fight for you',
      cooldown: 5.0,
      range: 190,
      manaCost: 0,
      targetType: 'enemy',
      animation: 'cast',
      priority: 8,
      castTime: 3.0,
      autoTrigger: 'enemy_in_range',
      ...params
    });

    // How long control lasts once applied
    this.controlDuration = 5.0;

    // One pending control per target:
    // Map<targetId, { team, contributors:Set<casterId>, progress:0..1, lastUpdate:ms, timeoutId:any, controller:any }>
    this.pendingControls = new Map();

    // Track active beams so we can cleanly destroy them:
    // Map<targetId, { team, beams: Map<casterId, effectData> }>
    this.beamRegistry = new Map();
  }

  // ---------------- Effects map for BaseAbility helpers ----------------
  defineEffects() {
    return {
      cast: {
        type: 'magic',
        options: {
          count: 5,
          color: 0x8A2BE2,
          colorRange: { start: 0x8A2BE2, end: 0xDDA0DD },
          scaleMultiplier: 1.5,
          speedMultiplier: 1.8
        }
      },
      control: {
        type: 'magic',
        options: {
          count: 3,
          color: 0x9932CC,
          scaleMultiplier: 2.0,
          speedMultiplier: 2.0
        }
      },
      charm: {
        type: 'magic',
        options: {
          count: 5,
          color: 0xDA70D6,
          scaleMultiplier: 1.5,
          speedMultiplier: 3.0
        }
      }
    };
  }

  // ---------------- Cooperative buildup core ----------------
  getRatePerCaster() {
    // 1.0 progress requires castTime seconds with a single caster
    return 1 / Math.max(0.001, this.castTime);
  }

  startOrJoinPending(casterEntity, targetId, controllerTeam) {
    // If already controlled, just clear any residual beams
    if (this.game.hasComponent(targetId, this.componentTypes.MIND_CONTROLLED)) {
      this.clearAllBeamsForTarget(targetId);
      return;
    }

    const now = Date.now();
    let pending = this.pendingControls.get(targetId);

    if (pending) {
      // If contested by a different team, reset and clear that team's beams
      if (pending.team !== controllerTeam) {
        if (pending.timeoutId) clearTimeout(pending.timeoutId);
        this.clearAllBeamsForTarget(targetId);
        pending = {
          team: controllerTeam,
          contributors: new Set(),
          progress: 0,
          lastUpdate: now,
          timeoutId: null,
          controller: casterEntity
        };
        this.pendingControls.set(targetId, pending);
      } else {
        this.updatePendingProgress(targetId);
      }
    } else {
      pending = {
        team: controllerTeam,
        contributors: new Set(),
        progress: 0,
        lastUpdate: now,
        timeoutId: null,
        controller: casterEntity
      };
      this.pendingControls.set(targetId, pending);
    }

    pending.contributors.add(casterEntity);
    if (!pending.controller) pending.controller = casterEntity;

    this.reschedulePending(targetId);
  }

  updatePendingProgress(targetId) {
    const p = this.pendingControls.get(targetId);
    if (!p) return;

    const now = Date.now();
    const dt = Math.max(0, (now - p.lastUpdate) / 1000);
    const n = p.contributors.size;

    if (n > 0 && dt > 0) {
      p.progress = Math.min(1, p.progress + dt * this.getRatePerCaster() * n);
    }
    p.lastUpdate = now;
  }

  reschedulePending(targetId) {
    const p = this.pendingControls.get(targetId);
    if (!p) return;

    if (p.timeoutId) {
      clearTimeout(p.timeoutId);
      p.timeoutId = null;
    }

    this.updatePendingProgress(targetId);

    if (p.progress >= 1) {
      this.finishPending(targetId);
      return;
    }

    const n = Math.max(1, p.contributors.size);
    const rate = this.getRatePerCaster() * n;
    const remainingSec = (1 - p.progress) / rate;

    p.timeoutId = setTimeout(() => this.finishPending(targetId), remainingSec * 1000);
  }

  finishPending(targetId) {
    const p = this.pendingControls.get(targetId);
    if (!p) return;

    this.pendingControls.delete(targetId);

    // Choose any contributor as controller
    let controller = p.controller;
    for (const c of p.contributors) {
      controller = c;
      break;
    }

    // Ensure beams are gone before flipping
    this.clearAllBeamsForTarget(targetId);

    this.applyMindControl(controller, targetId, p.team);
  }

  // Optional: call this when a caster dies/gets stunned/leaves range etc.
  cancelContribution(casterEntity, targetId) {
    const p = this.pendingControls.get(targetId);
    if (!p) return;

    if (p.contributors.delete(casterEntity)) {
      // Remove this caster's beam immediately
      this.clearBeam(casterEntity, targetId);

      if (p.contributors.size === 0) {
        if (p.timeoutId) clearTimeout(p.timeoutId);
        this.pendingControls.delete(targetId);
        this.clearAllBeamsForTarget(targetId);
      } else {
        this.reschedulePending(targetId);
      }
    }
  }

  // ---------------- Target selection & gating ----------------
  findBestControlTarget(enemies, teamId) {
    let best = null, bestScore = -Infinity;
    const ct = this.componentTypes;

    for (const id of enemies) {
      if (this.game.hasComponent(id, ct.MIND_CONTROLLED)) continue;

      const hp = this.game.getComponent(id, ct.HEALTH);
      const cb = this.game.getComponent(id, ct.COMBAT);
      const ut = this.game.getComponent(id, ct.UNIT_TYPE);
      if (!hp || !cb) continue;

      const base = Math.max(0, hp.current) + Math.max(0, cb.damage) * 2 + (ut?.value ?? 25);

      // Slight bias to join targets your team is already charming
      const pending = this.pendingControls.get(id);
      const synergy = pending && pending.team === teamId ? 100 : 0;

      const score = base + synergy;
      if (score > bestScore) {
        bestScore = score;
        best = id;
      }
    }
    return best;
  }

  canExecute(casterEntity) {
    const enemies = this.getEnemiesInRange(casterEntity);
    if (!enemies || enemies.length === 0) return false;
    return enemies.some(e => !this.game.hasComponent(e, this.componentTypes.MIND_CONTROLLED));
  }

  // ---------------- Ability flow ----------------
  execute(casterEntity) {
    const casterPos = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
    const casterTeam = this.game.getComponent(casterEntity, this.componentTypes.TEAM);
    if (!casterPos || !casterTeam) return;

    const enemies = this.getEnemiesInRange(casterEntity);
    const target = this.findBestControlTarget(enemies, casterTeam.team);
    if (!target) return;

    const targetPos = this.game.getComponent(target, this.componentTypes.POSITION);
    if (!targetPos) return;

    // Cast visuals
    this.createVisualEffect(casterPos, 'cast');

    // Create a per-caster beam that follows endpoints
    if (this.game.effectsSystem) {
      const beamStyle = { color: 0x8A2BE2, linewidth: 3 };
      const beam = this.game.effectsSystem.createEnergyBeam(
        new THREE.Vector3(casterPos.x, casterPos.y + 15, casterPos.z),
        new THREE.Vector3(targetPos.x, targetPos.y + 10, targetPos.z),
        { style: beamStyle, animation: { duration: 60000, pulseEffect: true } } // we'll destroy manually
      );
      if (beam) {
        beam._style = beamStyle; // stash for follow loop path regen
        this.registerBeam(casterEntity, target, casterTeam.team, beam);
      }
    }

    // Cooperative buildup
    this.startOrJoinPending(casterEntity, target, casterTeam.team);

    this.logAbilityUsage(casterEntity, `Dark magic bends an enemy's will!`, true);
  }

  applyMindControl(casterEntity, targetId, controllerTeam) {
    const targetPos = this.game.getComponent(targetId, this.componentTypes.POSITION);
    const targetTeam = this.game.getComponent(targetId, this.componentTypes.TEAM);
    const targetUnitType = this.game.getComponent(targetId, this.componentTypes.UNIT_TYPE);
    if (!targetPos || !targetTeam || !targetUnitType) return;

    // Ensure ALL beams are gone before/when it flips
    this.clearAllBeamsForTarget(targetId);

    // Refresh if already controlled
    if (this.game.hasComponent(targetId, this.componentTypes.MIND_CONTROLLED)) {
      const comp = this.game.getComponent(targetId, this.componentTypes.MIND_CONTROLLED);
      comp.endTime = Math.max(comp.endTime, (this.game.state?.simTime || 0) + this.controlDuration);
      return;
    }

    // Visual + team swap
    this.createVisualEffect(targetPos, 'control');
    const originalTeam = targetTeam.team;
    targetTeam.team = controllerTeam;

    // Reset AI targeting
    const ai = this.game.getComponent(targetId, this.componentTypes.AI_STATE);
    if (ai?.aiBehavior) {
      ai.aiBehavior.currentTarget = null;
      ai.aiBehavior.targetPosition = null;
    }

    // Mark controlled
    this.game.addComponent(targetId, this.componentTypes.MIND_CONTROLLED, {
      originalTeam,
      controller: casterEntity,
      endTime: (this.game.state?.simTime || 0) + this.controlDuration
    });

    // Schedule removal (prefer your LifetimeSystem if you have one)
    setTimeout(() => this.removeMindControl(targetId, originalTeam), this.controlDuration * 1000);

    // Aura
    if (this.game.effectsSystem) {
      this.game.effectsSystem.createAuraEffect(
        targetPos.x, targetPos.y, targetPos.z, 'magic', this.controlDuration * 1000
      );
    }

    this.game.battleLogSystem?.add(
      `${targetUnitType.title || targetUnitType.type} is now under mind control!`,
      'log-control'
    );
  }

  removeMindControl(targetId, originalTeam) {
    const ct = this.componentTypes;
    const targetTeam = this.game.getComponent(targetId, ct.TEAM);
    const targetPos = this.game.getComponent(targetId, ct.POSITION);
    const targetUnitType = this.game.getComponent(targetId, ct.UNIT_TYPE);

    if (targetTeam) targetTeam.team = originalTeam;

    if (targetPos) this.createVisualEffect(targetPos, 'charm', { count: 15 });

    if (this.game.hasComponent(targetId, ct.MIND_CONTROLLED)) {
      this.game.removeComponent(targetId, ct.MIND_CONTROLLED);
    }

    const ai = this.game.getComponent(targetId, ct.AI_STATE);
    if (ai?.aiBehavior) {
      ai.aiBehavior.currentTarget = null;
      ai.aiBehavior.targetPosition = null;
    }

    if (targetPos && this.game.effectsSystem) {
      this.game.effectsSystem.createParticleEffect(
        targetPos.x, targetPos.y, targetPos.z, 'magic',
        { count: 5, color: 0xDA70D6, scaleMultiplier: 1.0 }
      );
    }

    if (this.game.battleLogSystem && targetUnitType) {
      this.game.battleLogSystem.add(
        `${targetUnitType.title || targetUnitType.type} breaks free from mind control!`,
        'log-control'
      );
    }
  }

  // ---------------- Beam registry & cleanup ----------------
  registerBeam(casterId, targetId, team, effectData) {
    if (!effectData) return;

    let entry = this.beamRegistry.get(targetId);
    if (!entry || entry.team !== team) {
      // Team changed or new target: nuke old beams for this target
      if (entry) this.clearAllBeamsForTarget(targetId);
      entry = { team, beams: new Map() };
      this.beamRegistry.set(targetId, entry);
    }

    // Replace existing caster beam if any
    const old = entry.beams.get(casterId);
    if (old) this.destroyBeam(old);

    entry.beams.set(casterId, effectData);

    // Make the beam follow moving endpoints
    this.startBeamFollow(casterId, targetId, effectData);
  }

  clearBeam(casterId, targetId) {
    const entry = this.beamRegistry.get(targetId);
    if (!entry) return;
    const eff = entry.beams.get(casterId);
    if (eff) {
      this.destroyBeam(eff);
      entry.beams.delete(casterId);
    }
    if (entry.beams.size === 0) this.beamRegistry.delete(targetId);
  }

  clearAllBeamsForTarget(targetId) {
    const entry = this.beamRegistry.get(targetId);
    if (!entry) return;
    for (const eff of entry.beams.values()) this.destroyBeam(eff);
    this.beamRegistry.delete(targetId);
  }

  destroyBeam(effectData) {
    const es = this.game.effectsSystem;
    if (!effectData) return;

    // Stop any follow loop
    if (effectData._raf) { cancelAnimationFrame(effectData._raf); effectData._raf = null; }
    if (effectData._interval) { clearInterval(effectData._interval); effectData._interval = null; }

    // Prefer EffectsSystem helper if present
    if (es?.destroyLineEffect) { es.destroyLineEffect(effectData); return; }

    // Fallback: manual cleanup
    try {
      const scene = this.game.scene;
      if (scene && effectData.line) scene.remove(effectData.line);
      effectData.geometry?.dispose?.();
      effectData.material?.dispose?.();
      if (es?.activeLineEffects) {
        const idx = es.activeLineEffects.indexOf(effectData);
        if (idx >= 0) es.activeLineEffects.splice(idx, 1);
      }
    } catch (e) {
      console.warn('Failed to destroy beam effect:', e);
    }
  }

  // ---------------- Beam follow (endpoint tracking) ----------------
  startBeamFollow(casterId, targetId, effectData) {
    const ct = this.componentTypes;
    const es = this.game.effectsSystem;

    // Stop any previous follower on this effect
    if (effectData._raf) cancelAnimationFrame(effectData._raf);
    if (effectData._interval) clearInterval(effectData._interval);

    const loop = () => {
      // If beam is gone, stop
      if (!effectData || !effectData.line || !effectData.geometry) return;

      const cPos = this.game.getComponent(casterId, ct.POSITION);
      const tPos = this.game.getComponent(targetId, ct.POSITION);

      // If either entity vanished, destroy the beam
      if (!cPos || !tPos) {
        this.destroyBeam(effectData);
        return;
      }

      // Endpoints (with a small Y offset)
      const start = new THREE.Vector3(cPos.x, cPos.y + 15, cPos.z);
      const end = new THREE.Vector3(tPos.x, tPos.y + 10, tPos.z);

      // Try to regenerate the same path style; fallback to straight line
      try {
        const type = effectData.type || 'beam';
        const base = es.getLineEffectConfig?.(type)?.style || {};
        const style = { ...base, ...(effectData._style || {}) };
        const points = es.generateLinePath(start, end, type, style);
        effectData.geometry.setFromPoints(points);
      } catch {
        effectData.geometry.setFromPoints([start, end]);
      }

      // If BufferAttribute exists, mark for update
      if (effectData.geometry.attributes?.position) {
        effectData.geometry.attributes.position.needsUpdate = true;
      }

      effectData._raf = requestAnimationFrame(loop);
    };

    effectData._raf = requestAnimationFrame(loop);
  }

  // ---------------- Optional lifecycle helpers ----------------
  onOwnerDeath(ownerId) {
    // Stop contributing to any pending target and remove owner’s beams
    for (const [targetId, rec] of this.pendingControls.entries()) {
      if (rec.contributors.has(ownerId)) this.cancelContribution(ownerId, targetId);
    }
    // Also clear any stray beams that might still be registered
    for (const [targetId, entry] of this.beamRegistry.entries()) {
      if (entry.beams.has(ownerId)) this.clearBeam(ownerId, targetId);
    }
  }

  destroy() {
    // Cancel timers & clear pending
    for (const [, rec] of this.pendingControls.entries()) {
      if (rec.timeoutId) clearTimeout(rec.timeoutId);
    }
    this.pendingControls.clear();

    // Remove all beams
    for (const [targetId] of this.beamRegistry.entries()) {
      this.clearAllBeamsForTarget(targetId);
    }
    this.beamRegistry.clear();
  }
}
