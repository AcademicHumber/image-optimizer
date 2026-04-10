import fs from 'fs';
import path from 'path';
import type { OptimizerConfig } from './types';

const DEFAULTS: OptimizerConfig = {
  jpegQuality: 80,
  pngCompressionLevel: 8,
  pngQuality: 80,
  webp: false,
  skipLargerOutput: true,
  rename: false,
  maxWidth: 0,
  maxHeight: 0,
};

export function loadConfig(overrides: Partial<OptimizerConfig> = {}): OptimizerConfig {
  let fileConfig: Partial<OptimizerConfig> = {};

  const configPath = path.join(process.cwd(), 'optimizer.config.json');
  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, 'utf-8');
      fileConfig = JSON.parse(raw) as Partial<OptimizerConfig>;
    } catch {
      console.warn('Warning: optimizer.config.json is malformed — using defaults.');
    }
  }

  const merged: OptimizerConfig = { ...DEFAULTS, ...fileConfig, ...overrides };

  // Clamp ranges
  merged.jpegQuality = clamp(merged.jpegQuality, 1, 100, 'jpegQuality');
  merged.pngQuality = clamp(merged.pngQuality, 1, 100, 'pngQuality');
  merged.pngCompressionLevel = clamp(merged.pngCompressionLevel, 0, 9, 'pngCompressionLevel');
  merged.maxWidth = clamp(merged.maxWidth, 0, 100000, 'maxWidth');
  merged.maxHeight = clamp(merged.maxHeight, 0, 100000, 'maxHeight');

  return merged;
}

function clamp(value: number, min: number, max: number, name: string): number {
  if (value < min || value > max) {
    console.warn(`Warning: ${name} value ${value} out of range [${min}-${max}], clamping.`);
    return Math.min(max, Math.max(min, value));
  }
  return value;
}
