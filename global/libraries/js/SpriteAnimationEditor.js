/**
 * @class SpriteAnimationEditor
 * @description Editor module for viewing and previewing sprite animations
 */
class SpriteAnimationEditor {
    constructor(controller, moduleConfig, GUTS) {
        this.controller = controller;
        this.moduleConfig = moduleConfig;
        this.GUTS = GUTS;

        // Animation state
        this.currentAnimationSet = null;
        this.currentAnimationType = 'idle';
        this.currentDirection = 0; // 0=down, 1=downleft, 2=left, 3=downright, 4=up, 5=upright, 6=right, 7=upleft
        this.currentFrameIndex = 0;
        this.isPlaying = true;
        this.fps = 4;
        this.scale = 4;
        this.lastFrameTime = 0;

        // Sprite data
        this.spriteSheet = null;
        this.spriteSheetImage = null;
        this.animations = {};
        this.currentAnimationData = null;

        // Direction names mapping (index to name suffix)
        // 0=down, 1=downleft, 2=left, 3=upleft, 4=up, 5=upright, 6=right, 7=downright
        this.directionNames = [
            'Down', 'DownLeft', 'Left', 'UpLeft',
            'Up', 'UpRight', 'Right', 'DownRight'
        ];

        // Canvas and context
        this.canvas = null;
        this.ctx = null;

        this.init();
    }

    init() {
        // Listen for load events
        document.body.addEventListener(this.moduleConfig.loadHook, (event) => {
            this.loadAnimationSet(event.detail);
        });

        // Setup UI after DOM is ready
        this.setupUI();
        this.startAnimationLoop();
    }

