class PlacementPreview {
    constructor(scene, gridSystem, squadManager) {
        this.scene = scene;
        this.gridSystem = gridSystem;
        this.squadManager = squadManager;
        
        // Preview state
        this.isActive = false;
        this.gridPosition = null;
        this.unitType = null;
        this.cells = [];
        this.isValid = false;
        this.team = null;
        
        // Three.js objects - reuse instead of recreating
        this.previewGroup = new THREE.Group();
        this.previewGroup.name = 'PlacementPreview';
        this.previewGroup.visible = false;
        this.scene.add(this.previewGroup);
        
        
        // Visual configuration
        this.config = {
            cellOpacity: 0.4,
            borderOpacity: 0.8,
            unitIndicatorRadius: 3,
            unitIndicatorSegments: 8,
            elevationOffset: 20,
            unitElevationOffset: 20,
            indicatorElevationOffset: 15,
            cellSizeMultiplier: 0.9,
            maxCells: 25, // Limit complexity
            updateThrottle: 16 // ~60fps throttling
        };
        
        // Geometry pools for reuse
        this.geometryPool = this.createGeometryPool();
        // Materials (created once for performance)
        this.materials = this.createMaterials();
        
        // Object pools for reuse
        this.cellMeshPool = [];
        this.borderMeshPool = [];
        this.unitMeshPool = [];
        this.activeMeshes = [];
        
        // Animation state
        this.animationId = null;
        this.lastUpdateTime = 0;
        
        // Initialize object pools
        this.initializeObjectPools();
    }
    
    /**
     * Create geometry pool for reuse
     */
    createGeometryPool() {
        const cellSize = this.gridSystem.dimensions.cellSize * this.config.cellSizeMultiplier;
        
        return {
            cellPlane: new THREE.PlaneGeometry(cellSize, cellSize),
            unitCircle: new THREE.CircleGeometry(
                this.config.unitIndicatorRadius, 
                this.config.unitIndicatorSegments
            ),
            unitPillar: new THREE.CylinderGeometry(1, 1, 2, 6),
            indicatorCone: new THREE.ConeGeometry(5, 10, 4),
            indicatorRing: new THREE.RingGeometry(6, 8, 8)
        };
    }
    
    /**
     * Create reusable materials
     */
    createMaterials() {
        return {
            validCell: new THREE.MeshBasicMaterial({
                color: 0x00ff00,
                transparent: true,
                opacity: this.config.cellOpacity,
                side: THREE.DoubleSide
            }),
            invalidCell: new THREE.MeshBasicMaterial({
                color: 0xff0000,
                transparent: true,
                opacity: this.config.cellOpacity,
                side: THREE.DoubleSide
            }),
            validBorder: new THREE.LineBasicMaterial({
                color: 0x00ff00,
                transparent: true,
                opacity: this.config.borderOpacity
            }),
            invalidBorder: new THREE.LineBasicMaterial({
                color: 0xff0000,
                transparent: true,
                opacity: this.config.borderOpacity
            }),
            validUnit: new THREE.MeshBasicMaterial({
                color: 0x00aa00,
                transparent: true,
                opacity: 0.6
            }),
            invalidUnit: new THREE.MeshBasicMaterial({
                color: 0xaa0000,
                transparent: true,
                opacity: 0.6
            }),
            validIndicator: new THREE.MeshBasicMaterial({
                color: 0x00ff00,
                transparent: true,
                opacity: 0.8
            }),
            invalidIndicator: new THREE.MeshBasicMaterial({
                color: 0xff0000,
                transparent: true,
                opacity: 0.8
            })
        };
    }
    
