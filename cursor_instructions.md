# Ad Variant Lab — Cursor Composer 升级指令

在 Cursor 中按 `Ctrl + I`（Win）或 `Cmd + I`（Mac）唤起 **Composer**，将下方整段粘贴执行。目标文件：`@index.html`、`@_lab_app_inline.js`。

---

请根据商业化、Client-ready（可直接给客户看）的标准，对 `@index.html` 和 `@_lab_app_inline.js` 进行以下三项功能升级与代码优化：

## 1. 改造 Midjourney 提示词导出功能

- 在 `index.html` 中：找到 ID 为 `btnCopyNanoBannerPrompt` 的按钮，将其文案修改为：**「📋 导出 Midjourney 商业级提示词」**。
- 在 `_lab_app_inline.js` 中：找到该按钮的点击事件监听器。重构其 `prompts` 生成逻辑：
  - 在 `buildVisualDrawPrompt` 生成的基础提示词前自动追加 `/imagine prompt: `；
  - 在提示词末尾追加 MJ 核心工业参数 ` --style raw --v 6.0 --q 2`；
  - 读取 `#ratio-select` 的当前选择值，动态映射并追加对应的 `--ar` 画幅比例参数（例如 9:16 → `--ar 9:16`，16:9 → `--ar 16:9`，1:1 → `--ar 1:1`，4:5 → `--ar 4:5`，2:3、21:9 等同理）。

## 2. 全面深化分镜脚本与动态风格裂变（升级 System Prompt）

- 在 `_lab_app_inline.js` 的 `craftSingleStyle` 函数内，找到 `systemPrompt` 变量。完全重写为顶级 4A 广告创意总监（Creative Director）设定，要求模型打破传统固定风格套路，根据产品名和品类自动裂变概念。
- 强制模型输出顶层 `styleName`（自定义创意风格名）和 `director_treatment`（深度视觉与听觉导演阐述）。
- 强化镜头颗粒度约束：
  - `visual`：场景陈设、画面色调、产品质感细节；
  - `motion`：矢量化专业运镜术语（Dolly in, Arc orbit, Rack focus 等）；
  - `lighting`：具体工业打光 Rig；
  - `audio`：可感知的物理质感 ASMR 音效。
- 第 1 批解析时保留 AI 返回的 `styleName`，勿被 `styleCfg.name` 覆盖。

## 3. 优化批次流水线（Batching）提示词

- 将「【分批串联死命令】」及指责性措辞（如「剧情推进太快」「总时长严重不足」）改为中性 **【分批串联指令】**。
- 将第 1 批「【分批策略死命令】」改为中性 **【分批策略指令】**。
- 示例（第 2 批起）：

```javascript
currentSystemPrompt +=
  "\n\n【分批串联指令】：这是第 " + batchCount + " 批请求。请顺滑承接上一镜，继续横向展开产品的使用场景、材质微观特写或用户情绪反应，补充至少 " +
  Math.min(batchSize, deficit) + " 个镜头以丰富故事厚度。切勿草草收尾。上一镜的画面是：「" + lastShotContext.visual + "」。";
```

## 约束

请严格保持原有的代码架构、闭包结构及逻辑校验完整性，不要随意删减防抖、超时、分批重试与 `enforceIntegerDuration` 等机制。

---

## 实现状态（仓库内已落地）

| 项 | 状态 |
|----|------|
| Midjourney 导出按钮与 `/imagine` + MJ 参数 + `--ar` | ✅ |
| `craftSingleStyle` System Prompt 4A 裂变 + Client-ready 颗粒度 | ✅ |
| `styleName` 从第 1 批 JSON 保留 | ✅ |
| Batching 中性串联/策略指令 | ✅ |
| `audio` ASMR 约束写入 System Prompt | ✅ |
