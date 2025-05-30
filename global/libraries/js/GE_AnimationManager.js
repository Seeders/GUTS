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
            'add-frame': this.addFrame.bind(this),
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
            this.graphicsEditor.gizmoManager.destroyGizmo();
        } else {
            this.graphicsEditor.state.currentFrame = 0;
            btn.classList.remove("active");
        }
    }

    async animatePreview() {
        if (!this.isPreviewingAnimation) return;
        this.graphicsEditor.state.currentFrame = (this.graphicsEditor.state.currentFrame + 1) % this.graphicsEditor.getCurrentAnimation().length;
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
            this.graphicsEditor.refreshShapes(true);
        }
    }

    deleteAnimation() {
        if (this.graphicsEditor.state.currentAnimation !== "idle") {
            delete this.graphicsEditor.getCurrentAnimation();
            this.graphicsEditor.state.currentAnimation = "idle";
            this.graphicsEditor.state.currentFrame = 0;
            this.graphicsEditor.state.selectedShapeIndex = -1;
            this.graphicsEditor.refreshShapes(true);
        }
    }

    addFrame() {

        let currentFrame = this.graphicsEditor.getCurrentFrame();
        if(!currentFrame){
            currentFrame = {};
        }
        const newFrame = { shapes: JSON.parse(JSON.stringify(currentFrame.shapes || [])) };
        this.graphicsEditor.getCurrentAnimation().splice(this.graphicsEditor.state.currentFrame + 1, 0, newFrame);                    
        this.graphicsEditor.state.currentFrame++;
        this.graphicsEditor.refreshShapes(true);
    
    }

    deleteFrame() {
        let currentAnimation = this.graphicsEditor.getCurrentAnimation();
        if (currentAnimation.length > 1) {
            currentAnimation.splice(this.graphicsEditor.state.currentFrame, 1);
            
            this.graphicsEditor.state.currentFrame = Math.min(this.graphicsEditor.state.currentFrame, currentAnimation.length - 1);
            this.graphicsEditor.refreshShapes(true);
        }
    }
}