    /**
     * Initialize object pools for mesh reuse
     */
    initializeObjectPools() {
        const maxObjects = this.config.maxCells;
        
        // Pre-create cell meshes
        for (let i = 0; i < maxObjects; i++) {
            const cellMesh = new THREE.Mesh(this.geometryPool.cellPlane, this.materials.validCell);
            cellMesh.rotation.x = -Math.PI / 2;
            cellMesh.visible = false;
            this.cellMeshPool.push(cellMesh);
            this.previewGroup.add(cellMesh);
            
            const borderGeometry = new THREE.EdgesGeometry(this.geometryPool.cellPlane);
            const borderMesh = new THREE.LineSegments(borderGeometry, this.materials.validBorder);
            borderMesh.rotation.x = -Math.PI / 2;
            borderMesh.visible = false;
            this.borderMeshPool.push(borderMesh);
            this.previewGroup.add(borderMesh);
            
            const unitMesh = new THREE.Mesh(this.geometryPool.unitCircle, this.materials.validUnit);
            unitMesh.rotation.x = -Math.PI / 2;
            unitMesh.visible = false;
            this.unitMeshPool.push(unitMesh);
            this.previewGroup.add(unitMesh);
        }
    }
    
    /**
     * Update preview with throttling to prevent excessive updates
     */
    update(gridPos, unitType, team) {
        const now = performance.now();
        
        // Throttle updates
        if (now - this.lastUpdateTime < this.config.updateThrottle) {
            return;
        }
        this.lastUpdateTime = now;
        
        // Clear preview if invalid input
        if (!gridPos || !unitType || !this.gridSystem.isValidPosition(gridPos)) {
            this.hide();
            return;
        }
        
        const squadData = this.squadManager.getSquadData(unitType);
        const cells = this.squadManager.getSquadCells(gridPos, squadData);
        const isValid = this.gridSystem.isValidPlacement(cells, team);
        
        // Only update if something significant changed
        const hasChanged = !this.isActive ||
                          this.gridPosition?.x !== gridPos.x ||
                          this.gridPosition?.z !== gridPos.z ||
                          this.isValid !== isValid ||
                          this.unitType?.id !== unitType.id ||
                          this.team !== team;
        
        if (hasChanged) {
            this.isActive = true;
            this.gridPosition = { ...gridPos };
            this.unitType = unitType;
            this.cells = cells.slice(0, this.config.maxCells); // Limit cell count
            this.isValid = isValid;
            this.team = team;
            
            this.show();
        }
    }
    
    /**
     * Show preview using object pools
     */
    show() {
        if (!this.isActive) return;
        
        // Hide all meshes first
        this.hideAllMeshes();
        
        const cellMaterial = this.isValid ? this.materials.validCell : this.materials.invalidCell;
        const borderMaterial = this.isValid ? this.materials.validBorder : this.materials.invalidBorder;
        
        // Update cell previews using pooled objects
        this.cells.forEach((cell, index) => {
            if (index >= this.cellMeshPool.length) return; // Safety check
            
            const worldPos = this.gridSystem.gridToWorld(cell.x, cell.z);
            
            // Reuse cell mesh
            const cellMesh = this.cellMeshPool[index];
            cellMesh.material = cellMaterial;
            cellMesh.position.set(worldPos.x, this.config.elevationOffset, worldPos.z);
            cellMesh.visible = true;
            this.activeMeshes.push(cellMesh);
            
            // Reuse border mesh
            const borderMesh = this.borderMeshPool[index];
            borderMesh.material = borderMaterial;
            borderMesh.position.set(worldPos.x, this.config.elevationOffset, worldPos.z);
            borderMesh.visible = true;
            this.activeMeshes.push(borderMesh);
        });
        
        // Add formation preview for multi-unit squads
        const squadData = this.squadManager.getSquadData(this.unitType);
        if (this.squadManager.getSquadSize(squadData) > 1) {
            this.addFormationPreview();
        }
        
        this.previewGroup.visible = true;
        
        // Start subtle animation
        this.startAnimation();
    }
    
    /**
     * Add formation preview using pooled unit meshes
     */
    addFormationPreview() {
        if (!this.gridPosition) return;
        
        const unitPositions = this.squadManager.calculateUnitPositions(
            this.gridPosition, 
            this.unitType
        );
        
        const unitMaterial = this.isValid ? this.materials.validUnit : this.materials.invalidUnit;
        
        unitPositions.forEach((pos, index) => {
            if (index >= this.unitMeshPool.length) return; // Safety check
            
            const unitMesh = this.unitMeshPool[index];
            unitMesh.material = unitMaterial;
            unitMesh.position.set(pos.x, this.config.unitElevationOffset, pos.z);
            unitMesh.visible = true;
            this.activeMeshes.push(unitMesh);
        });
    }
    
