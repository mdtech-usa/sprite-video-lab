from __future__ import annotations

import argparse
import cgi
import json
import math
import mimetypes
import os
import re
import shutil
import subprocess
import sys
import time
import uuid
import zipfile
from datetime import datetime
from fractions import Fraction
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from PIL import Image, ImageFilter


ROOT_DIR = Path(__file__).resolve().parent
APP_DIR = ROOT_DIR / "app"
WORK_DIR = ROOT_DIR / "work"
UPLOADS_DIR = WORK_DIR / "uploads"
JOBS_DIR = WORK_DIR / "jobs"
EXPORTS_DIR = WORK_DIR / "exports"
PREVIEWS_DIR = WORK_DIR / "previews"

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8894
DEFAULT_FFMPEG_FALLBACK_ROOT = Path(r"I:\FF\Flowframes\FlowframesData\pkgs\av")
HOST_ENV = "SPRITE_VIDEO_LAB_HOST"
PORT_ENV = "SPRITE_VIDEO_LAB_PORT"
FFMPEG_DIR_ENV = "SPRITE_VIDEO_LAB_FFMPEG_DIR"
LANCZOS = Image.Resampling.LANCZOS
APP_VERSION_POLL_MS = 1200
VIDEO_EXTENSIONS = {".mp4", ".mov", ".mkv", ".webm"}
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}
FFMPEG_ACCEL_ENV = "SPRITE_VIDEO_LAB_FFMPEG_ACCEL"
FFMPEG_ACCEL_PRIORITY = ("cuda", "qsv", "d3d11va", "dxva2")
FFMPEG_ACCEL_ALIASES = {
    "": "auto",
    "auto": "auto",
    "default": "auto",
    "gpu": "auto",
    "cpu": "cpu",
    "off": "cpu",
    "none": "cpu",
    "disabled": "cpu",
    "cuda": "cuda",
    "nvdec": "cuda",
    "qsv": "qsv",
    "d3d11va": "d3d11va",
    "dxva2": "dxva2",
}

_FFMPEG_HWACCELS_CACHE: set[str] | None = None


def ensure_runtime_dirs() -> None:
    for directory in (APP_DIR, WORK_DIR, UPLOADS_DIR, JOBS_DIR, EXPORTS_DIR, PREVIEWS_DIR):
        directory.mkdir(parents=True, exist_ok=True)


def configured_host(cli_host: str | None = None) -> str:
    value = str(cli_host or os.environ.get(HOST_ENV, DEFAULT_HOST)).strip()
    return value or DEFAULT_HOST


def configured_port(cli_port: int | None = None) -> int:
    if cli_port is not None:
        return cli_port
    raw = str(os.environ.get(PORT_ENV, DEFAULT_PORT)).strip()
    try:
        port = int(raw)
    except ValueError:
        return DEFAULT_PORT
    return port if 1 <= port <= 65535 else DEFAULT_PORT


def ffmpeg_fallback_root() -> Path | None:
    configured = str(os.environ.get(FFMPEG_DIR_ENV, "")).strip()
    if configured:
        return Path(configured).expanduser()
    if DEFAULT_FFMPEG_FALLBACK_ROOT.exists():
        return DEFAULT_FFMPEG_FALLBACK_ROOT
    return None


def clean_filename(name: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9._-]+", "-", Path(name).name).strip(".-")
    return cleaned or "video"


def slugify(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_-]+", "-", value).strip("-")
    return cleaned or "item"


def json_bytes(payload: dict) -> bytes:
    return json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")


def iso_now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def timestamped_id() -> str:
    return f"{datetime.now():%Y%m%d-%H%M%S}-{uuid.uuid4().hex[:4]}"


def parse_hex_color(raw: str) -> tuple[int, int, int]:
    value = raw.strip().lstrip("#")
    if len(value) != 6:
        raise ValueError(f"invalid color: {raw}")
    return (int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16))


def rgb_to_hex(rgb: tuple[int, int, int]) -> str:
    return f"#{rgb[0]:02X}{rgb[1]:02X}{rgb[2]:02X}"


def safe_int(value, default: int) -> int:
    try:
        return int(value)
    except Exception:
        return default


def safe_float(value, default: float) -> float:
    try:
        return float(value)
    except Exception:
        return default


def clamp_float(value: float, minimum: float, maximum: float) -> float:
    return min(maximum, max(minimum, value))


def resolve_ffmpeg_binary(name: str) -> str:
    direct = shutil.which(name)
    if direct:
        return direct
    fallback_root = ffmpeg_fallback_root()
    if fallback_root is not None:
        candidate = fallback_root / f"{name}.exe"
        if candidate.exists():
            return str(candidate)
    raise FileNotFoundError(f"could not resolve {name}")


def run_process(args: list[str]) -> str:
    completed = subprocess.run(args, capture_output=True, text=True, encoding="utf-8", errors="ignore")
    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout or "").strip()
        raise RuntimeError(detail or f"command failed: {' '.join(args)}")
    return completed.stdout


