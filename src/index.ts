#!/usr/bin/env node
import os from 'os';
import path from 'path';
import chalk from 'chalk';
import { Command } from 'commander';
import { loadConfig } from './config';
import { processImage } from './optimizer';
import {
  createProgressBar,
  printFileResult,
  printHeader,
  printSummary,
} from './reporter';
import { scan } from './scanner';
import type { ImageTask, OptimizerConfig, ProcessResult, SummaryStats } from './types';

const program = new Command();

program
  .name('image-optimizer')
  .description('Recursively optimize JPG and PNG images for web')
  .version('1.0.0')
  .argument('<input-dir>', 'Path to folder containing images')
  .option('-q, --jpeg-quality <number>', 'JPEG quality 1-100', '80')
  .option('-p, --png-compression <number>', 'PNG zlib compression level 0-9', '8')
  .option('--webp', 'Also output .webp versions alongside each image')
  .option('--no-skip-larger', 'Keep compressed output even if larger than original')
  .option(
    '--rename',
    'Rename output files as <folder-name>-1, <folder-name>-2, … (sorted alphabetically)'
  )
  .option('--max-width <pixels>', 'Resize images to at most this width (0 = disabled)', '0')
  .option('--max-height <pixels>', 'Resize images to at most this height (0 = disabled)', '0')
  .parse();

async function main(): Promise<void> {
  const opts = program.opts();
  const inputDir = path.resolve(program.args[0]);
  const outputDir = inputDir + '-optimized';

  const configOverrides: Partial<OptimizerConfig> = {};
  if (opts.jpegQuality !== undefined) configOverrides.jpegQuality = parseInt(opts.jpegQuality, 10);
  if (opts.pngCompression !== undefined)
    configOverrides.pngCompressionLevel = parseInt(opts.pngCompression, 10);
  if (opts.webp) configOverrides.webp = true;
  // commander --no-skip-larger sets opts.skipLarger = false
  if (opts.skipLarger === false) configOverrides.skipLargerOutput = false;
  if (opts.rename) configOverrides.rename = true;
  if (opts.maxWidth !== '0') configOverrides.maxWidth = parseInt(opts.maxWidth, 10);
  if (opts.maxHeight !== '0') configOverrides.maxHeight = parseInt(opts.maxHeight, 10);

  const config = loadConfig(configOverrides);

  let tasks: ImageTask[];
  try {
    tasks = scan(inputDir, outputDir, config);
  } catch (err) {
    console.error(chalk.red(`Error: ${(err as Error).message}`));
    process.exit(1);
  }

  if (tasks.length === 0) {
    console.log(chalk.yellow('No .jpg/.jpeg/.png files found in the specified directory.'));
    process.exit(0);
  }

  printHeader(inputDir, outputDir, tasks.length);

  const startTime = Date.now();
  const bar = createProgressBar(tasks.length);
  bar.start(tasks.length, 0, { filename: '' });

  const results = await processWithConcurrency(tasks, config, os.cpus().length, (result) => {
    bar.increment(1, { filename: result.task.displayPath });
  });

  bar.stop();

  // Print per-file results after progress bar is done
  for (const result of results) {
    printFileResult(result);
  }

  const stats: SummaryStats = {
    total: results.length,
    succeeded: 0,
    skipped: 0,
    failed: 0,
    totalInputBytes: 0,
    totalOutputBytes: 0,
  };

  for (const r of results) {
    if (r.error) {
      stats.failed++;
    } else if (r.skipped) {
      stats.skipped++;
      stats.succeeded++;
      stats.totalInputBytes += r.inputBytes;
      stats.totalOutputBytes += r.outputBytes;
    } else {
      stats.succeeded++;
      stats.totalInputBytes += r.inputBytes;
      stats.totalOutputBytes += r.outputBytes;
    }
  }

  printSummary(stats, Date.now() - startTime);
}

async function processWithConcurrency(
  tasks: ImageTask[],
  config: OptimizerConfig,
  concurrency: number,
  onComplete: (result: ProcessResult) => void
): Promise<ProcessResult[]> {
  const results: ProcessResult[] = [];
  const queue = [...tasks];

  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const task = queue.shift()!;
      const result = await processImage(task, config);
      results.push(result);
      onComplete(result);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results;
}

main().catch((err: Error) => {
  console.error(chalk.red(`Fatal: ${err.message}`));
  process.exit(1);
});
