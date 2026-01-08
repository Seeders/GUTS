/**
 * GLTF2Sprite - Standalone Isometric Sprite Generator
 * Generates sprite sheets from GLTF/GLB 3D models with animations
 *
 * This is a GUTS library that uses Three.js loaded via the GUTS build system.
 */
class GLTF2Sprite {
    constructor(game) {
        this.game = game;
        this.container = null;

        // Model and animation storage
        this.baseModel = null;
        this.baseModelFile = null;
        this.animations = new Map(); // name -> { clip, file }
        this.scene = null;
        this.gltfLoader = null;

        // Palette storage
        this.currentPalette = [];
        this.paletteName = 'Custom Palette';

        // Generated sprites
        this.generatedSprites = null;
        this.generatedMetadata = null;
        this.spriteSheet = null;

        // Preview animation state
        this.previewAnimation = 'idle';
        this.previewDirection = 0;
        this.previewFrame = 0;
        this.previewPlaying = true;
        this.previewFps = 4;
        this.lastFrameTime = 0;
        this.animationFrameId = null;

        // 3D model preview state
        this.previewRenderer = null;
        this.previewCamera = null;
        this.previewControls = null;
        this.previewMixer = null;
        this.previewCurrentAction = null;
        this.previewAnimating = false;
        this.previewClock = null;

        // Model scale
        this.modelScale = 1;

        // Direction names
        this.directionNames = ['Down', 'DownLeft', 'Left', 'UpLeft', 'Up', 'UpRight', 'Right', 'DownRight'];
    }

    async init() {
        // Get container from game or create one
        this.container = document.getElementById('appContainer') || document.body;

        // Get Three.js from GUTS globals (loaded via libraries)
        this.THREE = window.THREE;
        this.GLTFLoader = window.GLTFLoader || this.THREE.GLTFLoader;

        // Initialize Three.js loader
        this.gltfLoader = new this.GLTFLoader();

        // Create scene (shared by preview and sprite generation)
        this.scene = new this.THREE.Scene();

        // Add ambient light only (matches GE_SceneRenderer default brightness of 2.5)
        this.ambientLight = new this.THREE.AmbientLight(0xffffff, 2.5);
        this.scene.add(this.ambientLight);

        // Create shared renderer for preview (no special encoding - uses default)
        this.renderer = new this.THREE.WebGLRenderer({ antialias: true, alpha: true });

        // Build UI
        this.buildUI();
        this.setupEventListeners();

        console.log('[GLTF2Sprite] Initialized');
    }

