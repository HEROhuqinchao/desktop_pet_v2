#!/usr/bin/env python3
"""Exercise prepare, compose, and validate tools with deterministic test frames."""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw

CELL_WIDTH = 192
CELL_HEIGHT = 208


def main() -> None:
    skill_dir = Path(__file__).resolve().parent.parent
    project_root = skill_dir.parents[2]
    source_package = (
        project_root / "src" / "renderer" / "public" / "pets" / "tudou"
    )
    with tempfile.TemporaryDirectory(prefix="hatch-desktop-pet-smoke-") as temporary:
        root = Path(temporary)
        package_dir = root / "pet"
        run_dir = root / "run"
        shutil.copytree(source_package, package_dir)
        run(
            skill_dir / "scripts" / "prepare_action_run.py",
            "--pet-package",
            str(package_dir),
            "--output-dir",
            str(run_dir),
        )
        exercise_strip_extraction(skill_dir, root)
        plan = json.loads((run_dir / "action-plan.json").read_text(encoding="utf-8"))
        for action_index, action in enumerate(plan["actions"]):
            frames_dir = run_dir / action["framesDir"]
            frames_dir.mkdir(parents=True, exist_ok=True)
            for frame_index in range(action["frameCount"]):
                frame = Image.new(
                    "RGBA",
                    (CELL_WIDTH, CELL_HEIGHT),
                    (0, 0, 0, 0),
                )
                draw = ImageDraw.Draw(frame)
                offset = (frame_index % 3) - 1
                color = (
                    70 + action_index % 120,
                    110 + frame_index * 8,
                    170,
                    255,
                )
                draw.ellipse((58 + offset, 45, 134 + offset, 178), fill=color)
                frame.save(frames_dir / f"{frame_index:02d}.png")
        run(
            skill_dir / "scripts" / "compose_action_pack.py",
            "--run-dir",
            str(run_dir),
            "--package-dir",
            str(package_dir),
        )
        validation = run_dir / "qa" / "validation.json"
        run(
            skill_dir / "scripts" / "validate_action_pack.py",
            "--package-dir",
            str(package_dir),
            "--project-root",
            str(project_root),
            "--require-complete",
            "--json-out",
            str(validation),
        )
        report = json.loads(validation.read_text(encoding="utf-8"))
        if not report.get("ok"):
            raise SystemExit("smoke validation did not pass")
        print("smoke_test=pass")


def exercise_strip_extraction(skill_dir: Path, root: Path) -> None:
    strip_path = root / "strip.png"
    frame_count = 4
    strip = Image.new(
        "RGBA",
        (CELL_WIDTH * frame_count, CELL_HEIGHT),
        (255, 0, 255, 255),
    )
    draw = ImageDraw.Draw(strip)
    for index in range(frame_count):
        left = index * CELL_WIDTH + 58 + index
        draw.ellipse((left, 48, left + 76, 178), fill=(90, 150, 210, 255))
    strip.save(strip_path)
    report = root / "strip-review.json"
    run(
        skill_dir / "scripts" / "extract_action_strip.py",
        "--strip",
        str(strip_path),
        "--frame-count",
        str(frame_count),
        "--output-dir",
        str(root / "extracted"),
        "--json-out",
        str(report),
    )
    result = json.loads(report.read_text(encoding="utf-8"))
    if not result.get("ok") or len(result.get("frames", [])) != frame_count:
        raise SystemExit("strip extraction smoke test did not pass")


def run(script: Path, *arguments: str) -> None:
    subprocess.run(
        [sys.executable, str(script), *arguments],
        check=True,
    )


if __name__ == "__main__":
    main()
