class PlacementPreview {
    constructor(game) {
        this.game = game;
        this.game.placementPreview = this;
        
        this.isActive = false;
        
        this.previewGroup = new THREE.Group();
        this.previewGroup.name = 'PlacementPreview';
        this.previewGroup.visible = false;
        this.game.uiScene.add(this.previewGroup);
        
        const configs = game.getCollections().configs.game;
        this.config = {
            cellOpacity: 0.4,
            borderOpacity: 0.8,
            unitIndicatorRadius: 3,
            unitIndicatorSegments: 8,
            elevationOffset: 0,
            unitElevationOffset: -12,
            cellSizeMultiplier: 0.9,
            maxCells: 50,
            updateThrottle: 16,
            placementGridSize: configs.gridSize / 2, // Placement grid is always half the terrain grid
            terrainGridSize: configs.gridSize // Terrain grid size for building footprints
        };

        this.geometryPool = this.createGeometryPool();
        this.materials = this.createMaterials();
        
        this.placementCellMeshPool = [];
        this.placementBorderMeshPool = [];
        this.footprintCellMeshPool = [];
        this.footprintBorderMeshPool = [];
        this.unitMeshPool = [];
        this.activeMeshes = [];

        this.animationId = null;
        this.lastUpdateTime = 0;

        this.initializeObjectPools();
    }
    
