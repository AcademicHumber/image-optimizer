export interface OptimizerConfig {
  jpegQuality: number;
  pngCompressionLevel: number;
  pngQuality: number;
  webp: boolean;
  skipLargerOutput: boolean;
  rename: boolean;
}

export interface ImageTask {
  inputPath: string;
  outputPath: string;
  ext: string;
  /** Relative display path (relative to input root) */
  displayPath: string;
}

export interface ProcessResult {
  task: ImageTask;
  inputBytes: number;
  outputBytes: number;
  /** true if skipLargerOutput triggered and original was copied instead */
  skipped: boolean;
  error?: Error;
}

export interface SummaryStats {
  total: number;
  succeeded: number;
  skipped: number;
  failed: number;
  totalInputBytes: number;
  totalOutputBytes: number;
}
