// Core structure
class GraphicsEditor {
    constructor(gameEditor, config, {ShapeFactory, GE_SceneRenderer, GE_ShapeManager, GE_AnimationManager, GE_RotationUtils, GE_UIManager, GE_GroupManager, GE_GizmoManager}) {
        this.gameEditor = gameEditor;
        this.config = config;
        this.shapeFactory = new ShapeFactory();
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
    
    init() {
        this.sceneRenderer.init();
        this.uiManager.init();
        this.shapeManager.init();
        this.animationManager.init();
        this.groupManager.init();
        this.gizmoManager.init();
        this.sceneRenderer.animate();
    }
    displayIsometricSprites(sprites){
        this.uiManager.displayIsometricSprites(sprites);
    }
    async renderShapes(fireSave = true) {
        // Clear the root group
        while (this.rootGroup.children.length > 0) {
            const obj = this.rootGroup.children[0];
            this.shapeFactory.disposeObject(obj);
            this.shapeManager.originalMaterials.delete(obj);
            this.rootGroup.remove(obj);
        }
    
        // Add lights if they don't exist
        if (!this.sceneRenderer.scene.getObjectByName('ambient-light')) {
            const ambientLight = new window.THREE.AmbientLight(0xffffff, 0.6);
            ambientLight.name = 'ambient-light';
            this.sceneRenderer.scene.add(ambientLight);
            const directionalLight = new window.THREE.DirectionalLight(0xffffff, 0.8);
            directionalLight.position.set(5, 10, 7.5);
            directionalLight.name = 'dir-light';
            this.sceneRenderer.scene.add(directionalLight);
        }
            
        const currentAnimation = this.state.currentAnimation;
        const currentFrame = this.state.currentFrame;
        
        // Ensure animation and frame exist
        if (!this.state.editingModel && !this.getCurrentFrame()) {
            console.warn("Animation or frame doesn't exist:", currentAnimation, currentFrame);
            return;
        }
        
        let frameData = this.getCurrentFrame();
        //model is a Frame that has named groups as properties.
        let model = this.state.renderData.model;

        // Create a group for each group in the frame
        for (const groupName in frameData) {     
            const mergedGroup = this.getMergedGroup(groupName);
            if( mergedGroup){
                let threeGroup = await this.shapeFactory.createGroupFromJSON(mergedGroup); 
                threeGroup.name = groupName;
                // Add the group to the root group
                this.rootGroup.add(threeGroup);
            }
        }
            
        // Count total shapes for display
        let totalShapes = 0;
        for (const groupName in model) {
            if (Array.isArray(model[groupName].shapes)) {
                totalShapes += model[groupName].shapes.length;
            }
        }
        document.getElementById('shape-count').textContent = totalShapes;
        
        // Update JSON display
        document.getElementById('json-content').value = JSON.stringify(this.state.renderData, null, 2);
    
        if (fireSave) {
            const myCustomEvent = new CustomEvent('saveGraphicsObject', {
                detail: { data: this.state.renderData, propertyName: 'render' },
                bubbles: true,
                cancelable: true
            });
            document.body.dispatchEvent(myCustomEvent);
        } else {
            let valEl = this.gameEditor.elements.editor.querySelector(`#render-value`);
            if (valEl) {
                valEl.value = JSON.stringify(this.state.renderData);
            }
        }
    
        // Highlight the selected shape if any
        this.shapeManager.highlightSelectedShape();
        this.gizmoManager.updateGizmoPosition();
    }
    
    getCurrentAnimation() {
     
        return this.state.renderData.animations[this.state.currentAnimation];
    }
    getCurrentFrame() {
        if(this.state.editingModel){
            return this.state.renderData.model;
        } else {
            return this.getCurrentAnimation()[this.state.currentFrame];
        }
    }
    getCurrentGroup() {
        return this.getCurrentFrame()[this.state.currentGroup];
    }

    refreshShapes(param) {
        this.uiManager.updateList();
        this.renderShapes(param);
    }

    createInspector(shape) {
        this.uiManager.createInspector(shape);
    }

    setPreviewAnimationState(state) {
        return this.animationManager.setPreviewAnimationState(state);
    }

    selectShape(index) {
        return this.shapeManager.selectShape(index);
    }

    getMergedGroup(groupName){
        let model = this.state.renderData.model;
        const modelGroup = model[groupName];
        if(this.state.editingModel){
            return modelGroup;
        }
        return this.shapeFactory.getMergedGroup(model, this.getCurrentAnimation()[this.state.currentFrame], groupName );
    }

    getMergedShape() {
        if (this.state.selectedShapeIndex >= 0) {            
            const selectedGroup = this.getMergedGroup(this.state.currentGroup);
            const shapes = selectedGroup?.shapes || [];        
            let shape = shapes[this.state.selectedShapeIndex];  
            if(this.state.editingModel){
                return shape;
            }     
            if (shape) {  
                shape.id = this.state.selectedShapeIndex;
                // Avoid overwriting shape.id unless necessary
                let currentGroupData = this.getCurrentGroup();
                
                // Ensure shapes array exists
                currentGroupData.shapes = currentGroupData.shapes || [];
                
                // Find index of shape with matching id
                const shapeIndex = currentGroupData.shapes.findIndex(s => s.id === shape.id);
                console.log(shapeIndex, shape.id);
                // Replace or append shape
                if (shapeIndex >= 0) {
                    currentGroupData.shapes[shapeIndex] = shape; // Replace
                } else {
                    currentGroupData.shapes.push(shape); // Append if not found
                }
                
                return shape;
            }            
        }
        return null;
    }

    getSelectedObject() {
        const currentGroup = this.state.currentGroup;
        if (currentGroup) {
            let foundGroup = null;
            this.rootGroup.traverse(obj => {
                if (obj.isGroup && obj.name === currentGroup && obj.userData.isGroup) {
                    foundGroup = obj;
                }
            });
            let foundShape = null;
            if(foundGroup){
                foundGroup.traverse(obj => {
                    if (obj.userData.isShape && obj.userData.index == this.state.selectedShapeIndex) {
                        foundShape = obj;
                    }
                });
            }
            return foundShape || foundGroup || this.rootGroup;
        }
        return this.rootGroup;
    }
}