    createGeometryPool() {
        const placementCellSize = this.game.gridSystem.dimensions.cellSize * this.config.cellSizeMultiplier;
        const footprintCellSize = this.config.terrainGridSize * this.config.cellSizeMultiplier;

        return {
            placementCellPlane: new THREE.PlaneGeometry(placementCellSize, placementCellSize), // For units
            footprintCellPlane: new THREE.PlaneGeometry(footprintCellSize, footprintCellSize), // For buildings
            unitCircle: new THREE.CircleGeometry(
                this.config.unitIndicatorRadius,
                this.config.unitIndicatorSegments
            )
        };
    }
    
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
            })
        };
    }
    
    initializeObjectPools() {
        const maxObjects = this.config.maxCells;

        for (let i = 0; i < maxObjects; i++) {
            // Placement cell meshes (for units)
            const placementCellMesh = new THREE.Mesh(this.geometryPool.placementCellPlane, this.materials.validCell);
            placementCellMesh.rotation.x = -Math.PI / 2;
            placementCellMesh.visible = false;
            this.placementCellMeshPool.push(placementCellMesh);
            this.previewGroup.add(placementCellMesh);

            const placementBorderGeometry = new THREE.EdgesGeometry(this.geometryPool.placementCellPlane);
            const placementBorderMesh = new THREE.LineSegments(placementBorderGeometry, this.materials.validBorder);
            placementBorderMesh.rotation.x = -Math.PI / 2;
            placementBorderMesh.visible = false;
            this.placementBorderMeshPool.push(placementBorderMesh);
            this.previewGroup.add(placementBorderMesh);

            // Footprint cell meshes (for buildings)
            const footprintCellMesh = new THREE.Mesh(this.geometryPool.footprintCellPlane, this.materials.validCell);
            footprintCellMesh.rotation.x = -Math.PI / 2;
            footprintCellMesh.visible = false;
            this.footprintCellMeshPool.push(footprintCellMesh);
            this.previewGroup.add(footprintCellMesh);

            const footprintBorderGeometry = new THREE.EdgesGeometry(this.geometryPool.footprintCellPlane);
            const footprintBorderMesh = new THREE.LineSegments(footprintBorderGeometry, this.materials.validBorder);
            footprintBorderMesh.rotation.x = -Math.PI / 2;
            footprintBorderMesh.visible = false;
            this.footprintBorderMeshPool.push(footprintBorderMesh);
            this.previewGroup.add(footprintBorderMesh);

            // Unit indicator meshes
            const unitMesh = new THREE.Mesh(this.geometryPool.unitCircle, this.materials.validUnit);
            unitMesh.rotation.x = -Math.PI / 2;
            unitMesh.visible = false;
            this.unitMeshPool.push(unitMesh);
            this.previewGroup.add(unitMesh);
        }
    }
    
    showAtWorldPositions(worldPositions, isValid = true, isBuilding = false) {
        const now = performance.now();
        if (now - this.lastUpdateTime < this.config.updateThrottle) {
            return;
        }
        this.lastUpdateTime = now;

        if (!worldPositions || worldPositions.length === 0) {
            this.hide();
            return;
        }

        this.isActive = true;
        this.hideAllMeshes();

        const cellMaterial = isValid ? this.materials.validCell : this.materials.invalidCell;
        const borderMaterial = isValid ? this.materials.validBorder : this.materials.invalidBorder;

        // Choose appropriate mesh pools based on whether it's a building or unit
        const cellMeshPool = isBuilding ? this.footprintCellMeshPool : this.placementCellMeshPool;
        const borderMeshPool = isBuilding ? this.footprintBorderMeshPool : this.placementBorderMeshPool;
        const gridSize = isBuilding ? this.config.terrainGridSize : this.config.placementGridSize;

        worldPositions.slice(0, this.config.maxCells).forEach((pos, index) => {
            if (index >= cellMeshPool.length) return;

            const terrainHeight = this.game.gameManager.call('getTerrainHeightAtPosition', pos.x, pos.z);
            const yPosition = (terrainHeight || 0) + this.config.elevationOffset;

            const cellMesh = cellMeshPool[index];
            cellMesh.material = cellMaterial;
            cellMesh.position.set(pos.x, yPosition, pos.z);
            cellMesh.visible = true;
            this.activeMeshes.push(cellMesh);

            const borderMesh = borderMeshPool[index];
            borderMesh.material = borderMaterial;
            borderMesh.position.set(pos.x, yPosition, pos.z);
            borderMesh.visible = true;
            this.activeMeshes.push(borderMesh);
        });

        this.previewGroup.visible = true;
        this.startAnimation();
    }
    
    showAtGridPositions(gridPositions, isValid = true, isBuilding = false) {
        const worldPositions = gridPositions.map(gridPos =>
            this.game.gridSystem.gridToWorld(gridPos.x, gridPos.z)
        );
        this.showAtWorldPositions(worldPositions, isValid, isBuilding);
    }

    showWithUnitMarkers(worldPositions, unitPositions, isValid = true, isBuilding = false) {
        const now = performance.now();
        if (now - this.lastUpdateTime < this.config.updateThrottle) {
            return;
        }
        this.lastUpdateTime = now;

        if (!worldPositions || worldPositions.length === 0) {
            this.hide();
            return;
        }

        this.isActive = true;
        this.hideAllMeshes();

        const cellMaterial = isValid ? this.materials.validCell : this.materials.invalidCell;
        const borderMaterial = isValid ? this.materials.validBorder : this.materials.invalidBorder;
        const unitMaterial = isValid ? this.materials.validUnit : this.materials.invalidUnit;

        // Choose appropriate mesh pools based on whether it's a building or unit
        const cellMeshPool = isBuilding ? this.footprintCellMeshPool : this.placementCellMeshPool;
        const borderMeshPool = isBuilding ? this.footprintBorderMeshPool : this.placementBorderMeshPool;
        const gridSize = isBuilding ? this.config.terrainGridSize : this.config.placementGridSize;
        // Center the mesh on the cell (gridToWorld returns corner positions)
        const halfSize = gridSize / 2;

        worldPositions.slice(0, this.config.maxCells).forEach((pos, index) => {
            if (index >= cellMeshPool.length) return;

            // Get terrain height at the center of the cell
            const centerX = pos.x + halfSize;
            const centerZ = pos.z + halfSize;
            const terrainHeight = this.game.gameManager.call('getTerrainHeightAtPosition', centerX, centerZ);
            const yPosition = (terrainHeight || 0) + this.config.elevationOffset;

            const cellMesh = cellMeshPool[index];
            cellMesh.material = cellMaterial;
            cellMesh.position.set(centerX, yPosition, centerZ);
            cellMesh.visible = true;
            this.activeMeshes.push(cellMesh);

            const borderMesh = borderMeshPool[index];
            borderMesh.material = borderMaterial;
            borderMesh.position.set(centerX, yPosition, centerZ);
            borderMesh.visible = true;
            this.activeMeshes.push(borderMesh);
        });

        if (unitPositions && unitPositions.length > 0) {
            unitPositions.slice(0, this.config.maxCells).forEach((pos, index) => {
                if (index >= this.unitMeshPool.length) return;

                // Get terrain height at the unit position
                const terrainHeight = this.game.gameManager.call('getTerrainHeightAtPosition', pos.x, pos.z);
                const yPosition = (terrainHeight || 0) + this.config.unitElevationOffset;

                const unitMesh = this.unitMeshPool[index];
                unitMesh.material = unitMaterial;
                unitMesh.position.set(pos.x, yPosition, pos.z);
                unitMesh.visible = true;
                this.activeMeshes.push(unitMesh);
            });
        }

        this.previewGroup.visible = true;
        this.startAnimation();
    }
    
    hideAllMeshes() {
        this.activeMeshes.length = 0;
        
        [...this.placementCellMeshPool, ...this.placementBorderMeshPool, ...this.footprintCellMeshPool, ...this.footprintBorderMeshPool, ...this.unitMeshPool].forEach(mesh => {
            mesh.visible = false;
        });
    }
    
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
    
    hide() {
        this.previewGroup.visible = false;
        this.hideAllMeshes();
        
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }
    
    clear() {
        this.hide();
        this.isActive = false;
    }
    
    updateConfig(newConfig) {
        Object.assign(this.config, newConfig);
        
        if (newConfig.cellOpacity !== undefined) {
            this.materials.validCell.opacity = newConfig.cellOpacity;
            this.materials.invalidCell.opacity = newConfig.cellOpacity;
        }
        
        if (newConfig.borderOpacity !== undefined) {
            this.materials.validBorder.opacity = newConfig.borderOpacity;
            this.materials.invalidBorder.opacity = newConfig.borderOpacity;
        }
    }
    
    dispose() {
        this.clear();
        
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
        }
        
        if (this.previewGroup.parent) {
            this.previewGroup.parent.remove(this.previewGroup);
        }
        
        Object.values(this.geometryPool).forEach(geometry => {
            if (geometry.dispose) {
                geometry.dispose();
            }
        });
        
        Object.values(this.materials).forEach(material => {
            if (material.dispose) {
                material.dispose();
            }
        });
        
        this.cellMeshPool = [];
        this.borderMeshPool = [];
        this.unitMeshPool = [];
        this.activeMeshes = [];
    }
}