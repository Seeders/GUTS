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

    // Convert hex color string to RGB object
    hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : null;
    }

    // Find nearest color in palette
    findNearestPaletteColor(r, g, b, palette) {
        let minDistance = Infinity;
        let nearestColor = palette[0];

        for (const color of palette) {
            // Color can be either a hex string or an RGB object
            const paletteRgb = typeof color === 'string' ? this.hexToRgb(color) : color;
            if (!paletteRgb) continue;

            // Calculate euclidean distance in RGB space
            const distance = Math.sqrt(
                Math.pow(r - paletteRgb.r, 2) +
                Math.pow(g - paletteRgb.g, 2) +
                Math.pow(b - paletteRgb.b, 2)
            );

            if (distance < minDistance) {
                minDistance = distance;
                nearestColor = color;
            }
        }

        // Return RGB object directly if color is already RGB, otherwise convert from hex
        return typeof nearestColor === 'string' ? this.hexToRgb(nearestColor) : nearestColor;
    }

    // Apply palette to image data
    applyPaletteToCanvas(canvas, paletteColors) {
        const ctx = canvas.getContext('2d');
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const a = data[i + 3];

            // Skip fully transparent pixels
            if (a === 0) continue;

            // Find nearest palette color
            const nearest = this.findNearestPaletteColor(r, g, b, paletteColors);
            data[i] = nearest.r;
            data[i + 1] = nearest.g;
            data[i + 2] = nearest.b;
        }

        ctx.putImageData(imageData, 0, 0);
    }

    // Apply outline to sprite
    applyOutlineToCanvas(canvas, outlineColorHex, position = 'outset', connectivity = 8, pixelSize = 1) {
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;

        // Convert outline color from hex to RGB
        const outlineColor = this.hexToRgb(outlineColorHex);
        if (!outlineColor) return;

        // Create a copy of the alpha channel to detect edges
        const alphaMap = new Uint8Array(width * height);
        for (let i = 0; i < data.length; i += 4) {
            alphaMap[i / 4] = data[i + 3];
        }

        // Create outline data
        const outlineData = new Uint8ClampedArray(data.length);
        outlineData.set(data);

        // Define base neighbor offsets based on connectivity
        // 4-connectivity: only adjacent (no diagonals)
        // 8-connectivity: adjacent + diagonals
        const baseOffsets = connectivity === 4
            ? [[-1, 0], [1, 0], [0, -1], [0, 1]]
            : [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

        // Expand neighbor offsets based on pixel size to create thicker outlines
        const neighborOffsets = [];
        for (const [baseX, baseY] of baseOffsets) {
            for (let i = 0; i < pixelSize; i++) {
                // Scale the offset by pixel size
                const scale = i + 1;
                neighborOffsets.push([baseX * scale, baseY * scale]);
            }
        }

        // Check each pixel for edges
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                const pixelIdx = idx * 4;

                const isOpaque = alphaMap[idx] > 0;

                // For outset: check transparent pixels next to opaque ones
                // For inset: check opaque pixels next to transparent ones
                if ((position === 'outset' && isOpaque) || (position === 'inset' && !isOpaque)) {
                    continue;
                }

                // Check neighbors for edge condition
                let hasEdgeNeighbor = false;
                for (const [dx, dy] of neighborOffsets) {
                    const nx = x + dx;
                    const ny = y + dy;

                    if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                        const neighborIdx = ny * width + nx;
                        const neighborIsOpaque = alphaMap[neighborIdx] > 0;

                        // For outset: looking for opaque neighbors from transparent pixel
                        // For inset: looking for transparent neighbors from opaque pixel
                        if ((position === 'outset' && neighborIsOpaque) ||
                            (position === 'inset' && !neighborIsOpaque)) {
                            hasEdgeNeighbor = true;
                            break;
                        }
                    }
                }

                // Apply outline color if this is an edge pixel
                if (hasEdgeNeighbor) {
                    outlineData[pixelIdx] = outlineColor.r;
                    outlineData[pixelIdx + 1] = outlineColor.g;
                    outlineData[pixelIdx + 2] = outlineColor.b;
                    outlineData[pixelIdx + 3] = 255;
                }
            }
        }

        // Put the modified data back
        imageData.data.set(outlineData);
        ctx.putImageData(imageData, 0, 0);
    }

    // Setup THREE.RenderPixelatedPass for sprite rendering (uses same library as game)
    setupPixelatedComposer(renderer, scene, camera, pixelSize, size) {
        if (pixelSize <= 1) return null;

        // Create EffectComposer - let it create its own render targets
        const composer = new GUTS.EffectComposer(renderer);

        // Add the pixelated render pass (same as game uses)
        const pixelPass = new GUTS.RenderPixelatedPass(pixelSize, scene, camera);
        pixelPass.normalEdgeStrength = 0;
        composer.addPass(pixelPass);

        // Add output pass
        const outputPass = new GUTS.OutputPass();
        composer.addPass(outputPass);

        return composer;
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
        document.getElementById('iso-generate').addEventListener('click', () => this.generateIsometricSprites());
    }
    initThreeJS() {
        // Scene setup
        this.scene = new THREE.Scene();
        
        // Add the root group to the scene
        this.scene.add(this.graphicsEditor.rootGroup);

        // Camera setup
        this.camera = new THREE.PerspectiveCamera(
            75, 
            this.graphicsEditor.canvas.clientWidth / this.graphicsEditor.canvas.clientHeight, 
            0.1, 
            1000
        );
        this.camera.position.set(100, 100, 100);
        this.camera.lookAt(0, 0, 0);

        // Renderer setup
        this.renderer = new THREE.WebGLRenderer({ 
            canvas: this.graphicsEditor.canvas, 
            antialias: false, 
            alpha: true 
        });
        this.renderer.setSize(this.graphicsEditor.canvas.clientWidth, this.graphicsEditor.canvas.clientHeight);

        // Add helpers (mark them so we can hide during sprite generation)
        const gridHelper = new THREE.GridHelper(100, 10);
        gridHelper.userData.isEditorHelper = true;
        this.scene.add(gridHelper);

        const axesHelper = new THREE.AxesHelper(10);
        axesHelper.userData.isEditorHelper = true;
        this.scene.add(axesHelper);

        // Orbit controls
        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
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

    copyEquipmentToScene(targetScene) {
        // Copy equipment from main editor scene to target scene
        // Find equipment in main scene (marked with userData.isEquipment)
        const equipmentModels = [];
        this.scene.traverse(child => {
            if (child.userData?.isEquipment) {
                equipmentModels.push({
                    model: child,
                    boneName: child.parent?.isBone ? child.parent.name : null
                });
            }
        });

        if (equipmentModels.length === 0) {
            return;
        }

        console.log('[Equipment] Copying', equipmentModels.length, 'equipment items from main scene');

        // Find bones in target scene
        const targetBonesMap = new Map();
        targetScene.traverse(child => {
            if (child.isBone) {
                targetBonesMap.set(child.name, child);
            }
        });

        // Clone and attach equipment to target scene
        for (const {model, boneName} of equipmentModels) {
            const clonedEquipment = model.clone();

            if (boneName) {
                const targetBone = targetBonesMap.get(boneName);
                if (targetBone) {
                    targetBone.add(clonedEquipment);
                    console.log('[Equipment] Copied equipment to bone:', boneName);
                } else {
                    console.warn(`Bone "${boneName}" not found in target scene`);
                    targetScene.add(clonedEquipment);
                }
            } else {
                targetScene.add(clonedEquipment);
            }
        }
    }
    
    async generateIsometricSprites(brightness = null, paletteColors = null) {
        const frustumSize = parseFloat(document.getElementById('iso-frustum').value) || 48;
        const cameraDistance = parseFloat(document.getElementById('iso-distance').value) || 100;
        const size = parseFloat(document.getElementById('iso-size').value) || 64;
        const animationFPS = parseInt(document.getElementById('iso-fps').value) || 4;

        // Get brightness from slider if not provided
        const ambientBrightness = brightness !== null ? brightness : parseFloat(document.getElementById('iso-brightness').value) || 2.5;

        // Get palette from selector if not provided
        let finalPaletteColors = paletteColors;
        if (!finalPaletteColors) {
            const paletteName = document.getElementById('iso-palette').value;
            if (paletteName) {
                const palette = this.graphicsEditor.gameEditor.getCollections()?.palettes?.[paletteName];
                if (palette) {
                    // Extract color values from palette object (skip 'title' property)
                    finalPaletteColors = Object.entries(palette)
                        .filter(([key]) => key !== 'title')
                        .map(([_, color]) => {
                            // Convert hex to RGB
                            const hex = color.replace('#', '');
                            return {
                                r: parseInt(hex.substring(0, 2), 16),
                                g: parseInt(hex.substring(2, 4), 16),
                                b: parseInt(hex.substring(4, 6), 16)
                            };
                        });
                    console.log('Extracted palette colors:', finalPaletteColors.length, 'colors');
                }
            }
        }

        // Get pixel size for pixelation effect
        const pixelSize = parseInt(document.getElementById('iso-pixel-size').value) || 1;

        // Get outline options
        const outlineColor = document.getElementById('iso-outline').value || '';
        const outlinePosition = 'outset'; // Always use outside outline
        const outlineConnectivity = parseInt(document.getElementById('iso-outline-connectivity').value) || 8;

        const aspect = 1;
        const tempRenderer = new window.THREE.WebGLRenderer({ antialias: false, alpha: true });
        tempRenderer.setSize(size, size);
        // Match the main editor renderer settings - no special color management
        tempRenderer.outputEncoding = THREE.LinearEncoding;
        // Don't close the modal - keep it open for adjustments
        // document.getElementById('modal-generateIsoSprites').classList.remove('show');
    
        const renderTarget = new window.THREE.WebGLRenderTarget(size, size);
        // All 8 directions: Down, DownLeft, Left, UpLeft, Up, UpRight, Right, DownRight
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

        // Get height from current selected object
        let modelHeight = 0;
        const currentObject = this.graphicsEditor.gameEditor.getCurrentObject();
        if (currentObject && currentObject.height) {
            modelHeight = currentObject.height;
        }

        // Position cameras for all 8 directions
        // Camera height multiplier for steeper angle (matches in-game perspective)
        const cameraHeightMultiplier = parseFloat(document.getElementById('iso-camera-height').value) || 1.5;
        const cameraHeight = cameraDistance * cameraHeightMultiplier;

        // Down, DownLeft, Left, UpLeft, Up, UpRight, Right, DownRight
        cameras[0].position.set(0, cameraHeight, cameraDistance);                       // Down (S)
        cameras[1].position.set(cameraDistance, cameraHeight, cameraDistance);          // DownLeft (SW)
        cameras[2].position.set(cameraDistance, cameraHeight, 0);                       // Left (W)
        cameras[3].position.set(cameraDistance, cameraHeight, -cameraDistance);         // UpLeft (NW)
        cameras[4].position.set(0, cameraHeight, -cameraDistance);                      // Up (N)
        cameras[5].position.set(-cameraDistance, cameraHeight, -cameraDistance);        // UpRight (NE)
        cameras[6].position.set(-cameraDistance, cameraHeight, 0);                      // Right (E)
        cameras[7].position.set(-cameraDistance, cameraHeight, cameraDistance);         // DownRight (SE)

        // Point cameras at center of model (half the model height)
        const lookAtY = modelHeight / 2;
        cameras.forEach(camera => camera.lookAt(0, lookAtY, 0));
    
        // Use the main editor scene which already has everything loaded properly
        const scene = this.scene;

        // Find the character model already in the scene
        // For animated models, look for skeleton; for static buildings, just look for GLTF root
        let characterModel = null;
        let characterMixer = null;

        console.log('[SpriteGen] Searching for models in scene...');
        scene.traverse(child => {
            console.log('[SpriteGen] Child:', child.name, 'isGLTFRoot:', child.userData?.isGLTFRoot, 'hasSkeleton:', !!child.userData?.skeleton);
            if (child.userData?.isGLTFRoot) {
                // Prefer models with skeleton (animated characters) over static models
                if (!characterModel || child.userData?.skeleton) {
                    characterModel = child;
                    console.log('[SpriteGen] Selected model:', child.name);
                    // Only create mixer if there's a skeleton
                    if (child.userData?.skeleton) {
                        if (!child.userData.mixer) {
                            child.userData.mixer = new THREE.AnimationMixer(child);
                        }
                        characterMixer = child.userData.mixer;
                    }
                }
            }
        });

        if (!characterModel) {
            console.error('[SpriteGen] No character model found in scene');
            return;
        }

        console.log('[SpriteGen] Final model selected:', characterModel.name, 'hasMixer:', !!characterMixer);

        // Flag to check if this is a static building (no animations)
        const isStaticBuilding = !characterMixer;

        // Hide editor helpers (grid, axes, etc.) and gizmos during sprite generation
        const hiddenHelpers = [];
        scene.traverse(child => {
            if (child.userData?.isEditorHelper && child.visible) {
                child.visible = false;
                hiddenHelpers.push(child);
            }
        });

        // Hide gizmo if it exists
        const gizmoGroup = this.graphicsEditor.gizmoManager?.gizmoGroup;
        const gizmoWasVisible = gizmoGroup?.visible;
        if (gizmoGroup) {
            gizmoGroup.visible = false;
        }

        // Update ambient light brightness
        const originalAmbientIntensity = [];
        scene.traverse(child => {
            if (child.isAmbientLight) {
                originalAmbientIntensity.push({ light: child, intensity: child.intensity });
                child.intensity = ambientBrightness;
            }
        });

        const sprites = {};

        // For static buildings with no animations, generate a single sprite
        const animations = this.graphicsEditor.state.renderData.animations || {};

        // Check if this is effectively a static model (no skeleton OR no meaningful animation data)
        const hasAnimationData = Object.values(animations).some(frames =>
            frames && frames.length > 0 && frames.some(frame => {
                // Check for animation GLB in main.shapes structure
                const shapes = frame?.main?.shapes || [];
                return shapes.some(s => s?.url && s.url.includes('animations/'));
            })
        );

        console.log('[SpriteGen] isStaticBuilding:', isStaticBuilding, 'hasAnimationData:', hasAnimationData, 'animations:', Object.keys(animations));

        if (isStaticBuilding && (!hasAnimationData || Object.keys(animations).length === 0)) {
            console.log('[SpriteGen] Generating static building sprites...');
            // Generate a single static sprite from all camera angles
            // Structure: sprites['idle'][0] = [8 directional sprites]
            sprites['idle'] = [[]];

            for (const camera of cameras) {
                const composer = this.setupPixelatedComposer(tempRenderer, scene, camera, pixelSize, size);

                const buffer = new Uint8Array(size * size * 4);
                if (composer) {
                    tempRenderer.setSize(size, size);
                    composer.setSize(size, size);
                    tempRenderer.setRenderTarget(null);
                    composer.render();

                    const gl = tempRenderer.getContext();
                    gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, buffer);
                } else {
                    tempRenderer.setRenderTarget(renderTarget);
                    tempRenderer.render(scene, camera);
                    tempRenderer.setRenderTarget(null);
                    tempRenderer.readRenderTargetPixels(renderTarget, 0, 0, size, size, buffer);
                }

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
                const imageData = new ImageData(new Uint8ClampedArray(flippedBuffer), size, size);
                ctx.putImageData(imageData, 0, 0);

                // Apply palette if selected
                if (finalPaletteColors && finalPaletteColors.length > 0) {
                    this.applyPaletteToCanvas(canvas, finalPaletteColors);
                }

                // Apply outline if selected
                if (outlineColor && outlineColor !== '') {
                    this.applyOutlineToCanvas(canvas, outlineColor, outlinePosition, outlineConnectivity, pixelSize);
                }

                sprites['idle'][0].push(canvas.toDataURL('image/png'));
            }
        } else {
            // Only process animation loop if we didn't generate static building sprites
            for (const animType in animations) {
            sprites[animType] = [];
            const animationFrames = this.graphicsEditor.state.renderData.animations[animType];
            console.log(`Processing animation: ${animType}, sprite size: ${size}`);

            // Process each frame definition in the animation
            for (let frameIndex = 0; frameIndex < animationFrames.length; frameIndex++) {
                const frame = animationFrames[frameIndex];

                // For GLTF models with animations, we need to load base model + apply animation
                // Check if this frame has animation GLB
                const hasAnimationGLB = frame?.main?.shapes?.some(s =>
                    s.url && s.url.includes('animations/') && (s.url.endsWith('.glb') || s.url.endsWith('.gltf'))
                );

                if (hasAnimationGLB) {
                    // Find the animation shape
                    const animShape = frame?.main?.shapes?.find(s =>
                        s.url && s.url.includes('animations/') && (s.url.endsWith('.glb') || s.url.endsWith('.gltf'))
                    );

                    if (animShape) {
                        // Load and apply animation to the existing character model
                        const gltfPath = this.graphicsEditor.shapeFactory.getResourcesPath(animShape.url);
                        const animationClip = await new Promise((resolve) => {
                            this.graphicsEditor.shapeFactory.gltfLoader.load(gltfPath, (gltf) => {
                                if (gltf.animations && gltf.animations.length > 0) {
                                    const clip = gltf.animations[0];
                                    // Apply animation to the existing character
                                    characterMixer.stopAllAction();
                                    const action = characterMixer.clipAction(clip);
                                    action.play();
                                    resolve(clip);
                                } else {
                                    resolve(null);
                                }
                            }, undefined, () => resolve(null));
                        });

                        // Generate multiple sprite frames by advancing through the animation
                        if (animationClip) {
                            const animDuration = animationClip.duration;
                            // Calculate frame count based on FPS and animation duration
                            // Add 1 to include both first and last frame of animation
                            const framesForThisAnim = Math.max(2, Math.ceil(animDuration * animationFPS) + 1);
                            // Distribute frames evenly so first frame is at t=0 and last frame is at t=duration
                            const timeStep = animDuration / (framesForThisAnim - 1);

                            console.log(`[SpriteGen] Animation "${animType}": duration=${animDuration.toFixed(2)}s, fps=${animationFPS}, frames=${framesForThisAnim}`);

                            for (let snapIndex = 0; snapIndex < framesForThisAnim; snapIndex++) {
                                // Clamp to ensure last frame is exactly at animation end
                                const currentTime = Math.min(snapIndex * timeStep, animDuration);

                                // Update mixer to specific time in animation
                                characterMixer.setTime(currentTime);

                                // Render from all camera angles
                                const frameSprites = [];
                                for (const camera of cameras) {
                                    // Setup composer with pixelation pass if needed
                                    const composer = this.setupPixelatedComposer(tempRenderer, scene, camera, pixelSize, size);

                                        const buffer = new Uint8Array(size * size * 4);
                                    if (composer) {
                                        // Use composer for pixelated rendering
                                        // Render to screen (null) then read from canvas
                                        tempRenderer.setSize(size, size); // Ensure renderer size is correct
                                        composer.setSize(size, size);
                                        tempRenderer.setRenderTarget(null);
                                        composer.render();

                                        // Read directly from the WebGL canvas
                                        const gl = tempRenderer.getContext();
                                        gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, buffer);
                                    } else {
                                        // Normal rendering without pixelation
                                        tempRenderer.setRenderTarget(renderTarget);
                                        tempRenderer.render(scene, camera);
                                        tempRenderer.setRenderTarget(null);
                                        // Read from render target
                                        tempRenderer.readRenderTargetPixels(renderTarget, 0, 0, size, size, buffer);
                                    }

                                    const flippedBuffer = new Uint8Array(size * size * 4);
                                    for (let y = 0; y < size; y++) {
                                        const srcRowStart = y * size * 4;
                                        const destRowStart = (size - 1 - y) * size * 4;
                                        flippedBuffer.set(buffer.subarray(srcRowStart, srcRowStart + size * 4), destRowStart);
                                    }
                                    const canvas = document.createElement('canvas');
                                    canvas.width = size;
                                    canvas.height = size;
                                    if (animType === 'celebrate') {
                                        console.log(`Celebrate canvas size: ${canvas.width}x${canvas.height}, requested size: ${size}`);
                                    }
                                    const ctx = canvas.getContext('2d');
                                    const imageData = ctx.createImageData(size, size);
                                    imageData.data.set(flippedBuffer);
                                    ctx.putImageData(imageData, 0, 0);

                                    // Apply palette if selected
                                    if (finalPaletteColors && finalPaletteColors.length > 0) {
                                        this.applyPaletteToCanvas(canvas, finalPaletteColors);
                                    }

                                    // Apply outline if selected
                                    if (outlineColor && outlineColor !== '') {
                                        this.applyOutlineToCanvas(canvas, outlineColor, outlinePosition, outlineConnectivity, pixelSize);
                                    }

                                    frameSprites.push(canvas.toDataURL());
                                }
                                sprites[animType].push(frameSprites);
                            }
                        }
                    }
                }
            }
        }
        } // End else block for animation processing
        tempRenderer.setRenderTarget(null);
        tempRenderer.dispose();
        renderTarget.dispose();

        // Restore ambient light brightness
        originalAmbientIntensity.forEach(({ light, intensity }) => {
            light.intensity = intensity;
        });

        // Restore editor helpers visibility
        hiddenHelpers.forEach(helper => {
            helper.visible = true;
        });

        // Restore gizmo visibility if it was visible
        if (gizmoGroup && gizmoWasVisible) {
            gizmoGroup.visible = true;
        }

        this.graphicsEditor.displayIsometricSprites(sprites);
    }
}