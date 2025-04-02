 class ShapeFactory {
    constructor() {
        this.gltfCache = new Map();
        this.gltfLoader = new THREE.GLTFLoader();
    }

    createFromJSON(shapeData) {
        const group = new THREE.Group();
        
        group.userData.isShape = true; // Mark the group itself
        shapeData.shapes.forEach((shape, index) => {
            if (shape.type === 'gltf') {
                this.handleGLTFShape(shape, index, group);
            } else {
                this.handlePrimitiveShape(shape, group);
            }
        });

        return group;
    }

    handleGLTFShape(shape, index, group) {
        const applyTransformations = (model) => {
            model.position.set(shape.x || 0, shape.y || 0, shape.z || 0);
            model.scale.set(
                shape.scaleX || 1,
                shape.scaleY || 1,
                shape.scaleZ || 1
            );
            model.rotation.set(
                (shape.rotationX || 0) * Math.PI / 180,
                (shape.rotationY || 0) * Math.PI / 180,
                (shape.rotationZ || 0) * Math.PI / 180
            );
            
            model.traverse(child => {
                if (child.isMesh) {
                    child.userData = {
                        isShape: true,
                        index: index,
                        isGLTFChild: true
                    };
                }
            });
            
            model.userData = {
                isShape: true,
                index: index,
                isGLTFRoot: true,
                castShadow: true
            };
            
            group.add(model);
        };

        const cached = this.gltfCache.get(shape.url);
        if (cached) {
            applyTransformations(cached.scene.clone());
        } else if( shape.url) {
          	
            this.gltfLoader.load(shape.url, (gltf) => {
                this.gltfCache.set(shape.url, gltf);
                applyTransformations(gltf.scene.clone());
            });
        }
    }

    handlePrimitiveShape(shape, group) {
        let geometry, material;

        // Create material with specified color
        material = new THREE.MeshStandardMaterial({ color: shape.color });

        switch (shape.type) {
            case 'sphere':
                geometry = new THREE.SphereGeometry(shape.size / 2, 32, 32);
                break;
            case 'cube':
                geometry = new THREE.BoxGeometry(shape.size, shape.size, shape.size);
                break;
            case 'box':
                geometry = new THREE.BoxGeometry(shape.width, shape.height, shape.depth || shape.width);
                break;
            case 'cylinder':
                geometry = new THREE.CylinderGeometry(shape.size / 2, shape.size / 2, shape.height, 32);
                break;
            case 'cone':
                geometry = new THREE.ConeGeometry(shape.size / 2, shape.height, 32);
                break;
            case 'torus':
                geometry = new THREE.TorusGeometry(shape.size / 2, shape.tubeSize || shape.size / 6, 16, 100);
                break;
            case 'tetrahedron':
                geometry = new THREE.TetrahedronGeometry(shape.size / 2);
                break;
            default:
                return;
        }

        const mesh = new THREE.Mesh(geometry, material);
        mesh.userData = { isShape: true, castShadow: true };
        
        // Position and rotation
        mesh.position.set(shape.x || 0, shape.y || 0, shape.z || 0);
        mesh.rotation.set(
            (shape.rotationX || 0) * Math.PI / 180,
            (shape.rotationY || 0) * Math.PI / 180,
            (shape.rotationZ || 0) * Math.PI / 180
        );

        group.add(mesh);
    }

    disposeObject(object) {
        object.traverse(child => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach(m => m.dispose());
                } else {
                    child.material.dispose();
                }
            }
        });
    }
}