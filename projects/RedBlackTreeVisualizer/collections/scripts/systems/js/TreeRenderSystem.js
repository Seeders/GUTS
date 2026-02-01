/**
 * TreeRenderSystem - 3D visualization of Red-Black Tree using Three.js
 *
 * Creates and manages Three.js scene, camera, renderer, and meshes for tree nodes and edges.
 * Self-contained 3D setup without WorldSystem dependency.
 */

const NODE_COLORS = {
    RED: 0xff4444,      // Bright red
    BLACK: 0x44cccc,    // Teal/cyan - complements red
    HIGHLIGHTED: 0x44ff44,  // Bright green
    COMPARING: 0xffaa44    // Orange for comparing
};

class TreeRenderSystem extends GUTS.BaseSystem {
    static services = [
        'highlightNode',
        'clearHighlights',
        'setComparing'
    ];

    static serviceDependencies = [
        'getAllNodeEntities'
    ];

    constructor(game) {
        super(game);
        this.game.treeRenderSystem = this;

        // Three.js objects
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;

        // Mesh tracking
        this.nodeMeshes = new Map();    // entityId -> THREE.Mesh
        this.edgeMeshes = new Map();    // "parentId-childId" -> THREE.Mesh
        this.labelSprites = new Map();  // entityId -> THREE.Sprite

        // Node geometry/materials (shared for performance)
        this.nodeGeometry = null;
        this.redMaterial = null;
        this.blackMaterial = null;
        this.highlightMaterial = null;
        this.comparingMaterial = null;
        this.edgeGeometry = null;
        this.edgeMaterial = null;

        // Animation
        this.positionLerp = 0.1;

        // Highlighting state
        this.highlightedNodes = new Set();
        this.comparingNode = null;
    }

    async init() {
        if (typeof window === 'undefined' || typeof THREE === 'undefined') {
            console.log('TreeRenderSystem: Skipping init (no browser/THREE)');
            return;
        }

        console.log('TreeRenderSystem initializing...');

        this.initThreeJs();
        this.createMaterials();
        this.createGeometries();
        this.setupLighting();

        console.log('TreeRenderSystem initialized');
    }

    initThreeJs() {
        // Create scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x000000);

        // Create camera - positioned to view tree (root at y=8, grows downward)
        this.camera = new THREE.PerspectiveCamera(
            60,
            window.innerWidth / window.innerHeight,
            0.1,
            1000
        );
        this.camera.position.set(0, 2, 25);
        this.camera.lookAt(0, 2, 0);

        // Get the existing gameCanvas from the UI
        const canvas = document.getElementById('gameCanvas');
        if (!canvas) {
            console.error('TreeRenderSystem: gameCanvas not found');
            return;
        }
        // Create renderer
        this.renderer = new THREE.WebGLRenderer({
            canvas: canvas,
            antialias: true
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        // Add orbit controls
        if (typeof THREE.OrbitControls !== 'undefined') {
            this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
            this.controls.target.set(0, 2, 0);
            this.controls.enableDamping = true;
            this.controls.dampingFactor = 0.05;
            this.controls.update();
        }

        // Handle window resize
        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });
    }

    createMaterials() {
        this.redMaterial = new THREE.MeshStandardMaterial({
            color: NODE_COLORS.RED,
            emissive: NODE_COLORS.RED,
            emissiveIntensity: 0.3,
            metalness: 0.2,
            roughness: 0.5
        });

        this.blackMaterial = new THREE.MeshStandardMaterial({
            color: NODE_COLORS.BLACK,
            emissive: NODE_COLORS.BLACK,
            emissiveIntensity: 0.3,
            metalness: 0.2,
            roughness: 0.5
        });

        this.highlightMaterial = new THREE.MeshStandardMaterial({
            color: NODE_COLORS.HIGHLIGHTED,
            emissive: NODE_COLORS.HIGHLIGHTED,
            emissiveIntensity: 0.6,
            metalness: 0.3,
            roughness: 0.4
        });

        this.comparingMaterial = new THREE.MeshStandardMaterial({
            color: NODE_COLORS.COMPARING,
            emissive: NODE_COLORS.COMPARING,
            emissiveIntensity: 0.5,
            metalness: 0.3,
            roughness: 0.4
        });

        this.edgeMaterial = new THREE.MeshStandardMaterial({
            color: 0x888888,
            emissive: 0x333333,
            emissiveIntensity: 0.2,
            metalness: 0.2,
            roughness: 0.6
        });
    }

    createGeometries() {
        this.nodeGeometry = new THREE.SphereGeometry(0.6, 32, 32);
        this.edgeGeometry = new THREE.CylinderGeometry(0.08, 0.08, 1, 8);
    }

    setupLighting() {
        if (!this.scene) return;

        // Ambient light - brighter for better visibility
        const ambient = new THREE.AmbientLight(0xffffff, 0.8);
        this.scene.add(ambient);

        // Directional light (sun)
        const directional = new THREE.DirectionalLight(0xffffff, 0.6);
        directional.position.set(10, 20, 10);
        this.scene.add(directional);

        // Back light for better depth
        const backLight = new THREE.DirectionalLight(0xffffff, 0.3);
        backLight.position.set(-10, 10, -10);
        this.scene.add(backLight);

        // Set background color - slightly lighter for contrast
        this.scene.background = new THREE.Color(0x000000);
    }

    // ============= Services =============

    highlightNode(value) {
        this.highlightedNodes.add(value);
    }

    clearHighlights() {
        this.highlightedNodes.clear();
        this.comparingNode = null;
    }

