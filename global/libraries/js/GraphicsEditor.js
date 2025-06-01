/**
 * @class GraphicsEditor
 * @description Manages 3D graphics editing functionality including shapes, animations, and UI
 */
class GraphicsEditor {
    /**
     * @param {Object} gameEditor - Main game editor instance
     * @param {Object} config - Editor configuration
     * @param {Object} managers - Required manager instances
     * @param {Function} managers.ShapeFactory - Factory for creating shapes
     * @param {Function} managers.GE_SceneRenderer - Handles scene rendering
     * @param {Function} managers.GE_ShapeManager - Manages shape operations
     * @param {Function} managers.GE_AnimationManager - Handles animations
     * @param {Function} managers.GE_RotationUtils - Rotation utility functions
     * @param {Function} managers.GE_UIManager - Manages UI interactions
     * @param {Function} managers.GE_GroupManager - Handles shape grouping
     * @param {Function} managers.GE_GizmoManager - Manages transformation gizmos
     */
    constructor(gameEditor, config, {ShapeFactory, GE_SceneRenderer, GE_ShapeManager, GE_AnimationManager, GE_RotationUtils, GE_UIManager, GE_GroupManager, GE_GizmoManager}) {
        this.gameEditor = gameEditor;
        this.config = config;
        this.shapeFactory = new ShapeFactory(this.gameEditor.getPalette(), this.gameEditor.getCollections().textures, null);
        if(location.hostname.indexOf('github') >= 0) {
            this.shapeFactory.setURLRoot("/GUTS/");
        }
        this.canvas = document.getElementById('graphics-editor-canvas');
        // Initialize sub-modules
        this.sceneRenderer = new GE_SceneRenderer(gameEditor, this);
        this.shapeManager = new GE_ShapeManager(gameEditor, this);
        this.uiManager = new GE_UIManager(gameEditor, this);
        this.animationManager = new GE_AnimationManager(gameEditor, this);
        this.groupManager = new GE_GroupManager(gameEditor, this);
        this.gizmoManager = new GE_GizmoManager(gameEditor, this);
        this.rotationUtils = GE_RotationUtils;
        // State management (simplified)
        this.state = {
            editingModel: true,
            selectedShapeIndex: -1,
            currentAnimation: "",
            selectedGroup: "main",
            currentFrame: 0,
            renderData: { model: {}, animations: { idle: [{ main: { shapes: [], position: {x: 0, y: 0, z: 0}, rotation: {x:0,y:0,z:0}, scale: {x:1, y:1, z:1}} }] } }
        };
        
        this.rootGroup = new window.THREE.Group(); // Main container for all shapes
        this.rootGroup.name = "rootGroup";
        this.init();
    }
    /**
     * Initializes all manager components
     * @private
     */
    init() {
        this.sceneRenderer.init();
        this.uiManager.init();
        this.shapeManager.init();
        this.animationManager.init();
        this.groupManager.init();
        this.gizmoManager.init();
        this.sceneRenderer.animate();    
    }

    /**
     * Displays isometric sprite previews
     * @param {Array<Object>} sprites - Array of sprite data
     */
    displayIsometricSprites(sprites){
        this.uiManager.displayIsometricSprites(sprites);
    }

    /**
     * Renders all shapes in the scene
     * @param {boolean} [fireSave=true] - Whether to trigger a save after rendering
     * @returns {Promise<void>}
     */
    async renderShapes(fireSave = true) {
        await this.clearScene();
        await this.setupLights();
        
        if (!this.validateCurrentFrame()) {
            return;
        }
        
        await this.renderGroups();
        await this.updateUI(fireSave);
        await this.updateSelection();
    }

    /**
     * Clears all objects from the scene
     * @private
     * @returns {Promise<void>}
     */    
    async clearScene() {
        while (this.rootGroup.children.length > 0) {
            const obj = this.rootGroup.children[0];
            this.shapeFactory.disposeObject(obj);
            this.shapeManager.originalMaterials.delete(obj);
            this.rootGroup.remove(obj);
        }
    }

    /**
     * Sets up scene lighting
     * @private
     * @returns {Promise<void>}
     */    
    async setupLights() {
        if (this.sceneRenderer.scene.getObjectByName('ambient-light')) {
            return;
        }
    
        const ambientLight = new window.THREE.AmbientLight(0xffffff, 0.6);
        ambientLight.name = 'ambient-light';
        this.sceneRenderer.scene.add(ambientLight);
    
        const directionalLight = new window.THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(5, 10, 7.5);
        directionalLight.name = 'dir-light';
        this.sceneRenderer.scene.add(directionalLight);
    }    

    /**
     * Validates the current animation frame
     * @private
     * @returns {boolean} - Whether the current frame is valid
     */
    validateCurrentFrame() {
        if (!this.state.editingModel && !this.getCurrentFrame()) {
            console.warn(
                "Animation or frame doesn't exist:", 
                this.state.currentAnimation, 
                this.state.currentFrame
            );
            return false;
        }
        return true;
    }
    
