// tileMapModule.js
import { CanvasUtility } from "./CanvasUtility.js"

class TileAnalysis {
    constructor() {
      this.heightIndex = 0;
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
  }
  
  const TileTransforms = {
    None: 0,
    ClockWise90: 1,
    CounterClockWise90: 2,
    Rotate180: 3,
    FlipHorizontal: 4,
    FlipVertical: 5,
  };
  
  const TileAtom = {
    Full: 0,
    OneCorner: 1,
    TwoCorner: 2,
    ThreeCorner: 3,
	FullVariation: 4,
	OneCornerBot: 5,
	TwoCornerBot: 6,
	ThreeCornerBot: 7
  };
  
  const TileMolecule = {
    Full: 0,
    Corner: 1,
    Edge: 2,
    Tunnel: 3,
    TwoSides: 4,
    Penninsula: 5,
    Island: 6,
  };
  
  const TileCliffMolecules = {
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
  };

class TileMap {

	constructor(canvas, tileSize, layerSpriteSheets) {
		this.canvas = canvas;
		this.tileSize = tileSize;
		this.numColumns = 0;
		this.layerSpriteSheets = layerSpriteSheets;
		this.tileMap = [];
		this.canvasUtility = new CanvasUtility();

	}

    load(map, isometric){
		this.tileMap = map;
		this.numColumns = this.tileMap.length;
		// Load all textures

		if(!this.layerTextures || this.layerTextures.length == 0) {
			this.layerTextures = []; 
	
			this.layerSpriteSheets.forEach((layerSprites, index) => {      
				const moleculeData = this.buildBaseMolecules(layerSprites.sprites);
				this.layerTextures[index] = moleculeData;
			});
		}

		let analyzedMap = this.analyzeMap(this.tileMap);
		this.drawMap(analyzedMap);
        if(isometric){
            this.drawIsometric();
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
		const spriteResolution = sprites[0].width;
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
		const fullSprite = sprites[TileAtom.Full];

		const oneCornerSprite = sprites[TileAtom.OneCorner];
		const twoCornerSprite = sprites[TileAtom.TwoCorner];
		const threeCornerSprite = sprites[TileAtom.ThreeCorner];

		const oneCornerBotSprite = sprites[TileAtom.OneCornerBot];
		const twoCornerBotSprite = sprites[TileAtom.TwoCornerBot];
		const threeCornerBotSprite = sprites[TileAtom.ThreeCornerBot];

		// Create CanvasRenderingContext2D objects for each texture
		const fullCtx = fullTexture.getContext("2d");

		const oneCornerCtx = oneCornerTexture.getContext("2d", { willReadFrequently: true });
		const twoCornerCtx = twoCornerTexture.getContext("2d", { willReadFrequently: true });
		const threeCornerCtx = threeCornerTexture.getContext("2d", { willReadFrequently: true });

		const oneCornerBotCtx = oneCornerBotTexture.getContext("2d", { willReadFrequently: true });
		const twoCornerBotCtx = twoCornerBotTexture.getContext("2d", { willReadFrequently: true });
		const threeCornerBotCtx = threeCornerBotTexture.getContext("2d", { willReadFrequently: true });
		
		// Copy pixels from sprites to texture canvases
		fullCtx.drawImage(fullSprite,0,0);

		oneCornerCtx.drawImage(oneCornerSprite,0,0);
		twoCornerCtx.drawImage(twoCornerSprite,0,0);
		threeCornerCtx.drawImage(threeCornerSprite,0,0);

		oneCornerBotCtx.drawImage(oneCornerBotSprite,0,0);
		twoCornerBotCtx.drawImage(twoCornerBotSprite,0,0);
		threeCornerBotCtx.drawImage(threeCornerBotSprite,0,0);

		// Get pixel data from the canvases
		const fullImageData = fullCtx.getImageData(0, 0, spriteResolution, spriteResolution);
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

		requiredTransforms[TileMolecule.Full] = [];
		requiredTransforms[TileMolecule.Corner] = [TileTransforms.FlipHorizontal, TileTransforms.FlipVertical, TileTransforms.Rotate180];
		requiredTransforms[TileMolecule.Edge] = [TileTransforms.ClockWise90, TileTransforms.CounterClockWise90, TileTransforms.Rotate180];
		requiredTransforms[TileMolecule.Tunnel] = [TileTransforms.CounterClockWise90];
		requiredTransforms[TileMolecule.TwoSides] = [TileTransforms.FlipHorizontal, TileTransforms.FlipVertical, TileTransforms.Rotate180];
		requiredTransforms[TileMolecule.Penninsula] = [TileTransforms.FlipVertical, TileTransforms.ClockWise90, TileTransforms.CounterClockWise90];
		requiredTransforms[TileMolecule.Island] = [];

		Object.keys(imageDataList).forEach(moleculeType => {
			let rotations = {};
			let colors = imageDataList[moleculeType];
			rotations[TileTransforms.None] = colors;

			if (requiredTransforms[moleculeType].includes(TileTransforms.ClockWise90)) {
				rotations[TileTransforms.ClockWise90] = this.rotateTexture(colors, Math.PI / 2);
			}
			if (requiredTransforms[moleculeType].includes(TileTransforms.CounterClockWise90)) {
				rotations[TileTransforms.CounterClockWise90] = this.rotateTexture(colors, -Math.PI / 2);
			}
			if (requiredTransforms[moleculeType].includes(TileTransforms.Rotate180)) {
				rotations[TileTransforms.Rotate180] = this.rotateTexture(colors, Math.PI);
			}
			if (requiredTransforms[moleculeType].includes(TileTransforms.FlipHorizontal)) {
				rotations[TileTransforms.FlipHorizontal] = this.flipTextureHorizontal(colors);
			}
			if (requiredTransforms[moleculeType].includes(TileTransforms.FlipVertical)) {
				rotations[TileTransforms.FlipVertical] = this.flipTextureVertical(colors);
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
		let tileAnalysis = new TileAnalysis();
		let row = y;
		let col = x;

		if (row < 0 || row >= this.numColumns || col < 0 || col >= this.numColumns) {
			return tileAnalysis; // Out of bounds
		}

		tileAnalysis.heightIndex = this.tileMap[row][col];

		// Helper function to check if a location is within bounds
		function isWithinBounds(r, c, n) {
			return r >= 0 && r < n && c >= 0 && c < n;
		}

		// Helper function to check and update tile analysis
		var checkAndUpdate = ((r, c, n, direction, propertyLess) => {
			if (isWithinBounds(r, c, n) ) {
				tileAnalysis[direction] = this.tileMap[r][c];
				if( this.tileMap[r][c] < tileAnalysis.heightIndex) {
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
					return transformationDict[molecule][TileTransforms.CounterClockWise90];
				} else if(tileAnalysis.rightLess){
                    return transformationDict[molecule][TileTransforms.ClockWise90];
				} else if(tileAnalysis.botLess){		
					return transformationDict[molecule][TileTransforms.Rotate180];
				}
				break;
			case 2:
				if(tileAnalysis.topLess && tileAnalysis.leftLess){
					return transformationDict[molecule][TileTransforms.FlipHorizontal];
				} else if(tileAnalysis.botLess && tileAnalysis.leftLess){		
					return transformationDict[molecule][TileTransforms.Rotate180];
				} else if(tileAnalysis.botLess && tileAnalysis.rightLess){		
					return transformationDict[molecule][TileTransforms.FlipVertical];
				} else if(tileAnalysis.leftLess && tileAnalysis.rightLess){
					return transformationDict[molecule][TileTransforms.CounterClockWise90];
				}
				break;
			case 3:
				if(!tileAnalysis.topLess){
					return transformationDict[molecule][TileTransforms.FlipVertical];
				} else if(!tileAnalysis.leftLess){		
					return transformationDict[molecule][TileTransforms.ClockWise90];
				} else if(!tileAnalysis.rightLess){		
					return transformationDict[molecule][TileTransforms.CounterClockWise90];
				}
				break;
			case 4:
				break;
			default:
				break;
		}		
        return transformationDict[molecule][TileTransforms.None];
	}

	getMoleculeByTileAnalysis(tileAnalysis){
		var molecule = TileCliffMolecules.Full;								
		switch(tileAnalysis.neighborLowerCount){
			case 0: 
				molecule = TileCliffMolecules.Full;
				break;
			case 1:
				if(tileAnalysis.topLess) {
					molecule = TileCliffMolecules.EdgeT;
				} else if(tileAnalysis.leftLess) {
					molecule = TileCliffMolecules.EdgeL;
				} else if(tileAnalysis.rightLess) {
					molecule = TileCliffMolecules.EdgeR;
				} else if(tileAnalysis.botLess) {
					molecule = TileCliffMolecules.EdgeB;
				}
				break;
			case 2:
				if(tileAnalysis.topLess && tileAnalysis.botLess){
					molecule = TileCliffMolecules.TunnelH;
				} else if(tileAnalysis.leftLess && tileAnalysis.rightLess){
					molecule = TileCliffMolecules.TunnelV;
				} else if(tileAnalysis.topLess && tileAnalysis.leftLess){
					molecule = TileCliffMolecules.TwoSidesTL;
				} else if(tileAnalysis.topLess && tileAnalysis.rightLess){
					molecule = TileCliffMolecules.TwoSidesTR;
				} else if(tileAnalysis.botLess && tileAnalysis.leftLess){
					molecule = TileCliffMolecules.TwoSidesBL;
				} else if(tileAnalysis.botLess && tileAnalysis.rightLess){
					molecule = TileCliffMolecules.TwoSidesBR;
				} 
				break;
			case 3:
				if( !tileAnalysis.topLess ) {
					molecule = TileCliffMolecules.PenninsulaB;
				} else if( !tileAnalysis.leftLess ) {
					molecule = TileCliffMolecules.PenninsulaR;
				} else if( !tileAnalysis.rightLess ) {
					molecule = TileCliffMolecules.PenninsulaL;
				} else if( !tileAnalysis.botLess ) {
					molecule = TileCliffMolecules.PenninsulaT;
				}
				break;								
			case 4:
				molecule = TileCliffMolecules.Island;
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
		let baseColors = this.layerTextures[tileAnalysis.heightIndex][TileMolecule.Full].data;
		let neighborColors = this.layerTextures[lowerNeighborHeight][TileMolecule.Full].data;

		// Iterate over each pixel
		for (let i = 0; i < numPixels; i++) {
			const dataIndex = i * 4;
			let pColor = { r: data[dataIndex], g: data[dataIndex + 1], b: data[dataIndex + 2], a: data[dataIndex + 3] };
			let bColor = { r: baseColors[dataIndex], g: baseColors[dataIndex + 1], b: baseColors[dataIndex + 2], a: baseColors[dataIndex + 3] };
			let tColor = { r: neighborColors[dataIndex], g: neighborColors[dataIndex + 1], b: neighborColors[dataIndex + 2], a: neighborColors[dataIndex + 3] };
	
			if (this.layerTextures.length > tileAnalysis.heightIndex) {
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
		let heightIndex = tileAnalysis.heightIndex;
	
		if (tileAnalysis.cornerLowerCount > 0) {
			if (tileAnalysis.cornerTopLeftLess && (!tileAnalysis.topLess && !tileAnalysis.leftLess)) {				
				cornerTexture = this.layerTextures[heightIndex][TileCliffMolecules.CornerTL];
				imageData = this.colorCornerTextureRoutine(imageData, 0, 0, cornerTexture, tileAnalysis);			
			}
			// Assuming tileAnalysis, textureDict, and other variables are already defined
			if (tileAnalysis.cornerTopRightLess && (!tileAnalysis.topLess && !tileAnalysis.rightLess)) {				
				cornerTexture = this.layerTextures[heightIndex][TileCliffMolecules.CornerTR];
				imageData = this.colorCornerTextureRoutine(imageData, cornerSize, 0, cornerTexture, tileAnalysis);			
			}

			if (tileAnalysis.cornerBottomLeftLess && (!tileAnalysis.botLess && !tileAnalysis.leftLess)) {				
				cornerTexture = this.layerTextures[heightIndex][TileCliffMolecules.CornerBL];
				imageData = this.colorCornerTextureRoutine(imageData, 0, cornerSize, cornerTexture, tileAnalysis);			
			}

			if (tileAnalysis.cornerBottomRightLess && (!tileAnalysis.botLess && !tileAnalysis.rightLess)) {			
				cornerTexture = this.layerTextures[heightIndex][TileCliffMolecules.CornerBR];
				imageData = this.colorCornerTextureRoutine(imageData, cornerSize, cornerSize, cornerTexture, tileAnalysis);			
			}
		}
		return imageData;
	}
	
	colorCornerTextureRoutine(outputImageData, x, y, cornerImageData, tileAnalysis) {
		let cornerSize = this.tileSize / 2;	
		let baseHeightIndex = tileAnalysis.heightIndex;
		let baseColors = this.layerTextures[baseHeightIndex][TileMolecule.Full];
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
				if (_tileAnalysis.heightIndex > layerIndex) {
					// Use base image data for higher layers
					_tileAnalysis.heightIndex = layerIndex;
					if(_tileAnalysis.topLess && _tileAnalysis.topHeight >= _tileAnalysis.heightIndex) {
						_tileAnalysis.topLess = false;
						_tileAnalysis.neighborLowerCount--;
					}
					if(_tileAnalysis.leftLess && _tileAnalysis.leftHeight >= _tileAnalysis.heightIndex) {
						_tileAnalysis.leftLess = false;
						_tileAnalysis.neighborLowerCount--;
					}
					if(_tileAnalysis.rightLess && _tileAnalysis.rightHeight >= _tileAnalysis.heightIndex){
						_tileAnalysis.rightLess = false;
						_tileAnalysis.neighborLowerCount--;
					}
					if(_tileAnalysis.botLess && _tileAnalysis.botHeight >= _tileAnalysis.heightIndex) {
						_tileAnalysis.botLess = false;
						_tileAnalysis.neighborLowerCount--;
					}
					if(_tileAnalysis.cornerTopLeftLess && _tileAnalysis.topLeftHeight >= _tileAnalysis.heightIndex) {
						_tileAnalysis.cornerTopLeftLess = false;
						_tileAnalysis.cornerLowerCount--;
					}
					if(_tileAnalysis.cornerTopRightLess && _tileAnalysis.topRightHeight >= _tileAnalysis.heightIndex) {
						_tileAnalysis.cornerTopRightLess = false;
						_tileAnalysis.cornerLowerCount--;
					}
					if(_tileAnalysis.cornerBottomLeftLess && _tileAnalysis.botLeftHeight >= _tileAnalysis.heightIndex) {
						_tileAnalysis.cornerBottomLeftLess = false;
						_tileAnalysis.cornerLowerCount--;
					}
					if(_tileAnalysis.cornerBottomRightLess && _tileAnalysis.botRightHeight >= _tileAnalysis.heightIndex) {
						_tileAnalysis.cornerBottomRightLess = false;
						_tileAnalysis.cornerLowerCount--;
					}
					
				} 
				if (_tileAnalysis.heightIndex < layerIndex) {
					// Use base image data for higher layers
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
					if( _tileAnalysis.heightIndex >= 0 ) {
						let molecule = this.getMoleculeByTileAnalysis(_tileAnalysis);						
						imageData = this.layerTextures[_tileAnalysis.heightIndex][molecule];//this.getTransformedTexture(this.layerTextures[_tileAnalysis.heightIndex], _tileAnalysis, molecule);			
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
	
				offscreenCtx.putImageData(imageData, x, y);
			});
		}
	
		// Drawing each layer canvas onto the main canvas
		Object.keys(layerCanvases).forEach(layerIndex => {
			//if( layerIndex == 0 || layerIndex == 1 || layerIndex == 2) {
			ctx.drawImage(layerCanvases[layerIndex], 0, 0);
		//}
		});
	}
  }
  
  export { TileMap };
  