class UiManager extends engine.Component {
    
    constructor(game, parent, params) {
        super(game, parent, params);
    }
    
    
    init({ canvas, canvasBuffer, terrainCanvasBuffer }) {
        this.canvas = canvas || this.game.canvas;
        this.canvasBuffer = canvasBuffer || this.game.canvasBuffer;
        if(this.game.config.configs.game.is3D) {
            this.finalCtx = this.canvas.getContext("webgl2");
            this.ctx = this.canvasBuffer.getContext("webgl2");
        } else {
            this.finalCtx = this.canvas.getContext("2d");
            this.ctx = this.canvasBuffer.getContext("2d");
        }
        this.terrainCanvasBuffer = terrainCanvasBuffer || this.game.terrainCanvasBuffer;
        this.projectConfig = this.game.config.configs.game;
        this.gridSize = this.projectConfig.gridSize;
        this.isometric = this.projectConfig.isIsometric || false;
       this.overlay = document.getElementById('overlay');
        this.tooltip = document.getElementById('tooltip');
        this.gameOverMenu = document.getElementById('gameOverMenu');
        this.victoryMenu = document.getElementById('victoryMenu');

       this.hpDisplay = document.getElementById('hpDisplay');
       this.gameOverWave = document.getElementById('gameOverWave');
  
        this.setupEventListeners();
        this.game.uiManager = this;
       
    }
    clearCanvas() {
        this.ctx.clearRect(0, 0, this.canvasBuffer.width, this.canvasBuffer.height);
        this.finalCtx.clearRect(0, 0, this.canvas.width, this.canvas.height);    
    }
    renderCanvas() {      
        this.finalCtx.drawImage(this.canvasBuffer, 0, 0);
    }

    setMousePosition(clientX, clientY) {
        if(!this.game.config.configs.game.is3D) {
            const rect = this.canvas.getBoundingClientRect();
                
            // Account for canvas scaling and offset
            const scaleX = this.canvas.width / rect.width;   // Ratio of canvas pixel width to CSS width
            const scaleY = this.canvas.height / rect.height; // Ratio of canvas pixel height to CSS height
            
            const mapGridWidth = this.game.state.tileMap.length;
            // Calculate mouse position relative to canvas with scaling
            const mouseX = (clientX - rect.left) * scaleX + (this.isometric ? 0 : -( this.canvas.width - mapGridWidth * this.game.config.configs.game.gridSize) / 2);
            const mouseY = (clientY - rect.top) * scaleY + (this.isometric ? 0 : -( this.canvas.height - mapGridWidth * this.game.config.configs.game.gridSize) / 2);

            // Convert to isometric and grid coordinates
            const gridPos = this.game.translator.isoToGrid(mouseX, mouseY);
            const snappedGrid = this.game.translator.snapToGrid(gridPos.x, gridPos.y);
            const pixelIsoPos = this.game.translator.pixelToIso(mouseX, mouseY);

            // Update state with corrected coordinates
            this.game.state.mousePosition = { 
                x: mouseX, 
                y: mouseY, 
                isoX: pixelIsoPos.x, 
                isoY: pixelIsoPos.y, 
                gridX: snappedGrid.x, 
                gridY: snappedGrid.y 
            };
        } else {
            const rect = this.canvas.getBoundingClientRect();
            
            // Calculate normalized device coordinates (-1 to +1)
            const mouseX = ((clientX - rect.left) / rect.width) * 2 - 1;
            const mouseY = -((clientY - rect.top) / rect.height) * 2 + 1;
            
            // Setup the raycaster
            const raycaster = new THREE.Raycaster();
            const mouse = new THREE.Vector2(mouseX, mouseY);
            
            // Update the picking ray with the camera and mouse position
            raycaster.setFromCamera(mouse, this.game.camera);
            
            // Create a plane at y=0 to represent our terrain
            const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
            
            // Calculate the point where the ray intersects the ground plane
            const intersectPoint = new THREE.Vector3();
            raycaster.ray.intersectPlane(groundPlane, intersectPoint);
            
            if (intersectPoint) {
                // Convert to grid coordinates
                const gridX = Math.floor(intersectPoint.x / this.game.config.configs.game.gridSize);
                const gridY = Math.floor(intersectPoint.z / this.game.config.configs.game.gridSize);
                
                // Update state with world and grid coordinates
                this.game.state.mousePosition = {
                    x: intersectPoint.x,                    
                    y: intersectPoint.z,
                    gridX: gridX,
                    gridY: gridY,
                    worldX: intersectPoint.x,
                    worldY: intersectPoint.z
                };
            }

        }
    }

    setupEventListeners() {
        document.getElementById('startGameBtn').removeAttribute('style');
        document.getElementById('startGameBtn').addEventListener('click', (e) => {    
            this.game.state.isPaused = false;
            e.target.setAttribute('style','display:none;');
        });
        document.querySelector("#gameOverMenu .menu-button").addEventListener("click", (e) => {
            this.game.reset();
        });
        
        document.querySelector("#victoryMenu .menu-button").addEventListener("click", (e) => {
            this.game.reset();
        });
        this.canvas.addEventListener('mousemove', (e) => {
            this.setMousePosition(e.clientX, e.clientY);
        });

        this.canvas.addEventListener('mouseout', () => {
            this.hideTooltip();
        });
                
        // Cancel tower placement with right click
        this.canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (this.game.state.selectedTowerType) {
                this.game.state.selectedTowerType = null;
                this.canvas.style.cursor = 'default';
            }
        });
    }


    reset() {
        this.gameOverMenu.style.display = 'none';
        this.victoryMenu.style.display = 'none';
        this.overlay.style.display = 'none';
    }


    draw() {
        this.hpDisplay.textContent = Math.floor(this.game.state.bloodCoreHP); 
        if(!this.game.config.configs.game.is3D) {
            this.renderCanvas();
        }
    }


    showTooltip(x, y, text) {
        const tooltip = document.getElementById('tooltip');
        tooltip.style.display = 'block';
        tooltip.style.left = (x + 10) + 'px';
        tooltip.style.top = (y + 10) + 'px';
        tooltip.textContent = text;
    }

    hideTooltip() {
        const tooltip = document.getElementById('tooltip');
        tooltip.style.display = 'none';
    }
}