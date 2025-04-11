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
    
    
    createInspector(shape) {
        const inspector = document.getElementById('inspector');
        inspector.innerHTML = "";
        inspector.className = 'inspector';

        this.addFormRow(inspector, 'Name', 'text', 'name', shape.name || "");
        
        // Type selector
        this.addFormRow(inspector, 'Type', 'select', 'type', shape.type, {
            options: ['cube', 'sphere', 'box', 'cylinder', 'cone', 'torus', 'tetrahedron', 'gltf'],
            change: (e) => {
        
                let newValue = e.target.value;
                if (newValue != 'gltf') {
                    delete this.graphicsEditor.state.renderData.animations[this.graphicsEditor.state.currentAnimation][this.graphicsEditor.state.currentFrame].shapes[this.graphicsEditor.state.selectedShapeIndex].url
                } 
                
                this.graphicsEditor.state.renderData.animations[this.graphicsEditor.state.currentAnimation][this.graphicsEditor.state.currentFrame].shapes[this.graphicsEditor.state.selectedShapeIndex]['type'] = newValue;
                this.graphicsEditor.refreshShapes(false);
            }
        });
        
        if (shape.type === 'gltf') {
            let property = 'url';
            let input = this.addFormRow(inspector, 'Model', 'file', property, shape.url, { 'change' :  async (e) => {
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
                     this.graphicsEditor.state.renderData.animations[this.graphicsEditor.state.currentAnimation][this.graphicsEditor.state.currentFrame].shapes[this.graphicsEditor.state.selectedShapeIndex][property] = result.filePath;
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
            input = document.createElement('input');
            input.type = "text";
            input.value = value;
            let colorInput = document.createElement('input');
            colorInput.type = "color";
            colorInput.value = value;

            colorInput.addEventListener('change', () => {
                let newValue = colorInput.value;                
                this.graphicsEditor.state.renderData.animations[this.graphicsEditor.state.currentAnimation][this.graphicsEditor.state.currentFrame].shapes[this.graphicsEditor.state.selectedShapeIndex][property] = newValue;
                this.graphicsEditor.refreshShapes(true);
            });
            row.appendChild(colorInput);
        } else if(type === "file") {
            let inputContainer = document.createElement('div');
            inputContainer.style = "flex: 1; display: flex; flex-direction: column; font-size: .75em;";
            input = document.createElement('input');
            input.style = "width: calc(100% - 18px);"
            input.type = type;
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
            } else if(type === 'file') {
                return;
            }
            
            this.graphicsEditor.state.renderData.animations[this.graphicsEditor.state.currentAnimation][this.graphicsEditor.state.currentFrame].shapes[this.graphicsEditor.state.selectedShapeIndex][property] = newValue;
            this.graphicsEditor.refreshShapes(false);
        }));
        
        row.appendChild(input);
        container.appendChild(row);
        return input;
    }
}