class ShapeFactory {
    constructor() {
        this.gltfCache = new Map();
        this.gltfLoader = new THREE.GLTFLoader();
    }
    async createMergedGroupFromJSON(model, frameData, groupName) {
        let mergedGroup = this.getMergedGroup(model, frameData, groupName);
        if( mergedGroup){
            return await this.createGroupFromJSON(mergedGroup);
        } else {
            return null;
        }
    }
    async createGroupFromJSON(groupData) {
        const group = new THREE.Group();
        group.userData = { isGroup: true };
        // Use Promise.all with map instead of forEach to properly await all shapes
        await Promise.all(groupData.shapes.map(async (shape, index) => {
            if (shape.type === 'gltf') {
                await this.handleGLTFShape(shape, index, group);
            } else {
                this.handlePrimitiveShape(shape, index, group);
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
        } else if (shape.url) {
            // Wrap gltfLoader.load in a Promise to properly await it
            await new Promise((resolve, reject) => {
                this.gltfLoader.load(
                    shape.url,
                    (gltf) => {
                        this.gltfCache.set(shape.url, gltf);
                        applyTransformations(gltf.scene.clone());
                        resolve();
                    },
                    undefined, // onProgress callback (optional)
                    (error) => {
                        console.error(`Failed to load GLTF model at ${shape.url}:`, error);
                        reject(error);
                    }
                );
            });
        }
    }

    handlePrimitiveShape(shape, index, group) {
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

    getMergedGroup(model, frameData, groupName){
        let modelGroup = model[groupName];
        if(!modelGroup){
            delete frameData[groupName];
            return null;
        }
        let frameGroup = frameData[groupName];
        if(!frameGroup){
            //group doesnt exist in animation, copy from model
            frameData[groupName] = JSON.parse(JSON.stringify(modelGroup));
            frameGroup = frameData[groupName];
            for(let i = 0; i < frameGroup.shapes.length; i++){
                frameGroup.shapes[i].id = i;
            }
        }

        if(JSON.stringify(modelGroup.position) == JSON.stringify(frameGroup.position)){

            delete frameGroup.position;
        }
        if(JSON.stringify(modelGroup.rotation) == JSON.stringify(frameGroup.rotation)){

            delete frameGroup.rotation;
        }
        if(JSON.stringify(modelGroup.scale) == JSON.stringify(frameGroup.scale)){

            delete frameGroup.scale;
        }
        let mergedShapes = [];
        for(let i = 0; i < modelGroup.shapes.length; i++){
            let modelShape = modelGroup.shapes[i];
            if(!frameGroup.shapes){
                mergedShapes.push(modelShape);
                continue;
            }
            let mergedShape = {};
            let frameShape = frameGroup.shapes.find((shape) => shape.id == i);
            if(typeof frameShape == "undefined"){
                frameShape = { id: i };
                frameGroup.shapes.push(frameShape);
            }
            for(const key in modelShape) {
                if(key == 'id'){      
                    delete modelShape.id;
                    continue;
                }
                if(frameShape && typeof frameShape[key] != "undefined" && modelShape[key] === frameShape[key]){
                    delete frameShape[key];                 
                    mergedShape[key] = modelShape[key];
                } else if(!frameShape || typeof frameShape[key] == "undefined"){
                    mergedShape[key] = modelShape[key];
                } else {
                    mergedShape[key] = frameShape[key];
                }
            }
            mergedShape = {...mergedShape, ...frameShape};
            delete mergedShape.id;
            mergedShapes.push(mergedShape);
        }
        if(frameGroup.shapes){
            for(let i = frameGroup.shapes.length - 1; i >= 0; i--){
                let shape = frameGroup.shapes[i];
                if(Object.keys(shape).length == 1){
                    frameGroup.shapes.splice(i, 1);
                }
            }  
        }                         
        const mergedGroup = {
            ...modelGroup,
            ...frameGroup,
        };
        if(modelGroup.shapes.length == 0){
            frameGroup.shapes = [];
        }

        mergedGroup.shapes = mergedShapes;
        let returnVal = JSON.parse(JSON.stringify(mergedGroup));
        if(frameGroup.shapes && frameGroup.shapes.length == 0){
            delete frameGroup.shapes;
        }
        if(Object.keys(frameGroup).length == 0) {            
           delete frameData[groupName];
        }
        return returnVal;
    }

}