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
		this.baseAtoms = []; // Store base atoms per terrain type
		this.canvasUtility = new (this.engineClasses.CanvasUtility)();

		// Initialize height map canvas
		this.heightMapCanvas = null;
		this.heightMapCtx = null;
		
		this.TileAnalysis = class {
			constructor() {
			  this.heightIndex = 0;
			  this.neighborLowerCount = 0;
			  this.cornerLowerCount = 0;
			  this.topHeight = 0;
			  this.leftHeight = 0;
			  this.rightHeight = 0;
			  this.botHeight = 0;
			  this.topLeftHeight = 0;
			  this.topRightHeight = 0;
			  this.botLeftHeight = 0;
			  this.botRightHeight = 0;
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
				const result = this.buildBaseMolecules(layerSprites.sprites);
				this.layerTextures[index] = result.molecules;
				this.baseAtoms[index] = result.baseAtoms;
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

		// Store base atoms for acute corner handling (will be returned, not stored here)
		const baseAtoms = {
			full: fullImageData,
			fullVariation: fullVariationImageData,
			oneCornerTL: oneCornerTopLeftImageData,
			oneCornerTR: oneCornerTopRightImageData,
			oneCornerBL: oneCornerBotLeftImageData,
			oneCornerBR: oneCornerBotRightImageData
		};

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

		return { molecules: imageDataList, baseAtoms: baseAtoms };
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

	// Extract individual atoms from a molecule ImageData
	extractAtomsFromMolecule(moleculeImageData) {
		const atomSize = this.tileSize / 2;
		const canvas = document.createElement('canvas');
		canvas.width = this.tileSize;
		canvas.height = this.tileSize;
		const ctx = canvas.getContext('2d');

		// Draw the molecule onto canvas
		ctx.putImageData(moleculeImageData, 0, 0);

		// Extract each atom
		return {
			TL: ctx.getImageData(0, 0, atomSize, atomSize),
			TR: ctx.getImageData(atomSize, 0, atomSize, atomSize),
			BL: ctx.getImageData(0, atomSize, atomSize, atomSize),
			BR: ctx.getImageData(atomSize, atomSize, atomSize, atomSize)
		};
	}

	// Select the correct atom for a specific position based on neighbor analysis
	selectAtomForPosition(tile, position, terrainIndex) {
		const analysis = tile.terrainAnalysis;
		const atoms = this.baseAtoms[terrainIndex];

		if (!atoms) return null;

		// For each position, check diagonal and adjacent cardinals to determine atom type
		switch(position) {
			case 'TL': {
				// Top-left atom: check top, left, and top-left diagonal
				const diagonalLess = analysis.cornerTopLeftLess;
				const topLess = analysis.topLess;
				const leftLess = analysis.leftLess;

				if (diagonalLess && !topLess && !leftLess) {
					// Only diagonal is lower: use oneCorner with TL corner cut
					return atoms.oneCornerTL;
				} else if (!topLess && !leftLess) {
					// No neighbors lower: use full atom
					return atoms.full;
				} else {
					// Cardinal neighbors are lower: handled by molecule logic
					return null; // Will use molecule-based atom
				}
			}
			case 'TR': {
				// Top-right atom: check top, right, and top-right diagonal
				const diagonalLess = analysis.cornerTopRightLess;
				const topLess = analysis.topLess;
				const rightLess = analysis.rightLess;

				if (diagonalLess && !topLess && !rightLess) {
					// Only diagonal is lower: use oneCorner with TR corner cut
					return atoms.oneCornerTR;
				} else if (!topLess && !rightLess) {
					// No neighbors lower: use full atom
					return atoms.full;
				} else {
					return null; // Will use molecule-based atom
				}
			}
			case 'BL': {
				// Bottom-left atom: check bottom, left, and bottom-left diagonal
				const diagonalLess = analysis.cornerBottomLeftLess;
				const botLess = analysis.botLess;
				const leftLess = analysis.leftLess;

				if (diagonalLess && !botLess && !leftLess) {
					// Only diagonal is lower: use oneCorner with BL corner cut
					return atoms.oneCornerBL;
				} else if (!botLess && !leftLess) {
					// No neighbors lower: use full atom
					return atoms.full;
				} else {
					return null; // Will use molecule-based atom
				}
			}
			case 'BR': {
				// Bottom-right atom: check bottom, right, and bottom-right diagonal
				const diagonalLess = analysis.cornerBottomRightLess;
				const botLess = analysis.botLess;
				const rightLess = analysis.rightLess;

				if (diagonalLess && !botLess && !rightLess) {
					// Only diagonal is lower: use oneCorner with BR corner cut
					return atoms.oneCornerBR;
				} else if (!botLess && !rightLess) {
					// No neighbors lower: use full atom
					return atoms.full;
				} else {
					return null; // Will use molecule-based atom
				}
			}
		}
		return null;
	}

	// Paint base layer with lower neighbor textures to fill gaps
	paintBaseLowerLayer(ctx, analyzedMap, tile, row, col) {
		const atomSize = this.tileSize / 2;
		const analysis = tile.terrainAnalysis;

		// For each atom position, determine which lower neighbor to use as base
		// and which atom from that neighbor aligns with this position
		const positions = [
			{ name: 'TL', x: 0, y: 0, neighbors: [
				{ key: 'top', atomPos: 'BL' },
				{ key: 'left', atomPos: 'TR' },
				{ key: 'topLeft', atomPos: 'BR' }
			]},
			{ name: 'TR', x: atomSize, y: 0, neighbors: [
				{ key: 'top', atomPos: 'BR' },
				{ key: 'right', atomPos: 'TL' },
				{ key: 'topRight', atomPos: 'BL' }
			]},
			{ name: 'BL', x: 0, y: atomSize, neighbors: [
				{ key: 'bot', atomPos: 'TL' },
				{ key: 'left', atomPos: 'BR' },
				{ key: 'botLeft', atomPos: 'TR' }
			]},
			{ name: 'BR', x: atomSize, y: atomSize, neighbors: [
				{ key: 'bot', atomPos: 'TR' },
				{ key: 'right', atomPos: 'BL' },
				{ key: 'botRight', atomPos: 'TL' }
			]}
		];

		const neighborMap = {
			top: { row: row - 1, col: col, less: analysis.topLess },
			left: { row: row, col: col - 1, less: analysis.leftLess },
			right: { row: row, col: col + 1, less: analysis.rightLess },
			bot: { row: row + 1, col: col, less: analysis.botLess },
			topLeft: { row: row - 1, col: col - 1, less: analysis.cornerTopLeftLess },
			topRight: { row: row - 1, col: col + 1, less: analysis.cornerTopRightLess },
			botLeft: { row: row + 1, col: col - 1, less: analysis.cornerBottomLeftLess },
			botRight: { row: row + 1, col: col + 1, less: analysis.cornerBottomRightLess }
		};

		// Paint base layer for each atom position
		for (const pos of positions) {
			let bestNeighbor = null;
			let highestLowerTerrainIndex = null;

			// Find the HIGHEST terrain index that's still LOWER than current (immediate neighbor)
			for (const neighborSpec of pos.neighbors) {
				const neighbor = neighborMap[neighborSpec.key];
				if (neighbor && neighbor.less) {
					const nRow = neighbor.row;
					const nCol = neighbor.col;

					if (nRow >= 0 && nRow < this.numColumns && nCol >= 0 && nCol < this.numColumns) {
						const nIndex = nRow * this.numColumns + nCol;
						const nTile = analyzedMap[nIndex];

						if (nTile && nTile.terrainIndex >= 0 && nTile.terrainIndex < tile.terrainIndex) {
							// Use the neighbor closest to current terrain (highest among lower neighbors)
							if (highestLowerTerrainIndex === null || nTile.terrainIndex > highestLowerTerrainIndex) {
								highestLowerTerrainIndex = nTile.terrainIndex;
								bestNeighbor = { tile: nTile, atomPos: neighborSpec.atomPos };
							}
						}
					}
				}
			}

			// Paint the actual atom from the neighbor's molecule (not just full atom)
			if (bestNeighbor) {
				const nTile = bestNeighbor.tile;

				// Get the neighbor's molecule based on its own terrain analysis
				const molecule = this.getMoleculeByTileAnalysis(nTile.terrainAnalysis);
				const moleculeImageData = this.layerTextures[nTile.terrainIndex][molecule];
				const neighborAtoms = this.extractAtomsFromMolecule(moleculeImageData);

				// Paint the specific atom from the neighbor that aligns with this position
				const atomToPaint = neighborAtoms[bestNeighbor.atomPos];
				if (atomToPaint) {
					ctx.putImageData(atomToPaint, pos.x, pos.y);
				}
			}
		}
	}

	// Convert ImageData to a canvas for proper alpha blending
	imageDataToCanvas(imageData) {
		const canvas = document.createElement('canvas');
		canvas.width = imageData.width;
		canvas.height = imageData.height;
		const ctx = canvas.getContext('2d');
		ctx.putImageData(imageData, 0, 0);
		return canvas;
	}

	// Draw a single tile with proper atom layering for smooth transitions
	drawTileWithLayering(analyzedMap, tile, row, col) {
		const atomSize = this.tileSize / 2;
		const canvas = document.createElement('canvas');
		canvas.width = this.tileSize;
		canvas.height = this.tileSize;
		const ctx = canvas.getContext('2d');

		// Fill with black background
		ctx.fillStyle = 'black';
		ctx.fillRect(0, 0, this.tileSize, this.tileSize);

		// Paint base layer with lower neighbor textures first
		this.paintBaseLowerLayer(ctx, analyzedMap, tile, row, col);

		// Build custom molecule based on diagonal-aware atom selection
		const atoms = {
			TL: this.selectAtomForPosition(tile, 'TL', tile.terrainIndex),
			TR: this.selectAtomForPosition(tile, 'TR', tile.terrainIndex),
			BL: this.selectAtomForPosition(tile, 'BL', tile.terrainIndex),
			BR: this.selectAtomForPosition(tile, 'BR', tile.terrainIndex)
		};

		// If any atom is null, fall back to molecule-based extraction
		const molecule = this.getMoleculeByTileAnalysis(tile.terrainAnalysis);
		const moleculeImageData = this.layerTextures[tile.terrainIndex][molecule];
		const moleculeAtoms = this.extractAtomsFromMolecule(moleculeImageData);

		// Use custom atoms where available, otherwise use molecule atoms
		const currentAtoms = {
			TL: atoms.TL || moleculeAtoms.TL,
			TR: atoms.TR || moleculeAtoms.TR,
			BL: atoms.BL || moleculeAtoms.BL,
			BR: atoms.BR || moleculeAtoms.BR
		};

		// Convert atoms to canvases and use drawImage for proper alpha blending
		const atomCanvases = {
			TL: this.imageDataToCanvas(currentAtoms.TL),
			TR: this.imageDataToCanvas(currentAtoms.TR),
			BL: this.imageDataToCanvas(currentAtoms.BL),
			BR: this.imageDataToCanvas(currentAtoms.BR)
		};

		// Draw each atom using drawImage (respects alpha blending)
		ctx.drawImage(atomCanvases.TL, 0, 0);
		ctx.drawImage(atomCanvases.TR, atomSize, 0);
		ctx.drawImage(atomCanvases.BL, 0, atomSize);
		ctx.drawImage(atomCanvases.BR, atomSize, atomSize);

		// Apply coloring and corner graphics
		let imageData = ctx.getImageData(0, 0, this.tileSize, this.tileSize);
		imageData = this.colorImageData(imageData, tile.terrainAnalysis, tile.terrainIndex);
		imageData = this.addCornerGraphics(imageData, tile.heightAnalysis, tile.terrainIndex);

		return imageData;
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
		let row = y;
		let col = x;

		// Create result object with both analyses
		let result = {
			terrainIndex: 0,
			heightAnalysis: new this.TileAnalysis(),
			terrainAnalysis: new this.TileAnalysis()
		};

		if (row < 0 || row >= this.numColumns || col < 0 || col >= this.numColumns) {
			return result; // Out of bounds
		}

		// Get terrain type for this tile
		result.terrainIndex = this.tileMap[row][col];

		// Helper function to check if a location is within bounds
		function isWithinBounds(r, c, n) {
			return r >= 0 && r < n && c >= 0 && c < n;
		}

		// Analyze heights for cliff detection
		const heightData = this.heightMap || this.tileMap;
		result.heightAnalysis.heightIndex = heightData[row][col];

		var analyzeHeight = ((r, c, n, direction, propertyLess) => {
			if (isWithinBounds(r, c, n)) {
				result.heightAnalysis[direction] = heightData[r][c];
				if (heightData[r][c] < result.heightAnalysis.heightIndex) {
					result.heightAnalysis[propertyLess] = true;
					if(['topLess', 'leftLess', 'rightLess', 'botLess'].indexOf(propertyLess) >= 0) {
						result.heightAnalysis.neighborLowerCount++;
					} else if(['cornerTopLeftLess', 'cornerTopRightLess', 'cornerBottomLeftLess', 'cornerBottomRightLess'].indexOf(propertyLess) >= 0) {
						result.heightAnalysis.cornerLowerCount++;
					}
				}
			}
		});

		analyzeHeight(row - 1, col, this.numColumns, 'topHeight', 'topLess');
		analyzeHeight(row, col - 1, this.numColumns, 'leftHeight', 'leftLess');
		analyzeHeight(row, col + 1, this.numColumns, 'rightHeight', 'rightLess');
		analyzeHeight(row + 1, col, this.numColumns, 'botHeight', 'botLess');
		analyzeHeight(row - 1, col - 1, this.numColumns, 'topLeftHeight', 'cornerTopLeftLess');
		analyzeHeight(row - 1, col + 1, this.numColumns, 'topRightHeight', 'cornerTopRightLess');
		analyzeHeight(row + 1, col - 1, this.numColumns, 'botLeftHeight', 'cornerBottomLeftLess');
		analyzeHeight(row + 1, col + 1, this.numColumns, 'botRightHeight', 'cornerBottomRightLess');

		// Analyze terrain types for texture tiling
		result.terrainAnalysis.heightIndex = this.tileMap[row][col];

		var analyzeTerrain = ((r, c, n, direction, propertyLess) => {
			if (isWithinBounds(r, c, n)) {
				result.terrainAnalysis[direction] = this.tileMap[r][c];
				if (this.tileMap[r][c] < result.terrainAnalysis.heightIndex) {
					result.terrainAnalysis[propertyLess] = true;
					if(['topLess', 'leftLess', 'rightLess', 'botLess'].indexOf(propertyLess) >= 0) {
						result.terrainAnalysis.neighborLowerCount++;
					} else if(['cornerTopLeftLess', 'cornerTopRightLess', 'cornerBottomLeftLess', 'cornerBottomRightLess'].indexOf(propertyLess) >= 0) {
						result.terrainAnalysis.cornerLowerCount++;
					}
				}
			}
		});

		analyzeTerrain(row - 1, col, this.numColumns, 'topHeight', 'topLess');
		analyzeTerrain(row, col - 1, this.numColumns, 'leftHeight', 'leftLess');
		analyzeTerrain(row, col + 1, this.numColumns, 'rightHeight', 'rightLess');
		analyzeTerrain(row + 1, col, this.numColumns, 'botHeight', 'botLess');
		analyzeTerrain(row - 1, col - 1, this.numColumns, 'topLeftHeight', 'cornerTopLeftLess');
		analyzeTerrain(row - 1, col + 1, this.numColumns, 'topRightHeight', 'cornerTopRightLess');
		analyzeTerrain(row + 1, col - 1, this.numColumns, 'botLeftHeight', 'cornerBottomLeftLess');
		analyzeTerrain(row + 1, col + 1, this.numColumns, 'botRightHeight', 'cornerBottomRightLess');

		return result;
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

	colorImageData(imageData, terrainAnalysis, terrainIndex) {

		const data = new Uint8ClampedArray(imageData.data);
		var directions = ['topHeight', 'leftHeight', 'rightHeight', 'botHeight', 'topLeftHeight', 'topRightHeight', 'botLeftHeight', 'botRightHeight'];
		let heightCounts = {};
		directions.forEach((direction) => {
			let height = terrainAnalysis[direction];
			if (height !== terrainAnalysis.heightIndex) {
				if (!heightCounts[height]) {
					heightCounts[height] = 0;
				}
				heightCounts[height]++;
			}
		});

		let lowerNeighborHeight = Math.max(0, terrainAnalysis.heightIndex - 1);
		let maxCount = 0;
		Object.keys(heightCounts).forEach((height) => {
			if (heightCounts[height] > maxCount && height < terrainAnalysis.heightIndex) {
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
		// Use terrainIndex for texture selection
		let baseColors = this.layerTextures[terrainIndex][this.TileMolecule.Full].data;
		let neighborColors = this.layerTextures[terrainIndex][this.TileMolecule.Full].data;

		// Iterate over each pixel
		for (let i = 0; i < numPixels; i++) {
			const dataIndex = i * 4;
			let pColor = { r: data[dataIndex], g: data[dataIndex + 1], b: data[dataIndex + 2], a: data[dataIndex + 3] };
			let bColor = { r: baseColors[dataIndex], g: baseColors[dataIndex + 1], b: baseColors[dataIndex + 2], a: baseColors[dataIndex + 3] };
			let tColor = { r: neighborColors[dataIndex], g: neighborColors[dataIndex + 1], b: neighborColors[dataIndex + 2], a: neighborColors[dataIndex + 3] };

			if (this.layerTextures.length > terrainIndex) {
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

	addCornerGraphics(imageData, heightAnalysis, terrainIndex) {
		let cornerSize = this.tileSize / 2;
		let cornerTexture;

		if (heightAnalysis.cornerLowerCount > 0) {
			if (heightAnalysis.cornerTopLeftLess && (!heightAnalysis.topLess && !heightAnalysis.leftLess)) {
				cornerTexture = this.layerTextures[terrainIndex][this.TileCliffMolecules.CornerTL];
				imageData = this.colorCornerTextureRoutine(imageData, 0, 0, cornerTexture, terrainIndex);
			}
			// Assuming heightAnalysis, textureDict, and other variables are already defined
			if (heightAnalysis.cornerTopRightLess && (!heightAnalysis.topLess && !heightAnalysis.rightLess)) {
				cornerTexture = this.layerTextures[terrainIndex][this.TileCliffMolecules.CornerTR];
				imageData = this.colorCornerTextureRoutine(imageData, cornerSize, 0, cornerTexture, terrainIndex);
			}

			if (heightAnalysis.cornerBottomLeftLess && (!heightAnalysis.botLess && !heightAnalysis.leftLess)) {
				cornerTexture = this.layerTextures[terrainIndex][this.TileCliffMolecules.CornerBL];
				imageData = this.colorCornerTextureRoutine(imageData, 0, cornerSize, cornerTexture, terrainIndex);
			}

			if (heightAnalysis.cornerBottomRightLess && (!heightAnalysis.botLess && !heightAnalysis.rightLess)) {
				cornerTexture = this.layerTextures[terrainIndex][this.TileCliffMolecules.CornerBR];
				imageData = this.colorCornerTextureRoutine(imageData, cornerSize, cornerSize, cornerTexture, terrainIndex);
			}
		}
		return imageData;
	}
	
	colorCornerTextureRoutine(outputImageData, x, y, cornerImageData, terrainIndex) {
		let cornerSize = this.tileSize / 2;
		// Use terrainIndex for texture selection
		let baseColors = this.layerTextures[terrainIndex][this.TileMolecule.Full];
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

		// Clear the canvas with black background
		ctx.fillStyle = 'black';
		ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

		// Draw each tile with atom-level layering for smooth transitions
		analyzedMap.forEach((tile, index) => {
			const col = index % this.numColumns;
			const row = Math.floor(index / this.numColumns);
			const x = col * this.tileSize;
			const y = row * this.tileSize;

			let imageData;

			if (tile.terrainIndex >= 0) {
				// Use the new atom-based layering system for smooth transitions
				imageData = this.drawTileWithLayering(analyzedMap, tile, row, col);
			} else {
				// Create transparent/black tile for invalid terrain
				let numPixels = this.tileSize * this.tileSize;
				const blackData = new Uint8ClampedArray(numPixels * 4);
				blackData.fill(0);
				imageData = new ImageData(blackData, this.tileSize, this.tileSize);
			}

			// Update height map for this tile
			this.updateHeightMapForTile(x, y, tile.heightAnalysis.heightIndex);

			// Draw the tile to the main canvas
			ctx.putImageData(imageData, x, y);
		});

		// Store terrain data for height mapping
		this.terrainData = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height).data;
	}
}
