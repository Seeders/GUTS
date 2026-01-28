class HealthBarSystem extends GUTS.BaseSystem {
    static serviceDependencies = [
        'getCamera',
        'getUnitTypeDef',
        'isVisibleAt',
        'getWorldScene'
    ];

    constructor(game) {
        super(game);
        this.game.healthBarSystem = this;
        
        // Health bar configuration
        this.HEALTH_BAR_WIDTH = 32;
        this.HEALTH_BAR_HEIGHT = 4;
        this.HEALTH_BAR_OFFSET_Y = 50; // Units above unit
        this.BACKGROUND_DEPTH = 2; // Slight offset to prevent z-fighting
        
        // Track health bar meshes
        this.healthBars = new Map(); // entityId -> { background, fill, group, lastHealth }

        // Reusable set for cleanup to avoid per-frame allocation
        this._currentEntitySet = new Set();

        // Initialize only after world system is ready
        this.initialized = false;
    }
    
    initialize() {
        if (this.initialized || !this.call.getWorldScene()) return;

        this.initialized = true;
    }
    
    update() {
        // Wait for scene to be available from WorldSystem
        if (!this.call.getWorldScene() || !this.call.getCamera()) {
            return;
        }
        
        // Initialize if not done yet
        if (!this.initialized) {
            this.initialize();
        }
        
        // Get all entities with health and transform
        const healthEntities = this.game.getEntitiesWith(
            "transform",
            "health",
            "unitType"
        );

        // Update existing health bars and create new ones
        healthEntities.forEach(entityId => {
            const transform = this.game.getComponent(entityId, "transform");
            const pos    = transform?.position;
            const health = this.game.getComponent(entityId, "health");
            const team   = this.game.getComponent(entityId, "team");
            if (!pos || !health) return;

            // === Selection filter: only show health bars for selected units ===
            const isSelected = this.game.selectedUnitSystem?.selectedUnitIds?.has(entityId);

            if (!isSelected) {
                const hb = this.healthBars.get(entityId);
                if (hb) hb.group.visible = false;
                return;
            }

            // === Fog-of-war visibility filter (enemies only) ===
            const isEnemy = this.isEnemy(team);
            const isVisible = !isEnemy || this.isVisibleAt(pos);

            // If enemy not visible: hide existing bar (if any) and skip work
            if (!isVisible) {
                const hb = this.healthBars.get(entityId);
                if (hb) hb.group.visible = false;
                return;
            }
            // Coming back into vision: unhide if we already have one
            const existing = this.healthBars.get(entityId);
            if (existing) existing.group.visible = true;
            // === end FOW filter ===

            // Create health bar if it doesn't exist
            if (!existing) {
                this.createHealthBarMesh(entityId, team);
            }

            // Update health bar
            this.updateHealthBarMesh(entityId, pos, health, team);
        });
        
        // Clean up health bars for destroyed entities
        this.cleanupRemovedHealthBars(healthEntities);
    }
    
    createHealthBarMesh(entityId, team) {
        // Create group to hold both background and fill
        const group = new THREE.Group();
        
        // Create background quad (dark background)
        const backgroundGeometry = new THREE.PlaneGeometry(this.HEALTH_BAR_WIDTH, this.HEALTH_BAR_HEIGHT);
        const backgroundMaterial = new THREE.MeshBasicMaterial({
            color: 0x222222
        });
        const background = new THREE.Mesh(backgroundGeometry, backgroundMaterial);
        background.position.z = -this.BACKGROUND_DEPTH; // Slightly behind
        
        // Create health fill quad
        const fillGeometry = new THREE.PlaneGeometry(this.HEALTH_BAR_WIDTH, this.HEALTH_BAR_HEIGHT);
        const fillMaterial = new THREE.MeshBasicMaterial({
            color: this.getHealthColor(team)
        });
        const fill = new THREE.Mesh(fillGeometry, fillMaterial);
        
        // Add both to group
        group.add(background);
        group.add(fill);
        
        // Add to scene
        this.call.getWorldScene().add(group);
        
        // Store references
        this.healthBars.set(entityId, {
            background: background,
            fill: fill,
            group: group,
            fillGeometry: fillGeometry,
            fillMaterial: fillMaterial,
            lastHealth: -1, // Force initial update
            lastHealthPercent: -1,
            lastMaxHealth: -1, // Track max health changes for notch updates
            notches: [] // Array to hold notch meshes
        });
        
        // Set high render order to ensure health bars render on top of everything
        background.renderOrder = 9999;
        fill.renderOrder = 10000;
    }
    
    updateHealthBarMesh(entityId, pos, health, team) {
        const healthBarData = this.healthBars.get(entityId);
        if (!healthBarData) return;
        
        const { background, fill, group, fillGeometry, fillMaterial } = healthBarData;
        

        // Position group above unit
        const unitTypeComp = this.game.getComponent(entityId, "unitType");
        const unitData = this.call.getUnitTypeDef( unitTypeComp);

        const baseY   = pos.y || 0;
        const heightY = (unitData && unitData.height != null)
            ? unitData.height
            : this.HEALTH_BAR_OFFSET_Y;

        group.position.set(pos.x, baseY + heightY, pos.z);

        
        // Make health bar always face camera (billboard effect)
        const cameraPosition = this.call.getCamera().position;
        group.lookAt(cameraPosition.x, cameraPosition.y, cameraPosition.z);
        
        // Calculate health percentage
        const currentHealthPercent = Math.max(0, Math.min(100, (health.current / health.max) * 100));

        // Only update if health changed
        if (healthBarData.lastHealthPercent !== currentHealthPercent) {
            // Update fill width by scaling
            const healthRatio = currentHealthPercent / 100;
            fill.scale.x = healthRatio;

            // Adjust position to keep fill left-aligned
            fill.position.x = -(this.HEALTH_BAR_WIDTH * (1 - healthRatio)) / 2;

            // Update color based on health percentage
            fillMaterial.color.setHex(this.getHealthColorByPercent(currentHealthPercent, team));

            healthBarData.lastHealthPercent = currentHealthPercent;
        }
        
        // Hide health bar if unit is at full health (optional)
        if (this.shouldHideFullHealthBars() && health.current >= health.max) {
            group.visible = false;
        } else {
            group.visible = true;
        }
        
        // Update notches based on max health
        this.updateHealthBarNotches(entityId, health.max);
    }
    
    getHealthColor(team) {
        // All teams use green - color changes based on health percent instead
        return 0x00ff00;
    }
    
    getHealthColorByPercent(percent, team) {
        // All units start with green, then transition based on health
        if (percent > 75) {
            return 0x00ff00; // Green
        } else if (percent > 50) {
            return 0x88ff00; // Yellow-green
        } else if (percent > 25) {
            return 0xffff00; // Yellow
        } else if (percent > 10) {
            return 0xff8800; // Orange
        } else {
            return 0xff0000; // Red for critical health
        }
    }
    
    updateHealthBarNotches(entityId, maxHealth) {
        const healthBarData = this.healthBars.get(entityId);
        if (!healthBarData) return;

        // Only update notches if max health changed
        if (healthBarData.lastMaxHealth === maxHealth) return;

        // Remove existing notches
        healthBarData.notches.forEach(notch => {
            healthBarData.group.remove(notch);
            notch.geometry.dispose();
            notch.material.dispose();
        });
        healthBarData.notches = [];

        // Calculate how many 100 HP marks we need
        const numNotches = Math.floor(maxHealth / 100);

        if (numNotches >= 1) { // Create notches for any unit with 100+ HP
            const notchWidth = 1; // Make notches wider so they're more visible
            const notchHeight = this.HEALTH_BAR_HEIGHT; // Make them shorter

            for (let i = 1; i <= numNotches; i++) { // i represents the HP value (100, 200, 300, etc.)
                const hpValue = i * 100; // 100, 200, 300, etc.

                // Calculate position as percentage of max health
                const positionPercent = hpValue / maxHealth; // 100/140 = 0.714 for your archer

                // Convert to X offset (-50% to +50% of bar width)
                const xOffset = (positionPercent - 0.5) * this.HEALTH_BAR_WIDTH;


                // Create notch geometry
                const notchGeometry = new THREE.PlaneGeometry(notchWidth, notchHeight);
                const notchMaterial = new THREE.MeshBasicMaterial({
                    color: 0x000000, // White notch lines for better visibility
                    transparent: false
                });

                const notch = new THREE.Mesh(notchGeometry, notchMaterial);
                notch.position.set(xOffset, -this.HEALTH_BAR_HEIGHT * 0.5 + notchHeight * 0.5, 0.2); // Further in front
                notch.renderOrder = 10001; // Above fill

                healthBarData.group.add(notch);
                healthBarData.notches.push(notch);

            }
        }

        healthBarData.lastMaxHealth = maxHealth;
    }
    
    shouldHideFullHealthBars() {
        // You can make this configurable
        return false; // Set to true to hide health bars when units are at full health
    }
    
    cleanupRemovedHealthBars(currentEntities) {
        // Reuse set instead of creating new one each call
        this._currentEntitySet.clear();
        for (const id of currentEntities) {
            this._currentEntitySet.add(id);
        }

        for (const [entityId] of this.healthBars.entries()) {
            if (!this._currentEntitySet.has(entityId)) {
                this.removeHealthBarMesh(entityId);
            }
        }
    }
    
    removeHealthBarMesh(entityId) {
        const healthBarData = this.healthBars.get(entityId);
        if (healthBarData) {
            // Remove group from scene
            const scene = this.call.getWorldScene();
            if (scene) {
                scene.remove(healthBarData.group);
            }
            
            // Dispose of main geometries and materials
            healthBarData.background.geometry.dispose();
            healthBarData.background.material.dispose();
            healthBarData.fill.geometry.dispose();
            healthBarData.fill.material.dispose();
            
            // Dispose of notches
            healthBarData.notches.forEach(notch => {
                notch.geometry.dispose();
                notch.material.dispose();
            });
            
            // Remove from map
            this.healthBars.delete(entityId);
        }
    }
    
    // Utility methods for configuration
    setHealthBarScale(scale = 1.0) {
        this.healthBars.forEach(healthBarData => {
            const newWidth = this.HEALTH_BAR_WIDTH * scale;
            const newHeight = this.HEALTH_BAR_HEIGHT * scale;

            // Update background geometry
            healthBarData.background.geometry.dispose();
            healthBarData.background.geometry = new THREE.PlaneGeometry(newWidth, newHeight);

            // Update fill geometry
            healthBarData.fillGeometry.dispose();
            healthBarData.fillGeometry = new THREE.PlaneGeometry(newWidth, newHeight);
            healthBarData.fill.geometry = healthBarData.fillGeometry;

            // Force position update
            healthBarData.lastHealthPercent = -1;
        });
    }
    isEnemy(teamComp) {
        const myTeam = this.game?.state?.myTeam;
        if (myTeam == null || !teamComp) return false;
        return teamComp.team !== myTeam;
    }

    isVisibleAt(pos) {
        return this.call.isVisibleAt( pos.x, pos.z);
    }

    toggleHealthBars(visible = true) {
        this.healthBars.forEach(healthBarData => {
            healthBarData.group.visible = visible;
        });
    }
    
    setHealthBarOffset(offsetY) {
        this.HEALTH_BAR_OFFSET_Y = offsetY;
        // Positions will be updated on next frame
    }
    
    // Update all health bar colors (useful for team color changes)
    updateAllHealthBarColors() {
        this.healthBars.forEach((healthBarData, entityId) => {
            // Force color update
            healthBarData.lastHealthPercent = -1;
        });
    }
    
    // Set render order to ensure health bars appear on top
    setRenderOrder(order = 1000) {
        this.healthBars.forEach(healthBarData => {
            healthBarData.background.renderOrder = order;
            healthBarData.fill.renderOrder = order + 1;
        });
    }
    
    destroy() {
        // Clean up all health bar meshes
        for (const [entityId] of this.healthBars.entries()) {
            this.removeHealthBarMesh(entityId);
        }

        this.healthBars.clear();
        this.initialized = false;
    }

    onSceneUnload() {
        this.destroy();
    }
}
