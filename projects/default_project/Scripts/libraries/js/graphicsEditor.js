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
    
    applyGroupRotationToShapes() {
        const frameRotation = this.frameRotations[this.state.currentAnimation][this.state.currentFrame];
        
        // Skip if no rotation has been applied
        if (frameRotation.x === 0 && frameRotation.y === 0 && frameRotation.z === 0) {
            return;
        }
        
        // Create a rotation matrix from the current frame rotation
        const rotationMatrix = new window.THREE.Matrix4();
        rotationMatrix.makeRotationFromEuler(new window.THREE.Euler(
            frameRotation.x,
            frameRotation.y,
            frameRotation.z
        ));
        
        // Apply the rotation to each shape's position in the current frame only
        const currentShapes = this.state.renderData.animations[this.state.currentAnimation][this.state.currentFrame].shapes;
        const centerPoint = new window.THREE.Vector3(0, 0, 0);
        
        currentShapes.forEach(shape => {
            // Create a vector for the shape's position
            const position = new window.THREE.Vector3(
                shape.x || 0,
                shape.y || 0,
                shape.z || 0
            );
            
            // Apply rotation around the center
            position.sub(centerPoint); // Translate to origin
            position.applyMatrix4(rotationMatrix); // Apply rotation
            position.add(centerPoint); // Translate back
            
            // Update shape data
            shape.x = position.x;
            shape.y = position.y;
            shape.z = position.z;
            
            // Also update the rotation of the shape itself
            const rotation = new window.THREE.Euler(
                this.rotationUtils.degToRad(shape.rotationX || 0),
                this.rotationUtils.degToRad(shape.rotationY || 0),
                this.rotationUtils.degToRad(shape.rotationZ || 0)
            );
            
            // Apply group rotation to shape's own rotation
            const quaternion = new window.THREE.Quaternion().setFromEuler(rotation);
            const groupQuaternion = new window.THREE.Quaternion().setFromEuler(
                new window.THREE.Euler(frameRotation.x, frameRotation.y, frameRotation.z)
            );
            quaternion.premultiply(groupQuaternion);
            
            // Convert back to Euler angles
            const newRotation = new window.THREE.Euler().setFromQuaternion(quaternion);
            
            // Update shape rotation data
            shape.rotationX = this.rotationUtils.radToDeg(newRotation.x);
            shape.rotationY = this.rotationUtils.radToDeg(newRotation.y);
            shape.rotationZ = this.rotationUtils.radToDeg(newRotation.z);
        });
        
        // Reset the frame rotation after applying it to shapes
        this.frameRotations[this.state.currentAnimation][this.state.currentFrame] = { x: 0, y: 0, z: 0 };
        this.rootGroup.rotation.set(0, 0, 0);
        
        this.refreshShapes(true);
    }
    updateGroupRotationPreview() {
        const xDeg = document.getElementById('group-rotate-x').value;
        const yDeg = document.getElementById('group-rotate-y').value;
        const zDeg = document.getElementById('group-rotate-z').value;
        
        document.getElementById('group-rotate-x-value').textContent = `${xDeg}°`;
        document.getElementById('group-rotate-y-value').textContent = `${yDeg}°`;
        document.getElementById('group-rotate-z-value').textContent = `${zDeg}°`;
        
        // Update the rotation of the root group in real-time
        this.rootGroup.rotation.set(
            this.rotationUtils.degToRad(xDeg),
            this.rotationUtils.degToRad(yDeg),
            this.rotationUtils.degToRad(zDeg)
        );
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
