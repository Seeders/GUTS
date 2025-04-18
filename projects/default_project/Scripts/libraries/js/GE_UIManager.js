class GE_UIManager {
    constructor(gameEditor, graphicsEditor) {
        this.gameEditor = gameEditor;
        this.graphicsEditor = graphicsEditor;
        this.mouse = new window.THREE.Vector2();
        this.raycaster = new window.THREE.Raycaster();
        this.isDragging = false;
        this.clickStartTime = 0;
    }    
     

    init() {   
        this.initEventListeners();
    }
    
    
    
    initEventListeners() {
        // Button event listeners
        const buttonMappings = {
            'generate-isometric': this.showIsometricModal.bind(this),
        };
        Object.entries(buttonMappings).forEach(([id, handler]) => {
            const button = document.getElementById(id);
            if (button) button.addEventListener('click', handler);
        });

        // Canvas interaction
        this.graphicsEditor.canvas.addEventListener('mousedown', this.handleMouseDown.bind(this));
        this.graphicsEditor.canvas.addEventListener('mousemove', this.handleMouseMove.bind(this));
        this.graphicsEditor.canvas.addEventListener('mouseup', this.handleMouseUp.bind(this));

        // Additional event listeners

        
        // Move modal listeners

        // Isometric modal listeners
        document.getElementById('iso-cancel').addEventListener('click', () => {
            document.getElementById('modal-generateIsoSprites').classList.remove('show');
        });
    }
    handleMouseDown(event) {
        this.isDragging = false;
        this.clickStartTime = Date.now();
    }

    handleMouseMove() {
        if (Date.now() - this.clickStartTime > 100) {
            this.isDragging = true;
        }
    }

    handleMouseUp(event) {
        if (this.isDragging) return;
    
        const rect = this.graphicsEditor.canvas.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / this.graphicsEditor.canvas.clientWidth) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / this.graphicsEditor.canvas.clientHeight) * 2 + 1;
    
        this.raycaster.setFromCamera(this.mouse, this.graphicsEditor.sceneRenderer.camera);
    
        // Instead of looking only at scene.children, search through all descendant meshes
        const meshes = [];
        this.graphicsEditor.rootGroup.traverse(obj => {
            if (obj.isMesh && obj.userData.isShape) {
                meshes.push(obj);
            }
        });
    
        const intersects = this.raycaster.intersectObjects(meshes, true);
    
        if (intersects.length > 0) {
            // Find the parent mesh with the isShape flag if we've hit a child mesh
            let hitObject = intersects[0].object;
            while (hitObject && !hitObject.userData.isShape) {
                hitObject = hitObject.parent;
            }
            
            if (hitObject && hitObject.userData.index !== undefined) {
                this.graphicsEditor.selectShape(hitObject.userData.index);
            }
        }
    }
    

    showIsometricModal() {
        document.getElementById('modal-generateIsoSprites').classList.add('show');
    }
    displayIsometricSprites(sprites) {
        const modal = document.createElement('div');
        modal.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%; 
            background-color: rgba(0, 0, 0, 0.7); z-index: 1000; 
            display: flex; align-items: center; justify-content: center;
        `;
        const content = document.createElement('div');
        content.style.cssText = `
            background: #333; padding: 20px; border-radius: 8px; 
            max-width: 80%; max-height: 80%; overflow: auto;
        `;
    
        const angleLabels = ['NE', 'N', 'NW', 'W', 'SW', 'S', 'SE', 'E']; // Labels for 8 angles
    
        for (const animType in sprites) {
            const animSection = document.createElement('div');
            const title = document.createElement('h3');
            title.textContent = `${animType} Animation`;
            title.style.color = '#e0e0e0';
            animSection.appendChild(title);
    
            // Create a container for all angles
            const anglesContainer = document.createElement('div');
            anglesContainer.style.cssText = `margin: 10px 0;`;
    
            // For each angle (0-7)
            for (let angle = 0; angle < 8; angle++) {
                const angleSection = document.createElement('div');
    
                const grid = document.createElement('div');
                grid.style.cssText = `
                    display: grid; 
                    grid-template-columns: repeat(${Math.min(sprites[animType].length, 4)}, 1fr); 
                    gap: 5px; 
                    margin-bottom: 15px;
                `;
    
                // Add all frames for this specific angle
                sprites[animType].forEach(frame => {
                    const img = document.createElement('img');
                    img.src = frame[angle]; // Get the specific angle's sprite
                    img.style.maxWidth = '100%';
                    grid.appendChild(img);
                });
    
                angleSection.appendChild(grid);
                anglesContainer.appendChild(angleSection);
            }
    
            animSection.appendChild(anglesContainer);
            content.appendChild(animSection);
        }
    
        const closeButton = document.createElement('button');
        closeButton.textContent = 'Close';
        closeButton.style.cssText = `
            margin-top: 20px; padding: 8px 16px; background-color: #4CAF50; 
            color: #fff; border: none; border-radius: 6px; cursor: pointer;
        `;
        closeButton.addEventListener('click', () => document.body.removeChild(modal));
        content.appendChild(closeButton);
        modal.appendChild(content);
        document.body.appendChild(modal);
    }
    
    createGroupInspector(group) {
        console.log('create group inspector', group);
        const inspector = document.getElementById('inspector');
        inspector.innerHTML = "";
        inspector.className = 'inspector';

        
        this.addFormRow(inspector, 'X Scale', 'number', 'scaleX', group.scale.x || 1, { min: 0.1, step: 0.1 });
        this.addFormRow(inspector, 'Y Scale', 'number', 'scaleY', group.scale.y || 1, { min: 0.1, step: 0.1 });
        this.addFormRow(inspector, 'Z Scale', 'number', 'scaleZ', group.scale.z || 1, { min: 0.1, step: 0.1 });
        // Position inputs
        this.addFormRow(inspector, 'X Position', 'number', 'x', group.position.x || 0, { step: 0.1 });
        this.addFormRow(inspector, 'Y Position', 'number', 'y', group.position.y || 0, { step: 0.1 });
        this.addFormRow(inspector, 'Z Position', 'number', 'z', group.position.z || 0, { step: 0.1 });
        
        // Rotation inputs
        this.addFormRow(inspector, 'X Rotation', 'number', 'rotationX', group.rotation.x || 0, { step: 5 });
        this.addFormRow(inspector, 'Y Rotation', 'number', 'rotationY', group.rotation.y || 0, { step: 5 });
        this.addFormRow(inspector, 'Z Rotation', 'number', 'rotationZ', group.rotation.z || 0, { step: 5 });
        
    }

    createInspector(shape) {
        console.log('create shape inspector', shape);
        const inspector = document.getElementById('inspector');
        inspector.innerHTML = "";
        inspector.className = 'inspector';

        this.addFormRow(inspector, 'Name', 'text', 'name', shape.name || "");
        
        // Type selector
        this.addFormRow(inspector, 'Type', 'select', 'type', shape.type, {
            options: ['cube', 'sphere', 'box', 'cylinder', 'cone', 'torus', 'tetrahedron', 'gltf'],
            change: (e) => {
                let currentShape = this.graphicsEditor.getFrameShape();
                let newValue = e.target.value;
                if (newValue != 'gltf') {
                    delete currentShape.url
                }                 
                currentShape.type = newValue;
                this.graphicsEditor.refreshShapes(false);
            }
        });
        
        if (shape.type === 'gltf') {            
            let input = this.addFormRow(inspector, 'Model', 'file', 'url', shape.url, { 'change' :  async (e) => {
                e.preventDefault();

                // Get the file from the input element
                const file = e.target.files[0]; // Access the file object
                if (!file) {
                    console.error('No file selected');
                    return;
                }
                // // Create FormData and append the file
                 const formData = new FormData();
                 formData.append('gltfFile', file); // 'gltfFile' matches the multer.single('gltfFile') on the server

                try {
                     const response = await fetch('/upload-model', {
                         method: 'POST',
                         body: formData // Send the FormData with the file
                     });

                     const result = await response.json();
                     shape.url = result.filePath; 
                     this.graphicsEditor.getFrameShape().url = result.filePath;
                     this.graphicsEditor.refreshShapes(false);
                } catch (error) {
                     console.error('Error uploading file:', error);
                }
            }});
            input.setAttribute("accept",".gltf");
        }
        // Color picker
        this.addFormRow(inspector, 'Color', 'color', 'color', shape.color);
        
        this.addFormRow(inspector, 'X Scale', 'number', 'scaleX', shape.scaleX || 1, { min: 0.1, step: 0.1 });
        this.addFormRow(inspector, 'Y Scale', 'number', 'scaleY', shape.scaleY || 1, { min: 0.1, step: 0.1 });
        this.addFormRow(inspector, 'Z Scale', 'number', 'scaleZ', shape.scaleZ || 1, { min: 0.1, step: 0.1 });
        // Position inputs
        this.addFormRow(inspector, 'X Position', 'number', 'x', shape.x || 0, { step: 0.1 });
        this.addFormRow(inspector, 'Y Position', 'number', 'y', shape.y || 0, { step: 0.1 });
        this.addFormRow(inspector, 'Z Position', 'number', 'z', shape.z || 0, { step: 0.1 });
        
        // Rotation inputs
        this.addFormRow(inspector, 'X Rotation', 'number', 'rotationX', shape.rotationX || 0, { step: 5 });
        this.addFormRow(inspector, 'Y Rotation', 'number', 'rotationY', shape.rotationY || 0, { step: 5 });
        this.addFormRow(inspector, 'Z Rotation', 'number', 'rotationZ', shape.rotationZ || 0, { step: 5 });
        
        // Size inputs
        if (['cube', 'sphere', 'tetrahedron', 'torus'].includes(shape.type)) {
            this.addFormRow(inspector, 'Size', 'number', 'size', shape.size || 2, { min: 0.1, step: 0.1 });
        }
        
        if (shape.type === 'box') {
            this.addFormRow(inspector, 'Width', 'number', 'width', shape.width || 2, { min: 0.1, step: 0.1 });
            this.addFormRow(inspector, 'Height', 'number', 'height', shape.height || 2, { min: 0.1, step: 0.1 });
            this.addFormRow(inspector, 'Depth', 'number', 'depth', shape.depth || 2, { min: 0.1, step: 0.1 });
        }
        
        if (['cylinder', 'cone'].includes(shape.type)) {
            this.addFormRow(inspector, 'Size', 'number', 'size', shape.size || 2, { min: 0.1, step: 0.1 });
            this.addFormRow(inspector, 'Height', 'number', 'height', shape.height || 3, { min: 0.1, step: 0.1 });
        }
        
        if (shape.type === 'torus') {
            this.addFormRow(inspector, 'Tube Size', 'number', 'tubeSize', shape.tubeSize || shape.size / 6, { min: 0.1, step: 0.1 });
        }
    }


    addFormRow(container, label, type, property, value, options = {}) {
        const row = document.createElement('div');
        row.className = 'form-row';
        
        const labelElement = document.createElement('label');
        labelElement.textContent = label;
        row.appendChild(labelElement);
        
        let input;
        
        if (type === 'select') {
            input = document.createElement('select');
            input.setAttribute('data-property', property);
            (options.options || []).forEach(optionValue => {
                const option = document.createElement('option');
                option.value = optionValue;
                option.textContent = optionValue;
                if (value === optionValue) {
                    option.selected = true;
                }
                input.appendChild(option);
            });
        } else if(type === "color") {
            input = this.gameEditor.createColorInputGroup(value, property, row, (val, colorName) => {
                if(colorName){
                    this.graphicsEditor.getFrameShape()[property] = { paletteColor: colorName };
                } else {
                    this.graphicsEditor.getFrameShape()[property] = val;
                }
                this.graphicsEditor.refreshShapes(false);
            });            
        } else if(type === "file") {
            let inputContainer = document.createElement('div');
            inputContainer.style = "flex: 1; display: flex; flex-direction: column; font-size: .75em;";
            input = document.createElement('input');
            input.style = "width: calc(100% - 18px);"
            input.type = type;
            input.setAttribute('data-property', property);
            inputContainer.appendChild(input);
            if( value ) {
                let urlName = document.createElement('span');
                urlName.innerText = value;            
                inputContainer.appendChild(urlName);
            }
            row.appendChild(inputContainer);
            container.appendChild(row);
            input.addEventListener('change', options.change );
            return input;
        } else {
            input = document.createElement('input');
            input.type = type;
            input.value = value;
            input.setAttribute('data-property', property);
            
            if (type === 'number') {
                input.min = options.min !== undefined ? options.min : -64;
                input.max = options.max !== undefined ? options.max : 64;
                input.step = options.step || 1;
            }
        }
        
        input.addEventListener('change', options.change || ((e) => {
            let newValue = e.target.value;
            if (type === 'number') {
                newValue = parseFloat(newValue);
                console.log('change', this.graphicsEditor.shapeManager.currentTransformTarget);
                // If we're editing a transform property, also update the transform target
                if (this.graphicsEditor.shapeManager.currentTransformTarget && ['x', 'y', 'z', 'rotationX', 'rotationY', 'rotationZ', 'scaleX', 'scaleY', 'scaleZ'].includes(property)) {
                    if (property === 'x') this.graphicsEditor.shapeManager.currentTransformTarget.position.x = newValue;
                    if (property === 'y') this.graphicsEditor.shapeManager.currentTransformTarget.position.y = newValue;
                    if (property === 'z') this.graphicsEditor.shapeManager.currentTransformTarget.position.z = newValue;
                    
                    if (property === 'rotationX') this.graphicsEditor.shapeManager.currentTransformTarget.rotation.x = this.graphicsEditor.rotationUtils.degToRad(newValue);
                    if (property === 'rotationY') this.graphicsEditor.shapeManager.currentTransformTarget.rotation.y = this.graphicsEditor.rotationUtils.degToRad(newValue);
                    if (property === 'rotationZ') this.graphicsEditor.shapeManager.currentTransformTarget.rotation.z = this.graphicsEditor.rotationUtils.degToRad(newValue);
                    
                    if (property === 'scaleX') this.graphicsEditor.shapeManager.currentTransformTarget.scale.x = newValue;
                    if (property === 'scaleY') this.graphicsEditor.shapeManager.currentTransformTarget.scale.y = newValue;
                    if (property === 'scaleZ') this.graphicsEditor.shapeManager.currentTransformTarget.scale.z = newValue;
                    
                    // Update gizmo position after directly changing values
                }
            } else if(type === 'file') {
                return;
            }
            
            this.updatePropertyValue(property, newValue);
            this.graphicsEditor.refreshShapes(false);
        }));
        
        row.appendChild(input);
        container.appendChild(row);
        return input;
    }
    updatePropertyValue(property, value) {
        const shapeData = this.graphicsEditor.getFrameShape();
        if (shapeData) {
            shapeData[property] = value;
            return;
        }
        let groupData = this.graphicsEditor.getCurrentGroup();
        if(!groupData){
            groupData = {};
            let currentFrame = this.graphicsEditor.getCurrentFrame();
            if(currentFrame) {
                currentFrame[this.graphicsEditor.state.currentGroup] = groupData;
            }
        }
        
        // Handle transform properties
        if (property.startsWith('scale')) {
            if(!groupData.scale) groupData.scale = {};
            const axis = property.charAt(property.length - 1).toLowerCase();
            groupData.scale[axis] = value;
        } else if (property.startsWith('rotation')) {
            if(!groupData.rotation) groupData.rotation = {};
            const axis = property.charAt(property.length - 1).toLowerCase();
            groupData.rotation[axis] = value;
        } else if (['x', 'y', 'z'].includes(property)) {
            if(!groupData.position) groupData.position = {};
            groupData.position[property] = value;
        }
    }

  

    updateList() {
        const frameList = document.getElementById('frame-list');
        frameList.innerHTML = '';
        const groupList = document.getElementById('group-list');
        groupList.innerHTML = '';
        const shapeList = document.getElementById('shape-list');
        shapeList.innerHTML = '';
        this.updateFrameList();
        this.graphicsEditor.groupManager.updateGroupList();
        this.updateShapeList();
    }

    updateFrameList() {
        const list = document.getElementById('frame-list');
        // Animation selector
        const animSelector = document.createElement('select');
        animSelector.style.marginBottom = '10px';

        const option = document.createElement('option');
        option.value = '__model__';
        option.textContent = 'model';
        if (this.graphicsEditor.state.editingModel) option.selected = true;
        animSelector.appendChild(option);


        Object.keys(this.graphicsEditor.state.renderData.animations).forEach(anim => {
            const option = document.createElement('option');
            option.value = anim;
            option.textContent = anim;
            if (anim === this.graphicsEditor.state.currentAnimation) option.selected = true;
            animSelector.appendChild(option);
        });
        animSelector.addEventListener('change', (e) => {
            this.graphicsEditor.setPreviewAnimationState(false);
            if(e.target.value == '__model__'){
                this.graphicsEditor.state.editingModel = true;
                this.graphicsEditor.state.currentAnimation = "";                
            } else {
                this.graphicsEditor.state.editingModel = false;
                this.graphicsEditor.state.currentAnimation = animSelector.value;                
            }
            this.graphicsEditor.state.currentFrame = 0;
            this.graphicsEditor.refreshShapes(false);
            requestAnimationFrame(() => {
                this.graphicsEditor.state.selectedShapeIndex = -1;
                this.graphicsEditor.shapeManager.selectShape(0);
            })
        });
        list.appendChild(animSelector);
        if(this.graphicsEditor.state.editingModel) return;
        // Frame list
        const frameList = document.createElement('div');
        frameList.style.marginBottom = '10px';
        this.graphicsEditor.getCurrentAnimation().forEach((frame, index) => {
            const frameItem = document.createElement('div');
            frameItem.textContent = `Frame ${index + 1}`;
            frameItem.style.padding = '5px';
            frameItem.style.cursor = 'pointer';
            if (index === this.graphicsEditor.state.currentFrame) frameItem.style.backgroundColor = '#555';
            frameItem.addEventListener('click', () => {
                this.graphicsEditor.setPreviewAnimationState(false);
                this.graphicsEditor.state.currentFrame = index;  
                this.graphicsEditor.refreshShapes(false);
                requestAnimationFrame(() => {  
                    this.graphicsEditor.state.selectedShapeIndex = -1;
                    this.graphicsEditor.shapeManager.selectShape(0);
                })
            });
            frameList.appendChild(frameItem);
        });
        list.appendChild(frameList);
    }


    updateShapeList() {
        const list = document.getElementById('shape-list');
        if (!list) return;
        

        // Get shapes from the currently selected group
        const currentGroup = this.graphicsEditor.state.currentGroup;
        const selectedGroup = this.graphicsEditor.getMergedGroup(currentGroup);
        const shapes = selectedGroup && selectedGroup.shapes ? selectedGroup.shapes : selectedGroup || [];
       
        // Create shape list items
        for (let i = 0; i < shapes.length; i++) {
            const shape = shapes[i];
            if (!shape) continue;
           
            const shapeItem = document.createElement('div');
            shapeItem.classList.add('shape-item');
           
            // Mark as selected if this shape is the selected one and we're in the right group
            if (i === this.graphicsEditor.state.selectedShapeIndex) {
                shapeItem.classList.add('selected');
            }
           
            shapeItem.textContent = `${shape.name} - ${shape.type || 'Shape'}`;
            shapeItem.addEventListener('click', (e) => {               
                this.graphicsEditor.shapeManager.selectShape(parseInt(e.target.dataset.index));
            });
           
            // Make the shape draggable
            shapeItem.draggable = true;
            shapeItem.dataset.index = i;
            shapeItem.dataset.group = currentGroup;
            
            // Add dragstart event to set the drag data
            shapeItem.addEventListener('dragstart', (e) => {
                // Store only the selected shape's index and source group
                const data = {
                    shapeIndex: i,
                    sourceGroup: currentGroup
                };
                
                // Set the drag data
                e.dataTransfer.setData('text/plain', JSON.stringify(data));
                
                // Add a visual indicator
                shapeItem.classList.add('dragging');
                
                // Set drag effect
                e.dataTransfer.effectAllowed = 'move';
            });
            
            // Add dragend event to clean up
            shapeItem.addEventListener('dragend', () => {
                shapeItem.classList.remove('dragging');
            });
           
            list.appendChild(shapeItem);
        }
        
        // Set up the shape list container as a drop target
        list.addEventListener('dragover', (e) => {
            // Only respond if we're dragging over the shape list itself, not an individual shape
            if (e.target === list) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                list.classList.add('drag-over');
            }
        });
        
        list.addEventListener('dragleave', (e) => {
            // Only respond if we're leaving the shape list
            if (e.target === list) {
                list.classList.remove('drag-over');
            }
        });
        
        list.addEventListener('drop', (e) => {
            e.preventDefault();
            list.classList.remove('drag-over');
            
            const data = e.dataTransfer.getData('text/plain');
            if (!data) return;
            
            try {
                const dragData = JSON.parse(data);
                const { shapeIndex, sourceGroup } = dragData;
                
                // Only process if this is a different group
                if (sourceGroup && sourceGroup !== currentGroup) {
                    this.graphicsEditor.groupManager.moveToGroup(
                        parseInt(shapeIndex),
                        sourceGroup,
                        currentGroup
                    );
                }
            } catch (err) {
                console.error('Error processing drop in shape list:', err);
            }
        });
    }

}