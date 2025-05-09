class GE_ShapeManager {
    constructor(gameEditor, graphicsEditor) {
        this.gameEditor = gameEditor;
        this.graphicsEditor = graphicsEditor;
        this.originalMaterials = new Map();
        
    }    

    init() {   
        this.initEventListeners();

    }
    initEventListeners() {
        // Button event listeners
        const buttonMappings = {
            'add-shape': this.addSelectedShape.bind(this),
            'delete-shape': this.deleteSelectedShape.bind(this)
        };
        Object.entries(buttonMappings).forEach(([id, handler]) => {
            const button = document.getElementById(id);
            if (button) button.addEventListener('click', handler);
        });
        
        document.getElementById('move-cancel').addEventListener('click', () => {            
            const inspector = document.getElementById('inspector');
            inspector.innerHTML = ``;
        });
    }
    getShapeData(shapeId){
        let currentGroup = this.graphicsEditor.getCurrentGroup();
        if(!currentGroup){
            currentGroup = { shapes: [] };
            let currentAnimation = this.graphicsEditor.getCurrentAnimation();
            let currentFrame = currentAnimation[this.graphicsEditor.state.currentFrame];
            if(!currentFrame){
                currentFrame = {};
            }
            currentFrame[this.graphicsEditor.state.currentGroup] = currentGroup;
            currentAnimation[this.graphicsEditor.state.currentFrame] = currentFrame;
        }
        currentGroup.shapes = currentGroup.shapes || [];
        if(currentGroup.shapes.length == 0){
            let shapeData = JSON.parse(JSON.stringify(this.graphicsEditor.state.renderData.model[this.graphicsEditor.state.currentGroup])).shapes[shapeId];
            shapeData.id = shapeId;
            currentGroup.shapes = [shapeData];
            return shapeData;
        }
        let shapeData = (currentGroup.shapes).find(s => s.id == shapeId);
        if(this.graphicsEditor.state.editingModel){
            shapeData = currentGroup.shapes[shapeId];
        }
        return shapeData;
    }
    selectShape(index) {
        if (this.graphicsEditor.animationManager.isPreviewingAnimation) {
            this.graphicsEditor.setPreviewAnimationState(false);
        }
        
        // Toggle selection if clicking the same shape
        this.graphicsEditor.state.selectedShapeIndex = (this.graphicsEditor.state.selectedShapeIndex === index) ? -1 : index;

        // Update shape list and highlighting
        this.graphicsEditor.uiManager.updateList();
        // Show inspector for selected shape
        const shape = this.graphicsEditor.getMergedShape();
        if (shape) {
            this.graphicsEditor.createInspector(shape);
            this.graphicsEditor.gizmoManager.transformSelectedObject();
        } else {
            this.graphicsEditor.gizmoManager.destroyGizmo();
            this.graphicsEditor.groupManager.selectGroup(this.graphicsEditor.state.currentGroup);
        }
    }
    addNewShape() {
        if(!this.graphicsEditor.state.editingModel) {            
            return;
        }
        const newShape = {
            type: 'sphere',
            size: 2,
            color: '#ff0000',
            x: 0,
            y: 0,
            z: 0,
            rotationX: 0,
            rotationY: 0,
            rotationZ: 0
        };
        this.graphicsEditor.getCurrentGroup().shapes.push(newShape);
        this.graphicsEditor.state.selectedShapeIndex = this.graphicsEditor.getCurrentGroup().shapes.length - 1;
        this.graphicsEditor.refreshShapes(true); 
    }

    addSelectedShape() {
        if(!this.graphicsEditor.state.editingModel) {            
            return;
        }
        if (this.graphicsEditor.state.selectedShapeIndex >= 0) {
            const originalShape = this.graphicsEditor.state.editingModel ? 
                                    this.graphicsEditor.getCurrentGroup().shapes[this.graphicsEditor.state.selectedShapeIndex] : 
                                    this.graphicsEditor.getCurrentGroup().shapes.find(s => s.id == this.graphicsEditor.state.selectedShapeIndex);
            const newShape = JSON.parse(JSON.stringify(originalShape));
            this.graphicsEditor.getCurrentGroup().shapes.push(newShape);
            this.graphicsEditor.state.selectedShapeIndex = this.graphicsEditor.getCurrentGroup().shapes.length - 1;
            this.graphicsEditor.refreshShapes(true);
        } else {
            this.addNewShape();
        }
    }

    deleteSelectedShape() {
        if(!this.graphicsEditor.state.editingModel) {            
            return;
        }
        if (this.graphicsEditor.state.selectedShapeIndex >= 0) {
            this.graphicsEditor.getCurrentGroup().shapes.splice(this.graphicsEditor.state.selectedShapeIndex, 1);
            if (this.graphicsEditor.getCurrentGroup().shapes.length > 0) {
                this.graphicsEditor.state.selectedShapeIndex = Math.min(this.graphicsEditor.state.selectedShapeIndex, this.graphicsEditor.getCurrentGroup().shapes.length - 1);
            } else {
                this.graphicsEditor.state.selectedShapeIndex = -1;
            }
            this.graphicsEditor.refreshShapes(true);
        }
    }

}