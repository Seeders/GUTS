class MindControlAbility extends engine.app.appClasses['BaseAbility'] {
  constructor(game, params = {}) {
    super(game, {
      id: 'mind_control',
      name: 'Mind Control',
      description: 'Charms enemy to fight for you',
      cooldown: 5.0,
      range: 250,
      manaCost: 0,
      targetType: 'enemy',
      animation: 'cast',
      priority: 8,
      castTime: 3.0,
      autoTrigger: 'enemy_in_range',
      ...params
    });

    this.controlDuration = 5.0;

    // one pending control per target
    // Map<targetId, { team, contributors:Set<casterId>, progress:0..1, lastUpdate:ms, timeoutId:any, controller:any }>
    this.pendingControls = new Map();

    // beams we need to clean up
    // Map<targetId, { team, beams: Map<casterId, effectData> }>
    this.beamRegistry = new Map();
  }

  // ---------- cooperative buildup core ----------
  getRatePerCaster(){ return 1 / Math.max(0.001, this.castTime); }

  startOrJoinPending(casterEntity, targetId, controllerTeam) {
    // already controlled? don't start new pending; also clear any beams
    if (this.game.hasComponent(targetId, this.componentTypes.MIND_CONTROLLED)) {
      this.clearAllBeamsForTarget(targetId);
      return;
    }

    const now = Date.now();
    let pending = this.pendingControls.get(targetId);

    if (pending) {
      // if other team contests, reset progress AND clear their beams
      if (pending.team !== controllerTeam) {
        if (pending.timeoutId) clearTimeout(pending.timeoutId);
        this.clearAllBeamsForTarget(targetId);
        pending = { team: controllerTeam, contributors: new Set(), progress: 0, lastUpdate: now, timeoutId: null, controller: casterEntity };
        this.pendingControls.set(targetId, pending);
      } else {
        this.updatePendingProgress(targetId);
      }
    } else {
      pending = { team: controllerTeam, contributors: new Set(), progress: 0, lastUpdate: now, timeoutId: null, controller: casterEntity };
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
    const n  = p.contributors.size;
    if (n > 0 && dt > 0) {
      p.progress = Math.min(1, p.progress + dt * this.getRatePerCaster() * n);
    }
    p.lastUpdate = now;
  }

  reschedulePending(targetId) {
    const p = this.pendingControls.get(targetId);
    if (!p) return;
    if (p.timeoutId) { clearTimeout(p.timeoutId); p.timeoutId = null; }

    this.updatePendingProgress(targetId);
    if (p.progress >= 1) { this.finishPending(targetId); return; }

    const n = Math.max(1, p.contributors.size);
    const rate = this.getRatePerCaster() * n;
    const remainingSec = (1 - p.progress) / rate;

    p.timeoutId = setTimeout(() => this.finishPending(targetId), remainingSec * 1000);
  }

  finishPending(targetId) {
    const p = this.pendingControls.get(targetId);
    if (!p) return;
    this.pendingControls.delete(targetId);

    // choose any contributor as controller
    let controller = p.controller;
    for (const c of p.contributors) { controller = c; break; }

    // CLEAN: remove all beams now
    this.clearAllBeamsForTarget(targetId);

    this.applyMindControl(controller, targetId, p.team);
  }

  // optional hook you can call on death/out-of-range/stun
  cancelContribution(casterEntity, targetId) {
    const p = this.pendingControls.get(targetId);
    if (!p) return;
    if (p.contributors.delete(casterEntity)) {
      // remove this caster's beam immediately
      this.clearBeam(casterEntity, targetId);

      if (p.contributors.size === 0) {
        if (p.timeoutId) clearTimeout(p.timeoutId);
        this.pendingControls.delete(targetId);
        // no contributors left; also ensure beams are gone
        this.clearAllBeamsForTarget(targetId);
      } else {
        this.reschedulePending(targetId);
      }
    }
  }

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

            // small bonus if our team already has a pending charm on this target
            const pending = this.pendingControls.get(id);
            const synergy = pending && pending.team === teamId ? 100 : 0;

            const score = base + synergy;
            if (score > bestScore) { bestScore = score; best = id; }
        }
        return best;
    }

  // ---------- ability flow ----------
  execute(casterEntity) {
    const casterPos  = this.game.getComponent(casterEntity, this.componentTypes.POSITION);
    const casterTeam = this.game.getComponent(casterEntity, this.componentTypes.TEAM);
    if (!casterPos || !casterTeam) return;

    const enemies = this.getEnemiesInRange(casterEntity);
    const target  = this.findBestControlTarget(enemies, casterTeam.team);
    if (!target) return;

    const targetPos = this.game.getComponent(target, this.componentTypes.POSITION);
    if (!targetPos) return;

    // visuals (per-caster beam)
    this.createVisualEffect(casterPos, 'cast');

    if (this.game.effectsSystem) {
      const beam = this.game.effectsSystem.createEnergyBeam(
        new THREE.Vector3(casterPos.x, casterPos.y + 15, casterPos.z),
        new THREE.Vector3(targetPos.x, targetPos.y + 10, targetPos.z),
        {
          style: { color: 0x8A2BE2, linewidth: 3 },
          // duration is arbitrary because we'll destroy it manually
          animation: { duration: 60000, pulseEffect: true }
        }
      );
      this.registerBeam(casterEntity, target, casterTeam.team, beam);
    }

    // cooperative buildup
    this.startOrJoinPending(casterEntity, target, casterTeam.team);
    this.logAbilityUsage(casterEntity, `Dark magic bends an enemy's will!`, true);
  }

  applyMindControl(casterEntity, targetId, controllerTeam) {
    const targetPos      = this.game.getComponent(targetId, this.componentTypes.POSITION);
    const targetTeam     = this.game.getComponent(targetId, this.componentTypes.TEAM);
    const targetUnitType = this.game.getComponent(targetId, this.componentTypes.UNIT_TYPE);
    if (!targetPos || !targetTeam || !targetUnitType) return;

    // ensure ALL beams on this target are gone before/when it flips
    this.clearAllBeamsForTarget(targetId);

    // already controlled? just refresh; (still ensure beams are gone)
    if (this.game.hasComponent(targetId, this.componentTypes.MIND_CONTROLLED)) {
      const comp = this.game.getComponent(targetId, this.componentTypes.MIND_CONTROLLED);
      comp.endTime = Math.max(comp.endTime, Date.now() / 1000 + this.controlDuration);
      return;
    }

    this.createVisualEffect(targetPos, 'control');
    const originalTeam = targetTeam.team;
    targetTeam.team = controllerTeam;

    const ai = this.game.getComponent(targetId, this.componentTypes.AI_STATE);
    if (ai?.aiBehavior) {
      ai.aiBehavior.currentTarget = null;
      ai.aiBehavior.targetPosition = null;
    }

    this.game.addComponent(targetId, this.componentTypes.MIND_CONTROLLED, {
      originalTeam,
      controller: casterEntity,
      endTime: Date.now() / 1000 + this.controlDuration
    });

    setTimeout(() => this.removeMindControl(targetId, originalTeam), this.controlDuration * 1000);

    if (this.game.effectsSystem) {
      this.game.effectsSystem.createAuraEffect(targetPos.x, targetPos.y, targetPos.z, 'magic', this.controlDuration * 1000);
    }

    this.game.battleLogSystem?.add(`${targetUnitType.title || targetUnitType.type} is now under mind control!`, 'log-control');
  }
    removeMindControl(targetId, originalTeam) {
        const ct = this.componentTypes;
        const targetTeam     = this.game.getComponent(targetId, ct.TEAM);
        const targetPos      = this.game.getComponent(targetId, ct.POSITION);
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

  // ---------- beam registry & cleanup ----------
  registerBeam(casterId, targetId, team, effectData) {
    if (!effectData) return;
    let entry = this.beamRegistry.get(targetId);
    if (!entry || entry.team !== team) {
      // team changed or new target: nuke old beams
      if (entry) this.clearAllBeamsForTarget(targetId);
      entry = { team, beams: new Map() };
      this.beamRegistry.set(targetId, entry);
    }
    // if caster already had a beam to this target, replace it
    const old = entry.beams.get(casterId);
    if (old) this.destroyBeam(old);
    entry.beams.set(casterId, effectData);
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

    // If your EffectsSystem has the helper below, prefer it:
    if (es?.destroyLineEffect) { es.destroyLineEffect(effectData); return; }

    // Fallback: manual cleanup
    try {
      const scene = this.game.scene;
      if (scene && effectData.line) scene.remove(effectData.line);
      effectData.geometry?.dispose?.();
      effectData.material?.dispose?.();
      // remove from active list to stop animator
      if (es?.activeLineEffects) {
        const idx = es.activeLineEffects.indexOf(effectData);
        if (idx >= 0) es.activeLineEffects.splice(idx, 1);
      }
    } catch (e) {
      console.warn('Failed to destroy beam effect:', e);
    }
  }
}