    buildUI() {
        this.container.innerHTML = `
            <div class="g2s-app">
                <header class="g2s-header">
                    <h1>GLTF2Sprite</h1>
                    <span class="g2s-subtitle">Isometric Sprite Generator</span>
                </header>

                <div class="g2s-main">
                    <div class="g2s-sidebar">
                        <!-- Model Upload -->
                        <section class="g2s-panel">
                            <h2>Model</h2>
                            <div class="g2s-dropzone" id="model-dropzone">
                                <span class="g2s-dropzone-text">Drop GLTF/GLB here</span>
                                <input type="file" id="model-input" accept=".gltf,.glb" hidden>
                            </div>
                            <div id="model-status" class="g2s-status"></div>
                            <div class="g2s-form-row" style="margin-top: 10px;">
                                <label>Model Scale:</label>
                                <input type="number" id="model-scale" value="1" min="0.01" step="0.1">
                            </div>
                        </section>

                        <!-- Animations Upload -->
                        <section class="g2s-panel">
                            <h2>Animations</h2>
                            <div class="g2s-dropzone" id="anim-dropzone">
                                <span class="g2s-dropzone-text">Drop animation GLTFs here</span>
                                <input type="file" id="anim-input" accept=".gltf,.glb" multiple hidden>
                            </div>
                            <ul id="anim-list" class="g2s-anim-list"></ul>
                        </section>

                        <!-- Palette Editor -->
                        <section class="g2s-panel">
                            <h2>Palette</h2>
                            <div class="g2s-palette-actions">
                                <button id="palette-new" class="g2s-btn-small">New</button>
                                <button id="palette-load" class="g2s-btn-small">Load</button>
                                <input type="file" id="palette-load-input" accept=".json" hidden>
                            </div>
                            <div id="palette-grid" class="g2s-palette-grid"></div>
                            <div class="g2s-palette-controls">
                                <button id="palette-add" class="g2s-btn-small">Add Color</button>
                                <input type="color" id="palette-color-picker" hidden>
                                <button id="palette-extract" class="g2s-btn-small">Extract from Images</button>
                                <input type="file" id="palette-extract-input" accept="image/*" multiple hidden>
                            </div>
                            <div class="g2s-form-row">
                                <label>Use Palette:</label>
                                <input type="checkbox" id="gen-use-palette">
                            </div>
                            <div class="g2s-form-row">
                                <label>Name:</label>
                                <input type="text" id="palette-name" value="Custom Palette">
                            </div>
                            <button id="palette-save" class="g2s-btn">Save Palette</button>
                        </section>

                        <!-- Advanced Options -->
                        <section class="g2s-panel">
                            <h2>Advanced Options</h2>
                            <div class="g2s-form-row">
                                <label>Border Size:</label>
                                <input type="number" id="gen-border" value="1" min="0" max="8">
                            </div>
                            <div class="g2s-form-row">
                                <label>Outline Color:</label>
                                <select id="gen-outline">
                                    <option value="">None</option>
                                    <option value="#000000">Black</option>
                                    <option value="#FFFFFF">White</option>
                                </select>
                            </div>
                            <div class="g2s-form-row">
                                <label>Outline Style:</label>
                                <select id="gen-outline-style">
                                    <option value="4">Diagonal (thin)</option>
                                    <option value="8">Adjacent (thick)</option>
                                </select>
                            </div>
                            <div class="g2s-form-row">
                                <label>Is Projectile:</label>
                                <input type="checkbox" id="gen-projectile">
                            </div>
                            <div class="g2s-form-row">
                                <label>Ground-Level:</label>
                                <input type="checkbox" id="gen-ground">
                            </div>
                        </section>
                    </div>

                    <div class="g2s-content">
                        <!-- Generator Settings -->
                        <section class="g2s-panel g2s-settings-panel">
                            <h2>Generator Settings</h2>
                            <div class="g2s-settings-grid">
                                <div class="g2s-form-row">
                                    <label>Frustum Size:</label>
                                    <input type="number" id="gen-frustum" value="48" min="1">
                                </div>
                                <div class="g2s-form-row">
                                    <label>Camera Distance:</label>
                                    <input type="number" id="gen-distance" value="100" min="1">
                                </div>
                                <div class="g2s-form-row">
                                    <label>Camera Height:</label>
                                    <input type="number" id="gen-height" value="1.5" min="0.1" step="0.1">
                                </div>
                                <div class="g2s-form-row">
                                    <label>Sprite Size:</label>
                                    <input type="number" id="gen-size" value="64" min="16">
                                </div>
                                <div class="g2s-form-row">
                                    <label>Animation FPS:</label>
                                    <input type="number" id="gen-fps" value="4" min="1" max="60">
                                </div>
                                <div class="g2s-form-row">
                                    <label>Brightness:</label>
                                    <input type="range" id="gen-brightness" value="10" min="1" max="100">
                                    <span id="gen-brightness-value">10</span>
                                </div>
                                <div class="g2s-form-row">
                                    <label>Light Color:</label>
                                    <input type="color" id="gen-light-color" value="#ffffff">
                                </div>
                                <div class="g2s-form-row">
                                    <button id="generate-btn" class="g2s-btn g2s-btn-primary">Generate Sprites</button>
                                </div>
                            </div>
                        </section>

                        <!-- Preview Row: 3D Preview and Sprite Preview side by side -->
                        <div class="g2s-preview-row">
                            <!-- 3D Model Preview -->
                            <section class="g2s-panel g2s-preview-panel" id="model-preview-section">
                                <h2>3D Preview</h2>
                                <div id="model-preview-container" class="g2s-3d-preview"></div>
                                <div class="g2s-preview-controls-row">
                                    <div class="g2s-direction-picker" id="preview-3d-directions">
                                        <button data-dir="3" class="g2s-dir-btn">NW</button>
                                        <button data-dir="4" class="g2s-dir-btn">N</button>
                                        <button data-dir="5" class="g2s-dir-btn">NE</button>
                                        <button data-dir="2" class="g2s-dir-btn">W</button>
                                        <button class="g2s-dir-btn g2s-dir-center">*</button>
                                        <button data-dir="6" class="g2s-dir-btn">E</button>
                                        <button data-dir="1" class="g2s-dir-btn">SW</button>
                                        <button data-dir="0" class="g2s-dir-btn g2s-dir-active">S</button>
                                        <button data-dir="7" class="g2s-dir-btn">SE</button>
                                    </div>
                                    <div class="g2s-anim-controls">
                                        <select id="model-preview-anim">
                                            <option value="">T-Pose</option>
                                        </select>
                                        <div class="g2s-playback">
                                            <button id="model-preview-play" class="g2s-btn-small">Play</button>
                                            <button id="model-preview-pause" class="g2s-btn-small">Pause</button>
                                        </div>
                                    </div>
                                </div>
                            </section>

                            <!-- Animated Sprite Preview -->
                            <section class="g2s-panel g2s-preview-panel" id="preview-section">
                                <h2>Sprite Preview</h2>
                                <div class="g2s-sprite-preview-area">
                                    <canvas id="preview-canvas" width="128" height="128"></canvas>
                                </div>
                                <div class="g2s-preview-controls-row">
                                    <div class="g2s-direction-picker" id="sprite-directions">
                                        <button data-dir="3" class="g2s-dir-btn">NW</button>
                                        <button data-dir="4" class="g2s-dir-btn">N</button>
                                        <button data-dir="5" class="g2s-dir-btn">NE</button>
                                        <button data-dir="2" class="g2s-dir-btn">W</button>
                                        <button class="g2s-dir-btn g2s-dir-center">*</button>
                                        <button data-dir="6" class="g2s-dir-btn">E</button>
                                        <button data-dir="1" class="g2s-dir-btn">SW</button>
                                        <button data-dir="0" class="g2s-dir-btn g2s-dir-active">S</button>
                                        <button data-dir="7" class="g2s-dir-btn">SE</button>
                                    </div>
                                    <div class="g2s-anim-controls">
                                        <select id="preview-anim">
                                            <option value="">No sprites</option>
                                        </select>
                                        <div class="g2s-playback">
                                            <button id="preview-play" class="g2s-btn-small">Play</button>
                                            <button id="preview-pause" class="g2s-btn-small">Pause</button>
                                            <span id="preview-frame-info">Frame: 0/0</span>
                                        </div>
                                    </div>
                                </div>
                            </section>
                        </div>

                        <!-- Sprite Grid Preview -->
                        <section class="g2s-panel" id="sprite-grid-section" style="display:none;">
                            <h2>Generated Sprites</h2>
                            <div id="sprite-grid" class="g2s-sprite-grid"></div>
                        </section>

                        <!-- Export -->
                        <section class="g2s-panel" id="export-section" style="display:none;">
                            <h2>Export</h2>
                            <div class="g2s-form-row">
                                <label>Filename:</label>
                                <input type="text" id="export-filename" value="spritesheet">
                            </div>
                            <div class="g2s-export-buttons">
                                <button id="export-png" class="g2s-btn">Download Sprite Sheet</button>
                                <button id="export-json" class="g2s-btn">Download Metadata JSON</button>
                            </div>
                        </section>
                    </div>
                </div>
            </div>
        `;
    }

