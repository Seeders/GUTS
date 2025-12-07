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

		// Quadrant positions for atom painting [offsetX multiplier, offsetY multiplier]
		this.QuadrantPos = {
			TL: [0, 0], TR: [1, 0], BL: [0, 1], BR: [1, 1]
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

	/**
	 * Get neighbor ramp states for a tile position
	 * @returns {Object} Object with ramp states for all 8 neighbors
	 */
	getNeighborRampStates(col, row) {
		return {
			top: this.hasRampAt(col, row - 1),
			bot: this.hasRampAt(col, row + 1),
			left: this.hasRampAt(col - 1, row),
			right: this.hasRampAt(col + 1, row),
			cornerTL: this.hasRampAt(col - 1, row - 1),
			cornerTR: this.hasRampAt(col + 1, row - 1),
			cornerBL: this.hasRampAt(col - 1, row + 1),
			cornerBR: this.hasRampAt(col + 1, row + 1)
		};
	}

	/**
	 * Get height at a position safely
	 */
	getHeightAt(col, row) {
		if (!this.heightMap || row < 0 || row >= this.heightMap.length) return 0;
		if (!this.heightMap[row] || col < 0 || col >= this.heightMap[row].length) return 0;
		return this.heightMap[row][col];
	}

	/**
	 * Check if a tile is a lower ramp tile (has a higher neighbor with a ramp pointing to it)
	 */
	isLowerRampTile(col, row) {
		if (!this.heightMap) return false;
		const tileHeight = this.getHeightAt(col, row);
		const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]]; // top, bot, left, right
		return dirs.some(([dc, dr]) => {
			const nc = col + dc, nr = row + dr;
			return this.getHeightAt(nc, nr) > tileHeight && this.hasRampAt(nc, nr);
		});
	}

	/**
	 * Check if a tile is a top ramp tile (has the ramp AND has a lower neighbor)
	 */
	isTopRampTile(col, row) {
		if (!this.hasRampAt(col, row)) return false;
		const tileHeight = this.getHeightAt(col, row);
		const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
		return dirs.some(([dc, dr]) => this.getHeightAt(col + dc, row + dr) < tileHeight);
	}

	/**
	 * Get the direction a top ramp tile faces (toward lower neighbor)
	 * @returns {'top'|'bot'|'left'|'right'|null}
	 */
	getTopRampDirection(col, row) {
		if (!this.hasRampAt(col, row)) return null;
		const h = this.getHeightAt(col, row);
		if (this.getHeightAt(col, row - 1) < h) return 'top';
		if (this.getHeightAt(col, row + 1) < h) return 'bot';
		if (this.getHeightAt(col - 1, row) < h) return 'left';
		if (this.getHeightAt(col + 1, row) < h) return 'right';
		return null;
	}

	/**
	 * Paint an atom at a quadrant position with optional offset adjustments
	 */
	drawAtomAtQuadrant(ctx, atoms, atomKey, quadrant, atomSize, offsetAdjust = [0, 0]) {
		const atom = atoms[atomKey];
		if (!atom) return;
		const canvas = this.imageDataToCanvas(atom);
		const [mx, my] = this.QuadrantPos[quadrant];
		ctx.drawImage(canvas, mx * atomSize + offsetAdjust[0], my * atomSize + offsetAdjust[1], atomSize, atomSize);
	}

	/**
	 * Paint edge atoms on two quadrants along an edge
	 */
	paintEdge(ctx, atoms, atomKey, quads, skipQuads, atomSize, offsetAdjust = [0, 0]) {
		const canvas = this.rotateCanvas(this.imageDataToCanvas(atoms[atomKey]), 0);
		quads.forEach(q => {
			if (!skipQuads[q]) {
				const [mx, my] = this.QuadrantPos[q];
				ctx.drawImage(canvas, mx * atomSize + offsetAdjust[0], my * atomSize + offsetAdjust[1], atomSize, atomSize);
			}
		});
	}

	/**
	 * Paint a corner atom at a specific quadrant
	 */
	paintCorner(ctx, atoms, atomKey, quadrant, atomSize) {
		const canvas = this.rotateCanvas(this.imageDataToCanvas(atoms[atomKey]), 0);
		const [mx, my] = this.QuadrantPos[quadrant];
		ctx.drawImage(canvas, mx * atomSize, my * atomSize, atomSize, atomSize);
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
		const spriteRes = this.tileSize / 2;

		// Helper to create canvas and draw sprite
		const createAtomCanvas = (sprite) => {
			const canvas = document.createElement("canvas");
			canvas.width = spriteRes;
			canvas.height = spriteRes;
			canvas.setAttribute('willReadFrequently', true);
			const ctx = canvas.getContext("2d", { willReadFrequently: true });
			ctx.drawImage(sprite, 0, 0);
			return ctx;
		};

		// Create contexts for all atom types
		const A = this.TileAtom;
		const ctxs = {
			full: createAtomCanvas(sprites[A.Full]),
			fullVar: createAtomCanvas(sprites[A.FullVariation]),
			oneCorner: createAtomCanvas(sprites[A.OneCorner]),
			twoCorner: createAtomCanvas(sprites[A.TwoCorner]),
			threeCorner: createAtomCanvas(sprites[A.ThreeCorner]),
			oneCornerBot: createAtomCanvas(sprites[A.OneCornerBot]),
			twoCornerBot: createAtomCanvas(sprites[A.TwoCornerBot]),
			threeCornerBot: createAtomCanvas(sprites[A.ThreeCornerBot])
		};

		// Helper to get image data
		const getData = (ctx) => ctx.getImageData(0, 0, spriteRes, spriteRes);

		// Build all atom variants
		const baseAtoms = {
			full: getData(ctxs.full),
			fullVariation: getData(ctxs.fullVar),
			oneCornerTR: getData(ctxs.oneCorner),
			oneCornerTL: this.flipTextureHorizontal(getData(ctxs.oneCorner)),
			oneCornerBR: getData(ctxs.oneCornerBot),
			oneCornerBL: this.flipTextureHorizontal(getData(ctxs.oneCornerBot)),
			twoCornerTop: getData(ctxs.twoCorner),
			twoCornerRight: this.rotateTexture(getData(ctxs.twoCorner), Math.PI / 2),
			twoCornerBottom: getData(ctxs.twoCornerBot),
			twoCornerLeft: this.rotateTexture(getData(ctxs.twoCornerBot), Math.PI / 2),
			threeCornerTR: getData(ctxs.threeCorner),
			threeCornerTL: this.flipTextureHorizontal(getData(ctxs.threeCorner)),
			threeCornerBR: getData(ctxs.threeCornerBot),
			threeCornerBL: this.flipTextureHorizontal(getData(ctxs.threeCornerBot))
		};

		// Create molecule canvas
		const moleculeCanvas = document.createElement("canvas");
		moleculeCanvas.width = spriteRes * 2;
		moleculeCanvas.height = spriteRes * 2;
		const moleculeCtx = moleculeCanvas.getContext('2d', { willReadFrequently: true });

		// Aliases for molecule creation
		const b = baseAtoms;
		const cm = (tl, tr, bl, br) => this.createMolecule(moleculeCtx, tl, tr, bl, br);

		const imageDataList = [
			cm(b.full, b.full, b.full, b.full),                                           // FULL
			b.oneCornerTL, b.oneCornerTR, b.oneCornerBL, b.oneCornerBR,                   // CORNERS
			cm(b.twoCornerTop, b.twoCornerTop, b.full, b.full),                           // EdgeT
			cm(b.twoCornerLeft, b.fullVariation, b.twoCornerLeft, b.fullVariation),       // EdgeL
			cm(b.full, b.twoCornerRight, b.full, b.twoCornerRight),                       // EdgeR
			cm(b.fullVariation, b.fullVariation, b.twoCornerBottom, b.twoCornerBottom),   // EdgeB
			cm(b.twoCornerTop, b.twoCornerTop, b.twoCornerBottom, b.twoCornerBottom),     // TunnelH
			cm(b.twoCornerLeft, b.twoCornerRight, b.twoCornerLeft, b.twoCornerRight),     // TunnelV
			cm(b.threeCornerTL, b.twoCornerTop, b.twoCornerLeft, b.full),                 // TwoSidesTL
			cm(b.twoCornerTop, b.threeCornerTR, b.full, b.twoCornerRight),                // TwoSidesTR
			cm(b.twoCornerLeft, b.fullVariation, b.threeCornerBL, b.twoCornerBottom),     // TwoSidesBL
			cm(b.fullVariation, b.twoCornerRight, b.twoCornerBottom, b.threeCornerBR),    // TwoSidesBR
			cm(b.threeCornerTL, b.threeCornerTR, b.twoCornerLeft, b.twoCornerRight),      // PenninsulaT
			cm(b.threeCornerTL, b.twoCornerTop, b.threeCornerBL, b.twoCornerBottom),      // PenninsulaL
			cm(b.twoCornerTop, b.threeCornerTR, b.twoCornerBottom, b.threeCornerBR),      // PenninsulaR
			cm(b.twoCornerLeft, b.twoCornerRight, b.threeCornerBL, b.threeCornerBR),      // PenninsulaB
			cm(b.threeCornerTL, b.threeCornerTR, b.threeCornerBL, b.threeCornerBR),       // Island
			cm(b.fullVariation, b.fullVariation, b.fullVariation, b.fullVariation)        // FullVariation
		];

		return { molecules: imageDataList, baseAtoms };
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

		const getFullAtom = () => useVariation && atoms.fullVariation ? atoms.fullVariation : atoms.full;

		// Position config: [diagonalKey, cardinal1Key, cardinal2Key, oneCornerKey]
		const posConfigs = {
			TL: ['cornerTopLeftLess', 'topLess', 'leftLess', 'oneCornerTL'],
			TR: ['cornerTopRightLess', 'topLess', 'rightLess', 'oneCornerTR'],
			BL: ['cornerBottomLeftLess', 'botLess', 'leftLess', 'oneCornerBL'],
			BR: ['cornerBottomRightLess', 'botLess', 'rightLess', 'oneCornerBR']
		};

		const cfg = posConfigs[position];
		if (!cfg) return null;

		const [diagKey, card1Key, card2Key, cornerAtomKey] = cfg;
		const diagLess = analysis[diagKey];
		const card1Less = analysis[card1Key];
		const card2Less = analysis[card2Key];

		if (diagLess && !card1Less && !card2Less) return atoms[cornerAtomKey];
		if (!card1Less && !card2Less) return getFullAtom();
		return null;
	}

	// Select base layer atom based on which neighbors are even lower
	selectBaseLayerAtom(atoms, position, miniAnalysis) {
		if (!atoms) return null;

		// Position config: [diagKey, card1Key, card2Key, threeCornerKey, twoCorner1Key, twoCorner2Key, oneCornerKey]
		const posConfigs = {
			TL: ['cornerTopLeftLess', 'topLess', 'leftLess', 'threeCornerTL', 'twoCornerTop', 'twoCornerLeft', 'oneCornerTL'],
			TR: ['cornerTopRightLess', 'topLess', 'rightLess', 'threeCornerTR', 'twoCornerTop', 'twoCornerRight', 'oneCornerTR'],
			BL: ['cornerBottomLeftLess', 'botLess', 'leftLess', 'threeCornerBL', 'twoCornerBottom', 'twoCornerLeft', 'oneCornerBL'],
			BR: ['cornerBottomRightLess', 'botLess', 'rightLess', 'threeCornerBR', 'twoCornerBottom', 'twoCornerRight', 'oneCornerBR']
		};

		const cfg = posConfigs[position];
		if (!cfg) return atoms.full;

		const [diagKey, card1Key, card2Key, threeKey, two1Key, two2Key, oneKey] = cfg;
		const diag = miniAnalysis[diagKey];
		const card1 = miniAnalysis[card1Key];
		const card2 = miniAnalysis[card2Key];

		if (card1 && card2) return atoms[threeKey];
		if (card1 && diag) return atoms[two1Key];
		if (card2 && diag) return atoms[two2Key];
		if (card1) return atoms[two1Key];
		if (card2) return atoms[two2Key];
		if (diag) return atoms[oneKey];
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
		const row = y, col = x;
		const result = {
			terrainIndex: 0,
			heightAnalysis: new this.TileAnalysis(),
			terrainAnalysis: new this.TileAnalysis()
		};

		if (row < 0 || row >= this.numColumns || col < 0 || col >= this.numColumns) return result;

		result.terrainIndex = this.tileMap[row][col];
		const heightData = this.heightMap || this.tileMap;
		result.heightAnalysis.heightIndex = heightData[row][col];
		result.terrainAnalysis.heightIndex = this.tileMap[row][col];

		// Neighbor configs: [dr, dc, dirKey, lessKey, higherKey, isCardinal]
		const neighbors = [
			[-1, 0, 'topHeight', 'topLess', 'topHigher', true],
			[0, -1, 'leftHeight', 'leftLess', 'leftHigher', true],
			[0, 1, 'rightHeight', 'rightLess', 'rightHigher', true],
			[1, 0, 'botHeight', 'botLess', 'botHigher', true],
			[-1, -1, 'topLeftHeight', 'cornerTopLeftLess', 'cornerTopLeftHigher', false],
			[-1, 1, 'topRightHeight', 'cornerTopRightLess', 'cornerTopRightHigher', false],
			[1, -1, 'botLeftHeight', 'cornerBottomLeftLess', 'cornerBottomLeftHigher', false],
			[1, 1, 'botRightHeight', 'cornerBottomRightLess', 'cornerBottomRightHigher', false]
		];

		neighbors.forEach(([dr, dc, dirKey, lessKey, higherKey, isCardinal]) => {
			const r = row + dr, c = col + dc;
			if (r < 0 || r >= this.numColumns || c < 0 || c >= this.numColumns) return;

			// Height analysis
			const hVal = heightData[r][c];
			result.heightAnalysis[dirKey] = hVal;
			if (hVal < result.heightAnalysis.heightIndex) {
				result.heightAnalysis[lessKey] = true;
				result.heightAnalysis[isCardinal ? 'neighborLowerCount' : 'cornerLowerCount']++;
			}
			if (hVal > result.heightAnalysis.heightIndex) {
				result.heightAnalysis[higherKey] = true;
				result.heightAnalysis[isCardinal ? 'neighborHigherCount' : 'cornerHigherCount']++;
			}

			// Terrain analysis
			const tVal = this.tileMap[r][c];
			result.terrainAnalysis[dirKey] = tVal;
			if (tVal < result.terrainAnalysis.heightIndex) {
				result.terrainAnalysis[lessKey] = true;
				result.terrainAnalysis[isCardinal ? 'neighborLowerCount' : 'cornerLowerCount']++;
			}
		});

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
		const { topLess, leftLess, rightLess, botLess, neighborLowerCount } = tileAnalysis;
		const M = this.TileCliffMolecules;

		if (neighborLowerCount === 0) return Math.random() < 0.5 ? M.Full : M.FullVariation;
		if (neighborLowerCount === 4) return M.Island;

		// Build a key from cardinal states for fast lookup
		const key = (topLess ? 8 : 0) | (leftLess ? 4 : 0) | (rightLess ? 2 : 0) | (botLess ? 1 : 0);
		const moleculeMap = {
			8: M.EdgeT, 4: M.EdgeL, 2: M.EdgeR, 1: M.EdgeB,           // 1 neighbor
			9: M.TunnelH, 6: M.TunnelV,                                 // tunnels
			12: M.TwoSidesTL, 10: M.TwoSidesTR, 5: M.TwoSidesBL, 3: M.TwoSidesBR, // 2 sides
			7: M.PenninsulaB, 11: M.PenninsulaR, 13: M.PenninsulaL, 14: M.PenninsulaT // 3 neighbors
		};
		return moleculeMap[key] || (Math.random() < 0.5 ? M.Full : M.FullVariation);
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
		if (heightAnalysis.cornerLowerCount === 0) return imageData;

		const s = this.tileSize / 2;
		const M = this.TileCliffMolecules;

		// Corner configs: [diagLessKey, card1Key, card2Key, moleculeKey, x, y]
		const corners = [
			['cornerTopLeftLess', 'topLess', 'leftLess', M.CornerTL, 0, 0],
			['cornerTopRightLess', 'topLess', 'rightLess', M.CornerTR, s, 0],
			['cornerBottomLeftLess', 'botLess', 'leftLess', M.CornerBL, 0, s],
			['cornerBottomRightLess', 'botLess', 'rightLess', M.CornerBR, s, s]
		];

		for (const [diagKey, card1Key, card2Key, mol, x, y] of corners) {
			if (heightAnalysis[diagKey] && !heightAnalysis[card1Key] && !heightAnalysis[card2Key]) {
				imageData = this.colorCornerTextureRoutine(imageData, x, y, this.layerTextures[terrainIndex][mol], terrainIndex);
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
	 */
	paintCliffSupportingTexturesForTile(ctx, analyzedMap, tile, row, col) {
		if (this.skipCliffTextures || this.hasRampAt(col, row)) return;

		const h = tile.heightAnalysis;
		const atomSize = this.tileSize / 2;
		const ramps = this.getNeighborRampStates(col, row);
		const atoms = this.baseAtoms[this.getGrassIndex()];
		if (!atoms?.full) return;

		// Effective states (suppress if neighbor has ramp)
		const eff = {
			top: h.topLess && !ramps.top, bot: h.botLess && !ramps.bot,
			left: h.leftLess && !ramps.left, right: h.rightLess && !ramps.right,
			cornerTL: h.cornerTopLeftLess && !ramps.cornerTL, cornerTR: h.cornerTopRightLess && !ramps.cornerTR,
			cornerBL: h.cornerBottomLeftLess && !ramps.cornerBL, cornerBR: h.cornerBottomRightLess && !ramps.cornerBR
		};

		// Corner treatment flags (two adjacent edges meet)
		const skip = {
			TL: eff.bot && eff.right, TR: eff.bot && eff.left,
			BL: eff.top && eff.right, BR: eff.top && eff.left
		};

		// Edge configs: [condition, atomKey, quadrants, offsetAdjust]
		const edges = [
			[eff.bot, 'twoCornerTop', ['TL', 'TR'], [0, 0]],
			[eff.top, 'twoCornerBottom', ['BL', 'BR'], [0, -2]],
			[eff.right, 'twoCornerLeft', ['TL', 'BL'], [2, 0]],
			[eff.left, 'twoCornerRight', ['TR', 'BR'], [0, 0]]
		];
		edges.forEach(([cond, key, quads, offset]) => {
			if (cond) this.paintEdge(ctx, atoms, key, quads, skip, atomSize, offset);
		});

		// Outer corners where two edges meet
		const outerCorners = [
			[skip.TL, 'oneCornerBR', 'TL'], [skip.TR, 'oneCornerBL', 'TR'],
			[skip.BL, 'oneCornerTR', 'BL'], [skip.BR, 'oneCornerTL', 'BR']
		];
		outerCorners.forEach(([cond, key, quad]) => {
			if (cond) this.paintCorner(ctx, atoms, key, quad, atomSize);
		});

		// Inner corners (only diagonal neighbor is lower)
		const innerCorners = [
			[!eff.top && !eff.left && eff.cornerTL, [['twoCornerBottom', 'BL'], ['twoCornerRight', 'TR'], ['threeCornerBR', 'BR']]],
			[!eff.top && !eff.right && eff.cornerTR, [['twoCornerBottom', 'BR'], ['twoCornerLeft', 'TL'], ['threeCornerBL', 'BL']]],
			[!eff.bot && !eff.left && eff.cornerBL, [['twoCornerTop', 'TL'], ['twoCornerRight', 'BR'], ['threeCornerTR', 'TR']]],
			[!eff.bot && !eff.right && eff.cornerBR, [['twoCornerTop', 'TR'], ['twoCornerLeft', 'BL'], ['threeCornerTL', 'TL']]]
		];
		innerCorners.forEach(([cond, paints]) => {
			if (cond) paints.forEach(([key, quad]) => this.paintCorner(ctx, atoms, key, quad, atomSize));
		});

		// Opposite outer corners (two adjacent lower neighbors, paint remaining corner)
		const oppositeCorners = [
			[eff.top && eff.left && !eff.bot && !eff.right && !eff.cornerBR, 'oneCornerBR', 'BR'],
			[eff.top && eff.right && !eff.bot && !eff.left && !eff.cornerBL, 'oneCornerBL', 'BL'],
			[eff.bot && eff.right && !eff.top && !eff.left && !eff.cornerTL, 'oneCornerTL', 'TL'],
			[eff.bot && eff.left && !eff.top && !eff.right && !eff.cornerTR, 'oneCornerTR', 'TR']
		];
		oppositeCorners.forEach(([cond, key, quad]) => {
			if (cond) this.paintCorner(ctx, atoms, key, quad, atomSize);
		});
	}

	/**
	 * Paint cliff-base texture atoms on a tile if it's at the lower edge of a cliff
	 */
	paintCliffBaseTexturesForTile(ctx, analyzedMap, tile, row, col) {
		if (this.skipCliffTextures || this.hasRampAt(col, row)) return;

		const h = tile.heightAnalysis;
		const atomSize = this.tileSize / 2;
		const ramps = this.getNeighborRampStates(col, row);

		// Skip if any higher neighbor has a ramp (ramp mesh covers base texture area)
		if ((h.topHigher && ramps.top) || (h.botHigher && ramps.bot) ||
			(h.leftHigher && ramps.left) || (h.rightHigher && ramps.right)) return;

		const atoms = this.baseAtoms[this.getGrassIndex()];
		if (!atoms?.full) return;

		// Effective higher states (suppress if neighbor has ramp)
		const eff = {
			top: h.topHigher && !ramps.top, bot: h.botHigher && !ramps.bot,
			left: h.leftHigher && !ramps.left, right: h.rightHigher && !ramps.right
		};

		// Claimed by supporting textures (this tile has lower neighbors)
		const claimed = {
			TL: h.topLess || h.leftLess || h.cornerTopLeftLess,
			TR: h.topLess || h.rightLess || h.cornerTopRightLess,
			BL: h.botLess || h.leftLess || h.cornerBottomLeftLess,
			BR: h.botLess || h.rightLess || h.cornerBottomRightLess
		};

		// Corner treatment flags (two adjacent higher edges meet)
		const corner = {
			TL: eff.top && eff.left, TR: eff.top && eff.right,
			BL: eff.bot && eff.left, BR: eff.bot && eff.right
		};

		// Combined skip flags
		const skip = { TL: claimed.TL || corner.TL, TR: claimed.TR || corner.TR, BL: claimed.BL || corner.BL, BR: claimed.BR || corner.BR };

		// Edge configs: [condition, atomKey, quadrants]
		const edges = [
			[eff.top, 'twoCornerBottom', ['TL', 'TR']],
			[eff.bot, 'twoCornerTop', ['BL', 'BR']],
			[eff.left, 'twoCornerRight', ['TL', 'BL']],
			[eff.right, 'twoCornerLeft', ['TR', 'BR']]
		];
		edges.forEach(([cond, key, quads]) => {
			if (cond) this.paintEdge(ctx, atoms, key, quads, skip, atomSize);
		});

		// Outer corners where two edges meet
		const outerCorners = [
			[corner.TL && !claimed.TL, 'oneCornerBR', 'TL'],
			[corner.TR && !claimed.TR, 'oneCornerBL', 'TR'],
			[corner.BL && !claimed.BL, 'oneCornerTR', 'BL'],
			[corner.BR && !claimed.BR, 'oneCornerTL', 'BR']
		];
		outerCorners.forEach(([cond, key, quad]) => {
			if (cond) this.paintCorner(ctx, atoms, key, quad, atomSize);
		});

		// Inner corners (only diagonal neighbor is higher)
		const innerCorners = [
			[!eff.top && !eff.left && h.cornerTopLeftHigher && !claimed.TL, 'threeCornerBR', 'TL'],
			[!eff.top && !eff.right && h.cornerTopRightHigher && !claimed.TR, 'threeCornerBL', 'TR'],
			[!eff.bot && !eff.left && h.cornerBottomLeftHigher && !claimed.BL, 'threeCornerTR', 'BL'],
			[!eff.bot && !eff.right && h.cornerBottomRightHigher && !claimed.BR, 'threeCornerTL', 'BR']
		];
		innerCorners.forEach(([cond, key, quad]) => {
			if (cond) this.paintCorner(ctx, atoms, key, quad, atomSize);
		});

		// Opposite outer corners (both adjacent cardinals are higher)
		const oppositeCorners = [
			[eff.top && eff.left && !eff.bot && !eff.right && !claimed.TL, 'oneCornerBR', 'TL'],
			[eff.top && eff.right && !eff.bot && !eff.left && !claimed.TR, 'oneCornerBL', 'TR'],
			[eff.bot && eff.left && !eff.top && !eff.right && !claimed.BL, 'oneCornerTR', 'BL'],
			[eff.bot && eff.right && !eff.top && !eff.left && !claimed.BR, 'oneCornerTL', 'BR']
		];
		oppositeCorners.forEach(([cond, key, quad]) => {
			if (cond) this.paintCorner(ctx, atoms, key, quad, atomSize);
		});
	}

	/**
	 * Paint ramp textures using dirt atoms on ramp tiles and adjacent lower tiles
	 */
	paintRampTexturesForTile(ctx, analyzedMap, tile, row, col) {
		if (this.skipCliffTextures) return;

		const atomSize = this.tileSize / 2;
		const atoms = this.baseAtoms[this.getDirtIndex()];
		if (!atoms?.full) return;

		const hasRamp = this.hasRampAt(col, row);
		const thisIsLower = this.isLowerRampTile(col, row);
		const thisIsRampTile = hasRamp || thisIsLower;

		// Paint full dirt base for ramp tiles
		if (thisIsRampTile) {
			['TL', 'TR', 'BL', 'BR'].forEach(q => this.drawAtomAtQuadrant(ctx, atoms, 'full', q, atomSize));
		}

		const thisHeight = this.getHeightAt(col, row);

		// Check neighbor ramp states with height constraints
		const checkNeighbor = (dc, dr) => {
			const nc = col + dc, nr = row + dr;
			const nh = this.getHeightAt(nc, nr);
			const isTop = this.isTopRampTile(nc, nr);
			const isLow = this.isLowerRampTile(nc, nr);
			return {
				isTop: !thisIsRampTile && isTop && thisHeight >= nh,
				isLower: !thisIsRampTile && isLow && thisHeight <= nh,
				isAny: !thisIsRampTile && (isTop || isLow) && (isTop ? thisHeight >= nh : thisHeight <= nh)
			};
		};

		const neighbors = {
			top: checkNeighbor(0, -1), bot: checkNeighbor(0, 1),
			left: checkNeighbor(-1, 0), right: checkNeighbor(1, 0),
			cornerTL: checkNeighbor(-1, -1), cornerTR: checkNeighbor(1, -1),
			cornerBL: checkNeighbor(-1, 1), cornerBR: checkNeighbor(1, 1)
		};

		// Get ramp directions for side neighbor detection
		const getRampDir = (dc, dr) => neighbors[dc === 0 ? (dr < 0 ? 'top' : 'bot') : (dc < 0 ? 'left' : 'right')].isTop
			? this.getTopRampDirection(col + dc, row + dr) : null;

		const dirs = { top: getRampDir(0, -1), bot: getRampDir(0, 1), left: getRampDir(-1, 0), right: getRampDir(1, 0) };
		const isSide = {
			top: dirs.top === 'left' || dirs.top === 'right',
			bot: dirs.bot === 'left' || dirs.bot === 'right',
			left: dirs.left === 'top' || dirs.left === 'bot',
			right: dirs.right === 'top' || dirs.right === 'bot'
		};

		// Corner treatment flags
		const skip = {
			TL: neighbors.top.isAny && neighbors.left.isAny,
			TR: neighbors.top.isAny && neighbors.right.isAny,
			BL: neighbors.bot.isAny && neighbors.left.isAny,
			BR: neighbors.bot.isAny && neighbors.right.isAny
		};

		// Edge painting (skip if side neighbor)
		const edges = [
			[neighbors.top.isAny && !isSide.top, 'twoCornerBottom', ['TL', 'TR']],
			[neighbors.bot.isAny && !isSide.bot, 'twoCornerTop', ['BL', 'BR']],
			[neighbors.left.isAny && !isSide.left, 'twoCornerRight', ['TL', 'BL']],
			[neighbors.right.isAny && !isSide.right, 'twoCornerLeft', ['TR', 'BR']]
		];
		edges.forEach(([cond, key, quads]) => {
			if (cond) this.paintEdge(ctx, atoms, key, quads, skip, atomSize);
		});

		// Side neighbor corners (oneCorner atoms based on ramp direction)
		const sideCorners = [
			[col - 1, row, { top: ['oneCornerTL', 'TL'], bot: ['oneCornerBL', 'BL'] }],
			[col + 1, row, { top: ['oneCornerTR', 'TR'], bot: ['oneCornerBR', 'BR'] }],
			[col, row - 1, { left: ['oneCornerTL', 'TL'], right: ['oneCornerTR', 'TR'] }],
			[col, row + 1, { left: ['oneCornerBL', 'BL'], right: ['oneCornerBR', 'BR'] }]
		];
		sideCorners.forEach(([nc, nr, dirMap]) => {
			if (this.hasRampAt(nc, nr) && !thisIsRampTile) {
				const dir = this.getTopRampDirection(nc, nr);
				if (dir && dirMap[dir]) {
					const [key, quad] = dirMap[dir];
					this.paintCorner(ctx, atoms, key, quad, atomSize);
				}
			}
		});

		// Corners where two edges meet
		[['TL', 'oneCornerTL'], ['TR', 'oneCornerTR'], ['BL', 'oneCornerBL'], ['BR', 'oneCornerBR']].forEach(([q, key]) => {
			if (skip[q]) this.paintCorner(ctx, atoms, key, q, atomSize);
		});

		// Inner corners (only diagonal is ramp)
		const innerCorners = [
			[neighbors.cornerTL.isAny && !neighbors.top.isAny && !neighbors.left.isAny, 'threeCornerBR', 'TL'],
			[neighbors.cornerTR.isAny && !neighbors.top.isAny && !neighbors.right.isAny, 'threeCornerBL', 'TR'],
			[neighbors.cornerBL.isAny && !neighbors.bot.isAny && !neighbors.left.isAny, 'threeCornerTR', 'BL'],
			[neighbors.cornerBR.isAny && !neighbors.bot.isAny && !neighbors.right.isAny, 'threeCornerTL', 'BR']
		];
		innerCorners.forEach(([cond, key, quad]) => {
			if (cond) this.paintCorner(ctx, atoms, key, quad, atomSize);
		});
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

		// Direction configs: [backOffset, sideOffsets, edgeAtom, edgeQuadrants, sideQuadrants, sideAtoms, diagOffsets, diagQuadrants, diagAtoms]
		const dirConfigs = {
			bot: {
				back: [0, -1], backQuads: ['BL', 'BR'], backAtom: dirtAtoms.twoCornerTop,
				sides: [[-1, 0, 'TR', dirtAtoms.threeCornerBL], [1, 0, 'TL', dirtAtoms.threeCornerBR]],
				diags: [[-1, -1, 'BR', dirtAtoms.threeCornerTL], [1, -1, 'BL', dirtAtoms.threeCornerTR]]
			},
			top: {
				back: [0, 1], backQuads: ['TL', 'TR'], backAtom: dirtAtoms.twoCornerBottom,
				sides: [[-1, 0, 'BR', dirtAtoms.threeCornerTL], [1, 0, 'BL', dirtAtoms.threeCornerTR]],
				diags: [[-1, 1, 'TR', dirtAtoms.threeCornerBL], [1, 1, 'TL', dirtAtoms.threeCornerBR]]
			},
			left: {
				back: [1, 0], backQuads: ['TL', 'BL'], backAtom: dirtAtoms.twoCornerRight,
				sides: [[0, -1, 'BR', dirtAtoms.threeCornerTL], [0, 1, 'TR', dirtAtoms.threeCornerBL]],
				diags: [[1, -1, 'BL', dirtAtoms.threeCornerTR], [1, 1, 'TL', dirtAtoms.threeCornerBR]]
			},
			right: {
				back: [-1, 0], backQuads: ['TR', 'BR'], backAtom: dirtAtoms.twoCornerLeft,
				sides: [[0, -1, 'BL', dirtAtoms.threeCornerTR], [0, 1, 'TL', dirtAtoms.threeCornerBR]],
				diags: [[-1, -1, 'BR', dirtAtoms.threeCornerTL], [-1, 1, 'TR', dirtAtoms.threeCornerBL]]
			}
		};

		this.ramps.forEach(ramp => {
			const col = ramp.gridX;
			const row = ramp.gridZ;
			const thisHeight = this.heightMap[row] ? this.heightMap[row][col] : 0;

			// Find ramp direction (toward lower neighbor)
			let rampDir = null;
			if (row > 0 && this.heightMap[row - 1]?.[col] < thisHeight) rampDir = 'top';
			else if (this.heightMap[row + 1]?.[col] < thisHeight) rampDir = 'bot';
			else if (this.heightMap[row]?.[col - 1] < thisHeight) rampDir = 'left';
			else if (this.heightMap[row]?.[col + 1] < thisHeight) rampDir = 'right';
			if (!rampDir) return;

			const cfg = dirConfigs[rampDir];

			// Back neighbor edges
			cfg.backQuads.forEach(q => this.paintAtomAt(ctx, col + cfg.back[0], row + cfg.back[1], q, cfg.backAtom, atomSize));
			// Side neighbors
			cfg.sides.forEach(([dx, dy, q, atom]) => this.paintAtomAt(ctx, col + dx, row + dy, q, atom, atomSize));
			// Diagonal corners
			cfg.diags.forEach(([dx, dy, q, atom]) => this.paintAtomAt(ctx, col + dx, row + dy, q, atom, atomSize));
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
	 */
	paintAtomOnTile(tileX, tileZ, quadrant, terrainIndex, rotation = 0) {
		const rows = this.tileMap.length;
		const cols = this.tileMap[0].length;
		if (tileX < 0 || tileX >= cols || tileZ < 0 || tileZ >= rows) return;

		const atoms = this.baseAtoms[terrainIndex];
		if (!atoms?.full) return;

		const atomSize = this.tileSize / 2;
		let atomCanvas = this.imageDataToCanvas(atoms.full);
		if (rotation !== 0) atomCanvas = this.rotateCanvas(atomCanvas, rotation);

		const [mx, my] = this.QuadrantPos[quadrant] || [0, 0];
		const ctx = this.canvas.getContext('2d');
		ctx.drawImage(atomCanvas, tileX * this.tileSize + mx * atomSize, tileZ * this.tileSize + my * atomSize, atomSize, atomSize);
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
	 */
	paintAtomsBatch(operations) {
		if (!operations || operations.length === 0) return;

		const atomSize = this.tileSize / 2;
		const ctx = this.canvas.getContext('2d');
		const cache = new Map();

		operations.forEach(({ upperTileX, upperTileZ, quadrant, terrainIndex, atomRotation }) => {
			const atoms = this.baseAtoms[terrainIndex];
			if (!atoms?.full) return;

			const cacheKey = `${terrainIndex},${atomRotation}`;
			let atomCanvas = cache.get(cacheKey);
			if (!atomCanvas) {
				atomCanvas = this.imageDataToCanvas(atoms.full);
				if (atomRotation !== 0) atomCanvas = this.rotateCanvas(atomCanvas, atomRotation);
				cache.set(cacheKey, atomCanvas);
			}

			const [mx, my] = this.QuadrantPos[quadrant] || [0, 0];
			ctx.drawImage(atomCanvas, upperTileX * this.tileSize + mx * atomSize, upperTileZ * this.tileSize + my * atomSize, atomSize, atomSize);
		});
	}
}
