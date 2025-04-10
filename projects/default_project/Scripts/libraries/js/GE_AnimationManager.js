class GE_AnimationManager {
    constructor(gameEditor, graphicsEditor) {
        this.gameEditor = gameEditor;
        this.graphicsEditor = graphicsEditor;

        this.isPreviewingAnimation = false;
    }    

    init() {   
        this.initEventListeners();
    }
    
    initEventListeners() {
        // Button event listeners
        const buttonMappings = {
            'preview-animation': this.togglePreview.bind(this),
            'add-animation': this.addNewAnimation.bind(this),
            'delete-animation': this.deleteAnimation.bind(this),
            'duplicate-frame': this.duplicateFrame.bind(this),
            'delete-frame': this.deleteFrame.bind(this)
        };
        Object.entries(buttonMappings).forEach(([id, handler]) => {
            const button = document.getElementById(id);
            if (button) button.addEventListener('click', handler);
        });
    }

    setPreviewAnimationState(isPreviewing) {
        this.isPreviewingAnimation = isPreviewing;
        let btn = document.getElementById('preview-animation');
        if (this.isPreviewingAnimation) {
            btn.classList.add("active");
        } else {
            this.graphicsEditor.state.currentFrame = 0;
            btn.classList.remove("active");
        }
    }

    async animatePreview() {
        if (!this.isPreviewingAnimation) return;
        this.graphicsEditor.state.currentFrame = (this.graphicsEditor.state.currentFrame + 1) % this.graphicsEditor.state.renderData.animations[this.graphicsEditor.state.currentAnimation].length;
        await this.graphicsEditor.renderShapes(false);
        setTimeout(this.animatePreview.bind(this), 166); // ~6 FPS, adjust as needed
    }
    
    async togglePreview(e) {
        this.isPreviewingAnimation = !this.isPreviewingAnimation;
        await this.animatePreview();
        this.setPreviewAnimationState(this.isPreviewingAnimation);            
    }

    


    addNewAnimation() {
        const animName = prompt("Enter animation name:", `anim${Object.keys(this.graphicsEditor.state.renderData.animations).length + 1}`);
        if (animName && !this.graphicsEditor.state.renderData.animations[animName]) {
            this.graphicsEditor.state.renderData.animations[animName] = [ ...this.graphicsEditor.state.renderData.animations["idle"] ];
            this.graphicsEditor.state.currentAnimation = animName;
            this.graphicsEditor.state.currentFrame = 0;
            
            // Initialize rotation data for the new animation
            this.graphicsEditor.frameRotations[animName] = this.graphicsEditor.state.renderData.animations[animName].map(() => ({ x: 0, y: 0, z: 0 }));
            
            this.graphicsEditor.refreshShapes(true);
        }
    }

    deleteAnimation() {
        if (this.graphicsEditor.state.currentAnimation !== "idle") {
            delete this.graphicsEditor.state.renderData.animations[this.graphicsEditor.state.currentAnimation];
            this.graphicsEditor.state.currentAnimation = "idle";
            this.graphicsEditor.state.currentFrame = 0;
            this.graphicsEditor.state.selectedShapeIndex = -1;
            this.graphicsEditor.refreshShapes(true);
        }
    }

    duplicateFrame() {
        if (this.graphicsEditor.state.renderData.animations[this.graphicsEditor.state.currentAnimation].length > 0) {
            const currentShapes = this.graphicsEditor.state.renderData.animations[this.graphicsEditor.state.currentAnimation][this.graphicsEditor.state.currentFrame];
            const newFrame = { shapes: JSON.parse(JSON.stringify(currentShapes.shapes)) };
            this.graphicsEditor.state.renderData.animations[this.graphicsEditor.state.currentAnimation].splice(this.graphicsEditor.state.currentFrame + 1, 0, newFrame);
            
            // Duplicate the rotation data for the new frame
            if (this.graphicsEditor.frameRotations[this.graphicsEditor.state.currentAnimation]) {
                const currentRotation = this.graphicsEditor.frameRotations[this.graphicsEditor.state.currentAnimation][this.graphicsEditor.state.currentFrame];
                this.graphicsEditor.frameRotations[this.graphicsEditor.state.currentAnimation].splice(this.graphicsEditor.state.currentFrame + 1, 0, {
                    x: currentRotation.x,
                    y: currentRotation.y,
                    z: currentRotation.z
                });
            }
            
            this.graphicsEditor.state.currentFrame++;
            this.graphicsEditor.refreshShapes(true);
        }
    }

    deleteFrame() {
        if (this.graphicsEditor.state.renderData.animations[this.graphicsEditor.state.currentAnimation].length > 1) {
            this.graphicsEditor.state.renderData.animations[this.graphicsEditor.state.currentAnimation].splice(this.graphicsEditor.state.currentFrame, 1);
            
            // Remove the rotation data for the deleted frame
            if (this.graphicsEditor.frameRotations[this.graphicsEditor.state.currentAnimation]) {
                this.graphicsEditor.frameRotations[this.graphicsEditor.state.currentAnimation].splice(this.graphicsEditor.state.currentFrame, 1);
            }
            
            this.graphicsEditor.state.currentFrame = Math.min(this.graphicsEditor.state.currentFrame, this.graphicsEditor.state.renderData.animations[this.graphicsEditor.state.currentAnimation].length - 1);
            this.graphicsEditor.refreshShapes(true);
        }
    }
}