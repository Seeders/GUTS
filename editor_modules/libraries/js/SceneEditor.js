class SceneEditor {
    constructor(gameEditor, config, {ShapeFactory}) {
        this.gameEditor = gameEditor;
        this.config = config;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.clock = new window.THREE.Clock();
        this.canvas = document.getElementById('scene-editor-canvas');
        this.state = {
            sceneData: {},
            selectedEntityIndex: -1,
            entities: []
        };
        this.elements = {
            hierarchy: document.getElementById('scene-hierarchy'),
            inspector: document.getElementById('scene-inspector'),
            noSelection: document.getElementById('scene-noSelection'),
            entityInspector: document.getElementById('scene-entityInspector'),
            components: document.getElementById('scene-components'),
        } 
        let skeleUtils = new (this.gameEditor.editorModuleClasses['Three_SkeletonUtils'])();
        this.shapeFactory = new ShapeFactory(this.gameEditor.getPalette(), this.gameEditor.getCollections().textures, null, skeleUtils);
        this.nextEntityId = 1;
        this.initThreeJS(this.canvas);
        this.initEventListeners();
        this.animate();
        this.addSampleEntities();
    }

    initEventListeners() {
        document.body.addEventListener('renderSceneObject', this.handleRenderSceneObject.bind(this));
        document.body.addEventListener('resizedEditor', () => { 
            this.canvas.width = this.gameEditor.getCollections().configs.game.canvasWidth;
            this.canvas.height = this.gameEditor.getCollections().configs.game.canvasHeight;
            this.canvas.setAttribute('style','');
            this.handleResize();  
            this.refreshScene(false); 
        });
    }

    initThreeJS(canvas) {
        // Scene setup
        this.scene = new window.THREE.Scene();
        this.rootGroup = new window.THREE.Group(); // Main container for all shapes
        this.rootGroup.name = "rootGroup";
        this.scene.add(this.rootGroup);
        // Camera setup
        this.camera = new window.THREE.PerspectiveCamera(
            75, 
            canvas.clientWidth / canvas.clientHeight, 
            0.1, 
            1000
        );
        this.camera.position.set(100, 100, 100);
        this.camera.lookAt(0, 0, 0);

        // Renderer setup
        this.renderer = new window.THREE.WebGLRenderer({ 
            canvas: canvas, 
            antialias: false, 
            alpha: true 
        });
        this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);

        // Add helpers
        const gridHelper = new window.THREE.GridHelper(1000, 100);
        this.scene.add(gridHelper);

        const axesHelper = new window.THREE.AxesHelper(10);
        this.scene.add(axesHelper);

        // Orbit controls
        this.controls = new window.THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.25;

        //Light
        const ambientLight = new window.THREE.AmbientLight(0xffffff, 0.6);
        ambientLight.name = 'ambient-light';
        this.scene.add(ambientLight);
    
        const directionalLight = new window.THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(50, 100, 75);
        directionalLight.name = 'dir-light';
        this.scene.add(directionalLight);

        // Resize handling
        window.addEventListener('resize', this.handleResize.bind(this));
    }
    
    handleRenderSceneObject(event) {
        this.canvas.width = this.gameEditor.getCollections().configs.game.canvasWidth;
        this.canvas.height = this.gameEditor.getCollections().configs.game.canvasHeight;
        this.canvas.setAttribute('style','');
        this.state.sceneData = event.detail.data;        
        this.clearScene();
        this.addSampleEntities();
        this.handleResize();
        this.clock = new window.THREE.Clock();
        this.clock.start(); 
        requestAnimationFrame(() => {
            this.state.selectedEntityIndex = -1;
        });
    }
    animate() {
        requestAnimationFrame(this.animate.bind(this));
        this.controls.update();
        
        // Calculate delta once per frame
        const delta = this.clock ? this.clock.getDelta() : 0;
        
        // Update all mixers with the same delta
        this.scene.traverse(object => {
            if (object.userData.mixer) {
                object.userData.mixer.update(delta);
            }
            if (object.isSkinnedMesh) {
                object.skeleton.update();
            }
        });
    
        this.renderer.render(this.scene, this.camera);
    }
    handleResize() {
        this.camera.aspect = this.canvas.clientWidth / this.canvas.clientHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight);
    }

    async handleSave(fireSave) {
     
        if (fireSave) {
            const saveEvent = new CustomEvent('saveSceneObject', {
                detail: { 
                    data: this.state.entities, 
                    propertyName: 'sceneData' 
                },
                bubbles: true,
                cancelable: true
            });
            document.body.dispatchEvent(saveEvent);
        } else {
            const valueElement = this.gameEditor.elements.editor
                .querySelector('#sceneData-value');
            if (valueElement) {
                let renderDataCopy = JSON.parse(JSON.stringify(this.state.entities));  
                valueElement.value = JSON.stringify(renderDataCopy, null, 2);
            }
        }
    }

    async addSampleEntities() {
        await this.createEntityFromConfig('game', 
            { 
                gameConfig: this.gameEditor.getCollections().configs.game, 
                canvas: this.canvas, 
                canvasBuffer: document.createElement("canvas"), 
                terrainCanvasBuffer: document.createElement("canvas"), 
                levelName: this.gameEditor.getCollections().configs.state.level, 
                level: this.gameEditor.getCollections().levels[this.gameEditor.getCollections().configs.state.level], 
                palette: this.gameEditor.getPalette()
            }
        );
 
        // Add a child to the cube entity
        await this.createEntityFromConfig("player", 
            {                   
                position: {
                    x: 0, y: 0, z: 0
                },
                spawnType: 'knight', 
                objectType: 'enemies'
            }
        );
        this.handleSave(false);
    }

    async createEntityFromConfig(type, params) {
        const entity = this.createEntity(type, params);  
        if(params.objectType && params.spawnType){
            const objData = this.gameEditor.getCollections()[params.objectType][params.spawnType];
            if(objData.render){
                const model = objData.render.model;
                if(model){
                    const modelShape = model[Object.keys(model)[0]].shapes[0];              
                    // Add mesh renderer component for visible objects
                    entity.components.push({
                        type: 'renderer',
                        properties: {
                            url: modelShape.url ? modelShape.url : modelShape.type,
                            material: 'standard',
                            color: modelShape.color,
                            receiveShadow: true,
                            castShadow: true
                        }
                    });
                    await this.renderModel(type, params, model);
                }
            }
        } 
        return entity;
    }
    async renderModel(name, params, model) {     
        const modelGroup = new window.THREE.Group(); // Main container for all shapes
        modelGroup.name = name;   
        for (const groupName in model) {     
            const mergedGroup = model[groupName];
            if (mergedGroup) {
                let groupGroup = await this.shapeFactory.createGroupFromJSON(groupName, mergedGroup); 
                groupGroup.name = groupName;
                modelGroup.add(groupGroup);
            }
        }
        this.rootGroup.add(modelGroup);
        if(params.position){
            modelGroup.position.x = params.position.x;
            modelGroup.position.y = params.position.y;
            modelGroup.position.z = params.position.z;
        }
    }
    async clearScene() {
        while (this.rootGroup.children.length > 0) {
            const obj = this.rootGroup.children[0];
            this.shapeFactory.disposeObject(obj);
            this.rootGroup.remove(obj);
        }
        this.state.entities = [];
    }
    createEntity(type, params) {
        const id = this.nextEntityId++;
        const name = `${type}`;
        const entity = {
            id,
            name,
            type,
            parent: null,
            children: [],
            components: []
        };

        // Add transform component by default
        entity.components.push({
            type: 'transform',
            properties: {
                position: params.position ? params.position : { x: 0, y: 0, z: 0 },
                rotation: params.rotation ? params.rotation : { x: 0, y: 0, z: 0 },
                scale: params.scale ? params.scale : { x: 1, y: 1, z: 1 }
            }
        });
 

        this.state.entities.push(entity);
        this.renderHierarchy();
        
        return entity;
    }

    addComponent(entity, componentType) {
        if (!entity) return;
        
        // Check if the component already exists
        const exists = entity.components.some(c => c.type === componentType);
        if (exists) {
            console.log(`Entity already has a ${componentType} component`);
            return;
        }
        
        let component = {
            type: componentType,
            properties: {}
        };
        
        // Initialize properties based on component type
        switch (componentType) {
            case 'meshRenderer':
                component.properties = {
                    geometry: entity.type || 'cube',
                    material: 'standard',
                    color: '#cccccc',
                    receiveShadow: true,
                    castShadow: true
                };
                break;
            case 'light':
                component.properties = {
                    type: 'point',
                    color: '#ffffff',
                    intensity: 1.0,
                    castShadow: true
                };
                break;
            case 'collider':
                component.properties = {
                    type: 'box',
                    isTrigger: false,
                    size: { x: 1, y: 1, z: 1 }
                };
                break;
            case 'rigidbody':
                component.properties = {
                    mass: 1.0,
                    drag: 0.1,
                    useGravity: true,
                    isKinematic: false
                };
                break;
            case 'audio':
                component.properties = {
                    clip: 'none',
                    volume: 1.0,
                    pitch: 1.0,
                    loop: false,
                    playOnAwake: false
                };
                break;
            case 'script':
                component.properties = {
                    script: 'NewScript.js',
                    enabled: true
                };
                break;
        }
        
        entity.components.push(component);
        
        // Re-render the inspector to show the new component
        if (this.selectedEntity === entity) {
            this.selectEntity(entity);
        }
    }

    removeComponent(entity, componentType) {
        if (!entity) return;
        
        // Don't allow removing transform component
        if (componentType === 'transform') {
            console.log("Cannot remove transform component");
            return;
        }
        
        const index = entity.components.findIndex(c => c.type === componentType);
        if (index !== -1) {
            entity.components.splice(index, 1);
            
            // Re-render the inspector
            if (this.selectedEntity === entity) {
                this.selectEntity(entity);
            }
        }
    }

    renderHierarchy() {
        this.elements.hierarchy.innerHTML = '';
        
        // Get top-level entities (those without a parent)
        const rootEntities = this.state.entities.filter(e => e.parent === null);
        
        // Render each root entity and its children
        rootEntities.forEach(entity => {
            this.renderEntityInHierarchy(entity, this.elements.hierarchy);
        });
    }

    renderEntityInHierarchy(entity, parentElement, level = 0) {
        const itemEl = document.createElement('div');
        itemEl.className = 'hierarchy-item';
        itemEl.dataset.entityId = entity.id;
        
        if (this.selectedEntity === entity) {
            itemEl.classList.add('selected');
        }
        
        // Add indentation for child entities
        itemEl.style.paddingLeft = (8 + level * 20) + 'px';
        
        // Create entity icon
        const iconEl = document.createElement('div');
        iconEl.className = 'entity-icon';
        itemEl.appendChild(iconEl);
        
        // Create entity name
        const nameEl = document.createElement('span');
        nameEl.textContent = entity.name;
        itemEl.appendChild(nameEl);
        
        // Add click event
        itemEl.addEventListener('click', () => {
            this.selectEntity(entity);
        });
        
        parentElement.appendChild(itemEl);
        
        // Find children of this entity
        const children = this.state.entities.filter(e => e.parent === entity);
        children.forEach(child => {
            this.renderEntityInHierarchy(child, parentElement, level + 1);
        });
    }

    selectEntity(entity) {
        // Clear previous selection
        const prevSelected = document.querySelector('.hierarchy-item.selected');
        if (prevSelected) {
            prevSelected.classList.remove('selected');
        }
        
        this.selectedEntity = entity;
        
        // Update hierarchy selection
        const entityEl = document.querySelector(`.hierarchy-item[data-entity-id="${entity.id}"]`);
        if (entityEl) {
            entityEl.classList.add('selected');
        }
        
        // Show inspector with entity data
        this.renderInspector();
    }

    renderInspector() {
        // Show/hide the appropriate sections
        if (!this.selectedEntity) {
            this.elements.noSelection.style.display = 'block';
            this.elements.entityInspector.style.display = 'none';
            return;
        }
        
        this.elements.noSelection.style.display = 'none';
        this.elements.entityInspector.style.display = 'block';
        
        // Update transform values
        const entity = this.selectedEntity;

        // Clear and re-render components
        this.elements.components.innerHTML = '';
        
        // Skip the transform component as it's already shown
        entity.components.forEach(component => {        
            this.renderComponent(component);
        });
    }

    renderComponent(component) {
        const componentEl = document.createElement('div');
        componentEl.className = 'component-section';
        
        // Component header
        const headerEl = document.createElement('div');
        headerEl.className = 'component-header';
        
        // Component title
        const titleEl = document.createElement('span');
        titleEl.textContent = this.formatComponentName(component.type);
        headerEl.appendChild(titleEl);
        
        // Remove component button
        const removeBtn = document.createElement('button');
        removeBtn.className = 'btn';
        removeBtn.textContent = 'X';
        removeBtn.addEventListener('click', () => {
            this.removeComponent(this.selectedEntity, component.type);
        });
        headerEl.appendChild(removeBtn);
        
        componentEl.appendChild(headerEl);
        
        // Component properties
        Object.entries(component.properties).forEach(([key, value]) => {
            const propEl = document.createElement('div');
            propEl.className = 'property';
            
            // Property label
            const labelEl = document.createElement('label');
            labelEl.textContent = this.formatPropertyName(key);
            propEl.appendChild(labelEl);
            
            // Property input
            let inputEl;
            
            if (typeof value === 'boolean') {
                // Boolean checkbox
                inputEl = document.createElement('input');
                inputEl.type = 'checkbox';
                inputEl.checked = value;
            } else if (typeof value === 'number') {
                // Number input
                inputEl = document.createElement('input');
                inputEl.type = 'number';
                inputEl.value = value;
                inputEl.step = key.includes('scale') ? '0.1' : '1';
            } else if (typeof value === 'object' && value !== null) {
                // Vector3 input for position, rotation, scale, etc.
                inputEl = document.createElement('div');
                inputEl.className = 'vector3-input';
                
                ['x', 'y', 'z'].forEach(axis => {
                if (axis in value) {
                    const axisInput = document.createElement('input');
                    axisInput.type = 'number';
                    axisInput.value = value[axis];
                    axisInput.step = '0.1';
                    inputEl.appendChild(axisInput);
                }
                });
            } else if (key === 'type' && component.type === 'light') {
                // Select dropdown for light type
                inputEl = document.createElement('select');
                ['directional', 'point', 'spot', 'ambient'].forEach(type => {
                    const option = document.createElement('option');
                    option.value = type;
                    option.textContent = this.formatPropertyName(type);
                    option.selected = value === type;
                    inputEl.appendChild(option);
                });
            } else if (key === 'color') {
                // Color input
                inputEl = document.createElement('div');
                inputEl.className = 'color-input';
                
                const colorInput = document.createElement('input');
                colorInput.type = 'text';
                colorInput.value = value;
                inputEl.appendChild(colorInput);
                
                const colorPreview = document.createElement('div');
                colorPreview.className = 'color-preview';
                colorPreview.style.backgroundColor = value;
                inputEl.appendChild(colorPreview);
            } else {
                // Default text input
                inputEl = document.createElement('input');
                inputEl.type = 'text';
                inputEl.value = value;
            }
            
            propEl.appendChild(inputEl);
            componentEl.appendChild(propEl);
        });
        
        this.elements.components.appendChild(componentEl);
    }
    
    formatComponentName(name) {
        // Convert camelCase or snake_case to Title Case with spaces
        return name
        .replace(/([A-Z])/g, ' $1')
        .replace(/_/g, ' ')
        .replace(/^./, str => str.toUpperCase());
    }
    
    formatPropertyName(name) {
        // Convert camelCase or snake_case to Title Case with spaces
        return name
        .replace(/([A-Z])/g, ' $1')
        .replace(/_/g, ' ')
        .replace(/^./, str => str.toUpperCase());
    }
    
    getMergedGroup(groupName){
        let model = this.state.renderData.model;
        const modelGroup = model[groupName];
        if(this.state.editingModel){
            return modelGroup;
        }
        return this.shapeFactory.getMergedGroup(model, this.getCurrentAnimation()[this.state.currentFrame], groupName );
    }
}