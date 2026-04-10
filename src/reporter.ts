import chalk from 'chalk';
import cliProgress from 'cli-progress';
import type { ProcessResult, SummaryStats } from './types';

export function printHeader(inputDir: string, outputDir: string, fileCount: number): void {
  console.log('');
  console.log(chalk.bold('Image Optimizer'));
  console.log(chalk.dim('─'.repeat(50)));
  console.log(`  Input  : ${chalk.cyan(inputDir)}`);
  console.log(`  Output : ${chalk.cyan(outputDir)}`);
  console.log(`  Files  : ${chalk.yellow(String(fileCount))} image(s) found`);
  console.log(chalk.dim('─'.repeat(50)));
  console.log('');
}

export function createProgressBar(total: number): cliProgress.SingleBar {
  return new cliProgress.SingleBar(
    {
      format: `  {bar} {percentage}% | {value}/{total} | {filename}`,
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true,
      clearOnComplete: true,
    },
    cliProgress.Presets.shades_classic
  );
}

export function printFileResult(result: ProcessResult): void {
  if (result.error) {
    console.log(
      `  ${chalk.red('✗')} ${chalk.dim(result.task.displayPath)} — ${chalk.red(result.error.message)}`
    );
    return;
  }

  const saved = result.inputBytes - result.outputBytes;
  const pct = result.inputBytes > 0 ? Math.round((saved / result.inputBytes) * 100) : 0;
  const inStr = formatBytes(result.inputBytes);
  const outStr = formatBytes(result.outputBytes);

  if (result.skipped) {
    console.log(
      `  ${chalk.yellow('~')} ${chalk.dim(result.task.displayPath)}` +
        chalk.dim(` — kept original (${inStr}, output was larger)`)
    );
  } else {
    const savingStr = chalk.green(`-${pct}%`);
    console.log(
      `  ${chalk.green('✓')} ${result.task.displayPath}` +
        chalk.dim(`  ${inStr} → ${outStr} (${savingStr}${chalk.dim(')')}`)
    );
  }
}

export function printSummary(stats: SummaryStats, elapsedMs: number): void {
  const totalSaved = stats.totalInputBytes - stats.totalOutputBytes;
  const pct =
    stats.totalInputBytes > 0
      ? Math.round((totalSaved / stats.totalInputBytes) * 100)
      : 0;
  const elapsed = (elapsedMs / 1000).toFixed(1);

  console.log('');
  console.log(chalk.dim('─'.repeat(50)));
  console.log(chalk.bold(`  Optimization complete`) + chalk.dim(` in ${elapsed}s`));
  console.log(chalk.dim('─'.repeat(50)));
  console.log(`  Files processed : ${stats.total}`);
  console.log(`  Files succeeded : ${chalk.green(String(stats.succeeded))}`);
  if (stats.skipped > 0) {
    console.log(`  Files skipped   : ${chalk.yellow(String(stats.skipped))}  (output was larger)`);
  }
  if (stats.failed > 0) {
    console.log(`  Files failed    : ${chalk.red(String(stats.failed))}`);
  }
  console.log(`  Total input     : ${formatBytes(stats.totalInputBytes)}`);
  console.log(`  Total output    : ${formatBytes(stats.totalOutputBytes)}`);
  console.log(
    `  Space saved     : ${chalk.green(formatBytes(totalSaved))} ${chalk.green(`(${pct}%)`)}`
  );
  console.log(chalk.dim('─'.repeat(50)));
  console.log('');
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / 1024).toFixed(1)} KB`;
}