    /**
     * Hide all pooled meshes
     */
    hideAllMeshes() {
        this.activeMeshes.length = 0; // Clear active mesh tracking
        
        [...this.cellMeshPool, ...this.borderMeshPool, ...this.unitMeshPool].forEach(mesh => {
            mesh.visible = false;
        });
    }
    
    /**
     * Start lightweight animation
     */
    startAnimation() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
        }
        
        const startTime = performance.now();
        const animate = () => {
            if (!this.previewGroup.visible) {
                this.animationId = null;
                return;
            }
            
            const elapsed = (performance.now() - startTime) / 1000;
            
            // Subtle pulsing effect on active meshes only
            const scale = 1 + Math.sin(elapsed * 2) * 0.05;
            this.activeMeshes.forEach(mesh => {
                if (mesh.visible) {
                    mesh.scale.setScalar(scale);
                }
            });
            
            this.animationId = requestAnimationFrame(animate);
        };
        
        this.animationId = requestAnimationFrame(animate);
    }
    
    /**
     * Hide preview without clearing data
     */
    hide() {
        this.previewGroup.visible = false;
        this.hideAllMeshes();
        
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }
    
    /**
     * Clear the placement preview completely
     */
    clear(clearData = true) {
        this.hide();
        
        if (clearData) {
            this.isActive = false;
            this.gridPosition = null;
            this.unitType = null;
            this.cells = [];
            this.isValid = false;
            this.team = null;
        }
    }
    
    /**
     * Get current preview state information
     */
    getPreviewInfo() {
        if (!this.isActive) {
            return { active: false };
        }
        
        const squadData = this.squadManager.getSquadData(this.unitType);
        const squadInfo = this.squadManager.getSquadInfo(this.unitType);
        
        return {
            active: true,
            isValid: this.isValid,
            gridPosition: this.gridPosition,
            unitType: this.unitType.title || this.unitType.id,
            team: this.team,
            squadSize: squadInfo.squadSize,
            formationType: squadInfo.formationType,
            cellCount: this.cells.length,
            cost: this.unitType.value || 0,
            totalValue: squadInfo.totalValue,
            canPlace: this.isValid && this.isActive
        };
    }
    
    /**
     * Update preview configuration
     */
    updateConfig(newConfig) {
        Object.assign(this.config, newConfig);
        
        // Update material opacities if changed
        if (newConfig.cellOpacity !== undefined) {
            this.materials.validCell.opacity = newConfig.cellOpacity;
            this.materials.invalidCell.opacity = newConfig.cellOpacity;
        }
        
        if (newConfig.borderOpacity !== undefined) {
            this.materials.validBorder.opacity = newConfig.borderOpacity;
            this.materials.invalidBorder.opacity = newConfig.borderOpacity;
        }
    }
    
    /**
     * Check if preview contains world position
     */
    containsWorldPosition(worldX, worldZ) {
        if (!this.isActive) return false;
        
        const gridPos = this.gridSystem.worldToGrid(worldX, worldZ);
        return this.cells.some(cell => cell.x === gridPos.x && cell.z === gridPos.z);
    }
    
    /**
     * Get cell at world position
     */
    getCellAtWorldPosition(worldX, worldZ) {
        if (!this.containsWorldPosition(worldX, worldZ)) return null;
        
        const gridPos = this.gridSystem.worldToGrid(worldX, worldZ);
        return this.cells.find(cell => cell.x === gridPos.x && cell.z === gridPos.z);
    }
    
    /**
     * Cleanup method to dispose of resources
     */
    dispose() {
        this.clear();
        
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
        }
        
        // Remove from scene
        if (this.previewGroup.parent) {
            this.previewGroup.parent.remove(this.previewGroup);
        }
        
        // Dispose geometries
        Object.values(this.geometryPool).forEach(geometry => {
            if (geometry.dispose) {
                geometry.dispose();
            }
        });
        
        // Dispose materials
        Object.values(this.materials).forEach(material => {
            if (material.dispose) {
                material.dispose();
            }
        });
        
        // Clear pools
        this.cellMeshPool = [];
        this.borderMeshPool = [];
        this.unitMeshPool = [];
        this.activeMeshes = [];
    }
}