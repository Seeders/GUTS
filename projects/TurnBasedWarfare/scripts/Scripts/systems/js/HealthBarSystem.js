class HealthBarSystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.healthBarSystem = this;
        this.componentTypes = this.game.componentManager.getComponentTypes();
        
        // Health bar configuration
        this.HEALTH_BAR_WIDTH = 32;
        this.HEALTH_BAR_HEIGHT = 4;
        this.HEALTH_BAR_OFFSET_Y = 50; // Units above unit
        this.HEALTH_BAR_BORDER = 1;
        
        // Track health bar sprites
        this.healthBarSprites = new Map(); // entityId -> { sprite, canvas, context, lastHealth }
        
        // Canvas size for health bar texture
        this.CANVAS_WIDTH = 64;
        this.CANVAS_HEIGHT = 16;
        
        // Initialize only after world system is ready
        this.initialized = false;
    }
    
    initialize() {
        if (this.initialized || !this.game.scene) return;
        
        this.initialized = true;
        console.log('Three.js HealthBarSystem initialized');
    }
    
    update(deltaTime) {
        // Wait for scene to be available
        if (!this.game.scene || !this.game.camera) {
            return;
        }
        
        // Initialize if not done yet
        if (!this.initialized) {
            this.initialize();
        }
        
        // Get all entities with health and position
        const healthEntities = this.game.getEntitiesWith(
            this.componentTypes.POSITION,
            this.componentTypes.HEALTH,
            this.componentTypes.UNIT_TYPE
        );
        
        // Update existing health bars and create new ones
        healthEntities.forEach(entityId => {
            const pos = this.game.getComponent(entityId, this.componentTypes.POSITION);
            const health = this.game.getComponent(entityId, this.componentTypes.HEALTH);
            const team = this.game.getComponent(entityId, this.componentTypes.TEAM);
            
            if (!pos || !health) return;
            
            // Create health bar if it doesn't exist
            if (!this.healthBarSprites.has(entityId)) {
                this.createHealthBarSprite(entityId, team);
            }
            
            // Update health bar
            this.updateHealthBarSprite(entityId, pos, health, team);
        });
        
        // Clean up health bars for destroyed entities
        this.cleanupRemovedHealthBars(healthEntities);
    }
    
    createHealthBarSprite(entityId, team) {
        // Create canvas for health bar texture
        const canvas = document.createElement('canvas');
        canvas.width = this.CANVAS_WIDTH;
        canvas.height = this.CANVAS_HEIGHT;
        const context = canvas.getContext('2d');
        
        // Create texture from canvas
        const texture = new THREE.CanvasTexture(canvas);
        texture.minFilter = THREE.NearestFilter;
        texture.magFilter = THREE.NearestFilter;
        
        // Create sprite material
        const material = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            alphaTest: 0.1
        });
        
        // Create sprite
        const sprite = new THREE.Sprite(material);
        sprite.scale.set(this.HEALTH_BAR_WIDTH, this.HEALTH_BAR_HEIGHT, 1);
        
        // Add to scene
        this.game.scene.add(sprite);
        
        // Store references
        this.healthBarSprites.set(entityId, {
            sprite: sprite,
            canvas: canvas,
            context: context,
            texture: texture,
            material: material,
            lastHealth: -1 // Force initial update
        });
        
    }
    
    updateHealthBarSprite(entityId, pos, health, team) {
        const healthBarData = this.healthBarSprites.get(entityId);
        if (!healthBarData) return;
        
        const { sprite, canvas, context, texture } = healthBarData;
        
        // Position sprite above unit
        sprite.position.set(
            pos.x,
            pos.y + this.HEALTH_BAR_OFFSET_Y,
            pos.z
        );
        
        // Only redraw canvas if health changed
        const currentHealthPercent = Math.max(0, Math.min(100, (health.current / health.max) * 100));
        if (healthBarData.lastHealth !== currentHealthPercent) {
            this.drawHealthBar(context, canvas, currentHealthPercent, team);
            texture.needsUpdate = true;
            healthBarData.lastHealth = currentHealthPercent;
        }
        
        // Hide health bar if unit is at full health (optional)
        if (this.shouldHideFullHealthBars() && health.current >= health.max) {
            sprite.material.opacity = 0.3;
        } else {
            sprite.material.opacity = 1.0;
        }
        
        // Add damage flash effect if unit was recently hit
        const animation = this.game.getComponent(entityId, this.componentTypes.ANIMATION);
        if (animation && animation.flash > 0) {
            // Add red tint for damage flash
            sprite.material.color.setHex(0xff8888);
        } else {
            sprite.material.color.setHex(0xffffff);
        }
    }
    
    drawHealthBar(context, canvas, healthPercent, team) {
        const width = canvas.width;
        const height = canvas.height;
        
        // Clear canvas
        context.clearRect(0, 0, width, height);
        
        // Calculate dimensions
        const barWidth = width - (this.HEALTH_BAR_BORDER * 2);
        const barHeight = height - (this.HEALTH_BAR_BORDER * 2);
        const fillWidth = (barWidth * healthPercent) / 100;
        
        // Draw background (dark)
        context.fillStyle = '#222222';
        context.fillRect(0, 0, width, height);
        
        // Draw border
        context.strokeStyle = '#000000';
        context.lineWidth = this.HEALTH_BAR_BORDER;
        context.strokeRect(
            this.HEALTH_BAR_BORDER / 2, 
            this.HEALTH_BAR_BORDER / 2, 
            width - this.HEALTH_BAR_BORDER, 
            height - this.HEALTH_BAR_BORDER
        );
        
        // Draw health fill
        if (fillWidth > 0) {
            context.fillStyle = this.getHealthColorByPercent(healthPercent, team);
            context.fillRect(
                this.HEALTH_BAR_BORDER,
                this.HEALTH_BAR_BORDER,
                fillWidth,
                barHeight
            );
        }
        
        // Optional: Draw health text
        if (this.shouldShowHealthText()) {
            context.fillStyle = '#ffffff';
            context.font = '8px monospace';
            context.textAlign = 'center';
            context.textBaseline = 'middle';
            context.fillText(
                `${Math.ceil(healthPercent)}%`,
                width / 2,
                height / 2
            );
        }
    }
    
    getHealthColor(team) {
        const teamColors = {
            'player': '#00ff00',  // Green for player
            'enemy': '#00ff00',   // Red for enemy
            'neutral': '#00ff00'  // Yellow for neutral
        };
        return teamColors[team?.team] || teamColors.neutral;
    }
    
    getHealthColorByPercent(percent, team) {
        const baseColor = this.getHealthColor(team);
        
        // Modify color based on health percentage
        if (percent > 75) {
            return baseColor; // Full color
        } else if (percent > 50) {
            return team?.team === 'player' ? '#88ff00' : '#ff6644'; // Slightly dimmed
        } else if (percent > 25) {
            return team?.team === 'player' ? '#ffff00' : '#ff8844'; // Yellow/Orange
        } else {
            return '#ff0000'; // Red for critical health
        }
    }
    
    shouldHideFullHealthBars() {
        // You can make this configurable
        return false; // Set to true to hide health bars when units are at full health
    }
    
    shouldShowHealthText() {
        // You can make this configurable or add a toggle
        return false; // Set to true to show percentage text on health bars
    }
    
    cleanupRemovedHealthBars(currentEntities) {
        const currentEntitySet = new Set(currentEntities);
        
        for (const [entityId] of this.healthBarSprites.entries()) {
            if (!currentEntitySet.has(entityId)) {
                this.removeHealthBarSprite(entityId);
            }
        }
    }
    
    removeHealthBarSprite(entityId) {
        const healthBarData = this.healthBarSprites.get(entityId);
        if (healthBarData) {
            // Remove sprite from scene
            if (this.game.scene) {
                this.game.scene.remove(healthBarData.sprite);
            }
            
            // Dispose of resources
            healthBarData.texture.dispose();
            healthBarData.material.dispose();
            
            // Remove from map
            this.healthBarSprites.delete(entityId);
            
        }
    }
    
    // Utility methods for configuration
    setHealthBarScale(scale = 1.0) {
        this.healthBarSprites.forEach(healthBarData => {
            healthBarData.sprite.scale.set(
                this.HEALTH_BAR_WIDTH * scale,
                this.HEALTH_BAR_HEIGHT * scale,
                1
            );
        });
    }
    
    toggleHealthBars(visible = true) {
        this.healthBarSprites.forEach(healthBarData => {
            healthBarData.sprite.visible = visible;
        });
    }
    
    setHealthBarOffset(offsetY) {
        this.HEALTH_BAR_OFFSET_Y = offsetY;
        // Positions will be updated on next frame
    }
    
    // Show/hide health text on all bars
    toggleHealthText(show = true) {
        this.healthBarSprites.forEach((healthBarData, entityId) => {
            // Force redraw to include/exclude text
            healthBarData.lastHealth = -1;
        });
    }
    
    destroy() {
        // Clean up all health bar sprites
        for (const [entityId] of this.healthBarSprites.entries()) {
            this.removeHealthBarSprite(entityId);
        }
        
        this.healthBarSprites.clear();
        this.initialized = false;
        
        console.log('Three.js HealthBarSystem destroyed');
    }
}