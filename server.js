const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const app = express();

// Increase the limit for JSON payloads (e.g., 10MB)
app.use(express.json({ limit: '10mb' }));

// Serve static files from the current directory
app.use(express.static(path.join(__dirname)));

// Endpoint to save the config
app.post('/save-config', async (req, res) => {
    const config = req.body;
    const filePath = path.join(__dirname, '/config/game_config.json');

    try {
        await fs.writeFile(filePath, JSON.stringify(config, null, 2), 'utf8');
        res.status(200).send('Config saved successfully!');
    } catch (error) {
        console.error('Error saving config:', error);
        res.status(500).send('Error saving config');
    }
});

// Start the server
const PORT = 5000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});