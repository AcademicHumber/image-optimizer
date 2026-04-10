# image-optimizer

A CLI tool that recursively scans a folder for JPG and PNG images, resizes them to web-appropriate dimensions, and compresses them. Output is written to a sibling folder, preserving the original directory structure.

## Requirements

- Node.js 18.17.0 or higher

## Installation

```bash
npm install
npm run build
```

## Usage

```bash
node dist/index.js <input-dir> [options]
```

Point it at any folder and a sibling `<folder>-optimized` directory will be created next to it:

```
/photos/vacation/          →   /photos/vacation-optimized/
  beach.jpg                      beach.jpg
  portrait.PNG                   portrait.png
  europe/
    paris.jpeg                   europe/paris.jpeg
```

### Options

| Option | Default | Description |
|---|---|---|
| `-q, --jpeg-quality <n>` | `80` | JPEG quality, 1–100 |
| `-p, --png-compression <n>` | `8` | PNG zlib compression level, 0–9 |
| `--max-width <pixels>` | `0` | Resize images to at most this width. `0` disables. |
| `--max-height <pixels>` | `0` | Resize images to at most this height. `0` disables. |
| `--webp` | off | Also output a `.webp` version alongside each image |
| `--no-skip-larger` | off | Write compressed output even if it is larger than the original |
| `--rename` | off | Rename output files sequentially using their parent folder name |

### Examples

```bash
# Basic optimization
node dist/index.js ./my-photos

# Lower quality for aggressive size reduction
node dist/index.js ./my-photos --jpeg-quality 70

# Also generate WebP versions
node dist/index.js ./assets --webp

# Rename files sequentially by folder name
node dist/index.js ./products --rename
# /products/chair.jpg  →  /products-optimized/products-1.jpg
# /products/table.png  →  /products-optimized/products-2.png

# Resize to web dimensions (ecommerce products, etc.)
node dist/index.js ./products --max-width 1200 --max-height 1200
# 6000×6000 → 1200×1200,  6000×4000 → 1200×800  (aspect ratio preserved)
# Images already smaller than the target are left at their original size

# Combine options
node dist/index.js ./images --jpeg-quality 75 --max-width 1200 --webp --rename
```

### During development (no build step)

```bash
npm run dev -- ./my-photos
```

## Configuration file

Create an `optimizer.config.json` in the directory where you run the command to set persistent defaults:

```json
{
  "jpegQuality": 80,
  "pngCompressionLevel": 8,
  "pngQuality": 80,
  "webp": false,
  "skipLargerOutput": true,
  "rename": false,
  "maxWidth": 0,
  "maxHeight": 0
}
```

CLI flags take precedence over the config file.

## How it works

| Format | Encoder | Key settings |
|---|---|---|
| JPEG / JPG | MozJPEG (via libvips) | Quality 80, 4:2:0 chroma subsampling |
| PNG | pngquant palette quantization | Compression level 8, quality 80 |

- All subfolders are scanned recursively.
- Files are processed in parallel (one worker per CPU core).
- When `maxWidth` or `maxHeight` are set, images are resized **before** compression. Aspect ratio is always preserved. Images already smaller than the target dimensions are never upscaled.
- If the compressed output is larger than the original, the original is copied instead (disable with `--no-skip-larger`).
- With `--rename`, files within each folder are sorted alphabetically before numbering, so the order is consistent across runs.

## npm scripts

| Script | Description |
|---|---|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run dev` | Run from source without building |
| `npm start` | Run compiled output |
| `npm run typecheck` | Type-check without emitting files |
