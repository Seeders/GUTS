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
        
        // Three.js objects
        this.previewMesh = null;
        
        // Visual configuration
        this.config = {
            cellOpacity: 0.4,
            borderOpacity: 0.8,
            unitIndicatorRadius: 3,
            unitIndicatorSegments: 8,
            elevationOffset: 3,
            unitElevationOffset: 4,
            indicatorElevationOffset: 15,
            cellSizeMultiplier: 0.9
        };
        
        // Materials (created once for performance)
        this.materials = this.createMaterials();
    }
    
    /**
     * Create reusable materials for preview elements
     * @returns {Object} Material definitions
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
     * Update preview based on current mouse position and unit selection
     * @param {Object} gridPos - Grid position {x, z}
     * @param {Object} unitType - Selected unit type
     * @param {string} team - Team identifier ('player' or 'enemy')
     */
    update(gridPos, unitType, team) {
        // Clear preview if invalid input
        if (!gridPos || !unitType || !this.gridSystem.isValidPosition(gridPos)) {
            this.clear();
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
            this.cells = cells;
            this.isValid = isValid;
            this.team = team;
            
            this.show();
        }
    }
    
    /**
     * Render the placement preview
     */
    show() {
        this.clear(false); // Clear visual only, keep data
        
        if (!this.isActive) return;
        
        const previewGroup = new THREE.Group();
        previewGroup.name = 'PlacementPreview';
        
        // Add cell previews
        this.addCellPreviews(previewGroup);
        
        // Add formation preview for multi-unit squads
        const squadData = this.squadManager.getSquadData(this.unitType);
        if (this.squadManager.getSquadSize(squadData) > 1) {
            this.addFormationPreview(previewGroup, squadData);
        }
        
        // Add info indicator
        this.addInfoIndicator(previewGroup, squadData);
        
        this.previewMesh = previewGroup;
        this.scene.add(this.previewMesh);
    }
    
    /**
     * Add cell preview meshes to the preview group
     * @param {THREE.Group} previewGroup - Group to add meshes to
     */
    addCellPreviews(previewGroup) {
        const cellMaterial = this.isValid ? this.materials.validCell : this.materials.invalidCell;
        const borderMaterial = this.isValid ? this.materials.validBorder : this.materials.invalidBorder;
        
        this.cells.forEach((cell) => {
            const worldPos = this.gridSystem.gridToWorld(cell.x, cell.z);
            
            // Create cell plane
            const cellSize = this.gridSystem.dimensions.cellSize * this.config.cellSizeMultiplier;
            const geometry = new THREE.PlaneGeometry(cellSize, cellSize);
            const mesh = new THREE.Mesh(geometry, cellMaterial);
            mesh.position.set(worldPos.x, this.config.elevationOffset, worldPos.z);
            mesh.rotation.x = -Math.PI / 2;
            mesh.userData = { type: 'cell', cellPos: cell };
            previewGroup.add(mesh);
            
            // Create cell border
            const borderGeometry = new THREE.EdgesGeometry(geometry);
            const border = new THREE.LineSegments(borderGeometry, borderMaterial);
            border.position.copy(mesh.position);
            border.rotation.copy(mesh.rotation);
            border.userData = { type: 'border', cellPos: cell };
            previewGroup.add(border);
        });
    }
    
    /**
     * Add formation preview showing individual unit positions
     * @param {THREE.Group} previewGroup - Group to add meshes to
     * @param {Object} squadData - Squad configuration
     */
    addFormationPreview(previewGroup, squadData) {
        if (!this.gridPosition) return;
        
        const unitPositions = this.squadManager.calculateUnitPositions(
            this.gridPosition, 
            squadData, 
            this.gridSystem
        );
        
        const unitMaterial = this.isValid ? this.materials.validUnit : this.materials.invalidUnit;
        
        unitPositions.forEach((pos, index) => {
            // Create unit position indicator
            const geometry = new THREE.CircleGeometry(
                this.config.unitIndicatorRadius, 
                this.config.unitIndicatorSegments
            );
            const mesh = new THREE.Mesh(geometry, unitMaterial);
            mesh.position.set(pos.x, this.config.unitElevationOffset, pos.z);
            mesh.rotation.x = -Math.PI / 2;
            mesh.userData = { 
                type: 'unit', 
                unitIndex: index,
                worldPos: pos 
            };
            previewGroup.add(mesh);
            
            // Add small elevation indicator
            const pillarGeometry = new THREE.CylinderGeometry(1, 1, 2, 6);
            const pillarMesh = new THREE.Mesh(pillarGeometry, unitMaterial);
            pillarMesh.position.set(pos.x, this.config.unitElevationOffset + 1, pos.z);
            pillarMesh.userData = { 
                type: 'unitPillar', 
                unitIndex: index 
            };
            previewGroup.add(pillarMesh);
        });
    }
    
    /**
     * Add information indicator showing squad details
     * @param {THREE.Group} previewGroup - Group to add meshes to
     * @param {Object} squadData - Squad configuration
     */
    addInfoIndicator(previewGroup, squadData) {
        const centerPos = this.gridSystem.gridToWorld(this.gridPosition.x, this.gridPosition.z);
        const squadSize = this.squadManager.getSquadSize(squadData);
        
        // Create main indicator cone
        const indicatorGeometry = new THREE.ConeGeometry(5, 10, 4);
        const indicatorMaterial = this.isValid ? this.materials.validIndicator : this.materials.invalidIndicator;
        const indicator = new THREE.Mesh(indicatorGeometry, indicatorMaterial);
        indicator.position.set(centerPos.x, this.config.indicatorElevationOffset, centerPos.z);
        indicator.userData = { 
            type: 'indicator', 
            squadSize: squadSize,
            isValid: this.isValid 
        };
        previewGroup.add(indicator);
        
        // Add floating ring around indicator
        const ringGeometry = new THREE.RingGeometry(6, 8, 8);
        const ringMaterial = new THREE.MeshBasicMaterial({
            color: this.isValid ? 0x00ff00 : 0xff0000,
            transparent: true,
            opacity: 0.3,
            side: THREE.DoubleSide
        });
        const ring = new THREE.Mesh(ringGeometry, ringMaterial);
        ring.position.set(centerPos.x, this.config.indicatorElevationOffset + 5, centerPos.z);
        ring.rotation.x = -Math.PI / 2;
        ring.userData = { type: 'indicatorRing' };
        previewGroup.add(ring);
        
        // Add pulsing animation to the ring
        this.animateIndicator(ring);
    }
    
    /**
     * Add subtle animation to the preview indicator
     * @param {THREE.Mesh} indicator - Indicator mesh to animate
     */
    animateIndicator(indicator) {
        if (!indicator) return;
        
        const startTime = Date.now();
        const animate = () => {
            if (!this.previewMesh || !this.scene.getObjectById(indicator.id)) {
                return; // Stop animation if preview is cleared
            }
            
            const elapsed = (Date.now() - startTime) / 1000;
            const scale = 1 + Math.sin(elapsed * 3) * 0.1;
            indicator.scale.setScalar(scale);
            
            requestAnimationFrame(animate);
        };
        animate();
    }
    
    /**
     * Clear the placement preview
     * @param {boolean} clearData - Whether to clear internal state data
     */
    clear(clearData = true) {
        if (this.previewMesh) {
            // Dispose of geometries and materials to prevent memory leaks
            this.previewMesh.traverse((child) => {
                if (child.geometry) {
                    child.geometry.dispose();
                }
                // Don't dispose materials as they're reused
            });
            
            this.scene.remove(this.previewMesh);
            this.previewMesh = null;
        }
        
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
     * @returns {Object} Preview state data
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
     * @param {Object} newConfig - Configuration updates
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
        
        // Refresh preview if active
        if (this.isActive) {
            this.show();
        }
    }
    
    /**
     * Check if a specific world position is within the current preview
     * @param {number} worldX - World X coordinate
     * @param {number} worldZ - World Z coordinate
     * @returns {boolean} True if position is within preview
     */
    containsWorldPosition(worldX, worldZ) {
        if (!this.isActive) return false;
        
        const gridPos = this.gridSystem.worldToGrid(worldX, worldZ);
        return this.cells.some(cell => cell.x === gridPos.x && cell.z === gridPos.z);
    }
    
    /**
     * Get the cell at a specific world position within the preview
     * @param {number} worldX - World X coordinate
     * @param {number} worldZ - World Z coordinate
     * @returns {Object|null} Cell data or null if not found
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
        
        // Dispose of materials
        Object.values(this.materials).forEach(material => {
            if (material.dispose) {
                material.dispose();
            }
        });
    }
}