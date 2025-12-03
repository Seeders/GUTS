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

        // Add helpers
        const gridHelper = new THREE.GridHelper(100, 10);
        this.scene.add(gridHelper);

        const axesHelper = new THREE.AxesHelper(10);
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
    
    async generateIsometricSprites(brightness = null, paletteColors = null) {
        const frustumSize = parseFloat(document.getElementById('iso-frustum').value) || 48;
        const cameraDistance = parseFloat(document.getElementById('iso-distance').value) || 100;
        const size = parseFloat(document.getElementById('iso-size').value) || 64;
        const framesPerAnimation = parseInt(document.getElementById('iso-frames').value) || 5;

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

        const aspect = 1;
        const tempRenderer = new window.THREE.WebGLRenderer({ antialias: false, alpha: true });
        tempRenderer.setSize(size, size);
        // Match the main editor renderer settings - no special color management
        tempRenderer.outputEncoding = THREE.LinearEncoding;
        // Don't close the modal - keep it open for adjustments
        // document.getElementById('modal-generateIsoSprites').classList.remove('show');
    
        const renderTarget = new window.THREE.WebGLRenderTarget(size, size);
        // Only 5 directions: Down, DownLeft, Left, UpLeft, Up
        const cameras = [
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

        // Position cameras: Down, DownLeft, Left, UpLeft, Up
        // Down = character faces towards viewer (camera from positive Z)
        // Up = character faces away from viewer (camera from negative Z)
        // Left = character faces left (camera from positive X)
        cameras[0].position.set(0, cameraDistance, cameraDistance);                       // Down (camera from back)
        cameras[1].position.set(cameraDistance, cameraDistance, cameraDistance);          // DownLeft
        cameras[2].position.set(cameraDistance, cameraDistance, 0);                       // Left
        cameras[3].position.set(cameraDistance, cameraDistance, -cameraDistance);         // UpLeft
        cameras[4].position.set(0, cameraDistance, -cameraDistance);                      // Up (camera from front)

        // Point cameras at center of model (half the model height)
        const lookAtY = modelHeight / 2;
        cameras.forEach(camera => camera.lookAt(0, lookAtY, 0));
    
        const sprites = {};     
       
        for (const animType in this.graphicsEditor.state.renderData.animations) {
            sprites[animType] = [];
            const animationFrames = this.graphicsEditor.state.renderData.animations[animType];
            console.log(`Processing animation: ${animType}, sprite size: ${size}`);

            // Process each frame definition in the animation
            for (let frameIndex = 0; frameIndex < animationFrames.length; frameIndex++) {
                const frame = animationFrames[frameIndex];
                const scene = new window.THREE.Scene();

                // Add neutral white ambient lighting with configurable brightness
                const ambientLight = new window.THREE.AmbientLight(0xffffff, ambientBrightness);
                scene.add(ambientLight);

                // For GLTF models with animations, we need to load base model + apply animation
                // Check if this frame has animation GLB
                const hasAnimationGLB = frame?.main?.shapes?.some(s =>
                    s.url && s.url.includes('animations/') && (s.url.endsWith('.glb') || s.url.endsWith('.gltf'))
                );

                if (hasAnimationGLB && this.graphicsEditor.state.renderData.model) {
                    // Load base model first
                    await this.createObjectsFromJSON(this.graphicsEditor.state.renderData.model, scene);

                    // Find the animation shape
                    const animShape = frame?.main?.shapes?.find(s =>
                        s.url && s.url.includes('animations/') && (s.url.endsWith('.glb') || s.url.endsWith('.gltf'))
                    );

                    if (animShape) {
                        // Load and apply animation to base model manually (bypassing ShapeFactory warnings)
                        const gltfPath = this.graphicsEditor.shapeFactory.getResourcesPath(animShape.url);
                        const animationClip = await new Promise((resolve) => {
                            this.graphicsEditor.shapeFactory.gltfLoader.load(gltfPath, (gltf) => {
                                if (gltf.animations && gltf.animations.length > 0) {
                                    const clip = gltf.animations[0];
                                    // Find base model in scene
                                    scene.traverse(child => {
                                        if (child.userData?.isGLTFRoot && child.userData?.skeleton) {
                                            if (!child.userData.mixer) {
                                                child.userData.mixer = new THREE.AnimationMixer(child);
                                            }
                                            const mixer = child.userData.mixer;
                                            mixer.stopAllAction();
                                            const action = mixer.clipAction(clip);
                                            action.play();
                                        }
                                    });
                                    resolve(clip);
                                } else {
                                    resolve(null);
                                }
                            }, undefined, () => resolve(null));
                        });

                        // Load any non-animation shapes from the frame (equipment, etc)
                        const frameWithoutAnimation = JSON.parse(JSON.stringify(frame));
                        for (const groupName in frameWithoutAnimation) {
                            const shapes = frameWithoutAnimation[groupName].shapes;
                            if (shapes) {
                                frameWithoutAnimation[groupName].shapes = shapes.filter(s =>
                                    !(s.url && s.url.includes('animations/') && (s.url.endsWith('.glb') || s.url.endsWith('.gltf')))
                                );
                            }
                        }
                        // Only load if there are non-animation shapes
                        const hasNonAnimShapes = Object.values(frameWithoutAnimation).some(group =>
                            group.shapes && group.shapes.length > 0
                        );
                        if (hasNonAnimShapes) {
                            await this.createObjectsFromJSON(frameWithoutAnimation, scene);
                        }

                        // Generate multiple sprite frames by advancing through the animation
                        if (animationClip) {
                            const animDuration = animationClip.duration;
                            // Divide by framesPerAnimation (not -1) to avoid including the loop point
                            const timeStep = animDuration / framesPerAnimation;

                            for (let snapIndex = 0; snapIndex < framesPerAnimation; snapIndex++) {
                                const currentTime = snapIndex * timeStep;

                                // Update mixer to specific time in animation
                                scene.traverse(child => {
                                    if (child.userData?.mixer) {
                                        child.userData.mixer.setTime(currentTime);
                                    }
                                });

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

                                    frameSprites.push(canvas.toDataURL());
                                }
                                sprites[animType].push(frameSprites);
                            }
                        }
                    }
                } else {
                    // Regular frame without animation GLB
                    await this.createObjectsFromJSON(frame, scene);

                    // Render single frame for non-GLTF animations
                    const frameSprites = [];
                    for (const camera of cameras) {
                        // Normal rendering without pixelation
                        tempRenderer.setRenderTarget(renderTarget);
                        tempRenderer.render(scene, camera);
                        tempRenderer.setRenderTarget(null);

                        // Read pixels from render target
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

                        // Apply palette if selected
                        if (finalPaletteColors && finalPaletteColors.length > 0) {
                            this.applyPaletteToCanvas(canvas, finalPaletteColors);
                        }

                        frameSprites.push(canvas.toDataURL());
                    }
                    sprites[animType].push(frameSprites);
                }
            }
        }
        tempRenderer.setRenderTarget(null);
        tempRenderer.dispose();
        renderTarget.dispose();
        this.graphicsEditor.displayIsometricSprites(sprites);
    }
}