# Technical Breakdown

## Technology stack

### Runtime — Node.js

The tool runs on Node.js 18+. Node was chosen because it ships with excellent built-in modules for filesystem operations (`fs`, `path`, `os`) and has first-class support for async/await, which maps naturally onto the concurrent image-processing model. Node's single-threaded event loop does not block on I/O, so multiple sharp operations can be in-flight simultaneously without spawning threads manually.

### Language — TypeScript (strict mode)

All source is TypeScript compiled to CommonJS via `tsup`. Strict mode is enabled, which means no implicit `any`, no unchecked array access without narrowing, and no loose null handling. This matters here because the codebase passes data through several pipeline stages (scan → configure → process → report) and the interfaces between those stages need to be exact.

TypeScript is compiled away entirely at build time — the distributed artifact is plain `dist/index.js`. The type system exists only to catch mistakes during development.

### Build tooling — tsup

`tsup` wraps `esbuild` under the hood. It compiles the entire TypeScript source tree into a single bundled `dist/index.js` in under 100ms. The alternative (`tsc` directly) would produce one `.js` file per source file without bundling, requiring careful module resolution at runtime. A single-file bundle is simpler to distribute and link as a CLI binary.

Configuration lives in `tsup.config.ts`:
- Target: `node18` — enables modern JS features without polyfills
- Format: `cjs` — CommonJS, chosen because `sharp` and `chalk@4` are both CommonJS packages; mixing ESM and CJS on Windows requires extra configuration that adds no value here

### Image processing — sharp

`sharp` is the core of the tool. It wraps `libvips`, a C library for image processing, through a native Node.js addon. Because the actual pixel work happens in compiled C code rather than JavaScript, it is significantly faster and more memory-efficient than pure-JS alternatives.

Two encoders are used:

**MozJPEG** (for `.jpg` / `.jpeg`)  
MozJPEG is Mozilla's fork of the standard libjpeg encoder. It uses more aggressive Huffman coding and trellis quantization to produce smaller files at the same perceptual quality. It is bundled inside sharp's libvips build — no separate install. Enabled with `mozjpeg: true` in the sharp JPEG options.

**pngquant** (for `.png`)  
pngquant is a lossy PNG compressor that reduces a 24-bit (or 32-bit) PNG to an 8-bit palette image. For images that do not require full color depth — icons, diagrams, screenshots, UI elements — this typically reduces file size by 60–80% with no perceptible quality loss. For images that genuinely need full color, libvips falls back gracefully to lossless compression. Enabled with `palette: true` in the sharp PNG options.

`sharp` is listed as a production dependency (not devDependency) because it contains a native binary that must be present at runtime. During `npm install`, sharp downloads a prebuilt binary for the current platform and Node version.

### CLI parsing — commander

`commander` handles argument and option parsing. It provides `--help` and `--version` for free, validates that required arguments are present, and produces typed option objects. The alternative — parsing `process.argv` manually — would require duplicating all of that.

### Terminal output — chalk + cli-progress

`chalk@4` (the last CJS-compatible version) adds color to terminal output. Colors are used semantically: green for success, yellow for warnings/skips, red for errors, dim for secondary information.

`cli-progress` renders a live progress bar during processing. The bar uses `clearOnComplete: true` so it disappears when done, leaving only the per-file result lines in the terminal history.

---

## Pipeline: from folder to optimized images

Here is the complete data flow from a user command to a finished output folder.

### Stage 1 — CLI parsing (`src/index.ts`)

When the user runs:
```
node dist/index.js ./photos --jpeg-quality 75 --rename
```

Commander parses the arguments and options into a typed object. `index.ts` then:

1. Resolves the input path to an absolute path with `path.resolve`.
2. Derives the output path by appending `-optimized` to the input path string.
3. Maps CLI option values into a `Partial<OptimizerConfig>` override object.

The output path derivation is intentionally simple — string concatenation on the absolute path — so the output is always a sibling of the input regardless of how the user passed the path (relative, absolute, with trailing slash, etc.).

### Stage 2 — Configuration (`src/config.ts`)

`loadConfig(overrides)` produces a complete, validated `OptimizerConfig` by merging three layers:

```
built-in DEFAULTS
    ↓  overridden by
optimizer.config.json  (read from cwd if present)
    ↓  overridden by
CLI flags
```

The spread merge is a single expression:
```ts
const merged = { ...DEFAULTS, ...fileConfig, ...overrides };
```

After merging, numeric fields are clamped to valid ranges (`jpegQuality` to 1–100, `pngCompressionLevel` to 0–9). If a value is out of range a warning is printed and the value is clamped rather than erroring, so the tool degrades gracefully.

### Stage 3 — Scanning (`src/scanner.ts`)

`scan(inputDir, outputDir, config)` walks the input directory tree and returns a flat array of `ImageTask` objects. Each task is a plain data object describing exactly one file to process:

```ts
interface ImageTask {
  inputPath: string;   // absolute path to source file
  outputPath: string;  // absolute path where output should be written
  ext: string;         // lowercase extension: '.jpg', '.jpeg', '.png'
  displayPath: string; // relative path shown in terminal output
}
```

**How the walk works**

The scanner uses a recursive helper `collectFiles` that calls `fs.readdirSync` with `{ withFileTypes: true }` on each directory. The `withFileTypes` flag returns `Dirent` objects that already know whether each entry is a file or directory, avoiding a second `stat` call per entry.

Files are filtered by extension using a `Set` lookup (`O(1)`):
```ts
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png']);
```
Extensions are lowercased before the lookup so `.JPG`, `.PNG`, `.JPEG` (common from cameras) are all matched.

**How output paths are computed**

