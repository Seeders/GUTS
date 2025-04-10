class GraphicsEditor {
    constructor(gameEditor, config, {ShapeFactory}) {

        this.gltfCache = new Map();
        this.gameEditor = gameEditor;
      
        this.shapeFactory = new ShapeFactory();

        this.config = config;
        // DOM elements
        this.container = document.getElementById('graphics-editor-container');
        this.canvas = document.getElementById('canvas');

        // Three.js core components
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;

        // Interaction components
        this.raycaster = new window.THREE.Raycaster();
        this.mouse = new window.THREE.Vector2();
        this.selectedOutline = null;
        this.originalMaterials = new Map();

        // State management
        this.renderData = { 
            animations: { 
                "idle": [{ shapes: [] }] 
            } 
        };
        this.selectedShapeIndex = -1;
        this.currentAnimation = "idle";
        this.currentFrame = 0;
        this.isDragging = false;
        this.clickStartTime = 0;
        this.isPreviewingAnimation = false;
        
        this.init();
    }

    init() {
        this.initThreeJS();
        this.initEventListeners();
        this.refreshShapes(false);
				//this.loadGLTF();
        this.animate();
    }
    initThreeJS() {
        // Scene setup
        this.scene = new window.THREE.Scene();

        // Camera setup
        this.camera = new window.THREE.PerspectiveCamera(
            75, 
            this.canvas.clientWidth / this.canvas.clientHeight, 
            0.1, 
            1000
        );
        this.camera.position.set(100, 100, 100);
        this.camera.lookAt(0, 0, 0);

        // Renderer setup
        this.renderer = new window.THREE.WebGLRenderer({ 
            canvas: this.canvas, 
            antialias: false, 
            alpha: true 
        });
        this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight);

        // Add helpers
        const gridHelper = new window.THREE.GridHelper(100, 100);
        this.scene.add(gridHelper);

        const axesHelper = new window.THREE.AxesHelper(5);
        this.scene.add(axesHelper);

        // Orbit controls
        this.controls = new window.THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.25;

        // Resize handling
        window.addEventListener('resize', this.handleResize.bind(this));
    }

    handleResize() {
        this.camera.aspect = this.canvas.clientWidth / this.canvas.clientHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight);
    }

    initEventListeners() {
        // Button event listeners
        const buttonMappings = {
            'add-shape': this.addNewShape.bind(this),
            'preview-animation': this.togglePreview.bind(this),
            'duplicate-shape': this.duplicateSelectedShape.bind(this),
            'delete-shape': this.deleteSelectedShape.bind(this),
            'scale-all': this.scaleAllShapes.bind(this),
            'rotate-all': this.rotateAllShapes.bind(this),
            'move-all': this.moveAllShapes.bind(this),
            'generate-isometric': this.showIsometricModal.bind(this),
            'add-animation': this.addNewAnimation.bind(this),
            'delete-animation': this.deleteAnimation.bind(this),
            'duplicate-frame': this.duplicateFrame.bind(this),
            'delete-frame': this.deleteFrame.bind(this)
        };

        Object.entries(buttonMappings).forEach(([id, handler]) => {
            const button = document.getElementById(id);
            if (button) button.addEventListener('click', handler);
        });

        // Canvas interaction
        this.canvas.addEventListener('mousedown', this.handleMouseDown.bind(this));
        this.canvas.addEventListener('mousemove', this.handleMouseMove.bind(this));
        this.canvas.addEventListener('mouseup', this.handleMouseUp.bind(this));

        // Additional event listeners
        document.body.addEventListener('renderGraphicsObject', this.handleRenderObject.bind(this));
        
        // Move modal listeners
        document.getElementById('move-cancel').addEventListener('click', () => {
            document.getElementById('modal-moveAllShapes').classList.remove('show');
        });

        document.getElementById('move-apply').addEventListener('click', this.applyMoveModal.bind(this));

        // Isometric modal listeners
        document.getElementById('iso-cancel').addEventListener('click', () => {
            document.getElementById('modal-generateIsoSprites').classList.remove('show');
        });
        document.getElementById('iso-generate').addEventListener('click', this.generateIsometricSprites.bind(this));
    }

    handleRenderObject(event) {

        this.canvas.width = this.gameEditor.getCollections().configs.game.canvasWidth;
        this.canvas.height = this.gameEditor.getCollections().configs.game.canvasHeight;
        this.canvas.setAttribute('style','');
        this.setPreviewAnimationState(false);
        this.renderData = event.detail.data;
        document.getElementById('json-content').value = JSON.stringify(this.renderData, null, 2);
        this.currentAnimation = "idle";
        this.selectedShapeIndex = this.renderData.animations.idle[0].shapes.length > 0 ? 0 : -1;                
        this.refreshShapes(false);
        this.handleResize();
    }

    applyMoveModal() {
        const xOffset = parseFloat(document.getElementById('move-x').value) || 0;
        const yOffset = parseFloat(document.getElementById('move-y').value) || 0;
        const zOffset = parseFloat(document.getElementById('move-z').value) || 0;
        
        // Apply the offset to all shapes
        this.renderData.animations[this.currentAnimation][this.currentFrame].shapes.forEach(shape => {
            shape.x = (shape.x || 0) + xOffset;
            shape.y = (shape.y || 0) + yOffset;
            shape.z = (shape.z || 0) + zOffset;
        });
        this.refreshShapes(true);
        
        // Hide the modal
        document.getElementById('modal-moveAllShapes').classList.remove('show');
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

        const rect = this.canvas.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / this.canvas.clientWidth) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / this.canvas.clientHeight) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);

        const shapes = this.scene.children.filter(obj => obj.userData.isShape);
        const intersects = this.raycaster.intersectObjects(shapes, true);

        if (intersects.length > 0) {
            const index = intersects[0].object.userData.index;
            this.selectShape(index);
        }
    }

    animate() {
        requestAnimationFrame(this.animate.bind(this));
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }

    selectShape(index) {
        if(this.isPreviewingAnimation){
            this.setPreviewAnimationState(false);
        }
        this.selectedShapeIndex = (this.selectedShapeIndex === index) ? -1 : index;
        this.updateShapeList();
        this.highlightSelectedShape();
    }

    async togglePreview(e) {
        this.isPreviewingAnimation = !this.isPreviewingAnimation;
        await this.animatePreview();
        this.setPreviewAnimationState(this.isPreviewingAnimation);            
    }

    setPreviewAnimationState(isPreviewing) {
        this.isPreviewingAnimation = isPreviewing;
        let btn = document.getElementById('preview-animation');
        if (this.isPreviewingAnimation) {
            btn.classList.add("active");
        } else {
            this.currentFrame = 0;
            btn.classList.remove("active");
        }
    }

    async animatePreview() {
        if (!this.isPreviewingAnimation) return;
        this.currentFrame = (this.currentFrame + 1) % this.renderData.animations[this.currentAnimation].length;
        await this.renderShapes(false);
        setTimeout(this.animatePreview.bind(this), 166); // ~6 FPS, adjust as needed
    }

    highlightSelectedShape() {
        // Remove existing outlines
        this.scene.children.forEach(obj => {
            if (obj.userData.isOutline) {
                this.scene.remove(obj);
                if (obj.geometry) obj.geometry.dispose();
                if (obj.material) obj.material.dispose();
            }
        });
        
        // Reset any highlighted materials
        this.originalMaterials.forEach((material, object) => {
            object.material = material;
        });
        this.originalMaterials.clear();
        
        // If no shape is selected, return
        if (this.selectedShapeIndex < 0 || 
            this.selectedShapeIndex >= this.renderData.animations[this.currentAnimation][this.currentFrame].shapes.length) {
            return;
        }
    
        // Find all meshes belonging to the selected shape (including GLTF children)
        const selectedMeshes = [];
        this.scene.traverse(obj => {
            if (obj.isMesh && ((obj.userData.isShape && obj.userData.index === this.selectedShapeIndex) || 
                               (obj.parent && obj.parent.userData.isShape && obj.parent.userData.index === this.selectedShapeIndex) ||
                               (obj.userData.isGLTFChild && obj.parent && obj.parent.userData.index === this.selectedShapeIndex))) {
                selectedMeshes.push(obj);
            }
        });
    
        // Handle highlighting for all relevant meshes
        selectedMeshes.forEach(mesh => {
            // Store original material
            this.originalMaterials.set(mesh, mesh.material);
            
            // Create highlight material
            const highlightMaterial = mesh.material.clone();
            highlightMaterial.emissive = new window.THREE.Color(0x555555);
            highlightMaterial.emissiveIntensity = 0.5;
            mesh.material = highlightMaterial;
            
            // Create outline for each mesh component
            const outlineGeometry = mesh.geometry.clone();
            const outlineMaterial = new window.THREE.MeshBasicMaterial({ 
                color: 0xffff00,
                side: window.THREE.BackSide
            });
            
            const outline = new window.THREE.Mesh(outlineGeometry, outlineMaterial);
            outline.position.copy(mesh.position);
            outline.rotation.copy(mesh.rotation);
            outline.scale.copy(mesh.scale);
            outline.scale.multiplyScalar(1.05);
            outline.userData.isOutline = true;
            
            // Check if the mesh is a child of another object
           
            this.scene.add(outline);
        });
    }
    async renderShapes(fireSave = true) {
        // Remove only top-level shape groups
        const objectsToRemove = this.scene.children.filter(obj => obj.userData.isShape);
        objectsToRemove.forEach(obj => {
            // Dispose of all resources in the hierarchy
            this.shapeFactory.disposeObject(obj); // Use ShapeFactory's dispose method
            this.originalMaterials.delete(obj);
            this.scene.remove(obj);
        });

        // Add lights if they don't exist
        if (!this.scene.getObjectByName('ambient-light')) {
            const ambientLight = new window.THREE.AmbientLight(0xffffff, 0.6);
            ambientLight.name = 'ambient-light';
            this.scene.add(ambientLight);
            const directionalLight = new window.THREE.DirectionalLight(0xffffff, 0.8);
            directionalLight.position.set(5, 10, 7.5);
            directionalLight.name = 'dir-light';
            this.scene.add(directionalLight);
        }

        const currentShapes = this.renderData.animations[this.currentAnimation][this.currentFrame];
        await this.createObjectsFromJSON(currentShapes, this.scene);

        document.getElementById('shape-count').textContent = currentShapes.shapes.length;
        document.getElementById('json-content').value = JSON.stringify(this.renderData, null, 2);

        if( fireSave) {
            const myCustomEvent = new CustomEvent('saveGraphicsObject', {
                detail: { data: this.renderData, propertyName: 'render' },
                bubbles: true,
                cancelable: true
            });
            document.body.dispatchEvent(myCustomEvent);
        } else {
            let valEl = this.gameEditor.elements.editor.querySelector(`#render-value`);
            if( valEl ) {
                valEl.value = JSON.stringify(this.renderData);
            }
        }

        this.highlightSelectedShape();
    }