    /**
     * Renders all shapes in the scene
     * @param {boolean} [fireSave=true] - Whether to trigger a save after rendering
     * @returns {Promise<void>}
     */
    async renderGroups() {
        const model = this.state.renderData.model;
        for (const groupName in model) {     
            const mergedGroup = this.getMergedGroup(groupName);
            if (mergedGroup) {
                let threeGroup = await this.shapeFactory.createGroupFromJSON(groupName, mergedGroup); 
    
                threeGroup.name = groupName;
                this.rootGroup.add(threeGroup);
            }
        }
    }

    /**
     * Renders all shapes in the scene
     * @param {boolean} [fireSave=true] - Whether to trigger a save after rendering
     * @returns {Promise<void>}
     */
    async updateUI(fireSave) {
        this.updateShapeCount();
        await this.handleSave(fireSave);
    }

    /**
     * Updates the shape count display in the UI
     * @private
     */
    updateShapeCount() {
        const model = this.state.renderData.model;
        const totalShapes = Object.values(model).reduce((total, group) => {
            return total + (Array.isArray(group.shapes) ? group.shapes.length : 0);
        }, 0);
        document.getElementById('shape-count').textContent = totalShapes;
    }
    
    /**
     * Handles saving the current state
     * @param {boolean} fireSave - Whether to trigger a save event
     * @returns {Promise<void>}
     */
    async handleSave(fireSave) {
        if (fireSave) {
            const saveEvent = new CustomEvent('saveGraphicsObject', {
                detail: { 
                    data: this.state.renderData, 
                    propertyName: 'render' 
                },
                bubbles: true,
                cancelable: true
            });
            document.body.dispatchEvent(saveEvent);
        } else {
            const valueElement = this.gameEditor.elements.editor
                .querySelector('#render-value');
            if (valueElement) {
                let renderDataCopy = JSON.parse(JSON.stringify(this.state.renderData));
                Object.keys(renderDataCopy.animations).forEach(animationName => {
                    const animation = renderDataCopy.animations[animationName];
                    animation.forEach(frame => {
                        Object.keys(frame).forEach(groupName => {
                            const group = frame[groupName];
                            if (group && group.shapes) {
                                // Filter shapes with more than just ID
                                group.shapes = group.shapes.filter(shape => 
                                    Object.keys(shape).length > 1
                                );
                                
                                // Remove empty shapes array
                                if (group.shapes.length === 0) {
                                    delete group.shapes;
                                }
                
                                // Remove empty group
                                if (Object.keys(group).length === 0) {
                                    delete frame[groupName];
                                }
                            }
                        });               
                    });
                });
                valueElement.value = JSON.stringify(renderDataCopy);
            }
        }
    }

    /**
     * Updates the selection highlight and gizmo positions
     * @returns {Promise<void>}
     */
    async updateSelection() {
        this.gizmoManager.updateGizmoPosition();
    }

    /**
     * Gets the current animation data
     * @returns {Object|null} Current animation or null if none exists
     */
    getCurrentAnimation() {
     
        return this.state.renderData.animations[this.state.currentAnimation] || null;
    }

    /**
     * Gets the current frame data
     * @returns {Object|null} Current frame data or model data if in editing mode
     */
    getCurrentFrame() {
        if(this.state.editingModel){
            return this.state.renderData.model;
        } else {
            let currentAnimation = this.getCurrentAnimation();
            return currentAnimation ? currentAnimation[this.state.currentFrame] : null;
        }
    }

    /**
     * Gets the current group data
     * @returns {Object|null} Current group data or null if none exists
     */
    getCurrentGroup() {
        let currentFrame = this.getCurrentFrame();
        return currentFrame ? currentFrame[this.state.currentGroup] : null;
    }

    /**
     * Refreshes the shape list and renders the scene
     * @param {boolean} param - Whether to trigger a save after refresh
     */
    refreshShapes(param) {
        this.uiManager.updateList();
        this.renderShapes(param);
    }

    /**
     * Creates an inspector panel for the given shape
     * @param {Object} shape - Shape to create inspector for
     */
    createInspector(shape) {
        this.uiManager.createInspector(shape);
    }

    /**
     * Sets the animation preview state
     * @param {Object} state - New animation state
     * @returns {Promise<void>}
     */
    setPreviewAnimationState(state) {
        return this.animationManager.setPreviewAnimationState(state);
    }

    /**
     * Selects a shape by index
     * @param {number} index - Index of shape to select
     * @returns {Promise<void>}
     */
    selectShape(index) {
        return this.shapeManager.selectShape(index);
    }

    /**
     * Gets a merged group by name
     * @param {string} groupName - Name of group to get
     * @returns {Object|null} Merged group data or null
     */
    getMergedGroup(groupName){
        let model = this.state.renderData.model;
        const modelGroup = model[groupName];
        if(this.state.editingModel){
            return modelGroup;
        }
        return this.shapeFactory.getMergedGroup(model, this.getCurrentAnimation()[this.state.currentFrame], groupName );
    }

