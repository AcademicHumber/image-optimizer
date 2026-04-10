import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import type { ImageTask, OptimizerConfig, ProcessResult } from './types';

export async function processImage(
  task: ImageTask,
  config: OptimizerConfig
): Promise<ProcessResult> {
  const inputBytes = fs.statSync(task.inputPath).size;

  // Ensure output directory exists
  fs.mkdirSync(path.dirname(task.outputPath), { recursive: true });

  try {
    const isJpeg = task.ext === '.jpg' || task.ext === '.jpeg';

    if (isJpeg) {
      await sharp(task.inputPath)
        .jpeg({
          quality: config.jpegQuality,
          mozjpeg: true,
          chromaSubsampling: '4:2:0',
        })
        .toFile(task.outputPath);
    } else {
      await sharp(task.inputPath)
        .png({
          compressionLevel: config.pngCompressionLevel,
          quality: config.pngQuality,
          effort: 10,
          palette: true,
        })
        .toFile(task.outputPath);
    }

    if (config.webp) {
      const webpPath = task.outputPath.replace(/\.[^.]+$/, '.webp');
      await sharp(task.inputPath)
        .webp({ quality: config.jpegQuality, effort: 6 })
        .toFile(webpPath);
    }

    const outputBytes = fs.statSync(task.outputPath).size;

    // If output is larger than original and skipLargerOutput is set, copy original
    if (config.skipLargerOutput && outputBytes >= inputBytes) {
      fs.copyFileSync(task.inputPath, task.outputPath);
      return { task, inputBytes, outputBytes: inputBytes, skipped: true };
    }

    return { task, inputBytes, outputBytes, skipped: false };
  } catch (err) {
    // Clean up partial output
    try {
      fs.rmSync(task.outputPath, { force: true });
    } catch {
      // ignore cleanup errors
    }
    return {
      task,
      inputBytes,
      outputBytes: 0,
      skipped: false,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}
