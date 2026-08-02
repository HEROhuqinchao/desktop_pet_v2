# 可运行示例：为土豆重建完整动作包

该示例使用项目内置 Codex v2 土豆包作为基础身份。真实生成时，把 `REFERENCE` 换成用户提供的角色图，并对每个 prompt 调用 `$imagegen`。

```bash
PROJECT=/absolute/path/to/desktop_pet_v2
SKILL="$PROJECT/.agents/skills/hatch-desktop-pet"
PACKAGE="$PROJECT/src/renderer/public/pets/tudou"
RUN=/absolute/path/to/tudou-action-run
REFERENCE=/absolute/path/to/tudou-reference.png

"$PYTHON" "$SKILL/scripts/prepare_action_run.py" \
  --pet-package "$PACKAGE" \
  --reference "$REFERENCE" \
  --output-dir "$RUN"
```

对 `action-plan.json` 中每个动作执行：

1. 用 `$imagegen` 读取对应 `promptFile`，附加 `identityReferences` 与 `guideFile`。
2. 将选中条带保存到 `decodedPath`。
3. 执行：

```bash
"$PYTHON" "$SKILL/scripts/extract_action_strip.py" \
  --strip "$RUN/decoded/petting.png" \
  --frame-count 8 \
  --output-dir "$RUN/frames/petting" \
  --chroma-key '#FF00FF' \
  --json-out "$RUN/qa/rows/petting.json"
```

全部动作通过视觉检查后：

```bash
"$PYTHON" "$SKILL/scripts/compose_action_pack.py" \
  --run-dir "$RUN" \
  --package-dir "$PACKAGE"

"$PYTHON" "$SKILL/scripts/validate_action_pack.py" \
  --package-dir "$PACKAGE" \
  --project-root "$PROJECT" \
  --require-complete \
  --json-out "$RUN/qa/validation.json"
```

工具链自身可用以下命令做无图像生成的结构冒烟测试：

```bash
"$PYTHON" "$SKILL/scripts/smoke_test.py"
```

冒烟测试生成的图像仅用于验证装配和校验器，不可作为正式宠物动作素材。
