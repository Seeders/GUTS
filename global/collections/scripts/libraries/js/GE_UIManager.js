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
        const modal = document.getElementById('modal-generateIsoSprites');
        modal.classList.add('show');

        // Check if current object has an animation set with saved generator settings
        const currentObject = this.graphicsEditor.gameEditor.getCurrentObject();
        const animationSetName = currentObject?.spriteAnimationSet;
        const collections = this.graphicsEditor.gameEditor.getCollections();
        const animationSet = animationSetName ? collections?.spriteAnimationSets?.[animationSetName] : null;

        // Use saved generator settings from animation set if available, otherwise use defaults
        const savedSettings = animationSet?.generatorSettings || {};
        const config = {
            frustumSize: savedSettings.frustumSize ?? 48,
            distance: savedSettings.cameraDistance ?? 100,
            spriteSize: savedSettings.spriteSize ?? 64,
            animationFPS: savedSettings.fps ?? 4,
            brightness: savedSettings.brightness ?? 2.5,
            palette: savedSettings.palette ?? '',
            borderSize: savedSettings.borderSize ?? 1,
            outlineColor: savedSettings.outlineColor ?? '',
            outlineConnectivity: savedSettings.outlineConnectivity ?? 4,
            cameraHeight: savedSettings.cameraHeight ?? 1.5
        };

        // Populate palette dropdown
        const paletteSelect = document.getElementById('iso-palette');
        // Clear existing options except "None"
        while (paletteSelect.options.length > 1) {
            paletteSelect.remove(1);
        }

        // Add palettes from collections
        const palettes = this.graphicsEditor.gameEditor.getCollections()?.palettes || {};
        Object.keys(palettes).forEach(paletteName => {
            const option = document.createElement('option');
            option.value = paletteName;
            option.textContent = palettes[paletteName].title || paletteName;
            paletteSelect.appendChild(option);
        });

        // Populate outline color dropdown with all palette colors
        const outlineSelect = document.getElementById('iso-outline');
        // Clear existing options except "None" and "Black"
        while (outlineSelect.options.length > 2) {
            outlineSelect.remove(2);
        }

        // Add all colors from all palettes
        Object.entries(palettes).forEach(([paletteName, palette]) => {
            Object.entries(palette).forEach(([colorName, colorValue]) => {
                if (colorName !== 'title' && typeof colorValue === 'string' && colorValue.startsWith('#')) {
                    const option = document.createElement('option');
                    option.value = colorValue;
                    option.textContent = `${palette.title || paletteName} - ${colorName.replace(/Color$/, '')}`;
                    outlineSelect.appendChild(option);
                }
            });
        });

        // Setup brightness slider value display
        const brightnessSlider = document.getElementById('iso-brightness');
        const brightnessValue = document.getElementById('iso-brightness-value');
        brightnessSlider.addEventListener('input', (e) => {
            brightnessValue.textContent = e.target.value;
        });

        // Apply saved config values to form fields
        if (config.frustumSize !== undefined) {
            document.getElementById('iso-frustum').value = config.frustumSize;
        }
        if (config.distance !== undefined) {
            document.getElementById('iso-distance').value = config.distance;
        }
        if (config.spriteSize !== undefined) {
            document.getElementById('iso-size').value = config.spriteSize;
        }
        if (config.animationFPS !== undefined) {
            document.getElementById('iso-fps').value = config.animationFPS;
        }
        if (config.brightness !== undefined) {
            brightnessSlider.value = config.brightness;
            brightnessValue.textContent = config.brightness;
        }
        if (config.palette !== undefined) {
            paletteSelect.value = config.palette;
        }
        if (config.borderSize !== undefined) {
            document.getElementById('iso-pixel-size').value = config.borderSize;
        }
        if (config.outlineColor !== undefined) {
            outlineSelect.value = config.outlineColor;
        }
        if (config.outlineConnectivity !== undefined) {
            document.getElementById('iso-outline-connectivity').value = config.outlineConnectivity;
        }
        if (config.cameraHeight !== undefined) {
            document.getElementById('iso-camera-height').value = config.cameraHeight;
        }

        // Setup save button (disabled initially, enabled after generation)
        const saveButton = document.getElementById('iso-save');
        saveButton.disabled = true;
        saveButton.style.opacity = '0.5';
        saveButton.style.cursor = 'not-allowed';

        // Remove old event listener if exists by cloning and replacing
        const newSaveButton = saveButton.cloneNode(true);
        saveButton.parentNode.replaceChild(newSaveButton, saveButton);

        // Add new event listener
        newSaveButton.addEventListener('click', () => this.saveIsometricSprites());
    }
    async saveIsometricSprites() {
        if (!this.generatedSprites) {
            alert('No sprites to save');
            return;
        }

        // Get the model name from the currently selected object
        const currentObject = this.graphicsEditor.gameEditor.getCurrentObject();
        const modelTitle = currentObject?.title || 'character';
        const baseName = modelTitle.toLowerCase().replace(/[^a-z0-9]/g, '');
        const collectionName = baseName + 'Sprites';

        const directionNames = ['Down', 'DownLeft', 'Left', 'UpLeft', 'Up', 'UpRight', 'Right', 'DownRight'];
        const projectName = this.graphicsEditor.gameEditor.getProjectName();

        // Create a single sprite sheet for all animations
        // First, calculate total dimensions needed
        const animTypes = Object.keys(this.generatedSprites);
        const firstAnimFrames = this.generatedSprites[animTypes[0]];
        const firstSprite = await this.loadImage(firstAnimFrames[0][0]);
        const spriteWidth = firstSprite.width;
        const spriteHeight = firstSprite.height;

        const numDirections = directionNames.length;

        // Calculate max frames across all animations
        let maxFrames = 0;
        for (const animType in this.generatedSprites) {
            maxFrames = Math.max(maxFrames, this.generatedSprites[animType].length);
        }

        // Layout: Each animation type gets a row of (8 directions x N frames)
        // Total height = spriteHeight * numDirections * numAnimTypes
        // Total width = spriteWidth * maxFrames
        const sheetWidth = spriteWidth * maxFrames;
        const sheetHeight = spriteHeight * numDirections * animTypes.length;

        // Create single canvas for all sprites
        const canvas = document.createElement('canvas');
        canvas.width = sheetWidth;
        canvas.height = sheetHeight;
        const ctx = canvas.getContext('2d');

        // Pack all sprites and create metadata
        const spriteMetadata = {};
        let animTypeIndex = 0;

        for (const animType in this.generatedSprites) {
            const frames = this.generatedSprites[animType];
            const numFrames = frames.length;

            spriteMetadata[animType] = { animations: {} };

            for (let dirIndex = 0; dirIndex < numDirections; dirIndex++) {
                const dirName = directionNames[dirIndex];
                const animationName = `${baseName}${animType.charAt(0).toUpperCase() + animType.slice(1)}${dirName}`;
                spriteMetadata[animType].animations[animationName] = [];

                for (let frameIndex = 0; frameIndex < numFrames; frameIndex++) {
                    const spriteData = frames[frameIndex][dirIndex];
                    const img = await this.loadImage(spriteData);

                    // Calculate position in the single sprite sheet
                    const x = frameIndex * spriteWidth;
                    const y = (animTypeIndex * numDirections + dirIndex) * spriteHeight;
                    ctx.drawImage(img, x, y);

                    // Store sprite location metadata
                    spriteMetadata[animType].animations[animationName].push({
                        x,
                        y,
                        width: spriteWidth,
                        height: spriteHeight,
                        frameIndex
                    });
                }
            }

            animTypeIndex++;
        }

        // Get the generation settings used
        const generatorSettings = {
            frustumSize: parseFloat(document.getElementById('iso-frustum').value) || 48,
            cameraDistance: parseFloat(document.getElementById('iso-distance').value) || 100,
            spriteSize: parseFloat(document.getElementById('iso-size').value) || 64,
            fps: parseInt(document.getElementById('iso-fps').value) || 4,
            brightness: parseFloat(document.getElementById('iso-brightness').value) || 2.5,
            palette: document.getElementById('iso-palette').value || '',
            borderSize: parseInt(document.getElementById('iso-pixel-size').value) || 1,
            outlineColor: document.getElementById('iso-outline').value || '',
            outlineConnectivity: parseInt(document.getElementById('iso-outline-connectivity').value) || 8,
            cameraHeight: parseFloat(document.getElementById('iso-camera-height').value) || 1.5
        };

        try {
            // Send single sprite sheet and metadata to server
            const response = await fetch('/api/save-isometric-sprites', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    projectName,
                    baseName,
                    collectionName,
                    spriteSheet: canvas.toDataURL(),
                    spriteMetadata,
                    directionNames,
                    animationFPS: generatorSettings.fps,
                    generatorSettings
                })
            });

            const result = await response.json();
            if (result.success) {
                alert(`Successfully saved ${result.spriteCount} sprites and created all data files!`);
                // Reload collections to show new sprites
                await this.graphicsEditor.gameEditor.fs.syncFromFilesystem();
            } else {
                alert('Error saving sprites: ' + result.error);
            }
        } catch (error) {
            console.error('Error saving sprites:', error);
            alert('Failed to save sprites: ' + error.message);
        }
    }

    loadImage(dataUrl) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = dataUrl;
        });
    }

    displayIsometricSprites(sprites) {
        // Store sprites for saving later
        this.generatedSprites = sprites;

        // Find or create results container in the modal
        const modal = document.getElementById('modal-generateIsoSprites');
        let resultsContainer = document.getElementById('iso-results-container');

        if (!resultsContainer) {
            resultsContainer = document.createElement('div');
            resultsContainer.id = 'iso-results-container';
            resultsContainer.style.cssText = 'margin-top: 20px; padding-top: 20px; border-top: 2px solid #555;';
            modal.querySelector('.modal-content').appendChild(resultsContainer);
        }

        // Clear previous results
        resultsContainer.innerHTML = '';

        // Add results header
        const header = document.createElement('h3');
        header.textContent = 'Generated Sprites';
        header.style.cssText = 'color: #e0e0e0; margin-bottom: 15px;';
        resultsContainer.appendChild(header);

        const angleLabels = ['Down', 'DownLeft', 'Left', 'UpLeft', 'Up', 'UpRight', 'Right', 'DownRight']; // 8 directions

        for (const animType in sprites) {
            const animSection = document.createElement('div');
            const title = document.createElement('h3');
            title.textContent = `${animType} Animation`;
            title.style.color = '#e0e0e0';
            animSection.appendChild(title);

            // Create a container for all angles
            const anglesContainer = document.createElement('div');
            anglesContainer.style.cssText = `margin: 10px 0;`;

            // For each angle (0-7: Down, DownLeft, Left, UpLeft, Up, UpRight, Right, DownRight)
            for (let angle = 0; angle < 8; angle++) {
                const angleSection = document.createElement('div');
                const angleLabel = document.createElement('h4');
                angleLabel.textContent = angleLabels[angle];
                angleLabel.style.cssText = 'color: #ccc; margin: 10px 0 5px 0;';
                angleSection.appendChild(angleLabel);

                const grid = document.createElement('div');
                grid.style.cssText = `
                    display: flex;
                    flex-wrap: wrap;
                    gap: 5px;
                    margin-bottom: 15px;
                `;

                // Add all frames for this specific angle
                sprites[animType].forEach(frame => {
                    const img = document.createElement('img');
                    img.src = frame[angle]; // Get the specific angle's sprite
                    img.style.imageRendering = 'pixelated';
                    grid.appendChild(img);
                });

                angleSection.appendChild(grid);
                anglesContainer.appendChild(angleSection);
            }

            animSection.appendChild(anglesContainer);
            resultsContainer.appendChild(animSection);
        }

        // Enable the save button in the modal
        const saveButton = document.getElementById('iso-save');
        if (saveButton) {
            saveButton.disabled = false;
            saveButton.style.opacity = '1';
            saveButton.style.cursor = 'pointer';
        }

        // Scroll results into view
        resultsContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    
    createGroupInspector(group) {
        console.log('create group inspector', group);
        const inspector = document.getElementById('inspector');
        inspector.innerHTML = "";
        inspector.className = 'inspector editor-module__scroll-y';

        
        this.addFormRow(inspector, 'X Scale', 'number', 'scaleX', group.scale?.x || 1, { min: 0.1, step: 0.1 });
        this.addFormRow(inspector, 'Y Scale', 'number', 'scaleY', group.scale?.y || 1, { min: 0.1, step: 0.1 });
        this.addFormRow(inspector, 'Z Scale', 'number', 'scaleZ', group.scale?.z || 1, { min: 0.1, step: 0.1 });
        // Position inputs
        this.addFormRow(inspector, 'X Position', 'number', 'x', group.position?.x || 0, { step: 0.1 });
        this.addFormRow(inspector, 'Y Position', 'number', 'y', group.position?.y || 0, { step: 0.1 });
        this.addFormRow(inspector, 'Z Position', 'number', 'z', group.position?.z || 0, { step: 0.1 });
        
        // Rotation inputs
        this.addFormRow(inspector, 'X Rotation', 'number', 'rotationX', group.rotation?.x || 0, { step: 1 });
        this.addFormRow(inspector, 'Y Rotation', 'number', 'rotationY', group.rotation?.y || 0, { step: 1 });
        this.addFormRow(inspector, 'Z Rotation', 'number', 'rotationZ', group.rotation?.z || 0, { step: 1 });
        
    }

    createInspector(shape) {
        const inspector = document.getElementById('inspector');
        inspector.innerHTML = "";
        inspector.className = 'inspector editor-module__scroll-y';

        this.addFormRow(inspector, 'Name', 'text', 'name', shape.name || "");
        
        // Type selector
        this.addFormRow(inspector, 'Type', 'select', 'type', shape.type, {
            options: ['cube', 'sphere', 'box', 'cylinder', 'cone', 'torus', 'tetrahedron', 'gltf'],
            change: (e) => {
                let currentShape = this.graphicsEditor.getFrameShape();
                let newValue = e.target.value;
                if (newValue != 'gltf') {
                    delete currentShape.model;
                    delete currentShape.animation;
                }
                currentShape.type = newValue;
                this.graphicsEditor.refreshShapes(false);
            }
        });

        if (shape.type === 'gltf' || shape.model || shape.animation) {
            // Get models and animations from collections
            const collections = this.graphicsEditor.gameEditor.getCollections();
            const models = collections.models || {};
            const animations = collections.animations || {};

            // Model selector
            const modelOptions = ['(none)', ...Object.keys(models).sort()];
            this.addFormRow(inspector, 'Model', 'select', 'model', shape.model || '(none)', {
                options: modelOptions,
                change: (e) => {
                    let currentShape = this.graphicsEditor.getFrameShape();
                    let newValue = e.target.value;
                    if (newValue === '(none)') {
                        delete currentShape.model;
                    } else {
                        currentShape.model = newValue;
                        // Clear animation when setting model
                        delete currentShape.animation;
                    }
                    this.graphicsEditor.refreshShapes(false);
                }
            });

            // Animation selector
            const animationOptions = ['(none)', ...Object.keys(animations).sort()];
            this.addFormRow(inspector, 'Animation', 'select', 'animation', shape.animation || '(none)', {
                options: animationOptions,
                change: (e) => {
                    let currentShape = this.graphicsEditor.getFrameShape();
                    let newValue = e.target.value;
                    if (newValue === '(none)') {
                        delete currentShape.animation;
                    } else {
                        currentShape.animation = newValue;
                        // Don't delete model - both model and animation should coexist
                    }
                    this.graphicsEditor.refreshShapes(false);
                }
            });
        }
        // Color picker
        this.addFormRow(inspector, 'Color', 'color', 'color', shape.color);
        this.addFormRow(inspector, 'Texture', 'texture', 'texture', shape.texture);
        this.addFormRow(inspector, 'Metalness', 'metalness', 'metalness', shape.metalness || 0.5);
        this.addFormRow(inspector, 'Roughness', 'roughness', 'roughness', shape.roughness || 0.5);
        
        this.addFormRow(inspector, 'X Scale', 'number', 'scaleX', shape.scale?.x ?? 1, { min: 0.1, step: 0.1 });
        this.addFormRow(inspector, 'Y Scale', 'number', 'scaleY', shape.scale?.y ?? 1, { min: 0.1, step: 0.1 });
        this.addFormRow(inspector, 'Z Scale', 'number', 'scaleZ', shape.scale?.z ?? 1, { min: 0.1, step: 0.1 });
        // Position inputs
        this.addFormRow(inspector, 'X Position', 'number', 'x', shape.position?.x ?? 0, { step: 0.1 });
        this.addFormRow(inspector, 'Y Position', 'number', 'y', shape.position?.y ?? 0, { step: 0.1 });
        this.addFormRow(inspector, 'Z Position', 'number', 'z', shape.position?.z ?? 0, { step: 0.1 });

        // Rotation inputs
        this.addFormRow(inspector, 'X Rotation', 'number', 'rotationX', shape.rotation?.x ?? 0, { step: 1 });
        this.addFormRow(inspector, 'Y Rotation', 'number', 'rotationY', shape.rotation?.y ?? 0, { step: 1 });
        this.addFormRow(inspector, 'Z Rotation', 'number', 'rotationZ', shape.rotation?.z ?? 0, { step: 1 });
        
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
            input = this.gameEditor.createColorInputGroup(value, 'data-property', property, row, (val, colorName) => {
                if(colorName){
                    this.graphicsEditor.getFrameShape()[property] = { paletteColor: colorName };
                } else {
                    this.graphicsEditor.getFrameShape()[property] = val;
                }
                this.graphicsEditor.refreshShapes(false);
            });            
        } else if(type === "texture") {
            input = this.gameEditor.createTextureInputGroup(value, 'data-property', property, row, (val) => {
                if(val){
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
                if(options.min != undefined) input.min = options.min;
                if(options.max != undefined) input.max = options.max;
                input.step = options.step || 1;
            }
        }
        
        input.addEventListener('change', options.change || ((e) => {
            let newValue = e.target.value;
            if (type === 'number') {
                newValue = parseFloat(newValue);
                // If we're editing a transform property, also update the transform target
                if (this.graphicsEditor.shapeManager.currentTransformTarget && ['x', 'y', 'z', 'rotationX', 'rotationY', 'rotationZ', 'scaleX', 'scaleY', 'scaleZ'].includes(property)) {
                    if (property === 'x') this.graphicsEditor.shapeManager.currentTransformTarget.position.x = newValue;
                    if (property === 'y') this.graphicsEditor.shapeManager.currentTransformTarget.position.y = newValue;
                    if (property === 'z') this.graphicsEditor.shapeManager.currentTransformTarget.position.z = newValue;
                    
                    if (property === 'rotationX') this.graphicsEditor.shapeManager.currentTransformTarget.rotation.x = newValue;
                    if (property === 'rotationY') this.graphicsEditor.shapeManager.currentTransformTarget.rotation.y = newValue;
                    if (property === 'rotationZ') this.graphicsEditor.shapeManager.currentTransformTarget.rotation.z = newValue;
                    
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

    readTransformData(objData, property, value){
        // Handle transform properties
        if (property.startsWith('scale')) {
            if(!objData.scale) objData.scale = {};
            const axis = property.charAt(property.length - 1).toLowerCase();
            if(Number(value) != 1){
                objData.scale[axis] = value;
            } else {
                delete objData.scale[axis];
                if(Object.keys(objData.scale).length == 0) delete objData.scale;
            }
        } else if (property.startsWith('rotation')) {
            if(!objData.rotation) objData.rotation = {};
            const axis = property.charAt(property.length - 1).toLowerCase();
            if(Number(value) != 0){
                objData.rotation[axis] = value;
            } else {
                delete objData.rotation[axis];
                if(Object.keys(objData.rotation).length == 0) delete objData.rotation;
            }            
        } else if (['x', 'y', 'z'].includes(property)) {
            if(!objData.position) objData.position = {};
            const axis = property;
            if(Number(value) != 0){
                objData.position[axis] = value;
            } else {
                delete objData.position[axis];
                if(Object.keys(objData.position).length == 0) delete objData.position;
            }
        }
        delete objData[property];
    }

    updatePropertyValue(property, value) {
        const shapeData = this.graphicsEditor.getFrameShape();
        if (shapeData) {
            // Handle transform properties            
            this.readTransformData(shapeData, property, value);
        } else {
            let groupData = this.graphicsEditor.getCurrentGroup();
            if(!groupData){
                groupData = {};
                let currentFrame = this.graphicsEditor.getCurrentFrame();
                if(currentFrame) {
                    currentFrame[this.graphicsEditor.state.currentGroup] = groupData;
                }
            }                    
            this.readTransformData(groupData, property, value);
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
        animSelector.addEventListener('change', async (e) => {
            this.graphicsEditor.setPreviewAnimationState(false);
            if(e.target.value == '__model__'){
                this.graphicsEditor.state.editingModel = true;
                this.graphicsEditor.state.currentAnimation = "";
                this.graphicsEditor.state.currentFrame = 0;
                this.graphicsEditor.refreshShapes(false);
            } else {
                this.graphicsEditor.state.editingModel = false;
                const newAnimation = animSelector.value;

                // Try to switch animation without rebuilding scene (for GLTF models)
                const switched = await this.graphicsEditor.switchAnimation(newAnimation);

                if (switched) {
                    // Successfully switched animation, just update state
                    this.graphicsEditor.state.currentAnimation = newAnimation;
                    this.graphicsEditor.state.currentFrame = 0;
                    this.updateList(); // Update UI only
                } else {
                    // Fall back to full refresh (for non-GLTF or if switch failed)
                    this.graphicsEditor.state.currentAnimation = newAnimation;
                    this.graphicsEditor.state.currentFrame = 0;
                    this.graphicsEditor.refreshShapes(false);
                }
            }
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