class PlacementPreview {
    constructor(game) {
        this.game = game;
        this.game.placementPreview = this;
        
        this.isActive = false;
        
        this.previewGroup = new THREE.Group();
        this.previewGroup.name = 'PlacementPreview';
        this.previewGroup.visible = false;
        this.game.uiScene.add(this.previewGroup);
        
        this.config = {
            cellOpacity: 0.4,
            borderOpacity: 0.8,
            unitIndicatorRadius: 3,
            unitIndicatorSegments: 8,
            elevationOffset: 2,
            unitElevationOffset: 2,
            cellSizeMultiplier: 0.9,
            maxCells: 50,
            updateThrottle: 16,
            gridSize: game.getCollections().configs.game.gridSize
        };
        
        this.geometryPool = this.createGeometryPool();
        this.materials = this.createMaterials();
        
        this.cellMeshPool = [];
        this.borderMeshPool = [];
        this.unitMeshPool = [];
        this.activeMeshes = [];
        
        this.animationId = null;
        this.lastUpdateTime = 0;
        
        this.initializeObjectPools();
    }
    
    createGeometryPool() {
        const cellSize = this.game.gridSystem.dimensions.cellSize * this.config.cellSizeMultiplier;
        
        return {
            cellPlane: new THREE.PlaneGeometry(cellSize, cellSize),
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
    
    showAtWorldPositions(worldPositions, isValid = true) {
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
        const amt = this.config.gridSize / 3;
        worldPositions.slice(0, this.config.maxCells).forEach((pos, index) => {
            if (index >= this.cellMeshPool.length) return;
            
            const cellMesh = this.cellMeshPool[index];
            cellMesh.material = cellMaterial;
            cellMesh.position.set(pos.x + amt, this.config.elevationOffset, pos.z - amt);
            cellMesh.visible = true;
            this.activeMeshes.push(cellMesh);
            
            const borderMesh = this.borderMeshPool[index];
            borderMesh.material = borderMaterial;
            borderMesh.position.set(pos.x + amt, this.config.elevationOffset, pos.z - amt);
            borderMesh.visible = true;
            this.activeMeshes.push(borderMesh);
        });
        
        this.previewGroup.visible = true;
        this.startAnimation();
    }
    
    showAtGridPositions(gridPositions, isValid = true) {
        const worldPositions = gridPositions.map(gridPos => 
            this.game.gridSystem.gridToWorld(gridPos.x, gridPos.z)
        );
        this.showAtWorldPositions(worldPositions, isValid);
    }
    
    showWithUnitMarkers(worldPositions, unitPositions, isValid = true) {
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
        
        worldPositions.slice(0, this.config.maxCells).forEach((pos, index) => {
            if (index >= this.cellMeshPool.length) return;
            
            const cellMesh = this.cellMeshPool[index];
            cellMesh.material = cellMaterial;
            cellMesh.position.set(pos.x, this.config.elevationOffset, pos.z);
            cellMesh.visible = true;
            this.activeMeshes.push(cellMesh);
            
            const borderMesh = this.borderMeshPool[index];
            borderMesh.material = borderMaterial;
            borderMesh.position.set(pos.x, this.config.elevationOffset, pos.z);
            borderMesh.visible = true;
            this.activeMeshes.push(borderMesh);
        });
        
        if (unitPositions && unitPositions.length > 0) {
            unitPositions.slice(0, this.config.maxCells).forEach((pos, index) => {
                if (index >= this.unitMeshPool.length) return;
                
                const unitMesh = this.unitMeshPool[index];
                unitMesh.material = unitMaterial;
                unitMesh.position.set(pos.x, this.config.unitElevationOffset, pos.z);
                unitMesh.visible = true;
                this.activeMeshes.push(unitMesh);
            });
        }
        
        this.previewGroup.visible = true;
        this.startAnimation();
    }
    
    hideAllMeshes() {
        this.activeMeshes.length = 0;
        
        [...this.cellMeshPool, ...this.borderMeshPool, ...this.unitMeshPool].forEach(mesh => {
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