    setupEventListeners() {
        // Model upload
        this.setupDropzone('model-dropzone', 'model-input', (files) => this.handleModelUpload(files[0]));

        // Animation upload
        this.setupDropzone('anim-dropzone', 'anim-input', (files) => this.handleAnimationUpload(files));

        // Palette controls
        document.getElementById('palette-new').addEventListener('click', () => this.newPalette());
        document.getElementById('palette-load').addEventListener('click', () => document.getElementById('palette-load-input').click());
        document.getElementById('palette-load-input').addEventListener('change', (e) => this.loadPalette(e.target.files[0]));
        document.getElementById('palette-add').addEventListener('click', () => document.getElementById('palette-color-picker').click());
        document.getElementById('palette-color-picker').addEventListener('change', (e) => this.addColor(e.target.value));
        document.getElementById('palette-extract').addEventListener('click', () => document.getElementById('palette-extract-input').click());
        document.getElementById('palette-extract-input').addEventListener('change', (e) => this.extractColorsFromImages(e.target.files));
        document.getElementById('palette-save').addEventListener('click', () => this.savePalette());
        document.getElementById('palette-name').addEventListener('change', (e) => this.paletteName = e.target.value);

        // Generate button
        document.getElementById('generate-btn').addEventListener('click', () => this.generateSprites());

        // Sprite preview controls
        document.getElementById('preview-anim').addEventListener('change', (e) => {
            this.previewAnimation = e.target.value;
            this.previewFrame = 0;
            this.renderPreview();
        });

        // Sprite preview direction picker
        document.querySelectorAll('#sprite-directions .g2s-dir-btn[data-dir]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.previewDirection = parseInt(e.target.dataset.dir);
                // Update active state
                document.querySelectorAll('#sprite-directions .g2s-dir-btn').forEach(b => b.classList.remove('g2s-dir-active'));
                e.target.classList.add('g2s-dir-active');
                this.renderPreview();
            });
        });

        document.getElementById('preview-play').addEventListener('click', () => {
            this.previewPlaying = true;
            this.startPreviewAnimation();
        });

        document.getElementById('preview-pause').addEventListener('click', () => {
            this.previewPlaying = false;
        });

        // Export buttons
        document.getElementById('export-png').addEventListener('click', () => this.downloadSpriteSheet());
        document.getElementById('export-json').addEventListener('click', () => this.downloadMetadata());

        // Model scale
        document.getElementById('model-scale').addEventListener('change', (e) => {
            this.modelScale = parseFloat(e.target.value) || 1;
            this.applyModelScale();
            this.updateSuggestedCameraSettings();
        });

        // 3D preview animation controls
        document.getElementById('model-preview-anim').addEventListener('change', (e) => {
            this.play3DPreviewAnimation(e.target.value);
        });
        document.getElementById('model-preview-play').addEventListener('click', () => {
            if (this.previewCurrentAction) {
                this.previewCurrentAction.paused = false;
            }
        });
        document.getElementById('model-preview-pause').addEventListener('click', () => {
            if (this.previewCurrentAction) {
                this.previewCurrentAction.paused = true;
            }
        });

        // 3D preview direction buttons
        document.querySelectorAll('#preview-3d-directions .g2s-dir-btn[data-dir]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const dir = parseInt(e.target.dataset.dir);
                this.setPreviewDirection(dir);
                // Update active state
                document.querySelectorAll('#preview-3d-directions .g2s-dir-btn').forEach(b => b.classList.remove('g2s-dir-active'));
                e.target.classList.add('g2s-dir-active');
            });
        });

        // Generator settings -> update 3D preview in real-time
        const updatePreviewOnChange = () => {
            this.updatePreviewCamera();
            this.updatePreviewLighting();
        };

        document.getElementById('gen-frustum').addEventListener('input', updatePreviewOnChange);
        document.getElementById('gen-distance').addEventListener('input', updatePreviewOnChange);
        document.getElementById('gen-height').addEventListener('input', updatePreviewOnChange);
        document.getElementById('gen-brightness').addEventListener('input', () => {
            document.getElementById('gen-brightness-value').textContent = document.getElementById('gen-brightness').value;
            this.updatePreviewLighting();
        });
        document.getElementById('gen-light-color').addEventListener('input', () => {
            this.updatePreviewLighting();
        });
    }

    setupDropzone(dropzoneId, inputId, callback) {
        const dropzone = document.getElementById(dropzoneId);
        const input = document.getElementById(inputId);

        dropzone.addEventListener('click', () => input.click());

        dropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropzone.classList.add('g2s-dropzone-active');
        });

        dropzone.addEventListener('dragleave', () => {
            dropzone.classList.remove('g2s-dropzone-active');
        });

        dropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropzone.classList.remove('g2s-dropzone-active');
            callback(e.dataTransfer.files);
        });

        input.addEventListener('change', (e) => callback(e.target.files));
    }

    // Model loading
    async handleModelUpload(file) {
        if (!file) return;

        const status = document.getElementById('model-status');
        status.textContent = 'Loading...';

        try {
            const url = URL.createObjectURL(file);
            const gltf = await this.loadGLTF(url);

            // Clear previous model
            if (this.baseModel) {
                this.scene.remove(this.baseModel);
            }

            this.baseModel = gltf.scene;
            this.baseModelFile = file;

            // Set metalness=0 and roughness=1 for proper ambient lighting
            this.baseModel.traverse((child) => {
                if (child.isMesh && child.material) {
                    const materials = Array.isArray(child.material) ? child.material : [child.material];
                    materials.forEach(mat => {
                        if (mat.metalness !== undefined) mat.metalness = 0;
                        if (mat.roughness !== undefined) mat.roughness = 1;
                    });
                }
            });

            this.scene.add(this.baseModel);

            // Center model horizontally and put on ground
            const box = new this.THREE.Box3().setFromObject(this.baseModel);
            const center = box.getCenter(new this.THREE.Vector3());
            const size = box.getSize(new this.THREE.Vector3());

            // Center on X and Z, put bottom at Y=0
            this.baseModel.position.x = -center.x;
            this.baseModel.position.z = -center.z;
            this.baseModel.position.y = -box.min.y;

            console.log('[GLTF2Sprite] Model loaded and positioned:', {
                originalCenter: center,
                size: size,
                newPosition: this.baseModel.position.clone()
            });

            // Apply model scale
            this.modelScale = parseFloat(document.getElementById('model-scale').value) || 1;
            this.applyModelScale();

            // Update suggested frustum and camera distance based on model size
            this.updateSuggestedCameraSettings();

            // Check for embedded animations
            if (gltf.animations && gltf.animations.length > 0) {
                for (const clip of gltf.animations) {
                    const name = clip.name || `anim_${this.animations.size}`;
                    this.animations.set(name, { clip, file: null });
                }
                this.updateAnimationList();
            }

            // Set up 3D preview
            this.setup3DPreview();
            this.update3DPreviewAnimationList();

            status.textContent = file.name + ' loaded';
            status.classList.add('g2s-status-success');

            console.log('[GLTF2Sprite] Model loaded:', file.name);
        } catch (err) {
            status.textContent = 'Error loading model';
            status.classList.add('g2s-status-error');
            console.error('[GLTF2Sprite] Error loading model:', err);
        }
    }

    async handleAnimationUpload(files) {
        for (const file of files) {
            try {
                const url = URL.createObjectURL(file);
                const gltf = await this.loadGLTF(url);

                if (gltf.animations && gltf.animations.length > 0) {
                    // Use filename without extension as animation name
                    const name = file.name.replace(/\.(gltf|glb)$/i, '');
                    this.animations.set(name, { clip: gltf.animations[0], file });
                }
            } catch (err) {
                console.error('[GLTF2Sprite] Error loading animation:', file.name, err);
            }
        }

        this.updateAnimationList();
        this.update3DPreviewAnimationList();
    }

    loadGLTF(url) {
        return new Promise((resolve, reject) => {
            this.gltfLoader.load(url, resolve, undefined, reject);
        });
    }

    updateAnimationList() {
        const list = document.getElementById('anim-list');
        list.innerHTML = '';

        for (const [name, data] of this.animations) {
            const li = document.createElement('li');
            li.innerHTML = `
                <span>${name}</span>
                <button class="g2s-btn-small g2s-btn-danger" data-anim="${name}">X</button>
            `;
            li.querySelector('button').addEventListener('click', () => {
                this.animations.delete(name);
                this.updateAnimationList();
                this.update3DPreviewAnimationList();
            });
            list.appendChild(li);
        }
    }

    // Model scale management
    applyModelScale() {
        if (!this.baseModel) return;

        this.baseModel.scale.set(this.modelScale, this.modelScale, this.modelScale);

        // Recenter after scaling
        const box = new this.THREE.Box3().setFromObject(this.baseModel);
        const center = box.getCenter(new this.THREE.Vector3());

        // Reset position then center
        this.baseModel.position.x = -center.x;
        this.baseModel.position.z = -center.z;
        this.baseModel.position.y = -box.min.y;

        console.log('[GLTF2Sprite] Model scale applied:', this.modelScale);

        // Update 3D preview camera if it exists (previewModel is same as baseModel)
        if (this.previewCamera) {
            this.updatePreviewCamera();
        }
    }

    updateSuggestedCameraSettings() {
        if (!this.baseModel) return;

        // Get scaled model bounds
        const box = new this.THREE.Box3().setFromObject(this.baseModel);
        const size = box.getSize(new this.THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);

        // Calculate appropriate frustum size (should be slightly larger than half the max dimension)
        // For orthographic camera, frustumSize defines the half-height/width of the view
        const suggestedFrustum = Math.ceil(maxDim * 0.6 * 10) / 10; // Round to 1 decimal
        const suggestedDistance = Math.ceil(maxDim * 2 * 10) / 10;

        // Update the input fields
        document.getElementById('gen-frustum').value = suggestedFrustum;
        document.getElementById('gen-distance').value = suggestedDistance;

        console.log('[GLTF2Sprite] Updated camera settings:', {
            modelSize: size,
            maxDimension: maxDim,
            suggestedFrustum,
            suggestedDistance
        });
    }

    // 3D Model Preview - Uses same orthographic camera as sprite generation
    setup3DPreview() {
        const container = document.getElementById('model-preview-container');

        if (!container || !this.baseModel) return;

        // Clean up previous preview animation if running
        if (this.previewAnimating) {
            cancelAnimationFrame(this.preview3DAnimationId);
            this.previewAnimating = false;
        }

        // Get container size
        const width = container.clientWidth;
        const height = container.clientHeight;

        // Use the same scene as sprite generation (model is already in this.scene)
        this.previewModel = this.baseModel;

        // Create orthographic camera matching sprite generation settings
        this.preview3DDirection = 0; // Start with "Down" direction
        this.updatePreviewCamera();

        // Use shared renderer, just resize and attach to container
        this.renderer.setSize(width, height);
        this.renderer.setClearColor(0x16213e, 1);
        container.innerHTML = '';
        container.appendChild(this.renderer.domElement);

        // Create animation mixer for the base model
        this.previewMixer = new this.THREE.AnimationMixer(this.baseModel);
        this.previewClock = new this.THREE.Clock();

        // Start animation loop
        this.previewAnimating = true;
        this.animate3DPreview();

        // Update lighting to match current settings
        this.updatePreviewLighting();

        console.log('[GLTF2Sprite] 3D preview initialized with shared renderer');
    }

    updatePreviewCamera() {
        if (!this.previewModel) return;

        // Get current UI settings
        const frustumSize = parseFloat(document.getElementById('gen-frustum').value) || 1;
        const cameraDistance = parseFloat(document.getElementById('gen-distance').value) || 10;
        const cameraHeightMultiplier = parseFloat(document.getElementById('gen-height').value) || 1.5;

        // Calculate model height for lookAt
        const box = new this.THREE.Box3().setFromObject(this.previewModel);
        const modelSize = box.getSize(new this.THREE.Vector3());
        const modelHeight = modelSize.y;
        const cameraHeight = cameraDistance * cameraHeightMultiplier;
        const lookAtY = modelHeight / 2;

        // Get container aspect ratio
        const container = document.getElementById('model-preview-container');
        const aspect = container ? container.clientWidth / container.clientHeight : 1;

        // Create or update orthographic camera
        if (!this.previewCamera || this.previewCamera.isOrthographicCamera !== true) {
            this.previewCamera = new this.THREE.OrthographicCamera(
                -frustumSize * aspect, frustumSize * aspect,
                frustumSize, -frustumSize,
                0.1, 1000
            );
        } else {
            this.previewCamera.left = -frustumSize * aspect;
            this.previewCamera.right = frustumSize * aspect;
            this.previewCamera.top = frustumSize;
            this.previewCamera.bottom = -frustumSize;
            this.previewCamera.updateProjectionMatrix();
        }

        // Position camera based on direction (same as createCameraArray)
        const dir = this.preview3DDirection || 0;
        const positions = [
            [0, cameraHeight, cameraDistance],              // 0: Down (S)
            [cameraDistance, cameraHeight, cameraDistance], // 1: DownLeft (SW)
            [cameraDistance, cameraHeight, 0],              // 2: Left (W)
            [cameraDistance, cameraHeight, -cameraDistance],// 3: UpLeft (NW)
            [0, cameraHeight, -cameraDistance],             // 4: Up (N)
            [-cameraDistance, cameraHeight, -cameraDistance],// 5: UpRight (NE)
            [-cameraDistance, cameraHeight, 0],             // 6: Right (E)
            [-cameraDistance, cameraHeight, cameraDistance] // 7: DownRight (SE)
        ];

        const pos = positions[dir];
        this.previewCamera.position.set(pos[0], pos[1], pos[2]);
        this.previewCamera.lookAt(new this.THREE.Vector3(0, lookAtY, 0));
        this.previewCamera.updateProjectionMatrix();
    }

    updatePreviewLighting() {
        if (!this.ambientLight) return;

        const brightness = parseFloat(document.getElementById('gen-brightness').value) || 10;
        const lightColor = document.getElementById('gen-light-color').value || '#ffffff';

        // Brightness slider value maps directly to ambient light intensity
        // Default of 10 gives intensity of 2.5 (matching GE_SceneRenderer default)
        this.ambientLight.intensity = brightness / 4;
        this.ambientLight.color.set(lightColor);
    }

    setPreviewDirection(dir) {
        this.preview3DDirection = dir;
        this.updatePreviewCamera();
    }

    animate3DPreview() {
        if (!this.previewAnimating) return;

        this.preview3DAnimationId = requestAnimationFrame(() => this.animate3DPreview());

        // Update animation mixer
        if (this.previewMixer) {
            const delta = this.previewClock.getDelta();
            this.previewMixer.update(delta);
        }

        // Update controls
        if (this.previewControls) {
            this.previewControls.update();
        }

        // Render using the shared renderer and scene
        if (this.renderer && this.scene && this.previewCamera) {
            this.renderer.render(this.scene, this.previewCamera);
        }
    }

    update3DPreviewAnimationList() {
        const select = document.getElementById('model-preview-anim');
        if (!select) return;

        // Clear existing options except "None"
        select.innerHTML = '<option value="">None (T-Pose)</option>';

        // Add animations
        for (const [name] of this.animations) {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            select.appendChild(option);
        }
    }

    play3DPreviewAnimation(animName) {
        if (!this.previewMixer || !this.baseModel) return;

        // Stop current animation
        if (this.previewCurrentAction) {
            this.previewCurrentAction.stop();
            this.previewCurrentAction = null;
        }

        if (!animName) {
            // Reset to T-pose
            this.previewMixer.stopAllAction();
            return;
        }

        // Get the animation clip
        const animData = this.animations.get(animName);
        if (!animData) return;

        // Play the animation directly on the base model (which is used in preview)
        this.previewCurrentAction = this.previewMixer.clipAction(animData.clip);
        this.previewCurrentAction.play();

        console.log('[GLTF2Sprite] Playing animation:', animName);
    }

    // Palette management
    newPalette() {
        this.currentPalette = [];
        this.paletteName = 'Custom Palette';
        document.getElementById('palette-name').value = this.paletteName;
        this.renderPaletteGrid();
    }

    addColor(color) {
        if (!this.currentPalette.includes(color.toUpperCase())) {
            this.currentPalette.push(color.toUpperCase());
            this.renderPaletteGrid();
        }
    }

    removeColor(index) {
        this.currentPalette.splice(index, 1);
        this.renderPaletteGrid();
    }

    renderPaletteGrid() {
        const grid = document.getElementById('palette-grid');
        grid.innerHTML = '';

        this.currentPalette.forEach((color, index) => {
            const swatch = document.createElement('div');
            swatch.className = 'g2s-color-swatch';
            swatch.style.backgroundColor = color;
            swatch.title = color;
            swatch.addEventListener('click', () => this.removeColor(index));
            grid.appendChild(swatch);
        });
    }

    async extractColorsFromImages(files) {
        const uniqueColors = new Set(this.currentPalette);

        for (const file of files) {
            const colors = await this.extractColorsFromImage(file);
            colors.forEach(c => uniqueColors.add(c));
        }

        this.currentPalette = Array.from(uniqueColors);
        this.renderPaletteGrid();

        console.log('[GLTF2Sprite] Extracted', this.currentPalette.length, 'unique colors');
    }

    extractColorsFromImage(file) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);

                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const colors = new Set();

                for (let i = 0; i < imageData.data.length; i += 4) {
                    const a = imageData.data[i + 3];
                    if (a === 0) continue;

                    const r = imageData.data[i];
                    const g = imageData.data[i + 1];
                    const b = imageData.data[i + 2];
                    const hex = '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('').toUpperCase();
                    colors.add(hex);
                }

                URL.revokeObjectURL(img.src);
                resolve(Array.from(colors));
            };
            img.src = URL.createObjectURL(file);
        });
    }

    async loadPalette(file) {
        if (!file) return;

        try {
            const text = await file.text();
            const data = JSON.parse(text);

            this.paletteName = data.title || 'Imported Palette';
            document.getElementById('palette-name').value = this.paletteName;

            this.currentPalette = Object.entries(data)
                .filter(([key]) => key !== 'title')
                .map(([_, color]) => color.toUpperCase());

            this.renderPaletteGrid();
            console.log('[GLTF2Sprite] Loaded palette with', this.currentPalette.length, 'colors');
        } catch (err) {
            console.error('[GLTF2Sprite] Error loading palette:', err);
        }
    }

    savePalette() {
        const data = { title: this.paletteName };
        this.currentPalette.forEach((color, i) => {
            data[`Color${i + 1}`] = color;
        });

        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const link = document.createElement('a');
        link.download = this.paletteName.replace(/\s+/g, '_') + '.json';
        link.href = URL.createObjectURL(blob);
        link.click();
    }

    // Sprite generation (adapted from GE_SceneRenderer)
    async generateSprites() {
        if (!this.baseModel) {
            alert('Please load a model first');
            return;
        }

        console.log('[GLTF2Sprite] Starting sprite generation...');

        // Get settings
        const frustumSize = parseFloat(document.getElementById('gen-frustum').value) || 48;
        const cameraDistance = parseFloat(document.getElementById('gen-distance').value) || 100;
        const cameraHeightMultiplier = parseFloat(document.getElementById('gen-height').value) || 1.5;
        const size = parseInt(document.getElementById('gen-size').value) || 64;
        const fps = parseInt(document.getElementById('gen-fps').value) || 4;
        const brightness = parseFloat(document.getElementById('gen-brightness').value) || 10;
        const usePalette = document.getElementById('gen-use-palette').checked;
        const borderSize = parseInt(document.getElementById('gen-border').value) || 1;
        const outlineColor = document.getElementById('gen-outline').value;
        const outlineConnectivity = parseInt(document.getElementById('gen-outline-style').value) || 8;
        const isProjectile = document.getElementById('gen-projectile').checked;
        const generateGroundLevel = document.getElementById('gen-ground').checked;

        this.previewFps = fps;

        // Get palette colors if enabled
        let paletteColors = null;
        if (usePalette && this.currentPalette.length > 0) {
            paletteColors = this.currentPalette.map(hex => SpriteUtils.hexToRgb(hex));
        }

        // Create temporary renderer for sprite generation using SpriteUtils
        const spriteRenderer = SpriteUtils.createSpriteRenderer(this.THREE, size);

        // Calculate model bounds (model is centered at origin with bottom at Y=0, scale already applied)
        const box = new this.THREE.Box3().setFromObject(this.baseModel);
        const modelSize = box.getSize(new this.THREE.Vector3());
        const modelHeight = modelSize.y;

        const cameraHeight = cameraDistance * cameraHeightMultiplier;
        const lookAtY = modelHeight / 2; // Look at center of model

        console.log('[GLTF2Sprite] Model bounds:', {
            boxMin: box.min,
            boxMax: box.max,
            size: modelSize,
            height: modelHeight,
            scale: this.modelScale,
            frustumSize,
            cameraDistance,
            cameraHeight,
            lookAtY
        });

        // Set up lighting intensity and color (same as updatePreviewLighting)
        const lightColor = document.getElementById('gen-light-color').value || '#ffffff';
        this.ambientLight.intensity = brightness / 4;
        this.ambientLight.color.set(lightColor);

        // Create 8 isometric cameras using SpriteUtils
        const cameras = SpriteUtils.createCameraArray(this.THREE, frustumSize, cameraDistance, cameraHeight, lookAtY);

        // Create ground-level cameras if enabled
        let groundCameras = null;
        if (generateGroundLevel) {
            groundCameras = SpriteUtils.createCameraArray(this.THREE, frustumSize, cameraDistance, modelHeight, lookAtY);
        }

        // Ballistic angles for projectiles
        const ballisticAngles = [
            { name: 'Up90', pitchDegrees: -90 },
            { name: 'Up45', pitchDegrees: -45 },
            { name: 'Level', pitchDegrees: 0 },
            { name: 'Down45', pitchDegrees: 45 },
            { name: 'Down90', pitchDegrees: 90 }
        ];

        const sprites = {};
        const ballisticSprites = {};
        const groundLevelSprites = {};

        // Check if we have animations
        if (this.animations.size === 0) {
            // Static model - generate single idle frame
            sprites['idle'] = [await this.renderFrame(spriteRenderer, cameras, size, paletteColors, outlineColor, outlineConnectivity, borderSize)];

            if (generateGroundLevel) {
                groundLevelSprites['idle'] = [await this.renderFrame(spriteRenderer, groundCameras, size, paletteColors, outlineColor, outlineConnectivity, borderSize)];
            }

            if (isProjectile) {
                const originalRotation = this.baseModel.rotation.x;
                for (const angle of ballisticAngles) {
                    this.baseModel.rotation.x = this.THREE.MathUtils.degToRad(angle.pitchDegrees);
                    ballisticSprites[angle.name] = { 'idle': [await this.renderFrame(spriteRenderer, cameras, size, paletteColors, outlineColor, outlineConnectivity, borderSize)] };
                }
                this.baseModel.rotation.x = originalRotation;
            }
        } else {
            // Animated model
            const mixer = new this.THREE.AnimationMixer(this.baseModel);

            for (const [animName, animData] of this.animations) {
                const clip = animData.clip;
                const action = mixer.clipAction(clip);
                action.play();

                const duration = clip.duration;
                const frameCount = Math.max(2, Math.ceil(duration * fps));
                const timeStep = duration / frameCount;

                sprites[animName] = [];
                if (generateGroundLevel) {
                    groundLevelSprites[animName] = [];
                }

                for (let f = 0; f < frameCount; f++) {
                    mixer.setTime(f * timeStep);
                    sprites[animName].push(await this.renderFrame(spriteRenderer, cameras, size, paletteColors, outlineColor, outlineConnectivity, borderSize));

                    if (generateGroundLevel) {
                        groundLevelSprites[animName].push(await this.renderFrame(spriteRenderer, groundCameras, size, paletteColors, outlineColor, outlineConnectivity, borderSize));
                    }
                }

                action.stop();

                // Ballistic sprites for animated projectiles
                if (isProjectile) {
                    const originalRotation = this.baseModel.rotation.x;
                    for (const angle of ballisticAngles) {
                        if (!ballisticSprites[angle.name]) {
                            ballisticSprites[angle.name] = {};
                        }
                        ballisticSprites[angle.name][animName] = [];

                        this.baseModel.rotation.x = this.THREE.MathUtils.degToRad(angle.pitchDegrees);
                        action.play();

                        for (let f = 0; f < frameCount; f++) {
                            mixer.setTime(f * timeStep);
                            ballisticSprites[angle.name][animName].push(await this.renderFrame(spriteRenderer, cameras, size, paletteColors, outlineColor, outlineConnectivity, borderSize));
                        }

                        action.stop();
                    }
                    this.baseModel.rotation.x = originalRotation;
                }
            }
        }

        // Clean up sprite renderer
        spriteRenderer.dispose();

        // Store results
        this.generatedSprites = { sprites, ballisticSprites, groundLevelSprites };

        // Compose sprite sheet
        this.composeSpriteSheet(size, fps, isProjectile, generateGroundLevel);

        // Restore preview renderer size and reattach to preview container
        const previewContainer = document.getElementById('model-preview-container');
        if (previewContainer) {
            const width = previewContainer.clientWidth;
            const height = previewContainer.clientHeight;
            this.renderer.setSize(width, height);
            previewContainer.innerHTML = '';
            previewContainer.appendChild(this.renderer.domElement);
        }

        // Update UI
        this.displaySpriteGrid();
        this.updatePreviewControls();
        this.startPreviewAnimation();

        document.getElementById('sprite-grid-section').style.display = 'block';
        document.getElementById('export-section').style.display = 'block';

        console.log('[GLTF2Sprite] Sprite generation complete');
    }

    async renderFrame(renderer, cameras, size, paletteColors, outlineColor, outlineConnectivity, borderSize) {
        const frames = [];

        for (const camera of cameras) {
            // Render using SpriteUtils
            const canvas = SpriteUtils.renderToCanvas(renderer, this.scene, camera, size);

            // Apply palette
            if (paletteColors && paletteColors.length > 0) {
                SpriteUtils.applyPaletteToCanvas(canvas, paletteColors);
            }

            // Apply outline
            if (outlineColor) {
                SpriteUtils.applyOutlineToCanvas(canvas, outlineColor, 'outset', outlineConnectivity, borderSize);
            }

            frames.push(canvas);
        }

        return frames;
    }

    // Sprite sheet composition - uses square packing via SpriteUtils
    composeSpriteSheet(spriteSize, fps, hasBallisticSprites, hasGroundLevel) {
        const { sprites, ballisticSprites, groundLevelSprites } = this.generatedSprites;

        const animNames = Object.keys(sprites);
        const numDirections = 8;

        // Count total frames for square packing
        let totalFrames = 0;
        for (const animName of animNames) {
            totalFrames += sprites[animName].length * numDirections;
        }
        if (hasGroundLevel && groundLevelSprites) {
            for (const animName of animNames) {
                if (groundLevelSprites[animName]) {
                    totalFrames += groundLevelSprites[animName].length * numDirections;
                }
            }
        }
        if (hasBallisticSprites && ballisticSprites) {
            const angleNames = ['Up90', 'Up45', 'Level', 'Down45', 'Down90'];
            for (const angleName of angleNames) {
                const angleSprites = ballisticSprites[angleName];
                if (!angleSprites) continue;
                for (const animName of animNames) {
                    if (angleSprites[animName]) {
                        totalFrames += angleSprites[animName].length * numDirections;
                    }
                }
            }
        }

        // Use SpriteUtils for square packing calculations
        const { gridCols, gridRows, sheetWidth, sheetHeight } = SpriteUtils.calculateSquareGridDimensions(totalFrames, spriteSize);
        const packer = SpriteUtils.createSquarePackingIterator(gridCols, spriteSize);

        console.log(`[SpriteSheet] Packing ${totalFrames} frames into ${gridCols}x${gridRows} grid: ${sheetWidth}x${sheetHeight}px`);

        // Create canvas
        const canvas = document.createElement('canvas');
        canvas.width = sheetWidth;
        canvas.height = sheetHeight;
        const ctx = canvas.getContext('2d');

        // Generate metadata
        const metadata = {
            title: document.getElementById('export-filename').value || 'spritesheet',
            generatorSettings: {
                frustumSize: parseFloat(document.getElementById('gen-frustum').value),
                cameraDistance: parseFloat(document.getElementById('gen-distance').value),
                cameraHeight: parseFloat(document.getElementById('gen-height').value),
                spriteSize: spriteSize,
                fps: fps,
                brightness: parseFloat(document.getElementById('gen-brightness').value)
            },
            frames: {}
        };

        // Draw regular sprites using square packing
        for (const animName of animNames) {
            const frames = sprites[animName];
            for (let dir = 0; dir < numDirections; dir++) {
                for (let f = 0; f < frames.length; f++) {
                    const sprite = frames[f][dir];
                    const pos = packer.getPosition();
                    ctx.drawImage(sprite, pos.x, pos.y);

                    const frameName = `${animName}${this.directionNames[dir]}_${f}`;
                    metadata.frames[frameName] = { x: pos.x, y: pos.y, w: spriteSize, h: spriteSize };
                    packer.nextFrame();
                }
            }
        }

        // Draw ground-level sprites
        if (hasGroundLevel && groundLevelSprites) {
            for (const animName of animNames) {
                const frames = groundLevelSprites[animName];
                if (!frames) continue;
                for (let dir = 0; dir < numDirections; dir++) {
                    for (let f = 0; f < frames.length; f++) {
                        const sprite = frames[f][dir];
                        const pos = packer.getPosition();
                        ctx.drawImage(sprite, pos.x, pos.y);

                        const frameName = `${animName}${this.directionNames[dir]}Ground_${f}`;
                        metadata.frames[frameName] = { x: pos.x, y: pos.y, w: spriteSize, h: spriteSize };
                        packer.nextFrame();
                    }
                }
            }
        }

        // Draw ballistic sprites
        if (hasBallisticSprites && ballisticSprites) {
            const angleNames = ['Up90', 'Up45', 'Level', 'Down45', 'Down90'];
            for (const angleName of angleNames) {
                const angleSprites = ballisticSprites[angleName];
                if (!angleSprites) continue;

                for (const animName of animNames) {
                    const frames = angleSprites[animName];
                    if (!frames) continue;

                    for (let dir = 0; dir < numDirections; dir++) {
                        for (let f = 0; f < frames.length; f++) {
                            const sprite = frames[f][dir];
                            const pos = packer.getPosition();
                            ctx.drawImage(sprite, pos.x, pos.y);

                            const frameName = `${animName}${this.directionNames[dir]}${angleName}_${f}`;
                            metadata.frames[frameName] = { x: pos.x, y: pos.y, w: spriteSize, h: spriteSize };
                            packer.nextFrame();
                        }
                    }
                }
            }
        }

        this.spriteSheet = canvas;
        this.generatedMetadata = metadata;
    }

    // UI display functions
    displaySpriteGrid() {
        const grid = document.getElementById('sprite-grid');
        grid.innerHTML = '';

        const { sprites } = this.generatedSprites;

        for (const [animName, frames] of Object.entries(sprites)) {
            const section = document.createElement('div');
            section.className = 'g2s-anim-section';
            section.innerHTML = `<h3>${animName}</h3>`;

            const row = document.createElement('div');
            row.className = 'g2s-sprite-row';

            // Show first frame of each direction
            for (let dir = 0; dir < 8; dir++) {
                if (frames[0] && frames[0][dir]) {
                    const img = document.createElement('img');
                    img.src = frames[0][dir].toDataURL();
                    img.title = this.directionNames[dir];
                    row.appendChild(img);
                }
            }

            section.appendChild(row);
            grid.appendChild(section);
        }
    }

    updatePreviewControls() {
        const select = document.getElementById('preview-anim');
        select.innerHTML = '';

        const { sprites } = this.generatedSprites;
        for (const animName of Object.keys(sprites)) {
            const option = document.createElement('option');
            option.value = animName;
            option.textContent = animName;
            select.appendChild(option);
        }

        this.previewAnimation = select.value || Object.keys(sprites)[0];
    }

    startPreviewAnimation() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
        }

        const animate = (timestamp) => {
            if (this.previewPlaying) {
                const frameInterval = 1000 / this.previewFps;
                if (timestamp - this.lastFrameTime >= frameInterval) {
                    this.advanceFrame();
                    this.lastFrameTime = timestamp;
                }
            }
            this.renderPreview();
            this.animationFrameId = requestAnimationFrame(animate);
        };

        this.animationFrameId = requestAnimationFrame(animate);
    }

    advanceFrame() {
        const { sprites } = this.generatedSprites;
        const frames = sprites[this.previewAnimation];
        if (frames) {
            this.previewFrame = (this.previewFrame + 1) % frames.length;
        }
    }

    renderPreview() {
        const canvas = document.getElementById('preview-canvas');
        const ctx = canvas.getContext('2d');

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (!this.generatedSprites) return;

        const { sprites } = this.generatedSprites;
        const frames = sprites[this.previewAnimation];

        if (frames && frames[this.previewFrame] && frames[this.previewFrame][this.previewDirection]) {
            const sprite = frames[this.previewFrame][this.previewDirection];
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(sprite, 0, 0, canvas.width, canvas.height);
        }

        // Update frame info
        const frameCount = frames ? frames.length : 1;
        document.getElementById('preview-frame-info').textContent = `Frame: ${this.previewFrame + 1}/${frameCount}`;
    }

    // Export functions
    downloadSpriteSheet() {
        if (!this.spriteSheet) return;

        const filename = document.getElementById('export-filename').value || 'spritesheet';
        const link = document.createElement('a');
        link.download = filename + '.png';
        link.href = this.spriteSheet.toDataURL('image/png');
        link.click();
    }

    downloadMetadata() {
        if (!this.generatedMetadata) return;

        const filename = document.getElementById('export-filename').value || 'spritesheet';
        const blob = new Blob([JSON.stringify(this.generatedMetadata, null, 2)], { type: 'application/json' });
        const link = document.createElement('a');
        link.download = filename + '.json';
        link.href = URL.createObjectURL(blob);
        link.click();
    }
}

// Export for GUTS
if (typeof window !== 'undefined') {
    window.GLTF2Sprite = GLTF2Sprite;
}
