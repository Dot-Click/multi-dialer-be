const fs = require('fs');
const path = require('path');

// Create dist/utils directory if it doesn't exist
const distUtilsDir = path.join(__dirname, '..', 'dist', 'utils');
if (!fs.existsSync(distUtilsDir)) {
  fs.mkdirSync(distUtilsDir, { recursive: true });
}

// Copy api-doc.yaml
const sourceFile = path.join(__dirname, '..', 'src', 'utils', 'api-doc.yaml');
const destFile = path.join(distUtilsDir, 'api-doc.yaml');

if (fs.existsSync(sourceFile)) {
  fs.copyFileSync(sourceFile, destFile);
  console.log('✓ Copied api-doc.yaml to dist/utils/');
} else {
  console.error('✗ Source file not found:', sourceFile);
  process.exit(1);
}

