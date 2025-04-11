// Core structure
class GraphicsEditor {
    constructor(gameEditor, config, {ShapeFactory, GE_SceneRenderer, GE_ShapeManager, GE_AnimationManager, GE_RotationUtils, GE_UIManager}) {
        this.gameEditor = gameEditor;
        this.config = config;
        this.shapeFactory = new ShapeFactory();
        this.canvas = document.getElementById('graphics-editor-canvas');
        // Initialize sub-modules
        this.sceneRenderer = new GE_SceneRenderer(gameEditor, this);
        this.shapeManager = new GE_ShapeManager(gameEditor, this);
        this.uiManager = new GE_UIManager(gameEditor, this);
        this.animationManager = new GE_AnimationManager(gameEditor, this);
        this.rotationUtils = GE_RotationUtils;
        // State management (simplified)
        this.state = {
            selectedShapeIndex: -1,
            currentAnimation: "idle",
            currentFrame: 0,
            renderData: { animations: { "idle": [{ shapes: [] }] } }
        };
        
        this.rootGroup = new window.THREE.Group(); // Main container for all shapes
        this.frameRotations = {};

        this.init();
    }
    
    init() {
        this.sceneRenderer.init();
        this.uiManager.init();
        this.shapeManager.init();
        this.animationManager.init();
        this.sceneRenderer.animate();
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
        
        // Initialize the frameRotations object if needed
        if (!this.frameRotations[this.state.currentAnimation] || !this.frameRotations[this.state.currentAnimation][this.state.currentFrame]) {
            this.initFrameRotations();
        }
    
        const currentShapes = this.state.renderData.animations[this.state.currentAnimation][this.state.currentFrame];
        const group = await this.shapeFactory.createFromJSON(currentShapes);
        
        // Add the shapes to the root group
        this.rootGroup.add(group);
        
        // Apply the rotation for the current frame only
        const frameRotation = this.frameRotations[this.state.currentAnimation][this.state.currentFrame];
        this.rootGroup.rotation.x = frameRotation.x;
        this.rootGroup.rotation.y = frameRotation.y;
        this.rootGroup.rotation.z = frameRotation.z;
    
        document.getElementById('shape-count').textContent = currentShapes.shapes.length;
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
    
        this.shapeManager.highlightSelectedShape();
    }
    
    initFrameRotations() {
        // Create rotation entries for all animations and frames
        Object.keys(this.state.renderData.animations).forEach(animName => {
            if (!this.frameRotations[animName]) {
                this.frameRotations[animName] = [];
            }
            
            // Ensure we have rotation data for each frame
            while (this.frameRotations[animName].length < this.state.renderData.animations[animName].length) {
                this.frameRotations[animName].push({ x: 0, y: 0, z: 0 });
            }
        });
    }
    

    refreshShapes(param) {
        this.shapeManager.updateShapeList();
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
