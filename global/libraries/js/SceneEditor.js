class SceneEditor {
    constructor(gameEditor, config, {ShapeFactory, SE_GizmoManager, ModelManager, GameState, ImageManager}) {
        this.gameEditor = gameEditor;
        this.config = config;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.collections = this.gameEditor.getCollections();
        this.clock = new window.THREE.Clock();
        this.gameEditor.state = new GameState(this.gameEditor.getCollections());  
        this.canvas = document.getElementById('scene-editor-canvas');
        this.terrainCanvasBuffer = document.createElement('canvas');
        let palette = this.gameEditor.getPalette();
        this.gameEditor.imageManager = new GUTS.ImageManager(this.gameEditor, { imageSize: this.config.imageSize, palette: palette}, {ShapeFactory: GUTS.ShapeFactory});

        this.state = {
            sceneData: [],
            selectedEntityIndex: -1,
            selectedEntity: null,
            selectedEntityObject: null
        };
        this.elements = {
            hierarchy: document.getElementById('scene-hierarchy'),
            inspector: document.getElementById('scene-inspector'),
            noSelection: document.getElementById('scene-noSelection'),
            entityInspector: document.getElementById('scene-entityInspector'),
            components: document.getElementById('scene-components'),
            addPrefabSelect: document.getElementById('scene-addPrefabSelect'),
            addPrefabBtn: document.getElementById('scene-addPrefabBtn'),
            removePrefabBtn: document.getElementById('scene-removePrefabBtn'),
        } 
        this.componentsToUpdate = [];
        this.gameEditor.palette = this.gameEditor.getPalette();
        this.shapeFactory = new ShapeFactory(this.gameEditor.getResourcesPath(), this.gameEditor.palette, this.gameEditor.getCollections().textures, null);
        if(location.hostname.indexOf('github') >= 0) {
            this.shapeFactory.setURLRoot("/GUTS/");
        }   
        this.gameEditor.modelManager = new ModelManager(this.gameEditor, {}, {ShapeFactory, palette: this.gameEditor.palette, textures: this.gameEditor.getCollections().textures});    
     
        this.initThreeJS(this.canvas);
        this.gizmoManager = new SE_GizmoManager();
        this.gizmoManager.init(this);
        this.initEventListeners();
        this.animate();
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
        this.elements.addPrefabBtn.addEventListener('click', (e) => {
            let parts = this.elements.addPrefabSelect.value.split(".");
            const objType = parts[0];
            const spawnType = parts[1];
            const prefabData = this.gameEditor.getCollections()[objType][spawnType];
            if(prefabData.entity){
                this.createEntity(prefabData.entity, { "objectType": objType, "spawnType": spawnType, ...prefabData });
            }
        });
        this.elements.removePrefabBtn.addEventListener('click', () => {
            if (this.state.selectedEntity) {
                // Remove from Three.js scene
                const entityObject = this.state.selectedEntityObject || this.findEntityObject(this.state.selectedEntity);
                if (entityObject) {
                    this.shapeFactory.disposeObject(entityObject);
                    this.rootGroup.remove(entityObject);
                }
    
                // Remove from entities array
                const index = this.state.sceneData.indexOf(this.state.selectedEntity);
                if (index > -1) {
                    this.state.sceneData.splice(index, 1);
                }
    
                // Clear selection
                this.state.selectedEntity = null;
                this.state.selectedEntityObject = null;
                this.gizmoManager.detach();
    
                // Update UI
                this.handleSave(false);
                this.renderHierarchy();
                this.renderInspector();
            }
        });
        const collectionDefs = this.gameEditor.getCollectionDefs();
        let prefabTypes = [];
        for(let collectionDef of collectionDefs) {
            if(collectionDef.category.toLowerCase() == "prefabs") {
                prefabTypes.push(collectionDef.id);
            }
        }
        const collections = this.gameEditor.getCollections();
        for(let prefabTypeName of prefabTypes){
            let objectTypes = collections[prefabTypeName];
            for(let spawnTypeName in objectTypes){
                let spawnData = objectTypes[spawnTypeName];
                if(spawnData.entity){
                    let option = document.createElement('option');
                    option.innerText = spawnData.title;
                    option.value = `${prefabTypeName}.${spawnTypeName}`;
                    this.elements.addPrefabSelect.append(option);
                }
            }
        }

        // Add click event listeners
        document.getElementById('scene-translate-tool').addEventListener('click', () => {
            this.setGizmoMode('translate');
            this.updateGizmoToolbarUI('scene-translate-tool');
        });
        
        document.getElementById('scene-rotate-tool').addEventListener('click', () => {
            this.setGizmoMode('rotate');
            this.updateGizmoToolbarUI('scene-rotate-tool');
        });
        
        document.getElementById('scene-scale-tool').addEventListener('click', () => {
            this.setGizmoMode('scale');
            this.updateGizmoToolbarUI('scene-scale-tool');
        });
    }

    initThreeJS(canvas) {
        // Scene setup
        this.scene = new window.THREE.Scene();
        this.gameEditor.scene = this.scene;
        this.rootGroup = new window.THREE.Group(); // Main container for all shapes
        this.rootGroup.name = "rootGroup";
        this.scene.add(this.rootGroup);
        // Camera setup
        this.camera = new window.THREE.PerspectiveCamera(
            75, 
            canvas.clientWidth / canvas.clientHeight, 
            0.1, 
            100000
        );
        this.gameEditor.camera = this.camera;
        this.camera.position.set(100, 100, 100);
        this.camera.lookAt(0, 0, 0);

        // Renderer setup
        this.renderer = new window.THREE.WebGLRenderer({ 
            canvas: canvas, 
            antialias: false, 
            alpha: true 
        });
        this.gameEditor.renderer = this.renderer;
        this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        // Add helpers
        const gridHelper = new window.THREE.GridHelper(1000, 100);
        this.scene.add(gridHelper);

        const axesHelper = new window.THREE.AxesHelper(10);
        this.scene.add(axesHelper);

        // Orbit controls
        this.controls = new window.THREE_.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.25;

        // Resize handling
        window.addEventListener('resize', this.handleResize.bind(this));
    }
    
    async handleRenderSceneObject(event) {
        this.canvas.width = this.gameEditor.getCollections().configs.game.canvasWidth;
        this.canvas.height = this.gameEditor.getCollections().configs.game.canvasHeight;
        this.canvas.setAttribute('style','');   
        await this.loadAssets();    
        this.clearScene();
        this.renderSceneData(event.detail.data);
        this.handleResize();
        this.clock = new window.THREE.Clock();
        this.clock.start(); 
        requestAnimationFrame(() => {
            this.state.selectedEntityIndex = -1;
        });
    }

    async loadAssets() {
        if(!this.gameEditor.modelManager.assetsLoaded){
            let collections = this.gameEditor.getCollections();
            for(let objectType in collections) {            
                await this.gameEditor.modelManager.loadModels(objectType, collections[objectType]);
            }  
        } 
       
        this.gameEditor.terrainTileMapper = this.gameEditor.editorModuleInstances.TileMap; 
       
        await this.gameEditor.imageManager.loadImages("levels", { level: this.gameEditor.getCollections().levels["level1"] }, false, false);
        const terrainImages = this.gameEditor.imageManager.getImages("levels", "level");
        this.gameEditor.terrainTileMapper.init(this.terrainCanvasBuffer, this.gameEditor.getCollections().configs.game.gridSize, terrainImages, this.gameEditor.getCollections().configs.game.isIsometric);
    }

    animate() {
        requestAnimationFrame(this.animate.bind(this));
        this.controls.update();
        this.componentsToUpdate.forEach((component) => component.update());
        // Calculate delta once per frame
        const delta = this.clock ? this.clock.getDelta() : 0;
        this.gameEditor.deltaTime = delta;
        // Update all mixers with the same delta
        this.scene.traverse(object => {
            if (object.userData.mixer) {
                object.userData.mixer.update(delta);
            }
            if (object.isSkinnedMesh) {
                object.skeleton.update();
            }
        });
        
        if (this.gizmoManager && this.gizmoManager.targetObject) {
            this.gizmoManager.updateGizmoTransform();
        }
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
                    data: this.state.sceneData, 
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
                let renderDataCopy = JSON.parse(JSON.stringify(this.state.sceneData));  
                valueElement.value = JSON.stringify(renderDataCopy, null, 2);
            }
        }
    }

    async renderSceneData(sceneData) {
        for(let entity of sceneData){

            const prefabData = this.gameEditor.getCollections()[entity.objectType][entity.spawnType];   
            let componentData = {};
            entity.components.forEach((c) => {
                componentData[c.type] = c.parameters;
            });
            let params = { "objectType": entity.objectType, "spawnType": entity.spawnType, ...componentData, ...prefabData };             
            if(params.render && params.render.model){
                await this.addModelToScene(entity.type, params);                
            }
            
            this.createEntity(entity.type, params);
        }        
    }

    async createEntityFromCollections(type, params) {
        const entity = this.createEntity(type, params);  

        return entity;
    }

    async addModelToScene(name, params) {     
        const model = params.render.model;
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
        if(params.transform?.position){
            modelGroup.position.x = params.transform.position.x;
            modelGroup.position.y = params.transform.position.y;
            modelGroup.position.z = params.transform.position.z;
        }
        if(params.transform?.scale){
            modelGroup.scale.x = params.transform.scale.x;
            modelGroup.scale.y = params.transform.scale.y;
            modelGroup.scale.z = params.transform.scale.z;
        }
        if(params.transform?.rotation){
            modelGroup.rotation.x = params.transform.rotation.x;
            modelGroup.rotation.y = params.transform.rotation.y;
            modelGroup.rotation.z = params.transform.rotation.z;
        }
    }

    async clearScene() {
        this.componentsToUpdate.forEach((component) => component.destroy());
        this.componentsToUpdate = [];
        while (this.rootGroup.children.length > 0) {
            const obj = this.rootGroup.children[0];
            this.shapeFactory.disposeObject(obj);
            this.rootGroup.remove(obj);
        }        
        this.state.sceneData = []; 
    }

    createEntity(type, prefabData) {
        const id = this.game.getEntityId();
        const entity = {
            id,
            type,
            objectType: prefabData.objectType,
            spawnType: prefabData.spawnType,
            parent: null,
            children: [],
            components: this.getEntityComponents(type, prefabData)
        };


        this.state.sceneData.push(entity);
        this.handleSave(false);
        this.renderHierarchy();
        
        return entity;
    }

    getEntityComponents(type, prefabData){
        let components = [];
        // Add transform component by default
        components.push({
            type: 'transform',
            parameters: {
                position: prefabData.transform && prefabData.transform.position ? prefabData.transform.position : { x: 0, y: 0, z: 0 },
                rotation: prefabData.transform && prefabData.transform.rotation ? prefabData.transform.rotation : { x: 0, y: 0, z: 0 },
                scale: prefabData.transform && prefabData.transform.scale ? prefabData.transform.scale : { x: 1, y: 1, z: 1 }
            }
        });
        const entityObjData = this.gameEditor.getCollections().entities[type];
        const combined = [...entityObjData.renderers, ...entityObjData.components];

        let compsToInit = [];
         
        combined.forEach((componentName) => {
            const componentDataKey = componentName.charAt(0).toLowerCase() + componentName.slice(1, componentName.length);
            const compInstanceId = prefabData[componentDataKey];
            if(compInstanceId){
                let componentDef = this.gameEditor.getCollections().components[componentName];
                if(!componentDef) {
                    componentDef = this.gameEditor.getCollections().renderers[componentName];
                }

                let component = {
                    type: componentName,
                    parameters: {}
                };       
                let componentDataCollectionDef = this.gameEditor.getCollectionDefs().find(t =>                     
                    componentName.toLowerCase() == t.singular.replace(/ /g,'').toLowerCase() 
                );
                if(!componentDataCollectionDef){
                    componentDataCollectionDef = this.gameEditor.getCollectionDefs().find(t =>   
                        componentName.toLowerCase().endsWith(t.singular.replace(/ /g,'').toLowerCase())
                    );
                }
                if(componentDataCollectionDef){
                    component.parameters = this.gameEditor.getCollections()[componentDataCollectionDef.id][prefabData[componentDataKey]];
                    delete component.parameters.title;
                }
                components.push(component);
                if(componentDef.updateInEditor){
             

                    let comp = this.gameEditor.instantiateComponent(componentName);
                    let params = {...component.parameters, canvas: this.canvas, scene: this.scene, camera: this.camera, renderer: this.renderer, isEditor: true};
                    compsToInit.push({
                        component: comp,
                        params: params
                    })
                }
            }
        });

        compsToInit.forEach((compObj) => {
            let comp = compObj.component;
            let params = compObj.params;
            comp.init(params)
            this.componentsToUpdate.push(comp);
        })
 
        return components;
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
            parameters: {}
        };
        
        // Initialize parameters based on component type
        switch (componentType) {
            case 'meshRenderer':
                component.parameters = {
                    geometry: entity.type || 'cube',
                    material: 'standard',
                    color: '#cccccc',
                    receiveShadow: true,
                    castShadow: true
                };
                break;
            case 'light':
                component.parameters = {
                    type: 'point',
                    color: '#ffffff',
                    intensity: 1.0,
                    castShadow: true
                };
                break;
            case 'collider':
                component.parameters = {
                    type: 'box',
                    isTrigger: false,
                    size: { x: 1, y: 1, z: 1 }
                };
                break;
            case 'rigidbody':
                component.parameters = {
                    mass: 1.0,
                    drag: 0.1,
                    useGravity: true,
                    isKinematic: false
                };
                break;
            case 'audio':
                component.parameters = {
                    clip: 'none',
                    volume: 1.0,
                    pitch: 1.0,
                    loop: false,
                    playOnAwake: false
                };
                break;
            case 'script':
                component.parameters = {
                    script: 'NewScript.js',
                    enabled: true
                };
                break;
        }
        
        entity.components.push(component);
        
        // Re-render the inspector to show the new component
        if (this.state.selectedEntity === entity) {
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
            if (this.state.selectedEntity === entity) {
                this.selectEntity(entity);
            }
        }
    }

    renderHierarchy() {
        this.elements.hierarchy.innerHTML = '';
        
        // Get top-level entities (those without a parent)
        const rootEntities = this.state.sceneData.filter(e => e.parent === null);
        
        // Render each root entity and its children
        rootEntities.forEach(entity => {
            this.renderEntityInHierarchy(entity, this.elements.hierarchy);
        });
    }

    renderEntityInHierarchy(entity, parentElement, level = 0) {
        const itemEl = document.createElement('div');
        itemEl.className = 'scene-editor__hierarchy-item';
        itemEl.dataset.entityId = entity.id;

        if (this.state.selectedEntity === entity) {
            itemEl.classList.add('selected');
        }    
        // Create entity name
        const nameEl = document.createElement('span');
        nameEl.textContent = entity.type;
        itemEl.appendChild(nameEl);
        
        // Add click event
        itemEl.addEventListener('click', () => {
            this.selectEntity(entity);
        });
        
        parentElement.appendChild(itemEl);
        
        // Find children of this entity
        const children = this.state.sceneData.filter(e => e.parent === entity);
        children.forEach(child => {
            this.renderEntityInHierarchy(child, parentElement, level + 1);
        });
    }

    selectEntity(entity) {
        // Clear previous selection
        const prevSelected = document.querySelector('.scene-editor__hierarchy-item.selected');
        if (prevSelected) {
            prevSelected.classList.remove('selected');
        }
        
        this.state.selectedEntity = entity;
        
        // Update hierarchy selection
        const entityEl = document.querySelector(`.hierarchy-item[data-entity-id="${entity.id}"]`);
        if (entityEl) {
            entityEl.classList.add('selected');
        }
        
        // Show inspector with entity data
        this.renderInspector();

        if (entity) {
            const entityObject = this.findEntityObject(entity);            
            if (entityObject) {
                this.state.selectedEntityObject = entityObject;
                this.gizmoManager.attach(entityObject);
            } else {
                this.state.selectedEntityObject = null;
                this.gizmoManager.detach();
            }
        } else {
            this.gizmoManager.detach();
        }
    }

    renderInspector() {
        // Show/hide the appropriate sections
        if (!this.state.selectedEntity) {
            this.elements.noSelection.style.display = 'block';
            this.elements.entityInspector.style.display = 'none';
            return;
        }
        
        this.elements.noSelection.style.display = 'none';
        this.elements.entityInspector.style.display = 'block';
        
        // Update transform values
        const entity = this.state.selectedEntity;


        if (entity) {
            // Clear and re-render components
            this.elements.components.innerHTML = '';
            
            entity.components.forEach(component => {        
                this.renderComponent(component);
            });
            const entityObject = this.findEntityObject(entity);
            if (entityObject) {
                // Sync transform values from entity to 3D object
                const transformComponent = entity.components.find(c => c.type === 'transform');
                if (transformComponent) {
                    const position = transformComponent.parameters.position;
                    const rotation = transformComponent.parameters.rotation;
                    const scale = transformComponent.parameters.scale;
                    
                    entityObject.position.set(position.x, position.y, position.z);
                    entityObject.rotation.set(rotation.x, rotation.y, rotation.z);
                    entityObject.scale.set(scale.x, scale.y, scale.z);
                    
                    // Update gizmo position
                    this.gizmoManager.updateGizmoTransform();
                }
            }
        }
    }

    renderComponent(component) {
        const componentEl = document.createElement('div');
        componentEl.className = 'component-section';
        
        // Component header
        const headerEl = document.createElement('h3');
        headerEl.className = 'component-header';        
        headerEl.textContent = this.formatComponentName(component.type);
        
        // Remove component button
        const removeBtn = document.createElement('button');
        removeBtn.className = 'btn';
        removeBtn.textContent = 'X';
        removeBtn.addEventListener('click', () => {
            this.removeComponent(this.state.selectedEntity, component.type);
        });
        headerEl.appendChild(removeBtn);
        
        componentEl.appendChild(headerEl);
        
        // Component parameters
        Object.entries(component.parameters).forEach(([key, value]) => {
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
                inputEl.dataset.key = key;
            } else if (typeof value === 'number') {
                // Number input
                inputEl = document.createElement('input');
                inputEl.type = 'number';
                inputEl.value = value;
                inputEl.step = key.includes('scale') ? '0.1' : '1';
                inputEl.dataset.key = key;
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
                    axisInput.dataset.axis = axis;
                    axisInput.dataset.key = key;
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
                inputEl.dataset.key = key;
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
                colorInput.dataset.key = key;
            } else {
                // Default text input
                inputEl = document.createElement('input');
                inputEl.type = 'text';
                inputEl.value = value;
                inputEl.dataset.key = key;
            }
            inputEl.addEventListener('change', (e)=> {
                if(e.target.dataset.axis) {                   
                    component.parameters[e.target.dataset.key][e.target.dataset.axis] = Number(e.target.value);
                    this.state.selectedEntityObject[e.target.dataset.key][e.target.dataset.axis] = Number(e.target.value);
                } else {
                    component.parameters[e.target.dataset.key] = e.target.value;
                }
                this.handleSave(false);
            });
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

    updateGizmoToolbarUI(activeButtonId) {
        // Remove active class from all gizmo tool buttons
        ['scene-translate-tool', 'scene-rotate-tool', 'scene-scale-tool'].forEach(id => {
            const btn = document.getElementById(id);
            if (btn) btn.classList.remove('active');
        });

        // Add active class to the clicked button
        const activeBtn = document.getElementById(activeButtonId);
        if (activeBtn) activeBtn.classList.add('active');
    }
    
    setGizmoMode(mode) {
        if (this.gizmoManager) {
            this.gizmoManager.setMode(mode);
        }
    }
    findEntityObject(entity) {
        // Look for the object in the scene with the same name as the entity type
        // This needs to be adjusted based on how your entities are mapped to 3D objects
        const entityName = entity.type;
        
        let foundObject = null;
        this.rootGroup.traverse((object) => {
            if (object.name === entityName) {
                foundObject = object;
            }
        });
        
        return foundObject;
    }
}