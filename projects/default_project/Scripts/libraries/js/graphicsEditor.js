// Core structure
class GraphicsEditor {
    constructor(gameEditor, config, {ShapeFactory, GE_SceneRenderer, GE_ShapeManager, GE_AnimationManager, GE_RotationUtils, GE_UIManager, GE_GroupManager}) {
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
        this.rotationUtils = GE_RotationUtils;
        // State management (simplified)
        this.state = {
            selectedShapeIndex: -1,
            currentAnimation: "idle",
            selectedGroup: "main",
            currentFrame: 0,
            renderData: { animations: { idle: [{ main: { shapes: [], position: {x: 0, y: 0, z: 0}, rotation: {x:0,y:0,z:0}, scale: {x:1, y:1, z:1}} }] } }
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
        if (!this.state.renderData.animations[currentAnimation] || 
            !this.state.renderData.animations[currentAnimation][currentFrame]) {
            console.warn("Animation or frame doesn't exist:", currentAnimation, currentFrame);
            return;
        }
        
        let frameData = this.state.renderData.animations[currentAnimation][currentFrame];
        
        // Backward compatibility: If frameData is not structured as groups
        if (Array.isArray(frameData)) {
            console.warn("Old format detected, converting to new group format");
            this.state.renderData.animations[currentAnimation][currentFrame] = { shapes: frameData };
            frameData = this.state.renderData.animations[currentAnimation][currentFrame];
        }
        
        // Create a group for each group in the frame
        for (const groupName in frameData) {
            if (Array.isArray(frameData[groupName])) {
                let shapes = frameData[groupName];
                let newGroup = {...this.groupManager.DEFAULT_GROUP};
                newGroup.shapes = shapes;
                this.state.renderData.animations[currentAnimation][currentFrame][groupName] = newGroup;
                frameData = this.state.renderData.animations[currentAnimation][currentFrame];
            }
            
            
            // Create objects for this group
            const groupData = frameData[groupName];
            let threeGroup = await this.shapeFactory.createGroupFromJSON(groupData); 
            threeGroup.name = groupName;
            // Add the group to the root group
            this.rootGroup.add(threeGroup);
        }
            
        // Count total shapes for display
        let totalShapes = 0;
        for (const groupName in frameData) {
            if (Array.isArray(frameData[groupName].shapes)) {
                totalShapes += frameData[groupName].shapes.length;
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
        this.shapeManager.updateGizmoPosition();
    }
    

    refreshShapes(param) {
        this.shapeManager.updateList();
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
}
