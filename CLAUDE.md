# CLAUDE.md

## Project overview

Node.js CLI tool that recursively resizes and compresses JPG/PNG images for web. Takes an input folder, writes optimized images to a sibling `<folder>-optimized` directory, preserving directory structure.

## Build & run commands

```bash
npm run build       # compile TypeScript → dist/index.js (via tsup)
npm run dev -- <dir> # run from source without building (tsx)
npm run typecheck   # type-check without emitting
node dist/index.js <input-dir> [options]
```

Always run `npm run build` after editing source files before testing with `node dist/`.

## Architecture

Each module has a single responsibility — keep them that way:

| File | Responsibility |
|---|---|
| `src/types.ts` | All shared interfaces. Every other module imports from here. |
| `src/config.ts` | Loads `optimizer.config.json` from cwd, merges with defaults, validates ranges. |
| `src/scanner.ts` | Recursive folder walk. Groups files by directory for rename numbering. Returns `ImageTask[]`. |
| `src/optimizer.ts` | Calls sharp per file. Handles resize, skip-larger-output logic, and WebP output. Returns `ProcessResult`. |
| `src/reporter.ts` | All terminal I/O (header, progress bar, per-file lines, summary). No console calls anywhere else. |
| `src/index.ts` | CLI entry point. Wires commander → config → scan → concurrency loop → report. |

## Key design decisions

**Output path:** `inputDir + '-optimized'` — always a sibling of the input, never inside it. Computed in `index.ts:37`.

**Concurrency:** Manual worker-queue pattern in `processWithConcurrency` (`index.ts:107`). Runs `os.cpus().length` workers. No external concurrency library.

**JPEG compression:** MozJPEG encoder (`mozjpeg: true`) in `optimizer.ts:19`. This flag is the main source of size reduction — do not remove it.

**PNG compression:** `palette: true` triggers pngquant-style quantization in `optimizer.ts:27`. Combined with `quality` and `effort: 10`.

**Resize:** Applied before encoding via sharp's `.resize()` with `fit: 'inside'` and `withoutEnlargement: true` (`optimizer.ts`). Only runs when `maxWidth > 0` or `maxHeight > 0`. Both dimensions are optional — setting only one scales the other proportionally. Images smaller than the target are never upscaled.

**Rename numbering:** Files within each directory are sorted alphabetically before assigning numbers (`scanner.ts:26`). This keeps numbering deterministic across runs.

**Skip-larger-output:** After writing, byte sizes are compared. If output ≥ input, the original is copied to the output path instead (`optimizer.ts:47`). The `outputBytes` in the result is set to `inputBytes` so the summary math stays correct.

**Config precedence:** CLI flags → `optimizer.config.json` → built-in defaults. Merging happens in `config.ts:loadConfig`.

## Adding a new output format

1. Add the option to `OptimizerConfig` in `src/types.ts`.
2. Add a default value in `src/config.ts` (`DEFAULTS`).
3. Add the sharp pipeline in `src/optimizer.ts` (follow the WebP pattern). Apply `resizeOptions` to the new pipeline the same way as JPEG/PNG/WebP.
4. Add the CLI flag in `src/index.ts` and wire it into `configOverrides`.

## Adding a new CLI option

1. Add the field to `OptimizerConfig` in `src/types.ts`.
2. Add a default in `src/config.ts`.
3. Register the option in `src/index.ts` with `.option(...)` and map it into `configOverrides`.

## sharp notes

- `sharp` has a native binary — after `npm install` it downloads a platform-specific prebuilt. Do not move `node_modules/sharp` manually.
- `mozjpeg: true` is built into sharp's libvips bundle — no separate mozjpeg install needed.
- `palette: true` on PNG enables lossy quantization. Removing it makes PNG compression lossless-only and significantly less effective on photos.
- WebP quality uses `config.jpegQuality` as a proxy — adjust if independent WebP quality control is needed.
- Resize uses `fit: 'inside'` — this preserves aspect ratio and never crops. Do not change to `cover` or `fill` without understanding the cropping implications.
- `withoutEnlargement: true` on resize is intentional — never remove it. Without it, images smaller than `maxWidth`/`maxHeight` would be upscaled, increasing file size.

## What not to do

- Do not add `console.log` calls outside `src/reporter.ts`.
- Do not throw inside `processImage` — it returns a `ProcessResult` with an `error` field so the concurrency loop can continue processing remaining files.
- Do not change the output directory naming convention (`inputDir + '-optimized'`) without updating the README and TECHNICAL docs.
- Do not move the `.resize()` call to after the format encoder — sharp chains are ordered and resize must come first.
- `chalk` is pinned to v4 for CommonJS compatibility. Do not upgrade to v5+ without converting the project to ESM.
