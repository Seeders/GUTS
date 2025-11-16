class MinimapSystem extends BaseSystem {
    constructor(game) {
        super(game);
        this.game.minimapSystem = this;

        this.MINIMAP_SIZE = 200;
        this.MINIMAP_PADDING = 10;

        this.container = null;
        this.canvas = null;
        this.ctx = null;

        this.minimapCamera = null;
        this.minimapScene = null;
        this.minimapRenderTarget = null;

        this.playerIconMaterial = null;
        this.playerIconMesh = null;
        this.enemyIconMaterial = null;
        this.enemyInstancedMesh = null;
        this.tempMatrix = null;

        this.minimapWorldSize = 0;
        this.initialized = false;
    }

    onGameStarted() {
        this.container = document.getElementById('minimapContainer');
        if (!this.container) {
            console.warn('MinimapSystem: minimap container not found');
            return;
        }

        this.minimapWorldSize = this.game.state.terrainWidth || 80;

        this.createMinimapCamera();
        this.addTerrainBackground();
        this.addFogBackground();
        this.createIconMaterials();
        this.createMinimapUI();
        this.setupEventListeners();
        this.initialized = true;
    }

    createMinimapCamera() {
        const halfSize = this.minimapWorldSize / 2;

        this.minimapCamera = new THREE.OrthographicCamera(
            -halfSize, halfSize,
            halfSize, -halfSize,
            0.1, 1000
        );
        this.minimapCamera.position.set(0, 500, 0);
        this.minimapCamera.lookAt(0, 0, 0);

        this.minimapScene = new THREE.Scene();

        this.minimapRenderTarget = new THREE.WebGLRenderTarget(
            this.MINIMAP_SIZE,
            this.MINIMAP_SIZE,
            {
                minFilter: THREE.LinearFilter,
                magFilter: THREE.LinearFilter,
                format: THREE.RGBAFormat
            }
        );
    }

    addTerrainBackground() {
        // Create a simple grid texture for the terrain
        const terrainCanvas = document.createElement('canvas');
        terrainCanvas.width = 256;
        terrainCanvas.height = 256;
        const terrainCtx = terrainCanvas.getContext('2d');

        // Draw terrain based on game state
        if (this.game.state.terrainMap) {
            const terrainWidth = this.game.state.terrainWidth;
            const terrainHeight = this.game.state.terrainHeight;
            const cellWidth = 256 / terrainWidth;
            const cellHeight = 256 / terrainHeight;

            for (let z = 0; z < terrainHeight; z++) {
                for (let x = 0; x < terrainWidth; x++) {
                    const terrainType = this.game.state.terrainMap[z][x];
                    if (terrainType === 1) {
                        // Wall
                        terrainCtx.fillStyle = '#666666';
                    } else {
                        // Floor
                        terrainCtx.fillStyle = '#333333';
                    }
                    terrainCtx.fillRect(x * cellWidth, z * cellHeight, cellWidth, cellHeight);
                }
            }
        }

        const texture = new THREE.CanvasTexture(terrainCanvas);

        const terrainQuad = new THREE.Mesh(
            new THREE.PlaneGeometry(this.minimapWorldSize, this.minimapWorldSize),
            new THREE.MeshBasicMaterial({
                map: texture,
                depthWrite: false,
                depthTest: false
            })
        );
        terrainQuad.rotation.x = -Math.PI / 2;
        terrainQuad.position.y = -2;
        terrainQuad.renderOrder = -2000;

        this.minimapScene.add(terrainQuad);
        this.terrainQuad = terrainQuad;
    }

    addFogBackground() {
        const fogQuad = new THREE.Mesh(
            new THREE.PlaneGeometry(this.minimapWorldSize, this.minimapWorldSize),
            new THREE.ShaderMaterial({
                uniforms: {
                    explorationTexture: { value: null },
                    visibilityTexture: { value: null }
                },
                vertexShader: `
                    varying vec2 vUv;
                    void main() {
                        vUv = uv;
                        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    }
                `,
                fragmentShader: `
                    uniform sampler2D explorationTexture;
                    uniform sampler2D visibilityTexture;
                    varying vec2 vUv;

                    void main() {
                        float explored = texture2D(explorationTexture, vUv).r;
                        float visible = texture2D(visibilityTexture, vUv).r;

                        vec3 color;
                        float alpha;
                        if (visible > 0.1) {
                            // Fully visible - transparent
                            color = vec3(0.0);
                            alpha = 0.0;
                        } else if (explored > 0.1) {
                            // Explored but not visible - dark overlay
                            color = vec3(0.0);
                            alpha = 0.6;
                        } else {
                            // Unexplored - black
                            color = vec3(0.0);
                            alpha = 1.0;
                        }

                        gl_FragColor = vec4(color, alpha);
                    }
                `,
                transparent: true,
                depthWrite: false,
                depthTest: false
            })
        );
        fogQuad.rotation.x = -Math.PI / 2;
        fogQuad.position.y = -1;
        fogQuad.renderOrder = 100;

        this.minimapScene.add(fogQuad);
        this.fogQuad = fogQuad;
    }

    createIconMaterials() {
        const gridSize = 0.5;

        // Player icon
        const playerGeometry = new THREE.CircleGeometry(gridSize, 8);
        this.playerIconMaterial = new THREE.MeshBasicMaterial({
            color: 0x00ff00,
            side: THREE.DoubleSide,
            depthWrite: false,
            depthTest: false
        });

        this.playerIconMesh = new THREE.Mesh(playerGeometry, this.playerIconMaterial);
        this.playerIconMesh.rotation.x = -Math.PI / 2;
        this.playerIconMesh.renderOrder = 200;
        this.minimapScene.add(this.playerIconMesh);

        // Enemy icons
        const enemyGeometry = new THREE.CircleGeometry(gridSize * 0.8, 6);
        this.enemyIconMaterial = new THREE.MeshBasicMaterial({
            color: 0xff0000,
            side: THREE.DoubleSide,
            depthWrite: false,
            depthTest: false
        });

        const MAX_ENEMIES = 500;
        this.enemyInstancedMesh = new THREE.InstancedMesh(
            enemyGeometry,
            this.enemyIconMaterial,
            MAX_ENEMIES
        );
        this.enemyInstancedMesh.rotation.x = -Math.PI / 2;
        this.enemyInstancedMesh.renderOrder = 150;
        this.enemyInstancedMesh.count = 0;
        this.minimapScene.add(this.enemyInstancedMesh);

        this.tempMatrix = new THREE.Matrix4();
    }

    createMinimapUI() {
        this.canvas = document.createElement('canvas');
        this.canvas.width = this.MINIMAP_SIZE;
        this.canvas.height = this.MINIMAP_SIZE;
        this.canvas.style.width = '100%';
        this.canvas.style.height = '100%';
        this.canvas.style.display = 'block';
        this.canvas.style.border = '2px solid #8b0000';
        this.ctx = this.canvas.getContext('2d');

        if (this.container) {
            this.container.appendChild(this.canvas);
        }
    }

    setupEventListeners() {
        this.canvas.addEventListener('click', (e) => {
            this.handleMinimapClick(e);
        });
    }

    handleMinimapClick(event) {
        const rect = this.canvas.getBoundingClientRect();

        const nx = (event.clientX - rect.left) / rect.width;
        const ny = (event.clientY - rect.top) / rect.height;

        const half = this.minimapWorldSize * 0.5;
        const worldX = nx * this.minimapWorldSize - half;
        const worldZ = ny * this.minimapWorldSize - half;

        // Set player move target
        const player = this.findPlayer();
        if (player) {
            const controller = this.game.getComponent(player, 'PlayerController');
            if (controller) {
                controller.targetPosition = { x: worldX, y: 0, z: worldZ };
                controller.isMoving = true;
                controller.attackTarget = null;
            }
        }
    }

    findPlayer() {
        const players = this.game.getEntitiesWith('PlayerController');
        return players.values().next().value;
    }

    update() {
        if (!this.initialized) return;

        this.updateFogTextures();
        this.updateIcons();
        this.renderMinimap();
    }

    updateFogTextures() {
        if (!this.game.fogOfWarSystem || !this.fogQuad) return;

        this.fogQuad.material.uniforms.explorationTexture.value =
            this.game.gameManager.call('getExplorationTexture');
        this.fogQuad.material.uniforms.visibilityTexture.value =
            this.game.gameManager.call('getFogTexture');
    }

    updateIcons() {
        // Update player position
        const player = this.findPlayer();
        if (player) {
            const pos = this.game.getComponent(player, 'Position');
            if (pos) {
                this.playerIconMesh.position.set(pos.x, 0, pos.z);
            }
        }

        // Update enemy positions
        const enemies = this.game.getEntitiesWith('Position', 'EnemyAI', 'Health');
        let enemyIndex = 0;

        for (const enemyId of enemies) {
            const pos = this.game.getComponent(enemyId, 'Position');
            if (!pos) continue;

            // Only show if explored or visible
            const explored = this.game.gameManager.call('isExploredAt', pos.x, pos.z);
            const visible = this.game.gameManager.call('isVisibleAt', pos.x, pos.z);

            if (!explored && !visible) continue;

            this.tempMatrix.makeTranslation(pos.x, 0, pos.z);
            this.enemyInstancedMesh.setMatrixAt(enemyIndex, this.tempMatrix);
            enemyIndex++;
        }

        this.enemyInstancedMesh.count = enemyIndex;
        if (enemyIndex > 0) {
            this.enemyInstancedMesh.instanceMatrix.needsUpdate = true;
        }
    }

    renderMinimap() {
        this.game.renderSystem.renderer.setRenderTarget(this.minimapRenderTarget);
        this.game.renderSystem.renderer.render(this.minimapScene, this.minimapCamera);

        const pixels = new Uint8Array(this.MINIMAP_SIZE * this.MINIMAP_SIZE * 4);
        this.game.renderSystem.renderer.readRenderTargetPixels(
            this.minimapRenderTarget,
            0, 0,
            this.MINIMAP_SIZE, this.MINIMAP_SIZE,
            pixels
        );

        this.game.renderSystem.renderer.setRenderTarget(null);

        const imageData = this.ctx.createImageData(this.MINIMAP_SIZE, this.MINIMAP_SIZE);

        for (let y = 0; y < this.MINIMAP_SIZE; y++) {
            for (let x = 0; x < this.MINIMAP_SIZE; x++) {
                const srcIdx = (y * this.MINIMAP_SIZE + x) * 4;
                const dstIdx = ((this.MINIMAP_SIZE - 1 - y) * this.MINIMAP_SIZE + x) * 4;

                imageData.data[dstIdx + 0] = pixels[srcIdx + 0];
                imageData.data[dstIdx + 1] = pixels[srcIdx + 1];
                imageData.data[dstIdx + 2] = pixels[srcIdx + 2];
                imageData.data[dstIdx + 3] = pixels[srcIdx + 3];
            }
        }

        this.ctx.putImageData(imageData, 0, 0);
    }

    dispose() {
        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }

        if (this.minimapRenderTarget) {
            this.minimapRenderTarget.dispose();
        }

        if (this.playerIconMaterial) {
            this.playerIconMaterial.dispose();
        }

        if (this.enemyIconMaterial) {
            this.enemyIconMaterial.dispose();
        }

        if (this.terrainQuad) {
            this.terrainQuad.geometry.dispose();
            this.terrainQuad.material.dispose();
        }
    }
}
