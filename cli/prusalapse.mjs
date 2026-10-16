import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import { execSync } from 'child_process';
import { parseGcode } from '../webapp/app/components/gcodeParser.js';

// Get current directory for ES module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. Get input file from PrusaSlicer (passed as the first argument)
const inputFile = process.argv[2];
if (!inputFile) {
  console.error("Error: No G-code file specified.");
  console.error("Usage: node prusalapse.mjs <path-to-gcode-file>");
  process.exit(1);
}

if (!fs.existsSync(inputFile)) {
  console.error(`Error: File not found: ${inputFile}`);
  process.exit(1);
}

// Check if it's a binary G-code file by reading the first 4 bytes (magic header "GCDE")
let isBinary = false;
try {
  const fd = fs.openSync(inputFile, 'r');
  const magic = Buffer.alloc(4);
  fs.readSync(fd, magic, 0, 4, 0);
  fs.closeSync(fd);
  if (magic.toString('utf8') === 'GCDE' || inputFile.toLowerCase().endsWith('.bgcode')) {
    isBinary = true;
  }
} catch (e) {}

if (isBinary) {
  const errMsg = "ERROR: Prusa-lapse cannot process Binary G-code (.bgcode). Please disable 'Supports binary G-code' in PrusaSlicer under Printer Settings -> General -> Advanced.";
  console.error("===================================================================");
  console.error(errMsg);
  console.error("===================================================================");
  
  if (process.platform === 'win32' && !process.env.NO_GUI) {
    try {
      execSync(`powershell.exe -WindowStyle Hidden -Command "Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('${errMsg}', 'Prusa-lapse Error', 'OK', 'Error')"`);
    } catch(e) {}
  }
  
  process.exit(1);
}

// 2. Load configuration
const configPath = path.join(__dirname, 'config.json');
let config = {};
try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (err) {
  console.warn(`Warning: Could not load config.json, using defaults. Error: ${err.message}`);
  config = {
    triggerType: "snap",
    qualityMode: "balanced",
    parkX: 10,
    parkY: 200,
    travelSpeed: 4800,
    retractDistance: 1.5,
    retractSpeed: 2400,
    settleTime: 300,
    captureTime: 600,
    zHopHeight: 0.4
  };
}

const { triggerType, qualityMode, parkX, parkY, travelSpeed, retractDistance, retractSpeed, settleTime, captureTime, zHopHeight, triggerSignal = 'm220' } = config;
const zHopSpeed = 600; // Hardcoded 10mm/s

console.log(`[Prusa-lapse] Processing file: ${inputFile}`);
console.log(`[Prusa-lapse] Using trigger mode: ${triggerType}`);

// 3. Read and Parse G-code
const gcodeText = fs.readFileSync(inputFile, 'utf8');
const { newGcode, layersModified } = parseGcode(gcodeText, config);
fs.writeFileSync(inputFile, newGcode, 'utf8');
console.log(`[Prusa-lapse] Finished! Modified ${layersModified} layers.`);