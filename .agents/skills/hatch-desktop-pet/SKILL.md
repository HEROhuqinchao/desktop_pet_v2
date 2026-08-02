---
name: hatch-desktop-pet
description: Create, upgrade, repair, validate, and package action-complete pets for the desktop_pet_v2 project from one or more character reference images. Use when generating a new desktop pet, adding or refining sleep/eat/play/petting and other interaction animations, converting a Codex v1/v2 pet into a desktop_pet_v2 action pack, repairing inconsistent frames, or producing the Codex-compatible base atlas plus desktop-pet-actions.json and its optional action atlas.
---

# Hatch Desktop Pet

## Goal

Generate one identity-consistent pet package with two compatible layers:

1. Keep `pet.json` and `spritesheet.webp` compatible with Codex v2.
2. Add `desktop-pet-actions.json` and its atlas for desktop_pet_v2-only actions.

Never replace the Codex v2 contract with the extension. If the action sidecar is absent or an action is unmapped, desktop_pet_v2 must fall back to the base atlas.

## Required dependencies

Before running bundled Python scripts, call `load_workspace_dependencies` and use the returned Python executable. It must include Pillow.

Use `$imagegen` for every visual generation or repair. Read and follow its installed `SKILL.md` before generating. Do not call image APIs or create visual frames procedurally.

Use `$hatch-pet` for creating, upgrading, repairing, and validating the Codex v2 base package. Resolve it through `${CODEX_HOME:-$HOME/.codex}/skills/hatch-pet`; do not hard-code a user home path. If it is unavailable, stop and report that the Codex v2 base generator is required.

## Read references selectively

- Read [runtime-contract.md](references/runtime-contract.md) before planning or packaging actions.
- Read [animation-quality.md](references/animation-quality.md) before writing image prompts or accepting frames.
- Read [action-catalog.json](references/action-catalog.json) when preparing, extending, or auditing an action set.
- Read [example-workflow.md](references/example-workflow.md) when a runnable command sequence or smoke-test example is needed.

## Workflow

### 1. Classify the run

Choose exactly one:

- `new`: build the base Codex v2 pet and extension from references or text.
- `upgrade`: preserve an approved existing Codex v1/v2 pet, add missing v2 directions if necessary, then add the extension.
- `repair`: keep passing frames and regenerate only failed complete action strips.
- `refine`: rebuild selected older actions with better motion while preserving package identity and mappings.

Collect or infer the pet name, description, reference images, style, package directory, output directory, and whether optional creative actions are requested. Treat every image defining the face, silhouette, palette, markings, material, proportions, or props as an identity reference.

### 2. Establish the base identity

Run `$hatch-pet` first unless a validated Codex v2 package already exists. Its final `1536x2288` v2 atlas, `pet.json`, canonical base, contact sheet, and motion previews are the identity source of truth.

Do not generate extension actions from text alone after a base exists. Attach the canonical base and relevant approved frames to every action-strip generation.

### 3. Prepare the action run

Run:

```bash
"$PYTHON" scripts/prepare_action_run.py \
  --pet-package /absolute/path/to/pet-package \
  --reference /absolute/path/to/reference.png \
  --output-dir /absolute/path/to/action-run \
  --style-notes "<stable style notes>" \
  --force
```

Add `--include-creative` only when optional actions are requested. Inspect `action-plan.json`, prompts, and generated layout guides before image generation. The default complete profile covers every current behavior state and every runtime animation cue.

### 4. Generate action strips

For each pending action in `action-plan.json`:

1. Read its prompt file.
2. Attach every listed identity reference and its frame-count layout guide.
3. Ask `$imagegen` for one coherent horizontal strip containing the exact ordered pose count.
4. Require a flat chroma background, separated full-body poses, stable scale and baseline, no labels, no grid marks, no shadows, no detached effects, and no cropped parts.
5. Save the selected strip as `decoded/<action>.png`.
6. Extract it immediately:

```bash
"$PYTHON" scripts/extract_action_strip.py \
  --strip /absolute/path/to/action-run/decoded/<action>.png \
  --frame-count <count> \
  --output-dir /absolute/path/to/action-run/frames/<action> \
  --chroma-key '#FF00FF' \
  --json-out /absolute/path/to/action-run/qa/rows/<action>.json
```

Visually inspect the extracted loop before continuing. A generated strip is not complete merely because extraction succeeded.

### 5. Apply motion semantics

Keep every action readable at `192x208` and honor its beat list. Use anticipation, primary action/contact, follow-through, recovery, and a clean loop or final hold as appropriate.

Generate these as distinct actions, never aliases: `yawn`, `prepare-sleep`, `sleep`, `wake-up`, `eat`, `play`, and `petting`. State actions may loop according to the catalog. Runtime cues are always played once even if their source definition loops.

Preserve physical continuity across sleep transitions:

```text
yawn -> prepare-sleep -> sleep -> wake-up -> idle-refined
```

Do not bake project overlays or event scenery into frames unless the action catalog explicitly requires a held/attached prop. The renderer suppresses duplicate state overlays while an extension action is active and continues to render persistent/event overlays.

### 6. Assemble and validate

After every required action passes:

```bash
"$PYTHON" scripts/compose_action_pack.py \
  --run-dir /absolute/path/to/action-run \
  --package-dir /absolute/path/to/pet-package
```

Then run:

```bash
"$PYTHON" scripts/validate_action_pack.py \
  --package-dir /absolute/path/to/pet-package \
  --project-root /absolute/path/to/desktop_pet_v2 \
  --require-complete \
  --json-out /absolute/path/to/action-run/qa/validation.json
```

The composer must produce the sidecar, a lossless action atlas, a contact sheet, per-action GIF previews, and a coverage report. The validator must verify dimensions, used/unused cells, frame durations, state mappings, runtime cues, base Codex v2 compatibility, and file safety.

### 7. Visual QA

Inspect the final contact sheet and every required preview at normal pet size. Reject:

- identity, palette, material, proportion, face, or prop drift;
- mechanical translation, duplicate frames, inert loops, or unclear action semantics;
- baseline jumps, size popping, clipping, slot overlap, or transparent body holes;
- detached effects, floor shadows, labels, guide marks, or background remnants;
- sleep transitions that pop between unrelated body poses;
- directional motion that faces the wrong way or reverses cadence.

If one action fails, regenerate the complete containing strip. Never patch one final cell from an unrelated generation.

### 8. Project verification

After installing or modifying a package or runtime contract, run the project lint, typecheck, tests, and build. Run the lint autofix command when lint reports fixable issues, then rerun all checks.

## Completion report

Report absolute paths for the package, base atlas, action sidecar, action atlas, contact sheet, previews, coverage report, and validation report. Summarize mapped states, mapped cues, accepted optional actions, repairs, warnings, and project-check results.

Do not report success when required actions use undocumented fallbacks, deterministic validation fails, or final visual QA has unresolved major defects.
