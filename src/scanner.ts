import fs from 'fs';
import path from 'path';
import type { ImageTask, OptimizerConfig } from './types';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png']);

export function scan(inputDir: string, outputDir: string, config: OptimizerConfig): ImageTask[] {
  if (!fs.existsSync(inputDir)) {
    throw new Error(`Directory not found: ${inputDir}`);
  }
  if (!fs.statSync(inputDir).isDirectory()) {
    throw new Error(`Path is a file, not a directory: ${inputDir}`);
  }
  if (path.resolve(inputDir) === path.resolve(outputDir)) {
    throw new Error('Input and output directories cannot be the same.');
  }

  // Collect all image files grouped by their containing directory
  const byDir = new Map<string, { absPath: string; ext: string }[]>();
  collectFiles(inputDir, byDir);

  const tasks: ImageTask[] = [];

  for (const [dir, files] of byDir) {
    // Sort alphabetically for deterministic rename numbering
    const sorted = [...files].sort((a, b) =>
      path.basename(a.absPath).localeCompare(path.basename(b.absPath))
    );

    // Compute the output directory for this group
    const relDir = path.relative(inputDir, dir);
    const outDir = relDir ? path.join(outputDir, relDir) : outputDir;
    const folderName = path.basename(dir);

    sorted.forEach((file, i) => {
      const relPath = path.relative(inputDir, file.absPath);
      let outFilename: string;

      if (config.rename) {
        outFilename = `${folderName}-${i + 1}${file.ext}`;
      } else {
        outFilename = path.basename(file.absPath);
      }

      tasks.push({
        inputPath: file.absPath,
        outputPath: path.join(outDir, outFilename),
        ext: file.ext,
        displayPath: relPath,
      });
    });
  }

  return tasks;
}

function collectFiles(
  dir: string,
  result: Map<string, { absPath: string; ext: string }[]>
): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  const images: { absPath: string; ext: string }[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(fullPath, result);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (IMAGE_EXTENSIONS.has(ext)) {
        images.push({ absPath: fullPath, ext });
      }
    }
  }

  if (images.length > 0) {
    result.set(dir, images);
  }
}
