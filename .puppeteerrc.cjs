const { join } = require("path");

console.log("Puppeteer config loaded");
console.log("Puppeteer cache directory:", join(__dirname, ".cache", "puppeteer"));

if(!__dirname.startsWith("C:")){
  module.exports = {
    // Changes the cache location for Puppeteer.
    cacheDirectory: join(__dirname, ".cache", "puppeteer"),
  };
}