class CanvasUtility {
    constructor() {
        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
		this.ctx.globalCompositeOperation = 'destination-over';// Set the composite operation to preserve transparency
        
		this.tempCanvas = document.createElement('canvas');
        this.tempCtx = this.tempCanvas.getContext('2d', { willReadFrequently: true });
		this.tempCtx.globalCompositeOperation = 'destination-over';// Set the composite operation to preserve transparency
    }

    setSize(width, height) {
        this.canvas.width = width;
        this.canvas.height = height;
    }
    paintTexture(imageData) {
        this.setSize(imageData.width, imageData.height);
        this.ctx.putImageData(imageData, 0, 0);
        return this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    }
	rotateTexture(imageData, angle) {
        // Set the canvas size to accommodate the rotated image
        // Note: If the rotation results in a change in width/height, adjust these values accordingly
        this.setSize(imageData.width, imageData.height);

        // Draw the original imageData to the canvas
        this.ctx.putImageData(imageData, 0, 0);

        // Apply the rotation
        this.ctx.translate(this.canvas.width / 2, this.canvas.height / 2);
        this.ctx.rotate(angle);
        this.ctx.translate(-this.canvas.width / 2, -this.canvas.height / 2);

        // Create a temporary canvas to hold the current state
        this.tempCanvas.width = this.canvas.width;
        this.tempCanvas.height = this.canvas.height;
        this.tempCtx.drawImage(this.canvas, 0, 0);

        // Clear the main canvas and draw the rotated image
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.drawImage(this.tempCanvas, 0, 0);

        // Capture the rotated image data
        let rotatedData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
 

        return rotatedData;
    }
	flipTextureVertical(imageData) {
        this.setSize(imageData.width, imageData.height);

        // Draw the original image data to the canvas
        this.ctx.putImageData(imageData, 0, 0);

        // Use an off-screen canvas to perform the flip
        this.tempCanvas.width = imageData.width;
        this.tempCanvas.height = imageData.height;
  
        // Apply the flip on the off-screen canvas
        this.tempCtx.translate(0, this.tempCanvas.height);
		this.tempCtx.scale(1, -1);
		this.tempCtx.drawImage(this.canvas, 0, 0);

        // Extract the flipped image data
        return this.tempCtx.getImageData(0, 0, this.tempCanvas.width, this.tempCanvas.height);
    }

    flipTextureHorizontal(imageData) {
        this.setSize(imageData.width, imageData.height);

        // Draw the original image data to the canvas
        this.ctx.putImageData(imageData, 0, 0);

        // Use an off-screen canvas to perform the flip
        this.tempCanvas.width = imageData.width;
        this.tempCanvas.height = imageData.height;
        // Apply the flip on the off-screen canvas
		this.tempCtx.translate(this.tempCanvas.width, 0);
		this.tempCtx.scale(-1, 1);
		this.tempCtx.drawImage(this.canvas, 0, 0);

        // Extract the flipped image data
        return this.tempCtx.getImageData(0, 0, this.tempCanvas.width, this.tempCanvas.height);
    }
	drawImage(image) {
        this.setSize(image.width, image.height);
        this.ctx.drawImage(image, 0, 0);
        return this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    }

	rotateImage(image, angle) {
		this.setSize(image.width, image.height);
		// Set up the rotation
		this.ctx.translate(this.canvas.width / 2, this.canvas.height / 2);
		this.ctx.rotate(angle);
		this.ctx.translate(-this.canvas.width / 2, -this.canvas.height / 2);
		this.ctx.fillStyle = 'rgba(0, 0, 0, 0)'; // Fully transparent
		this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
	
		// Draw the image
		this.ctx.drawImage(image, 0, 0);
		return this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
	}

    flipImageVertical(image) {
        this.setSize(image.width, image.height);
        this.ctx.translate(0, this.canvas.height);
        this.ctx.scale(1, -1);
        this.ctx.drawImage(image, 0, 0);
        return this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    }

    flipCanvasVertical() {
        this.ctx.translate(0, this.canvas.height);
        this.ctx.scale(1, -1);
        return this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    }

    flipImageHorizontal(image) {
        this.setSize(image.width, image.height);
        this.ctx.translate(this.canvas.width, 0);
        this.ctx.scale(-1, 1);
        this.ctx.drawImage(image, 0, 0);
        return this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    }
}

export {CanvasUtility }