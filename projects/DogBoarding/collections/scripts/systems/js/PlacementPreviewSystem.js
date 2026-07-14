/**
 * PlacementPreviewSystem - Renders placement preview indicators
 *
 * Shows grid cells and unit markers for placement previews.
 * Used by PlacementUISystem and UnitOrderUISystem.
 */
class PlacementPreviewSystem extends GUTS.BaseSystem {
    static services = [
        'showPreviewAtWorldPositions',
        'showPreviewMultiplePositionSets',
        'showPreviewAtGridPositions',
        'showPreviewWithUnitMarkers',
        'hidePreview',
        'clearPreview',
        'updatePreviewConfig'
    ];

    static serviceDependencies = [
        'getUIScene',
        'getTerrainHeightAtPosition',
        'placementGridToWorld',
        'tileToWorld'
    ];

    constructor(game) {
        super(game);
        this.game.placementPreviewSystem = this;

        this.isActive = false;
        this.previewGroup = null;
        this.geometryPool = null;
        this.materials = null;

        this.placementCellMeshPool = [];
        this.placementBorderMeshPool = [];
        this.footprintCellMeshPool = [];
        this.footprintBorderMeshPool = [];
        this.unitMeshPool = [];
        this.activeMeshes = [];

        this.animationId = null;
        this.lastUpdateTime = 0;
    }

    init() {
        const configs = this.game.getCollections().configs.game;
        this.gridSize = configs.gridSize;

        this.config = {
            cellOpacity: 0.4,
            borderOpacity: 0.8,
            unitIndicatorRadius: 3,
            unitIndicatorSegments: 8,
            elevationOffset: 0.5,
            unitElevationOffset: -12,
            cellSizeMultiplier: 0.9,
            maxCells: 50,
            updateThrottle: 16,
            placementGridSize: this.gridSize / 2,
            terrainGridSize: this.gridSize
        };
    }

    onSceneLoad() {
        this.scene = this.call.getUIScene?.();
        if (!this.scene) {
            console.warn('[PlacementPreviewSystem] No UI scene available');
            return;
        }

        this.previewGroup = new THREE.Group();
        this.previewGroup.name = 'PlacementPreview';
        this.previewGroup.visible = false;
        this.scene.add(this.previewGroup);

        this.geometryPool = this.createGeometryPool();
        this.materials = this.createMaterials();
        this.initializeObjectPools();
    }

