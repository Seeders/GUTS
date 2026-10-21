const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

// index.html loads ./dist/client/game.js, so serve the project folder itself.
// Keep source and tooling private.
app.use(/^\/(collections|node_modules|package(-lock)?\.json|server\.js)/, (req, res) => res.sendStatus(404));
app.use(express.static(__dirname));

app.listen(PORT, () => console.log(`__TITLE__ at http://localhost:${PORT}/`));
