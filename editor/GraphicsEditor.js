import * as THREE from '/library/three.module.min.js';
import { OrbitControls } from '/library/three.orbitControls.js';

class GraphicsEditor {
    constructor(containerId = 'graphics-editor-container', canvasId = 'canvas') {
        // DOM elements
        this.container = document.getElementById(containerId);
        this.canvas = document.getElementById(canvasId);

        // Three.js core components
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;

        // Interaction components
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
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
        this.container.classList.add('show');
        this.initThreeJS();
        this.initEventListeners();
        this.renderShapes(false);
        this.updateShapeList();
        this.animate();
    }

    initThreeJS() {
        // Scene setup
        this.scene = new THREE.Scene();
        
        // Camera setup
        this.camera = new THREE.PerspectiveCamera(
            75, 
            this.canvas.clientWidth / this.canvas.clientHeight, 
            0.1, 
            1000
        );
        this.camera.position.set(100, 100, 100);
        this.camera.lookAt(0, 0, 0);

        // Renderer setup
        this.renderer = new THREE.WebGLRenderer({ 
            canvas: this.canvas, 
            antialias: false, 
            alpha: true 
        });
        this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight);

        // Add helpers
        const gridHelper = new THREE.GridHelper(100, 100);
        this.scene.add(gridHelper);

        const axesHelper = new THREE.AxesHelper(5);
        this.scene.add(axesHelper);

        // Orbit controls
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
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
        document.body.addEventListener('renderObject', this.handleRenderObject.bind(this));
        
        // Move modal listeners
        document.getElementById('move-cancel').addEventListener('click', () => {
            document.getElementById('move-modal').classList.remove('show');
        });

        document.getElementById('move-apply').addEventListener('click', this.applyMoveModal.bind(this));

