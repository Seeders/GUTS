class GE_SceneRenderer {
    constructor(gameEditor, graphicsEditor) {
        this.gameEditor = gameEditor;
        this.graphicsEditor = graphicsEditor;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
    }    

    init() {        
        this.initThreeJS();
        this.initEventListeners();
    }
    initEventListeners() {
        document.body.addEventListener('renderGraphicsObject', this.handleRenderObject.bind(this));
        document.body.addEventListener('resizedEditor', () => {             
            this.graphicsEditor.canvas.width = this.gameEditor.getCollections().configs.game.canvasWidth;
            this.graphicsEditor.canvas.height = this.gameEditor.getCollections().configs.game.canvasHeight;
            this.graphicsEditor.canvas.setAttribute('style','');
            this.handleResize();  
            this.graphicsEditor.refreshShapes(false); 
        });
        document.getElementById('iso-generate').addEventListener('click', this.generateIsometricSprites.bind(this));
    }
    initThreeJS() {
        // Scene setup
        this.scene = new window.THREE.Scene();
        
        // Add the root group to the scene
        this.scene.add(this.graphicsEditor.rootGroup);

        // Camera setup
        this.camera = new window.THREE.PerspectiveCamera(
            75, 
            this.graphicsEditor.canvas.clientWidth / this.graphicsEditor.canvas.clientHeight, 
            0.1, 
            1000
        );
        this.camera.position.set(100, 100, 100);
        this.camera.lookAt(0, 0, 0);

        // Renderer setup
        this.renderer = new window.THREE.WebGLRenderer({ 
            canvas: this.graphicsEditor.canvas, 
            antialias: false, 
            alpha: true 
        });
        this.renderer.setSize(this.graphicsEditor.canvas.clientWidth, this.graphicsEditor.canvas.clientHeight);

        // Add helpers
        const gridHelper = new window.THREE.GridHelper(100, 10);
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
    
    handleResize() {
        this.camera.aspect = this.graphicsEditor.canvas.clientWidth / this.graphicsEditor.canvas.clientHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(this.graphicsEditor.canvas.clientWidth, this.graphicsEditor.canvas.clientHeight);
    }
    
    handleRenderObject(event) {
        this.graphicsEditor.canvas.width = this.gameEditor.getCollections().configs.game.canvasWidth;
        this.graphicsEditor.canvas.height = this.gameEditor.getCollections().configs.game.canvasHeight;
        
        this.graphicsEditor.equipmentEditor.clearAllEquipment();
        this.graphicsEditor.canvas.setAttribute('style','');
        this.graphicsEditor.setPreviewAnimationState(false);
        this.graphicsEditor.state.renderData = event.detail.data;
        document.getElementById('json-content').value = JSON.stringify(this.graphicsEditor.state.renderData, null, 2);
        
        // Safely get first animation name
        let model = this.graphicsEditor.state.renderData.model;        
        if(!model) {
            this.graphicsEditor.state.renderData.model = JSON.parse(JSON.stringify(this.graphicsEditor.state.renderData.animations['idle'][0])); // Deep copy
            model = this.graphicsEditor.state.renderData.model;
        }
        this.graphicsEditor.state.currentAnimation = "";
        this.graphicsEditor.state.editingModel = true;
        // Safely get first frame's shapes
        const firstGroup = Object.keys(model)[0];
        const shapes = model[firstGroup].shapes || [];
        this.graphicsEditor.state.currentGroup = firstGroup;
        this.handleResize();
        this.graphicsEditor.refreshShapes(false);
        this.clock = new window.THREE.Clock();
        this.clock.start(); 
        requestAnimationFrame(() => {
            this.graphicsEditor.state.selectedShapeIndex = -1;
            this.graphicsEditor.shapeManager.selectShape(shapes.length > 0 ? 0 : -1);
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
    
    async createObjectsFromJSON(frameData, scene) {
        for(const groupName in frameData) {
            const group = await this.graphicsEditor.shapeFactory.createGroupFromJSON(groupName, frameData[groupName]);
            scene.add(group);
        }
    }
    
    async generateIsometricSprites() {
        const frustumSize = parseFloat(document.getElementById('iso-frustum').value) || 48;
        const cameraDistance = parseFloat(document.getElementById('iso-distance').value) || 100;
        const size = parseFloat(document.getElementById('iso-size').value) || 64;
        const aspect = 1;
        const tempRenderer = new window.THREE.WebGLRenderer({ antialias: false, alpha: true });
        tempRenderer.setSize(size, size);
        document.getElementById('modal-generateIsoSprites').classList.remove('show');
    
        const renderTarget = new window.THREE.WebGLRenderTarget(size, size);
        const cameras = [
            new window.THREE.OrthographicCamera(-frustumSize * aspect, frustumSize * aspect, frustumSize, -frustumSize, 0.1, 1000),
            new window.THREE.OrthographicCamera(-frustumSize * aspect, frustumSize * aspect, frustumSize, -frustumSize, 0.1, 1000),
            new window.THREE.OrthographicCamera(-frustumSize * aspect, frustumSize * aspect, frustumSize, -frustumSize, 0.1, 1000),
            new window.THREE.OrthographicCamera(-frustumSize * aspect, frustumSize * aspect, frustumSize, -frustumSize, 0.1, 1000),
            new window.THREE.OrthographicCamera(-frustumSize * aspect, frustumSize * aspect, frustumSize, -frustumSize, 0.1, 1000),
            new window.THREE.OrthographicCamera(-frustumSize * aspect, frustumSize * aspect, frustumSize, -frustumSize, 0.1, 1000),
            new window.THREE.OrthographicCamera(-frustumSize * aspect, frustumSize * aspect, frustumSize, -frustumSize, 0.1, 1000),
            new window.THREE.OrthographicCamera(-frustumSize * aspect, frustumSize * aspect, frustumSize, -frustumSize, 0.1, 1000)
        ];
    
        // Position cameras at 8 angles (45° increments)
        cameras[0].position.set(cameraDistance, cameraDistance, cameraDistance);           // NE up
        cameras[1].position.set(0, cameraDistance, cameraDistance);                       // N up
        cameras[2].position.set(-cameraDistance, cameraDistance, cameraDistance);         // NW up
        cameras[3].position.set(-cameraDistance, cameraDistance, 0);                      // W up
        cameras[4].position.set(-cameraDistance, cameraDistance, -cameraDistance);        // SW up
        cameras[5].position.set(0, cameraDistance, -cameraDistance);                      // S up
        cameras[6].position.set(cameraDistance, cameraDistance, -cameraDistance);         // SE up
        cameras[7].position.set(cameraDistance, cameraDistance, 0);                       // E up
        
        cameras.forEach(camera => camera.lookAt(0, 0, 0));
    
        const sprites = {};     
       
        for (const animType in this.graphicsEditor.state.renderData.animations) {
            sprites[animType] = [];
            for (let frameIndex = 0; frameIndex < this.graphicsEditor.state.renderData.animations[animType].length; frameIndex++) {
                const frame = this.graphicsEditor.state.renderData.animations[animType][frameIndex];
                const scene = new window.THREE.Scene();
                
                // Add lights
                const ambientLight = new window.THREE.AmbientLight(0xffffff, 0.8);
                scene.add(ambientLight);
                const directionalLight = new window.THREE.DirectionalLight(0xffffff, 1.0);
                directionalLight.position.set(5, 10, 7.5);
                scene.add(directionalLight);

                await this.createObjectsFromJSON(frame, scene);
    
                const frameSprites = [];
                for (const camera of cameras) {
                    tempRenderer.setRenderTarget(renderTarget);
                    tempRenderer.render(scene, camera);
                    const buffer = new Uint8Array(size * size * 4);
                    tempRenderer.readRenderTargetPixels(renderTarget, 0, 0, size, size, buffer);
                    const flippedBuffer = new Uint8Array(size * size * 4);
                    for (let y = 0; y < size; y++) {
                        const srcRowStart = y * size * 4;
                        const destRowStart = (size - 1 - y) * size * 4;
                        flippedBuffer.set(buffer.subarray(srcRowStart, srcRowStart + size * 4), destRowStart);
                    }
                    const canvas = document.createElement('canvas');
                    canvas.width = size;
                    canvas.height = size;
                    const ctx = canvas.getContext('2d');
                    const imageData = ctx.createImageData(size, size);
                    imageData.data.set(flippedBuffer);
                    ctx.putImageData(imageData, 0, 0);
                    frameSprites.push(canvas.toDataURL());
                }
                sprites[animType].push(frameSprites);
            }
        }
        tempRenderer.setRenderTarget(null);
        tempRenderer.dispose();
        renderTarget.dispose();
        this.graphicsEditor.displayIsometricSprites(sprites);
    }
}