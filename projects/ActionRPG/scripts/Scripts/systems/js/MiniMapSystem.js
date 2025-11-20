class MiniMapSystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.miniMapSystem = this;
        this.componentTypes = this.game.componentManager.getComponentTypes();
        
        this.MINIMAP_SIZE = 200;
        this.MINIMAP_PADDING = 10;
        
        this.container = null;
        this.canvas = null;
        this.ctx = null;
        
        this.minimapCamera = null;
        this.minimapScene = null;
        this.minimapRenderTarget = null;
        
        this.unitIconGeometry = null;
        this.buildingIconGeometry = null;
        this.goldVeinIconGeometry = null;
        this.friendlyIconMaterial = null;
        this.friendlyInstancedMesh = null;
        this.enemyIconMaterial = null;
        this.enemyInstancedMesh = null;
        this.friendlyBuildingMaterial = null;
        this.friendlyBuildingMesh = null;
        this.enemyBuildingMaterial = null;
        this.enemyBuildingMesh = null;
        this.goldVeinMaterial = null;
        this.goldVeinMesh = null;
        this.tempMatrix = null;
        
        this.isDragging = false;
        this.minimapWorldSize = 0;
        this.initialized = false;
        this.MINIMAP_ROTATION = -45;
    }

    onGameStarted() {
        // Get the container and its actual width
        this.container = document.getElementById('miniMapContainer');
        const rect = this.container.getBoundingClientRect();
       // this.MINIMAP_SIZE = rect.width; // use actual displayed size

        // Use that size for both the canvas and render target
        this.minimapWorldSize = this.game.gameManager.call('getWorldExtendedSize');
        
        this.createMinimapCamera();
        this.addTerrainBackground(); 
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
        
        this.addFogBackground();
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
                        if (visible > 0.0) {
                            // Fully visible - make it transparent so terrain shows through
                            color = vec3(0.0);
                            alpha = 0.0;
                        } else if (explored > 0.0) {
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
        const gridSize = this.game.getCollections().configs.game.gridSize;
        // Unit icons - slightly bigger
        this.unitIconGeometry = new THREE.CircleGeometry(gridSize, 4);
        
        // Building icons - much bigger
        this.buildingIconGeometry = new THREE.CircleGeometry(gridSize*2, 4);
        
        // Gold vein icons - medium size
        this.goldVeinIconGeometry = new THREE.CircleGeometry(gridSize*2, 4);
        
        const MAX_UNITS = 1000;
        const MAX_BUILDINGS = 200;
        
        // Friendly units
        this.friendlyIconMaterial = new THREE.MeshBasicMaterial({
            color: 0x00ff00,
            side: THREE.DoubleSide,
            depthWrite: false,
            depthTest: false
        });
        
        this.friendlyInstancedMesh = new THREE.InstancedMesh(
            this.unitIconGeometry,
            this.friendlyIconMaterial,
            MAX_UNITS
        );
        this.friendlyInstancedMesh.renderOrder = 100;
        this.friendlyInstancedMesh.count = 0;
        this.minimapScene.add(this.friendlyInstancedMesh);
        
        // Enemy units
        this.enemyIconMaterial = new THREE.MeshBasicMaterial({
            color: 0xff0000,
            side: THREE.DoubleSide,
            depthWrite: false,
            depthTest: false
        });
        
        this.enemyInstancedMesh = new THREE.InstancedMesh(
            this.unitIconGeometry,
            this.enemyIconMaterial,
            MAX_UNITS
        );
        this.enemyInstancedMesh.renderOrder = 100;
        this.enemyInstancedMesh.count = 0;
        this.minimapScene.add(this.enemyInstancedMesh);
        
        // Friendly buildings
        this.friendlyBuildingMaterial = new THREE.MeshBasicMaterial({
            color: 0x00ff00,
            side: THREE.DoubleSide,
            depthWrite: false,
            depthTest: false
        });
        
        this.friendlyBuildingMesh = new THREE.InstancedMesh(
            this.buildingIconGeometry,
            this.friendlyBuildingMaterial,
            MAX_BUILDINGS
        );
        this.friendlyBuildingMesh.renderOrder = 100;
        this.friendlyBuildingMesh.count = 0;
        this.minimapScene.add(this.friendlyBuildingMesh);
        
        // Enemy buildings
        this.enemyBuildingMaterial = new THREE.MeshBasicMaterial({
            color: 0xff0000,
            side: THREE.DoubleSide,
            depthWrite: false,
            depthTest: false
        });
        
        this.enemyBuildingMesh = new THREE.InstancedMesh(
            this.buildingIconGeometry,
            this.enemyBuildingMaterial,
            MAX_BUILDINGS
        );
        this.enemyBuildingMesh.renderOrder = 100;
        this.enemyBuildingMesh.count = 0;
        this.minimapScene.add(this.enemyBuildingMesh);
        
        // Gold veins (yellow)
        this.goldVeinMaterial = new THREE.MeshBasicMaterial({
            color: 0xFFD700,
            side: THREE.DoubleSide,
            depthWrite: false,
            depthTest: false
        });
        
        this.goldVeinMesh = new THREE.InstancedMesh(
            this.goldVeinIconGeometry,
            this.goldVeinMaterial,
            100
        );
        this.goldVeinMesh.renderOrder = 50;
        this.goldVeinMesh.count = 0;
        this.minimapScene.add(this.goldVeinMesh);
        
        this.tempMatrix = new THREE.Matrix4();
        this.rotationMatrix = new THREE.Matrix4();
        this.rotationMatrix.makeRotationX(-Math.PI / 2);
    }

    createMinimapUI() {
        this.canvas = document.createElement('canvas');
        this.canvas.width = this.MINIMAP_SIZE;
        this.canvas.height = this.MINIMAP_SIZE;
        this.canvas.style.width = '100%';
        this.canvas.style.height = '100%';
        this.canvas.style.display = 'block';
        this.ctx = this.canvas.getContext('2d');

        if (this.container) {
            this.container.appendChild(this.canvas);
        }

        // Update render target to match
        if (this.minimapRenderTarget) {
            this.minimapRenderTarget.setSize(this.MINIMAP_SIZE, this.MINIMAP_SIZE);
        }
    }


    setupEventListeners() {
        this.container.addEventListener('mousedown', (e) => {
            this.isDragging = true;
            this.handleMinimapClick(e);
        });
        
        this.container.addEventListener('mousemove', (e) => {
            if (this.isDragging) {
                this.handleMinimapClick(e);
            }
        });
        
        this.container.addEventListener('mouseup', () => {
            this.isDragging = false;
        });
        
        this.container.addEventListener('mouseleave', () => {
            this.isDragging = false;
        });
    }

    handleMinimapClick(event) {
        const rect = this.canvas.getBoundingClientRect();
         const camera = this.game.camera;
     
        // Get click position relative to canvas center (in pixels)
        const clickX = event.clientX - rect.left - rect.width / 2;
        const clickY = event.clientY - rect.top - rect.height / 2;
        
        // Apply inverse rotation to compensate for CSS rotation
        const angle = -this.MINIMAP_ROTATION * Math.PI / 180;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        
        const rotatedX = clickX * cos - clickY * sin;
        const rotatedY = clickX * sin + clickY * cos;

        // Convert back to normalized coordinates (0..1)
        const nx = (rotatedX + rect.width / 2) / rect.width;
        const ny = (rotatedY + rect.height / 2) / rect.height;

        let worldSize = this.game.gameManager.call('getTerrainSize') * 2;
        // Map to world coordinates
        const half = worldSize * 0.5;
        const worldX = nx * worldSize - half;
        const worldZ = ny * worldSize - half;
        this.game.gameManager.call('cameraLookAt', worldX, worldZ);
    }

    update() {
        if(!this.initialized) return;
        this.updateFogTextures();
        this.updateUnitIcons();
        this.updateGoldVeinIcons();
        this.renderMinimap();
    }

    updateFogTextures() {
        if (!this.game.fogOfWarSystem || !this.fogQuad) return;

        this.fogQuad.material.uniforms.explorationTexture.value =
            this.game.gameManager.call('getExplorationTexture');
        this.fogQuad.material.uniforms.visibilityTexture.value =
            this.game.gameManager.call('getFogTexture');

        const groundTexture = this.game.gameManager.call('getGroundTexture');
        if (this.terrainQuad && groundTexture) {
            this.terrainQuad.material.map = groundTexture;
            this.terrainQuad.material.needsUpdate = true;
        }
    }

    updateUnitIcons() {
        // In ARPG, player is always on 'player' team
        const myTeam = 'player';

        const entities = this.game.getEntitiesWith(
            this.componentTypes.POSITION,
            this.componentTypes.TEAM,
            this.componentTypes.HEALTH
        );

        let friendlyUnitIndex = 0;
        let enemyUnitIndex = 0;
        let friendlyBuildingIndex = 0;
        let enemyBuildingIndex = 0;

        for (const entityId of entities) {
            const pos = this.game.getComponent(entityId, this.componentTypes.POSITION);
            const team = this.game.getComponent(entityId, this.componentTypes.TEAM);
            const projectile = this.game.getComponent(entityId, this.componentTypes.PROJECTILE);
            const unitType = this.game.getComponent(entityId, this.componentTypes.UNIT_TYPE);

            if (!pos || !team || projectile) continue;

            const isMyUnit = team.team === myTeam;
            const visible = this.game.fogOfWarSystem?.isVisibleAt(pos.x, pos.z);

            if (!isMyUnit && !visible) continue;

            this.tempMatrix.makeTranslation(pos.x, 0, pos.z);
            this.tempMatrix.multiply(this.rotationMatrix);

            // Check if it's a building (has building collection type)
            const isBuilding = unitType && unitType.collection === 'buildings';

            if (isBuilding) {
                // It's a building
                if (isMyUnit) {
                    this.friendlyBuildingMesh.setMatrixAt(friendlyBuildingIndex, this.tempMatrix);
                    friendlyBuildingIndex++;
                } else {
                    this.enemyBuildingMesh.setMatrixAt(enemyBuildingIndex, this.tempMatrix);
                    enemyBuildingIndex++;
                }
            } else {
                // It's a unit (player, enemy, or other)
                if (isMyUnit) {
                    this.friendlyInstancedMesh.setMatrixAt(friendlyUnitIndex, this.tempMatrix);
                    friendlyUnitIndex++;
                } else {
                    this.enemyInstancedMesh.setMatrixAt(enemyUnitIndex, this.tempMatrix);
                    enemyUnitIndex++;
                }
            }
        }
        
        this.friendlyInstancedMesh.count = friendlyUnitIndex;
        this.enemyInstancedMesh.count = enemyUnitIndex;
        this.friendlyBuildingMesh.count = friendlyBuildingIndex;
        this.enemyBuildingMesh.count = enemyBuildingIndex;
        
        if (friendlyUnitIndex > 0) {
            this.friendlyInstancedMesh.instanceMatrix.needsUpdate = true;
        }
        if (enemyUnitIndex > 0) {
            this.enemyInstancedMesh.instanceMatrix.needsUpdate = true;
        }
        if (friendlyBuildingIndex > 0) {
            this.friendlyBuildingMesh.instanceMatrix.needsUpdate = true;
        }
        if (enemyBuildingIndex > 0) {
            this.enemyBuildingMesh.instanceMatrix.needsUpdate = true;
        }
    }

    updateGoldVeinIcons() {
        // In ARPG, show ground loot instead of gold veins
        const groundLoot = this.game.gameManager.call('getGroundLoot');
        if (!groundLoot) {
            this.goldVeinMesh.count = 0;
            return;
        }

        let lootIndex = 0;

        for (const [lootId, loot] of groundLoot) {
            const explored = this.game.fogOfWarSystem?.isExploredAt(loot.x, loot.z);
            if (!explored) continue;

            this.tempMatrix.makeTranslation(loot.x, 0, loot.z);
            this.tempMatrix.multiply(this.rotationMatrix);
            this.goldVeinMesh.setMatrixAt(lootIndex, this.tempMatrix);
            lootIndex++;
        }

        this.goldVeinMesh.count = lootIndex;

        if (lootIndex > 0) {
            this.goldVeinMesh.instanceMatrix.needsUpdate = true;
        }
    }

    updateCameraView() {
        if (!this.game.camera) return;
        
        const camera = this.game.camera;
        const cameraPos = camera.position;
        
        if (!cameraPos || isNaN(cameraPos.x) || isNaN(cameraPos.y) || isNaN(cameraPos.z)) {
            return;
        }
        
        const fov = camera.fov * (Math.PI / 180);
        const aspect = camera.aspect;
        const distance = camera.position.y;
        
        if (isNaN(fov) || isNaN(aspect) || isNaN(distance) || distance <= 0) {
            return;
        }
        
        const viewHeight = 2 * Math.tan(fov / 2) * distance;
        const viewWidth = viewHeight * aspect;
        
        const halfWidth = viewWidth / 2;
        const halfHeight = viewHeight / 2;
        
        const points = [
            new THREE.Vector3(cameraPos.x - halfWidth, 1, cameraPos.z - halfHeight),
            new THREE.Vector3(cameraPos.x + halfWidth, 1, cameraPos.z - halfHeight),
            new THREE.Vector3(cameraPos.x + halfWidth, 1, cameraPos.z + halfHeight),
            new THREE.Vector3(cameraPos.x - halfWidth, 1, cameraPos.z + halfHeight),
            new THREE.Vector3(cameraPos.x - halfWidth, 1, cameraPos.z - halfHeight)
        ];
        
        if (this.cameraViewMesh) {
            this.cameraViewMesh.geometry.setFromPoints(points);
        } else {
            const geometry = new THREE.BufferGeometry().setFromPoints(points);
            const material = new THREE.LineBasicMaterial({
                color: 0xffffff,
                linewidth: 3,
                depthWrite: false,
                depthTest: false
            });
            this.cameraViewMesh = new THREE.Line(geometry, material);
            this.cameraViewMesh.renderOrder = 1000;
            this.minimapScene.add(this.cameraViewMesh);
        }
    }

    addTerrainBackground() {
        // Get the ground texture from the world system
        const groundTexture = this.game.gameManager.call('getGroundTexture');
        if (!groundTexture) {
            console.warn('MiniMapSystem: Ground texture not available');
            return;
        }

        const terrainQuad = new THREE.Mesh(
            new THREE.PlaneGeometry(this.minimapWorldSize, this.minimapWorldSize),
            new THREE.MeshBasicMaterial({
                map: groundTexture,
                depthWrite: false,
                depthTest: false
            })
        );
        terrainQuad.rotation.x = -Math.PI / 2;
        terrainQuad.position.y = -2; // Below fog
        terrainQuad.renderOrder = -2000;
        
        this.minimapScene.add(terrainQuad);
        this.terrainQuad = terrainQuad;
    }

    renderMinimap() {
        this.game.renderer.setRenderTarget(this.minimapRenderTarget);
        this.game.renderer.render(this.minimapScene, this.minimapCamera);
        
        const pixels = new Uint8Array(this.MINIMAP_SIZE * this.MINIMAP_SIZE * 4);
        this.game.renderer.readRenderTargetPixels(
            this.minimapRenderTarget,
            0, 0,
            this.MINIMAP_SIZE, this.MINIMAP_SIZE,
            pixels
        );
        
        this.game.renderer.setRenderTarget(null);
        
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
        
        this.drawCameraOutline();
    }
        
    drawCameraOutline() {
        const camera = this.game.camera;
        if (!camera || !camera.isOrthographicCamera) return;

        // Frustum corners in NDC (CCW)
        const corners = [
            { x: -1, y: -1 }, // left-bottom
            { x:  1, y: -1 }, // right-bottom
            { x:  1, y:  1 }, // right-top
            { x: -1, y:  1 }, // left-top
        ];

        // Intersect each corner "ray" with the ground plane (y=0)
        const hits = [];
        for (const c of corners) {
            const hit = this.orthoCornerToGround(camera, c.x, c.y);
            if (!hit) return; // early out if any corner can't hit the ground
            hits.push(hit);
        }

        // Convert to canvas space
        const pts = hits.map(h => this.worldToCanvas(h.x, h.z));

        // Draw polygon overlay
        this.ctx.save();
        this.ctx.strokeStyle = '#ffffff';
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();
        this.ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) this.ctx.lineTo(pts[i].x, pts[i].y);
        this.ctx.closePath();
        this.ctx.stroke();
        this.ctx.restore();
    }

    orthoCornerToGround(camera, ndcX, ndcY) {
        // Point on near plane in world space
        const p = new THREE.Vector3(ndcX, ndcY, -1).unproject(camera);

        // Camera forward (world)
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);

        const EPS = 1e-6;
        if (Math.abs(forward.y) < EPS) return null; // looking exactly parallel to ground

        // Move along forward so y -> 0
        const t = -p.y / forward.y;
        if (t <= 0) return null;                    // corner ray goes upward/behind
        return p.addScaledVector(forward, t);       // world-space hit (x, 0, z)
    }
    
    worldToCanvas(x, z) {
        const half = this.minimapWorldSize / 2;
        const nx = (x + half) / this.minimapWorldSize;
        const nz = (z + half) / this.minimapWorldSize;
        const cx = nx * this.MINIMAP_SIZE;
        const cy = nz * this.MINIMAP_SIZE;
        return { x: cx, y: cy };
    }
    
    dispose() {
        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }
        
        if (this.minimapRenderTarget) {
            this.minimapRenderTarget.dispose();
        }
        
        if (this.unitIconGeometry) {
            this.unitIconGeometry.dispose();
        }
        
        if (this.buildingIconGeometry) {
            this.buildingIconGeometry.dispose();
        }
        
        if (this.goldVeinIconGeometry) {
            this.goldVeinIconGeometry.dispose();
        }
        
        if (this.friendlyIconMaterial) {
            this.friendlyIconMaterial.dispose();
        }
        
        if (this.friendlyInstancedMesh) {
            this.minimapScene.remove(this.friendlyInstancedMesh);
            this.friendlyInstancedMesh.dispose();
        }
        
        if (this.enemyIconMaterial) {
            this.enemyIconMaterial.dispose();
        }
        
        if (this.enemyInstancedMesh) {
            this.minimapScene.remove(this.enemyInstancedMesh);
            this.enemyInstancedMesh.dispose();
        }
        
        if (this.friendlyBuildingMaterial) {
            this.friendlyBuildingMaterial.dispose();
        }
        
        if (this.friendlyBuildingMesh) {
            this.minimapScene.remove(this.friendlyBuildingMesh);
            this.friendlyBuildingMesh.dispose();
        }
        
        if (this.enemyBuildingMaterial) {
            this.enemyBuildingMaterial.dispose();
        }
        
        if (this.enemyBuildingMesh) {
            this.minimapScene.remove(this.enemyBuildingMesh);
            this.enemyBuildingMesh.dispose();
        }
        
        if (this.goldVeinMaterial) {
            this.goldVeinMaterial.dispose();
        }
        
        if (this.goldVeinMesh) {
            this.minimapScene.remove(this.goldVeinMesh);
            this.goldVeinMesh.dispose();
        }
        
        if (this.terrainQuad) {
            this.minimapScene.remove(this.terrainQuad);
            this.terrainQuad.geometry.dispose();
            this.terrainQuad.material.dispose();
        }
    }
}