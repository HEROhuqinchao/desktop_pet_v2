#!/usr/bin/env python3
"""Extract a generated horizontal action strip into stable 192x208 frames."""

from __future__ import annotations

import argparse
import json
import math
import re
from collections import deque
from pathlib import Path

from PIL import Image

CELL_WIDTH = 192
CELL_HEIGHT = 208


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--strip", required=True)
    parser.add_argument("--frame-count", required=True, type=int)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--chroma-key", default="#FF00FF")
    parser.add_argument("--chroma-threshold", type=float, default=82.0)
    parser.add_argument("--target-max-width", type=int, default=CELL_WIDTH - 10)
    parser.add_argument("--target-max-height", type=int, default=CELL_HEIGHT - 10)
    parser.add_argument("--json-out", required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.frame_count < 1 or args.frame_count > 64:
        raise SystemExit("frame count must be 1-64")
    if not 1 <= args.target_max_width <= CELL_WIDTH:
        raise SystemExit(f"target max width must be 1-{CELL_WIDTH}")
    if not 1 <= args.target_max_height <= CELL_HEIGHT:
        raise SystemExit(f"target max height must be 1-{CELL_HEIGHT}")
    strip_path = Path(args.strip).expanduser().resolve()
    if not strip_path.is_file():
        raise SystemExit(f"missing strip: {strip_path}")
    output_dir = Path(args.output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    json_out = Path(args.json_out).expanduser().resolve()
    json_out.parent.mkdir(parents=True, exist_ok=True)

    chroma_key = parse_hex(args.chroma_key)
    source = remove_chroma(
        Image.open(strip_path).convert("RGBA"),
        chroma_key,
        args.chroma_threshold,
    )
    crops, method = extract_component_crops(source, args.frame_count)
    if crops is None:
        crops = extract_slot_crops(source, args.frame_count)
        method = "equal-slots"
    frames = fit_shared(
        crops,
        target_max_width=args.target_max_width,
        target_max_height=args.target_max_height,
    )

    errors: list[str] = []
    warnings: list[str] = []
    reports: list[dict[str, object]] = []
    areas: list[int] = []
    centers: list[float] = []
    for index, frame in enumerate(frames):
        frame_path = output_dir / f"{index:02d}.png"
        frame.save(frame_path)
        bbox = frame.getbbox()
        if bbox is None:
            errors.append(f"frame {index} is empty")
            reports.append({"index": index, "path": str(frame_path), "empty": True})
            continue
        left, top, right, bottom = bbox
        alpha = frame.getchannel("A")
        area = sum(1 for value in alpha.tobytes() if value > 16)
        center = (left + right) / 2
        areas.append(area)
        centers.append(center)
        if left <= 1 or top <= 1 or right >= CELL_WIDTH - 1 or bottom >= CELL_HEIGHT - 1:
            warnings.append(f"frame {index} is within 1px of the cell edge")
        reports.append(
            {
                "index": index,
                "path": str(frame_path),
                "empty": False,
                "bbox": [left, top, right, bottom],
                "visiblePixels": area,
                "centerX": center,
            }
        )

    if areas and min(areas) > 0 and max(areas) / min(areas) > 1.65:
        warnings.append("visible area varies by more than 65% across frames")
    if centers and max(centers) - min(centers) > CELL_WIDTH * 0.28:
        warnings.append("horizontal anchor varies by more than 28% of a cell")
    report = {
        "ok": not errors,
        "strip": str(strip_path),
        "method": method,
        "frameCount": args.frame_count,
        "cellWidth": CELL_WIDTH,
        "cellHeight": CELL_HEIGHT,
        "targetMaxWidth": args.target_max_width,
        "targetMaxHeight": args.target_max_height,
        "errors": errors,
        "warnings": warnings,
        "frames": reports,
    }
    json_out.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    if errors:
        raise SystemExit("action strip extraction failed; inspect the JSON report")
    print(f"frames_dir={output_dir}")
    print(f"method={method}")
    print(f"qa={json_out}")


def parse_hex(value: str) -> tuple[int, int, int]:
    if not re.fullmatch(r"#[0-9A-Fa-f]{6}", value):
        raise SystemExit("chroma key must use #RRGGBB")
    return tuple(int(value[index : index + 2], 16) for index in (1, 3, 5))


def remove_chroma(
    image: Image.Image,
    key: tuple[int, int, int],
    threshold: float,
) -> Image.Image:
    output = image.copy()
    pixels = output.load()
    for y in range(output.height):
        for x in range(output.width):
            red, green, blue, alpha = pixels[x, y]
            distance = math.sqrt(
                (red - key[0]) ** 2
                + (green - key[1]) ** 2
                + (blue - key[2]) ** 2
            )
            if distance <= threshold:
                pixels[x, y] = (0, 0, 0, 0)
            elif alpha == 0:
                pixels[x, y] = (0, 0, 0, 0)
    return output


def connected_components(image: Image.Image) -> list[dict[str, object]]:
    alpha = image.getchannel("A")
    width, height = image.size
    data = alpha.tobytes()
    visited = bytearray(width * height)
    components: list[dict[str, object]] = []
    for start, alpha_value in enumerate(data):
        if alpha_value <= 16 or visited[start]:
            continue
        queue: deque[int] = deque([start])
        visited[start] = 1
        indexes: list[int] = []
        min_x, min_y, max_x, max_y = width, height, 0, 0
        while queue:
            current = queue.pop()
            indexes.append(current)
            x = current % width
            y = current // width
            min_x, min_y = min(min_x, x), min(min_y, y)
            max_x, max_y = max(max_x, x), max(max_y, y)
            neighbors = []
            if x > 0:
                neighbors.append(current - 1)
            if x + 1 < width:
                neighbors.append(current + 1)
            if y > 0:
                neighbors.append(current - width)
            if y + 1 < height:
                neighbors.append(current + width)
            for neighbor in neighbors:
                if not visited[neighbor] and data[neighbor] > 16:
                    visited[neighbor] = 1
                    queue.append(neighbor)
        components.append(
            {
                "indexes": indexes,
                "area": len(indexes),
                "bbox": (min_x, min_y, max_x + 1, max_y + 1),
                "centerX": (min_x + max_x + 1) / 2,
            }
        )
    return components


def extract_component_crops(
    image: Image.Image,
    frame_count: int,
) -> tuple[list[Image.Image] | None, str]:
    components = connected_components(image)
    if len(components) < frame_count:
        return None, "components-unavailable"
    largest_area = max(int(component["area"]) for component in components)
    seeds = [
        component
        for component in components
        if int(component["area"]) >= max(120, largest_area * 0.18)
    ]
    if len(seeds) < frame_count:
        seeds = sorted(
            components,
            key=lambda item: int(item["area"]),
            reverse=True,
        )[:frame_count]
    if len(seeds) < frame_count:
        return None, "components-unavailable"
    seeds = sorted(
        sorted(seeds, key=lambda item: int(item["area"]), reverse=True)[:frame_count],
        key=lambda item: float(item["centerX"]),
    )
    groups: list[list[dict[str, object]]] = [[seed] for seed in seeds]
    seed_ids = {id(seed) for seed in seeds}
    for component in components:
        if id(component) in seed_ids or int(component["area"]) < max(10, largest_area * 0.0015):
            continue
        nearest = min(
            range(frame_count),
            key=lambda index: abs(
                float(seeds[index]["centerX"]) - float(component["centerX"])
            ),
        )
        groups[nearest].append(component)
    return [component_crop(image, group) for group in groups], "components"


def component_crop(
    image: Image.Image,
    components: list[dict[str, object]],
) -> Image.Image:
    width, height = image.size
    boxes = [component["bbox"] for component in components]
    left = max(0, min(int(box[0]) for box in boxes) - 4)
    top = max(0, min(int(box[1]) for box in boxes) - 4)
    right = min(width, max(int(box[2]) for box in boxes) + 4)
    bottom = min(height, max(int(box[3]) for box in boxes) + 4)
    output = Image.new("RGBA", (right - left, bottom - top), (0, 0, 0, 0))
    source_pixels = image.load()
    output_pixels = output.load()
    for component in components:
        for pixel_index in component["indexes"]:
            x = int(pixel_index) % width
            y = int(pixel_index) // width
            output_pixels[x - left, y - top] = source_pixels[x, y]
    return output


def extract_slot_crops(image: Image.Image, frame_count: int) -> list[Image.Image]:
    crops: list[Image.Image] = []
    for index in range(frame_count):
        left = round(index * image.width / frame_count)
        right = round((index + 1) * image.width / frame_count)
        slot = image.crop((left, 0, right, image.height))
        bbox = slot.getbbox()
        crops.append(slot.crop(bbox) if bbox else slot)
    return crops


def fit_shared(
    crops: list[Image.Image],
    *,
    target_max_width: int = CELL_WIDTH - 10,
    target_max_height: int = CELL_HEIGHT - 10,
) -> list[Image.Image]:
    nonempty = [crop for crop in crops if crop.getbbox() is not None]
    if not nonempty:
        return [Image.new("RGBA", (CELL_WIDTH, CELL_HEIGHT)) for _ in crops]
    widest = max(crop.width for crop in nonempty)
    tallest = max(crop.height for crop in nonempty)
    scale = min(
        target_max_width / widest,
        target_max_height / tallest,
        1.0,
    )
    frames: list[Image.Image] = []
    for crop in crops:
        canvas = Image.new("RGBA", (CELL_WIDTH, CELL_HEIGHT), (0, 0, 0, 0))
        if crop.getbbox() is None:
            frames.append(canvas)
            continue
        resized = crop
        if scale != 1.0:
            resized = crop.resize(
                (max(1, round(crop.width * scale)), max(1, round(crop.height * scale))),
                Image.Resampling.LANCZOS,
            )
        left = (CELL_WIDTH - resized.width) // 2
        top = CELL_HEIGHT - resized.height - 5
        canvas.alpha_composite(resized, (left, top))
        frames.append(canvas)
    return frames


if __name__ == "__main__":
    main()
