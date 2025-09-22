class RenderSystem extends engine.BaseSystem {
  constructor(game) {
    super(game);
    this.game.renderSystem = this;
    this.componentTypes = this.game.componentManager.getComponentTypes();

    this.entityModels = new Map();            // entityId -> THREE.Group
    this.modelScale = 32;
    this.MIN_MOVEMENT_THRESHOLD = 0.1;

    // materialKey -> { material: THREE.Material, refCount: number }
    this.sharedMaterials = new Map();
    // entityId -> materialKey
    this.entityMaterials = new Map();

    // ---------- DEBUG CONFIG ----------
    this.DEBUG = true;                  // master on/off
    this.DEBUG_LEVEL = 1;               // 0=silent, 1=key events, 2=verbose, 3=spammy
    this.DEBUG_EVERY_N_FRAMES = 60;     // summary log cadence
    this._frame = 0;
    this._stats = {
      createdModels: 0,
      removedModels: 0,
      createdMaterials: 0,
      disposedMaterials: 0,
      lastFrameEntities: 0,
      lastFrameModels: 0,
    };
    // ----------------------------------

    this._bindDebugHelpers();
    this._d(1, "[RenderSystem] constructed");
  }

  // ===== Debug helpers =====
  _bindDebugHelpers() {
    // expose optional dev helpers (safe if window not present)
    try {
      if (typeof window !== "undefined") {
        window.RenderSystemDebug = {
          dumpMaterials: () => this.dumpMaterials(),
          dumpEntities: () => this.dumpEntities(),
          setLevel: (lvl) => (this.DEBUG_LEVEL = lvl),
          setEveryN: (n) => (this.DEBUG_EVERY_N_FRAMES = n),
          enable: (v=true) => (this.DEBUG = v),
        };
      }
    } catch {}
  }
  _d(level, ...args) { if (this.DEBUG && this.DEBUG_LEVEL >= level) console.debug(...args); }
  _w(...args) { console.warn(...args); }
  _gStart(label) { if (this.DEBUG && this.DEBUG_LEVEL >= 2) console.groupCollapsed(label); }
  _gEnd() { if (this.DEBUG && this.DEBUG_LEVEL >= 2) console.groupEnd(); }
  _timeStart(label) { if (this.DEBUG && this.DEBUG_LEVEL >= 2) console.time(label); }
  _timeEnd(label) { if (this.DEBUG && this.DEBUG_LEVEL >= 2) console.timeEnd(label); }

  dumpMaterials() {
    const out = [];
    for (const [key, entry] of this.sharedMaterials) {
      out.push({ key, refCount: entry.refCount ?? 0, materialAlive: !!entry.material });
    }
    this._d(1, "[RenderSystem] dumpMaterials", out);
    return out;
  }
  dumpEntities() {
    const out = [];
    for (const [id, group] of this.entityModels) {
      out.push({ id, hasGroup: !!group, children: group?.children?.length ?? 0, materialKey: this.entityMaterials.get(id) });
    }
    this._d(1, "[RenderSystem] dumpEntities", out);
    return out;
  }
  _assertNonNegativeRefcount(key, entry) {
    if ((entry?.refCount ?? 0) < 0) {
      this._w("[RenderSystem] REFCOUNT NEGATIVE!", key, entry);
    }
  }

  update() {
    if (!this.game.scene || !this.game.camera || !this.game.renderer) return;

    this._frame++;
    const frameLabel = "RenderSystem.update3DModels";
    this._timeStart(frameLabel);
    this.update3DModels();
    this._timeEnd(frameLabel);

    if (this.DEBUG && (this._frame % this.DEBUG_EVERY_N_FRAMES === 0)) {
      this._d(1, `[RenderSystem] frame=${this._frame} entities=${this._stats.lastFrameEntities} models=${this._stats.lastFrameModels} ` +
                 `created(models/materials)=${this._stats.createdModels}/${this._stats.createdMaterials} ` +
                 `removed(models/materials)=${this._stats.removedModels}/${this._stats.disposedMaterials}`);
    }
  }
              
  update3DModels() {
    const CT = this.componentTypes;
    const entities = this.game.getEntitiesWith(CT.POSITION, CT.UNIT_TYPE);
    this._stats.lastFrameEntities = entities.length;

    entities.forEach(entityId => {
      const pos = this.game.getComponent(entityId, CT.POSITION);
      const renderable = this.game.getComponent(entityId, CT.RENDERABLE);
      if (!pos || !renderable) return;

      const velocity = this.game.getComponent(entityId, CT.VELOCITY);
      const facing = this.game.getComponent(entityId, CT.FACING);

      if (!this.entityModels.has(entityId)) {
        this._d(2, "[RenderSystem] creating model for entity", entityId, renderable.objectType, renderable.spawnType);
        this.createModelForEntity(entityId, renderable.objectType, renderable.spawnType);
      }
      const modelGroup = this.entityModels.get(entityId);
      if (!modelGroup) return;

      modelGroup.position.set(pos.x, (pos.y ?? 0), pos.z);
      this.updateEntityFacing(entityId, modelGroup, pos, velocity, facing);

      modelGroup.traverse(obj => {
        if (obj.isSkinnedMesh && obj.skeleton) obj.skeleton.update();
      });
    });

    this.cleanupRemovedEntities(entities);
    this._stats.lastFrameModels = this.entityModels.size;
  }

  cleanupRemovedEntities(currentEntities) {
    const alive = new Set(currentEntities);
    let removed = 0;
    for (const [entityId] of this.entityModels.entries()) {
      if (!alive.has(entityId)) {
        removed++;
        this._d(2, "[RenderSystem] cleanupRemovedEntities -> removing entity", entityId);
        this.removeEntityModel(entityId);
      }
    }
    if (removed && this.DEBUG_LEVEL >= 2) {
      this._d(2, `[RenderSystem] cleaned up ${removed} entities`);
    }
  }
      
  async createModelForEntity(entityId, objectType, spawnType) {
    try {
      const modelGroup = this.game.modelManager.getModel(objectType, spawnType);
      if (!modelGroup) {
        console.error("no model group found", objectType, spawnType);
        return;
      }

      modelGroup.scale.set(
        modelGroup.scale.x * this.modelScale,
        modelGroup.scale.y * this.modelScale,
        modelGroup.scale.z * this.modelScale
      );

      const sharedMaterial = this.getSharedMaterial(entityId, modelGroup);
      this.applyToModel(modelGroup, sharedMaterial);

      this.game.scene.add(modelGroup);
      this.entityModels.set(entityId, modelGroup);
      this._stats.createdModels++;

      if (this.game.animationSystem) {
        await this.game.animationSystem.setupEntityAnimations(entityId, objectType, spawnType, modelGroup);
      }

      const facing = this.game.getComponent(entityId, this.componentTypes.FACING);
      if (facing && facing.angle !== undefined) {
        modelGroup.rotation.y = -facing.angle + Math.PI / 2;
      }

      this._d(2, "[RenderSystem] model created for", entityId, "materialKey=", this.entityMaterials.get(entityId));
    } catch (e) {
      console.error(e);
    }
  }

  updateEntityFacing(entityId, modelGroup, pos, velocity, facing) {
    const aiState = this.game.getComponent(entityId, this.componentTypes.AI_STATE);
    let facingAngle = null;

    if (velocity && (Math.abs(velocity.vx) > this.MIN_MOVEMENT_THRESHOLD || Math.abs(velocity.vz) > this.MIN_MOVEMENT_THRESHOLD)) {
      facingAngle = Math.atan2(velocity.vz, velocity.vx);
    }

    const isAttacking = aiState && (aiState.state === 'attacking' || aiState.state === 'waiting');
    if (facingAngle === null && isAttacking && aiState?.aiBehavior?.currentTarget && pos) {
      const targetPos = this.game.getComponent(aiState.aiBehavior.currentTarget, this.componentTypes.POSITION);
      if (targetPos) {
        const dx = targetPos.x - pos.x;
        const dz = targetPos.z - pos.z;
        if (Math.abs(dx) > this.MIN_MOVEMENT_THRESHOLD || Math.abs(dz) > this.MIN_MOVEMENT_THRESHOLD) {
          facingAngle = Math.atan2(dz, dx);
        }
      }
    }

    if (facingAngle === null && facing?.angle !== undefined) {
      facingAngle = facing.angle;
    }

    if (facingAngle !== null) {
      modelGroup.rotation.y = -facingAngle + Math.PI / 2;
    }
  }

  removeEntityModel(entityId) {
    // decrement material refs first
    this.removeEntity(entityId);

    const modelGroup = this.entityModels.get(entityId);
    if (modelGroup && this.game.scene) {
      this.game.scene.remove(modelGroup);
      modelGroup.traverse(child => {
        if (child.isMesh && child.geometry) child.geometry.dispose();
      });
    }
    if (this.game.animationSystem) {
      this.game.animationSystem.removeEntityAnimations(entityId);
    }
    this.entityModels.delete(entityId);
    this._stats.removedModels++;
    this._d(2, "[RenderSystem] removeEntityModel done", entityId);
  }

  destroy() {
    this._gStart("[RenderSystem] destroy()");
    for (const [entityId] of this.entityModels.entries()) {
      this.removeEntityModel(entityId);
    }
    this.entityModels.clear();

    let leaked = 0;
    for (const [key, entry] of this.sharedMaterials.entries()) {
      leaked++;
      entry?.material?.dispose?.();
      this._d(2, "[RenderSystem] disposing leftover shared material", key);
    }
    if (leaked) this._stats.disposedMaterials += leaked;
    this.sharedMaterials.clear();
    this._gEnd();

    if (this.DEBUG) {
      const mats = this.dumpMaterials();
      if (mats.length) this._w("[RenderSystem] WARNING: materials remained after destroy()", mats);
      this._d(1, "[RenderSystem] destroy() complete. stats =", JSON.stringify(this._stats));
    }
  }

  // ======== Shared Material Management ========

  getSharedMaterial(entityId, referenceModel) {
    const materialKey = this.getMaterialKey(entityId);

    if (!this.sharedMaterials.has(materialKey)) {
      const mat = this.createSharedMaterial(referenceModel);
      if (!mat) return null;
      this.sharedMaterials.set(materialKey, { material: mat, refCount: 0 });
      this._stats.createdMaterials++;
      this._d(2, "[RenderSystem] createSharedMaterial", materialKey);
    }

    const entry = this.sharedMaterials.get(materialKey);
    entry.refCount++;
    this._assertNonNegativeRefcount(materialKey, entry);
    this.entityMaterials.set(entityId, materialKey);
    if (this.DEBUG_LEVEL >= 3) this._d(3, "[RenderSystem] ++ref", materialKey, "=>", entry.refCount);
    return entry.material;
  }

  getMaterialKey(entityId) {
    const renderable = this.game.getComponent(entityId, this.componentTypes.RENDERABLE);
    return `${renderable.objectType}_${renderable.spawnType}`;
  }

  createSharedMaterial(referenceModel) {
    let baseMaterial = null;
    referenceModel.traverse(child => {
      if (child.isMesh && child.material && !baseMaterial) {
        baseMaterial = child.material;
      }
    });
    if (!baseMaterial) return null;
    return baseMaterial;
  }

  // Apply one shared material instance to all meshes.
  // Preserve each mesh's *own* texture by reattaching it in onBeforeRender.
  applyToModel(modelGroup, sharedMaterial) {
    if (!sharedMaterial) return;
    modelGroup.traverse(child => {
      if (!child.isMesh || !child.material) return;

      if (!child.userData.originalMap) {
        child.userData.originalMap = child.material.map || null;
      }

      child.material = sharedMaterial;

      child.onBeforeRender = () => {
        if (child.material.map !== child.userData.originalMap) {
          child.material.map = child.userData.originalMap;
          child.material.needsUpdate = true;
          if (this.DEBUG_LEVEL >= 3) this._d(3, "[RenderSystem] reattach map onBeforeRender");
        }
      };
    });
  }

  // Decrement refcount and free shared materials when unused
  removeEntity(entityId) {
    const materialKey = this.entityMaterials.get(entityId);
    if (materialKey && this.sharedMaterials.has(materialKey)) {
      const entry = this.sharedMaterials.get(materialKey);
      entry.refCount = Math.max(0, (entry.refCount || 1) - 1);
      this._assertNonNegativeRefcount(materialKey, entry);
      if (this.DEBUG_LEVEL >= 3) this._d(3, "[RenderSystem] --ref", materialKey, "=>", entry.refCount);
      if (entry.refCount === 0 && entry.material) {
        entry.material.dispose();
        this.sharedMaterials.delete(materialKey);
        this._stats.disposedMaterials++;
        this._d(2, "[RenderSystem] disposed shared material", materialKey);
      }
    }
    this.entityMaterials.delete(entityId);
  }
}
