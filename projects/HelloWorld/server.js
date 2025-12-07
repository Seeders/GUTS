const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files from dist/client
app.use(express.static(path.join(__dirname, 'dist', 'client')));

// Serve resources
app.use('/resources', express.static(path.join(__dirname, 'resources')));

// Fallback to index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'client', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`HelloWorld server running at http://localhost:${PORT}`);
});