    setupUI() {
        // Canvas
        this.canvas = document.getElementById('sprite-animation-canvas');
        if (this.canvas) {
            this.ctx = this.canvas.getContext('2d');
            this.resizeCanvas();
            window.addEventListener('resize', () => this.resizeCanvas());
        }

        // Animation type selector
        const typeSelect = document.getElementById('sprite-animation-type');
        if (typeSelect) {
            typeSelect.addEventListener('change', (e) => {
                this.currentAnimationType = e.target.value;
                this.currentFrameIndex = 0;
                this.loadCurrentAnimation();
            });
        }

        // Direction buttons
        const directionBtns = document.querySelectorAll('.sprite-animation__direction-btn');
        directionBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const direction = parseInt(e.target.dataset.direction);
                this.setDirection(direction);
                // Update button states
                directionBtns.forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
            });
        });

        // Set initial direction button
        const initialBtn = document.querySelector('.sprite-animation__direction-btn[data-direction="0"]');
        if (initialBtn) initialBtn.classList.add('active');

        // Playback controls
        const playBtn = document.getElementById('sprite-play-btn');
        if (playBtn) {
            playBtn.addEventListener('click', () => {
                this.isPlaying = !this.isPlaying;
                playBtn.textContent = this.isPlaying ? '⏸' : '▶';
            });
        }

        const prevBtn = document.getElementById('sprite-prev-btn');
        if (prevBtn) {
            prevBtn.addEventListener('click', () => this.previousFrame());
        }

        const nextBtn = document.getElementById('sprite-next-btn');
        if (nextBtn) {
            nextBtn.addEventListener('click', () => this.nextFrame());
        }

        // Speed slider
        const speedSlider = document.getElementById('sprite-speed-slider');
        const speedValue = document.getElementById('sprite-speed-value');
        if (speedSlider) {
            speedSlider.addEventListener('input', (e) => {
                this.fps = parseInt(e.target.value);
                if (speedValue) speedValue.textContent = `${this.fps} FPS`;
            });
        }

        // Scale slider
        const scaleSlider = document.getElementById('sprite-scale-slider');
        const scaleValue = document.getElementById('sprite-scale-value');
        if (scaleSlider) {
            scaleSlider.addEventListener('input', (e) => {
                this.scale = parseInt(e.target.value);
                if (scaleValue) scaleValue.textContent = `${this.scale}x`;
            });
        }
    }

    resizeCanvas() {
        if (!this.canvas) return;
        const container = this.canvas.parentElement;
        if (container) {
            this.canvas.width = container.clientWidth;
            this.canvas.height = container.clientHeight;
        }
    }

    async loadAnimationSet(detail) {
        const { data: spriteAnimationSetName, objectData } = detail;

        if (!spriteAnimationSetName) {
            console.warn('[SpriteAnimationEditor] No sprite animation set specified');
            return;
        }

        // Get the animation set from collections
        const collections = this.controller.getCollections();
        const animationSet = collections?.spriteAnimationSets?.[spriteAnimationSetName];

        if (!animationSet) {
            console.warn(`[SpriteAnimationEditor] Animation set '${spriteAnimationSetName}' not found`);
            return;
        }

        this.currentAnimationSet = animationSet;

        // Update info display
        this.updateInfo(spriteAnimationSetName, animationSet);

        // Load sprite sheet image
        await this.loadSpriteSheet(animationSet.spriteSheet);

        // Build animation data from the set
        this.buildAnimationData(animationSet, collections);

        // Update the animation type dropdown based on available types
        this.updateAnimationTypeDropdown();

        // Load initial animation
        this.loadCurrentAnimation();

        // Update animation list
        this.updateAnimationList();

        // Resize canvas after everything is loaded and container should be visible
        // Use setTimeout to ensure the DOM has updated
        setTimeout(() => this.resizeCanvas(), 100);
    }

    updateAnimationTypeDropdown() {
        const typeSelect = document.getElementById('sprite-animation-type');
        if (!typeSelect) return;

        // Clear existing options
        typeSelect.innerHTML = '';

        // Add options for each animation type that has data
        const availableTypes = Object.keys(this.animations).filter(type =>
            Object.keys(this.animations[type]).length > 0
        );

        availableTypes.forEach(type => {
            const option = document.createElement('option');
            option.value = type;
            option.textContent = type.charAt(0).toUpperCase() + type.slice(1);
            typeSelect.appendChild(option);
        });

        // Set current type to first available, or keep current if still valid
        if (availableTypes.length > 0) {
            if (!availableTypes.includes(this.currentAnimationType)) {
                this.currentAnimationType = availableTypes[0];
            }
            typeSelect.value = this.currentAnimationType;
        }
    }

    updateInfo(setName, animationSet) {
        const setNameEl = document.getElementById('sprite-set-name');
        const collectionNameEl = document.getElementById('sprite-collection-name');

        if (setNameEl) setNameEl.textContent = setName;
        if (collectionNameEl) collectionNameEl.textContent = animationSet.animationCollection || '-';

        // Display generator settings if available
        const settingsPanel = document.getElementById('sprite-generator-settings-panel');
        const settingsEl = document.getElementById('sprite-generator-settings');

        if (settingsPanel && settingsEl) {
            if (animationSet.generatorSettings) {
                settingsPanel.style.display = 'block';
                const settings = animationSet.generatorSettings;
                settingsEl.innerHTML = `
                    <div>Frustum: ${settings.frustumSize || '-'}</div>
                    <div>Distance: ${settings.cameraDistance || '-'}</div>
                    <div>Cam Height: ${settings.cameraHeight || '-'}</div>
                    <div>Brightness: ${settings.brightness || '-'}</div>
                    <div>Palette: ${settings.palette || 'none'}</div>
                    <div>Pixel Size: ${settings.pixelSize || '-'}</div>
                    <div>Outline: ${settings.outlineColor || 'none'}</div>
                `;
            } else {
                settingsPanel.style.display = 'none';
            }
        }
    }

    async loadSpriteSheet(spriteSheetPath) {
        if (!spriteSheetPath) return;

        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                this.spriteSheetImage = img;
                resolve();
            };
            img.onerror = (err) => {
                console.error('[SpriteAnimationEditor] Failed to load sprite sheet:', spriteSheetPath);
                reject(err);
            };

            // Build the full path
            const resourcesPath = this.controller.getResourcesPath?.() || '';
            img.src = `${resourcesPath}${spriteSheetPath}`;
        });
    }

    buildAnimationData(animationSet, collections) {
        this.animations = {};
        const animationCollection = animationSet.animationCollection;
        const spriteAnimations = collections?.[animationCollection] || {};

        // Dynamically discover animation properties (any property ending with 'SpriteAnimations')
        for (const [propertyName, animNames] of Object.entries(animationSet)) {
            if (!propertyName.endsWith('SpriteAnimations') || !Array.isArray(animNames)) {
                continue;
            }

            // Extract the type name (e.g., 'idle' from 'idleSpriteAnimations')
            const type = propertyName.replace('SpriteAnimations', '');
            this.animations[type] = {};

            animNames.forEach((animName, directionIndex) => {
                const animData = spriteAnimations[animName];
                if (animData) {
                    this.animations[type][directionIndex] = {
                        name: animName,
                        sprites: animData.sprites || [],
                        spriteCollection: animData.spriteCollection
                    };
                }
            });
        }
    }

    loadCurrentAnimation() {
        const typeAnimations = this.animations[this.currentAnimationType];
        if (!typeAnimations) {
            this.currentAnimationData = null;
            return;
        }

        this.currentAnimationData = typeAnimations[this.currentDirection];
        this.currentFrameIndex = 0;

        // Update current animation display
        const currentAnimEl = document.getElementById('sprite-current-anim');
        if (currentAnimEl && this.currentAnimationData) {
            currentAnimEl.textContent = this.currentAnimationData.name;
        }

        this.updateFrameInfo();
    }

    setDirection(direction) {
        if (direction === -1) {
            // Cycle through all directions (not implemented yet, just use 0)
            this.currentDirection = 0;
        } else {
            this.currentDirection = direction;
        }
        this.loadCurrentAnimation();
    }

    nextFrame() {
        if (!this.currentAnimationData) return;
        const frameCount = this.currentAnimationData.sprites.length;
        this.currentFrameIndex = (this.currentFrameIndex + 1) % frameCount;
        this.updateFrameInfo();
    }

    previousFrame() {
        if (!this.currentAnimationData) return;
        const frameCount = this.currentAnimationData.sprites.length;
        this.currentFrameIndex = (this.currentFrameIndex - 1 + frameCount) % frameCount;
        this.updateFrameInfo();
    }

    updateFrameInfo() {
        const frameInfoEl = document.getElementById('sprite-frame-info');
        if (frameInfoEl && this.currentAnimationData) {
            const frameCount = this.currentAnimationData.sprites.length;
            frameInfoEl.textContent = `${this.currentFrameIndex + 1} / ${frameCount}`;
        }
    }

    updateAnimationList() {
        const listEl = document.getElementById('sprite-animation-list');
        if (!listEl) return;

        listEl.innerHTML = '';

        // List all animation types and their animations
        for (const [type, directionAnims] of Object.entries(this.animations)) {
            // Type header
            const header = document.createElement('div');
            header.className = 'editor-module__list-header';
            header.textContent = type.charAt(0).toUpperCase() + type.slice(1);
            header.style.fontWeight = 'bold';
            header.style.padding = '8px';
            header.style.borderBottom = '1px solid #444';
            listEl.appendChild(header);

            // Direction animations
            for (const [dirIndex, anim] of Object.entries(directionAnims)) {
                const item = document.createElement('div');
                item.className = 'editor-module__list-item';
                item.textContent = `${this.directionNames[dirIndex]}: ${anim.sprites.length} frames`;
                item.dataset.type = type;
                item.dataset.direction = dirIndex;

                item.addEventListener('click', () => {
                    // Update selection
                    listEl.querySelectorAll('.editor-module__list-item').forEach(i => i.classList.remove('active'));
                    item.classList.add('active');

                    // Change animation
                    this.currentAnimationType = type;
                    this.currentDirection = parseInt(dirIndex);
                    this.currentFrameIndex = 0;
                    this.loadCurrentAnimation();

                    // Update type selector
                    const typeSelect = document.getElementById('sprite-animation-type');
                    if (typeSelect) typeSelect.value = type;

                    // Update direction button
                    const dirBtns = document.querySelectorAll('.sprite-animation__direction-btn');
                    dirBtns.forEach(btn => {
                        btn.classList.toggle('active', btn.dataset.direction === dirIndex);
                    });
                });

                listEl.appendChild(item);
            }
        }
    }

    startAnimationLoop() {
        const animate = (timestamp) => {
            if (this.isPlaying && this.currentAnimationData) {
                const frameInterval = 1000 / this.fps;
                if (timestamp - this.lastFrameTime >= frameInterval) {
                    this.nextFrame();
                    this.lastFrameTime = timestamp;
                }
            }

            this.render();
            requestAnimationFrame(animate);
        };

        requestAnimationFrame(animate);
    }

    render() {
        if (!this.ctx || !this.canvas) return;

        // Check if canvas needs resizing (container size changed or was initially 0)
        const container = this.canvas.parentElement;
        if (container && (this.canvas.width !== container.clientWidth || this.canvas.height !== container.clientHeight)) {
            if (container.clientWidth > 0 && container.clientHeight > 0) {
                this.resizeCanvas();
            }
        }

        // Clear canvas
        this.ctx.fillStyle = '#1a1a2e';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        if (!this.currentAnimationData || !this.spriteSheetImage) {
            // Draw "no animation" message
            this.ctx.fillStyle = '#666';
            this.ctx.font = '16px sans-serif';
            this.ctx.textAlign = 'center';
            this.ctx.fillText('No animation loaded', this.canvas.width / 2, this.canvas.height / 2);
            return;
        }

        // Get current sprite data
        const spriteId = this.currentAnimationData.sprites[this.currentFrameIndex];
        if (!spriteId) return;

        // Get sprite frame data from collections
        const collections = this.controller.getCollections();
        const spriteCollection = this.currentAnimationData.spriteCollection;
        const spriteData = collections?.[spriteCollection]?.[spriteId];

        if (!spriteData) {
            this.ctx.fillStyle = '#666';
            this.ctx.font = '14px sans-serif';
            this.ctx.textAlign = 'center';
            this.ctx.fillText(`Sprite not found: ${spriteId}`, this.canvas.width / 2, this.canvas.height / 2);
            return;
        }

        // Draw sprite centered and scaled
        const srcX = spriteData.x || 0;
        const srcY = spriteData.y || 0;
        const srcW = spriteData.width || 64;
        const srcH = spriteData.height || 64;

        // Update sprite size info
        const sizeInfoEl = document.getElementById('sprite-size-info');
        if (sizeInfoEl) sizeInfoEl.textContent = `${srcW} x ${srcH}`;

        const destW = srcW * this.scale;
        const destH = srcH * this.scale;
        const destX = (this.canvas.width - destW) / 2;
        const destY = 16; // Position at top with padding

        // Disable image smoothing for pixel art
        this.ctx.imageSmoothingEnabled = false;

        this.ctx.drawImage(
            this.spriteSheetImage,
            srcX, srcY, srcW, srcH,
            destX, destY, destW, destH
        );

        // Draw frame border
        this.ctx.strokeStyle = '#4a9eff';
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(destX, destY, destW, destH);
    }
}

// ES6 exports for webpack bundling
export default SpriteAnimationEditor;
export { SpriteAnimationEditor };
