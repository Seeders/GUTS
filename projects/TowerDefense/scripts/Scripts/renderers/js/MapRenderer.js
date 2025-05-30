class MapRenderer extends engine.Component {
    
    constructor(game, parent, params) {
        super(game, parent, params);
    }
    
    
    init({canvasBuffer, terrainCanvasBuffer, worldObjects, imageManager, levelName, gameConfig, level, isEditor, palette}) {   

        this.config = gameConfig;
        this.imageManager = imageManager;
        this.worldObjects = worldObjects;
        this.selectedTowerType = null;
        this.hoverCell = { x: -1, y: -1 };
        this.showRange = false;
        this.isMapCached = false; // Flag to track if map needs redrawing
        this.currentLevel = levelName;
        this.level = level;
        this.tileMap = level.tileMap;
        this.palette = palette;

        // Create off-screen canvas for caching
        if(!this.config.is3D || isEditor) {
            this.ctx = canvasBuffer.getContext('2d');
            this.mapCacheCanvas = document.createElement('canvas');
            this.mapCacheCanvas.width = this.config.canvasWidth;
            this.mapCacheCanvas.height = this.config.canvasHeight;
            this.mapCacheCtx = this.mapCacheCanvas.getContext('2d');

            
            this.envCacheCanvasBG = document.createElement('canvas');
            this.envCacheCanvasBG.width = this.config.canvasWidth;
            this.envCacheCanvasBG.height = this.config.canvasHeight / 2;
            this.envCacheCtxBG = this.envCacheCanvasBG.getContext('2d');

            this.envCacheCanvasFG = document.createElement('canvas');
            this.envCacheCanvasFG.width = this.config.canvasWidth;
            this.envCacheCanvasFG.height = this.config.canvasHeight / 2;
            this.envCacheCtxFG = this.envCacheCanvasFG.getContext('2d');
        }
        this.terrainCanvas = terrainCanvasBuffer;
        this.terrainCanvas.width = this.tileMap.size * this.config.gridSize;
        this.terrainCanvas.height = this.tileMap.size * this.config.gridSize;
        this.terrainCtx = this.terrainCanvas.getContext('2d');
        
        this.terrainTileMapper = this.game.terrainTileMapper;
        this.game.mapRenderer = this;
        this.isometric = this.game.getCollections().configs.game.isIsometric;
    }

    draw(){}
    render(tileMapData) {
        if(!this.isMapCached){
            this.terrainCtx.clearRect(0, 0, this.terrainCanvas.width, this.terrainCanvas.height);
                
            // Draw the map onto the cache canvas
            this.drawTileMap(tileMapData);
            this.renderEnvironment();
            
            //this.drawPaths(this.terrainCacheCtx, paths);
        }
        // Mark cache as valid
        this.isMapCached = true;
    }
    renderEnvironment() {
        if (this.tileMap.environmentObjects.length === 0) return;
    
        // Group environment objects by type
        const objectsByType = {};
        this.tileMap.environmentObjects.forEach(obj => {
            if (!objectsByType[obj.type]) {
                objectsByType[obj.type] = [];
            }
            objectsByType[obj.type].push(obj);
        });
    
        // Process each type separately
        Object.entries(objectsByType).forEach(([type, objects]) => {
            // Load the model for this type
            const referenceModel = this.game.modelManager.getModel("worldObjects", type);
            if (!referenceModel) return;
    
            // Find all meshes and store their complete transform data
            const meshData = [];
            referenceModel.updateMatrixWorld(true); // Ensure world matrices are up to date
    
            referenceModel.traverse(node => {
                if (node.isMesh) {
                    const parent = node.parent;
                    const parentWorldMatrix = parent.matrixWorld.clone();
                    const localMatrix = node.matrix.clone();
    
                    // Get transform relative to model root
                    const relativeMatrix = new THREE.Matrix4();
                    relativeMatrix.copy(parentWorldMatrix);
                    relativeMatrix.multiply(localMatrix);
    
                    meshData.push({
                        mesh: node,
                        relativeMatrix: relativeMatrix
                    });
                }
            });
            if (meshData.length === 0) return;
    
            // Create instanced meshes for this type
            const instancedMeshes = meshData.map(({ mesh, relativeMatrix }) => {
                const instancedMesh = new THREE.InstancedMesh(
                    mesh.geometry,
                    mesh.material,
                    objects.length // Number of instances for this type
                );
                instancedMesh.userData.relativeMatrix = relativeMatrix;
                instancedMesh.castShadow = true;
                instancedMesh.receiveShadow = true;
                return instancedMesh;
            });
    
            // Set positions for all instances of this type
            const matrix = new THREE.Matrix4();
            const dummy = new THREE.Object3D();
    
            objects.forEach((obj, index) => {
                // Get pixel color at object position
                let hexColor = this.tileMap.terrainTypes[this.tileMap.extensionTerrainType].color.slice(1);
                let numColor = parseInt(hexColor, 16); // Convert hex string to number, e.g., 0xaa3311

                let r = (numColor >> 16) & 0xff; // Red channel
                let g = (numColor >> 8) & 0xff;  // Green channel   
                let b = numColor & 0xff;         // Blue channel
                if (g > r && g > b) {
                    dummy.position.set(
                        obj.x, 
                        this.game.getCollections().heightMaps[this.game.getCollections().worlds[this.level.world].heightMap].heightStep * this.tileMap.extensionTerrainType, 
                        obj.y
                    );
                    dummy.rotation.y = Math.random() * Math.PI * 2;
                    const scale = 0.8 + Math.random() * 0.4;
                    dummy.scale.set(scale, scale, scale);
                    dummy.updateMatrix();
            
                    // Apply transforms while preserving mesh relationships
                    instancedMeshes.forEach(instancedMesh => {
                        matrix.copy(dummy.matrix);
                        matrix.multiply(instancedMesh.userData.relativeMatrix);
                        instancedMesh.setMatrixAt(index, matrix);
                    });
                }
            });
    
            // Add instanced meshes to the scene
            instancedMeshes.forEach(instancedMesh => {
                instancedMesh.instanceMatrix.needsUpdate = true;
                this.game.scene.add(instancedMesh);
            });
        });
    }
    renderBG(tileMapData, paths) {
        this.clearMap(tileMapData);
        // Generate cache if not already done
        if (!this.isMapCached) {
            this.cacheMap(tileMapData, paths, this.isometric);            
        }        
  
        // Draw cached map image to main canvas
      
       this.ctx.drawImage( this.terrainCanvas, ( this.config.canvasWidth - this.terrainCanvas.width) / 2, ( this.config.canvasHeight - this.terrainCanvas.height) / 2 );

       //this.ctx.drawImage(this.terrainCanvas, 0, 0);
        //this.ctx.drawImage(this.mapCacheCanvas, 0,  -this.config.canvasHeight / 2);
        this.ctx.drawImage(this.envCacheCanvasBG, 0, 0);
    }
    renderFG() {  
        this.ctx.drawImage(this.envCacheCanvasFG, 0, this.config.canvasHeight / 2);
    }    
    setLevel(level) {
        this.currentLevel = level;
        this.terrainImages = this.imageManager.getImages("levels", level);

    }

    drawTileMap(tileMapData) {
        this.terrainTileMapper.draw(tileMapData.terrainMap);
    }
    clearMap(tileMapData) {
        this.ctx.clearRect(0, 0, this.config.canvasWidth, this.config.canvasHeight);
        this.ctx.fillStyle = tileMapData.terrainTypes[tileMapData.extensionTerrainType].color;       
        this.ctx.fillRect(0, 0, this.config.canvasWidth, this.config.canvasHeight);
    }
    // Call this when map data changes or on initialization
    cacheMap(tileMapData, paths, isometric) {
        this.terrainCtx.clearRect(0, 0, this.config.canvasWidth, this.config.canvasHeight);
                   
        // Clear the cache canvas
        this.mapCacheCtx.clearRect(0, 0, this.config.canvasWidth, this.config.canvasHeight);
        
        // Draw the map onto the cache canvas
        this.drawTileMap(tileMapData, isometric);
        this.drawPaths(this.mapCacheCtx, paths);
        this.drawEnvironment(tileMapData.terrainMap.length, tileMapData.terrainMap.length * tileMapData.terrainMap.length);
        
        // Mark cache as valid
        this.isMapCached = true;
    }

    drawMap(tileMap) {

        this.mapCacheCtx.fillStyle = '#4a7c59';
        this.mapCacheCtx.fillRect(0, 0, this.config.canvasWidth, this.config.canvasHeight);
        const tileWidth = this.config.gridSize;
        const tileHeight = this.config.gridSize * 0.5;
        
        for (let y = 0; y < tileMap.length; y++) {
            for (let x = 0; x < tileMap[y].length; x++) {
                const tile = tileMap[y][x];
                
                // Use translator to get iso coordinates
                const isoCoords = this.game.translator.gridToIso(x, y);
                const isoX = isoCoords.x;
                const isoY = isoCoords.y;
                
                this.mapCacheCtx.fillStyle = tile.color;
                this.mapCacheCtx.beginPath();
                this.mapCacheCtx.moveTo(isoX, isoY);
                this.mapCacheCtx.lineTo(isoX + tileWidth / 2, isoY + tileHeight / 2);
                this.mapCacheCtx.lineTo(isoX, isoY + tileHeight);
                this.mapCacheCtx.lineTo(isoX - tileWidth / 2, isoY + tileHeight / 2);
                this.mapCacheCtx.closePath();
                this.mapCacheCtx.fill();
                this.mapCacheCtx.strokeStyle = 'rgba(0, 0, 0, 0.1)';
                this.mapCacheCtx.stroke();
            }
        }
        
       
        this.drawEnvironment(tileMap.length);
    }

    drawPaths(ctx, paths) {
        const tileHeight = this.config.gridSize * 0.5;
        ctx.strokeStyle = '#ffd166';
        ctx.lineWidth = 2;
        ctx.beginPath();
        
        paths.forEach(path => {
            // First point in path
            const firstIsoCoords = this.game.translator.gridToIso(path[0].x, path[0].y);
            const firstIsoX = firstIsoCoords.x;
            const firstIsoY = firstIsoCoords.y + tileHeight / 2; // Add half tile height for center of tile
            
            ctx.moveTo(firstIsoX, firstIsoY);
            
            // Remaining points in path
            path.forEach(location => {
                const isoCoords = this.game.translator.gridToIso(location.x, location.y);
                const isoX = isoCoords.x;
                const isoY = isoCoords.y + tileHeight / 2; // Add half tile height for center of tile
                
                ctx.lineTo(isoX, isoY);
            });
        });
        
        ctx.stroke();
    }

    drawEnvironment(boardSize, amountToDraw) {

        let itemAmt = amountToDraw;
        let environmentTypes = [];
        for(let envType in this.worldObjects){
            environmentTypes.push(envType);
        }
        this.envCacheCtxBG.clearRect(0, 0, this.config.canvasWidth, this.config.canvasHeight);
        this.envCacheCtxFG.clearRect(0, 0, this.config.canvasWidth, this.config.canvasHeight);
        
        let items = [];
        
        // Check if we have stored environment objects
        if (this.tileMap.environmentObjects && this.tileMap.environmentObjects.length > 0) {
            // Use the stored objects
            this.tileMap.environmentObjects.forEach(obj => {
                const images = this.imageManager.getImages("environment", obj.type);
                if (images && images.idle && images.idle[0] && images.idle[0][obj.imageIndex]) {
                    items.push({
                        img: images.idle[0][obj.imageIndex],
                        x: obj.x,
                        y: obj.y
                    });
                }
            });
        } else {       
            // for(let i = 0; i < itemAmt; i++) {
            //     // Define the game board boundaries
            //     const boardMinX = 0;
            //     const boardMaxX = boardSize * this.config.gridSize;
            //     const boardMinY = 0;
            //     const boardMaxY = boardSize * this.config.gridSize;
                
            //     // Generate a random position that's outside the board but within a reasonable distance
            //     let x, y;
                
            //     // Expand the area where we can place objects
            //     const expandAmount = boardSize * this.config.gridSize; // Adjust this value as needed
                
            //     // Randomly choose whether to place on x-axis or y-axis outside the board
            //     if (Math.random() < 0.5) {
            //         // Place on the left or right of the board
            //         x = Math.random() < 0.5 ?
            //             boardMinX - Math.random() * expandAmount : // Left side
            //             boardMaxX + Math.random() * expandAmount;  // Right side
                    
            //         // Allow y to be anywhere, including outside the board
            //         y = boardMinY - expandAmount + Math.random() * (boardMaxY - boardMinY + 2 * expandAmount);
            //     } else {
            //         // Place on the top or bottom of the board
            //         y = Math.random() < 0.5 ?
            //             boardMinY - Math.random() * expandAmount : // Top side
            //             boardMaxY + Math.random() * expandAmount;  // Bottom side
                    
            //         // Allow x to be anywhere, including outside the board
            //         x = boardMinX - expandAmount + Math.random() * (boardMaxX - boardMinX + 2 * expandAmount);
            //     }
                
            //     // Double-check that the position is actually outside the board
            //     if (x < boardMinX || x > boardMaxX || y < boardMinY || y > boardMaxY) {
            //         const type = environmentTypes[Math.floor(Math.random() * environmentTypes.length)];
            //         const images = this.imageManager.getImages("environment", type);
            //         if(images){
            //             items.push( { img: images.idle[0][parseInt(Math.random()*images.idle[0].length)], x: x, y: y});
            //         }
            //     } else {
            //         i--; // Position inside board, try again
            //     }
            // }
        }

        items.sort((a, b) => {
            return (a.y * boardSize + a.x) - (b.y * boardSize + b.x)
        });

        items.forEach((item) => {            
            // Convert pixel to isometric
            const isoPos = this.game.translator.pixelToIso(item.x, item.y);
            const image = item.img;
            const imgWidth = image.width;
            const imgHeight = image.height;
            
            const drawX = isoPos.x;
            const drawY = isoPos.y;
            if( drawY < this.config.canvasHeight / 2 ) {
                this.envCacheCtxBG.drawImage(image, drawX - imgWidth / 2, drawY - imgHeight / 2);
            } else if(drawY - this.config.canvasHeight / 2 - imgHeight / 2 > 0) {//prevent trees in FG from getting chopped off at the top if they are too close to the middle of the frame.
  
                this.envCacheCtxFG.drawImage(image, drawX - imgWidth / 2, drawY - this.config.canvasHeight / 2 - imgHeight / 2);
            }
        });
    }

}