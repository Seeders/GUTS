class InputManager {
    constructor() {
        this.keys = {};
        this.onInput = null;
        this.lastInputSent = 0;
        this.inputRate = 1000 / 20; // Send input 20 times per second

        this.setupEventListeners();
    }

    setupEventListeners() {
        window.addEventListener('keydown', (e) => {
            this.keys[e.code] = true;
        });

        window.addEventListener('keyup', (e) => {
            this.keys[e.code] = false;
        });
    }

    update() {
        const now = Date.now();
        
        if (now - this.lastInputSent >= this.inputRate) {
            const inputData = {
                keys: {
                    left: this.keys['ArrowLeft'] || this.keys['KeyA'],
                    right: this.keys['ArrowRight'] || this.keys['KeyD'],
                    up: this.keys['ArrowUp'] || this.keys['KeyW'],
                    down: this.keys['ArrowDown'] || this.keys['KeyS']
                }
            };

            // Only send if there's actual input
            if (Object.values(inputData.keys).some(pressed => pressed)) {
                if (this.onInput) {
                    this.onInput(inputData);
                }
            }

            this.lastInputSent = now;
        }
    }
}