//gltf
   async createObjectsFromJSON(shapeData, scene) {
        const group = await this.shapeFactory.createFromJSON(shapeData);
        scene.add(group);
    }
//gltf
    addNewShape() {
        const newShape = {
            type: 'gltf',            
            url: 'samples/models/Avocado/Avocado.gltf',
            size: 2,
            color: '#3498db',
            x: 0,
            y: 0,
            z: 0,
            rotationX: 0,
            rotationY: 0,
            rotationZ: 0
        };
        this.renderData.animations[this.currentAnimation][this.currentFrame].shapes.push(newShape);
        this.selectedShapeIndex = this.renderData.animations[this.currentAnimation][this.currentFrame].shapes.length - 1;
        this.refreshShapes(true);
    }

    duplicateSelectedShape() {
        if (this.selectedShapeIndex >= 0) {
            const originalShape = this.renderData.animations[this.currentAnimation][this.currentFrame].shapes[this.selectedShapeIndex];
            const newShape = JSON.parse(JSON.stringify(originalShape));
            this.renderData.animations[this.currentAnimation][this.currentFrame].shapes.push(newShape);
            this.selectedShapeIndex = this.renderData.animations[this.currentAnimation][this.currentFrame].shapes.length - 1;
            this.refreshShapes(true);
        }
    }

    deleteSelectedShape() {
        if (this.selectedShapeIndex >= 0) {
            this.renderData.animations[this.currentAnimation][this.currentFrame].shapes.splice(this.selectedShapeIndex, 1);
            if (this.renderData.animations[this.currentAnimation][this.currentFrame].shapes.length > 0) {
                this.selectedShapeIndex = Math.min(this.selectedShapeIndex, this.renderData.animations[this.currentAnimation][this.currentFrame].shapes.length - 1);
            } else {
                this.selectedShapeIndex = -1;
            }
            this.refreshShapes(true);
        }
    }

    scaleAllShapes() {
        const currentShapes = this.renderData.animations[this.currentAnimation][this.currentFrame].shapes;
        if (currentShapes.length === 0) return;
        const scaleFactor = parseFloat(prompt("Enter scale factor (e.g. 2 for double size, 0.5 for half size):", "1"));
        if (isNaN(scaleFactor) || scaleFactor <= 0) {
            alert("Please enter a valid positive number");
            return;
        }
        let centerX = 0, centerY = 0, centerZ = 0;
        currentShapes.forEach(shape => {
            centerX += shape.x || 0;
            centerY += shape.y || 0;
            centerZ += shape.z || 0;
        });
        centerX /= currentShapes.length;
        centerY /= currentShapes.length;
        centerZ /= currentShapes.length;
        currentShapes.forEach(shape => {
            if (shape.size) shape.size *= scaleFactor;
            if (shape.width) shape.width *= scaleFactor;
            if (shape.height) shape.height *= scaleFactor;
            if (shape.depth) shape.depth *= scaleFactor;
            if (shape.tubeSize) shape.tubeSize *= scaleFactor;
            shape.x = centerX + ((shape.x || 0) - centerX) * scaleFactor;
            shape.y = centerY + ((shape.y || 0) - centerY) * scaleFactor;
            shape.z = centerZ + ((shape.z || 0) - centerZ) * scaleFactor;
        });
        this.refreshShapes(true);
    }

    rotateAllShapes() {
        const currentShapes = this.renderData.animations[this.currentAnimation][this.currentFrame].shapes;
        if (currentShapes.length === 0) return;

        // Get modal elements
        const rotateModal = document.getElementById('rotate-modal');
        const rotateAngleInput = document.getElementById('rotate-angle');
        const rotateAxisSelect = document.getElementById('rotate-axis');
        const rotateCancelBtn = document.getElementById('rotate-cancel');
        const rotateApplyBtn = document.getElementById('rotate-apply');

        // Reset inputs to default values
        rotateAngleInput.value = "0";
        rotateAxisSelect.value = "y"; // Default to Y-axis

        // Show the modal
        rotateModal.classList.add('show');

        // Cancel button handler
        rotateCancelBtn.onclick = () => {
            rotateModal.classList.remove('show');
        };

        // Apply button handler
        rotateApplyBtn.onclick = () => {
            const angleDeg = parseFloat(rotateAngleInput.value);
            if (isNaN(angleDeg)) {
                alert("Please enter a valid angle");
                return;
            }

            const axis = rotateAxisSelect.value;
            const angleRad = angleDeg * Math.PI / 180;

            // Calculate the center of all shapes in the current frame
            let centerX = 0, centerY = 0, centerZ = 0;
            currentShapes.forEach(shape => {
                centerX += shape.x || 0;
                centerY += shape.y || 0;
                centerZ += shape.z || 0;
            });
            centerX /= currentShapes.length;
            centerY /= currentShapes.length;
            centerZ /= currentShapes.length;

            // Rotate shapes around the group center by adjusting positions
            currentShapes.forEach(shape => {
                const x = shape.x || 0;
                const y = shape.y || 0;
                const z = shape.z || 0;

                // Translate to origin relative to center
                const relX = x - centerX;
                const relY = y - centerY;
                const relZ = z - centerZ;

                // Apply rotation around the chosen axis
                if (axis === 'x') {
                    // X-axis rotation (y-z plane)
                    const newRelY = relY * Math.cos(angleRad) - relZ * Math.sin(angleRad);
                    const newRelZ = relY * Math.sin(angleRad) + relZ * Math.cos(angleRad);
                    shape.y = centerY + newRelY;
                    shape.z = centerZ + newRelZ;
                    // x remains unchanged
                } else if (axis === 'y') {
                    // Y-axis rotation (x-z plane)
                    const newRelX = relX * Math.cos(angleRad) + relZ * Math.sin(angleRad);
                    const newRelZ = -relX * Math.sin(angleRad) + relZ * Math.cos(angleRad);
                    shape.x = centerX + newRelX;
                    shape.z = centerZ + newRelZ;
                    // y remains unchanged
                } else if (axis === 'z') {
                    // Z-axis rotation (x-y plane)
                    const newRelX = relX * Math.cos(angleRad) - relY * Math.sin(angleRad);
                    const newRelY = relX * Math.sin(angleRad) + relY * Math.cos(angleRad);
                    shape.x = centerX + newRelX;
                    shape.y = centerY + newRelY;
                    // z remains unchanged
                }
                // Individual rotations (rotationX, rotationY, rotationZ) are preserved
            });

            // Update the scene and hide the modal
            this.refreshShapes(true);
            rotateModal.classList.remove('show');
        };
    }

    moveAllShapes() {
        if (this.renderData.animations[this.currentAnimation][this.currentFrame].shapes.length === 0) return;
        document.getElementById('modal-moveAllShapes').classList.add('show');
        document.getElementById('move-x').value = '0';
        document.getElementById('move-y').value = '0';
        document.getElementById('move-z').value = '0';
    }

    showIsometricModal() {
        document.getElementById('modal-generateIsoSprites').classList.add('show');
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
       
        for (const animType in this.renderData.animations) {
            sprites[animType] = [];
            for (let frameIndex = 0; frameIndex < this.renderData.animations[animType].length; frameIndex++) {
                const frame = this.renderData.animations[animType][frameIndex];
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
        this.displayIsometricSprites(sprites);
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

    addNewAnimation() {
        const animName = prompt("Enter animation name:", `anim${Object.keys(this.renderData.animations).length + 1}`);
        if (animName && !this.renderData.animations[animName]) {
            this.renderData.animations[animName] = [ ...this.renderData.animations["idle"] ];
            this.currentAnimation = animName;
            this.currentFrame = 0;
            this.refreshShapes(true);
        }
    }

    deleteAnimation() {
        if (this.currentAnimation !== "idle") {
            delete this.renderData.animations[this.currentAnimation];
            this.currentAnimation = "idle";
            this.currentFrame = 0;
            this.selectedShapeIndex = -1;
            this.refreshShapes(true);
        }
    }

    duplicateFrame() {
        if (this.renderData.animations[this.currentAnimation].length > 0) {
            const currentShapes = this.renderData.animations[this.currentAnimation][this.currentFrame];
            const newFrame = { shapes: JSON.parse(JSON.stringify(currentShapes.shapes)) };
            this.renderData.animations[this.currentAnimation].splice(this.currentFrame + 1, 0, newFrame);
            this.currentFrame++;
            this.refreshShapes(true);
        }
    }

    deleteFrame() {
        if (this.renderData.animations[this.currentAnimation].length > 1) {
            this.renderData.animations[this.currentAnimation].splice(this.currentFrame, 1);
            this.currentFrame = Math.min(this.currentFrame, this.renderData.animations[this.currentAnimation].length - 1);
            this.refreshShapes(true);
        }
    }

    refreshShapes(param) {
        this.updateShapeList();
        this.renderShapes(param);
    }

    updateShapeList() {
        const shapeList = document.getElementById('shape-list');
        shapeList.innerHTML = '';
    
        // Animation selector
        const animSelector = document.createElement('select');
        animSelector.style.marginBottom = '10px';
        Object.keys(this.renderData.animations).forEach(anim => {
            const option = document.createElement('option');
            option.value = anim;
            option.textContent = anim;
            if (anim === this.currentAnimation) option.selected = true;
            animSelector.appendChild(option);
        });
        animSelector.addEventListener('change', () => {
            this.setPreviewAnimationState(false);
            this.currentAnimation = animSelector.value;
            this.currentFrame = 0;
            this.selectedShapeIndex = -1;
            
            this.refreshShapes(false);
        });
        shapeList.appendChild(animSelector);
    
        // Frame list
        const frameList = document.createElement('div');
        frameList.style.marginBottom = '10px';
        this.renderData.animations[this.currentAnimation].forEach((frame, index) => {
            const frameItem = document.createElement('div');
            frameItem.textContent = `Frame ${index + 1}`;
            frameItem.style.padding = '5px';
            frameItem.style.cursor = 'pointer';
            if (index === this.currentFrame) frameItem.style.backgroundColor = '#555';
            frameItem.addEventListener('click', () => {
                this.setPreviewAnimationState(false);
                this.currentFrame = index;
                this.refreshShapes(false);
            });
            frameList.appendChild(frameItem);
        });
        shapeList.appendChild(frameList);
    
        // Shape list for current frame
        const currentShapes = this.renderData.animations[this.currentAnimation][this.currentFrame].shapes;
        if (currentShapes.length === 0) {
            const emptyMessage = document.createElement('div');
            emptyMessage.textContent = 'No shapes in this frame.';
            emptyMessage.style.padding = '10px';
            emptyMessage.style.color = '#777';
            shapeList.appendChild(emptyMessage);
            document.getElementById('selected-shape').textContent = 'None';
            return;
        }
    
        currentShapes.forEach((shape, index) => {
            const shapeItem = document.createElement('div');
            shapeItem.className = 'shape-item';
            if (index === this.selectedShapeIndex) {
                shapeItem.classList.add('active');
                document.getElementById('selected-shape').textContent = `${shape.type} (${index})`;
            }
            const title = document.createElement('div');
            title.textContent = `${index + 1}. ${shape.name || shape.type} ${shape.color}`;
            title.style.fontWeight = 'bold';
            title.style.marginBottom = '5px';
            shapeItem.appendChild(title);
            const position = document.createElement('div');
            position.textContent = `Position: X=${shape.x || 0}, Y=${shape.y || 0}, Z=${shape.z || 0}`;
            position.style.fontSize = '12px';
            shapeItem.appendChild(position);
            shapeItem.addEventListener('click', () => {
                this.selectShape(index);
                this.createInspector(shape);
            });
            shapeList.appendChild(shapeItem);
        });
    
        if (this.selectedShapeIndex >= 0) {
            let shape = currentShapes[this.selectedShapeIndex];
            if (shape) {
                this.createInspector(shape);
            } else {
                const inspector = document.getElementById('inspector');
                inspector.innerHTML = "";
                this.selectedShapeIndex = -1;
                this.refreshShapes(true);
            }
        }
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
                    delete this.renderData.animations[this.currentAnimation][this.currentFrame].shapes[this.selectedShapeIndex].url
                } 
                
                this.renderData.animations[this.currentAnimation][this.currentFrame].shapes[this.selectedShapeIndex]['type'] = newValue;
                this.refreshShapes(false);
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
                     this.renderData.animations[this.currentAnimation][this.currentFrame].shapes[this.selectedShapeIndex][property] = result.filePath;
                     this.refreshShapes(false);
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
                this.renderData.animations[this.currentAnimation][this.currentFrame].shapes[this.selectedShapeIndex][property] = newValue;
                this.refreshShapes(true);
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
            
            this.renderData.animations[this.currentAnimation][this.currentFrame].shapes[this.selectedShapeIndex][property] = newValue;
            this.refreshShapes(false);
        }));
        
        row.appendChild(input);
        container.appendChild(row);
        return input;
    }

    importJSON() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        
        input.addEventListener('change', e => {
            const file = e.target.files[0];
            if (!file) return;
            
            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const importedData = JSON.parse(event.target.result);
                    this.renderData = importedData;
                    this.selectedShapeIndex = this.renderData.animations.idle[0].shapes.length > 0 ? 0 : -1;
                    
                    this.refreshShapes(true);
                    
                    // Reset camera position
                    this.camera.position.set(0, 5, 10);
                    this.controls.target.set(0, 0, 0);
                } catch (error) {
                    alert('Invalid JSON file: ' + error.message);
                }
            };
            reader.readAsText(file);
        });
        
        input.click();
    }

    applyJSON() {
        try {
            const newData = JSON.parse(document.getElementById('json-content').value);
            this.renderData = newData;
            this.selectedShapeIndex = this.renderData.animations.idle[0].shapes.length > 0 ? 0 : -1;
            
            this.refreshShapes(true);
        } catch (error) {
            alert('Invalid JSON: ' + error.message);
        }
    }


}