    setComparing(value) {
        this.comparingNode = value;
    }

    // ============= Render Loop =============

    render() {
        if (!this.scene || !this.renderer || !this.camera) return;
        if (!this.call.getAllNodeEntities) return;

        const nodeEntities = this.call.getAllNodeEntities();

        // Track which entities still exist
        const existingEntities = new Set(nodeEntities);

        // Update or create meshes for each node
        for (const entityId of nodeEntities) {
            this.updateNodeMesh(entityId);
        }

        // Remove meshes for deleted entities
        for (const [entityId, mesh] of this.nodeMeshes) {
            if (!existingEntities.has(entityId)) {
                this.scene.remove(mesh);
                this.nodeMeshes.delete(entityId);

                // Remove label sprite
                const label = this.labelSprites.get(entityId);
                if (label) {
                    this.scene.remove(label);
                    this.labelSprites.delete(entityId);
                }
            }
        }

        // Update edges
        this.updateEdges(nodeEntities);

        // Update controls
        if (this.controls) {
            this.controls.update();
        }

        // Render the scene
        this.renderer.render(this.scene, this.camera);
    }

    updateNodeMesh(entityId) {
        const treeNode = this.game.getComponent(entityId, 'treeNode');
        const transform = this.game.getComponent(entityId, 'transform');

        if (!treeNode || !transform) return;

        let mesh = this.nodeMeshes.get(entityId);

        // Create mesh if doesn't exist
        if (!mesh) {
            mesh = new THREE.Mesh(this.nodeGeometry, this.blackMaterial);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            this.scene.add(mesh);
            this.nodeMeshes.set(entityId, mesh);

            // Create label sprite
            this.createLabel(entityId, treeNode.value);
        }

        // Update material based on state
        if (this.highlightedNodes.has(treeNode.value)) {
            mesh.material = this.highlightMaterial;
        } else if (this.comparingNode === treeNode.value) {
            mesh.material = this.comparingMaterial;
        } else if (treeNode.color === 'RED') {
            mesh.material = this.redMaterial;
        } else {
            mesh.material = this.blackMaterial;
        }

        // Lerp position for smooth animation
        const targetPos = transform.position;
        mesh.position.x += (targetPos.x - mesh.position.x) * this.positionLerp;
        mesh.position.y += (targetPos.y - mesh.position.y) * this.positionLerp;
        mesh.position.z += (targetPos.z - mesh.position.z) * this.positionLerp;

        // Update label position (slightly in front of node)
        const label = this.labelSprites.get(entityId);
        if (label) {
            label.position.copy(mesh.position);
            label.position.z += 0.7;  // Position in front of sphere
        }
    }

    createLabel(entityId, value) {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');

        // Draw circular background
        ctx.beginPath();
        ctx.arc(128, 128, 100, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 4;
        ctx.stroke();

        // Draw text with outline for visibility
        const text = value.toString();
        ctx.font = 'bold 80px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Text outline
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 6;
        ctx.strokeText(text, 128, 128);

        // Text fill
        ctx.fillStyle = '#ffffff';
        ctx.fillText(text, 128, 128);

        const texture = new THREE.CanvasTexture(canvas);
        const spriteMaterial = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            depthWrite: false
        });

        const sprite = new THREE.Sprite(spriteMaterial);
        sprite.scale.set(1.2, 1.2, 1);
        this.scene.add(sprite);
        this.labelSprites.set(entityId, sprite);
    }

    updateEdges(nodeEntities) {
        const activeEdges = new Set();

        for (const entityId of nodeEntities) {
            const treeNode = this.game.getComponent(entityId, 'treeNode');
            const transform = this.game.getComponent(entityId, 'transform');
            if (!treeNode || !transform) continue;

            // Create edges to children
            if (treeNode.leftId) {
                this.updateEdge(entityId, treeNode.leftId, activeEdges);
            }
            if (treeNode.rightId) {
                this.updateEdge(entityId, treeNode.rightId, activeEdges);
            }
        }

        // Remove old edges
        for (const [key, mesh] of this.edgeMeshes) {
            if (!activeEdges.has(key)) {
                this.scene.remove(mesh);
                this.edgeMeshes.delete(key);
            }
        }
    }

    updateEdge(parentId, childId, activeEdges) {
        const key = `${parentId}-${childId}`;
        activeEdges.add(key);

        const parentTransform = this.game.getComponent(parentId, 'transform');
        const childTransform = this.game.getComponent(childId, 'transform');

        if (!parentTransform || !childTransform) return;

        let mesh = this.edgeMeshes.get(key);

        if (!mesh) {
            mesh = new THREE.Mesh(this.edgeGeometry, this.edgeMaterial);
            this.scene.add(mesh);
            this.edgeMeshes.set(key, mesh);
        }

        // Get parent mesh position (lerped)
        const parentMesh = this.nodeMeshes.get(parentId);
        const childMesh = this.nodeMeshes.get(childId);

        if (!parentMesh || !childMesh) return;

        const start = parentMesh.position;
        const end = childMesh.position;

        // Calculate edge position and orientation
        const midpoint = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
        const direction = new THREE.Vector3().subVectors(end, start);
        const length = direction.length();

        mesh.position.copy(midpoint);
        mesh.scale.set(1, length, 1);

        // Orient cylinder to point from parent to child
        mesh.quaternion.setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            direction.normalize()
        );
    }
}

// Export
if (typeof window !== 'undefined') {
    window.TreeRenderSystem = TreeRenderSystem;
}