        // Isometric modal listeners
        document.getElementById('iso-cancel').addEventListener('click', () => {
            document.getElementById('isometric-modal').classList.remove('show');
        });
        document.getElementById('iso-generate').addEventListener('click', this.generateIsometricSprites.bind(this));
    }

    handleRenderObject(event) {
        this.setPreviewAnimationState(false);
        this.renderData = event.detail;
        document.getElementById('json-content').value = JSON.stringify(this.renderData, null, 2);
        this.currentAnimation = "idle";
        this.selectedShapeIndex = this.renderData.animations.idle[0].shapes.length > 0 ? 0 : -1;                
        this.renderShapes(false);
        this.updateShapeList();
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
        this.renderShapes(true);
        this.updateShapeList();
        
        // Hide the modal
        document.getElementById('move-modal').classList.remove('show');
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
        const intersects = this.raycaster.intersectObjects(shapes);

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

    togglePreview(e) {
        this.isPreviewingAnimation = !this.isPreviewingAnimation;
        this.animatePreview();
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

    animatePreview() {
        if (!this.isPreviewingAnimation) return;
        this.currentFrame = (this.currentFrame + 1) % this.renderData.animations[this.currentAnimation].length;
        this.renderShapes(false);
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
            this.selectedShapeIndex >= this.renderData.animations.idle[0].shapes.length) {
            return;
        }

        // Find the selected mesh
        const selectedMesh = this.scene.children.find(obj => 
            obj.userData.isShape && obj.userData.index === this.selectedShapeIndex
        );
        
        if (selectedMesh) {
            // Store original material
            this.originalMaterials.set(selectedMesh, selectedMesh.material);
            
            // Create a new material based on the original one but with emissive glow
            const highlightMaterial = selectedMesh.material.clone();
            highlightMaterial.emissive = new THREE.Color(0x555555);
            highlightMaterial.emissiveIntensity = 0.5;
            
            // Apply the highlight material
            selectedMesh.material = highlightMaterial;
            
            // Create outline
            const outlineGeometry = selectedMesh.geometry.clone();
            const outlineMaterial = new THREE.MeshBasicMaterial({ 
                color: 0xffff00, 
                side: THREE.BackSide 
            });
            
            const outline = new THREE.Mesh(outlineGeometry, outlineMaterial);
            outline.position.copy(selectedMesh.position);
            outline.rotation.copy(selectedMesh.rotation);
            outline.scale.multiplyScalar(1.05);
            outline.userData.isOutline = true;
            
            this.scene.add(outline);
        }
    }

    renderShapes(fireSave = true) {
        // Clear existing shapes
        const objectsToRemove = [];
        this.scene.traverse(object => {
            if (object.userData.isShape || object.userData.isOutline) {
                objectsToRemove.push(object);
            }
        });
        
        objectsToRemove.forEach(obj => {
            this.scene.remove(obj);
            if(obj.geometry) obj.geometry.dispose();
            if(obj.material) {
                if(obj.material.map) obj.material.map.dispose(); // dispose textures
                obj.material.dispose();
            }
        });
        
        // Add lights if they don't exist
        if (!this.scene.getObjectByName('ambient-light')) {
            const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
            ambientLight.name = 'ambient-light';
            this.scene.add(ambientLight);
            
            const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
            directionalLight.position.set(5, 10, 7.5);
            directionalLight.name = 'dir-light';
            this.scene.add(directionalLight);
        }
        const currentShapes = this.renderData.animations[this.currentAnimation][this.currentFrame];
        this.createObjectsFromJSON(currentShapes, this.scene);
        
        // Update shape count
        document.getElementById('shape-count').textContent = currentShapes.shapes.length;
        
        // Update the JSON editor
        document.getElementById('json-content').value = JSON.stringify(this.renderData, null, 2);

        if(fireSave){
            // Create a custom event with data
            const myCustomEvent = new CustomEvent('saveObjectGraphics', {
                detail: this.renderData, 
                bubbles: true, 
                cancelable: true 
            });

            // Dispatch the event
            document.body.dispatchEvent(myCustomEvent);
        }
        // Highlight the selected shape (if any)
        this.highlightSelectedShape();
    }

    createObjectsFromJSON(shapeData, scene) {
        shapeData.shapes.forEach((shape, index) => {
            let geometry, material, mesh;

            // Create material with the specified color
            material = new THREE.MeshStandardMaterial({ color: shape.color });

            // Create geometry based on shape type
            if (shape.type === 'sphere') {
                geometry = new THREE.SphereGeometry(shape.size / 2, 32, 32);
            }
            else if (shape.type === 'cube') {
                geometry = new THREE.BoxGeometry(shape.size, shape.size, shape.size);
            }
            else if (shape.type === 'box') {
                geometry = new THREE.BoxGeometry(shape.width, shape.height, shape.depth || shape.width);
            }
            else if (shape.type === 'cylinder') {
                geometry = new THREE.CylinderGeometry(shape.size / 2, shape.size / 2, shape.height, 32);
            }
            else if (shape.type === 'cone') {
                geometry = new THREE.ConeGeometry(shape.size / 2, shape.height, 32);
            }
            else if (shape.type === 'torus') {
                geometry = new THREE.TorusGeometry(shape.size / 2, shape.tubeSize || shape.size / 6, 16, 100);
            }
            else if (shape.type === 'tetrahedron') {
                geometry = new THREE.TetrahedronGeometry(shape.size / 2);
            }
            
            if (geometry) {
                const mesh = new THREE.Mesh(geometry, material);
                mesh.userData.isShape = true;                    
                mesh.userData.index = index;

                // Position and rotation
                mesh.position.set(shape.x || 0, shape.y || 0, shape.z || 0);
                
                // Handle rotation (convert from degrees to radians)
                if (shape.rotationX) mesh.rotation.x = shape.rotationX * Math.PI / 180;
                if (shape.rotationY) mesh.rotation.y = shape.rotationY * Math.PI / 180;
                if (shape.rotationZ) mesh.rotation.z = shape.rotationZ * Math.PI / 180;
                
                scene.add(mesh);
            }
        });
    }

    addNewShape() {
        const newShape = {
            type: 'cube',
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
        this.renderShapes(true);
        this.updateShapeList();
    }

    duplicateSelectedShape() {
        if (this.selectedShapeIndex >= 0) {
            const originalShape = this.renderData.animations[this.currentAnimation][this.currentFrame].shapes[this.selectedShapeIndex];
            const newShape = JSON.parse(JSON.stringify(originalShape));
            this.renderData.animations[this.currentAnimation][this.currentFrame].shapes.push(newShape);
            this.selectedShapeIndex = this.renderData.animations[this.currentAnimation][this.currentFrame].shapes.length - 1;
            this.renderShapes(true);
            this.updateShapeList();
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
            this.renderShapes(true);
            this.updateShapeList();
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
        this.renderShapes(true);
        this.updateShapeList();
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
            this.renderShapes(true);
            this.updateShapeList();
            rotateModal.classList.remove('show');
        };
    }

    moveAllShapes() {
        if (this.renderData.animations[this.currentAnimation][this.currentFrame].shapes.length === 0) return;
        document.getElementById('move-modal').classList.add('show');
        document.getElementById('move-x').value = '0';
        document.getElementById('move-y').value = '0';
        document.getElementById('move-z').value = '0';
    }

    showIsometricModal() {
        document.getElementById('isometric-modal').classList.add('show');
    }

    generateIsometricSprites() {
        const frustumSize = parseFloat(document.getElementById('iso-frustum').value) || 48;
        const cameraDistance = parseFloat(document.getElementById('iso-distance').value) || 100;
        const size = parseFloat(document.getElementById('iso-size').value) || 64;
        const aspect = 1;
        const tempRenderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
        tempRenderer.setSize(size, size);
        document.getElementById('isometric-modal').classList.remove('show');

        const renderTarget = new THREE.WebGLRenderTarget(size, size);
        const cameras = [
            new THREE.OrthographicCamera(-frustumSize * aspect, frustumSize * aspect, frustumSize, -frustumSize, 0.1, 1000),
            new THREE.OrthographicCamera(-frustumSize * aspect, frustumSize * aspect, frustumSize, -frustumSize, 0.1, 1000),
            new THREE.OrthographicCamera(-frustumSize * aspect, frustumSize * aspect, frustumSize, -frustumSize, 0.1, 1000),
            new THREE.OrthographicCamera(-frustumSize * aspect, frustumSize * aspect, frustumSize, -frustumSize, 0.1, 1000)
        ];
        cameras[0].position.set(cameraDistance, cameraDistance, cameraDistance);
        cameras[1].position.set(-cameraDistance, cameraDistance, cameraDistance);
        cameras[2].position.set(cameraDistance, cameraDistance, -cameraDistance);
        cameras[3].position.set(-cameraDistance, cameraDistance, -cameraDistance);
        cameras.forEach(camera => camera.lookAt(0, 0, 0));

        const sprites = {};
        for (const animType in this.renderData.animations) {
            sprites[animType] = [];
            this.renderData.animations[animType].forEach(frame => {
                const scene = new THREE.Scene();
                const light = new THREE.AmbientLight(0xffffff, 5);
                scene.add(light);
                this.createObjectsFromJSON(frame, scene);

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
            });
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

        for (const animType in sprites) {
            const animSection = document.createElement('div');
            const title = document.createElement('h3');
            title.textContent = `${animType} Animation`;
            title.style.color = '#e0e0e0';
            animSection.appendChild(title);

            const grid = document.createElement('div');
            grid.style.cssText = `display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px; margin: 10px 0;`;
            sprites[animType].forEach(frame => {
                frame.forEach(src => {
                    const img = document.createElement('img');
                    img.src = src;
                    img.style.maxWidth = '100%';
                    grid.appendChild(img);
                });
            });
            animSection.appendChild(grid);
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
            this.renderShapes(true);
            this.updateShapeList();
        }
    }

    deleteAnimation() {
        if (this.currentAnimation !== "idle") {
            delete this.renderData.animations[this.currentAnimation];
            this.currentAnimation = "idle";
            this.currentFrame = 0;
            this.selectedShapeIndex = -1;
            this.renderShapes(true);
            this.updateShapeList();
        }
    }

    duplicateFrame() {
        if (this.renderData.animations[this.currentAnimation].length > 0) {
            const currentShapes = this.renderData.animations[this.currentAnimation][this.currentFrame];
            const newFrame = { shapes: JSON.parse(JSON.stringify(currentShapes.shapes)) };
            this.renderData.animations[this.currentAnimation].splice(this.currentFrame + 1, 0, newFrame);
            this.currentFrame++;
            this.renderShapes(true);
            this.updateShapeList();
        }
    }

    deleteFrame() {
        if (this.renderData.animations[this.currentAnimation].length > 1) {
            this.renderData.animations[this.currentAnimation].splice(this.currentFrame, 1);
            this.currentFrame = Math.min(this.currentFrame, this.renderData.animations[this.currentAnimation].length - 1);
            this.renderShapes(true);
            this.updateShapeList();
        }
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
            this.renderShapes(true);
            this.updateShapeList();
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
                this.renderShapes(true);
                this.updateShapeList();
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
                this.renderShapes(true);
                this.updateShapeList();
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
            options: ['cube', 'sphere', 'box', 'cylinder', 'cone', 'torus', 'tetrahedron']
        });
        
        // Color picker
        this.addFormRow(inspector, 'Color', 'color', 'color', shape.color);
        
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
                this.renderShapes(true);
                this.updateShapeList();
            });
            row.appendChild(colorInput);
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
        
        input.addEventListener('change', () => {
            let newValue = input.value;
            
            if (type === 'number') {
                newValue = parseFloat(newValue);
            }
            
            this.renderData.animations[this.currentAnimation][this.currentFrame].shapes[this.selectedShapeIndex][property] = newValue;
            this.renderShapes(true);
            this.updateShapeList();
        });
        
        row.appendChild(input);
        container.appendChild(row);
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
                    
                    this.renderShapes(true);
                    this.updateShapeList();
                    
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
            
            this.renderShapes(true);
            this.updateShapeList();
        } catch (error) {
            alert('Invalid JSON: ' + error.message);
        }
    }

    // You might want to add this method to complete initialization
    init() {
        this.container.classList.add('show');
        this.initThreeJS();
        this.initEventListeners();
        this.renderShapes(false);
        this.updateShapeList();
        this.animate();
    }
}

export { GraphicsEditor };