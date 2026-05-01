# Sprite Video Lab

Sprite Video Lab is a local web tool for turning video clips or still images into clean 2D sprite assets.

It is designed for workflows like:

- import a local video or image
- trim the useful frame range
- extract frames at a fixed cadence
- remove solid-color backgrounds or AI-generated backgrounds
- keep animated glow/VFX with a luminance matte
- normalize frame size and ground alignment
- export transparent PNG frames, a sprite sheet, a manifest, and a zip package

The project is Windows-first, but the server and app are intentionally lightweight: Python, Pillow, ffmpeg, and vanilla HTML/CSS/JavaScript.

## Features

- Local path import and drag-and-drop upload
- Video range preview with frame-accurate start/end controls
- Single-frame parameter preview before processing a full segment
- Chroma key background removal with threshold, softness, despill, and halo controls
- Optional BiRefNet AI matting for subject alpha
- Optional BiRefNet + Luma mode for preserving glow, fire, lightning, particles, and other bright VFX
- AI edge cleanup controls for green spill and dirty halos
- Batch frame selection, animation preview, sprite sheet export, zip export, and JSON manifest export

## Matting Modes

Sprite Video Lab includes four processing modes:

- `Solid color / green screen`: fast chroma-key removal for controlled backgrounds.
- `BiRefNet`: AI subject matting for non-uniform or generated backgrounds.
- `BiRefNet + Luma`: combines the BiRefNet alpha with a brightness-derived alpha, useful for VFX-heavy sprites.
- `No matting`: only normalize, align, and export frames.

For green edges after AI matting, use manual background color selection, increase despill strength, and try a 1-2 px halo shrink.

## Requirements

- Python 3.10+
- Pillow
- ffmpeg / ffprobe
- Optional AI runtime:
  - PyTorch
  - torchvision
  - transformers
  - huggingface-hub
  - timm and supporting image libraries

The base app only needs `requirements.txt`. AI matting uses `requirements-ai.txt`.

## Quick Start

### 1. Clone

```bash
git clone https://github.com/sparklecatta-lang/sprite-video-lab.git
cd sprite-video-lab
```

### 2. Install base dependencies

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

### 3. Install ffmpeg

Put `ffmpeg` and `ffprobe` on `PATH`.

If you keep a standalone ffmpeg directory, you can point the app to it:

```powershell
$env:SPRITE_VIDEO_LAB_FFMPEG_DIR="D:\ffmpeg\bin"
```

### 4. Optional: install AI matting runtime

On Windows, run:

```bat
setup_ai_runtime.bat
```

This creates a separate AI Python environment and installs the dependencies needed for BiRefNet. Model cache location can be overridden with:

```bat
set SPRITE_VIDEO_LAB_AI_MODEL_CACHE=<model-cache-dir>
```

You can also point the server to a custom Python runtime:

```bat
set SPRITE_VIDEO_LAB_PYTHON=<python-runtime>
```

See [AI_MATTING.md](./AI_MATTING.md) for details.

### 5. Start

On Windows:

```bat
start_sprite_video_lab.bat
```

Or from a terminal:

```bash
python server.py
```

Default URL:

```text
http://127.0.0.1:8894
```

## Environment Variables

- `SPRITE_VIDEO_LAB_HOST`
  - default: `127.0.0.1`
- `SPRITE_VIDEO_LAB_PORT`
  - default: `8894`
- `SPRITE_VIDEO_LAB_FFMPEG_DIR`
  - optional directory containing `ffmpeg(.exe)` and `ffprobe(.exe)`
- `SPRITE_VIDEO_LAB_FFMPEG_ACCEL`
  - optional, supports `auto`, `cpu`, `cuda`, `qsv`, `d3d11va`, `dxva2`
- `SPRITE_VIDEO_LAB_AI_MODEL_CACHE`
  - optional Hugging Face / model cache directory for AI matting
- `SPRITE_VIDEO_LAB_PYTHON`
  - optional Python executable used by the launcher

You can override host and port from the command line:

```bash
python server.py --host 127.0.0.1 --port 8894
```

## Project Layout

```text
app/                         Frontend UI and browser logic
server.py                    Local HTTP server and processing pipeline
requirements.txt             Base runtime dependencies
requirements-ai.txt          Optional AI matting dependencies
setup_ai_runtime.bat         Windows helper for optional AI runtime
start_sprite_video_lab.bat   Windows launcher
work/                        Runtime outputs, ignored by git
```

## Notes

- Keep `work/`, generated frames, test videos, model caches, and virtual environments out of git.
- AI models are downloaded by the local runtime when selected for the first time.
- BiRefNet uses remote model code from Hugging Face via `trust_remote_code=True`; review/pin model revisions if you need stricter supply-chain control.

## License

[MIT](./LICENSE)
