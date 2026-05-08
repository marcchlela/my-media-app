const fs = require('fs');
const path = require('path');

// path to the JSON library
const libraryPath = path.join(__dirname, 'library.json');

// read library
function readLibrary() {
  try {
    if (!fs.existsSync(libraryPath)) return [];
    const data = fs.readFileSync(libraryPath, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error reading library:', err);
    return [];
  }
}

// write library
function writeLibrary(items) {
  try {
    fs.writeFileSync(libraryPath, JSON.stringify(items, null, 2));
  } catch (err) {
    console.error('Error writing library:', err);
  }
}

module.exports = { readLibrary, writeLibrary };
