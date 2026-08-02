#!/usr/bin/env python3
"""Compose extracted frames into a desktop_pet_v2 action sidecar package."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw

CELL_WIDTH = 192
CELL_HEIGHT = 208
ACTION_MANIFEST_FILE = "desktop-pet-actions.json"
ACTION_ATLAS_FILE = "actions.webp"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-dir", required=True)
    parser.add_argument("--package-dir", required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    run_dir = Path(args.run_dir).expanduser().resolve()
    package_dir = Path(args.package_dir).expanduser().resolve()
    plan_path = run_dir / "action-plan.json"
    if not plan_path.is_file():
        raise SystemExit(f"missing action plan: {plan_path}")
    if not (package_dir / "pet.json").is_file():
        raise SystemExit(f"missing pet package: {package_dir}")
    plan = json.loads(plan_path.read_text(encoding="utf-8"))
    actions = plan.get("actions")
    if not isinstance(actions, list) or not actions:
        raise SystemExit("action plan contains no actions")
    columns = int(plan.get("columns", 8))
    if columns < 1 or columns > 16:
        raise SystemExit("action plan columns must be 1-16")
    rows = len(actions)
    if rows > 64:
        raise SystemExit("action plan exceeds the 64-row runtime limit")

    atlas = Image.new(
        "RGBA",
        (columns * CELL_WIDTH, rows * CELL_HEIGHT),
        (0, 0, 0, 0),
    )
    animations: dict[str, dict[str, object]] = {}
    frame_cache: dict[str, list[Image.Image]] = {}
    for row, action in enumerate(actions):
        name = str(action["name"])
        frame_count = int(action["frameCount"])
        if frame_count > columns:
            raise SystemExit(
                f"action {name} uses {frame_count} frames but atlas has {columns} columns"
            )
        durations = action.get("durationsMs")
        if not isinstance(durations, list) or len(durations) != frame_count:
            raise SystemExit(f"action {name} has invalid durationsMs")
        frames: list[Image.Image] = []
        manifest_frames: list[dict[str, int]] = []
        frames_dir = run_dir / str(action["framesDir"])
        for column in range(frame_count):
            frame_path = frames_dir / f"{column:02d}.png"
            if not frame_path.is_file():
                raise SystemExit(f"missing frame: {frame_path}")
            frame = Image.open(frame_path).convert("RGBA")
            if frame.size != (CELL_WIDTH, CELL_HEIGHT):
                raise SystemExit(
                    f"frame {frame_path} must be {CELL_WIDTH}x{CELL_HEIGHT}"
                )
            if frame.getbbox() is None:
                raise SystemExit(f"frame is empty: {frame_path}")
            atlas.alpha_composite(frame, (column * CELL_WIDTH, row * CELL_HEIGHT))
            frames.append(frame.copy())
            manifest_frames.append(
                {
                    "row": row,
                    "column": column,
                    "durationMs": int(durations[column]),
                }
            )
        frame_cache[name] = frames
        animations[name] = {
            "loop": bool(action["loop"]),
            "frames": manifest_frames,
        }

    action_manifest = {
        "formatVersion": 1,
        "cellWidth": CELL_WIDTH,
        "cellHeight": CELL_HEIGHT,
        "atlasPath": ACTION_ATLAS_FILE,
        "columns": columns,
        "rows": rows,
        "animations": animations,
        "stateMap": plan["stateMap"],
    }
    package_dir.mkdir(parents=True, exist_ok=True)
    atlas.save(
        package_dir / ACTION_ATLAS_FILE,
        format="WEBP",
        lossless=True,
        method=6,
    )
    (package_dir / ACTION_MANIFEST_FILE).write_text(
        json.dumps(action_manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    qa_dir = run_dir / "qa"
    preview_dir = qa_dir / "previews"
    preview_dir.mkdir(parents=True, exist_ok=True)
    make_contact_sheet(
        qa_dir / "action-contact-sheet.png",
        actions,
        frame_cache,
        columns,
    )
    for action in actions:
        name = str(action["name"])
        frames = frame_cache[name]
        durations = [int(value) for value in action["durationsMs"]]
        frames[0].save(
            preview_dir / f"{name}.gif",
            save_all=True,
            append_images=frames[1:],
            duration=durations,
            loop=0 if action["loop"] else 1,
            disposal=2,
            transparency=0,
        )
    coverage = build_coverage(plan, animations)
    (qa_dir / "coverage.json").write_text(
        json.dumps(coverage, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"manifest={package_dir / ACTION_MANIFEST_FILE}")
    print(f"atlas={package_dir / ACTION_ATLAS_FILE}")
    print(f"contact_sheet={qa_dir / 'action-contact-sheet.png'}")
    print(f"coverage={qa_dir / 'coverage.json'}")


def make_contact_sheet(
    output: Path,
    actions: list[dict[str, object]],
    frame_cache: dict[str, list[Image.Image]],
    columns: int,
) -> None:
    scale = 0.5
    cell_width = round(CELL_WIDTH * scale)
    cell_height = round(CELL_HEIGHT * scale)
    label_width = 170
    sheet = Image.new(
        "RGBA",
        (label_width + columns * cell_width, len(actions) * cell_height),
        (30, 31, 36, 255),
    )
    draw = ImageDraw.Draw(sheet)
    for row, action in enumerate(actions):
        name = str(action["name"])
        top = row * cell_height
        draw.text((8, top + 8), name, fill=(240, 240, 245, 255))
        draw.text(
            (8, top + 28),
            f"{action['kind']} / {action['frameCount']}f",
            fill=(170, 174, 184, 255),
        )
        for column, frame in enumerate(frame_cache[name]):
            preview = frame.resize(
                (cell_width, cell_height),
                Image.Resampling.LANCZOS,
            )
            checker = checkerboard(cell_width, cell_height)
            checker.alpha_composite(preview)
            sheet.alpha_composite(checker, (label_width + column * cell_width, top))
    sheet.convert("RGB").save(output)


def checkerboard(width: int, height: int) -> Image.Image:
    image = Image.new("RGBA", (width, height), (235, 235, 238, 255))
    draw = ImageDraw.Draw(image)
    size = 12
    for y in range(0, height, size):
        for x in range(0, width, size):
            if (x // size + y // size) % 2:
                draw.rectangle(
                    (x, y, min(width, x + size), min(height, y + size)),
                    fill=(205, 207, 214, 255),
                )
    return image


def build_coverage(
    plan: dict[str, object],
    animations: dict[str, dict[str, object]],
) -> dict[str, object]:
    state_map = dict(plan["stateMap"])
    required_cues = list(plan["requiredCues"])
    missing_states = [
        state
        for state, action in state_map.items()
        if action not in animations
    ]
    missing_cues = [cue for cue in required_cues if cue not in animations]
    return {
        "ok": not missing_states and not missing_cues,
        "stateCount": len(state_map),
        "cueCount": len(required_cues),
        "animationCount": len(animations),
        "missingStates": missing_states,
        "missingCues": missing_cues,
        "creativeIncluded": bool(plan.get("includeCreative")),
    }


if __name__ == "__main__":
    main()