def configured_ffmpeg_accel_mode() -> str:
    raw = str(os.environ.get(FFMPEG_ACCEL_ENV, "auto") or "auto").strip().lower()
    return FFMPEG_ACCEL_ALIASES.get(raw, "auto")


def available_ffmpeg_hwaccels() -> set[str]:
    global _FFMPEG_HWACCELS_CACHE
    if _FFMPEG_HWACCELS_CACHE is not None:
        return _FFMPEG_HWACCELS_CACHE

    ffmpeg = resolve_ffmpeg_binary("ffmpeg")
    try:
        output = run_process([ffmpeg, "-hide_banner", "-hwaccels"])
    except Exception:
        _FFMPEG_HWACCELS_CACHE = set()
        return _FFMPEG_HWACCELS_CACHE

    available: set[str] = set()
    for line in output.splitlines():
        value = line.strip().lower()
        if not value or value.endswith(":"):
            continue
        if re.fullmatch(r"[a-z0-9_]+", value):
            available.add(value)
    _FFMPEG_HWACCELS_CACHE = available
    return _FFMPEG_HWACCELS_CACHE


def preferred_ffmpeg_hwaccel() -> tuple[str, str | None]:
    requested = configured_ffmpeg_accel_mode()
    if requested == "cpu":
        return requested, None

    available = available_ffmpeg_hwaccels()
    if requested == "auto":
        for candidate in FFMPEG_ACCEL_PRIORITY:
            if candidate in available:
                return requested, candidate
        return requested, None

    if requested in available:
        return requested, requested
    return requested, None


def ffmpeg_accel_label(mode: str) -> str:
    return "CPU" if mode == "cpu" else f"GPU ({mode})"


def ffmpeg_accel_payload(
    requested_mode: str,
    selected_mode: str | None,
    used_mode: str,
    fallback_reason: str | None = None,
) -> dict:
    return {
        "requested_mode": requested_mode,
        "selected_mode": selected_mode,
        "used_mode": used_mode,
        "used_label": ffmpeg_accel_label(used_mode),
        "fallback_to_cpu": bool(selected_mode and used_mode == "cpu"),
        "fallback_reason": fallback_reason or "",
    }


def static_image_payload() -> dict:
    return {
        "requested_mode": "image",
        "selected_mode": "",
        "used_mode": "image",
        "used_label": "Static image",
        "fallback_to_cpu": False,
        "fallback_reason": "",
    }


def run_ffmpeg_with_auto_accel(args_builder) -> dict:
    requested_mode, selected_mode = preferred_ffmpeg_hwaccel()
    if selected_mode:
        try:
            run_process(args_builder(selected_mode))
            return ffmpeg_accel_payload(requested_mode, selected_mode, selected_mode)
        except RuntimeError as exc:
            detail = str(exc).strip()
            print(
                f"[ffmpeg] {selected_mode} decode failed, falling back to CPU: {detail}",
                file=sys.stderr,
            )
            run_process(args_builder(None))
            return ffmpeg_accel_payload(
                requested_mode,
                selected_mode,
                "cpu",
                fallback_reason=detail,
            )

    run_process(args_builder(None))
    return ffmpeg_accel_payload(requested_mode, None, "cpu")


def extract_image_frame(source_path: Path, output_path: Path) -> tuple[Path, dict]:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    image = open_rgba_image(source_path)
    image.save(output_path)
    image.close()
    return output_path, static_image_payload()


