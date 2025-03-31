const express = require('express');
const fs = require('fs').promises;
const multer = require('multer');
const path = require('path');
const app = express();
const upload = multer({ dest: 'uploads/' });
const MODELS_DIR = path.join(__dirname, 'samples/models');

// Increase the limit for JSON payloads (e.g., 10MB)
app.use(express.json({ limit: '10mb' }));

// Serve static files from the current directory
app.use(express.static(path.join(__dirname, '/')));

// Endpoint to save the config
app.post('/save-config', async (req, res) => {
    const config = req.body;
    const filePath1 = path.join(__dirname, '/config/default_app_config.js');
    const filePath2 = path.join(__dirname, '/config/game_td_config.js');

    try {
        await fs.writeFile(filePath1, "const DEFAULT_PROJECT_CONFIG = " + JSON.stringify(config, null, 2) + "; \n\n export { DEFAULT_PROJECT_CONFIG };", 'utf8');
        await fs.writeFile(filePath2, "const TOWER_DEFENSE_CONFIG = " + JSON.stringify(config, null, 2) + "; \n\n export { TOWER_DEFENSE_CONFIG };", 'utf8');
        res.status(200).send('Config saved successfully!');
    } catch (error) {
        console.error('Error saving config:', error);
        res.status(500).send('Error saving config');
    }
});

app.post('/upload-model', upload.single('gltfFile'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded.' });
        }
        if (!req.file.originalname.endsWith('.gltf')) {
            return res.status(400).json({ error: `Uploaded file "${req.file.originalname}" is not a .gltf file.` });
        }

        // Read and parse the uploaded .gltf file
        const gltfPath = path.join(__dirname, req.file.path);
        const gltfContent = await fs.readFile(gltfPath, 'utf8');
        const gltfData = JSON.parse(gltfContent);

        // Extract the model name from the uploaded filename
        const modelName = path.basename(req.file.originalname, '.gltf');
        const modelFolder = path.join(MODELS_DIR, modelName);

        // Get the relative path from the client (or fallback to a constructed one)
        const relativePath = req.body.relativePath || `/samples/models/${modelName}/${req.file.originalname}`;

        // Create the game data JSON object
        const gameData = {
            metadata: {
                name: `${modelName} Model`,
                uploaded: new Date().toISOString()
            },
            relativePath: relativePath, // Return the relative path
            fileName: req.file.originalname,
            tempPath: req.file.path // Temporary path for debugging (optional)
        };

        // Clean up the uploaded file
        await fs.unlink(gltfPath);

        // Send the result
        res.json(gameData);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});
// Start the server
const PORT = 5000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});