For each file, the output path is derived by:
1. Computing the relative path of the file's containing directory from the input root.
2. Joining that relative path onto the output root.
3. Appending the output filename.

This preserves the directory structure exactly. A file at `photos/europe/paris.jpg` produces an output path of `photos-optimized/europe/paris.jpg`.

**Grouping for rename mode**

Files are collected into a `Map<string, FileEntry[]>` keyed by their containing directory. This grouping is what enables the `--rename` feature: within each directory, files are sorted alphabetically and assigned sequential numbers. Without the grouping, sequential numbering across a flat list would mix files from different subdirectories.

When `config.rename` is true, the output filename becomes `<folderName>-<n><ext>` where `n` starts at 1. When false, the original filename is preserved.

### Stage 4 — Concurrent processing (`src/index.ts` + `src/optimizer.ts`)

After scanning, `index.ts` holds an array of `ImageTask` objects and passes it to `processWithConcurrency`.

**The concurrency model**

Processing images is CPU and I/O bound. Running them one at a time would leave CPU cores idle while waiting on disk. Running all of them at once on a large directory would exhaust memory and thrash the disk. The solution is a bounded worker-queue pattern:

```ts
async function processWithConcurrency(tasks, config, concurrency, onComplete) {
  const results: ProcessResult[] = [];
  const queue = [...tasks];         // mutable shared queue

  async function worker() {
    while (queue.length > 0) {
      const task = queue.shift();   // claim the next task
      const result = await processImage(task, config);
      results.push(result);
      onComplete(result);           // update progress bar
    }
  }

  // Spawn N workers, all sharing the same queue
  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length) }, worker)
  );
  return results;
}
```

The number of concurrent workers is `os.cpus().length` — one per logical CPU core. Each worker loops until the shared queue is empty. Because JavaScript is single-threaded, `queue.shift()` is atomic — there is no race condition on claiming tasks even though multiple async workers are running.

`Promise.all` waits for every worker to finish before returning. Workers that finish early (because they claimed more tasks that happened to be fast) simply exit their loop and resolve, while slower workers continue. This self-balancing property is why a queue outperforms fixed batching: a fixed batch of N files per worker can stall if one batch gets all the large files.

**Per-file processing (`src/optimizer.ts`)**

`processImage(task, config)` handles one file. It never throws — all errors are caught and returned as a `ProcessResult` with an `error` field. This is essential for the concurrency loop: a single corrupt file should not abort the remaining queue.

The steps for each file:

1. Read input file size from `fs.statSync` before processing.
2. Create the output directory with `fs.mkdirSync(..., { recursive: true })`. This is idempotent and handles nested paths that do not exist yet.
3. Run the sharp pipeline for the file's format (JPEG or PNG).
4. If `config.webp` is true, run a second sharp pipeline to produce a `.webp` sibling.
5. Read output file size after writing.
6. If output ≥ input and `skipLargerOutput` is enabled, overwrite the output with a copy of the original. This ensures the output folder never contains a file larger than its source.
7. Return a `ProcessResult` with both sizes, whether it was skipped, and any error.

On error: the partial output file is deleted with `fs.rmSync({ force: true })` before returning. `force: true` suppresses the error if the file was never created.

### Stage 5 — Reporting (`src/reporter.ts`)

All terminal output is isolated in `reporter.ts`. No other module calls `console.log`. This separation means the processing logic in `optimizer.ts` and `scanner.ts` is pure and testable without capturing stdout.

The reporting sequence:

1. **`printHeader`** — called before processing starts. Shows input path, output path, and file count.
2. **Progress bar** — live-updated during processing via the `onComplete` callback passed into `processWithConcurrency`. The bar shows percentage, file counts, and the name of the last completed file. It clears itself when done (`clearOnComplete: true`).
3. **`printFileResult`** — called once per file after the progress bar stops. Prints a single line per file: a checkmark and size delta for successes, a tilde for skipped files, a cross for errors.
4. **`printSummary`** — final block with aggregate stats: total files, success/skip/fail counts, total input size, total output size, and total space saved as both an absolute byte count and a percentage.

---

## Data flow diagram

```
User command
     │
     ▼
index.ts — parse CLI args
     │
     ▼
config.ts — merge DEFAULTS + optimizer.config.json + CLI flags
     │
     ▼
scanner.ts — walk input dir, group by folder, build ImageTask[]
     │
     ├─────────────────────────────────────────┐
     ▼                                         │
processWithConcurrency                         │
  ├── worker 1 ──► optimizer.ts ──► ProcessResult
  ├── worker 2 ──► optimizer.ts ──► ProcessResult
  ├── worker N ──► optimizer.ts ──► ProcessResult
  └── (shared queue, self-balancing)           │
                                               │
     ◄─────────────────────────────────────────┘
     │  ProcessResult[]
     ▼
reporter.ts — print per-file lines + summary
```

---

## Why not worker threads or child processes?

Node.js worker threads (`worker_threads`) and child processes (`child_process`) are the standard way to achieve true parallelism in Node. They are not used here for two reasons:

1. **sharp is already parallel internally.** libvips uses its own thread pool for pixel operations. A single `sharp().jpeg().toFile()` call already uses multiple CPU threads under the hood. Wrapping each call in a worker thread would create thread contention rather than reduce it.

2. **The bottleneck is I/O, not JS.** The JavaScript code between sharp calls is minimal — a few path joins and stat calls. The actual time is spent inside libvips and waiting on disk. Async/await is sufficient to keep the disk busy across multiple files without adding the overhead of inter-thread communication.

The result is that the async worker-queue approach matches or exceeds the throughput of a worker-thread implementation for this workload, at a fraction of the code complexity.