    /**
     * Gets the current frame's shape data
     * @returns {Object|null} Shape data or null if not found
     */
    getFrameShape() {
        // If we're in model editing mode, return merged shape
        if (this.state.editingModel) {
            return this.getMergedShape();
        }
    
        // Return null if no shape is selected
        if (this.state.selectedShapeIndex < 0) {
            return null;
        }
    
        // Get or create group data
        let groupData = this.getCurrentGroup() || 
            JSON.parse(JSON.stringify(this.state.renderData.model[this.state.currentGroup]));
    
        if (!groupData?.shapes) {
            return null;
        }
    
        // Find existing shape or create new one
        let shape = groupData.shapes.find(s => s.id === this.state.selectedShapeIndex);
        if (shape) {
            return shape;
        }
    
        // Create new shape if not found
        return this.createBlankFrameShape();
    }

    /**
     * Creates a new blank frame shape
     * @private
     * @returns {Object|null} New shape or null if frame doesn't exist
     */
    createBlankFrameShape() {
        const shape = { id: this.state.selectedShapeIndex };
        const currentFrame = this.getCurrentFrame();
        
        if (!currentFrame) {
            return null;
        }
    
        // Add shape to current group or create new group
        if (!currentFrame[this.state.currentGroup]) {
            currentFrame[this.state.currentGroup] = { shapes: [] };
        }
        
        currentFrame[this.state.currentGroup].shapes.push(shape);
        return shape;
    }
    /**
     * Gets the currently selected shape merged with its group
     * @returns {Object|null} - Merged shape or null if not found
     */
    getMergedShape() {
        if (this.state.selectedShapeIndex < 0) {
            return null;
        }
    
        const selectedGroup = this.getMergedGroup(this.state.currentGroup);
        const shapes = selectedGroup?.shapes || [];
        const shape = shapes[this.state.selectedShapeIndex];
    
        if (!shape) {
            return null;
        }
    
        if (this.state.editingModel) {
            return shape;
        }
    
        return this.mergeShapeWithCurrentGroup(shape);
    }
    /**
     * Merges a shape with its current group
     * @param {Object} shape - Shape to merge
     * @returns {Object} - Merged shape
     */
    mergeShapeWithCurrentGroup(shape) {
        // Set shape ID
        shape.id = this.state.selectedShapeIndex;
    
        // Get or create current group data
        const currentGroupData = this.getCurrentGroup() || { shapes: [] };
        if (!Array.isArray(currentGroupData.shapes)) {
            currentGroupData.shapes = [];
        }
    
        // Update shape in current group
        this.updateShapeInGroup(shape, currentGroupData);
    
        // Update animation data
        this.updateAnimationData(currentGroupData);
    
        return shape;
    }
    /**
     * Updates a shape within its group
     * @param {Object} shape - Shape to update
     * @param {Object} groupData - Group containing the shape
     */
    updateShapeInGroup(shape, groupData) {
        const shapeIndex = groupData.shapes.findIndex(s => s.id === shape.id);
        
        if (shapeIndex >= 0) {
            groupData.shapes[shapeIndex] = shape; // Replace existing
        } else {
            groupData.shapes.push(shape); // Add new
        }
    }
    
    /**
     * Updates animation data for the current group
     * @param {Object} groupData - Group data to update
     */
    updateAnimationData(groupData) {
        const path = [
            this.state.currentAnimation,
            this.state.currentFrame,
            this.state.currentGroup
        ];
    
        // Update nested property safely
        let current = this.state.renderData.animations;
        path.forEach((key, index) => {
            if (index === path.length - 1) {
                current[key] = groupData;
            } else {
                current = current[key];
            }
        });
    }
    /**
     * Gets the currently selected object from the scene
     * @returns {THREE.Object3D} - Selected object or root group
     */
    getSelectedObject() {
        const currentGroup = this.state.currentGroup;
        
        if (!currentGroup) {
            return this.rootGroup;
        }
    
        const foundGroup = this.findGroupByName(currentGroup);
        if (!foundGroup) {
            return this.rootGroup;
        }
    
        const foundShape = this.findShapeInGroup(foundGroup);
        return foundShape || foundGroup || this.rootGroup;
    }
        /**
     * Finds a group by name in the scene
     * @param {string} groupName - Name of the group to find
     * @returns {THREE.Group|null} - Found group or null
     */
    findGroupByName(groupName) {
        let found = null;
        this.rootGroup.traverse(obj => {
            if (obj.isGroup && obj.name === groupName && obj.userData.isGroup) {
                found = obj;
            }
        });
        return found;
    }
        /**
     * Finds a shape within a group
     * @param {THREE.Group} group - Group to search in
     * @returns {THREE.Object3D|null} - Found shape or null
     */
    findShapeInGroup(group) {
        let found = null;
        group.traverse(obj => {
            if (obj.userData.isShape && obj.userData.index === this.state.selectedShapeIndex) {
                found = obj;
            }
        });
        return found;
    }
}
