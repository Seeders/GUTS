const { join } = require("path");

console.log("Puppeteer config loaded");
console.log("Puppeteer cache directory:", join(__dirname, ".cache", "puppeteer"));


module.exports = {
  // Changes the cache location for Puppeteer.
  cacheDirectory: join(__dirname, ".cache", "puppeteer"),
};