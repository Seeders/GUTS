class ShapeFactory {
    constructor(palette, textures, libraryClasses) {
        this.gltfCache = new Map();
        this.gltfLoader = new THREE_.GLTFLoader();
        this.palette = palette;
        this.textures = textures;
        this.skeleUtils = THREE_.SkeletonUtils;        
    }
    async createMergedGroupFromJSON(model, frameData, groupName) {
        let mergedGroup = this.getMergedGroup(model, frameData, groupName);
        if( mergedGroup){
            return await this.createGroupFromJSON(groupName, mergedGroup);
        } else {
            return null;
        }
    }
    async createGroupFromJSON(groupName, groupData) {
        const group = new THREE.Group();
        group.name = groupName;
        group.userData = { isGroup: true };
        // Use Promise.all with map instead of forEach to properly await all shapes
        await Promise.all(groupData.shapes.map(async (shape, index) => {
            if (shape.type === 'gltf') {
                await this.handleGLTFShape(shape, index, group);
            } else {
                await this.handlePrimitiveShape(shape, index, group);
            }
        }));
        group.position.x = groupData.position.x;
        group.position.y = groupData.position.y;
        group.position.z = groupData.position.z;
        
        group.rotation.x = groupData.rotation.x;
        group.rotation.y = groupData.rotation.y;
        group.rotation.z = groupData.rotation.z;

        group.scale.x = groupData.scale.x;
        group.scale.y = groupData.scale.y;
        group.scale.z = groupData.scale.z;
        return group;
    }

    async handleGLTFShape(shape, index, group) {
        const applyTransformations = (model, gltf) => {
            // Extract animations
            const animations = gltf.animations;
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
                    // Override material with skinning enabled
                    let map = child.material.map;
                    child.material = new THREE.MeshStandardMaterial({
                        color: 0xffffff,
                        metalness: shape.metalness || 0.5,
                        roughness: shape.roughness || 0.5,
                        map: map,
                        skinning: true
                    });
                    child.material.needsUpdate = true;
                    child.castShadow = true;
                    child.receiveShadow = true;
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
                castShadow: true,
                animations: animations
            };
    
            group.add(model);
    
            if (animations && animations.length > 0) {
 
    
                const mixer = new THREE.AnimationMixer(model);
                const action = mixer.clipAction(animations[0]);
                console.log('clip', animations[0]);
                action.play();
    
                model.userData.mixer = mixer;
                let skinnedMesh;
                gltf.scene.traverse((child) => {
                    if (child.isSkinnedMesh) {
                        skinnedMesh = child;
                    }
                });
    
                if (!skinnedMesh) {
                    console.error('No SkinnedMesh found in the glTF file');
                    return;
                }    
                const skeleton = skinnedMesh.skeleton;
                model.userData.skeleton = skeleton;                
            } else {
                console.log('No animations found in GLTF file');
            }
        

        };
    
        if (shape.url) {
            const cached = this.gltfCache.get(shape.url);
            if (cached) {
                
                const clonedScene = this.skeleUtils.clone(cached.scene);
                applyTransformations(clonedScene, cached);
            } else if (shape.url && location.hostname !== "") {
                await new Promise((resolve, reject) => {
                    this.gltfLoader.load(
                        shape.url,
                        (gltf) => {
                            const clonedScene = this.skeleUtils.clone(gltf.scene);
                            this.gltfCache.set(shape.url, gltf);
                            applyTransformations(clonedScene, gltf);
                            resolve();
                        },
                        undefined,
                        (error) => {
                            console.error(`Failed to load GLTF model at ${shape.url}:`, error);
                            reject(error);
                        }
                    );
                });
            }
        } else {
            return null;
        }
    }

    async handlePrimitiveShape(shape, index, group) {
        let geometry, material;

        let colorToUse = shape.color;
        if(shape.color.paletteColor){
            colorToUse = "#ffffff";
            if(this.palette && this.palette[shape.color.paletteColor]){
                colorToUse = this.palette[shape.color.paletteColor];
            }
        }
        if(shape.texture){
            // If a texture is specified, use it instead of the color
            // If a texture is specified, use it instead of the color
            const textureLoader = new THREE.TextureLoader();
                
            const textureData = this.textures[shape.texture];
            
            if( textureData ) {
                const texture = await new Promise((resolve, reject) => {
                    textureLoader.load(
                        textureData.image,
                        (loadedTexture) => {
                            loadedTexture.wrapS = THREE.RepeatWrapping; // Use ClampToEdge instead of RepeatWrapping
                            loadedTexture.wrapT = THREE.RepeatWrapping; // Use RepeatWrapping for vertical repeat
                            loadedTexture.magFilter = THREE.NearestFilter;
                            loadedTexture.minFilter = THREE.NearestFilter;
                            loadedTexture.generateMipmaps = false;
                            loadedTexture.anisotropy = 1;
                            loadedTexture.needsUpdate = true;

                            const meshWidth = shape.width || 1; // Mesh width in world units
                            const meshHeight = shape.height || 1; // Mesh height in world units
            
                            const textureWidth = loadedTexture.image.width;
                            const textureHeight = loadedTexture.image.height;
                            const pixelsPerUnit = 2;
                            const repeatX = Math.ceil((meshWidth * pixelsPerUnit) / textureWidth);
                            const repeatY = Math.ceil((meshHeight * pixelsPerUnit) / textureHeight);
                            loadedTexture.repeat.set(repeatX, repeatY);
 
                            resolve(loadedTexture);
                        },
                        undefined,
                        (error) => reject(error)
                    );
                });
                material = new THREE.MeshStandardMaterial({ map: texture });
            } else {                
                material = new THREE.MeshStandardMaterial({ color: colorToUse });
            }
        } else {            
            // Create material with specified color
            material = new THREE.MeshStandardMaterial({ color: colorToUse });
        }

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
        mesh.userData = { isShape: true, castShadow: true, index: index };
        
        // Position and rotation
        mesh.position.set(shape.x || 0, shape.y || 0, shape.z || 0);
        mesh.rotation.set(
            (shape.rotationX || 0) * Math.PI / 180,
            (shape.rotationY || 0) * Math.PI / 180,
            (shape.rotationZ || 0) * Math.PI / 180
        );
        mesh.scale.set(
            shape.scaleX || 1,
            shape.scaleY || 1,
            shape.scaleZ || 1
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

    getMergedGroup(model, frameData, groupName) {
        const modelGroup = model[groupName];
        if (!modelGroup) {
            delete frameData?.[groupName];
            return null;
        }
    
        frameData = frameData || {};
        let frameGroup = this.initializeFrameGroup(frameData, modelGroup, groupName);
        
        this.cleanupMatchingTransforms(modelGroup, frameGroup);
        const mergedShapes = this.mergeShapes(modelGroup, frameGroup);
        
        this.cleanupEmptyShapes(frameGroup);
        
        const mergedGroup = {
            ...modelGroup,
            ...frameGroup,
            shapes: mergedShapes
        };
    
        if (modelGroup.shapes.length === 0) {
            frameGroup.shapes = [];
        }
    
        const returnVal = JSON.parse(JSON.stringify(mergedGroup));
        this.cleanupFrameData(frameData, frameGroup, groupName);
        
        return returnVal;
    }
    
    initializeFrameGroup(frameData, modelGroup, groupName) {
        if (!frameData[groupName]) {
            frameData[groupName] = JSON.parse(JSON.stringify(modelGroup));
            const frameGroup = frameData[groupName];
            frameGroup.shapes.forEach((shape, index) => {
                shape.id = index;
            });
            return frameGroup;
        }
        return frameData[groupName];
    }
    
    cleanupMatchingTransforms(modelGroup, frameGroup) {
        const properties = ['position', 'rotation', 'scale'];
        properties.forEach(prop => {
            if (JSON.stringify(modelGroup[prop]) === JSON.stringify(frameGroup[prop])) {
                delete frameGroup[prop];
            }
        });
    }
    
    mergeShapes(modelGroup, frameGroup) {
        return modelGroup.shapes.map((modelShape, i) => {
            if (!frameGroup.shapes) {
                return JSON.parse(JSON.stringify(modelShape));
            }
    
            let frameShape = frameGroup.shapes.find(shape => shape.id === i) || { id: i };
            if (!frameGroup.shapes.includes(frameShape)) {
                frameGroup.shapes.push(frameShape);
            }
    
            const mergedShape = this.mergeShapeProperties(modelShape, frameShape);
            this.cleanupMatchingShapeTransforms(modelShape, frameShape);
            
            return JSON.parse(JSON.stringify(mergedShape));
        });
    }
    
    mergeShapeProperties(modelShape, frameShape) {
        const mergedShape = {};
        
        for (const key in modelShape) {
            if (key === 'id') continue;
            
            if (frameShape && frameShape[key] !== undefined && modelShape[key] === frameShape[key]) {
                delete frameShape[key];
                mergedShape[key] = modelShape[key];
            } else if (!frameShape || frameShape[key] === undefined) {
                mergedShape[key] = modelShape[key];
            } else {
                mergedShape[key] = frameShape[key];
            }
        }
    
        return { ...mergedShape, ...frameShape };
    }
    
    cleanupMatchingShapeTransforms(modelShape, frameShape) {
        const transforms = [
            { prop: 'scale', defaultVal: 1, axes: ['X', 'Y', 'Z'] },
            { prop: 'rotation', defaultVal: 0, axes: ['X', 'Y', 'Z'] }
        ];
    
        transforms.forEach(({ prop, defaultVal, axes }) => {
            axes.forEach(axis => {
                const propName = `${prop}${axis}`;
                if (frameShape[propName] === modelShape[propName] || 
                   (frameShape[propName] === defaultVal && modelShape[propName] === undefined)) {
                    delete frameShape[propName];
                }
            });
        });
    }
    
    cleanupEmptyShapes(frameGroup) {
        if (frameGroup.shapes) {
            frameGroup.shapes = frameGroup.shapes.filter(shape => 
                Object.keys(shape).length > 0
            );
            
            if (frameGroup.shapes.length === 0) {
                delete frameGroup.shapes;
            }
        }
    }
    
    cleanupFrameData(frameData, frameGroup, groupName) {
        if (Object.keys(frameGroup).length === 0) {
            delete frameData[groupName];
        }
    }

}