def is_within_root(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def open_rgba_image(path: Path) -> Image.Image:
    with Image.open(path) as image:
        return image.convert("RGBA")


def watch_targets() -> list[Path]:
    targets = [ROOT_DIR / "server.py"]
    if APP_DIR.exists():
        targets.extend(path for path in APP_DIR.rglob("*") if path.is_file())
    return sorted(set(path.resolve() for path in targets))


def current_app_version() -> str:
    mtimes = [str(path.stat().st_mtime_ns) for path in watch_targets() if path.exists()]
    if not mtimes:
        return "0"
    return max(mtimes)


def watch_snapshot() -> dict[str, int]:
    snapshot: dict[str, int] = {}
    for path in watch_targets():
        try:
            snapshot[str(path)] = path.stat().st_mtime_ns
        except FileNotFoundError:
            continue
    return snapshot


def open_path_in_file_browser(target: Path) -> None:
    resolved = target.resolve()
    if sys.platform.startswith("win"):
        os.startfile(str(resolved))
        return
    if sys.platform == "darwin":
        subprocess.run(["open", str(resolved)], check=True)
        return
    subprocess.run(["xdg-open", str(resolved)], check=True)


def enforce_hard_alpha(image: Image.Image, cutoff: int = 128) -> Image.Image:
    rgba = image.convert("RGBA")
    hardened_pixels: list[tuple[int, int, int, int]] = []
    for r_value, g_value, b_value, alpha in rgba.getdata():
        if alpha >= cutoff:
            hardened_pixels.append((r_value, g_value, b_value, 255))
        else:
            hardened_pixels.append((0, 0, 0, 0))
    hardened = Image.new("RGBA", rgba.size)
    hardened.putdata(hardened_pixels)
    return hardened


def ffprobe_json(path: Path) -> dict:
    ffprobe = resolve_ffmpeg_binary("ffprobe")
    output = run_process(
        [
            ffprobe,
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_streams",
            "-show_format",
            str(path),
        ]
    )
    return json.loads(output)


def parse_frame_rate(raw: str) -> float:
    if not raw or raw == "0/0":
        return 0.0
    try:
        return float(Fraction(raw))
    except Exception:
        return 0.0


def video_info(path: Path) -> dict:
    payload = ffprobe_json(path)
    streams = payload.get("streams") or []
    video_stream = next((item for item in streams if item.get("codec_type") == "video"), {})
    width = safe_int(video_stream.get("width"), 0)
    height = safe_int(video_stream.get("height"), 0)
    fps = parse_frame_rate(str(video_stream.get("avg_frame_rate") or video_stream.get("r_frame_rate") or "0/0"))
    duration = safe_float((payload.get("format") or {}).get("duration"), 0.0)
    return {
        "width": width,
        "height": height,
        "fps": fps,
        "duration": duration,
        "codec": str(video_stream.get("codec_name") or ""),
    }


def image_info(path: Path) -> dict:
    with Image.open(path) as image:
        width, height = image.size
        codec = str((image.format or path.suffix.removeprefix(".") or "image")).lower()
    return {
        "width": width,
        "height": height,
        "fps": 0.0,
        "duration": 0.0,
        "codec": codec,
    }


def detect_media_type(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix in VIDEO_EXTENSIONS:
        return "video"
    if suffix in IMAGE_EXTENSIONS:
        return "image"
    raise ValueError(f"unsupported media type: {path.suffix}")


def media_info(path: Path, media_type: str | None = None) -> dict:
    resolved_type = media_type or detect_media_type(path)
    payload = video_info(path) if resolved_type == "video" else image_info(path)
    payload["media_type"] = resolved_type
    return payload


def upload_dir(upload_id: str) -> Path:
    return UPLOADS_DIR / upload_id


def upload_manifest_path(upload_id: str) -> Path:
    return upload_dir(upload_id) / "manifest.json"


def load_upload_manifest(upload_id: str) -> dict:
    path = upload_manifest_path(upload_id)
    if not path.exists():
        raise FileNotFoundError(f"upload not found: {upload_id}")
    return json.loads(path.read_text(encoding="utf-8"))


def save_upload_manifest(upload_id: str, payload: dict) -> None:
    path = upload_manifest_path(upload_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def source_media_entry(upload_id: str) -> tuple[Path, str]:
    manifest = load_upload_manifest(upload_id)
    path = Path(manifest["source_path"])
    if not path.exists():
        raise FileNotFoundError(f"source missing: {path}")
    media_type = str(manifest.get("media_type") or detect_media_type(path))
    return path, media_type


def source_video_path(upload_id: str) -> Path:
    path, _ = source_media_entry(upload_id)
    return path


def build_upload_payload(upload_id: str, source_path: Path, display_name: str, media_type: str) -> dict:
    info = media_info(source_path, media_type)
    return {
        "upload_id": upload_id,
        "display_name": display_name,
        "media_url": f"/media/upload/{upload_id}",
        "video_url": f"/media/upload/{upload_id}",
        "source_path": str(source_path),
        "media_type": media_type,
        "video_info": info,
        "media_info": info,
    }


def register_video_from_path(source_path: Path) -> dict:
    source_path = source_path.expanduser().resolve()
    if not source_path.exists() or not source_path.is_file():
        raise FileNotFoundError(f"file not found: {source_path}")
    media_type = detect_media_type(source_path)

    upload_id = timestamped_id()
    manifest = {
        "upload_id": upload_id,
        "source_path": str(source_path),
        "display_name": source_path.name,
        "media_type": media_type,
        "created_at": iso_now(),
    }
    save_upload_manifest(upload_id, manifest)
    return build_upload_payload(upload_id, source_path, source_path.name, media_type)


def register_uploaded_file(file_item) -> dict:
    filename = clean_filename(file_item.filename or "video.mp4")
    media_type = detect_media_type(Path(filename))
    upload_id = timestamped_id()
    target_dir = upload_dir(upload_id)
    target_dir.mkdir(parents=True, exist_ok=True)
    target_path = target_dir / filename
    with target_path.open("wb") as handle:
        shutil.copyfileobj(file_item.file, handle)
    manifest = {
        "upload_id": upload_id,
        "source_path": str(target_path),
        "display_name": filename,
        "media_type": media_type,
        "created_at": iso_now(),
    }
    save_upload_manifest(upload_id, manifest)
    return build_upload_payload(upload_id, target_path, filename, media_type)


def auto_key_color(image: Image.Image) -> tuple[int, int, int]:
    rgba = image.convert("RGBA")
    width, height = rgba.size
    sample_size = max(4, min(width, height) // 16)
    boxes = [
        (0, 0, sample_size, sample_size),
        (width - sample_size, 0, width, sample_size),
        (0, height - sample_size, sample_size, height),
        (width - sample_size, height - sample_size, width, height),
    ]
    totals = [0, 0, 0]
    count = 0
    for left, top, right, bottom in boxes:
        for y in range(top, bottom):
            for x in range(left, right):
                r_value, g_value, b_value, _ = rgba.getpixel((x, y))
                totals[0] += r_value
                totals[1] += g_value
                totals[2] += b_value
                count += 1
    if count <= 0:
        return (0, 255, 0)
    return tuple(int(value / count) for value in totals)


def chroma_key_frame(
    image: Image.Image,
    key_rgb: tuple[int, int, int],
    threshold: int,
    softness: int,
    despill_strength: float,
    halo_pixels: int,
) -> Image.Image:
    rgba = image.convert("RGBA")
    output_pixels: list[tuple[int, int, int, int]] = []
    k_r, k_g, k_b = key_rgb
    if softness <= 0:
        max_distance = max(threshold, 1)
    else:
        max_distance = threshold + softness

    for r_value, g_value, b_value, _ in rgba.getdata():
        dist = math.sqrt(
            (r_value - k_r) ** 2
            + (g_value - k_g) ** 2
            + (b_value - k_b) ** 2
        )
        if dist <= threshold:
            alpha = 0
        elif softness <= 0 or dist >= max_distance:
            alpha = 255
        else:
            alpha = int(((dist - threshold) / softness) * 255)

        max_rb = max(r_value, b_value)
        spill = max(0, g_value - max_rb)
        closeness = max(0.0, 1.0 - min(dist / max_distance, 1.0))
        reduction = int(spill * despill_strength * max(closeness, 1.0 - (alpha / 255.0)))
        output_pixels.append(
            (
                r_value,
                max(0, g_value - reduction),
                b_value,
                alpha,
            )
        )

    keyed = Image.new("RGBA", rgba.size)
    keyed.putdata(output_pixels)

    if halo_pixels > 0:
        alpha_channel = keyed.getchannel("A")
        filter_size = (halo_pixels * 2) + 1
        eroded = alpha_channel.filter(ImageFilter.MinFilter(filter_size))
        keyed.putalpha(eroded)

    return keyed


def stable_resize_frames(
    keyed_frames: list[Image.Image],
    target_size: int,
    reduce_px: int,
    hard_alpha: bool = False,
) -> tuple[list[Image.Image], list[tuple[int, int, int, int] | None], float]:
    bboxes = [frame.getchannel("A").getbbox() for frame in keyed_frames]
    valid_boxes = [box for box in bboxes if box is not None]
    if not valid_boxes:
        raise RuntimeError("all frames became transparent after chroma key")

    max_width = max(box[2] - box[0] for box in valid_boxes)
    max_height = max(box[3] - box[1] for box in valid_boxes)
    inner_size = max(8, target_size - (reduce_px * 2))
    scale = min(inner_size / max(max_width, 1), inner_size / max(max_height, 1))

    rendered: list[Image.Image] = []
    for frame, bbox in zip(keyed_frames, bboxes):
        canvas = Image.new("RGBA", (target_size, target_size), (0, 0, 0, 0))
        if bbox is None:
            rendered.append(canvas)
            continue

        cropped = frame.crop(bbox)
        resized = cropped.resize(
            (
                max(1, round(cropped.width * scale)),
                max(1, round(cropped.height * scale)),
            ),
            LANCZOS,
        )
        if hard_alpha:
            resized = enforce_hard_alpha(resized)
        paste_x = (target_size - resized.width) // 2
        paste_y = target_size - reduce_px - resized.height
        canvas.paste(resized, (paste_x, paste_y), resized)
        if hard_alpha:
            canvas = enforce_hard_alpha(canvas)
        rendered.append(canvas)

    return rendered, bboxes, scale


def job_dir(job_id: str) -> Path:
    return JOBS_DIR / job_id


def job_manifest_path(job_id: str) -> Path:
    return job_dir(job_id) / "manifest.json"


def save_job_manifest(job_id: str, payload: dict) -> None:
    path = job_manifest_path(job_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def load_job_manifest(job_id: str) -> dict:
    path = job_manifest_path(job_id)
    if not path.exists():
        raise FileNotFoundError(f"job not found: {job_id}")
    return json.loads(path.read_text(encoding="utf-8"))


def extract_raw_frames(
    source_path: Path,
    raw_dir: Path,
    start_time: float,
    end_time: float,
    keep_every: int,
) -> tuple[list[Path], dict]:
    ffmpeg = resolve_ffmpeg_binary("ffmpeg")
    if raw_dir.exists():
        shutil.rmtree(raw_dir)
    raw_dir.mkdir(parents=True, exist_ok=True)

    def build_args(hwaccel: str | None) -> list[str]:
        args = [ffmpeg, "-y"]
        if hwaccel:
            args += ["-hwaccel", hwaccel]
        args += [
            "-ss",
            f"{start_time:.3f}",
            "-to",
            f"{end_time:.3f}",
            "-i",
            str(source_path),
        ]
        if keep_every > 1:
            args += ["-vf", f"select=not(mod(n\\,{keep_every}))"]
        args += ["-vsync", "0", str(raw_dir / "frame_%05d.png")]
        return args

    accel = run_ffmpeg_with_auto_accel(build_args)
    frames = sorted(raw_dir.glob("frame_*.png"))
    if not frames:
        raise RuntimeError("no frames extracted from the selected segment")
    return frames, accel


def extract_single_frame(source_path: Path, output_path: Path, sample_time: float) -> tuple[Path, dict]:
    ffmpeg = resolve_ffmpeg_binary("ffmpeg")
    output_path.parent.mkdir(parents=True, exist_ok=True)

    def build_args(hwaccel: str | None) -> list[str]:
        args = [ffmpeg, "-y"]
        if hwaccel:
            args += ["-hwaccel", hwaccel]
        args += [
            "-ss",
            f"{sample_time:.3f}",
            "-i",
            str(source_path),
            "-frames:v",
            "1",
            str(output_path),
        ]
        return args

    accel = run_ffmpeg_with_auto_accel(build_args)
    if not output_path.exists():
        raise RuntimeError("failed to extract preview frame")
    return output_path, accel


def process_video_to_job(
    upload_id: str,
    start_time: float,
    end_time: float,
    keep_every: int,
    target_size: int,
    reduce_px: int,
    chroma_enabled: bool,
    key_mode: str,
    manual_key_hex: str,
    threshold: int,
    softness: int,
    despill_strength: float,
    halo_pixels: int,
) -> dict:
    source_path, media_type = source_media_entry(upload_id)
    info = media_info(source_path, media_type)
    start_time = max(0.0, start_time)
    duration = safe_float(info.get("duration"), 0.0)
    if media_type == "video" and duration > 0:
        end_time = min(end_time, duration)
    elif media_type == "image":
        start_time = 0.0
        end_time = 0.0
    if media_type == "video" and end_time <= start_time:
        raise ValueError("end time must be greater than start time")

    job_id = timestamped_id()
    root = job_dir(job_id)
    raw_dir = root / "raw"
    processed_dir = root / "processed"
    thumbs_dir = root / "thumbs"
    for directory in (processed_dir, thumbs_dir):
        directory.mkdir(parents=True, exist_ok=True)

    if media_type == "image":
        raw_path = raw_dir / "frame_00001.png"
        _, ffmpeg_accel = extract_image_frame(source_path, raw_path)
        raw_paths = [raw_path]
    else:
        raw_paths, ffmpeg_accel = extract_raw_frames(source_path, raw_dir, start_time, end_time, max(1, keep_every))
    raw_images = [open_rgba_image(path) for path in raw_paths]

    if chroma_enabled:
        if key_mode == "manual":
            key_rgb = parse_hex_color(manual_key_hex)
        else:
            key_rgb = auto_key_color(raw_images[0])
        keyed_frames = [
            chroma_key_frame(image, key_rgb, threshold, softness, despill_strength, halo_pixels)
            for image in raw_images
        ]
    else:
        key_rgb = auto_key_color(raw_images[0])
        keyed_frames = raw_images

    rendered_frames, bboxes, scale = stable_resize_frames(
        keyed_frames,
        target_size,
        reduce_px,
        hard_alpha=chroma_enabled and softness == 0,
    )
    frame_entries: list[dict] = []
    for index, frame in enumerate(rendered_frames):
        frame_name = f"frame_{index + 1:03d}.png"
        thumb_name = f"thumb_{index + 1:03d}.png"
        frame_path = processed_dir / frame_name
        thumb_path = thumbs_dir / thumb_name
        frame.save(frame_path)
        thumb = frame.copy()
        thumb.thumbnail((128, 128))
        thumb.save(thumb_path)
        frame_entries.append(
            {
                "index": index,
                "name": frame_name,
                "url": f"/work/jobs/{job_id}/processed/{frame_name}",
                "thumb_url": f"/work/jobs/{job_id}/thumbs/{thumb_name}",
                "bbox": list(bboxes[index]) if bboxes[index] else None,
            }
        )

    manifest = {
        "job_id": job_id,
        "upload_id": upload_id,
        "job_dir": str(root),
        "processed_dir": str(processed_dir),
        "raw_dir": str(raw_dir),
        "source_path": str(source_path),
        "source_media_type": media_type,
        "ffmpeg_accel": ffmpeg_accel,
        "video_info": info,
        "options": {
            "start_time": start_time,
            "end_time": end_time,
            "keep_every": keep_every,
            "target_size": target_size,
            "reduce_px": reduce_px,
            "chroma_enabled": chroma_enabled,
            "key_mode": key_mode,
            "key_color": rgb_to_hex(key_rgb),
            "threshold": threshold,
            "softness": softness,
            "despill_strength": despill_strength,
            "halo_pixels": halo_pixels,
            "scale": scale,
        },
        "frame_count": len(frame_entries),
        "frames": frame_entries,
    }
    save_job_manifest(job_id, manifest)
    return manifest


def preview_dir(preview_id: str) -> Path:
    return PREVIEWS_DIR / preview_id


def preview_frame(
    upload_id: str,
    sample_time: float,
    target_size: int,
    reduce_px: int,
    chroma_enabled: bool,
    key_mode: str,
    manual_key_hex: str,
    threshold: int,
    softness: int,
    despill_strength: float,
    halo_pixels: int,
) -> dict:
    source_path, media_type = source_media_entry(upload_id)
    info = media_info(source_path, media_type)
    duration = safe_float(info.get("duration"), 0.0)
    if media_type == "video" and duration > 0:
        sample_time = clamp_float(sample_time, 0.0, duration)
    else:
        sample_time = 0.0

    preview_id = timestamped_id()
    root = preview_dir(preview_id)
    raw_path = root / "raw.png"
    source_preview_path = root / "source.png"
    processed_path = root / "processed.png"

    if media_type == "image":
        _, ffmpeg_accel = extract_image_frame(source_path, raw_path)
    else:
        _, ffmpeg_accel = extract_single_frame(source_path, raw_path, sample_time)
    raw_image = open_rgba_image(raw_path)

    source_preview = raw_image.copy()
    source_preview.thumbnail((320, 320))
    source_preview.save(source_preview_path)

    if chroma_enabled:
        if key_mode == "manual":
            key_rgb = parse_hex_color(manual_key_hex)
        else:
            key_rgb = auto_key_color(raw_image)
        keyed_image = chroma_key_frame(raw_image, key_rgb, threshold, softness, despill_strength, halo_pixels)
    else:
        key_rgb = auto_key_color(raw_image)
        keyed_image = raw_image

    rendered_frames, _, scale = stable_resize_frames(
        [keyed_image],
        target_size,
        reduce_px,
        hard_alpha=chroma_enabled and softness == 0,
    )
    rendered_frames[0].save(processed_path)

    manifest = {
        "preview_id": preview_id,
        "upload_id": upload_id,
        "sample_time": sample_time,
        "source_path": str(source_path),
        "source_media_type": media_type,
        "source_url": f"/work/previews/{preview_id}/source.png",
        "processed_url": f"/work/previews/{preview_id}/processed.png",
        "key_color": rgb_to_hex(key_rgb),
        "ffmpeg_accel": ffmpeg_accel,
        "scale": scale,
        "options": {
            "target_size": target_size,
            "reduce_px": reduce_px,
            "chroma_enabled": chroma_enabled,
            "key_mode": key_mode,
            "threshold": threshold,
            "softness": softness,
            "despill_strength": despill_strength,
            "halo_pixels": halo_pixels,
        },
    }
    (root / "preview.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest


def export_job(job_id: str, selected_indices: list[int], sheet_columns: int) -> dict:
    manifest = load_job_manifest(job_id)
    processed_dir = job_dir(job_id) / "processed"
    target_dir = EXPORTS_DIR / f"{timestamped_id()}-export"
    frames_dir = target_dir / "frames"
    frames_dir.mkdir(parents=True, exist_ok=True)

    frame_map = {entry["index"]: entry for entry in manifest["frames"]}
    indices = sorted(index for index in selected_indices if index in frame_map)
    if not indices:
        raise ValueError("no frames selected for export")

    copied_paths: list[Path] = []
    for output_index, frame_index in enumerate(indices, start=1):
        entry = frame_map[frame_index]
        source_path = processed_dir / entry["name"]
        target_path = frames_dir / f"frame_{output_index:03d}.png"
        shutil.copy2(source_path, target_path)
        copied_paths.append(target_path)

    zip_path = target_dir / "frames.zip"
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for frame_path in copied_paths:
            archive.write(frame_path, arcname=frame_path.name)

    first_image = open_rgba_image(copied_paths[0])
    cell_width, cell_height = first_image.size
    first_image.close()
    columns = max(1, sheet_columns or round(math.sqrt(len(copied_paths))))
    rows = math.ceil(len(copied_paths) / columns)
    sheet = Image.new("RGBA", (columns * cell_width, rows * cell_height), (0, 0, 0, 0))
    for index, frame_path in enumerate(copied_paths):
        row = index // columns
        column = index % columns
        frame = open_rgba_image(frame_path)
        sheet.paste(frame, (column * cell_width, row * cell_height), frame)
        frame.close()
    sheet_path = target_dir / "sprite_sheet.png"
    sheet.save(sheet_path)

    export_manifest = {
        "job_id": job_id,
        "selected_indices": indices,
        "sheet_columns": columns,
        "frame_count": len(copied_paths),
        "frames_dir": str(frames_dir),
        "zip_path": str(zip_path),
        "sheet_path": str(sheet_path),
    }
    (target_dir / "export.json").write_text(json.dumps(export_manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return {
        "output_dir": str(target_dir),
        "frames_dir": str(frames_dir),
        "zip_url": f"/work/exports/{target_dir.name}/frames.zip",
        "sheet_url": f"/work/exports/{target_dir.name}/sprite_sheet.png",
        "manifest_url": f"/work/exports/{target_dir.name}/export.json",
    }


class AppHandler(BaseHTTPRequestHandler):
    server_version = "SpriteVideoLab/0.1"

    def log_message(self, format, *args) -> None:
        return

    def send_json(self, payload: dict, status: int = HTTPStatus.OK) -> None:
        body = json_bytes(payload)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_error_json(self, message: str, status: int = HTTPStatus.BAD_REQUEST) -> None:
        self.send_json({"ok": False, "error": message}, status=status)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/app-version":
            self.send_json(
                {
                    "ok": True,
                    "version": current_app_version(),
                    "poll_ms": APP_VERSION_POLL_MS,
                }
            )
            return
        if parsed.path == "/":
            self.serve_app_file(APP_DIR / "index.html", content_type="text/html; charset=utf-8")
            return
        if parsed.path.startswith("/app/"):
            relative = parsed.path.removeprefix("/app/")
            self.serve_app_file(APP_DIR / relative)
            return
        if parsed.path.startswith("/media/upload/"):
            upload_id = parsed.path.removeprefix("/media/upload/")
            self.serve_media_file(source_video_path(upload_id), allow_range=True)
            return
        if parsed.path.startswith("/work/"):
            relative = parsed.path.removeprefix("/work/")
            self.serve_work_file((WORK_DIR / relative).resolve())
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        try:
            if parsed.path == "/api/import-path":
                payload = self.read_json_body()
                result = register_video_from_path(Path(str(payload.get("path") or "").strip()))
                self.send_json({"ok": True, "upload": result})
                return
            if parsed.path == "/api/upload":
                form = cgi.FieldStorage(
                    fp=self.rfile,
                    headers=self.headers,
                    environ={
                        "REQUEST_METHOD": "POST",
                        "CONTENT_TYPE": self.headers.get("Content-Type", ""),
                        "CONTENT_LENGTH": self.headers.get("Content-Length", "0"),
                    },
                )
                file_item = form["video"] if "video" in form else None
                if file_item is None or not getattr(file_item, "file", None):
                    raise ValueError("media file missing")
                result = register_uploaded_file(file_item)
                self.send_json({"ok": True, "upload": result})
                return
            if parsed.path == "/api/process":
                payload = self.read_json_body()
                result = process_video_to_job(
                    upload_id=str(payload.get("upload_id") or ""),
                    start_time=safe_float(payload.get("start_time"), 0.0),
                    end_time=safe_float(payload.get("end_time"), 0.0),
                    keep_every=max(1, safe_int(payload.get("keep_every"), 1)),
                    target_size=max(32, safe_int(payload.get("target_size"), 256)),
                    reduce_px=max(0, safe_int(payload.get("reduce_px"), 20)),
                    chroma_enabled=bool(payload.get("chroma_enabled", True)),
                    key_mode=str(payload.get("key_mode") or "auto"),
                    manual_key_hex=str(payload.get("manual_key_hex") or "#00FF00"),
                    threshold=max(0, safe_int(payload.get("threshold"), 80)),
                    softness=max(0, safe_int(payload.get("softness"), 32)),
                    despill_strength=max(0.0, safe_float(payload.get("despill_strength"), 0.85)),
                    halo_pixels=max(0, safe_int(payload.get("halo_pixels"), 1)),
                )
                self.send_json({"ok": True, "job": result})
                return
            if parsed.path == "/api/preview-frame":
                payload = self.read_json_body()
                result = preview_frame(
                    upload_id=str(payload.get("upload_id") or ""),
                    sample_time=safe_float(payload.get("sample_time"), 0.0),
                    target_size=max(32, safe_int(payload.get("target_size"), 256)),
                    reduce_px=max(0, safe_int(payload.get("reduce_px"), 20)),
                    chroma_enabled=bool(payload.get("chroma_enabled", True)),
                    key_mode=str(payload.get("key_mode") or "auto"),
                    manual_key_hex=str(payload.get("manual_key_hex") or "#00FF00"),
                    threshold=max(0, safe_int(payload.get("threshold"), 80)),
                    softness=max(0, safe_int(payload.get("softness"), 32)),
                    despill_strength=max(0.0, safe_float(payload.get("despill_strength"), 0.85)),
                    halo_pixels=max(0, safe_int(payload.get("halo_pixels"), 1)),
                )
                self.send_json({"ok": True, "preview": result})
                return
            if parsed.path == "/api/export":
                payload = self.read_json_body()
                result = export_job(
                    job_id=str(payload.get("job_id") or ""),
                    selected_indices=[safe_int(value, -1) for value in (payload.get("selected_indices") or [])],
                    sheet_columns=max(1, safe_int(payload.get("sheet_columns"), 4)),
                )
                self.send_json({"ok": True, "export": result})
                return
            if parsed.path == "/api/open-path":
                payload = self.read_json_body()
                target = Path(str(payload.get("path") or "").strip()).expanduser().resolve()
                if not target.exists():
                    raise FileNotFoundError(target)
                open_path_in_file_browser(target)
                self.send_json({"ok": True})
                return
        except FileNotFoundError as exc:
            self.send_error_json(str(exc), status=HTTPStatus.NOT_FOUND)
            return
        except Exception as exc:
            self.send_error_json(str(exc), status=HTTPStatus.BAD_REQUEST)
            return

        self.send_error(HTTPStatus.NOT_FOUND)

    def read_json_body(self) -> dict:
        length = int(self.headers.get("Content-Length", "0") or "0")
        raw = self.rfile.read(length) if length > 0 else b"{}"
        return json.loads(raw.decode("utf-8"))

    def serve_app_file(self, path: Path, content_type: str | None = None, allow_range: bool = False) -> None:
        if not is_within_root(path, APP_DIR):
            self.send_error(HTTPStatus.FORBIDDEN)
            return
        self.serve_file(path, content_type=content_type, allow_range=allow_range)

    def serve_work_file(self, path: Path, content_type: str | None = None, allow_range: bool = False) -> None:
        if not is_within_root(path, WORK_DIR):
            self.send_error(HTTPStatus.FORBIDDEN)
            return
        self.serve_file(path, content_type=content_type, allow_range=allow_range)

    def serve_media_file(self, path: Path, content_type: str | None = None, allow_range: bool = False) -> None:
        self.serve_file(path, content_type=content_type, allow_range=allow_range)

    def serve_file(self, path: Path, content_type: str | None = None, allow_range: bool = False) -> None:
        path = path.resolve()
        if not path.exists() or not path.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        guessed_type = content_type or mimetypes.guess_type(str(path))[0] or "application/octet-stream"
        file_size = path.stat().st_size
        range_header = self.headers.get("Range") if allow_range else None

        if range_header and range_header.startswith("bytes="):
            start_text, _, end_text = range_header.removeprefix("bytes=").partition("-")
            start = int(start_text or "0")
            end = int(end_text or file_size - 1)
            end = min(end, file_size - 1)
            if start > end:
                self.send_error(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                return
            length = (end - start) + 1
            self.send_response(HTTPStatus.PARTIAL_CONTENT)
            self.send_header("Content-Type", guessed_type)
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
            self.send_header("Content-Length", str(length))
            self.end_headers()
            with path.open("rb") as handle:
                handle.seek(start)
                self.wfile.write(handle.read(length))
            return

        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", guessed_type)
        self.send_header("Content-Length", str(file_size))
        if allow_range:
            self.send_header("Accept-Ranges", "bytes")
        self.end_headers()
        with path.open("rb") as handle:
            shutil.copyfileobj(handle, self.wfile)


def serve_once(host: str, port: int) -> None:
    ensure_runtime_dirs()
    server = ThreadingHTTPServer((host, port), AppHandler)
    print(f"Sprite Video Lab running at http://{host}:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


def stop_child_process(process: subprocess.Popen | None) -> None:
    if process is None or process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def run_with_reloader(host: str, port: int) -> None:
    ensure_runtime_dirs()
    watch_state = watch_snapshot()
    child: subprocess.Popen | None = None
    print(f"Sprite Video Lab reloader watching {len(watch_state)} files.")
    try:
        while True:
            if child is None or child.poll() is not None:
                child = subprocess.Popen(
                    [
                        sys.executable,
                        str(ROOT_DIR / "server.py"),
                        "--serve",
                        "--host",
                        host,
                        "--port",
                        str(port),
                    ],
                    cwd=str(ROOT_DIR),
                )
            time.sleep(0.8)
            next_snapshot = watch_snapshot()
            if next_snapshot != watch_state:
                print("Changes detected. Reloading Sprite Video Lab...")
                watch_state = next_snapshot
                stop_child_process(child)
                child = None
    except KeyboardInterrupt:
        pass
    finally:
        stop_child_process(child)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run Sprite Video Lab.")
    parser.add_argument("--serve", action="store_true", help="Run the HTTP server once without file watching.")
    parser.add_argument("--host", default=None, help=f"Host to bind. Defaults to ${HOST_ENV} or {DEFAULT_HOST}.")
    parser.add_argument("--port", type=int, default=None, help=f"Port to bind. Defaults to ${PORT_ENV} or {DEFAULT_PORT}.")
    args = parser.parse_args()
    host = configured_host(args.host)
    port = configured_port(args.port)
    if args.serve:
        serve_once(host, port)
        return
    run_with_reloader(host, port)


if __name__ == "__main__":
    main()
