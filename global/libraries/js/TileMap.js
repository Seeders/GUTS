class TileMap {

  constructor(app, config, { CanvasUtility }) {
   	this.app = app;
    this.config = config;
    this.engineClasses = {
 			"CanvasUtility": CanvasUtility
    } 
  }
	init(canvas, tileSize, layerSpriteSheets, isometric) {
		this.isometric = isometric;
		this.canvas = canvas;
		this.tileSize = tileSize;
		this.numColumns = 0;
		this.layerSpriteSheets = layerSpriteSheets;
		this.tileMap = [];
		this.layerTextures = [];
		this.canvasUtility = new (this.engineClasses.CanvasUtility)();
		
		// Initialize height map canvas
		this.heightMapCanvas = null;
		this.heightMapCtx = null;
		
		this.TileAnalysis = class {
			constructor() {
			  this.heightIndex = 0;      // Height level for cliff analysis
			  this.terrainIndex = 0;     // Terrain type for texture selection
			  this.neighborLowerCount = 0;
			  this.cornerLowerCount = 0;
			  this.topLess = false;
			  this.leftLess = false;
			  this.rightLess = false;
			  this.botLess = false;
			  this.cornerTopLeftLess = false;
			  this.cornerTopRightLess = false;
			  this.cornerBottomLeftLess = false;
			  this.cornerBottomRightLess = false;
			}
		};

		this.TileTransforms = {
			None: 0,
			ClockWise90: 1,
			CounterClockWise90: 2,
			Rotate180: 3,
			FlipHorizontal: 4,
			FlipVertical: 5,
		};
		
		this.TileAtom = {
			Full: 0,
			OneCorner: 1,
			TwoCorner: 2,
			ThreeCorner: 3,
			FullVariation: 4,
			OneCornerBot: 5,
			TwoCornerBot: 6,
			ThreeCornerBot: 7
		};
		
		this.TileMolecule = {
			Full: 0,
			Corner: 1,
			Edge: 2,
			Tunnel: 3,
			TwoSides: 4,
			Penninsula: 5,
			Island: 6,
		};
		
		this.TileCliffMolecules = {
			Full: 0,
			CornerTL: 1,
			CornerTR: 2,
			CornerBL: 3,
			CornerBR: 4,
			EdgeT: 5,
			EdgeL: 6,
			EdgeR: 7,
			EdgeB: 8,
			TunnelH: 9,
			TunnelV: 10,
			TwoSidesTL: 11,
			TwoSidesTR: 12,
			TwoSidesBL: 13,
			TwoSidesBR: 14,    
			PenninsulaT: 15,
			PenninsulaL: 16,
			PenninsulaR: 17,
			PenninsulaB: 18,
			Island: 19,
			FullVariation: 20, // Added for random full tile variation
		};
	}

	initializeHeightMapCanvas() {
		// Create height map canvas with same dimensions as main canvas
		this.heightMapCanvas = document.createElement('canvas');
		this.heightMapCanvas.width = this.canvas.width;
		this.heightMapCanvas.height = this.canvas.height;
		this.heightMapCtx = this.heightMapCanvas.getContext('2d');
		
		// Set properties for better performance when reading pixel data
		this.heightMapCanvas.setAttribute('willReadFrequently', true);
		this.heightMapCtx = this.heightMapCanvas.getContext('2d', { willReadFrequently: true });
		
		// Initialize with black (height 0)
		this.heightMapCtx.fillStyle = 'black';
		this.heightMapCtx.fillRect(0, 0, this.heightMapCanvas.width, this.heightMapCanvas.height);
	}

	updateHeightMapForTile(x, y, heightIndex) {
		if (!this.heightMapCtx) return;
		
		// Convert height index to grayscale value (0-255)
		// Assuming we have up to 256 different height levels
		const heightValue = Math.min(255, Math.max(0, heightIndex * 32)); // Scale as needed
		const heightColor = `rgb(${heightValue}, ${heightValue}, ${heightValue})`;
		
		this.heightMapCtx.fillStyle = heightColor;
		this.heightMapCtx.fillRect(x, y, this.tileSize, this.tileSize);
	}

	getHeightAtPixel(x, y) {
		if (!this.heightMapCtx) return 0;
		
		// Clamp coordinates to canvas bounds
		x = Math.max(0, Math.min(this.heightMapCanvas.width - 1, Math.floor(x)));
		y = Math.max(0, Math.min(this.heightMapCanvas.height - 1, Math.floor(y)));
		
		const imageData = this.heightMapCtx.getImageData(x, y, 1, 1);
		const heightValue = imageData.data[0]; // Red channel (same as green and blue in grayscale)
		
		// Convert back to height index
		return Math.floor(heightValue / 32); // Inverse of the scaling used in updateHeightMapForTile
	}

	getHeightMapImageData() {
		if (!this.heightMapCtx) return null;
		return this.heightMapCtx.getImageData(0, 0, this.heightMapCanvas.width, this.heightMapCanvas.height);
	}

    draw(map, heightMap = null){
		this.tileMap = map;
		this.heightMap = heightMap; // NEW: Store heightMap separately
		this.numColumns = this.tileMap.length;

		// Initialize height map canvas if not already done
		if (!this.heightMapCanvas) {
			this.initializeHeightMapCanvas();
		}

		// Clear height map canvas
		this.heightMapCtx.fillStyle = 'black';
		this.heightMapCtx.fillRect(0, 0, this.heightMapCanvas.width, this.heightMapCanvas.height);

		// Load all textures
		if(this.layerTextures.length == 0 && this.layerSpriteSheets) {
			this.layerSpriteSheets.forEach((layerSprites, index) => {
				const moleculeData = this.buildBaseMolecules(layerSprites.sprites);
				this.layerTextures[index] = moleculeData;
			});
		}

		let analyzedMap = this.analyzeMap();
		this.drawMap(analyzedMap);
        if(this.isometric){
          //  this.drawIsometric();
        }
    }

    drawIsometric() {
        let ctx = this.canvas.getContext('2d');
        // Save the original state
        ctx.save();
        
        // Create an off-screen canvas to hold original drawing
        const offscreen = document.createElement('canvas');
        offscreen.width = this.canvas.width;
        offscreen.height = this.canvas.height;
        const offCtx = offscreen.getContext('2d');
        offCtx.drawImage(this.canvas, 0, 0);
        
        // Clear the main canvas
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Move to center for rotation
        ctx.translate(this.canvas.width / 2, this.canvas.height / 2);
        
        // Apply isometric transformation
        const scale = .56;    // Adjust overall size
        const isoAngle = Math.atan(1 / 2); // ≈ 26.565° (classic isometric angle)
        const cosA = Math.cos(isoAngle);   // ≈ 0.8944
        const sinA = Math.sin(isoAngle);   // ≈ 0.4472
        
        ctx.transform(
            cosA * scale,    // scaleX
            sinA * scale,    // skewY
            -cosA * scale,   // skewX
            sinA * scale,    // scaleY
            0,               // translateX
            0                // translateY
        );
        
        // Draw the transformed image centered
        ctx.drawImage(offscreen, -this.canvas.width / 2, -this.canvas.height / 2);
        
        // Restore original state
        ctx.restore();
    }

    drawTexture(texture, x, y) {
		ctx.drawImage(texture, x, y, this.tileSize / 2, this.tileSize / 2); // Assuming each atom is 256x256
    }

    // Function to generate a molecule texture for various molecule ty
	buildBaseMolecules(sprites) {
		// Define texture objects
		const fullTexture = document.createElement("canvas");

		const oneCornerTexture = document.createElement("canvas");
		const twoCornerTexture = document.createElement("canvas");
		const threeCornerTexture = document.createElement("canvas");

		const oneCornerBotTexture = document.createElement("canvas");
		const twoCornerBotTexture = document.createElement("canvas");
		const threeCornerBotTexture = document.createElement("canvas");

		fullTexture.setAttribute('willReadFrequently', true); 

		oneCornerTexture.setAttribute('willReadFrequently', true); 
		twoCornerTexture.setAttribute('willReadFrequently', true); 
		threeCornerTexture.setAttribute('willReadFrequently', true); 

		oneCornerBotTexture.setAttribute('willReadFrequently', true); 
		twoCornerBotTexture.setAttribute('willReadFrequently', true); 
		threeCornerBotTexture.setAttribute('willReadFrequently', true); 

		// Set the texture sizes
		const spriteResolution = this.tileSize / 2;
		const finalTileBaseResolution = spriteResolution * 2;

		fullTexture.width = spriteResolution;
		fullTexture.height = spriteResolution;

		oneCornerTexture.width = spriteResolution;
		oneCornerTexture.height = spriteResolution;

		twoCornerTexture.width = spriteResolution;
		twoCornerTexture.height = spriteResolution;

		threeCornerTexture.width = spriteResolution;
		threeCornerTexture.height = spriteResolution;	

		oneCornerBotTexture.width = spriteResolution;
		oneCornerBotTexture.height = spriteResolution;	

		twoCornerBotTexture.width = spriteResolution;
		twoCornerBotTexture.height = spriteResolution;	

		threeCornerBotTexture.width = spriteResolution;
		threeCornerBotTexture.height = spriteResolution;	
		
		// Get sprite textures
		const fullSprite = sprites[this.TileAtom.Full];
		const fullVariationSprite = sprites[this.TileAtom.FullVariation]; // Sprite 4

		const oneCornerSprite = sprites[this.TileAtom.OneCorner];
		const twoCornerSprite = sprites[this.TileAtom.TwoCorner];
		const threeCornerSprite = sprites[this.TileAtom.ThreeCorner];

		const oneCornerBotSprite = sprites[this.TileAtom.OneCornerBot];
		const twoCornerBotSprite = sprites[this.TileAtom.TwoCornerBot];
		const threeCornerBotSprite = sprites[this.TileAtom.ThreeCornerBot];

		// Create CanvasRenderingContext2D objects for each texture
		const fullCtx = fullTexture.getContext("2d");
		const fullVariationTexture = document.createElement("canvas");
		fullVariationTexture.width = spriteResolution;
		fullVariationTexture.height = spriteResolution;
		fullVariationTexture.setAttribute('willReadFrequently', true);
		const fullVariationCtx = fullVariationTexture.getContext("2d");

		const oneCornerCtx = oneCornerTexture.getContext("2d", { willReadFrequently: true });
		const twoCornerCtx = twoCornerTexture.getContext("2d", { willReadFrequently: true });
		const threeCornerCtx = threeCornerTexture.getContext("2d", { willReadFrequently: true });

		const oneCornerBotCtx = oneCornerBotTexture.getContext("2d", { willReadFrequently: true });
		const twoCornerBotCtx = twoCornerBotTexture.getContext("2d", { willReadFrequently: true });
		const threeCornerBotCtx = threeCornerBotTexture.getContext("2d", { willReadFrequently: true });
		
		// Copy pixels from sprites to texture canvases
		fullCtx.drawImage(fullSprite,0,0);
		fullVariationCtx.drawImage(fullVariationSprite,0,0);

		oneCornerCtx.drawImage(oneCornerSprite,0,0);
		twoCornerCtx.drawImage(twoCornerSprite,0,0);
		threeCornerCtx.drawImage(threeCornerSprite,0,0);

		oneCornerBotCtx.drawImage(oneCornerBotSprite,0,0);
		twoCornerBotCtx.drawImage(twoCornerBotSprite,0,0);
		threeCornerBotCtx.drawImage(threeCornerBotSprite,0,0);

		// Get pixel data from the canvases
		const fullImageData = fullCtx.getImageData(0, 0, spriteResolution, spriteResolution);
		const fullVariationImageData = fullVariationCtx.getImageData(0, 0, spriteResolution, spriteResolution);
		const oneCornerTopRightImageData = oneCornerCtx.getImageData(0, 0, spriteResolution, spriteResolution);
		const oneCornerTopLeftImageData = this.flipTextureHorizontal(oneCornerCtx.getImageData(0, 0, spriteResolution, spriteResolution));	

		const oneCornerBotRightImageData = oneCornerBotCtx.getImageData(0, 0, spriteResolution, spriteResolution);
		const oneCornerBotLeftImageData = this.flipTextureHorizontal(oneCornerBotCtx.getImageData(0, 0, spriteResolution, spriteResolution));	
		
		const twoCornerTopImageData = twoCornerCtx.getImageData(0, 0, spriteResolution, spriteResolution);
		const twoCornerLeftImageData = this.rotateTexture(twoCornerCtx.getImageData(0, 0, spriteResolution, spriteResolution), -Math.PI / 2);
		const twoCornerRightImageData = this.rotateTexture(twoCornerCtx.getImageData(0, 0, spriteResolution, spriteResolution), Math.PI / 2);
		const twoCornerBottomImageData = twoCornerBotCtx.getImageData(0, 0, spriteResolution, spriteResolution);
		
		const threeCornerTopRightImageData = threeCornerCtx.getImageData(0, 0, spriteResolution, spriteResolution);
		const threeCornerTopLeftImageData = this.flipTextureHorizontal(threeCornerCtx.getImageData(0, 0, spriteResolution, spriteResolution));		
		const threeCornerBottomRightImageData = threeCornerBotCtx.getImageData(0, 0, spriteResolution, spriteResolution);
		const threeCornerBottomLeftImageData = this.flipTextureHorizontal(threeCornerBotCtx.getImageData(0, 0, spriteResolution, spriteResolution));
				
			
		// Define molecule objects
		const moleculeCanvas = document.createElement("canvas");

		moleculeCanvas.width = finalTileBaseResolution;
		moleculeCanvas.height = finalTileBaseResolution;
		
		const moleculeCtx = moleculeCanvas.getContext('2d', { willReadFrequently: true });

		const cornerCanvas = document.createElement("canvas");

		cornerCanvas.width = finalTileBaseResolution / 2;
		cornerCanvas.height = finalTileBaseResolution / 2;
		
		const cornerCtx = cornerCanvas.getContext('2d', { willReadFrequently: true });

		var imageDataList = [
			//FULL
			this.createMolecule(moleculeCtx, fullImageData, fullImageData, fullImageData, fullImageData),

			//CORNERS
			oneCornerTopLeftImageData, 
			oneCornerTopRightImageData,
			oneCornerBotLeftImageData,
			oneCornerBotRightImageData,
			//EDGES
			this.createMolecule(moleculeCtx, twoCornerTopImageData, twoCornerTopImageData, fullImageData, fullImageData),
			this.createMolecule(moleculeCtx, twoCornerLeftImageData, fullImageData, twoCornerLeftImageData, fullImageData),
			this.createMolecule(moleculeCtx, fullImageData, twoCornerRightImageData, fullImageData, twoCornerRightImageData),
			this.createMolecule(moleculeCtx, fullImageData, fullImageData, twoCornerBottomImageData, twoCornerBottomImageData),

			//TUNNELS
			this.createMolecule(moleculeCtx, twoCornerTopImageData, twoCornerTopImageData, twoCornerBottomImageData, twoCornerBottomImageData),
			this.createMolecule(moleculeCtx, twoCornerLeftImageData, twoCornerRightImageData, twoCornerLeftImageData, twoCornerRightImageData),

			//TWO SIDES
			this.createMolecule(moleculeCtx, threeCornerTopLeftImageData, twoCornerTopImageData, twoCornerLeftImageData, fullImageData),
			this.createMolecule(moleculeCtx, twoCornerTopImageData, threeCornerTopRightImageData, fullImageData, twoCornerRightImageData),
			this.createMolecule(moleculeCtx, twoCornerLeftImageData, fullImageData, threeCornerBottomLeftImageData, twoCornerBottomImageData),
			this.createMolecule(moleculeCtx, fullImageData, twoCornerRightImageData, twoCornerBottomImageData, threeCornerBottomRightImageData),

			//PENNINSULAS		
			this.createMolecule(moleculeCtx, threeCornerTopLeftImageData, threeCornerTopRightImageData, twoCornerLeftImageData, twoCornerRightImageData),
			this.createMolecule(moleculeCtx, threeCornerTopLeftImageData, twoCornerTopImageData, threeCornerBottomLeftImageData, twoCornerBottomImageData),
			this.createMolecule(moleculeCtx, twoCornerTopImageData, threeCornerTopRightImageData, twoCornerBottomImageData, threeCornerBottomRightImageData),
			this.createMolecule(moleculeCtx, twoCornerLeftImageData, twoCornerRightImageData, threeCornerBottomLeftImageData, threeCornerBottomRightImageData),

			//ISLAND
			this.createMolecule(moleculeCtx, threeCornerTopLeftImageData, threeCornerTopRightImageData, threeCornerBottomLeftImageData, threeCornerBottomRightImageData),

			//FULL VARIATION (sprite 4)
			this.createMolecule(moleculeCtx, fullVariationImageData, fullVariationImageData, fullVariationImageData, fullVariationImageData),
		];

		return imageDataList;
	}

	createMolecule(context, TLImageData, TRImageData, BLImageData, BRImageData) {
		let size = context.canvas.width;
		let spriteResolution = size / 2;
		context.fillStyle = 'black';
		context.fillRect(0, 0, size, size);
		context.putImageData(TLImageData, 0, 0);
		context.putImageData(TRImageData, spriteResolution, 0);
		context.putImageData(BLImageData, 0, spriteResolution);
		context.putImageData(BRImageData, spriteResolution, spriteResolution);
		return context.getImageData(0, 0, size, size);
	}

	extractSpritesFromSheet(spriteSheet, columns, rows) {
		let sprites = [];
		let spriteWidth = spriteSheet.width / columns;
		let spriteHeight = spriteSheet.height / rows;
	
		for (let y = 0; y < rows; y++) {
			for (let x = 0; x < columns; x++) {
				let canvas = document.createElement('canvas');
				canvas.width = spriteWidth;
				canvas.height = spriteHeight;
				let context = canvas.getContext('2d');
				context.drawImage(spriteSheet, x * spriteWidth, y * spriteHeight, spriteWidth, spriteHeight, 0, 0, spriteWidth, spriteHeight);
				sprites.push(canvas);
			}
		}
	
		return sprites;
	}
	
	getSpriteRotations(imageDataList) {
		let rotationDict = {};

		let requiredTransforms = {};

		requiredTransforms[this.TileMolecule.Full] = [];
		requiredTransforms[this.TileMolecule.Corner] = [this.TileTransforms.FlipHorizontal, this.TileTransforms.FlipVertical, this.TileTransforms.Rotate180];
		requiredTransforms[this.TileMolecule.Edge] = [this.TileTransforms.ClockWise90, this.TileTransforms.CounterClockWise90, this.TileTransforms.Rotate180];
		requiredTransforms[this.TileMolecule.Tunnel] = [this.TileTransforms.CounterClockWise90];
		requiredTransforms[this.TileMolecule.TwoSides] = [this.TileTransforms.FlipHorizontal, this.TileTransforms.FlipVertical, this.TileTransforms.Rotate180];
		requiredTransforms[this.TileMolecule.Penninsula] = [this.TileTransforms.FlipVertical, this.TileTransforms.ClockWise90, this.TileTransforms.CounterClockWise90];
		requiredTransforms[this.TileMolecule.Island] = [];

		Object.keys(imageDataList).forEach(moleculeType => {
			let rotations = {};
			let colors = imageDataList[moleculeType];
			rotations[this.TileTransforms.None] = colors;

			if (requiredTransforms[moleculeType].includes(this.TileTransforms.ClockWise90)) {
				rotations[this.TileTransforms.ClockWise90] = this.rotateTexture(colors, Math.PI / 2);
			}
			if (requiredTransforms[moleculeType].includes(this.TileTransforms.CounterClockWise90)) {
				rotations[this.TileTransforms.CounterClockWise90] = this.rotateTexture(colors, -Math.PI / 2);
			}
			if (requiredTransforms[moleculeType].includes(this.TileTransforms.Rotate180)) {
				rotations[this.TileTransforms.Rotate180] = this.rotateTexture(colors, Math.PI);
			}
			if (requiredTransforms[moleculeType].includes(this.TileTransforms.FlipHorizontal)) {
				rotations[this.TileTransforms.FlipHorizontal] = this.flipTextureHorizontal(colors);
			}
			if (requiredTransforms[moleculeType].includes(this.TileTransforms.FlipVertical)) {
				rotations[this.TileTransforms.FlipVertical] = this.flipTextureVertical(colors);
			}

			rotationDict[moleculeType] = rotations;
		});

		return rotationDict;
	}

	rotateTexture(imageData, angle) {
		return this.canvasUtility.rotateTexture(imageData, angle);
	}

	flipTextureVertical(imageData) {
		return this.canvasUtility.flipTextureVertical(imageData);
	}

	flipTextureHorizontal(imageData) {
		return this.canvasUtility.flipTextureHorizontal(imageData);
	}

	analyzeTile(x, y) {
		let tileAnalysis = new this.TileAnalysis();
		let row = y;
		let col = x;

		if (row < 0 || row >= this.numColumns || col < 0 || col >= this.numColumns) {
			return tileAnalysis; // Out of bounds
		}

		// NEW: Use heightMap for cliff analysis if available
		const heightData = this.heightMap || this.tileMap;
		tileAnalysis.heightIndex = heightData[row][col];

		// ALWAYS use tileMap for terrain texture selection
		tileAnalysis.terrainIndex = this.tileMap[row][col];

		// Helper function to check if a location is within bounds
		function isWithinBounds(r, c, n) {
			return r >= 0 && r < n && c >= 0 && c < n;
		}

		// Helper function to check and update tile analysis
		var checkAndUpdate = ((r, c, n, direction, propertyLess) => {
			if (isWithinBounds(r, c, n) ) {
				// NEW: Use heightMap if available, otherwise fall back to tileMap
				tileAnalysis[direction] = heightData[r][c];
				if( heightData[r][c] < tileAnalysis.heightIndex) {
					tileAnalysis[propertyLess] = true;
					if(['topLess', 'leftLess', 'rightLess', 'botLess'].indexOf(propertyLess) >= 0 ) {
						tileAnalysis.neighborLowerCount++;
					} else if(['cornerTopLeftLess', 'cornerTopRightLess', 'cornerBottomLeftLess', 'cornerBottomRightLess'].indexOf(propertyLess) >= 0) {
						tileAnalysis.cornerLowerCount++;
					}
				}
			}
		});

		checkAndUpdate(row - 1, col, this.numColumns, 'topHeight', 'topLess');
		checkAndUpdate(row, col - 1, this.numColumns, 'leftHeight', 'leftLess');
		checkAndUpdate(row, col + 1, this.numColumns, 'rightHeight', 'rightLess');
		checkAndUpdate(row + 1, col, this.numColumns, 'botHeight', 'botLess');
		checkAndUpdate(row - 1, col - 1, this.numColumns, 'topLeftHeight', 'cornerTopLeftLess');
		checkAndUpdate(row - 1, col + 1, this.numColumns, 'topRightHeight', 'cornerTopRightLess');
		checkAndUpdate(row + 1, col - 1, this.numColumns, 'botLeftHeight', 'cornerBottomLeftLess');
		checkAndUpdate(row + 1, col + 1, this.numColumns, 'botRightHeight', 'cornerBottomRightLess');

		return tileAnalysis;
	}

	// Function to generate a random integer between min and max (inclusive)
	getRandomInt(min, max) {
		return Math.floor(Math.random() * (max - min + 1)) + min;
	}

	// Function to generate a random 10x10 map
	generateRandomMap(rows, columns) {
		let map = [];
		for (let i = 0; i < rows; i++) {
			let row = [];
			for (let j = 0; j < columns; j++) {
				row.push(getRandomInt(0, layers.length - 1)); // Random height between 0 and 10
			}
			map.push(row);
		}
		return map;
	}

	analyzeMap() {
		let analyzedTiles = [];

		for (let i = 0; i < this.numColumns; i++) {
			for (let j = 0; j < this.numColumns; j++) {
				analyzedTiles.push(this.analyzeTile(j, i));
			}
		}

		return analyzedTiles;
	}

	getTransformedTexture(transformationDict, tileAnalysis, molecule){
		switch(tileAnalysis.neighborLowerCount){				
			case 1:
				if(tileAnalysis.leftLess){                    
					return transformationDict[molecule][this.TileTransforms.CounterClockWise90];
				} else if(tileAnalysis.rightLess){
                    return transformationDict[molecule][this.TileTransforms.ClockWise90];
				} else if(tileAnalysis.botLess){		
					return transformationDict[molecule][this.TileTransforms.Rotate180];
				}
				break;
			case 2:
				if(tileAnalysis.topLess && tileAnalysis.leftLess){
					return transformationDict[molecule][this.TileTransforms.FlipHorizontal];
				} else if(tileAnalysis.botLess && tileAnalysis.leftLess){		
					return transformationDict[molecule][this.TileTransforms.Rotate180];
				} else if(tileAnalysis.botLess && tileAnalysis.rightLess){		
					return transformationDict[molecule][this.TileTransforms.FlipVertical];
				} else if(tileAnalysis.leftLess && tileAnalysis.rightLess){
					return transformationDict[molecule][this.TileTransforms.CounterClockWise90];
				}
				break;
			case 3:
				if(!tileAnalysis.topLess){
					return transformationDict[molecule][this.TileTransforms.FlipVertical];
				} else if(!tileAnalysis.leftLess){		
					return transformationDict[molecule][this.TileTransforms.ClockWise90];
				} else if(!tileAnalysis.rightLess){		
					return transformationDict[molecule][this.TileTransforms.CounterClockWise90];
				}
				break;
			case 4:
				break;
			default:
				break;
		}		
        return transformationDict[molecule][this.TileTransforms.None];
	}

	getMoleculeByTileAnalysis(tileAnalysis){
		var molecule = this.TileCliffMolecules.Full;								
		switch(tileAnalysis.neighborLowerCount){
			case 0: 
				// Randomly choose between Full (sprite 0) and FullVariation (sprite 4)
				molecule = Math.random() < 0.5 ? this.TileCliffMolecules.Full : this.TileCliffMolecules.FullVariation;
				break;
			case 1:
				if(tileAnalysis.topLess) {
					molecule = this.TileCliffMolecules.EdgeT;
				} else if(tileAnalysis.leftLess) {
					molecule = this.TileCliffMolecules.EdgeL;
				} else if(tileAnalysis.rightLess) {
					molecule = this.TileCliffMolecules.EdgeR;
				} else if(tileAnalysis.botLess) {
					molecule = this.TileCliffMolecules.EdgeB;
				}
				break;
			case 2:
				if(tileAnalysis.topLess && tileAnalysis.botLess){
					molecule = this.TileCliffMolecules.TunnelH;
				} else if(tileAnalysis.leftLess && tileAnalysis.rightLess){
					molecule = this.TileCliffMolecules.TunnelV;
				} else if(tileAnalysis.topLess && tileAnalysis.leftLess){
					molecule = this.TileCliffMolecules.TwoSidesTL;
				} else if(tileAnalysis.topLess && tileAnalysis.rightLess){
					molecule = this.TileCliffMolecules.TwoSidesTR;
				} else if(tileAnalysis.botLess && tileAnalysis.leftLess){
					molecule = this.TileCliffMolecules.TwoSidesBL;
				} else if(tileAnalysis.botLess && tileAnalysis.rightLess){
					molecule = this.TileCliffMolecules.TwoSidesBR;
				} 
				break;
			case 3:
				if( !tileAnalysis.topLess ) {
					molecule = this.TileCliffMolecules.PenninsulaB;
				} else if( !tileAnalysis.leftLess ) {
					molecule = this.TileCliffMolecules.PenninsulaR;
				} else if( !tileAnalysis.rightLess ) {
					molecule = this.TileCliffMolecules.PenninsulaL;
				} else if( !tileAnalysis.botLess ) {
					molecule = this.TileCliffMolecules.PenninsulaT;
				}
				break;								
			case 4:
				molecule = this.TileCliffMolecules.Island;
				break;
		}
		return molecule;
	}

	colorImageData(imageData, tileAnalysis) {

		const data = new Uint8ClampedArray(imageData.data);
		var directions = ['topHeight', 'leftHeight', 'rightHeight', 'botHeight', 'topLeftHeight', 'topRightHeight', 'botLeftHeight', 'botRightHeight'];
		let heightCounts = {};
		directions.forEach((direction) => {
			let height = tileAnalysis[direction];
			if (height !== tileAnalysis.heightIndex) {
				if (!heightCounts[height]) {
					heightCounts[height] = 0;
				}
				heightCounts[height]++;
			}
		});

		let lowerNeighborHeight = Math.max(0, tileAnalysis.heightIndex - 1);
		let maxCount = 0;
		Object.keys(heightCounts).forEach((height) => {
			if (heightCounts[height] > maxCount && height < tileAnalysis.heightIndex) {
				lowerNeighborHeight = parseInt(height);
				maxCount = heightCounts[height];
			}
		});
		const numPixels = this.tileSize * this.tileSize;
		if(lowerNeighborHeight < 0){
			const blackData = new Uint8ClampedArray(numPixels * 4); // 4 values per pixel (RGBA)
			blackData.fill(0); // Fill with black (0, 0, 0, 255)
			return new ImageData(blackData, this.tileSize, this.tileSize);
		}
		// Use terrainIndex for texture selection, not heightIndex
		let baseColors = this.layerTextures[tileAnalysis.terrainIndex][this.TileMolecule.Full].data;
		let neighborColors = this.layerTextures[tileAnalysis.terrainIndex][this.TileMolecule.Full].data;

		// Iterate over each pixel
		for (let i = 0; i < numPixels; i++) {
			const dataIndex = i * 4;
			let pColor = { r: data[dataIndex], g: data[dataIndex + 1], b: data[dataIndex + 2], a: data[dataIndex + 3] };
			let bColor = { r: baseColors[dataIndex], g: baseColors[dataIndex + 1], b: baseColors[dataIndex + 2], a: baseColors[dataIndex + 3] };
			let tColor = { r: neighborColors[dataIndex], g: neighborColors[dataIndex + 1], b: neighborColors[dataIndex + 2], a: neighborColors[dataIndex + 3] };

			if (this.layerTextures.length > tileAnalysis.terrainIndex) {
				if (baseColors.length > i) {
					bColor = { r: baseColors[dataIndex], g: baseColors[dataIndex + 1], b: baseColors[dataIndex + 2], a: baseColors[dataIndex + 3] };
				}
			}
			if (lowerNeighborHeight >= 0) {
				if (neighborColors.length > i) {
					tColor = { r: neighborColors[dataIndex], g: neighborColors[dataIndex + 1], b: neighborColors[dataIndex + 2], a: neighborColors[dataIndex + 3] };
				}
			}
			let fColor = pColor;
			if (this.isEqualColor(fColor, { r: 0, g: 0, b: 0, a: 0 })) fColor = pColor;
			if (this.isEqualColor(fColor, { r: 0, g: 0, b: 0, a: 255 })) fColor = bColor;

			data.set([fColor.r, fColor.g, fColor.b, fColor.a], dataIndex);
		}
		return new ImageData(data, this.tileSize, this.tileSize);
	}

	isEqualColor(color1, color2) {
		return color1.r === color2.r && color1.g === color2.g && color1.b === color2.b && color1.a === color2.a;
	}

	addCornerGraphics(imageData, tileAnalysis) {
		let cornerSize = this.tileSize / 2;
		let cornerTexture;
		// Use terrainIndex for texture selection, not heightIndex
		let terrainIndex = tileAnalysis.terrainIndex;

		if (tileAnalysis.cornerLowerCount > 0) {
			if (tileAnalysis.cornerTopLeftLess && (!tileAnalysis.topLess && !tileAnalysis.leftLess)) {
				cornerTexture = this.layerTextures[terrainIndex][this.TileCliffMolecules.CornerTL];
				imageData = this.colorCornerTextureRoutine(imageData, 0, 0, cornerTexture, tileAnalysis);
			}
			// Assuming tileAnalysis, textureDict, and other variables are already defined
			if (tileAnalysis.cornerTopRightLess && (!tileAnalysis.topLess && !tileAnalysis.rightLess)) {
				cornerTexture = this.layerTextures[terrainIndex][this.TileCliffMolecules.CornerTR];
				imageData = this.colorCornerTextureRoutine(imageData, cornerSize, 0, cornerTexture, tileAnalysis);
			}

			if (tileAnalysis.cornerBottomLeftLess && (!tileAnalysis.botLess && !tileAnalysis.leftLess)) {
				cornerTexture = this.layerTextures[terrainIndex][this.TileCliffMolecules.CornerBL];
				imageData = this.colorCornerTextureRoutine(imageData, 0, cornerSize, cornerTexture, tileAnalysis);			
			}

			if (tileAnalysis.cornerBottomRightLess && (!tileAnalysis.botLess && !tileAnalysis.rightLess)) {
				cornerTexture = this.layerTextures[terrainIndex][this.TileCliffMolecules.CornerBR];
				imageData = this.colorCornerTextureRoutine(imageData, cornerSize, cornerSize, cornerTexture, tileAnalysis);
			}
		}
		return imageData;
	}
	
	colorCornerTextureRoutine(outputImageData, x, y, cornerImageData, tileAnalysis) {
		let cornerSize = this.tileSize / 2;
		// Use terrainIndex for texture selection, not heightIndex
		let baseTerrainIndex = tileAnalysis.terrainIndex;
		let baseColors = this.layerTextures[baseTerrainIndex][this.TileMolecule.Full];
		const data = new Uint8ClampedArray(outputImageData.data);
		for (let j = 0; j < cornerSize; j++) {
			for (let i = 0; i < cornerSize; i++) {
				// Calculate the correct position in the output image data
				let outputIndex = ((y + j) * this.tileSize + (x + i)) * 4;
	
				let baseColor = this.getColorFromImageData(baseColors, outputIndex);
		
				let sourceOriginX = i;
				let sourceOriginY = j * cornerSize;
				let sourcePixel = (sourceOriginY + sourceOriginX) * 4;
				let pColor = this.getColorFromImageData(cornerImageData, sourcePixel);
				let fColor = pColor;
				if (this.isEqualColor(fColor, { r: 0, g: 0, b: 0, a: 255 })) {
					fColor = baseColor;				
				}
	
				data[outputIndex] = fColor.r;
				data[outputIndex + 1] = fColor.g;
				data[outputIndex + 2] = fColor.b;
				data[outputIndex + 3] = fColor.a;
			}
		}

		return new ImageData(data, this.tileSize, this.tileSize);
	}
	
	getColorFromImageData(imageData, index) {
		return {
			r: imageData.data[index],
			g: imageData.data[index + 1],
			b: imageData.data[index + 2],
			a: imageData.data[index + 3]
		};
	}	
	
	addVariationImage(imageData, tileAnalysis) {
		const img = this.layerSpriteSheets[tileAnalysis.heightIndex];
	
		if (img && Math.random() < .25) {
			this.canvasUtility.setSize(imageData.width, imageData.height);
			
			
			// Paint the existing imageData onto the canvas
			this.canvasUtility.paintTexture(imageData);
	
			// Assuming img is a loaded Image object and you want to draw it at (0,0)
			// Draw the img over the imageData
			this.canvasUtility.ctx.drawImage(img, (imageData.width / 2) - img.width / 2,  (imageData.width / 2) - img.width / 2);
	
			// Get the updated imageData from the canvas
			return this.canvasUtility.ctx.getImageData(0, 0, imageData.width, imageData.height);
		} else {
			// If img is not available, return the original imageData
			return imageData;
		}
	}
	
	drawMap(analyzedMap) {
		const ctx = this.canvas.getContext('2d');
		const layerCanvases = {};
	
		for (let layerIndex = 0; layerIndex < this.layerTextures.length; layerIndex++) {
			const offscreenCanvas = document.createElement('canvas');
			offscreenCanvas.width = this.canvas.width;
			offscreenCanvas.height = this.canvas.height;
			layerCanvases[layerIndex] = offscreenCanvas;
			const offscreenCtx = offscreenCanvas.getContext('2d');
	
			analyzedMap.forEach((tileAnalysis, index) => {
				const x = (index % this.numColumns) * this.tileSize;
				const y = Math.floor(index / this.numColumns) * this.tileSize;

				let imageData;
				let _tileAnalysis = {...tileAnalysis };

				// Check if this tile's terrain should be drawn on this layer
				// Note: We still use heightIndex for cliff edge detection
				if (_tileAnalysis.terrainIndex > layerIndex) {
					// This terrain type is drawn on a higher layer, skip it
					// But we need to adjust cliff detection for this layer
					const originalHeightIndex = _tileAnalysis.heightIndex;
					_tileAnalysis.heightIndex = layerIndex;

					// Adjust cliff flags based on the current layer
					if(_tileAnalysis.topLess && _tileAnalysis.topHeight >= layerIndex) {
						_tileAnalysis.topLess = false;
						_tileAnalysis.neighborLowerCount--;
					}
					if(_tileAnalysis.leftLess && _tileAnalysis.leftHeight >= layerIndex) {
						_tileAnalysis.leftLess = false;
						_tileAnalysis.neighborLowerCount--;
					}
					if(_tileAnalysis.rightLess && _tileAnalysis.rightHeight >= layerIndex){
						_tileAnalysis.rightLess = false;
						_tileAnalysis.neighborLowerCount--;
					}
					if(_tileAnalysis.botLess && _tileAnalysis.botHeight >= layerIndex) {
						_tileAnalysis.botLess = false;
						_tileAnalysis.neighborLowerCount--;
					}
					if(_tileAnalysis.cornerTopLeftLess && _tileAnalysis.topLeftHeight >= layerIndex) {
						_tileAnalysis.cornerTopLeftLess = false;
						_tileAnalysis.cornerLowerCount--;
					}
					if(_tileAnalysis.cornerTopRightLess && _tileAnalysis.topRightHeight >= layerIndex) {
						_tileAnalysis.cornerTopRightLess = false;
						_tileAnalysis.cornerLowerCount--;
					}
					if(_tileAnalysis.cornerBottomLeftLess && _tileAnalysis.botLeftHeight >= layerIndex) {
						_tileAnalysis.cornerBottomLeftLess = false;
						_tileAnalysis.cornerLowerCount--;
					}
					if(_tileAnalysis.cornerBottomRightLess && _tileAnalysis.botRightHeight >= layerIndex) {
						_tileAnalysis.cornerBottomRightLess = false;
						_tileAnalysis.cornerLowerCount--;
					}

				}
				if (_tileAnalysis.terrainIndex < layerIndex) {
					// Use transparent data for tiles below current layer
					let numPixels = this.tileSize * this.tileSize;
					const transparentData = new Uint8ClampedArray(numPixels * 4); // 4 values per pixel (RGBA)
					
					for (let i = 0; i < numPixels * 4; i += 4) {
						transparentData[i] = 0;     // Red (not important for transparency)
						transparentData[i + 1] = 0; // Green (not important for transparency)
						transparentData[i + 2] = 0; // Blue (not important for transparency)
						transparentData[i + 3] = 0; // Alpha (0 for full transparency)
					}
					
					imageData = new ImageData(transparentData, this.tileSize, this.tileSize);
					
				 } else {
					imageData = new ImageData(new Uint8ClampedArray(4), 1, 1);
					if( _tileAnalysis.terrainIndex >= 0 ) {
						let molecule = this.getMoleculeByTileAnalysis(_tileAnalysis);
						// Use terrainIndex to select the correct texture layer
						imageData = this.layerTextures[_tileAnalysis.terrainIndex][molecule];
						imageData = this.colorImageData(imageData, _tileAnalysis);
						//imageData = this.addVariationImage(imageData, _tileAnalysis);
						imageData = this.addCornerGraphics(imageData, _tileAnalysis);
					} else {
						let numPixels = this.tileSize * this.tileSize;
						const blackData = new Uint8ClampedArray(numPixels * 4); // 4 values per pixel (RGBA)
						blackData.fill(0); // Fill with black (0, 0, 0, 255)
						imageData = new ImageData(blackData, this.tileSize, this.tileSize);
					}
				}

				// Update height map for this tile
				this.updateHeightMapForTile(x, y, tileAnalysis.heightIndex);
	
				offscreenCtx.putImageData(imageData, x + 2, y + 2);
			});
		}
	
		// Drawing each layer canvas onto the main canvas
		Object.keys(layerCanvases).forEach(layerIndex => {
			ctx.drawImage(layerCanvases[layerIndex], 0, 0);
		});
		
		// Store terrain data for height mapping
		this.terrainData = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height).data;          
	}
}