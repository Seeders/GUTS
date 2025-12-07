class TileMap {

  constructor(config) {
    this.config = config;
  }
	init(canvas, tileSize, layerSpriteSheets, isometric, options = {}) {
		this.isometric = isometric;
		this.canvas = canvas;
		this.tileSize = tileSize;
		this.numColumns = 0;
		this.layerSpriteSheets = layerSpriteSheets;
		this.tileMap = [];
		this.layerTextures = [];
		this.baseAtoms = []; // Store base atoms per terrain type
		this.canvasUtility = new GUTS.CanvasUtility();

		// Options for editor mode: skip cliff supporting textures (for 2D editing without 3D cliff meshes)
		this.skipCliffTextures = options.skipCliffTextures || false;

		// Store terrain type names for dynamic index lookup (e.g., ["water", "lava", "dirt", "grass"])
		this.terrainTypeNames = options.terrainTypeNames || [];

		// Initialize height map canvas
		this.heightMapCanvas = null;
		this.heightMapCtx = null;
		
		this.TileAnalysis = class {
			constructor() {
			  this.heightIndex = 0;
			  this.neighborLowerCount = 0;
			  this.cornerLowerCount = 0;
			  this.neighborHigherCount = 0;
			  this.cornerHigherCount = 0;
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
			  this.topHigher = false;
			  this.leftHigher = false;
			  this.rightHigher = false;
			  this.botHigher = false;
			  this.cornerTopLeftHigher = false;
			  this.cornerTopRightHigher = false;
			  this.cornerBottomLeftHigher = false;
			  this.cornerBottomRightHigher = false;
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

	/**
	 * Set ramps data for cliff texture suppression
	 * @param {Array} ramps - Array of ramp positions {x, z}
	 */
	setRamps(ramps) {
		this.ramps = ramps || [];
	}

	/**
	 * Check if there's a ramp at a specific grid position
	 * @param {number} x - Grid X coordinate
	 * @param {number} y - Grid Y coordinate (Z in 3D)
	 * @returns {boolean} True if ramp exists at this tile
	 */
	hasRampAt(x, y) {
		if (!this.ramps || this.ramps.length === 0) {
			return false;
		}
		return this.ramps.some(r => r.gridX === x && r.gridZ === y);
	}

	/**
	 * Get the ramp data at a specific grid position
	 * @param {number} x - Grid X coordinate
	 * @param {number} y - Grid Y coordinate (Z in 3D)
	 * @returns {Object|null} Ramp object or null if no ramp
	 */
	getRampAt(x, y) {
		if (!this.ramps || this.ramps.length === 0) {
			return null;
		}
		return this.ramps.find(r => r.gridX === x && r.gridZ === y) || null;
	}

	/**
	 * Get terrain type index by name (e.g., "grass", "dirt")
	 * @param {string} name - Terrain type name
	 * @returns {number} Index in layerTextures array, or -1 if not found
	 */
	getTerrainIndexByName(name) {
		if (!this.terrainTypeNames || this.terrainTypeNames.length === 0) {
			return -1;
		}
		return this.terrainTypeNames.indexOf(name);
	}

	/**
	 * Get the grass terrain index (looks up "grass" in terrain type names, falls back to last index)
	 * @returns {number} Grass terrain index
	 */
	getGrassIndex() {
		const idx = this.getTerrainIndexByName('grass');
		return idx >= 0 ? idx : this.layerTextures.length - 1;
	}

	/**
	 * Get the dirt terrain index (looks up "dirt" in terrain type names, falls back to grass-1)
	 * @returns {number} Dirt terrain index
	 */
	getDirtIndex() {
		const idx = this.getTerrainIndexByName('dirt');
		if (idx >= 0) return idx;
		// Fallback: assume dirt is one before grass in the texture list
		const grassIdx = this.getGrassIndex();
		return grassIdx > 0 ? grassIdx - 1 : 0;
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
		const twoCornerRightImageData = this.rotateTexture(twoCornerCtx.getImageData(0, 0, spriteResolution, spriteResolution), Math.PI / 2);
		const twoCornerBottomImageData = twoCornerBotCtx.getImageData(0, 0, spriteResolution, spriteResolution);
		const twoCornerLeftImageData = this.rotateTexture(twoCornerBotCtx.getImageData(0, 0, spriteResolution, spriteResolution), Math.PI / 2);
		
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
			oneCornerBR: oneCornerBotRightImageData,
			twoCornerTop: twoCornerTopImageData,
			twoCornerLeft: twoCornerLeftImageData,
			twoCornerRight: twoCornerRightImageData,
			twoCornerBottom: twoCornerBottomImageData,
			threeCornerTL: threeCornerTopLeftImageData,
			threeCornerTR: threeCornerTopRightImageData,
			threeCornerBL: threeCornerBottomLeftImageData,
			threeCornerBR: threeCornerBottomRightImageData
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
			this.createMolecule(moleculeCtx, twoCornerLeftImageData, fullVariationImageData, twoCornerLeftImageData, fullVariationImageData),
			this.createMolecule(moleculeCtx, fullImageData, twoCornerRightImageData, fullImageData, twoCornerRightImageData),
			this.createMolecule(moleculeCtx, fullVariationImageData, fullVariationImageData, twoCornerBottomImageData, twoCornerBottomImageData),

			//TUNNELS
			this.createMolecule(moleculeCtx, twoCornerTopImageData, twoCornerTopImageData, twoCornerBottomImageData, twoCornerBottomImageData),
			this.createMolecule(moleculeCtx, twoCornerLeftImageData, twoCornerRightImageData, twoCornerLeftImageData, twoCornerRightImageData),

			//TWO SIDES
			this.createMolecule(moleculeCtx, threeCornerTopLeftImageData, twoCornerTopImageData, twoCornerLeftImageData, fullImageData),
			this.createMolecule(moleculeCtx, twoCornerTopImageData, threeCornerTopRightImageData, fullImageData, twoCornerRightImageData),
			this.createMolecule(moleculeCtx, twoCornerLeftImageData, fullVariationImageData, threeCornerBottomLeftImageData, twoCornerBottomImageData),
			this.createMolecule(moleculeCtx, fullVariationImageData, twoCornerRightImageData, twoCornerBottomImageData, threeCornerBottomRightImageData),

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
	selectAtomForPosition(tile, position, terrainIndex, useVariation = false) {
		const analysis = tile.terrainAnalysis;
		const atoms = this.baseAtoms[terrainIndex];

		if (!atoms) return null;

		// Helper to get full or variation atom based on flag
		const getFullAtom = () => useVariation && atoms.fullVariation ? atoms.fullVariation : atoms.full;

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
					// No neighbors lower: use full atom (possibly variation)
					return getFullAtom();
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
					// No neighbors lower: use full atom (possibly variation)
					return getFullAtom();
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
					// No neighbors lower: use full atom (possibly variation)
					return getFullAtom();
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
					// No neighbors lower: use full atom (possibly variation)
					return getFullAtom();
				} else {
					return null; // Will use molecule-based atom
				}
			}
		}
		return null;
	}

	// Select base layer atom based on which neighbors are even lower
	selectBaseLayerAtom(atoms, position, miniAnalysis) {
		if (!atoms) return null;

		switch(position) {
			case 'TL': {
				const diagonal = miniAnalysis.cornerTopLeftLess;
				const top = miniAnalysis.topLess;
				const left = miniAnalysis.leftLess;

				// Check how many neighbors are lower
				if (top && left) {
					return atoms.threeCornerTL; // Both cardinals lower: 3 corners cut
				} else if (top && diagonal) {
					return atoms.twoCornerTop; // Top edge + corner
				} else if (left && diagonal) {
					return atoms.twoCornerLeft; // Left edge + corner
				} else if (top) {
					return atoms.twoCornerTop; // Just top edge (no diagonal)
				} else if (left) {
					return atoms.twoCornerLeft; // Just left edge (no diagonal)
				} else if (diagonal) {
					return atoms.oneCornerTL; // Just corner
				} else {
					return atoms.full; // No neighbors lower
				}
			}
			case 'TR': {
				const diagonal = miniAnalysis.cornerTopRightLess;
				const top = miniAnalysis.topLess;
				const right = miniAnalysis.rightLess;

				if (top && right) {
					return atoms.threeCornerTR;
				} else if (top && diagonal) {
					return atoms.twoCornerTop;
				} else if (right && diagonal) {
					return atoms.twoCornerRight;
				} else if (top) {
					return atoms.twoCornerTop; // Just top edge
				} else if (right) {
					return atoms.twoCornerRight; // Just right edge
				} else if (diagonal) {
					return atoms.oneCornerTR;
				} else {
					return atoms.full;
				}
			}
			case 'BL': {
				const diagonal = miniAnalysis.cornerBottomLeftLess;
				const bot = miniAnalysis.botLess;
				const left = miniAnalysis.leftLess;

				if (bot && left) {
					return atoms.threeCornerBL;
				} else if (bot && diagonal) {
					return atoms.twoCornerBottom;
				} else if (left && diagonal) {
					return atoms.twoCornerLeft;
				} else if (bot) {
					return atoms.twoCornerBottom; // Just bottom edge
				} else if (left) {
					return atoms.twoCornerLeft; // Just left edge
				} else if (diagonal) {
					return atoms.oneCornerBL;
				} else {
					return atoms.full;
				}
			}
			case 'BR': {
				const diagonal = miniAnalysis.cornerBottomRightLess;
				const bot = miniAnalysis.botLess;
				const right = miniAnalysis.rightLess;

				if (bot && right) {
					return atoms.threeCornerBR;
				} else if (bot && diagonal) {
					return atoms.twoCornerBottom;
				} else if (right && diagonal) {
					return atoms.twoCornerRight;
				} else if (bot) {
					return atoms.twoCornerBottom; // Just bottom edge
				} else if (right) {
					return atoms.twoCornerRight; // Just right edge
				} else if (diagonal) {
					return atoms.oneCornerBR;
				} else {
					return atoms.full;
				}
			}
		}
		return atoms.full;
	}

	// Paint base layer with lower neighbor textures to fill gaps
	paintBaseLowerLayer(ctx, analyzedMap, tile, row, col) {
		const atomSize = this.tileSize / 2;

		// For each atom position, check neighboring tile terrains and build appropriate base
		const positions = [
			{
				name: 'TL', x: 0, y: 0,
				// Tiles that affect TL atom
				tileNeighbors: [
					{ dir: 'topLeft', row: row - 1, col: col - 1 },
					{ dir: 'top', row: row - 1, col: col },
					{ dir: 'left', row: row, col: col - 1 }
				]
			},
			{
				name: 'TR', x: atomSize, y: 0,
				// Tiles that affect TR atom
				tileNeighbors: [
					{ dir: 'topRight', row: row - 1, col: col + 1 },
					{ dir: 'top', row: row - 1, col: col },
					{ dir: 'right', row: row, col: col + 1 }
				]
			},
			{
				name: 'BL', x: 0, y: atomSize,
				// Tiles that affect BL atom
				tileNeighbors: [
					{ dir: 'botLeft', row: row + 1, col: col - 1 },
					{ dir: 'bot', row: row + 1, col: col },
					{ dir: 'left', row: row, col: col - 1 }
				]
			},
			{
				name: 'BR', x: atomSize, y: atomSize,
				// Tiles that affect BR atom
				tileNeighbors: [
					{ dir: 'botRight', row: row + 1, col: col + 1 },
					{ dir: 'bot', row: row + 1, col: col },
					{ dir: 'right', row: row, col: col + 1 }
				]
			}
		];

		// Paint base layer for each atom position
		for (const pos of positions) {
			// Get terrain indices of neighboring tiles
			const neighborTerrains = {};
			for (const neighbor of pos.tileNeighbors) {
				const nRow = neighbor.row;
				const nCol = neighbor.col;

				if (nRow >= 0 && nRow < this.numColumns && nCol >= 0 && nCol < this.numColumns) {
					const nIndex = nRow * this.numColumns + nCol;
					const nTile = analyzedMap[nIndex];
					if (nTile && nTile.terrainIndex >= 0) {
						neighborTerrains[neighbor.dir] = nTile.terrainIndex;
					}
				}
			}

			// Find ALL unique terrain indices that are lower than current
			const lowerTerrains = new Set();
			for (const dir in neighborTerrains) {
				const terrain = neighborTerrains[dir];
				if (terrain < tile.terrainIndex) {
					lowerTerrains.add(terrain);
				}
			}

			// Sort terrains from lowest to highest for proper layering
			const sortedTerrains = Array.from(lowerTerrains).sort((a, b) => a - b);

			// Map position-specific neighbors to analysis flags
			const neighborMapping = {
				'TL': {
					topLeft: 'cornerTopLeftLess',
					top: 'topLess',
					left: 'leftLess'
				},
				'TR': {
					topRight: 'cornerTopRightLess',
					top: 'topLess',
					right: 'rightLess'
				},
				'BL': {
					botLeft: 'cornerBottomLeftLess',
					bot: 'botLess',
					left: 'leftLess'
				},
				'BR': {
					botRight: 'cornerBottomRightLess',
					bot: 'botLess',
					right: 'rightLess'
				}
			};

			// Paint each terrain layer from lowest to highest
			for (let i = 0; i < sortedTerrains.length; i++) {
				const currentLayerTerrain = sortedTerrains[i];

				if (!this.baseAtoms[currentLayerTerrain]) continue;

				// Build mini-analysis: check which neighbors are lower than THIS layer
				const miniAnalysis = {
					topLess: false,
					leftLess: false,
					rightLess: false,
					botLess: false,
					cornerTopLeftLess: false,
					cornerTopRightLess: false,
					cornerBottomLeftLess: false,
					cornerBottomRightLess: false
				};

				const mapping = neighborMapping[pos.name];
				for (const dir in neighborTerrains) {
					if (mapping[dir] && neighborTerrains[dir] < currentLayerTerrain) {
						miniAnalysis[mapping[dir]] = true;
					}
				}

				// Select appropriate atom for this layer
				const layerAtom = this.selectBaseLayerAtom(
					this.baseAtoms[currentLayerTerrain],
					pos.name,
					miniAnalysis
				);

				if (layerAtom) {
					if (i === 0) {
						// First layer: use putImageData (on black background)
						ctx.putImageData(layerAtom, pos.x, pos.y);
					} else {
						// Subsequent layers: use drawImage for alpha blending
						const atomCanvas = this.imageDataToCanvas(layerAtom);
						ctx.drawImage(atomCanvas, pos.x, pos.y);
					}
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

		// Determine if this tile should use variation sprites (50% chance for full tiles)
		const useVariation = tile.terrainAnalysis.neighborLowerCount === 0 && Math.random() < 0.5;

		// Build custom molecule based on diagonal-aware atom selection
		const atoms = {
			TL: this.selectAtomForPosition(tile, 'TL', tile.terrainIndex, useVariation),
			TR: this.selectAtomForPosition(tile, 'TR', tile.terrainIndex, useVariation),
			BL: this.selectAtomForPosition(tile, 'BL', tile.terrainIndex, useVariation),
			BR: this.selectAtomForPosition(tile, 'BR', tile.terrainIndex, useVariation)
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

		// Paint cliff-supporting textures if this tile is at the upper edge of a cliff
		this.paintCliffSupportingTexturesForTile(ctx, analyzedMap, tile, row, col);

		// Paint cliff-base textures if this tile is at the lower edge of a cliff
		this.paintCliffBaseTexturesForTile(ctx, analyzedMap, tile, row, col);

		// Paint ramp textures with dirt on ramp tiles and adjacent lower tiles
		this.paintRampTexturesForTile(ctx, analyzedMap, tile, row, col);

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

		var analyzeHeight = ((r, c, n, direction, propertyLess, propertyHigher) => {
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
				if (heightData[r][c] > result.heightAnalysis.heightIndex) {
					result.heightAnalysis[propertyHigher] = true;
					if(['topHigher', 'leftHigher', 'rightHigher', 'botHigher'].indexOf(propertyHigher) >= 0) {
						result.heightAnalysis.neighborHigherCount++;
					} else if(['cornerTopLeftHigher', 'cornerTopRightHigher', 'cornerBottomLeftHigher', 'cornerBottomRightHigher'].indexOf(propertyHigher) >= 0) {
						result.heightAnalysis.cornerHigherCount++;
					}
				}
			}
		});

		analyzeHeight(row - 1, col, this.numColumns, 'topHeight', 'topLess', 'topHigher');
		analyzeHeight(row, col - 1, this.numColumns, 'leftHeight', 'leftLess', 'leftHigher');
		analyzeHeight(row, col + 1, this.numColumns, 'rightHeight', 'rightLess', 'rightHigher');
		analyzeHeight(row + 1, col, this.numColumns, 'botHeight', 'botLess', 'botHigher');
		analyzeHeight(row - 1, col - 1, this.numColumns, 'topLeftHeight', 'cornerTopLeftLess', 'cornerTopLeftHigher');
		analyzeHeight(row - 1, col + 1, this.numColumns, 'topRightHeight', 'cornerTopRightLess', 'cornerTopRightHigher');
		analyzeHeight(row + 1, col - 1, this.numColumns, 'botLeftHeight', 'cornerBottomLeftLess', 'cornerBottomLeftHigher');
		analyzeHeight(row + 1, col + 1, this.numColumns, 'botRightHeight', 'cornerBottomRightLess', 'cornerBottomRightHigher');

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
		var molecule = Math.random() < 0.5 ? this.TileCliffMolecules.Full : this.TileCliffMolecules.FullVariation;								
		switch(tileAnalysis.neighborLowerCount){
			case 0: 
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
	
	/**
	 * Paint cliff-supporting texture atoms on a tile if it's at the upper edge of a cliff
	 * This is called during terrain generation for each tile
	 */
	paintCliffSupportingTexturesForTile(ctx, analyzedMap, tile, row, col) {
		// Skip cliff supporting textures if in editor mode (2D without 3D cliff meshes)
		if (this.skipCliffTextures) {
			return;
		}

		// Skip cliff supporting textures if there's a ramp at this tile
		if (this.hasRampAt(col, row)) {
			return;
		}

		const heightAnalysis = tile.heightAnalysis;
		const atomSize = this.tileSize / 2;

		// Check if neighboring tiles have ramps - don't paint supporting textures toward ramps
		const topNeighborHasRamp = this.hasRampAt(col, row - 1);
		const botNeighborHasRamp = this.hasRampAt(col, row + 1);
		const leftNeighborHasRamp = this.hasRampAt(col - 1, row);
		const rightNeighborHasRamp = this.hasRampAt(col + 1, row);

		// Check diagonal neighbors for ramps too
		const cornerTopLeftHasRamp = this.hasRampAt(col - 1, row - 1);
		const cornerTopRightHasRamp = this.hasRampAt(col + 1, row - 1);
		const cornerBottomLeftHasRamp = this.hasRampAt(col - 1, row + 1);
		const cornerBottomRightHasRamp = this.hasRampAt(col + 1, row + 1);

		// Get grass index dynamically (from terrain type names or fall back to last index)
		const grassIndex = this.getGrassIndex();

		// Get grass atoms
		const grassAtoms = this.baseAtoms[grassIndex];
		if (!grassAtoms || !grassAtoms.full) return;

		// Suppress supporting textures if the lower neighbor has a ramp
		const effectiveTopLess = heightAnalysis.topLess && !topNeighborHasRamp;
		const effectiveBotLess = heightAnalysis.botLess && !botNeighborHasRamp;
		const effectiveLeftLess = heightAnalysis.leftLess && !leftNeighborHasRamp;
		const effectiveRightLess = heightAnalysis.rightLess && !rightNeighborHasRamp;

		// Suppress corner supporting textures if the diagonal neighbor has a ramp
		const effectiveCornerTopLeftLess = heightAnalysis.cornerTopLeftLess && !cornerTopLeftHasRamp;
		const effectiveCornerTopRightLess = heightAnalysis.cornerTopRightLess && !cornerTopRightHasRamp;
		const effectiveCornerBottomLeftLess = heightAnalysis.cornerBottomLeftLess && !cornerBottomLeftHasRamp;
		const effectiveCornerBottomRightLess = heightAnalysis.cornerBottomRightLess && !cornerBottomRightHasRamp;

		// Paint grass on quadrants OPPOSITE to where cliff meshes are placed
		// This creates a transition on the higher terrain level next to the cliff edge
		//
		// IMPORTANT: When two adjacent edges both have lower neighbors (e.g., botLess AND rightLess),
		// the shared corner quadrant needs a corner atom, not overlapping edge atoms.
		// We track which quadrants need corner treatment to avoid double-painting.

		// Determine which quadrants need corner atom treatment instead of overlapping edge atoms
		// When bot+right are lower: both want to paint TL, so TL gets corner atom (oneCornerBR)
		// When bot+left are lower: both want to paint TR, so TR gets corner atom (oneCornerBL)
		// When top+right are lower: both want to paint BL, so BL gets corner atom (oneCornerTR)
		// When top+left are lower: both want to paint BR, so BR gets corner atom (oneCornerTL)
		const tlNeedsCorner = effectiveBotLess && effectiveRightLess;
		const trNeedsCorner = effectiveBotLess && effectiveLeftLess;
		const blNeedsCorner = effectiveTopLess && effectiveRightLess;
		const brNeedsCorner = effectiveTopLess && effectiveLeftLess;

		// Bottom neighbor is lower: cliff meshes in BL, BR quadrants
		// Paint grass on TOP quadrants (TL, TR) facing north (away from cliff)
		if (effectiveBotLess) {
			const rotatedGrass = this.rotateCanvas(this.imageDataToCanvas(grassAtoms.twoCornerTop), 0);
			// Skip TL if it needs corner treatment (will be handled by corner atom)
			if (!tlNeedsCorner) {
				ctx.drawImage(rotatedGrass, 0, 0, atomSize, atomSize); // TL quadrant
			}
			// Skip TR if it needs corner treatment
			if (!trNeedsCorner) {
				ctx.drawImage(rotatedGrass, atomSize, 0, atomSize, atomSize); // TR quadrant
			}
		}

		// Top neighbor is lower: cliff meshes in TL, TR quadrants
		// Paint grass on BOTTOM quadrants (BL, BR) facing south (away from cliff)
		if (effectiveTopLess) {
			const rotatedGrass = this.rotateCanvas(this.imageDataToCanvas(grassAtoms.twoCornerBottom), 0);
			// Skip BL if it needs corner treatment
			if (!blNeedsCorner) {
				ctx.drawImage(rotatedGrass, 0, atomSize-2, atomSize, atomSize); // BL quadrant
			}
			// Skip BR if it needs corner treatment
			if (!brNeedsCorner) {
				ctx.drawImage(rotatedGrass, atomSize, atomSize-2, atomSize, atomSize); // BR quadrant
			}
		}

		// Right neighbor is lower: cliff meshes in TR, BR quadrants
		// Paint grass on LEFT quadrants (TL, BL) facing west (away from cliff)
		if (effectiveRightLess) {
			const rotatedGrass = this.rotateCanvas(this.imageDataToCanvas(grassAtoms.twoCornerLeft), 0);
			// Skip TL if it needs corner treatment
			if (!tlNeedsCorner) {
				ctx.drawImage(rotatedGrass, 2, 0, atomSize, atomSize); // TL quadrant
			}
			// Skip BL if it needs corner treatment
			if (!blNeedsCorner) {
				ctx.drawImage(rotatedGrass, 2, atomSize, atomSize, atomSize); // BL quadrant
			}
		}

		// Left neighbor is lower: cliff meshes in TL, BL quadrants
		// Paint grass on RIGHT quadrants (TR, BR) facing east (away from cliff)
		if (effectiveLeftLess) {
			const rotatedGrass = this.rotateCanvas(this.imageDataToCanvas(grassAtoms.twoCornerRight), 0);
			// Skip TR if it needs corner treatment
			if (!trNeedsCorner) {
				ctx.drawImage(rotatedGrass, atomSize, 0, atomSize, atomSize); // TR quadrant
			}
			// Skip BR if it needs corner treatment
			if (!brNeedsCorner) {
				ctx.drawImage(rotatedGrass, atomSize, atomSize, atomSize, atomSize); // BR quadrant
			}
		}

		// Paint corner atoms where two adjacent edges meet (avoiding overlapping edge atoms)
		if (tlNeedsCorner) {
			const cornerGrass = this.rotateCanvas(this.imageDataToCanvas(grassAtoms.oneCornerBR), 0);
			ctx.drawImage(cornerGrass, 0, 0, atomSize, atomSize); // TL quadrant
		}
		if (trNeedsCorner) {
			const cornerGrass = this.rotateCanvas(this.imageDataToCanvas(grassAtoms.oneCornerBL), 0);
			ctx.drawImage(cornerGrass, atomSize, 0, atomSize, atomSize); // TR quadrant
		}
		if (blNeedsCorner) {
			const cornerGrass = this.rotateCanvas(this.imageDataToCanvas(grassAtoms.oneCornerTR), 0);
			ctx.drawImage(cornerGrass, 0, atomSize, atomSize, atomSize); // BL quadrant
		}
		if (brNeedsCorner) {
			const cornerGrass = this.rotateCanvas(this.imageDataToCanvas(grassAtoms.oneCornerTL), 0);
			ctx.drawImage(cornerGrass, atomSize, atomSize, atomSize, atomSize); // BR quadrant
		}

		// Inner corners (only diagonal neighbor is lower)
		if (!effectiveTopLess && !effectiveLeftLess && effectiveCornerTopLeftLess) {
			const bottomGrass = this.rotateCanvas(this.imageDataToCanvas(grassAtoms.twoCornerBottom), 0);
			ctx.drawImage(bottomGrass, 0, atomSize, atomSize, atomSize); // BL quadrant
			const rightGrass = this.rotateCanvas(this.imageDataToCanvas(grassAtoms.twoCornerRight), 0);
			ctx.drawImage(rightGrass, atomSize, 0, atomSize, atomSize); // TR quadrant
			const cornerGrass = this.rotateCanvas(this.imageDataToCanvas(grassAtoms.threeCornerBR), 0);
			ctx.drawImage(cornerGrass, atomSize, atomSize, atomSize, atomSize); // BR quadrant
		}

		if (!effectiveTopLess && !effectiveRightLess && effectiveCornerTopRightLess) {
			const bottomGrass = this.rotateCanvas(this.imageDataToCanvas(grassAtoms.twoCornerBottom), 0);
			ctx.drawImage(bottomGrass, atomSize, atomSize, atomSize, atomSize); // BR quadrant
			const leftGrass = this.rotateCanvas(this.imageDataToCanvas(grassAtoms.twoCornerLeft), 0);
			ctx.drawImage(leftGrass, 0, 0, atomSize, atomSize); // TL quadrant
			const cornerGrass = this.rotateCanvas(this.imageDataToCanvas(grassAtoms.threeCornerBL), 0);
			ctx.drawImage(cornerGrass, 0, atomSize, atomSize, atomSize); // BL quadrant
		}

		if (!effectiveBotLess && !effectiveLeftLess && effectiveCornerBottomLeftLess) {
			const topGrass = this.rotateCanvas(this.imageDataToCanvas(grassAtoms.twoCornerTop), 0);
			ctx.drawImage(topGrass, 0, 0, atomSize, atomSize); // TL quadrant
			const rightGrass = this.rotateCanvas(this.imageDataToCanvas(grassAtoms.twoCornerRight), 0);
			ctx.drawImage(rightGrass, atomSize, atomSize, atomSize, atomSize); // BR quadrant
			const cornerGrass = this.rotateCanvas(this.imageDataToCanvas(grassAtoms.threeCornerTR), 0);
			ctx.drawImage(cornerGrass, atomSize, 0, atomSize, atomSize); // TR quadrant
		}

		if (!effectiveBotLess && !effectiveRightLess && effectiveCornerBottomRightLess) {
			const topGrass = this.rotateCanvas(this.imageDataToCanvas(grassAtoms.twoCornerTop), 0);
			ctx.drawImage(topGrass, atomSize, 0, atomSize, atomSize); // TR quadrant
			const leftGrass = this.rotateCanvas(this.imageDataToCanvas(grassAtoms.twoCornerLeft), 0);
			ctx.drawImage(leftGrass, 0, atomSize, atomSize, atomSize); // BL quadrant
			const cornerGrass = this.rotateCanvas(this.imageDataToCanvas(grassAtoms.threeCornerTL), 0);
			ctx.drawImage(cornerGrass, 0, 0, atomSize, atomSize); // TL quadrant
		}

		// Outer corners on the opposite side (two adjacent lower neighbors, paint on the remaining corner)
		if (effectiveTopLess && effectiveLeftLess && !effectiveBotLess && !effectiveRightLess && !effectiveCornerBottomRightLess) {
			const cornerGrass = this.rotateCanvas(this.imageDataToCanvas(grassAtoms.oneCornerBR), 0);
			ctx.drawImage(cornerGrass, atomSize, atomSize, atomSize, atomSize); // BR quadrant
		}

		if (effectiveTopLess && effectiveRightLess && !effectiveBotLess && !effectiveLeftLess && !effectiveCornerBottomLeftLess) {
			const cornerGrass = this.rotateCanvas(this.imageDataToCanvas(grassAtoms.oneCornerBL), 0);
			ctx.drawImage(cornerGrass, 0, atomSize, atomSize, atomSize); // BL quadrant
		}

		if (effectiveBotLess && effectiveRightLess && !effectiveTopLess && !effectiveLeftLess && !effectiveCornerTopLeftLess) {
			const cornerGrass = this.rotateCanvas(this.imageDataToCanvas(grassAtoms.oneCornerTL), 0);
			ctx.drawImage(cornerGrass, 0, 0, atomSize, atomSize); // TL quadrant
		}

		if (effectiveBotLess && effectiveLeftLess && !effectiveTopLess && !effectiveRightLess && !effectiveCornerTopRightLess) {
			const cornerGrass = this.rotateCanvas(this.imageDataToCanvas(grassAtoms.oneCornerTR), 0);
			ctx.drawImage(cornerGrass, atomSize, 0, atomSize, atomSize); // TR quadrant
		}
	}

	/**
	 * Paint cliff-base texture atoms on a tile if it's at the lower edge of a cliff
	 * This creates grass growing outward from the base of the cliff
	 *
	 * IMPORTANT: If this tile also has its own cliffs (lower neighbors), we skip painting
	 * base textures in quadrants where supporting textures would be painted to avoid overlap
	 */
	paintCliffBaseTexturesForTile(ctx, analyzedMap, tile, row, col) {
		// Skip cliff base textures if in editor mode (2D without 3D cliff meshes)
		if (this.skipCliffTextures) {
			return;
		}

		// Skip cliff base textures if there's a ramp at this tile
		if (this.hasRampAt(col, row)) {
			return;
		}

		const heightAnalysis = tile.heightAnalysis;
		const atomSize = this.tileSize / 2;

		// Check if neighboring tiles have ramps - don't paint base textures toward ramps
		const topNeighborHasRamp = this.hasRampAt(col, row - 1);
		const botNeighborHasRamp = this.hasRampAt(col, row + 1);
		const leftNeighborHasRamp = this.hasRampAt(col - 1, row);
		const rightNeighborHasRamp = this.hasRampAt(col + 1, row);

		// If any HIGHER neighbor has a ramp, the ramp extends into this tile, so skip all base textures
		// The ramp mesh will cover the area where base textures would be painted
		const higherNeighborHasRamp =
			(heightAnalysis.topHigher && topNeighborHasRamp) ||
			(heightAnalysis.botHigher && botNeighborHasRamp) ||
			(heightAnalysis.leftHigher && leftNeighborHasRamp) ||
			(heightAnalysis.rightHigher && rightNeighborHasRamp);

		if (higherNeighborHasRamp) {
			return;
		}

		// Get grass index dynamically (from terrain type names or fall back to last index)
		const grassIndex = this.getGrassIndex();

		// Get grass atoms
		const grassAtoms = this.baseAtoms[grassIndex];
		if (!grassAtoms || !grassAtoms.full) return;

		// Suppress base textures if the higher neighbor has a ramp (redundant now but kept for clarity)
		const effectiveTopHigher = heightAnalysis.topHigher && !topNeighborHasRamp;
		const effectiveBotHigher = heightAnalysis.botHigher && !botNeighborHasRamp;
		const effectiveLeftHigher = heightAnalysis.leftHigher && !leftNeighborHasRamp;
		const effectiveRightHigher = heightAnalysis.rightHigher && !rightNeighborHasRamp;

		// Track which quadrants are "claimed" by supporting textures (from this tile's own cliffs)
		// If this tile has lower neighbors, those quadrants get supporting textures, not base textures
		const tlClaimedBySupporting = heightAnalysis.topLess || heightAnalysis.leftLess || heightAnalysis.cornerTopLeftLess;
		const trClaimedBySupporting = heightAnalysis.topLess || heightAnalysis.rightLess || heightAnalysis.cornerTopRightLess;
		const blClaimedBySupporting = heightAnalysis.botLess || heightAnalysis.leftLess || heightAnalysis.cornerBottomLeftLess;
		const brClaimedBySupporting = heightAnalysis.botLess || heightAnalysis.rightLess || heightAnalysis.cornerBottomRightLess;

		// Determine which quadrants need corner atom treatment instead of overlapping edge atoms
		// When top+left are higher: both want to paint TL, so TL gets corner atom (oneCornerBR)
		// When top+right are higher: both want to paint TR, so TR gets corner atom (oneCornerBL)
		// When bot+left are higher: both want to paint BL, so BL gets corner atom (oneCornerTR)
		// When bot+right are higher: both want to paint BR, so BR gets corner atom (oneCornerTL)
		const tlNeedsCorner = effectiveTopHigher && effectiveLeftHigher;
		const trNeedsCorner = effectiveTopHigher && effectiveRightHigher;
		const blNeedsCorner = effectiveBotHigher && effectiveLeftHigher;
		const brNeedsCorner = effectiveBotHigher && effectiveRightHigher;

		// Paint grass on quadrants ADJACENT to where cliff meshes would be on the higher neighbor
		// This creates a transition on the lower terrain level at the base of the cliff
		// BUT skip quadrants that are already claimed by supporting textures OR need corner treatment

		// Top neighbor is higher: cliff base would be at top of this tile
		// Paint grass on TOP quadrants (TL, TR) facing the cliff
		if (effectiveTopHigher) {
			const rotatedGrass = this.rotateCanvas(this.imageDataToCanvas(grassAtoms.twoCornerBottom), 0);
			if (!tlClaimedBySupporting && !tlNeedsCorner) {
				ctx.drawImage(rotatedGrass, 0, 0, atomSize, atomSize); // TL quadrant
			}
			if (!trClaimedBySupporting && !trNeedsCorner) {
				ctx.drawImage(rotatedGrass, atomSize, 0, atomSize, atomSize); // TR quadrant
			}
		}

		// Bottom neighbor is higher: cliff base would be at bottom of this tile
		// Paint grass on BOTTOM quadrants (BL, BR) facing the cliff
		if (effectiveBotHigher) {
			const rotatedGrass = this.rotateCanvas(this.imageDataToCanvas(grassAtoms.twoCornerTop), 0);
			if (!blClaimedBySupporting && !blNeedsCorner) {
				ctx.drawImage(rotatedGrass, 0, atomSize, atomSize, atomSize); // BL quadrant
			}
			if (!brClaimedBySupporting && !brNeedsCorner) {
				ctx.drawImage(rotatedGrass, atomSize, atomSize, atomSize, atomSize); // BR quadrant
			}
		}

		// Left neighbor is higher: cliff base would be at left of this tile
		// Paint grass on LEFT quadrants (TL, BL) facing the cliff
		if (effectiveLeftHigher) {
			const rotatedGrass = this.rotateCanvas(this.imageDataToCanvas(grassAtoms.twoCornerRight), 0);
			if (!tlClaimedBySupporting && !tlNeedsCorner) {
				ctx.drawImage(rotatedGrass, 0, 0, atomSize, atomSize); // TL quadrant
			}
			if (!blClaimedBySupporting && !blNeedsCorner) {
				ctx.drawImage(rotatedGrass, 0, atomSize, atomSize, atomSize); // BL quadrant
			}
		}

		// Right neighbor is higher: cliff base would be at right of this tile
		// Paint grass on RIGHT quadrants (TR, BR) facing the cliff
		if (effectiveRightHigher) {
			const rotatedGrass = this.rotateCanvas(this.imageDataToCanvas(grassAtoms.twoCornerLeft), 0);
			if (!trClaimedBySupporting && !trNeedsCorner) {
				ctx.drawImage(rotatedGrass, atomSize, 0, atomSize, atomSize); // TR quadrant
			}
			if (!brClaimedBySupporting && !brNeedsCorner) {
				ctx.drawImage(rotatedGrass, atomSize, atomSize, atomSize, atomSize); // BR quadrant
			}
		}

		// Paint corner atoms where two adjacent higher neighbors meet (avoiding overlapping edge atoms)
		if (tlNeedsCorner && !tlClaimedBySupporting) {
			const cornerGrass = this.rotateCanvas(this.imageDataToCanvas(grassAtoms.oneCornerBR), 0);
			ctx.drawImage(cornerGrass, 0, 0, atomSize, atomSize); // TL quadrant
		}
		if (trNeedsCorner && !trClaimedBySupporting) {
			const cornerGrass = this.rotateCanvas(this.imageDataToCanvas(grassAtoms.oneCornerBL), 0);
			ctx.drawImage(cornerGrass, atomSize, 0, atomSize, atomSize); // TR quadrant
		}
		if (blNeedsCorner && !blClaimedBySupporting) {
			const cornerGrass = this.rotateCanvas(this.imageDataToCanvas(grassAtoms.oneCornerTR), 0);
			ctx.drawImage(cornerGrass, 0, atomSize, atomSize, atomSize); // BL quadrant
		}
		if (brNeedsCorner && !brClaimedBySupporting) {
			const cornerGrass = this.rotateCanvas(this.imageDataToCanvas(grassAtoms.oneCornerTL), 0);
			ctx.drawImage(cornerGrass, atomSize, atomSize, atomSize, atomSize); // BR quadrant
		}

		// Handle inner corners (diagonal neighbor is higher, but cardinal neighbors are not)
		if (!effectiveTopHigher && !effectiveLeftHigher && heightAnalysis.cornerTopLeftHigher && !tlClaimedBySupporting) {
			const cornerGrass = this.rotateCanvas(this.imageDataToCanvas(grassAtoms.threeCornerBR), 0);
			ctx.drawImage(cornerGrass, 0, 0, atomSize, atomSize); // TL quadrant
		}

		if (!effectiveTopHigher && !effectiveRightHigher && heightAnalysis.cornerTopRightHigher && !trClaimedBySupporting) {
			const cornerGrass = this.rotateCanvas(this.imageDataToCanvas(grassAtoms.threeCornerBL), 0);
			ctx.drawImage(cornerGrass, atomSize, 0, atomSize, atomSize); // TR quadrant
		}

		if (!effectiveBotHigher && !effectiveLeftHigher && heightAnalysis.cornerBottomLeftHigher && !blClaimedBySupporting) {
			const cornerGrass = this.rotateCanvas(this.imageDataToCanvas(grassAtoms.threeCornerTR), 0);
			ctx.drawImage(cornerGrass, 0, atomSize, atomSize, atomSize); // BL quadrant
		}

		if (!effectiveBotHigher && !effectiveRightHigher && heightAnalysis.cornerBottomRightHigher && !brClaimedBySupporting) {
			const cornerGrass = this.rotateCanvas(this.imageDataToCanvas(grassAtoms.threeCornerTL), 0);
			ctx.drawImage(cornerGrass, atomSize, atomSize, atomSize, atomSize); // BR quadrant
		}

		// Handle outer corners (both adjacent cardinal neighbors are higher)
		// These only paint if the tile has no lower neighbors in those directions
		if (effectiveTopHigher && effectiveLeftHigher && !effectiveBotHigher && !effectiveRightHigher && !tlClaimedBySupporting) {
			const cornerGrass = this.rotateCanvas(this.imageDataToCanvas(grassAtoms.oneCornerBR), 0);
			ctx.drawImage(cornerGrass, 0, 0, atomSize, atomSize); // TL quadrant
		}

		if (effectiveTopHigher && effectiveRightHigher && !effectiveBotHigher && !effectiveLeftHigher && !trClaimedBySupporting) {
			const cornerGrass = this.rotateCanvas(this.imageDataToCanvas(grassAtoms.oneCornerBL), 0);
			ctx.drawImage(cornerGrass, atomSize, 0, atomSize, atomSize); // TR quadrant
		}

		if (effectiveBotHigher && effectiveLeftHigher && !effectiveTopHigher && !effectiveRightHigher && !blClaimedBySupporting) {
			const cornerGrass = this.rotateCanvas(this.imageDataToCanvas(grassAtoms.oneCornerTR), 0);
			ctx.drawImage(cornerGrass, 0, atomSize, atomSize, atomSize); // BL quadrant
		}

		if (effectiveBotHigher && effectiveRightHigher && !effectiveTopHigher && !effectiveLeftHigher && !brClaimedBySupporting) {
			const cornerGrass = this.rotateCanvas(this.imageDataToCanvas(grassAtoms.oneCornerTL), 0);
			ctx.drawImage(cornerGrass, atomSize, atomSize, atomSize, atomSize); // BR quadrant
		}
	}

	/**
	 * Paint ramp textures using dirt atoms on ramp tiles and adjacent lower tiles
	 * Ramps connect two height levels, so both the ramp tile and lower neighbor get dirt textures
	 */
	paintRampTexturesForTile(ctx, analyzedMap, tile, row, col) {
		// Skip if cliff textures are disabled
		if (this.skipCliffTextures) {
			return;
		}

		const atomSize = this.tileSize / 2;

		// Get dirt atoms for ramp textures
		const dirtIndex = this.getDirtIndex();
		const dirtAtoms = this.baseAtoms[dirtIndex];
		if (!dirtAtoms || !dirtAtoms.full) return;

		// Check if THIS tile has a ramp
		const hasRamp = this.hasRampAt(col, row);

		// Helper to check if a tile is a "lower ramp tile" (has a higher neighbor with a ramp pointing to it)
		const isLowerRampTileCheck = (checkCol, checkRow) => {
			if (!this.heightMap || checkRow < 0 || checkRow >= this.heightMap.length) return false;
			if (!this.heightMap[checkRow] || checkCol < 0 || checkCol >= this.heightMap[checkRow].length) return false;

			const tileHeight = this.heightMap[checkRow][checkCol];

			// Check each cardinal neighbor - if it's higher AND has a ramp, this tile is a lower ramp tile
			if (checkRow > 0 && this.heightMap[checkRow - 1] &&
				this.heightMap[checkRow - 1][checkCol] > tileHeight &&
				this.hasRampAt(checkCol, checkRow - 1)) {
				return true;
			}
			if (checkRow < this.heightMap.length - 1 && this.heightMap[checkRow + 1] &&
				this.heightMap[checkRow + 1][checkCol] > tileHeight &&
				this.hasRampAt(checkCol, checkRow + 1)) {
				return true;
			}
			if (checkCol > 0 && this.heightMap[checkRow][checkCol - 1] > tileHeight &&
				this.hasRampAt(checkCol - 1, checkRow)) {
				return true;
			}
			if (checkCol < this.heightMap[checkRow].length - 1 &&
				this.heightMap[checkRow][checkCol + 1] > tileHeight &&
				this.hasRampAt(checkCol + 1, checkRow)) {
				return true;
			}
			return false;
		};

		// Check if THIS tile is the lower ramp tile
		const thisIsLowerRampTile = isLowerRampTileCheck(col, row);

		// Paint full dirt base for both ramp tiles (top ramp tile has the ramp, lower ramp tile is where it extends)
		if (hasRamp || thisIsLowerRampTile) {
			const fullDirt = this.imageDataToCanvas(dirtAtoms.full);
			ctx.drawImage(fullDirt, 0, 0, atomSize, atomSize); // TL
			ctx.drawImage(fullDirt, atomSize, 0, atomSize, atomSize); // TR
			ctx.drawImage(fullDirt, 0, atomSize, atomSize, atomSize); // BL
			ctx.drawImage(fullDirt, atomSize, atomSize, atomSize, atomSize); // BR
		}

		// Helper to check if a tile is a "lower ramp tile" (reuse the check function)
		const isLowerRampTile = isLowerRampTileCheck;

		// Helper to check if a tile is a "top ramp tile" (has the ramp AND has a lower neighbor)
		const isTopRampTile = (checkCol, checkRow) => {
			if (!this.hasRampAt(checkCol, checkRow)) return false;
			if (!this.heightMap || checkRow < 0 || checkRow >= this.heightMap.length) return false;
			if (!this.heightMap[checkRow] || checkCol < 0 || checkCol >= this.heightMap[checkRow].length) return false;

			const tileHeight = this.heightMap[checkRow][checkCol];

			// Check each cardinal neighbor - if it's lower, this is the top ramp tile
			if (checkRow > 0 && this.heightMap[checkRow - 1] &&
				this.heightMap[checkRow - 1][checkCol] < tileHeight) {
				return true;
			}
			if (checkRow < this.heightMap.length - 1 && this.heightMap[checkRow + 1] &&
				this.heightMap[checkRow + 1][checkCol] < tileHeight) {
				return true;
			}
			if (checkCol > 0 && this.heightMap[checkRow][checkCol - 1] < tileHeight) {
				return true;
			}
			if (checkCol < this.heightMap[checkRow].length - 1 &&
				this.heightMap[checkRow][checkCol + 1] < tileHeight) {
				return true;
			}
			return false;
		};

		// Helper to get the direction a top ramp tile faces (toward lower neighbor)
		// Returns 'top', 'bot', 'left', 'right' or null
		const getTopRampDirection = (checkCol, checkRow) => {
			if (!this.hasRampAt(checkCol, checkRow)) return null;
			if (!this.heightMap || checkRow < 0 || checkRow >= this.heightMap.length) return null;
			if (!this.heightMap[checkRow] || checkCol < 0 || checkCol >= this.heightMap[checkRow].length) return null;

			const tileHeight = this.heightMap[checkRow][checkCol];

			if (checkRow > 0 && this.heightMap[checkRow - 1] &&
				this.heightMap[checkRow - 1][checkCol] < tileHeight) {
				return 'top';
			}
			if (checkRow < this.heightMap.length - 1 && this.heightMap[checkRow + 1] &&
				this.heightMap[checkRow + 1][checkCol] < tileHeight) {
				return 'bot';
			}
			if (checkCol > 0 && this.heightMap[checkRow][checkCol - 1] < tileHeight) {
				return 'left';
			}
			if (checkCol < this.heightMap[checkRow].length - 1 &&
				this.heightMap[checkRow][checkCol + 1] < tileHeight) {
				return 'right';
			}
			return null;
		};

		// Helper to check if tile is any kind of ramp tile (top or lower)
		const isRampTile = (checkCol, checkRow) => {
			return isTopRampTile(checkCol, checkRow) || isLowerRampTile(checkCol, checkRow);
		};

		// Get this tile's height for comparison
		const thisHeight = this.heightMap && this.heightMap[row] ? this.heightMap[row][col] : 0;

		// Helper to get neighbor height
		const getNeighborHeight = (c, r) => {
			if (!this.heightMap || r < 0 || r >= this.heightMap.length) return 0;
			if (!this.heightMap[r] || c < 0 || c >= this.heightMap[r].length) return 0;
			return this.heightMap[r][c];
		};

		// Check if this tile is a ramp tile (either top or lower) - skip support texture painting
		const thisIsRampTile = hasRamp || isLowerRampTile(col, row);

		// Check each of our neighbors - if they're a ramp tile (top or lower), paint dirt toward them
		// But skip if THIS tile is also a ramp tile
		// Also check height constraints
		const topNeighborHeight = getNeighborHeight(col, row - 1);
		const botNeighborHeight = getNeighborHeight(col, row + 1);
		const leftNeighborHeight = getNeighborHeight(col - 1, row);
		const rightNeighborHeight = getNeighborHeight(col + 1, row);

		// For top ramp tiles, neighbors should be at same height or higher
		// For lower ramp tiles, neighbors should be at same height or lower
		const topIsTopRampTile = !thisIsRampTile && isTopRampTile(col, row - 1) && thisHeight >= topNeighborHeight;
		const botIsTopRampTile = !thisIsRampTile && isTopRampTile(col, row + 1) && thisHeight >= botNeighborHeight;
		const leftIsTopRampTile = !thisIsRampTile && isTopRampTile(col - 1, row) && thisHeight >= leftNeighborHeight;
		const rightIsTopRampTile = !thisIsRampTile && isTopRampTile(col + 1, row) && thisHeight >= rightNeighborHeight;

		const topIsLowerRampTile = !thisIsRampTile && isLowerRampTile(col, row - 1) && thisHeight <= topNeighborHeight;
		const botIsLowerRampTile = !thisIsRampTile && isLowerRampTile(col, row + 1) && thisHeight <= botNeighborHeight;
		const leftIsLowerRampTile = !thisIsRampTile && isLowerRampTile(col - 1, row) && thisHeight <= leftNeighborHeight;
		const rightIsLowerRampTile = !thisIsRampTile && isLowerRampTile(col + 1, row) && thisHeight <= rightNeighborHeight;

		// Combine: neighbor is any kind of ramp tile
		const topIsRampTile = topIsTopRampTile || topIsLowerRampTile;
		const botIsRampTile = botIsTopRampTile || botIsLowerRampTile;
		const leftIsRampTile = leftIsTopRampTile || leftIsLowerRampTile;
		const rightIsRampTile = rightIsTopRampTile || rightIsLowerRampTile;

		// Check diagonal neighbors for ramp tiles (also with height check)
		const cornerTLHeight = getNeighborHeight(col - 1, row - 1);
		const cornerTRHeight = getNeighborHeight(col + 1, row - 1);
		const cornerBLHeight = getNeighborHeight(col - 1, row + 1);
		const cornerBRHeight = getNeighborHeight(col + 1, row + 1);

		const cornerTLIsRampTile = !thisIsRampTile && isRampTile(col - 1, row - 1) &&
			(isLowerRampTile(col - 1, row - 1) ? thisHeight <= cornerTLHeight : thisHeight >= cornerTLHeight);
		const cornerTRIsRampTile = !thisIsRampTile && isRampTile(col + 1, row - 1) &&
			(isLowerRampTile(col + 1, row - 1) ? thisHeight <= cornerTRHeight : thisHeight >= cornerTRHeight);
		const cornerBLIsRampTile = !thisIsRampTile && isRampTile(col - 1, row + 1) &&
			(isLowerRampTile(col - 1, row + 1) ? thisHeight <= cornerBLHeight : thisHeight >= cornerBLHeight);
		const cornerBRIsRampTile = !thisIsRampTile && isRampTile(col + 1, row + 1) &&
			(isLowerRampTile(col + 1, row + 1) ? thisHeight <= cornerBRHeight : thisHeight >= cornerBRHeight);

		// Determine which quadrants need corner treatment (when two adjacent cardinal ramp tiles meet)
		const tlNeedsCorner = topIsRampTile && leftIsRampTile;
		const trNeedsCorner = topIsRampTile && rightIsRampTile;
		const blNeedsCorner = botIsRampTile && leftIsRampTile;
		const brNeedsCorner = botIsRampTile && rightIsRampTile;

		// Check if we're a SIDE neighbor of a top ramp tile (we're perpendicular to ramp direction)
		// If so, we need a corner texture instead of an edge texture
		// Get directions for each cardinal neighbor that is a top ramp
		const topRampDir = topIsTopRampTile ? getTopRampDirection(col, row - 1) : null;
		const botRampDir = botIsTopRampTile ? getTopRampDirection(col, row + 1) : null;
		const leftRampDir = leftIsTopRampTile ? getTopRampDirection(col - 1, row) : null;
		const rightRampDir = rightIsTopRampTile ? getTopRampDirection(col + 1, row) : null;

		// We're a side neighbor if the ramp direction is perpendicular to us
		// Top neighbor: we're its side neighbor if ramp goes left or right
		// Left neighbor: we're its side neighbor if ramp goes top or bot
		const topIsSideOfRamp = topRampDir === 'left' || topRampDir === 'right';
		const botIsSideOfRamp = botRampDir === 'left' || botRampDir === 'right';
		const leftIsSideOfRamp = leftRampDir === 'top' || leftRampDir === 'bot';
		const rightIsSideOfRamp = rightRampDir === 'top' || rightRampDir === 'bot';

		// Paint dirt on edges TOWARD ramp tiles (for smooth transition)
		// Keep original texture orientations, just move to the quadrant touching the ramp tile
		// BUT: skip edge painting if we're a side neighbor of a top ramp (will paint corner instead)
		if (topIsRampTile && !topIsSideOfRamp) {
			// Top neighbor is ramp tile, paint dirt on TOP edge (toward it)
			const rotatedDirt = this.rotateCanvas(this.imageDataToCanvas(dirtAtoms.twoCornerBottom), 0);
			if (!tlNeedsCorner) {
				ctx.drawImage(rotatedDirt, 0, 0, atomSize, atomSize); // TL quadrant
			}
			if (!trNeedsCorner) {
				ctx.drawImage(rotatedDirt, atomSize, 0, atomSize, atomSize); // TR quadrant
			}
		}

		if (botIsRampTile && !botIsSideOfRamp) {
			// Bottom neighbor is ramp tile, paint dirt on BOTTOM edge (toward it)
			const rotatedDirt = this.rotateCanvas(this.imageDataToCanvas(dirtAtoms.twoCornerTop), 0);
			if (!blNeedsCorner) {
				ctx.drawImage(rotatedDirt, 0, atomSize, atomSize, atomSize); // BL quadrant
			}
			if (!brNeedsCorner) {
				ctx.drawImage(rotatedDirt, atomSize, atomSize, atomSize, atomSize); // BR quadrant
			}
		}

		if (leftIsRampTile && !leftIsSideOfRamp) {
			// Left neighbor is ramp tile, paint dirt on LEFT edge (toward it)
			const rotatedDirt = this.rotateCanvas(this.imageDataToCanvas(dirtAtoms.twoCornerRight), 0);
			if (!tlNeedsCorner) {
				ctx.drawImage(rotatedDirt, 0, 0, atomSize, atomSize); // TL quadrant
			}
			if (!blNeedsCorner) {
				ctx.drawImage(rotatedDirt, 0, atomSize, atomSize, atomSize); // BL quadrant
			}
		}

		if (rightIsRampTile && !rightIsSideOfRamp) {
			// Right neighbor is ramp tile, paint dirt on RIGHT edge (toward it)
			const rotatedDirt = this.rotateCanvas(this.imageDataToCanvas(dirtAtoms.twoCornerLeft), 0);
			if (!trNeedsCorner) {
				ctx.drawImage(rotatedDirt, atomSize, 0, atomSize, atomSize); // TR quadrant
			}
			if (!brNeedsCorner) {
				ctx.drawImage(rotatedDirt, atomSize, atomSize, atomSize, atomSize); // BR quadrant
			}
		}

		// Paint corner atoms for side neighbors of top ramp tiles
		// These use oneCorner atoms (mostly dirt with one corner cut) pointing toward the ramp
		// Check each cardinal direction - if there's a top ramp tile there, paint corner based on ramp direction
		// Left neighbor check (this tile is to the RIGHT of a ramp)
		if (this.hasRampAt(col - 1, row) && !thisIsRampTile) {
			const dir = getTopRampDirection(col - 1, row);
			if (dir === 'top') {
				// Ramp is going up (top), we're on its right side - paint TL with corner cut at TL
				const cornerDirt = this.imageDataToCanvas(dirtAtoms.oneCornerTL);
				ctx.drawImage(cornerDirt, 0, 0, atomSize, atomSize); // TL quadrant
			} else if (dir === 'bot') {
				// Ramp is going down (bot), we're on its right side - paint BL with corner cut at BL
				const cornerDirt = this.imageDataToCanvas(dirtAtoms.oneCornerBL);
				ctx.drawImage(cornerDirt, 0, atomSize, atomSize, atomSize); // BL quadrant
			}
		}

		// Right neighbor check (this tile is to the LEFT of a ramp)
		if (this.hasRampAt(col + 1, row) && !thisIsRampTile) {
			const dir = getTopRampDirection(col + 1, row);
			if (dir === 'top') {
				// Ramp is going up (top), we're on its left side - paint TR with corner cut at TR
				const cornerDirt = this.imageDataToCanvas(dirtAtoms.oneCornerTR);
				ctx.drawImage(cornerDirt, atomSize, 0, atomSize, atomSize); // TR quadrant
			} else if (dir === 'bot') {
				// Ramp is going down (bot), we're on its left side - paint BR with corner cut at BR
				const cornerDirt = this.imageDataToCanvas(dirtAtoms.oneCornerBR);
				ctx.drawImage(cornerDirt, atomSize, atomSize, atomSize, atomSize); // BR quadrant
			}
		}

		// Top neighbor check (this tile is BELOW a ramp)
		if (this.hasRampAt(col, row - 1) && !thisIsRampTile) {
			const dir = getTopRampDirection(col, row - 1);
			if (dir === 'left') {
				// Ramp is going left, we're below it - paint TL with corner cut at TL
				const cornerDirt = this.imageDataToCanvas(dirtAtoms.oneCornerTL);
				ctx.drawImage(cornerDirt, 0, 0, atomSize, atomSize); // TL quadrant
			} else if (dir === 'right') {
				// Ramp is going right, we're below it - paint TR with corner cut at TR
				const cornerDirt = this.imageDataToCanvas(dirtAtoms.oneCornerTR);
				ctx.drawImage(cornerDirt, atomSize, 0, atomSize, atomSize); // TR quadrant
			}
		}

		// Bottom neighbor check (this tile is ABOVE a ramp)
		if (this.hasRampAt(col, row + 1) && !thisIsRampTile) {
			const dir = getTopRampDirection(col, row + 1);
			if (dir === 'left') {
				// Ramp is going left, we're above it - paint BL with corner cut at BL
				const cornerDirt = this.imageDataToCanvas(dirtAtoms.oneCornerBL);
				ctx.drawImage(cornerDirt, 0, atomSize, atomSize, atomSize); // BL quadrant
			} else if (dir === 'right') {
				// Ramp is going right, we're above it - paint BR with corner cut at BR
				const cornerDirt = this.imageDataToCanvas(dirtAtoms.oneCornerBR);
				ctx.drawImage(cornerDirt, atomSize, atomSize, atomSize, atomSize); // BR quadrant
			}
		}

		// Paint corner atoms where two adjacent cardinal ramp tiles meet
		if (tlNeedsCorner) {
			const cornerDirt = this.rotateCanvas(this.imageDataToCanvas(dirtAtoms.oneCornerTL), 0);
			ctx.drawImage(cornerDirt, 0, 0, atomSize, atomSize); // TL quadrant
		}
		if (trNeedsCorner) {
			const cornerDirt = this.rotateCanvas(this.imageDataToCanvas(dirtAtoms.oneCornerTR), 0);
			ctx.drawImage(cornerDirt, atomSize, 0, atomSize, atomSize); // TR quadrant
		}
		if (blNeedsCorner) {
			const cornerDirt = this.rotateCanvas(this.imageDataToCanvas(dirtAtoms.oneCornerBL), 0);
			ctx.drawImage(cornerDirt, 0, atomSize, atomSize, atomSize); // BL quadrant
		}
		if (brNeedsCorner) {
			const cornerDirt = this.rotateCanvas(this.imageDataToCanvas(dirtAtoms.oneCornerBR), 0);
			ctx.drawImage(cornerDirt, atomSize, atomSize, atomSize, atomSize); // BR quadrant
		}

		// Paint inner corner atoms when only the diagonal neighbor is a ramp tile
		// (similar to cliff inner corners - atom_three style)
		// Keep original texture orientations, just move to the quadrant touching the diagonal ramp tile
		if (cornerTLIsRampTile && !topIsRampTile && !leftIsRampTile) {
			// Diagonal TL is ramp tile, paint inner corner on TL quadrant (toward it)
			const cornerDirt = this.rotateCanvas(this.imageDataToCanvas(dirtAtoms.threeCornerBR), 0);
			ctx.drawImage(cornerDirt, 0, 0, atomSize, atomSize); // TL quadrant
		}
		if (cornerTRIsRampTile && !topIsRampTile && !rightIsRampTile) {
			// Diagonal TR is ramp tile, paint inner corner on TR quadrant (toward it)
			const cornerDirt = this.rotateCanvas(this.imageDataToCanvas(dirtAtoms.threeCornerBL), 0);
			ctx.drawImage(cornerDirt, atomSize, 0, atomSize, atomSize); // TR quadrant
		}
		if (cornerBLIsRampTile && !botIsRampTile && !leftIsRampTile) {
			// Diagonal BL is ramp tile, paint inner corner on BL quadrant (toward it)
			const cornerDirt = this.rotateCanvas(this.imageDataToCanvas(dirtAtoms.threeCornerTR), 0);
			ctx.drawImage(cornerDirt, 0, atomSize, atomSize, atomSize); // BL quadrant
		}
		if (cornerBRIsRampTile && !botIsRampTile && !rightIsRampTile) {
			// Diagonal BR is ramp tile, paint inner corner on BR quadrant (toward it)
			const cornerDirt = this.rotateCanvas(this.imageDataToCanvas(dirtAtoms.threeCornerTL), 0);
			ctx.drawImage(cornerDirt, atomSize, atomSize, atomSize, atomSize); // BR quadrant
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

		// Second pass: paint top ramp support textures
		this.paintTopRampSupportTextures(ctx);
	}

	/**
	 * Paint support textures around top ramp tiles (second pass after main drawing)
	 */
	paintTopRampSupportTextures(ctx) {
		if (!this.ramps || this.ramps.length === 0) return;
		if (!this.heightMap) return;

		const atomSize = this.tileSize / 2;
		const dirtIndex = this.getDirtIndex();
		const dirtAtoms = this.baseAtoms[dirtIndex];
		if (!dirtAtoms) return;

		// Process each ramp
		this.ramps.forEach(ramp => {
			const col = ramp.gridX;
			const row = ramp.gridZ;

			// Find ramp direction (toward lower neighbor)
			const thisHeight = this.heightMap[row] ? this.heightMap[row][col] : 0;
			let rampDir = null;

			if (row > 0 && this.heightMap[row - 1] && this.heightMap[row - 1][col] < thisHeight) {
				rampDir = 'top';
			} else if (row < this.heightMap.length - 1 && this.heightMap[row + 1] && this.heightMap[row + 1][col] < thisHeight) {
				rampDir = 'bot';
			} else if (col > 0 && this.heightMap[row][col - 1] < thisHeight) {
				rampDir = 'left';
			} else if (this.heightMap[row] && col < this.heightMap[row].length - 1 && this.heightMap[row][col + 1] < thisHeight) {
				rampDir = 'right';
			}

			if (!rampDir) return;

			// Paint support textures based on ramp direction
			// Sequence: back neighbor edges, side neighbor corners (oneCorner), diagonal corners (threeCorner)
			if (rampDir === 'bot') {
				// Ramp goes DOWN - back is row-1, sides are col-1 and col+1
				// Back neighbor: edge on bottom quadrants
				this.paintAtomAt(ctx, col, row - 1, 'BL', dirtAtoms.twoCornerTop, atomSize);
				this.paintAtomAt(ctx, col, row - 1, 'BR', dirtAtoms.twoCornerTop, atomSize);
				// Left side (tile at col-1): corner in BR with one corner cut at BR
				this.paintAtomAt(ctx, col - 1, row, 'TR', dirtAtoms.threeCornerBL, atomSize);
				// Right side (tile at col+1): corner in BL with one corner cut at BL
				this.paintAtomAt(ctx, col + 1, row, 'TL', dirtAtoms.threeCornerBR, atomSize);
				// Diagonal back-left: inner corner in BR (threeCorner - mostly background with BR dirt)
				this.paintAtomAt(ctx, col - 1, row - 1, 'BR', dirtAtoms.threeCornerTL, atomSize);
				// Diagonal back-right: inner corner in BL (threeCorner - mostly background with BL dirt)
				this.paintAtomAt(ctx, col + 1, row - 1, 'BL', dirtAtoms.threeCornerTR, atomSize);

			} else if (rampDir === 'top') {
				// Ramp goes UP - back is row+1, sides are col-1 and col+1
				this.paintAtomAt(ctx, col, row + 1, 'TL', dirtAtoms.twoCornerBottom, atomSize);
				this.paintAtomAt(ctx, col, row + 1, 'TR', dirtAtoms.twoCornerBottom, atomSize);
				// Left side (tile at col-1): corner in BR (opposite quadrant from ramp direction)
				this.paintAtomAt(ctx, col - 1, row, 'BR', dirtAtoms.threeCornerTL, atomSize);
				// Right side (tile at col+1): corner in BL (opposite quadrant from ramp direction)
				this.paintAtomAt(ctx, col + 1, row, 'BL', dirtAtoms.threeCornerTR, atomSize);
				// Diagonal back-left: inner corner in TR
				this.paintAtomAt(ctx, col - 1, row + 1, 'TR', dirtAtoms.threeCornerBL, atomSize);
				// Diagonal back-right: inner corner in TL
				this.paintAtomAt(ctx, col + 1, row + 1, 'TL', dirtAtoms.threeCornerBR, atomSize);

			} else if (rampDir === 'left') {
				// Ramp goes LEFT - back is col+1, sides are row-1 and row+1
				this.paintAtomAt(ctx, col + 1, row, 'TL', dirtAtoms.twoCornerRight, atomSize);
				this.paintAtomAt(ctx, col + 1, row, 'BL', dirtAtoms.twoCornerRight, atomSize);
				// Top side (tile at row-1): corner in BR (opposite quadrant from ramp direction)
				this.paintAtomAt(ctx, col, row - 1, 'BR', dirtAtoms.threeCornerTL, atomSize);
				// Bottom side (tile at row+1): corner in TR (opposite quadrant from ramp direction)
				this.paintAtomAt(ctx, col, row + 1, 'TR', dirtAtoms.threeCornerBL, atomSize);
				// Diagonal back-top: inner corner in BL
				this.paintAtomAt(ctx, col + 1, row - 1, 'BL', dirtAtoms.threeCornerTR, atomSize);
				// Diagonal back-bottom: inner corner in TL
				this.paintAtomAt(ctx, col + 1, row + 1, 'TL', dirtAtoms.threeCornerBR, atomSize);

			} else if (rampDir === 'right') {
				// Ramp goes RIGHT - back is col-1, sides are row-1 and row+1
				this.paintAtomAt(ctx, col - 1, row, 'TR', dirtAtoms.twoCornerLeft, atomSize);
				this.paintAtomAt(ctx, col - 1, row, 'BR', dirtAtoms.twoCornerLeft, atomSize);
				// Top side (tile at row-1): corner in BL (opposite quadrant from ramp direction)
				this.paintAtomAt(ctx, col, row - 1, 'BL', dirtAtoms.threeCornerTR, atomSize);
				// Bottom side (tile at row+1): corner in TL (opposite quadrant from ramp direction)
				this.paintAtomAt(ctx, col, row + 1, 'TL', dirtAtoms.threeCornerBR, atomSize);
				// Diagonal back-top: inner corner in BR
				this.paintAtomAt(ctx, col - 1, row - 1, 'BR', dirtAtoms.threeCornerTL, atomSize);
				// Diagonal back-bottom: inner corner in TR
				this.paintAtomAt(ctx, col - 1, row + 1, 'TR', dirtAtoms.threeCornerBL, atomSize);
			}
		});
	}

	/**
	 * Paint a single atom at a specific tile position and quadrant
	 */
	paintAtomAt(ctx, col, row, quadrant, atom, atomSize) {
		// Bounds check
		if (row < 0 || col < 0) return;
		if (!this.heightMap || row >= this.heightMap.length) return;
		if (!this.heightMap[row] || col >= this.heightMap[row].length) return;

		const x = col * this.tileSize;
		const y = row * this.tileSize;

		const atomCanvas = this.imageDataToCanvas(atom);

		let offsetX = 0, offsetY = 0;
		if (quadrant === 'TR' || quadrant === 'BR') offsetX = atomSize;
		if (quadrant === 'BL' || quadrant === 'BR') offsetY = atomSize;

		ctx.drawImage(atomCanvas, x + offsetX, y + offsetY, atomSize, atomSize);
	}

	/**
	 * Redraw only specific tiles and their neighbors (incremental rendering)
	 * @param {Array} tileCoords - Array of {x, y} coordinates of tiles to redraw
	 */
	redrawTiles(tileCoords) {
		if (!tileCoords || tileCoords.length === 0) return;

		const ctx = this.canvas.getContext('2d');
		const tilesToRedraw = new Set();

		// Collect all tiles that need to be redrawn (including neighbors)
		tileCoords.forEach(coord => {
			const { x, y } = coord;

			// Add the tile itself
			tilesToRedraw.add(`${x},${y}`);

			// Add all 8 neighbors (for proper blending)
			for (let dy = -1; dy <= 1; dy++) {
				for (let dx = -1; dx <= 1; dx++) {
					const nx = x + dx;
					const ny = y + dy;
					if (nx >= 0 && nx < this.numColumns && ny >= 0 && ny < this.numColumns) {
						tilesToRedraw.add(`${nx},${ny}`);
					}
				}
			}
		});

		// Re-analyze only the tiles that need to be redrawn
		const analyzedTiles = [];
		tilesToRedraw.forEach(coordStr => {
			const [x, y] = coordStr.split(',').map(Number);
			const tile = this.analyzeTile(y, x); // Note: analyzeTile takes (row, col)
			analyzedTiles.push({ tile, x, y });
		});

		// Re-analyze the entire map ONCE for proper neighbor detection
		const fullAnalyzedMap = this.analyzeMap();

		// Redraw each analyzed tile
		analyzedTiles.forEach(({ tile, x, y }) => {
			const pixelX = x * this.tileSize;
			const pixelY = y * this.tileSize;

			let imageData;

			// Use the tile from fullAnalyzedMap instead of the individually analyzed tile
			// fullAnalyzedMap is a 1D array indexed as: row * numColumns + col
			const index = y * this.numColumns + x;
			const correctTile = fullAnalyzedMap[index];

			if (correctTile.terrainIndex >= 0) {
				imageData = this.drawTileWithLayering(fullAnalyzedMap, correctTile, y, x);
			} else {
				// Create transparent/black tile for invalid terrain
				let numPixels = this.tileSize * this.tileSize;
				const blackData = new Uint8ClampedArray(numPixels * 4);
				blackData.fill(0);
				imageData = new ImageData(blackData, this.tileSize, this.tileSize);
			}

			// Update height map for this tile
			this.updateHeightMapForTile(pixelX, pixelY, correctTile.heightAnalysis.heightIndex);

			// Draw the tile to the main canvas
			ctx.putImageData(imageData, pixelX, pixelY);
		});

		// Update stored terrain data (only for modified region if possible)
		// For simplicity, update the entire terrain data
		this.terrainData = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height).data;
	}

	/**
	 * Paint a texture atom onto a specific quadrant of a tile for cliff blending
	 * @param {number} tileX - Tile X coordinate in grid
	 * @param {number} tileZ - Tile Z coordinate in grid
	 * @param {string} quadrant - Which quadrant to paint: 'TL', 'TR', 'BL', 'BR'
	 * @param {number} terrainIndex - Terrain type index (e.g., grass)
	 * @param {number} rotation - Rotation in radians for the atom
	 */
	paintAtomOnTile(tileX, tileZ, quadrant, terrainIndex, rotation = 0) {
		const rows = this.tileMap.length;
		const cols = this.tileMap[0].length;

		// Validate coordinates
		if (tileX < 0 || tileX >= cols || tileZ < 0 || tileZ >= rows) {
			return;
		}

		const atomSize = this.tileSize / 2;
		const ctx = this.canvas.getContext('2d');

		// Calculate pixel position on canvas
		const pixelX = tileX * this.tileSize;
		const pixelY = tileZ * this.tileSize;

		// Get the appropriate base atom for the terrain type
		const atoms = this.baseAtoms[terrainIndex];
		if (!atoms) {
			console.warn(`No atoms found for terrain index ${terrainIndex}`);
			return;
		}

		// Use the 'full' atom as the base texture
		let atomImageData = atoms.full;
		if (!atomImageData) {
			console.warn(`No full atom found for terrain index ${terrainIndex}`);
			return;
		}

		// Convert to canvas for rotation if needed
		let atomCanvas = this.imageDataToCanvas(atomImageData);

		// Apply rotation if specified
		if (rotation !== 0) {
			atomCanvas = this.rotateCanvas(atomCanvas, rotation);
		}

		// Determine quadrant offset within the tile
		let offsetX = 0;
		let offsetY = 0;

		switch(quadrant) {
			case 'TL':
				offsetX = 0;
				offsetY = 0;
				break;
			case 'TR':
				offsetX = atomSize;
				offsetY = 0;
				break;
			case 'BL':
				offsetX = 0;
				offsetY = atomSize;
				break;
			case 'BR':
				offsetX = atomSize;
				offsetY = atomSize;
				break;
		}

		// Draw the atom onto the canvas
		ctx.drawImage(atomCanvas, pixelX + offsetX, pixelY + offsetY, atomSize, atomSize);
	}

	/**
	 * Rotate a canvas by the specified angle
	 */
	rotateCanvas(sourceCanvas, angle) {
		const size = sourceCanvas.width;
		const rotatedCanvas = document.createElement('canvas');
		rotatedCanvas.width = size;
		rotatedCanvas.height = size;
		const ctx = rotatedCanvas.getContext('2d');

		// Translate to center, rotate, translate back
		ctx.translate(size / 2, size / 2);
		ctx.rotate(angle);
		ctx.translate(-size / 2, -size / 2);

		// Draw the source canvas
		ctx.drawImage(sourceCanvas, 0, 0);

		return rotatedCanvas;
	}

	/**
	 * Batch paint multiple atoms at once for better performance
	 * @param {Array} operations - Array of {upperTileX, upperTileZ, quadrant, terrainIndex, atomRotation}
	 */
	paintAtomsBatch(operations) {
		if (!operations || operations.length === 0) return;

		const atomSize = this.tileSize / 2;
		const ctx = this.canvas.getContext('2d');

		// Cache rotated atoms to avoid re-rotating the same angle multiple times
		const rotatedAtomCache = new Map(); // key: "terrainIndex,rotation"

		operations.forEach(op => {
			const { upperTileX, upperTileZ, quadrant, terrainIndex, atomRotation } = op;

			// Get the base atom
			const atoms = this.baseAtoms[terrainIndex];
			if (!atoms || !atoms.full) return;

			// Check cache for rotated atom
			const cacheKey = `${terrainIndex},${atomRotation}`;
			let atomCanvas = rotatedAtomCache.get(cacheKey);

			if (!atomCanvas) {
				// Create and cache the rotated atom
				atomCanvas = this.imageDataToCanvas(atoms.full);
				if (atomRotation !== 0) {
					atomCanvas = this.rotateCanvas(atomCanvas, atomRotation);
				}
				rotatedAtomCache.set(cacheKey, atomCanvas);
			}

			// Calculate pixel position
			const pixelX = upperTileX * this.tileSize;
			const pixelY = upperTileZ * this.tileSize;

			// Determine quadrant offset
			let offsetX = 0, offsetY = 0;
			switch(quadrant) {
				case 'TL': offsetX = 0; offsetY = 0; break;
				case 'TR': offsetX = atomSize; offsetY = 0; break;
				case 'BL': offsetX = 0; offsetY = atomSize; break;
				case 'BR': offsetX = atomSize; offsetY = atomSize; break;
			}

			// Draw the atom
			ctx.drawImage(atomCanvas, pixelX + offsetX, pixelY + offsetY, atomSize, atomSize);
		});
	}
}