    createGeometryPool() {
        const placementCellSize = this.config.placementGridSize * this.config.cellSizeMultiplier;
        const footprintCellSize = this.config.terrainGridSize * this.config.cellSizeMultiplier;

        return {
            placementCellPlane: new THREE.PlaneGeometry(placementCellSize, placementCellSize),
            footprintCellPlane: new THREE.PlaneGeometry(footprintCellSize, footprintCellSize),
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
            pendingCell: new THREE.MeshBasicMaterial({
                color: 0xffcc00,
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
            pendingBorder: new THREE.LineBasicMaterial({
                color: 0xffcc00,
                transparent: true,
                opacity: this.config.borderOpacity
            }),
            stealthCell: new THREE.MeshBasicMaterial({
                color: 0x6644aa,
                transparent: true,
                opacity: this.config.cellOpacity * 0.7,
                side: THREE.DoubleSide
            }),
            stealthBorder: new THREE.LineBasicMaterial({
                color: 0x8866cc,
                transparent: true,
                opacity: this.config.borderOpacity * 0.8
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

    getTerrainHeight(x, z) {
        return this.call.getTerrainHeightAtPosition(x, z);
    }

    // Service: Show preview at world positions
    showPreviewAtWorldPositions(worldPositions, isValid = true, isBuilding = false) {
        if (!this.previewGroup) return;

        const now = performance.now();
        if (now - this.lastUpdateTime < this.config.updateThrottle) {
            return;
        }
        this.lastUpdateTime = now;

        if (!worldPositions || worldPositions.length === 0) {
            this.hidePreview();
            return;
        }

        this.isActive = true;
        this.hideAllMeshes();

        const cellMaterial = isValid ? this.materials.validCell : this.materials.invalidCell;
        const borderMaterial = isValid ? this.materials.validBorder : this.materials.invalidBorder;

        const cellMeshPool = isBuilding ? this.footprintCellMeshPool : this.placementCellMeshPool;
        const borderMeshPool = isBuilding ? this.footprintBorderMeshPool : this.placementBorderMeshPool;

        worldPositions.slice(0, this.config.maxCells).forEach((pos, index) => {
            if (index >= cellMeshPool.length) return;

            const terrainHeight = this.getTerrainHeight(pos.x, pos.z);
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

    // Service: Show multiple position sets with different colors
    showPreviewMultiplePositionSets(positionSets, isBuilding = false) {
        if (!this.previewGroup) return;

        const allPositions = positionSets.flatMap(set => set.positions || []);
        if (allPositions.length === 0) {
            this.hidePreview();
            return;
        }

        this.isActive = true;
        this.hideAllMeshes();

        const cellMeshPool = isBuilding ? this.footprintCellMeshPool : this.placementCellMeshPool;
        const borderMeshPool = isBuilding ? this.footprintBorderMeshPool : this.placementBorderMeshPool;

        let meshIndex = 0;

        for (const set of positionSets) {
            if (!set.positions || set.positions.length === 0) continue;

            let cellMaterial, borderMaterial;
            if (set.state === 'pending') {
                cellMaterial = this.materials.pendingCell;
                borderMaterial = this.materials.pendingBorder;
            } else if (set.state === 'stealth') {
                cellMaterial = this.materials.stealthCell;
                borderMaterial = this.materials.stealthBorder;
            } else if (set.state === 'valid' || set.isValid === true) {
                cellMaterial = this.materials.validCell;
                borderMaterial = this.materials.validBorder;
            } else {
                cellMaterial = this.materials.invalidCell;
                borderMaterial = this.materials.invalidBorder;
            }

            for (const pos of set.positions) {
                if (meshIndex >= cellMeshPool.length || meshIndex >= this.config.maxCells) break;

                const terrainHeight = this.getTerrainHeight(pos.x, pos.z);
                const yPosition = (terrainHeight || 0) + this.config.elevationOffset;

                const cellMesh = cellMeshPool[meshIndex];
                cellMesh.material = cellMaterial;
                cellMesh.position.set(pos.x, yPosition, pos.z);
                cellMesh.visible = true;
                this.activeMeshes.push(cellMesh);

                const borderMesh = borderMeshPool[meshIndex];
                borderMesh.material = borderMaterial;
                borderMesh.position.set(pos.x, yPosition, pos.z);
                borderMesh.visible = true;
                this.activeMeshes.push(borderMesh);

                meshIndex++;
            }
        }

        this.previewGroup.visible = true;
        this.startAnimation();
    }

    // Service: Show preview at grid positions
    showPreviewAtGridPositions(gridPositions, isValid = true, isBuilding = false) {
        let worldPositions;

        if (!isBuilding) {
            worldPositions = gridPositions.map(gridPos =>
                this.call.placementGridToWorld(gridPos.x, gridPos.z)
            );
        } else {
            worldPositions = gridPositions.map(gridPos =>
                this.call.tileToWorld(gridPos.x, gridPos.z)
            );
        }

        this.showPreviewAtWorldPositions(worldPositions, isValid, isBuilding);
    }

    // Service: Show preview with unit markers
    showPreviewWithUnitMarkers(worldPositions, unitPositions, isValid = true, isBuilding = false) {
        if (!this.previewGroup) return;

        const now = performance.now();
        if (now - this.lastUpdateTime < this.config.updateThrottle) {
            return;
        }
        this.lastUpdateTime = now;

        if (!worldPositions || worldPositions.length === 0) {
            this.hidePreview();
            return;
        }

        this.isActive = true;
        this.hideAllMeshes();

        const cellMaterial = isValid ? this.materials.validCell : this.materials.invalidCell;
        const borderMaterial = isValid ? this.materials.validBorder : this.materials.invalidBorder;
        const unitMaterial = isValid ? this.materials.validUnit : this.materials.invalidUnit;

        const cellMeshPool = isBuilding ? this.footprintCellMeshPool : this.placementCellMeshPool;
        const borderMeshPool = isBuilding ? this.footprintBorderMeshPool : this.placementBorderMeshPool;
        const gridSize = isBuilding ? this.config.terrainGridSize : this.config.placementGridSize;
        const halfSize = gridSize / 2;

        worldPositions.slice(0, this.config.maxCells).forEach((pos, index) => {
            if (index >= cellMeshPool.length) return;

            const centerX = pos.x + halfSize;
            const centerZ = pos.z + halfSize;
            const terrainHeight = this.getTerrainHeight(centerX, centerZ);
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

                const terrainHeight = this.getTerrainHeight(pos.x, pos.z);
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

        [...this.placementCellMeshPool, ...this.placementBorderMeshPool,
         ...this.footprintCellMeshPool, ...this.footprintBorderMeshPool,
         ...this.unitMeshPool].forEach(mesh => {
            mesh.visible = false;
        });
    }

    startAnimation() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
        }

        const startTime = performance.now();
        const animate = () => {
            if (!this.previewGroup?.visible) {
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

    // Service: Hide preview
    hidePreview() {
        if (!this.previewGroup) return;

        this.previewGroup.visible = false;
        this.hideAllMeshes();

        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }

    // Service: Clear preview
    clearPreview() {
        this.hidePreview();
        this.isActive = false;
    }

    // Service: Update preview config
    updatePreviewConfig(newConfig) {
        Object.assign(this.config, newConfig);

        if (this.materials) {
            if (newConfig.cellOpacity !== undefined) {
                this.materials.validCell.opacity = newConfig.cellOpacity;
                this.materials.invalidCell.opacity = newConfig.cellOpacity;
            }

            if (newConfig.borderOpacity !== undefined) {
                this.materials.validBorder.opacity = newConfig.borderOpacity;
                this.materials.invalidBorder.opacity = newConfig.borderOpacity;
            }
        }
    }

    dispose() {
        this.clearPreview();

        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
        }

        if (this.previewGroup?.parent) {
            this.previewGroup.parent.remove(this.previewGroup);
        }

        if (this.geometryPool) {
            Object.values(this.geometryPool).forEach(geometry => {
                if (geometry.dispose) geometry.dispose();
            });
        }

        if (this.materials) {
            Object.values(this.materials).forEach(material => {
                if (material.dispose) material.dispose();
            });
        }

        this.placementCellMeshPool = [];
        this.placementBorderMeshPool = [];
        this.footprintCellMeshPool = [];
        this.footprintBorderMeshPool = [];
        this.unitMeshPool = [];
        this.activeMeshes = [];
    }
}
