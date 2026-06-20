#!/usr/bin/env node
/**
 * build.js — Build script for Health Mummy
 * 
 * Reads .env configuration and generates config.js
 * with the actual API key and model settings.
 * 
 * Usage: node build.js
 *        node build.js --env .env.production  (custom env file)
 */

const fs = require('fs');
const path = require('path');

const envFile = process.argv.includes('--env')
  ? process.argv[process.argv.indexOf('--env') + 1]
  : '.env';

const envPath = path.join(__dirname, envFile);
const templatePath = path.join(__dirname, 'config.template.js');
const outputPath = path.join(__dirname, 'config.js');

// Read .env file manually (no dependency needed)
function parseEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    console.warn(`⚠️  Warning: ${filePath} not found.`);
    console.warn(`   Create it from .env.example:\n     cp .env.example .env\n`);
    return {};
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const vars = {};
  
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    
    // Remove surrounding quotes if present
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    
    vars[key] = value;
  }
  
  return vars;
}

// Read template
const template = fs.readFileSync(templatePath, 'utf-8');
const envVars = parseEnv(envPath);

// Replace placeholders
let output = template;
output = output.replace(/__AI_API_KEY__/g, envVars.OPENROUTER_API_KEY || '');
output = output.replace(/__AI_MODEL__/g, envVars.OPENROUTER_MODEL || 'llama-3.3-70b-versatile');

// Write config.js
fs.writeFileSync(outputPath, output, 'utf-8');

console.log(`✅ Generated config.js from ${envFile}`);
console.log(`   Model: ${envVars.OPENROUTER_MODEL || 'llama-3.3-70b-versatile (default)'}`);
console.log(`   API Key: ${envVars.OPENROUTER_API_KEY ? '✓ Set' : '✗ Not set (fallback mode)'}`);
