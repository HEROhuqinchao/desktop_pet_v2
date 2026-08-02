#!/usr/bin/env python3
"""Validate a Codex v2 base package and desktop_pet_v2 action sidecar."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from PIL import Image

CELL_WIDTH = 192
CELL_HEIGHT = 208
ACTION_MANIFEST_FILE = "desktop-pet-actions.json"
ACTION_NAME = re.compile(r"^[a-z][a-z0-9-]{0,63}$")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--package-dir", required=True)
    parser.add_argument("--project-root")
    parser.add_argument("--require-complete", action="store_true")
    parser.add_argument("--json-out", required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    skill_dir = Path(__file__).resolve().parent.parent
    catalog = json.loads(
        (skill_dir / "references" / "action-catalog.json").read_text(
            encoding="utf-8"
        )
    )
    package_dir = Path(args.package_dir).expanduser().resolve()
    json_out = Path(args.json_out).expanduser().resolve()
    json_out.parent.mkdir(parents=True, exist_ok=True)
    errors: list[str] = []
    warnings: list[str] = []

    pet_manifest = read_json(package_dir / "pet.json", errors)
    if pet_manifest.get("spriteVersionNumber") != 2:
        errors.append("pet.json must use spriteVersionNumber 2")
    base_path = package_dir / str(pet_manifest.get("spritesheetPath", ""))
    check_image_size(base_path, (1536, 2288), "Codex v2 base atlas", errors)

    action_manifest = read_json(package_dir / ACTION_MANIFEST_FILE, errors)
    validate_manifest_shape(action_manifest, errors)
    atlas_path = package_dir / str(action_manifest.get("atlasPath", ""))
    columns = integer_value(action_manifest.get("columns"), 0)
    rows = integer_value(action_manifest.get("rows"), 0)
    atlas = check_image_size(
        atlas_path,
        (columns * CELL_WIDTH, rows * CELL_HEIGHT),
        "action atlas",
        errors,
    )
    animations = action_manifest.get("animations")
    if not isinstance(animations, dict):
        animations = {}
    state_map = action_manifest.get("stateMap")
    if not isinstance(state_map, dict):
        state_map = {}
    used_cells = validate_animations(
        animations,
        columns,
        rows,
        errors,
    )
    validate_state_map(state_map, animations, errors)
    if atlas is not None and columns > 0 and rows > 0:
        validate_cells(atlas.convert("RGBA"), columns, rows, used_cells, errors)

    expected_states = set(catalog["states"].keys())
    expected_cues = set(catalog["cues"].keys())
    if args.project_root:
        project_root = Path(args.project_root).expanduser().resolve()
        runtime_states = read_runtime_states(project_root, errors)
        catalog_gap = sorted(runtime_states - expected_states)
        if catalog_gap:
            errors.append(
                "action catalog misses runtime states: " + ", ".join(catalog_gap)
            )
        stale_states = sorted(expected_states - runtime_states)
        if stale_states:
            warnings.append(
                "action catalog contains states not found in runtime: "
                + ", ".join(stale_states)
            )
        expected_states = runtime_states
        expected_cues |= read_runtime_event_cues(project_root, errors)

    missing_states = sorted(
        state for state in expected_states if state not in state_map
    )
    missing_cues = sorted(cue for cue in expected_cues if cue not in animations)
    if args.require_complete:
        if missing_states:
            errors.append("missing state mappings: " + ", ".join(missing_states))
        if missing_cues:
            errors.append("missing runtime cues: " + ", ".join(missing_cues))
    else:
        if missing_states:
            warnings.append("fallback states: " + ", ".join(missing_states))
        if missing_cues:
            warnings.append("ignored cues: " + ", ".join(missing_cues))

    report = {
        "ok": not errors,
        "packageDir": str(package_dir),
        "baseAtlas": str(base_path),
        "actionManifest": str(package_dir / ACTION_MANIFEST_FILE),
        "actionAtlas": str(atlas_path),
        "animationCount": len(animations),
        "mappedStateCount": len(state_map),
        "expectedStateCount": len(expected_states),
        "expectedCueCount": len(expected_cues),
        "missingStates": missing_states,
        "missingCues": missing_cues,
        "errors": errors,
        "warnings": warnings,
    }
    json_out.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    if errors:
        raise SystemExit("action pack validation failed; inspect the JSON report")
    print(f"validation={json_out}")
    print(f"animation_count={len(animations)}")


def read_json(path: Path, errors: list[str]) -> dict[str, object]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except Exception as error:  # noqa: BLE001 - report file parsing failures uniformly
        errors.append(f"cannot read {path}: {error}")
        return {}
    if not isinstance(value, dict):
        errors.append(f"{path} must contain a JSON object")
        return {}
    return value


def check_image_size(
    path: Path,
    expected: tuple[int, int],
    label: str,
    errors: list[str],
) -> Image.Image | None:
    try:
        image = Image.open(path)
        image.load()
    except Exception as error:  # noqa: BLE001 - convert decoder failures to QA errors
        errors.append(f"cannot read {label} {path}: {error}")
        return None
    if image.format not in {"PNG", "WEBP"}:
        errors.append(f"{label} must be PNG or WebP")
    if image.size != expected:
        errors.append(f"{label} must be {expected[0]}x{expected[1]}, got {image.size}")
    return image


def validate_manifest_shape(
    manifest: dict[str, object],
    errors: list[str],
) -> None:
    if manifest.get("formatVersion") != 1:
        errors.append("action formatVersion must be 1")
    if manifest.get("cellWidth") != CELL_WIDTH or manifest.get("cellHeight") != CELL_HEIGHT:
        errors.append(f"action cells must be {CELL_WIDTH}x{CELL_HEIGHT}")
    atlas_path = manifest.get("atlasPath")
    if not isinstance(atlas_path, str) or Path(atlas_path).name != atlas_path:
        errors.append("action atlasPath must be a local file name")
    columns = integer_value(manifest.get("columns"), 0)
    rows = integer_value(manifest.get("rows"), 0)
    if columns < 1 or columns > 16:
        errors.append("action columns must be 1-16")
    if rows < 1 or rows > 64:
        errors.append("action rows must be 1-64")


def validate_animations(
    animations: dict[str, object],
    columns: int,
    rows: int,
    errors: list[str],
) -> set[tuple[int, int]]:
    used: set[tuple[int, int]] = set()
    if not animations:
        errors.append("animations must not be empty")
    for name, raw_definition in animations.items():
        if not ACTION_NAME.fullmatch(name):
            errors.append(f"invalid action name: {name}")
        if not isinstance(raw_definition, dict):
            errors.append(f"animation {name} must be an object")
            continue
        if not isinstance(raw_definition.get("loop"), bool):
            errors.append(f"animation {name}.loop must be boolean")
        frames = raw_definition.get("frames")
        if not isinstance(frames, list) or not 1 <= len(frames) <= 64:
            errors.append(f"animation {name} must contain 1-64 frames")
            continue
        for index, frame in enumerate(frames):
            if not isinstance(frame, dict):
                errors.append(f"animation {name} frame {index} must be an object")
                continue
            row = integer_value(frame.get("row"), -1)
            column = integer_value(frame.get("column"), -1)
            duration = integer_value(frame.get("durationMs"), -1)
            if not 0 <= row < rows or not 0 <= column < columns:
                errors.append(f"animation {name} frame {index} is outside the atlas")
            else:
                used.add((row, column))
            if not 16 <= duration <= 10_000:
                errors.append(f"animation {name} frame {index} duration is invalid")
    return used


def validate_state_map(
    state_map: dict[str, object],
    animations: dict[str, object],
    errors: list[str],
) -> None:
    for state, action in state_map.items():
        if not isinstance(action, str) or action not in animations:
            errors.append(f"stateMap.{state} must reference a defined animation")


def validate_cells(
    atlas: Image.Image,
    columns: int,
    rows: int,
    used: set[tuple[int, int]],
    errors: list[str],
) -> None:
    for row in range(rows):
        for column in range(columns):
            cell = atlas.crop(
                (
                    column * CELL_WIDTH,
                    row * CELL_HEIGHT,
                    (column + 1) * CELL_WIDTH,
                    (row + 1) * CELL_HEIGHT,
                )
            )
            visible = cell.getbbox() is not None
            if (row, column) in used and not visible:
                errors.append(f"required action cell {row}:{column} is empty")
            if (row, column) not in used and visible:
                errors.append(f"unused action cell {row}:{column} is not transparent")


def read_runtime_states(project_root: Path, errors: list[str]) -> set[str]:
    path = project_root / "src" / "shared" / "contracts.ts"
    try:
        source = path.read_text(encoding="utf-8")
    except OSError as error:
        errors.append(f"cannot read runtime states: {error}")
        return set()
    match = re.search(
        r"PET_BEHAVIOR_STATES\s*=\s*\[(.*?)\]\s*as const",
        source,
        re.DOTALL,
    )
    if not match:
        errors.append("cannot locate PET_BEHAVIOR_STATES")
        return set()
    return set(re.findall(r"'([A-Z_]+)'", match.group(1)))


def read_runtime_event_cues(project_root: Path, errors: list[str]) -> set[str]:
    path = project_root / "data" / "events.json"
    try:
        events = json.loads(path.read_text(encoding="utf-8"))
    except Exception as error:  # noqa: BLE001 - surface malformed runtime data
        errors.append(f"cannot read runtime events: {error}")
        return set()
    return {
        "event-" + str(event["id"]).replace("_", "-")
        for event in events
        if isinstance(event, dict) and isinstance(event.get("id"), str)
    }


def integer_value(value: object, fallback: int) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) else fallback


if __name__ == "__main__":
    main()
