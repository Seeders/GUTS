class UiManager extends engine.Component {
        
    init({}) {
        this.setupCanvas();
        this.setupConfig();

        this.setupElements();
        this.setupEventListeners();    
    }

    setupCanvas() {
        this.canvas = this.game.canvas;
        this.canvasBuffer = this.game.canvasBuffer;
        if(this.game.getCollections().configs.game.is3D) {
            this.finalCtx = this.canvas.getContext("webgl2");
            this.ctx = this.canvasBuffer.getContext("webgl2");
        } else {
            this.finalCtx = this.canvas.getContext("2d");
            this.ctx = this.canvasBuffer.getContext("2d");
        }
        this.terrainCanvasBuffer = this.game.terrainCanvasBuffer;
    }

    setupConfig(){
        this.projectConfig = this.game.getCollections().configs.game;
        this.gridSize = this.projectConfig.gridSize;
        this.game.uiManager = this;   
    }

    setupElements() {
        this.gameOverMenu = document.getElementById('gameOverMenu');
        this.victoryMenu = document.getElementById('victoryMenu');
        this.overlay = document.getElementById('overlay');
    }

    setupEventListeners() {
        document.getElementById('startGameBtn').removeAttribute('style');
        document.getElementById('startGameBtn').addEventListener('click', (e) => {    
            this.game.state.isPaused = false;
            e.target.setAttribute('style','display:none;');
        });
        document.querySelector("#gameOverMenu .menu-button").addEventListener("click", (e) => {
            this.reset();
        });
        
        document.querySelector("#victoryMenu .menu-button").addEventListener("click", (e) => {
            this.reset();
        });
        this.canvas.addEventListener('mousemove', (e) => {
            this.setMousePosition(e.clientX, e.clientY);
        });
        
        this.canvas.addEventListener('click', (e) => {
       
        });
        
        //right click
        this.canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
        });
    }

    setMousePosition(clientX, clientY) {
        if(!this.game.getCollections().configs.game.is3D) {
            const rect = this.canvas.getBoundingClientRect();
                
            // Account for canvas scaling and offset
            const scaleX = this.canvas.width / rect.width;   // Ratio of canvas pixel width to CSS width
            const scaleY = this.canvas.height / rect.height; // Ratio of canvas pixel height to CSS height
            
            const mapGridWidth = this.game.state.tileMap.length;
            // Calculate mouse position relative to canvas with scaling
            const mouseX = (clientX - rect.left) * scaleX + (this.isometric ? 0 : -( this.canvas.width - mapGridWidth * this.game.getCollections().configs.game.gridSize) / 2);
            const mouseY = (clientY - rect.top) * scaleY + (this.isometric ? 0 : -( this.canvas.height - mapGridWidth * this.game.getCollections().configs.game.gridSize) / 2);

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
                const gridX = Math.floor(intersectPoint.x / this.game.getCollections().configs.game.gridSize);
                const gridY = Math.floor(intersectPoint.z / this.game.getCollections().configs.game.gridSize);
                
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

    reset() {
        this.game.reset();
    }

    draw() {

    }
}