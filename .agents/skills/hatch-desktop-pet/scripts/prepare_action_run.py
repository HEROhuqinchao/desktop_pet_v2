#!/usr/bin/env python3
"""Prepare prompts, layout guides, and a deterministic action plan."""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

from PIL import Image, ImageDraw

CELL_WIDTH = 192
CELL_HEIGHT = 208
RUN_MARKER = ".hatch-desktop-pet-run"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pet-package", required=True)
    parser.add_argument("--reference", action="append", default=[])
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--style-notes", default="")
    parser.add_argument("--include-creative", action="store_true")
    parser.add_argument("--force", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    skill_dir = Path(__file__).resolve().parent.parent
    catalog = json.loads(
        (skill_dir / "references" / "action-catalog.json").read_text(
            encoding="utf-8"
        )
    )
    package_dir = Path(args.pet_package).expanduser().resolve()
    pet_manifest_path = package_dir / "pet.json"
    if not pet_manifest_path.is_file():
        raise SystemExit(f"missing pet.json: {pet_manifest_path}")
    pet_manifest = json.loads(pet_manifest_path.read_text(encoding="utf-8"))
    if pet_manifest.get("spriteVersionNumber") != 2:
        raise SystemExit("base package must use spriteVersionNumber 2")
    spritesheet = package_dir / str(pet_manifest.get("spritesheetPath", ""))
    if not spritesheet.is_file():
        raise SystemExit(f"missing base spritesheet: {spritesheet}")

    references = [Path(value).expanduser().resolve() for value in args.reference]
    for reference in references:
        if not reference.is_file():
            raise SystemExit(f"missing reference image: {reference}")
    identity_references = [spritesheet, *references]

    run_dir = Path(args.output_dir).expanduser().resolve()
    prepare_run_directory(run_dir, args.force)
    for relative in ("prompts", "layout-guides", "decoded", "frames", "qa/rows"):
        (run_dir / relative).mkdir(parents=True, exist_ok=True)
    (run_dir / RUN_MARKER).write_text("hatch-desktop-pet\n", encoding="utf-8")

    entries: list[dict[str, object]] = []
    state_map: dict[str, str] = {}
    for state, spec in catalog["states"].items():
        entry = action_entry(
            name=spec["action"],
            kind="state",
            spec=spec,
            state=state,
            run_dir=run_dir,
        )
        entries.append(entry)
        state_map[state] = spec["action"]
    for name, spec in catalog["cues"].items():
        entries.append(
            action_entry(
                name=name,
                kind="cue",
                spec=spec,
                state=None,
                run_dir=run_dir,
            )
        )
    if args.include_creative:
        for name, spec in catalog["creative"].items():
            entries.append(
                action_entry(
                    name=name,
                    kind="creative",
                    spec=spec,
                    state=None,
                    run_dir=run_dir,
                )
            )

    for frame_count in sorted({int(entry["frameCount"]) for entry in entries}):
        make_layout_guide(
            run_dir / "layout-guides" / f"{frame_count}-frames.png",
            frame_count,
            catalog["chromaKey"],
        )
    for entry in entries:
        write_prompt(
            run_dir / str(entry["promptFile"]),
            entry,
            identity_references,
            args.style_notes,
            catalog["chromaKey"],
        )

    plan = {
        "formatVersion": 1,
        "createdBy": "husu",
        "petPackage": str(package_dir),
        "baseSpritesheet": str(spritesheet),
        "identityReferences": [str(path) for path in identity_references],
        "styleNotes": args.style_notes,
        "chromaKey": catalog["chromaKey"],
        "columns": catalog["columns"],
        "cellWidth": CELL_WIDTH,
        "cellHeight": CELL_HEIGHT,
        "includeCreative": bool(args.include_creative),
        "stateMap": state_map,
        "requiredCues": list(catalog["cues"].keys()),
        "actions": entries,
    }
    (run_dir / "action-plan.json").write_text(
        json.dumps(plan, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"run_dir={run_dir}")
    print(f"action_count={len(entries)}")
    print(f"plan={run_dir / 'action-plan.json'}")


def prepare_run_directory(run_dir: Path, force: bool) -> None:
    if not run_dir.exists():
        run_dir.mkdir(parents=True)
        return
    contents = list(run_dir.iterdir())
    if not contents:
        return
    if not force:
        raise SystemExit(f"output directory is not empty: {run_dir}; pass --force")
    if not (run_dir / RUN_MARKER).is_file():
        raise SystemExit(
            f"refusing to replace unrecognized directory without {RUN_MARKER}: {run_dir}"
        )
    for child in contents:
        if child.is_dir() and not child.is_symlink():
            shutil.rmtree(child)
        else:
            child.unlink()


def action_entry(
    *,
    name: str,
    kind: str,
    spec: dict[str, object],
    state: str | None,
    run_dir: Path,
) -> dict[str, object]:
    frame_count = int(spec["frameCount"])
    base_duration = int(spec["frameDurationMs"])
    durations = [base_duration] * frame_count
    if "holdLastMs" in spec:
        durations[-1] = int(spec["holdLastMs"])
    return {
        "name": name,
        "kind": kind,
        "state": state,
        "summary": spec["summary"],
        "beats": spec["beats"],
        "frameCount": frame_count,
        "durationsMs": durations,
        "loop": bool(spec["loop"]),
        "status": "pending",
        "promptFile": f"prompts/{name}.md",
        "guideFile": f"layout-guides/{frame_count}-frames.png",
        "decodedPath": f"decoded/{name}.png",
        "framesDir": f"frames/{name}",
        "qaFile": f"qa/rows/{name}.json",
    }


def make_layout_guide(path: Path, frame_count: int, chroma_key: str) -> None:
    image = Image.new("RGB", (CELL_WIDTH * frame_count, CELL_HEIGHT), chroma_key)
    draw = ImageDraw.Draw(image)
    outline = "#7A2B7A"
    center = "#B74DB7"
    for index in range(frame_count):
        left = index * CELL_WIDTH
        draw.rectangle(
            (left + 4, 4, left + CELL_WIDTH - 5, CELL_HEIGHT - 5),
            outline=outline,
            width=2,
        )
        draw.line(
            (left + CELL_WIDTH // 2, 12, left + CELL_WIDTH // 2, CELL_HEIGHT - 12),
            fill=center,
            width=1,
        )
        draw.line(
            (left + 12, CELL_HEIGHT - 14, left + CELL_WIDTH - 12, CELL_HEIGHT - 14),
            fill=center,
            width=1,
        )
    image.save(path)


def write_prompt(
    path: Path,
    entry: dict[str, object],
    references: list[Path],
    style_notes: str,
    chroma_key: str,
) -> None:
    beats = "\n".join(
        f"{index + 1}. {beat}" for index, beat in enumerate(entry["beats"])
    )
    reference_lines = "\n".join(f"- {reference}" for reference in references)
    text = f"""Generate one coherent desktop pet action strip.

Action: {entry['name']}
Purpose: {entry['summary']}
Exact ordered frame count: {entry['frameCount']}
Loop: {str(entry['loop']).lower()}
Flat chroma background: {chroma_key}
Style notes: {style_notes or 'Preserve the canonical references exactly.'}

Ordered motion beats:
{beats}

Identity references:
{reference_lines}

Attach the matching layout guide as layout-only evidence. Draw one complete separated
full-body pose in each slot, left to right. Preserve the same pet identity, face,
silhouette, proportions, palette, material, markings, and props. Keep one shared scale,
stable baseline, safe padding, and progressive adjacent motion. Show anticipation,
primary action/contact, follow-through, and recovery where physically appropriate.

Use no text, labels, frame numbers, visible guides, scenery, floor, cast shadow, glow,
blur, motion trail, speed line, detached icon, detached sparkle, or cropped body part.
Do not let poses overlap or cross slot boundaries. The final output is the strip only.
"""
    path.write_text(text, encoding="utf-8")


if __name__ == "__main__":
    main()
