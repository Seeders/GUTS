class GE_ShapeManager {
    constructor(gameEditor, graphicsEditor) {
        this.gameEditor = gameEditor;
        this.graphicsEditor = graphicsEditor;
        this.originalMaterials = new Map();
        this.selectedObjects = new Map();
        this.isTransforming = false;
        this.defaultShape = {
            type: 'sphere',
            size: 2,
            color: '#ff0000',
            x: 0, y: 0, z: 0,
            rotationX: 0, rotationY: 0, rotationZ: 0
        };
    }    

    init() {   
        this.initEventListeners();
    }

    initEventListeners() {
        try {
            const buttonMappings = {
                'add-shape': () => this.addSelectedShape(),
                'delete-shape': () => this.deleteSelectedShape()
            };

            Object.entries(buttonMappings).forEach(([id, handler]) => {
                const button = document.getElementById(id);
                if (button) {
                    button.addEventListener('click', handler);
                } else {
                    console.warn(`Button with id ${id} not found`);
                }
            });

            const moveCancel = document.getElementById('move-cancel');
            if (moveCancel) {
                moveCancel.addEventListener('click', () => {
                    const inspector = document.getElementById('inspector');
                    if (inspector) inspector.innerHTML = '';
                });
            }
        } catch (error) {
            console.error('Error initializing event listeners:', error);
        }
    }

    getShapeData(shapeId) {
        try {
            let currentGroup = this.getOrCreateCurrentGroup();
            return this.findOrCreateShape(currentGroup, shapeId);
        } catch (error) {
            console.error('Error getting shape data:', error);
            return null;
        }
    }

    getOrCreateCurrentGroup() {
        let currentGroup = this.graphicsEditor.getCurrentGroup();
        if (!currentGroup) {
            currentGroup = { shapes: [] };
            let currentAnimation = this.graphicsEditor.getCurrentAnimation();
            let currentFrame = currentAnimation[this.graphicsEditor.state.currentFrame] || {};
            currentFrame[this.graphicsEditor.state.currentGroup] = currentGroup;
            currentAnimation[this.graphicsEditor.state.currentFrame] = currentFrame;
        }
        currentGroup.shapes = currentGroup.shapes || [];
        return currentGroup;
    }

    findOrCreateShape(currentGroup, shapeId) {
        if (currentGroup.shapes.length === 0) {
            let shapeData = JSON.parse(JSON.stringify(
                this.graphicsEditor.state.renderData.model[this.graphicsEditor.state.currentGroup]
            )).shapes[shapeId];
            shapeData.id = shapeId;
            currentGroup.shapes = [shapeData];
            return shapeData;
        }

        if (this.graphicsEditor.state.editingModel) {
            return currentGroup.shapes[shapeId];
        }
        return currentGroup.shapes.find(s => s.id === shapeId);
    }

    async selectShape(index) {
        if (this.isTransforming) {
            console.warn('Cannot change selection during transformation');
            return;
        }

        try {
            if (this.graphicsEditor.animationManager.isPreviewingAnimation) {
                await this.graphicsEditor.setPreviewAnimationState(false);
            }

            const previousIndex = this.graphicsEditor.state.selectedShapeIndex;
            this.graphicsEditor.state.selectedShapeIndex = (previousIndex === index) ? -1 : index;

            await this.updateSelectionState();
        } catch (error) {
            console.error('Error in shape selection:', error);
            this.resetSelection();
        }
    }

    async updateSelectionState() {
        this.graphicsEditor.uiManager.updateList();
        const shape = this.graphicsEditor.getMergedShape();

        if (shape) {
            await this.handleShapeSelection(shape);
        } else {
            await this.handleNoSelection();
        }
    }

    async handleShapeSelection(shape) {
        this.highlightSelectedShape();
        this.graphicsEditor.createInspector(shape);
        await this.graphicsEditor.gizmoManager.transformSelectedObject();
        this.cacheSelectedObjects();
    }

    async handleNoSelection() {
        this.destroyOutlines();
        this.graphicsEditor.gizmoManager.destroyGizmo();
        await this.graphicsEditor.groupManager.selectGroup(this.graphicsEditor.state.currentGroup);
    }

    startTransform() {
        this.isTransforming = true;
        this.cacheSelectedObjects();
    }

    endTransform() {
        this.isTransforming = false;
        this.validateSelection();
    }

    cacheSelectedObjects() {
        this.selectedObjects.clear();
        const currentGroup = this.graphicsEditor.state.currentGroup;
        if (!currentGroup) return;

        this.graphicsEditor.rootGroup.traverse(obj => {
            if (this.isSelectedObject(obj)) {
                this.selectedObjects.set(obj.id, obj);
            }
        });
    }

    validateSelection() {
        if (this.selectedObjects.size === 0) return;
        
        let selectionValid = false;
        this.graphicsEditor.rootGroup.traverse(obj => {
            if (this.selectedObjects.has(obj.id)) {
                selectionValid = true;
            }
        });

        if (!selectionValid) {
            this.resetSelection();
        }
    }

    resetSelection() {
        this.destroyOutlines();
        this.graphicsEditor.gizmoManager.destroyGizmo();
        this.graphicsEditor.state.selectedShapeIndex = -1;
        this.selectedObjects.clear();
        this.isTransforming = false;
    }

    destroyOutlines() {
        this.graphicsEditor.sceneRenderer.scene.children
            .filter(obj => obj.userData.isOutline)
            .forEach(obj => {
                this.graphicsEditor.sceneRenderer.scene.remove(obj);
                if (obj.geometry) obj.geometry.dispose();
                if (obj.material) obj.material.dispose();
            });

        this.originalMaterials.forEach((material, object) => {
            if (this.isValidObject(object)) {
                object.material = material;
            }
        });
        this.originalMaterials.clear();
    }

    highlightSelectedShape() {
        this.destroyOutlines();
        if (!this.validateSelectionState()) return;

        const selectedGroup = this.findSelectedGroup();
        if (!selectedGroup) return;

        const selectedMeshes = this.findSelectedMeshes(selectedGroup);
        selectedMeshes.forEach(mesh => this.highlightMesh(mesh));
    }

    validateSelectionState() {
        if (this.graphicsEditor.state.selectedShapeIndex < 0) return false;
        
        const currentGroup = this.graphicsEditor.state.currentGroup;
        if (!currentGroup) {
            console.warn("No group selected");
            return false;
        }
        return true;
    }

    findSelectedGroup() {
        let selectedGroup = null;
        this.graphicsEditor.rootGroup.traverse(obj => {
            if (obj.isGroup && obj.name === this.graphicsEditor.state.currentGroup) {
                selectedGroup = obj;
            }
        });
        return selectedGroup;
    }

    findSelectedMeshes(selectedGroup) {
        const selectedMeshes = [];
        selectedGroup.traverse(obj => {
            if (this.isSelectedObject(obj)) {
                selectedMeshes.push(obj);
            }
        });
        return selectedMeshes;
    }

    isSelectedObject(obj) {
        return obj.isMesh && (
            (obj.userData.isShape && 
             obj.userData.index === this.graphicsEditor.state.selectedShapeIndex) ||
            (obj.parent?.userData.isShape && 
             obj.parent.userData.index === this.graphicsEditor.state.selectedShapeIndex) ||
            (obj.userData.isGLTFChild && 
             obj.parent?.userData.index === this.graphicsEditor.state.selectedShapeIndex)
        );
    }

    isValidObject(obj) {
        return obj && 
               obj.parent && 
               obj.geometry && 
               obj.material &&
               !obj.userData.isOutline;
    }

    highlightMesh(mesh) {
        this.applyHighlightMaterial(mesh);
        const outline = this.createOutline(mesh);
        const outlineGroup = this.createOutlineGroup(outline, mesh);
        this.graphicsEditor.sceneRenderer.scene.add(outlineGroup);
    }

    applyHighlightMaterial(mesh) {
        this.originalMaterials.set(mesh, mesh.material);
        const highlightMaterial = mesh.material.clone();
        highlightMaterial.emissive = new window.THREE.Color(0x555555);
        highlightMaterial.emissiveIntensity = 0.5;
        mesh.material = highlightMaterial;
    }

    createOutline(mesh) {
        const outlineGeometry = mesh.geometry.clone();
        const outlineMaterial = new window.THREE.MeshBasicMaterial({
            color: 0xffff00,
            side: window.THREE.BackSide
        });
        const outline = new window.THREE.Mesh(outlineGeometry, outlineMaterial);
        outline.userData.isOutline = true;
        return outline;
    }

    createOutlineGroup(outline, mesh) {
        let outlineGroup = new window.THREE.Group();
        outlineGroup.userData.isOutline = true;
        outlineGroup.add(outline);

        const transformChain = this.buildTransformChain(mesh);
        outlineGroup = this.applyTransformChain(outlineGroup, transformChain);
        
        outline.position.copy(mesh.position);
        outline.rotation.copy(mesh.rotation);
        outline.scale.copy(mesh.scale).multiplyScalar(1.05);
        
        return outlineGroup;
    }

    buildTransformChain(mesh) {
        const transformChain = [];
        let currentParent = mesh.parent;
        
        while (currentParent && currentParent !== this.graphicsEditor.rootGroup) {
            transformChain.unshift({
                position: currentParent.position.clone(),
                rotation: currentParent.rotation.clone(),
                scale: currentParent.scale.clone(),
                quaternion: currentParent.quaternion.clone()
            });
            currentParent = currentParent.parent;
        }
        
        return transformChain;
    }

    applyTransformChain(outlineGroup, transformChain) {
        return transformChain.reduce((group, transform) => {
            const tempGroup = new window.THREE.Group();
            tempGroup.position.copy(transform.position);
            tempGroup.rotation.copy(transform.rotation);
            tempGroup.scale.copy(transform.scale);
            tempGroup.add(group);
            tempGroup.userData.isOutline = true;
            return tempGroup;
        }, outlineGroup);
    }

    addNewShape() {
        if (!this.graphicsEditor.state.editingModel) return;
        
        try {
            const currentGroup = this.graphicsEditor.getCurrentGroup();
            if (!currentGroup) {
                console.error('No current group available');
                return;
            }

            const newShape = { ...this.defaultShape };
            currentGroup.shapes = currentGroup.shapes || [];
            currentGroup.shapes.push(newShape);
            this.graphicsEditor.state.selectedShapeIndex = currentGroup.shapes.length - 1;
            this.graphicsEditor.refreshShapes(true);
        } catch (error) {
            console.error('Error adding new shape:', error);
        }
    }

    addSelectedShape() {
        if (!this.graphicsEditor.state.editingModel) return;
        
        try {
            if (this.graphicsEditor.state.selectedShapeIndex >= 0) {
                this.duplicateSelectedShape();
            } else {
                this.addNewShape();
            }
        } catch (error) {
            console.error('Error adding selected shape:', error);
        }
    }

    duplicateSelectedShape() {
        const currentGroup = this.graphicsEditor.getCurrentGroup();
        if (!currentGroup?.shapes) {
            console.error('Invalid group or no shapes array');
            return;
        }

        const originalShape = this.findOriginalShape(currentGroup);
        if (!originalShape) {
            console.error('Could not find original shape to duplicate');
            return;
        }

        try {
            const newShape = JSON.parse(JSON.stringify(originalShape));
            currentGroup.shapes.push(newShape);
            this.graphicsEditor.state.selectedShapeIndex = currentGroup.shapes.length - 1;
            this.graphicsEditor.refreshShapes(true);
        } catch (error) {
            console.error('Error duplicating shape:', error);
        }
    }

    findOriginalShape(currentGroup) {
        if (this.graphicsEditor.state.editingModel) {
            return currentGroup.shapes[this.graphicsEditor.state.selectedShapeIndex];
        }
        return currentGroup.shapes.find(s => s.id === this.graphicsEditor.state.selectedShapeIndex);
    }

    deleteSelectedShape() {
        if (!this.graphicsEditor.state.editingModel) return;
        
        try {
            const currentGroup = this.graphicsEditor.getCurrentGroup();
            if (!currentGroup?.shapes) {
                console.error('Invalid group or no shapes array');
                return;
            }

            if (this.graphicsEditor.state.selectedShapeIndex >= 0) {
                currentGroup.shapes.splice(this.graphicsEditor.state.selectedShapeIndex, 1);
                this.updateSelectionAfterDelete(currentGroup);
                this.graphicsEditor.refreshShapes(true);
            }
        } catch (error) {
            console.error('Error deleting shape:', error);
        }
    }

    updateSelectionAfterDelete(currentGroup) {
        if (currentGroup.shapes.length > 0) {
            this.graphicsEditor.state.selectedShapeIndex = Math.min(
                this.graphicsEditor.state.selectedShapeIndex,
                currentGroup.shapes.length - 1
            );
        } else {
            this.graphicsEditor.state.selectedShapeIndex = -1;
        }
    }
}