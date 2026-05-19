/**
 * Ad Variant Lab - Director's Creative Engine (V2.0)
 * 完全对齐 .cursorrules.js 工业标准：
 * 1. 矢量化运动 (Vectorized Motion)
 * 2. 智能光影系统 (Lighting Rig)
 * 3. 视觉 DNA 提取 (Visual DNA)
 * 4. 空间坐标锚点 (Space Anchors)
 * 5. 绝对数据绑定 (Atomic Data Binding)
 *
 * 说明：卖点简报 LLM（directorVisionTransformLLM、renderBriefFromParsed）在 ad-variant-lab.html 的内联脚本中，不在本文件。
 */
(function () {
  const btnCraftStoryboard = document.getElementById("btnCraftStoryboard");
  if (!btnCraftStoryboard) return;

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* ========== 网络层（不修改分镜导演逻辑） ==========
   * - Origin：浏览器对跨域 fetch 自动附加，JS 无法手动设置（非缺失字段）
   * - Referer：由 referrerPolicy 控制；当前默认 strict-origin-when-cross-origin（见 ad-variant-lab.html → llmApiFetch）
   * - 403：能收到 HTTP 状态码，见 Console [LLM API] HTTP 错误
   * - Failed to fetch：通常无状态码，多为 CORS/断网/插件，不是 403
   * - 若中转站强制后端调用：需自建代理，前端无法仅靠加请求头解决
   */

  function isLlmFailedToFetch(err) {
    var m = err && err.message ? String(err.message) : String(err || "");
    var low = m.toLowerCase();
    return (
      (err && err.name === "TypeError" && low.indexOf("fetch") !== -1) ||
      low.indexOf("failed to fetch") !== -1 ||
      low.indexOf("networkerror") !== -1 ||
      low.indexOf("load failed") !== -1
    );
  }

  /** fetch / HTTP 失败时用于 alert */
  function formatLlmFetchAlertMessage(err, context) {
    var msg = err && err.message ? String(err.message) : String(err || "");
    if (/【403|【401|【429|HTTP 状态：/.test(msg)) {
      return msg;
    }
    if (typeof window.formatLlmFetchError === "function") {
      return window.formatLlmFetchError(err, context);
    }
    return (context ? context + "：" : "") + msg;
  }

  function shouldAlertApiFailure(err) {
    if (isLlmFailedToFetch(err)) return true;
    var m = err && err.message ? String(err.message) : "";
    return /【403|【401|【429|HTTP 状态：|CORS/.test(m);
  }

  function llmApiFetch(path, options) {
    if (typeof window.llmApiFetch !== "function") {
      throw new Error("llmApiFetch 未加载，请确认 ad-variant-lab.html 已引入网络层脚本");
    }
    return window.llmApiFetch(path, options);
  }

  var llmFetchFailAlertShown = false;

  function maybeAlertLlmFetchFailure(err, context) {
    if (llmFetchFailAlertShown || !shouldAlertApiFailure(err)) return;
    llmFetchFailAlertShown = true;
    alert(formatLlmFetchAlertMessage(err, context));
  }

  function warnIfFileProtocol() {
    if (typeof location !== "undefined" && location.protocol === "file:") {
      console.warn(
        "[分镜引擎] 当前为 file:// 协议。请安装 Live Server，右键 ad-variant-lab.html → Open with Live Server，" +
          "地址栏应显示 http://127.0.0.1:5500/... 而非 file://"
      );
    }
  }

  /** 通用素材绑定与物理一致性规则（与 .cursorrules.js §7 同源） */
  const UNIVERSAL_BINDING_RULES = {
    VISUAL_CATEGORIES: {
      ESTABLISHING: "远景/全景，交代产品所处环境或包装外盒",
      HERO_SHOT: "中景，完整展示产品主体的轮廓与全貌",
      DETAIL_MACRO: "特写，展示材质肌理、精细部件或物理参数标识",
      INTERACTIVE: "功能演示，包含人手操作或物体动态变化",
    },
    ALIGNMENT_LOGIC:
      "- 严禁描述与素材景别冲突：若 visual 为「展示整体外形」，source_image_id 须匹配 HERO_SHOT。\n" +
      "- 严禁描述与材质特征冲突：visual 提及「磨砂」须对应 features 含 matte/磨砂 的素材。\n" +
      "- 生成每镜前须交叉比对描述关键词与素材标签；无匹配景别时改创意而非错配 ID。",
  };

  function normalizeUniversalVisualClass(clsRaw) {
    var c = String(clsRaw || "").trim().toLowerCase();
    if (!c || c === "未识别") return "HERO_SHOT";
    if (/^establishing|establish|环境|场景|全景|远景|包装|pack|box|wide|context|lifestyle|scene/.test(c)) {
      return "ESTABLISHING";
    }
    if (/^interactive|操作|演示|hand|人手|动作|佩戴|使用|interaction/.test(c)) {
      return "INTERACTIVE";
    }
    if (
      /^detail_macro|detail|macro|微距|特写|细节|texture|肌理|零件|movement|机芯|dial|表盘|component|internal|macro/.test(
        c
      )
    ) {
      return "DETAIL_MACRO";
    }
    if (/^hero_shot|hero|主体|全貌|产品|product|中景|medium/.test(c)) {
      return "HERO_SHOT";
    }
    if (/establish|环境|场景|全景|远景|包装|pack|box|wide/.test(c)) return "ESTABLISHING";
    if (/interactive|操作|演示|手|佩戴|使用/.test(c)) return "INTERACTIVE";
    if (/macro|微距|特写|细节|肌理|零件|机芯|表盘|internal|component|detail/.test(c)) {
      return "DETAIL_MACRO";
    }
    return "HERO_SHOT";
  }

  function buildUniversalBindingPromptBlock(catalogSlotCount) {
    var cats = UNIVERSAL_BINDING_RULES.VISUAL_CATEGORIES;
    var lines =
      "【全产业素材匹配死命令 · 通用物理语义锚点】\n" +
      "预扫描：根据 materialCatalog 中每张图的 data-visual-class（仅限 ESTABLISHING / HERO_SHOT / DETAIL_MACRO / INTERACTIVE）在内心分库。\n" +
      "思维链：每镜 JSON 必须含 matching_reason（一句中文，且**必须引用**所选素材的 data-visual-features 原文或关键词，格式示例：「选择 #2 是因为其 features 包含『拉丝金属』，符合本镜微距质感描述」；并说明本镜属于四大景别中的哪一种）。\n" +
      "ID 强制绑定：\n" +
      "- visual 含「细节、纹理、微观、微距、特写」→ source_image_id 只能选 DETAIL_MACRO 标记的图。\n" +
      "- visual 含「环境、氛围、背景、全景、远景」→ 只能选 ESTABLISHING。\n" +
      "- visual 含「操作、演示、佩戴、人手」→ 只能选 INTERACTIVE。\n" +
      "- visual 含「整体、全貌、轮廓、主体」→ 只能选 HERO_SHOT。\n" +
      "严禁「全景图写螺丝钉」「特写文案配环境图」式逻辑漂移。若库中无匹配景别，必须改写 visual 以适配现有素材，禁止错填 ID。\n" +
      "景别定义：ESTABLISHING=" +
      cats.ESTABLISHING +
      "；HERO_SHOT=" +
      cats.HERO_SHOT +
      "；DETAIL_MACRO=" +
      cats.DETAIL_MACRO +
      "；INTERACTIVE=" +
      cats.INTERACTIVE +
      "。\n" +
      UNIVERSAL_BINDING_RULES.ALIGNMENT_LOGIC +
      "\n";
    if (catalogSlotCount > 0) return lines;
    return "";
  }

  function inferVisualIntentFromShot(vis) {
    var v = String(vis || "").toLowerCase();

    /** 景别 / 镜头运动词库（全行业 EN + CN，优先于零件名词） */
    if (
      /\bzoom\s*in\b|push\s*in\b|dolly\s*in\b|truck\s*in\b|close[-\s]?up\b|\becu\b|extreme\s+close|tight\s+shot|insert\s+shot|macro\s+shot|detail\s+shot|magnif|微距|特写|近景|推近|变焦推近|局部放大|大特写/.test(
        v
      )
    ) {
      return "DETAIL_MACRO";
    }
    if (
      /\bzoom\s*out\b|pull[-\s]?back\b|dolly\s*out\b|truck\s*out\b|\bwide\b|wide[-\s]?shot\b|establishing\b|full[-\s]?frame\b|master\s+shot|long\s+shot|panoramic|aerial\s+view|全景|远景|大全景|拉开|环视|鸟瞰|环境建立/.test(
        v
      )
    ) {
      return "ESTABLISHING";
    }
    if (
      /\bpan\b|\btilt\b|arc\s+orbit|orbit\b|whip\s+pan|handheld|跟拍|摇镜|环绕|甩镜|手持/.test(v) &&
      !/微距|特写|close[-\s]?up|wide|全景|远景/.test(v)
    ) {
      return "HERO_SHOT";
    }
    if (
      /操作|演示|佩戴|拿起|旋转|按键|触碰|人手|手指|使用|交互|unbox|开箱|grip|twist|press|滑动|佩戴|穿戴|interactive|hands?\s+on/.test(
        v
      )
    ) {
      return "INTERACTIVE";
    }
    if (
      /微距|细节|纹理|肌理|特写|macro|刻面|材质细节|精细|部件|参数标识|surface\s+detail|texture|grain|matte|磨砂|拉丝|抛光/.test(
        v
      )
    ) {
      return "DETAIL_MACRO";
    }
    if (/环境|氛围|背景|场景|空间|窗外|室内|包装|外盒|establish|lifestyle\s+scene|room\s+interior/.test(v)) {
      return "ESTABLISHING";
    }
    if (
      /\bmedium\s+shot\b|mid[-\s]?shot\b|hero\s+shot|product\s+shot|full\s+product|整体|全貌|轮廓|hero|主体|完整展示|产品正面|中景|半身产品/.test(
        v
      )
    ) {
      return "HERO_SHOT";
    }
    return null;
  }

  function findGalleryIndexByUniversalClass(wantClass) {
    var items = document.querySelectorAll("#product-gallery .gallery-item");
    var wi;
    for (wi = 0; wi < items.length; wi++) {
      var norm = normalizeUniversalVisualClass(items[wi].getAttribute("data-visual-class"));
      if (norm === wantClass) return wi + 1;
    }
    return null;
  }

  /** 通用纠偏：基于景别/动作语义与 Vision 标签的一致性 */
  function universalAssetCorrection(shot, meta) {
    if (!shot || !meta) return;
    var vis = String(shot.visual || "");
    var cls = normalizeUniversalVisualClass(meta.className);
    var intent = inferVisualIntentFromShot(vis);
    if (!intent) return;

    if (intent === "DETAIL_MACRO" && cls === "ESTABLISHING") {
      shot.visual = vis.replace(/细节|特写|微距/g, "全景呈现");
      var altMacro = findGalleryIndexByUniversalClass("DETAIL_MACRO");
      if (altMacro != null && shot.source_image_id != null) shot.source_image_id = altMacro;
    }

    if (intent === "ESTABLISHING" && cls === "DETAIL_MACRO") {
      shot.visual = vis.replace(/全景|远景|环境|氛围/g, "局部质感");
      var altEst = findGalleryIndexByUniversalClass("ESTABLISHING");
      if (altEst != null && shot.source_image_id != null) shot.source_image_id = altEst;
    }

    if (intent === "HERO_SHOT" && cls === "DETAIL_MACRO") {
      var altHero = findGalleryIndexByUniversalClass("HERO_SHOT");
      if (altHero != null && shot.source_image_id != null) shot.source_image_id = altHero;
    }

    vis = String(shot.visual || "");
    if (/操作|演示/.test(vis) && cls !== "INTERACTIVE") {
      shot.visual = vis.replace(/操作|演示/g, "静态展示");
      var altInt = findGalleryIndexByUniversalClass("INTERACTIVE");
      if (altInt != null && shot.source_image_id != null) shot.source_image_id = altInt;
      return;
    }

    if (intent && cls && intent !== cls) {
      var altMatch = findGalleryIndexByUniversalClass(intent);
      if (altMatch != null && shot.source_image_id != null) shot.source_image_id = altMatch;
    }
  }

  function getMaterialGridCount() {
    try {
      const getter = window.__getStoryboardImageFiles;
      const files = typeof getter === "function" ? getter() : [];
      return Array.isArray(files) ? files.length : 0;
    } catch (e) {
      return 0;
    }
  }

  async function analyzeImagesWithVision(files, apiKey, progressCallback) {
    if (!files || files.length === 0) return null;

    const fileToBase64 = (file) =>
      new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

    const BATCH_SIZE = 5;
    const fileCount = files.length;
    let masterPrompt = "";

    function visionSlotPlaceholder(globalIdx) {
      return {
        class: "HERO_SHOT",
        features: "未识别特征（索引占位 #" + (globalIdx + 1) + "）",
      };
    }

    const combinedImages = new Array(fileCount);
    for (let idx = 0; idx < fileCount; idx++) {
      combinedImages[idx] = visionSlotPlaceholder(idx);
    }

    for (let i = 0; i < fileCount; i += BATCH_SIZE) {
      const batchFiles = Array.prototype.slice.call(files, i, i + BATCH_SIZE);

      if (progressCallback) {
        const endNum = Math.min(i + BATCH_SIZE, fileCount);
        progressCallback(
          `👁️ AI 摄影指导正在解析第 ${i + 1} - ${endNum} 张图片 (共 ${fileCount} 张)...`,
          5 + (i / fileCount) * 15
        );
      }

      const content = [
        {
          type: "text",
          text:
            '你是一位顶级商业广告摄影指导。请仔细观察这些产品图片（本批共 ' +
            batchFiles.length +
            ' 张，请按顺序逐张输出 images 数组，长度必须等于 ' +
            batchFiles.length +
            '）。1. 识别品牌/型号或具体物理特征（不限品类）。2. 为每张图标注通用景别标签 class（仅限四选一：ESTABLISHING / HERO_SHOT / DETAIL_MACRO / INTERACTIVE）。3. 在 features 中写材质、反光、景别与可见细节（可含 matte/磨砂 等英文材质词）。返回JSON：{"master_prompt": "用于DALL-E的顶级英文产品外观描述", "images": [{"class": "HERO_SHOT", "features": "高度具体的物理特征与景别描述"}]}',
        },
      ];

      for (let j = 0; j < batchFiles.length; j++) {
        const b64 = await fileToBase64(batchFiles[j]);
        content.push({ type: "image_url", image_url: { url: b64, detail: "low" } });
      }

      try {
        const res = await llmApiFetch("chat/completions", {
          label: "视觉预分析",
          apiKey: apiKey,
          body: JSON.stringify({
            model: window.getTextModel(),
            messages: [{ role: "user", content: content }],
            response_format: { type: "json_object" },
          }),
        });

        const data = await res.json();
        if (!data.choices || !data.choices[0]) throw new Error("视觉分析响应为空");

        const parsed = JSON.parse(data.choices[0].message.content);
        if (!masterPrompt && parsed.master_prompt) masterPrompt = parsed.master_prompt;

        const batchImages =
          parsed.images && Array.isArray(parsed.images) ? parsed.images : [];

        for (let j = 0; j < batchFiles.length; j++) {
          const globalIdx = i + j;
          const entry = batchImages[j];
          if (entry && (entry.class != null || entry.features != null)) {
            combinedImages[globalIdx] = {
              class: entry.class != null ? String(entry.class) : "HERO_SHOT",
              features:
                entry.features != null ? String(entry.features) : "未识别特征（#" + (globalIdx + 1) + "）",
            };
          } else {
            combinedImages[globalIdx] = visionSlotPlaceholder(globalIdx);
          }
        }
      } catch (e) {
        console.warn(`第 ${Math.floor(i / BATCH_SIZE) + 1} 批次视觉解析失败`, e);
        for (let j = 0; j < batchFiles.length; j++) {
          const globalIdx = i + j;
          combinedImages[globalIdx] = {
            class: "HERO_SHOT",
            features: "批次解析失败（索引 #" + (globalIdx + 1) + "）",
          };
        }
      }
    }

    return { master_prompt: masterPrompt, images: combinedImages };
  }

  /** 使用场景行：供 Style B 单一贯穿主场景；可由页面注入 window.__getStoryboardUsageScenarios */
  function collectUsageScenarios() {
    try {
      if (typeof window.__getStoryboardUsageScenarios === "function") {
        var u = window.__getStoryboardUsageScenarios();
        if (u != null) return String(u).trim();
      }
    } catch (e) {
      /* ignore */
    }
    var el = document.getElementById("usage-scenarios-textarea");
    if (el && String(el.value || "").trim()) return String(el.value).trim();
    return "";
  }

  btnCraftStoryboard.addEventListener("click", async function () {
    warnIfFileProtocol();
    const apiKey =
      typeof window.getLlmApiKeyFromInput === "function"
        ? window.getLlmApiKeyFromInput()
        : String(document.getElementById("llm-api-key").value || "").trim();
    const briefContent = document.getElementById("selling-textarea").value.trim();

    var dashClear = document.getElementById("storyDashboard");
    if (dashClear) {
      dashClear.classList.remove("story-board-finalized");
      dashClear.style.boxShadow = "";
    }

    if (!apiKey) return alert("请先输入 OPENAI API KEY");
    if (!briefContent || briefContent.indexOf("【API 请求失败】") !== -1) {
      return alert("请先上传素材并等待‘卖点简报’解析完成");
    }

    const storyModsEl = document.getElementById("storyScriptMods");

    const params = {
      platform: document.getElementById("platform-select").value,
      ratio: document.getElementById("ratio-select").value,
      duration: document.getElementById("durLabel").innerText,
      product: document.getElementById("product-input").value,
      category: document.getElementById("category-input").value,
      brief: briefContent,
      mods: storyModsEl ? String(storyModsEl.value || "") : "",
      materialCount: getMaterialGridCount(),
      usage_scenarios: collectUsageScenarios(),
    };

    setLabBusy(true);
    try {
      const getter = window.__getStoryboardImageFiles;
      const files = typeof getter === "function" ? getter() : [];
      if (files.length > 0) {
        try {
          const visionData = await analyzeImagesWithVision(files, apiKey, function (msg, pct) {
            setStoryEngineProgress(msg, pct);
          });
          if (visionData && visionData.images) {
            window.__MASTER_VISUAL_PROMPT__ = visionData.master_prompt;
            const items = document.querySelectorAll("#product-gallery .gallery-item");
            for (let i = 0; i < items.length; i++) {
              if (visionData.images[i] && items[i]) {
                items[i].setAttribute(
                  "data-visual-class",
                  normalizeUniversalVisualClass(visionData.images[i].class)
                );
                items[i].setAttribute("data-visual-features", visionData.images[i].features);
              }
            }
          }
        } catch (e) {
          console.warn("视觉预分析整体失败", e);
        }
      } else {
        window.__MASTER_VISUAL_PROMPT__ = params.product;
      }

      const storyboardData = await generateThreeStyleStoryboards(params, apiKey);
      renderStoryboardDashboard(storyboardData);
      setStoryEngineProgress("✅ 三套分镜已就绪（时长与视觉绑定已物理校准）", 100);
      setTimeout(function () {
        clearStoryEngineProgress();
      }, 2200);
    } catch (err) {
      alert(formatLlmFetchAlertMessage(err, "分镜引擎故障"));
      clearStoryEngineProgress();
    } finally {
      setLabBusy(false);
    }
  });

  /** 分镜引擎实时进度（插入在 Craft Storyboard 按钮下方） */
  function setStoryEngineProgress(text, pct) {
    var host = document.getElementById("lab-story-engine-progress");
    if (!host) {
      var btn = document.getElementById("btnCraftStoryboard");
      host = document.createElement("div");
      host.id = "lab-story-engine-progress";
      host.setAttribute("role", "status");
      host.setAttribute("aria-live", "polite");
      host.style.cssText = "margin:12px 0 0;width:100%;max-width:720px;";
      host.innerHTML =
        '<div style="height:8px;background:rgba(0,0,0,0.08);border-radius:8px;overflow:hidden">' +
        '<div id="lab-story-engine-progress-bar" style="height:100%;width:0%;background:var(--blue);transition:width .28s ease"></div></div>' +
        '<div id="lab-story-engine-progress-label" style="font-size:12px;color:#555;margin-top:8px;line-height:1.45"></div>';
      if (btn && btn.parentNode) btn.parentNode.insertBefore(host, btn.nextSibling);
      else document.body.appendChild(host);
    }
    var bar = document.getElementById("lab-story-engine-progress-bar");
    var lab = document.getElementById("lab-story-engine-progress-label");
    if (bar) bar.style.width = Math.max(0, Math.min(100, pct == null ? 0 : pct)) + "%";
    if (lab) lab.textContent = text || "";
  }

  function clearStoryEngineProgress() {
    var host = document.getElementById("lab-story-engine-progress");
    if (host) host.remove();
  }

  /** 终极智能补全：支持对象 {} 和 数组 [] 混合嵌套精准修复 */
  function parseJsonWithClosingBraceRepair(slice) {
    var s = String(slice || "").trim();
    if (!s) throw new Error("空 JSON 片段");

    var inStr = false;
    var strQuote = "";
    var esc = false;
    var stack = [];

    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (esc) {
        esc = false;
        continue;
      }
      if (inStr) {
        if (c === "\\") esc = true;
        else if (c === strQuote) inStr = false;
        continue;
      }
      if (c === '"' || c === "'") {
        inStr = true;
        strQuote = c;
        continue;
      }

      if (c === "{" || c === "[") {
        stack.push(c);
      } else if (c === "}") {
        if (stack.length > 0 && stack[stack.length - 1] === "{") stack.pop();
      } else if (c === "]") {
        if (stack.length > 0 && stack[stack.length - 1] === "[") stack.pop();
      }
    }

    if (inStr) s += strQuote;

    for (var j = stack.length - 1; j >= 0; j--) {
      if (stack[j] === "{") s += "}";
      else if (stack[j] === "[") s += "]";
    }

    try {
      return JSON.parse(s);
    } catch (e1) {
      try {
        return JSON.parse(s + "}");
      } catch (e2) {
        /* continue */
      }
      try {
        return JSON.parse(s + "]}");
      } catch (e3) {
        /* continue */
      }
      throw e1;
    }
  }

  /** 从模型原文中提取最外层 {...} */
  function extractOutermostJsonBlock(raw) {
    const s = String(raw == null ? "" : raw)
      .replace(/```json\s*|```/gi, "")
      .trim();
    const start = s.search(/\{/);
    if (start === -1) return null;
    var depth = 0;
    var inStr = false;
    var strQuote = "";
    var esc = false;
    for (var i = start; i < s.length; i++) {
      var c = s.charAt(i);
      if (esc) {
        esc = false;
        continue;
      }
      if (inStr) {
        if (c === "\\") esc = true;
        else if (c === strQuote) inStr = false;
        continue;
      }
      if (c === '"' || c === "'") {
        inStr = true;
        strQuote = c;
        continue;
      }
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) return s.substring(start, i + 1);
      }
    }
    if (depth > 0) return s.substring(start);
    return null;
  }

  async function generateThreeStyleStoryboards(p, key) {
    setStoryEngineProgress("分镜引擎启动：将依次处理 Style A / B / C…", 1);

    const files = typeof window.__getStoryboardImageFiles === "function" ? window.__getStoryboardImageFiles() : [];
    const base64Images = [];
    const fileToBase64 = (file) =>
      new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(file);
      });
    for (let i = 0; i < Math.min(files.length, 6); i++) {
      base64Images.push(await fileToBase64(files[i]));
    }
    if (base64Images.length > 0) {
      setStoryEngineProgress(
        "👁️ 已载入 " + base64Images.length + " 张产品参考图，导演将「看着图」写分镜…",
        3
      );
    }

    const n = Number(p.materialCount) || 0;

    /** 通用景别标签 → 目录可读简称（与 normalizeUniversalVisualClass 同源） */
    function humanizeVisualClassForCatalog(clsRaw) {
      var code = normalizeUniversalVisualClass(clsRaw);
      var labels = {
        ESTABLISHING: "环境/全景 (ESTABLISHING)",
        HERO_SHOT: "主体全貌 (HERO_SHOT)",
        DETAIL_MACRO: "特写微距 (DETAIL_MACRO)",
        INTERACTIVE: "功能演示 (INTERACTIVE)",
      };
      return labels[code] || code;
    }

    var galItems = document.querySelectorAll("#product-gallery .gallery-item");
    var catalogSlotCount = galItems.length > 0 ? galItems.length : n;

    var materialCatalog = "";
    var materialCatalogLines = [];
    if (catalogSlotCount > 0) {
      materialCatalog = "【素材目录详情】：\n";
      var mi;
      for (mi = 0; mi < catalogSlotCount; mi++) {
        var meta = getGalleryCellMeta(mi);
        var cn = (meta && meta.className) || "未分类";
        var ftPlain = (meta && meta.features) || "通用质感";
        materialCatalog += "#" + (mi + 1) + ": [" + cn + "] 特征: " + ftPlain + "\n";
        var ftRaw = meta && meta.features ? collapseSpaces(meta.features) : "通用质感";
        var clsLabel = humanizeVisualClassForCatalog(meta && meta.className);
        var featLine = ftRaw;
        if (featLine.length > 160) featLine = featLine.slice(0, 157) + "…";
        materialCatalogLines.push("#" + (mi + 1) + ": [" + clsLabel + "] " + featLine);
      }
    }
    const gridHint =
      (catalogSlotCount > 0
        ? "【素材索引】已上传 " +
          catalogSlotCount +
          " 张图 (#1～#" +
          catalogSlotCount +
          ")。请在每镜 source_image_id 中填整数序号；**不要**在 visual 正文写 # 或「素材格」。\n" +
          materialCatalog +
          "【素材目录】（data-visual-class 为通用景别锚点 ESTABLISHING/HERO_SHOT/DETAIL_MACRO/INTERACTIVE；须与 visual 景别交叉比对后再填 source_image_id；单行摘要：" +
          materialCatalogLines.join("；") +
          "）\n" +
          "【素材目录·分行】\n" +
          materialCatalogLines.join("\n") +
          "\n"
        : "【素材索引】无图；source_image_id 可统一填 1。\n") +
      "【JSON 输出备忘录】顶层 director_treatment + shots；每镜 visual（纯中文）、motion（可选）、source_image_id、duration（物理秒数，严禁 duration_weight）；禁止无产品前摇。\n" +
      (catalogSlotCount > 0 ? "【素材调度】共 " + catalogSlotCount + " 张，请按语义分配 1～" + catalogSlotCount + "，勿机械顺子。\n" : "") +
      "\n";

    function deriveUsageFromBrief(brief) {
      var b = String(brief || "");
      var m = b.match(/(?:使用场景|usage_scenarios)\s*[：:]\s*([^\n]+)/i);
      if (m) return m[1].trim();
      return "";
    }

    var usageScenariosRaw = String(p.usage_scenarios || "").trim();
    if (!usageScenariosRaw) usageScenariosRaw = deriveUsageFromBrief(p.brief);

    var usageScenariosForPrompt =
      usageScenariosRaw ||
      "（未单独检出：请仅从 [uspSummary] 中可核对的场景相关原子短语里抽取一条，作为本套 Style B 唯一贯穿主场景关键词；不得发明 briefing 外的新场景名。）";

    const stylesToCraft = [
      {
        id: "A",
        name: "Style A (Precision 专业美学/极致克制)",
        focus:
          "【逻辑：精密验证】全片必须在极简、高冷的“真空”工作坊内，展现“极端完美主义者”与产品的物理角力。必须遵循：1.微观动作验证（防静电指套、镊子）；2.机位仅限极缓 Dolly In/Out 观察材质物理结构；3.【硬性结尾】：最后一镜必须拉开展现成品全貌并在 Rim Light 下定格。严禁全景环境，严禁烟火气。",
      },
      {
        id: "B",
        name: "Style B (Lifestyle 情感叙事/真实生活)",
        focus:
          "【逻辑：身份共生】全片必须彻底移除“工作室”语汇，设定为“生活鉴赏家”。必须遵循「建立-生活-流露」的三幕叙事（严禁用碎镜堆砌，用 5-8 镜拆解）：Act 1 (环境建立) 为 [usage_scenarios] 建立阶层空间；Act 2 (生活动作) 人物充满仪式感的非功利动作；Act 3 (产品整合) 借动作自然流露产品。必须利用光影切面分割空间，杜绝死平光。",
      },
      {
        id: "C",
        name: "Style C (Hook-Driven 视觉冲击/极速快剪)",
        focus:
          "【逻辑：视觉谜题】严禁重复 A 的微距观察。必须利用‘视觉错觉’。核心指令：1.首镜钩子必须是非辨识性肌理或动作触发；2.强制利用 Match Cut（匹配剪辑）进行跨维度跳跃；3.强制使用 Whip Pan（甩镜头）、运动模糊和 Speed Ramp（变速），营造‘暴力美学’奇观，并配合极致 ASMR 音效。",
      },
    ];

    /** 读取宫格 DOM 元数据（可选）：data-visual-class、data-visual-features */
    function getGalleryCellMeta(idx0) {
      var items = document.querySelectorAll("#product-gallery .gallery-item");
      var el = items[idx0];
      if (!el) return null;
      var cls = (el.getAttribute("data-visual-class") || "").trim().toLowerCase();
      var feats = (el.getAttribute("data-visual-features") || el.getAttribute("data-visual-notes") || "").trim();
      return { className: cls, features: feats };
    }

    var GRID_REF_RE = /\(参考素材格\s*#(\d+)\)/;

    /**
     * 分类负面词：若 data-visual-class 语义命中某类，则 visual 禁止出现对应空间/外型语汇
     * class 支持 internal/movement/component、detail/macro 等组合写法
     */
    var CATEGORY_NEGATIVE_KEYWORDS = [
      {
        id: "internal_movement_component",
        classTest: function (clsRaw) {
          return /internal|movement|component|机芯|零件|内部|底盖|背面|case_back|mvt|calibre/i.test(clsRaw);
        },
        forbidRe: /外壳|外包装|包装箱|完整外观|全身外观|Logo|标识牌|礼盒|开箱|外盒|表盒/i,
        label: "外壳/包装/完整外观/Logo 等外型语汇",
      },
      {
        id: "detail_macro",
        classTest: function (clsRaw) {
          return /detail|macro|微距|细节|特写/i.test(clsRaw);
        },
        forbidRe: /全景|大环境|远景|大场景|广角建立|城市天际|街道全景|窗外楼群/i,
        label: "全景/环境/远景等大空间语汇",
      },
    ];

    /**
     * 核心功能词：若 features 未闭环，由 applyStoryboardVisualRewrites 弱化措辞而非中断。
     */
    var CORE_FUNCTION_TERM_RULES = [
      { visualRe: /拉丝|拔丝|芝士丝|奶酪丝/i, featuresRe: /拉丝|拔丝|丝状|纤维/i, label: "拉丝/拔丝类食物质感" },
      { visualRe: /(?:Type-C|USB-C|USB接口|雷电接口|充电口|数据口|接口|端子|插孔)/i, featuresRe: /接口|USB|Type-C|充电|端子|插孔|孔位/i, label: "接口/孔位类" },
      { visualRe: /质地|膏体|乳液|雾面|哑光|水润|成膜|显色/i, featuresRe: /质地|膏体|乳液|雾面|哑光|水润|成膜|显色/i, label: "质地/妆效" },
      { visualRe: /起泡|泡沫|碳酸|气泡/i, featuresRe: /起泡|泡沫|碳酸|气泡/i, label: "起泡/碳酸类" },
      { visualRe: /续航|毫安|mAh|快充|无线充电/i, featuresRe: /续航|电池|毫安|mAh|快充|无线充/i, label: "续航/充电参数类" },
    ];

    var DIAL_FACE_TERMS_RE =
      /表盘|刻度|指针|6点位|六点|时标|子表盘|字面|字钉|时针|分针|十二点位|12点位|刻度圈|表镜|表玻璃|太阳纹盘|盘面珠光|盘面/i;
    var MOVEMENT_CLUSTER_RE = /机芯|夹板|擒纵|摆轮|游丝|发条|传动齿|齿轮组|红宝石轴眼|红宝石轴承|背透|陀飞轮框架/i;

    function isMovementGridForDialBan(cls) {
      var c = String(cls || "").trim().toLowerCase();
      if (!c) return false;
      if (c === "movement") return true;
      return /^(case_back|caseback|mvt|calibre|back|底盖|背盖|背面|机芯)/i.test(c) || c.indexOf("机芯") !== -1 || c.indexOf("背") !== -1;
    }

    var SUBSECOND_VISUAL_RE = /小秒|小秒针|小秒盘|子秒盘|子表盘|偏心秒|六点位小秒|六点位秒/i;
    var SUBSECOND_FEATURES_RE = /小秒|子秒|子表盘|秒盘|偏心秒|六点位秒/i;

    var GRID_REF_REPLACE_G = /\(参考素材格\s*#(\d+)\)/g;
    /** 贵重材质脑补词：仅当 [uspSummary] 原文含该词时才允许保留 */
    var GEMSTONE_HALLUCINATION_RE = /红宝石|蓝宝石|鸽血红|祖母绿|帕拉伊巴|沙弗莱|红刚玉|蓝刚玉/gi;

    function roundDurD(x) {
      var n = parseFloat(x);
      if (isNaN(n) || n < 0) return 0;
      return Math.round(n * 100) / 100;
    }

    function collapseSpaces(s) {
      return String(s || "")
        .replace(/\s{2,}/g, " ")
        .replace(/\s+([，。、；：])/g, "$1")
        .trim();
    }

    function stripGemstonesNotInBrief(text, brief) {
      var b = String(brief || "").toLowerCase();
      return String(text || "").replace(GEMSTONE_HALLUCINATION_RE, function (m) {
        if (b.indexOf(String(m).toLowerCase()) !== -1) return m;
        return "";
      });
    }

    function stripSystemTokensFromVisual(vis) {
      var s = String(vis || "");
      s = s.replace(GRID_REF_REPLACE_G, "");
      s = s.replace(/\(参考素材格\s*：\s*无\)/g, "");
      s = s.replace(/参考素材格|素材格/g, "");
      s = s.replace(/#\d+\s*表面/g, "");
      s = s.replace(/#\d+\s*号格?/g, "");
      return collapseSpaces(s);
    }

    function shotsAppearDecoupled(shots) {
      if (!Array.isArray(shots) || !shots.length) return false;
      var s0 = shots[0];
      return !!(s0 && s0.source_image_id != null);
    }

    function fillDefaultShotFields(shot, styleCfg) {
      if (!shot) return;
      if (shot.audio == null || !String(shot.audio).trim()) shot.audio = "环境声铺底";
      if (shot.start_motion == null || !String(shot.start_motion).trim()) shot.start_motion = "起幅稳定";
      if (shot.end_motion == null || !String(shot.end_motion).trim()) shot.end_motion = "落幅";
      if (shot.transition == null || !String(shot.transition).trim()) shot.transition = "切";
      if (shot.lighting == null || !String(shot.lighting).trim()) {
        shot.lighting =
          styleCfg.id === "A" ? "Rim 边缘冷光" : styleCfg.id === "B" ? "自然窗光" : "硬边高光与变速段";
      }
      if (shot.pacing == null || !String(shot.pacing).trim()) {
        shot.pacing = styleCfg.id === "C" ? "极密" : "稳";
      }
    }

    function isStyleCFastCut(styleOpts) {
      if (!styleOpts) return false;
      if (styleOpts.styleId === "C") return true;
      var nm = String(styleOpts.styleName || styleOpts.name || "");
      return /style\s*c\b/i.test(nm);
    }

    /** Style C：单镜不得超过 2s，违规则抛错要求模型重写 */
    function assertStyleCShotDurationLimit(shots, phase) {
      var maxSec = 2;
      var bad = [];
      var si;
      for (si = 0; si < shots.length; si++) {
        if (!shots[si]) continue;
        var d = parseFloat(shots[si].duration);
        if (!isNaN(d) && d > maxSec + 0.02) bad.push({ idx: si + 1, dur: roundDurD(d) });
      }
      if (!bad.length) return;
      var detail = bad
        .map(function (b) {
          return "镜头#" + b.idx + "=" + b.dur + "s";
        })
        .join("，");
      throw new Error(
        "Style C 极速快剪时长违规（" +
          phase +
          "）：单镜严禁超过 " +
          maxSec +
          "s，检测到：" +
          detail +
          "。请重写分镜，禁止用长镜头凑总时长。"
      );
    }

    /** 时长宽容区间：仅按各镜 duration（物理秒）累加；Sum∈[min,max] 不缩放；偏短/偏长再比例校准；写回 duration 并剔除遗留的 duration_weight */
    function clampShotDurationsToWindow(shots, targetMin, targetMax, styleOpts) {
      if (!Array.isArray(shots) || !shots.length) return;
      var lo = parseFloat(targetMin);
      var hi = parseFloat(targetMax);
      if (isNaN(lo) || lo <= 0) lo = 45;
      if (isNaN(hi) || hi <= 0) hi = 60;
      if (hi < lo) {
        var swpT = lo;
        lo = hi;
        hi = swpT;
      }

      var styleC = isStyleCFastCut(styleOpts);
      if (styleC) assertStyleCShotDurationLimit(shots, "校准前");

      function stripWeights() {
        for (var si = 0; si < shots.length; si++) {
          if (!shots[si] || !Object.prototype.hasOwnProperty.call(shots[si], "duration_weight")) continue;
          try {
            delete shots[si].duration_weight;
          } catch (eDel) {
            shots[si].duration_weight = void 0;
          }
        }
      }

      var rawSum = 0;
      var i;
      for (i = 0; i < shots.length; i++) {
        var v = parseFloat(shots[i].duration);
        if (isNaN(v) || v < 0) v = 0;
        rawSum += v;
      }
      rawSum = roundDurD(rawSum);

      if (rawSum < 1e-6) {
        var mid0 = roundDurD((lo + hi) / 2);
        var per0 = Math.max(0.25, roundDurD(mid0 / shots.length));
        for (i = 0; i < shots.length; i++) shots[i].duration = per0;
        stripWeights();
        return;
      }

      var scale = 1;
      if (rawSum < lo - 0.02) scale = lo / rawSum;
      else if (rawSum > hi + 0.02) scale = hi / rawSum;

      var goal =
        rawSum < lo - 0.02 ? lo : rawSum > hi + 0.02 ? hi : rawSum;

      var tot = 0;
      var maxPerShot = styleC ? 2 : Infinity;
      for (i = 0; i < shots.length; i++) {
        var d = parseFloat(shots[i].duration) || 0;
        var scaled = roundDurD(d * scale);
        if (scaled > maxPerShot) scaled = maxPerShot;
        shots[i].duration = scaled;
        tot += shots[i].duration;
      }
      stripWeights();

      tot = roundDurD(tot);
      var drift = roundDurD(goal - tot);
      if (shots.length && Math.abs(drift) >= 0.005) {
        var lastIdx = shots.length - 1;
        var lastDur = roundDurD(shots[lastIdx].duration + drift);
        if (styleC && lastDur > 2) lastDur = 2;
        shots[lastIdx].duration = lastDur;
      }

      if (styleC) assertStyleCShotDurationLimit(shots, "校准后");
    }

    /**
     * 与 data-visual-class / features 冲突时：就地改写 visual（及 audio 贵重词），不中断生成。
     * 通用景别纠偏：universalAssetCorrection 处理「特写文案配全景图」类指鹿为马；行业词库规则作补充。
     * 支持解耦结构：优先用 source_image_id 绑定宫格，visual 可为无 # 的纯中文。
     */
    function applyStoryboardVisualRewrites(styleObj, p) {
      var shots = styleObj.shots;
      if (!Array.isArray(shots)) return;
      var galleryCount = document.querySelectorAll("#product-gallery .gallery-item").length;
      var brief = String((p && p.brief) || "");

      for (var i = 0; i < shots.length; i++) {
        if (!shots[i]) continue;
        var decShot = shots[i].source_image_id != null;
        var vis = decShot
          ? stripSystemTokensFromVisual(shots[i].visual || "")
          : String(shots[i].visual || "");

        var sid = shots[i].source_image_id;
        var kFromSid = parseInt(sid, 10);
        var m = vis.match(GRID_REF_RE);
        var k = m ? parseInt(m[1], 10) : NaN;

        if (!decShot) {
          vis = vis.replace(GRID_REF_REPLACE_G, function (_full, num) {
            var kk = parseInt(num, 10);
            if (!galleryCount) return "(参考素材格：无)";
            if (isNaN(kk) || kk < 1 || kk > galleryCount) return "(参考素材格 #1)";
            return "(参考素材格 #" + kk + ")";
          });
          m = vis.match(GRID_REF_RE);
          k = m ? parseInt(m[1], 10) : NaN;
        } else {
          if (!isNaN(kFromSid) && kFromSid >= 1) k = kFromSid;
          else if (isNaN(k) || k < 1) k = 1;
          if (m || vis.indexOf("参考素材格") !== -1) {
            vis = vis.replace(GRID_REF_REPLACE_G, function () {
              return "";
            });
            vis = collapseSpaces(vis);
          }
        }


        if (galleryCount && k > galleryCount) k = galleryCount;
        if (galleryCount && (isNaN(k) || k < 1)) k = 1;

        var meta = galleryCount > 0 ? getGalleryCellMeta(k - 1) : null;
        var clsRaw = meta ? meta.className : "";
        var feats = meta ? String(meta.features || "") : "";

        if (meta) universalAssetCorrection(shots[i], meta);

        var nb, bucket, cr, rule;
        for (nb = 0; nb < CATEGORY_NEGATIVE_KEYWORDS.length; nb++) {
          bucket = CATEGORY_NEGATIVE_KEYWORDS[nb];
          if (clsRaw && bucket.classTest(clsRaw)) vis = vis.replace(bucket.forbidRe, "");
        }

        if (meta && isMovementGridForDialBan(clsRaw)) vis = vis.replace(DIAL_FACE_TERMS_RE, "");

        if (SUBSECOND_VISUAL_RE.test(vis) && (!feats || !SUBSECOND_FEATURES_RE.test(feats))) {
          vis = vis.replace(SUBSECOND_VISUAL_RE, "秒针区域局部");
        }

        for (cr = 0; cr < CORE_FUNCTION_TERM_RULES.length; cr++) {
          rule = CORE_FUNCTION_TERM_RULES[cr];
          if (rule.visualRe.test(vis) && (!feats || !rule.featuresRe.test(feats))) {
            vis = vis.replace(rule.visualRe, "图中可见结构");
          }
        }

        if (MOVEMENT_CLUSTER_RE.test(vis) && DIAL_FACE_TERMS_RE.test(vis)) vis = vis.replace(DIAL_FACE_TERMS_RE, "");

        vis = stripGemstonesNotInBrief(vis, brief);
        vis = collapseSpaces(vis);

        if (!/\(参考素材格/.test(vis)) {
          vis =
            (vis ? vis + " " : "") +
            (galleryCount ? "(参考素材格 #" + k + ")" : "(参考素材格：无)");
        }

        if (vis.replace(GRID_REF_RE, "").trim().length < 8) {
          vis =
            "镜头沿画面主体轮廓与表面反光做受控微距推进，保持客观质感。(参考素材格 #" +
            k +
            ")";
        }

        shots[i].visual = vis;
        if (shots[i].audio != null) {
          shots[i].audio = collapseSpaces(stripGemstonesNotInBrief(String(shots[i].audio || ""), brief));
        }
      }
    }

    /** 非解耦轨道路径：与解耦共用宽容区间时长校准 */
    function autoAdjustDuration(styleObj, targetMin, targetMax, styleCfg, p) {
      void p;
      if (!styleObj || !Array.isArray(styleObj.shots) || !styleObj.shots.length) return;
      clampShotDurationsToWindow(styleObj.shots, targetMin, targetMax, styleCfg);
    }

    /** 兜底：打断连续三镜同一素材格编号（满足防惰性管线约束） */
    function breakTripleConsecutiveGridRefs(styleObj, styleCfg) {
      void styleCfg;
      var shots = styleObj.shots;
      if (!Array.isArray(shots) || shots.length < 3) return;
      var gc = document.querySelectorAll("#product-gallery .gallery-item").length;
      if (gc < 2) return;
      for (var i = 2; i < shots.length; i++) {
        var ma = String(shots[i - 2].visual || "").match(GRID_REF_RE);
        var mb = String(shots[i - 1].visual || "").match(GRID_REF_RE);
        var mc = String(shots[i].visual || "").match(GRID_REF_RE);
        if (!ma || !mb || !mc) continue;
        var ka = parseInt(ma[1], 10);
        var kb = parseInt(mb[1], 10);
        var kc = parseInt(mc[1], 10);
        if (ka !== kb || kb !== kc) continue;
        var alt = (kc % gc) + 1;
        if (alt === kc) alt = (alt % gc) + 1;
        shots[i].visual = String(shots[i].visual || "").replace(GRID_REF_RE, "(参考素材格 #" + alt + ")");
      }
    }

    /** 视觉闭环审计（非阻塞）：冲突已由 applyStoryboardVisualRewrites 就地消歧，此处保留扩展钩子 */
    function validateStoryboardGridVisualClosure(styleObj, styleCfg) {
      void styleObj;
      void styleCfg;
    }

    const craftSingleStyle = async function (styleCfg, styleIndex) {
      var minEl = document.getElementById("totalSecMin");
      var maxEl = document.getElementById("totalSecMax");
      var targetMin = minEl ? parseFloat(String(minEl.value || "").trim()) : NaN;
      var targetMax = maxEl ? parseFloat(String(maxEl.value || "").trim()) : NaN;
      if (isNaN(targetMin) || targetMin <= 0) targetMin = 45;
      if (isNaN(targetMax) || targetMax <= 0) targetMax = 60;
      if (targetMax < targetMin) {
        var swp = targetMin;
        targetMin = targetMax;
        targetMax = swp;
      }

      setStoryEngineProgress(
        styleCfg.name + " 正在计算时间预算…",
        8 + (typeof styleIndex === "number" ? styleIndex : 0) * 28
      );

      var minShotsNormal = Math.ceil(targetMin / 3.5);
      var maxShotsNormal = Math.ceil(targetMax / 2.5);
      var minShotsFast = Math.ceil(targetMin / 1.5);
      var maxShotsFast = Math.ceil(targetMax / 0.8);

      var styleCGridSplitBlock = "";
      var styleCShotCountLine =
        "- 对于 Style C（极速快剪）：绝对禁止长镜头！单镜绝对不准超过 2 秒！必须依靠高频剪辑（0.3-1.5s）。为了填满 " +
        targetMin +
        "-" +
        targetMax +
        "s 的时长，你必须克服惰性，老老实实写出 " +
        minShotsFast +
        "-" +
        maxShotsFast +
        " 个镜头！\n";

      if (styleCfg.id === "C" && targetMax > 30) {
        var minShotsGrid = Math.max(8, Math.ceil(targetMin / 2.5));
        var maxShotsGrid = Math.max(minShotsGrid, Math.ceil(targetMax / 1.2));
        styleCShotCountLine =
          "- 对于 Style C（极速快剪）：目标总时长 " +
          targetMin +
          "-" +
          targetMax +
          "s（>30s 长片）。单镜严禁超过 2s！**必须**用「分屏阵列（Grid Split-screen）」压缩 shots 条目：建议约 " +
          minShotsGrid +
          "-" +
          maxShotsGrid +
          " 镜（含宫格分屏镜），勿无脑堆砌 " +
          minShotsFast +
          "+ 镜导致 JSON 过长被截断。\n";
        styleCGridSplitBlock =
          "\n【Style C · 长片必用分屏阵列 Grid Split-screen（目标>30s）】：\n" +
          "为防止 Token 溢出、脚本 JSON 生成中断，**必须**在多处使用分屏阵列，用更少 shots 覆盖更长总时长：\n" +
          "- 示例：一镜 visual 写明「四分屏同屏并列」，四格各呈不同角度/配色/肌理，物理 duration 仅 1.0-1.5s，但视觉信息量相当于 4 个独立镜头。\n" +
          "- 亦可使用九宫格/十六宫格快闪阵列 + Match Cut；优先 0.8-1.5s/镜，严禁单镜>2s。\n" +
          "- 靠分屏「换密度」而非堆 JSON 对象总数；shots 数组长度应明显低于纯切镜方案。\n" +
          "- 每格须在 visual 内写清画面；matching_reason 可说明「本镜以四宫格承载多素材，故 duration 短而信息密度高」。\n";
      }

      const systemPrompt =
        `你是一位身价千万的商业广告导演。你现在的任务是生成一份「初稿即过稿」的专业脚本。

【全行业过稿死命令】：
1. 空间隔离：Style A 严禁出现环境，Style B 严禁出现生产工具，Style C 严禁出现匀速慢动。
2. 叙事闭环（Style A 特有）：必须在结尾交代产品的最终形态，严禁只展示过程而无结论。
3. 叙事逻辑（Style B 特有）：禁止碎片化堆砌。必须先卖「氛围（Establish）」，再卖「人物（Emotion）」，最后带出「产品（Integration）」。
4. 视觉锚点：每一镜必须包含明确的镜头运动矢量（如 Dolly In, Arc Orbit），且 Shot N 的结束点必须与 Shot N+1 的开始点物理对齐，严禁空间瞬移。
5. 材质 DNA：根据产品品类，强制在每一镜注入 Lighting Rig 指令（3C 用 Scan Light，美妆用 Tyndall，家居用自然窗光）。

【输出格式】：只输出合法 JSON，visual 描述必须是充满镜头感的纯中文，严禁含糊其辞。第 1 镜须直接呈现产品本体或可读的局部核心（禁止纯人物/纯风景无产品前摇）。
${buildUniversalBindingPromptBlock(catalogSlotCount)}
【时长、镜头数与宫格分屏死命令】：目标总时长区间约 ${targetMin}-${targetMax}s。镜头数量严禁为了凑数而机械堆砌，但必须绝对符合物理剪辑规律与风格密度！
- 对于 Style A/B：单镜允许有 3-4 秒的呼吸感。为满足总时长，你必须写出约 ${minShotsNormal}-${maxShotsNormal} 个镜头。
${styleCShotCountLine}【高级提密度手法：宫格分屏（Split-screen Grid）】：
当需要填满较长视频或展示同系列多配色时，**强制要求在脚本中后段使用『宫格分屏』来消耗镜头数与提升信息密度！**
- Style A：用 4 宫格同屏严谨对比不同材质/表盘在相同光影下的微距细节。
- Style B：用分屏展现群像（如画面分裂，展现不同阶层/生活场景的人物同时佩戴不同款式）。
- Style C：配合 Match Cut，让画面分裂成 16 或 25 宫格进行同形异色的极速闪烁阵列。
请利用这种分屏手法，合情合理地完成上述要求的镜头数量！
${styleCGridSplitBlock}

【物理算数死命令】：所有镜头的 duration 累加总和必须严格落在 ${targetMin}-${targetMax} 秒之间！绝对禁止只写几个长镜头糊弄了事！单镜 duration 严禁超过 4 秒（Style C必须在 0.5-1.5 秒内）！
【技术铁律·解析兼容】顶层含字符串 director_treatment、visualDNA（必填：顶级英文 DALL-E 生图 Prompt，精确描述产品外观材质与型号细节）与数组 shots；每镜须含 source_image_id（整数）、matching_reason（景别匹配理由，一句中文）、duration（代表绝对物理秒数，数字格式如1.5、2.0）、visual、motion。严禁输出 duration_weight！
visual 中严禁出现「#数字」「素材格」等系统级词汇。`;

      var userTextBlock =
        "【投放平台】：" +
        String(p.platform != null ? p.platform : "未指定") +
        "（你必须绝对遵守该平台用户的观看习惯！短视频平台前3秒必须极速反转，大屏/商详平台需要极致细节！）\n" +
        "【总时长目标】：" +
        targetMin +
        "-" +
        targetMax +
        "s\n" +
        "【产品与类目】：" +
        String(p.product != null ? p.product : "") +
        " (" +
        (p.category && String(p.category).trim() ? String(p.category).trim() : "未分类") +
        ")\n" +
        "【产品与简报】：\n" +
        String(p.brief != null ? p.brief : "") +
        "\n【场景库】：" +
        usageScenariosForPrompt +
        "\n\n【本套风格强制设定：" +
        styleCfg.name +
        "】\n" +
        styleCfg.focus +
        "\n\n指令：请仔细观察提供的产品图，结合卖点和平台特性设计分镜。强制要求：1. 严格遵守风格设定（如 Style A 绝不能有人物，必须是极致微距物理材质）。2. 必须在 JSON 的 `visualDNA` 字段输出一段【顶级英文 DALL-E 生图 Prompt】，准确描述图中的产品细节（如：Patek Philippe 6119R, rose gold case, Clous de Paris guilloché bezel），确保后续生图产品高度还原！3. 每镜 source_image_id 必须与画面语义和素材目录一致。\n\n" +
        "【防同质化死命令】三套都必须出现「人+场景+产品」，但角色完全不同：Style A=专家/驾驭者的克制局部与微距物理；Style B=生活主角与 [usage_scenarios] 真实烟火气，一镜动作流；Style C=视觉触发器+夸张动作驱动错觉与 Match Cut。禁止三套写成同一种人设或同一种运镜口吻。\n" +
        gridHint;

      var userContent = [{ type: "text", text: userTextBlock }];
      base64Images.forEach(function (b64) {
        userContent.push({ type: "image_url", image_url: { url: b64, detail: "high" } });
      });

      /** 分镜脚本：GPT-4o Vision + Chat Completions（网络层见 llmApiFetch；导演 prompt 未改） */
      const res = await llmApiFetch("chat/completions", {
        label: styleCfg.name + " 分镜",
        apiKey: key,
        body: JSON.stringify({
          model: window.getTextModel(),
          max_tokens: 8192,
          temperature: 0.1,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userContent },
          ],
          response_format: { type: "json_object" },
        }),
      });

      const data = await res.json();
      const originalContent = String(data?.choices?.[0]?.message?.content || "");
      if (!originalContent.trim()) throw new Error(styleCfg.name + " 响应为空");

      try {
        setStoryEngineProgress(styleCfg.name + " 正在进行视觉闭环校验…", 42 + (typeof styleIndex === "number" ? styleIndex : 0) * 26);

        var jsonSlice = extractOutermostJsonBlock(originalContent);
        if (!jsonSlice) throw new Error("无效的 JSON 格式（无法提取最外层对象）");

        const parsed = parseJsonWithClosingBraceRepair(jsonSlice);
        const styleObj = parsed.style != null ? parsed.style : parsed;

        styleObj.styleName = styleCfg.name;
        if (styleObj.visualDNA == null) styleObj.visualDNA = "";
        if (styleObj.director_treatment == null || !String(styleObj.director_treatment).trim()) {
          styleObj.director_treatment =
            styleCfg.id === "A"
              ? "【导演阐述·兜底】人+极简专业场景+产品同框；人物动机=专家式克制操作与验证；视觉核心=人手与产品接触点的极致微距物理细节与冷光质感。"
              : styleCfg.id === "B"
                ? "【导演阐述·兜底】人+真实生活场景+产品；动机=烟火气/社交中的自然动作链；视觉核心=窗光情绪与人-物交融（场景锚点须可对应 [usage_scenarios]）。"
                : "【导演阐述·兜底】人+动感/反差场景+产品；动机=人物动作触发误读与 Match Cut 揭示；视觉核心=极速运镜、运动模糊与 ASMR 节奏。";
        }
        if (!styleObj.shots || !Array.isArray(styleObj.shots)) throw new Error("缺少分镜数组");

        var galleryCountPad = document.querySelectorAll("#product-gallery .gallery-item").length;
        var decoupled = shotsAppearDecoupled(styleObj.shots);

        if (decoupled) {
          var hi;
          for (hi = 0; hi < styleObj.shots.length; hi++) {
            var sh = styleObj.shots[hi];
            sh.visual = stripSystemTokensFromVisual(sh.visual || "");
            var gid = parseInt(sh.source_image_id, 10);
            if (isNaN(gid) || gid < 1) gid = 1;
            if (galleryCountPad > 0 && gid > galleryCountPad) gid = galleryCountPad;
            sh.source_image_id = gid;
            var d = parseFloat(sh.duration);
            if (isNaN(d) || d <= 0) d = parseFloat(sh.duration_weight);
            if (isNaN(d) || d <= 0) d = 2;
            sh.duration = d;
            try {
              delete sh.duration_weight;
            } catch (eDw) {
              sh.duration_weight = void 0;
            }
          }
          setStoryEngineProgress(styleCfg.name + " 正在物理校准总时长…", 78 + (typeof styleIndex === "number" ? styleIndex : 0) * 6);
          clampShotDurationsToWindow(styleObj.shots, targetMin, targetMax, styleCfg);
          for (hi = 0; hi < styleObj.shots.length; hi++) fillDefaultShotFields(styleObj.shots[hi], styleCfg);
          applyStoryboardVisualRewrites(styleObj, p);
          breakTripleConsecutiveGridRefs(styleObj, styleCfg);
          validateStoryboardGridVisualClosure(styleObj, styleCfg);
        } else {
          applyStoryboardVisualRewrites(styleObj, p);
          breakTripleConsecutiveGridRefs(styleObj, styleCfg);
          validateStoryboardGridVisualClosure(styleObj, styleCfg);
          setStoryEngineProgress(styleCfg.name + " 正在物理校准总时长…", 78 + (typeof styleIndex === "number" ? styleIndex : 0) * 6);
          autoAdjustDuration(styleObj, targetMin, targetMax, styleCfg, p);
        }

        return styleObj;
      } catch (e) {
        console.error("导演纠偏 - " + styleCfg.name + " 解析/校验异常:", e);
        console.error("导演纠偏 - " + styleCfg.name + " 原始 content（完整）:", originalContent);
        console.error("导演纠偏 - " + styleCfg.name + " 提取尝试片段:", extractOutermostJsonBlock(originalContent));
        if (e instanceof Error && e.message) {
          throw e;
        }
        throw new Error(styleCfg.name + " 发生未知错误：" + String(e));
      }
    };

    function sleep(ms) {
      return new Promise(function (resolve) {
        setTimeout(resolve, ms);
      });
    }

    try {
      const results = [];
      for (var si = 0; si < stylesToCraft.length; si++) {
        if (si > 0) await sleep(500);
        results.push(await craftSingleStyle(stylesToCraft[si], si));
      }
      return { styles: results };
    } catch (err) {
      throw err;
    }
  }

  /** 分镜 visual 中的「参考素材格 #k」：居中悬浮大图预览 + 左侧宫格闪烁高亮 + 元数据小字 */
  function attachGridInteractivity() {
    var oldPop = document.getElementById("storyboard-hover-preview");
    if (oldPop) oldPop.remove();

    if (!document.getElementById("lab-grid-ref-style")) {
      var st = document.createElement("style");
      st.id = "lab-grid-ref-style";
      st.textContent =
        "@keyframes labGridRefFlash{" +
        "0%,100%{box-shadow:inset 0 0 0 3px var(--blue);}" +
        "50%{box-shadow:inset 0 0 0 6px #66a3ff;}" +
        "}";
      document.head.appendChild(st);
    }

    const REF_RE = /参考素材格\s*#(\d+)/;
    document.querySelectorAll(".tl-visual").forEach(function (el) {
      const text = el.innerText || "";
      const match = text.match(REF_RE);
      if (!match) return;
      const idx = parseInt(match[1], 10) - 1;
      if (isNaN(idx) || idx < 0) return;

      el.style.cursor = "zoom-in";
      el.style.borderBottom = "1px dashed var(--blue)";
      el.style.textDecoration = "";
      el.title = "悬停预览素材 #" + (idx + 1);

      el.onmouseenter = function () {
        var popOld = document.getElementById("storyboard-hover-preview");
        if (popOld) popOld.remove();

        var items = document.querySelectorAll("#product-gallery .gallery-item");
        var cell = items[idx];
        var targetImg = cell ? cell.querySelector("img") : null;
        if (!targetImg) return;

        var vClass = (cell.getAttribute("data-visual-class") || "").trim();
        var vFeat = (cell.getAttribute("data-visual-features") || cell.getAttribute("data-visual-notes") || "").trim();

        var preview = document.createElement("div");
        preview.id = "storyboard-hover-preview";
        preview.setAttribute("role", "img");
        preview.setAttribute("aria-label", "素材格大图预览");
        preview.style.cssText =
          "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);" +
          "width:min(500px,90vw);max-height:min(560px,90vh);z-index:99999;background:#fff;" +
          "border:3px solid var(--blue);border-radius:16px;box-shadow:0 20px 80px rgba(0,0,0,0.3);" +
          "padding:10px;box-sizing:border-box;pointer-events:none;display:flex;flex-direction:column;gap:6px;";
        var img = document.createElement("img");
        img.src = targetImg.src;
        img.alt = targetImg.alt || "";
        img.style.cssText = "width:100%;flex:1;min-height:0;object-fit:contain;display:block;border-radius:8px;";
        preview.appendChild(img);

        var metaRow = document.createElement("div");
        metaRow.style.cssText =
          "font-size:11px;line-height:1.35;color:#555;word-break:break-all;border-top:1px dashed #ddd;padding-top:6px;";
        metaRow.innerHTML =
          "<div><b style=\"color:var(--blue);\">data-visual-class</b> " +
          escapeHtml(vClass || "（未设置）") +
          "</div>" +
          "<div><b style=\"color:var(--blue);\">data-visual-features</b> " +
          escapeHtml(vFeat || "（未设置）") +
          "</div>";
        preview.appendChild(metaRow);

        document.body.appendChild(preview);

        if (cell) {
          cell.style.outline = "none";
          cell.style.animation = "labGridRefFlash 0.55s ease-in-out infinite";
        }
      };

      el.onmouseleave = function () {
        var pop = document.getElementById("storyboard-hover-preview");
        if (pop) pop.remove();
        var items2 = document.querySelectorAll("#product-gallery .gallery-item");
        var cell2 = items2[idx];
        if (cell2) {
          cell2.style.animation = "";
          cell2.style.outline = "";
        }
      };
    });
  }

  function renderStoryboardDashboard(data) {
    const dashboard = document.getElementById("storyDashboard");
    const panels = document.getElementById("tabPanels");
    const tabBtns = document.querySelectorAll(".tab-btn");
    const modsTarget = document.getElementById("storyModsTarget");
    if (!dashboard || !panels) return;

    const styles =
      (data != null && data.styles) || (Array.isArray(data) ? data : []);
    if (!Array.isArray(styles) || styles.length === 0) {
      return alert("AI 未返回有效分镜数据，请重试");
    }

    window.__LAST_STORYBOARD_DATA__ = styles;

    var visualBoardHost = document.getElementById("visualBoardContainer");
    if (visualBoardHost) {
      visualBoardHost.style.display = "none";
      visualBoardHost.innerHTML = "";
    }

    if (modsTarget) {
      modsTarget.innerHTML = "";
      modsTarget.removeAttribute("disabled");
      styles.forEach(function (style, idx) {
        var opt = document.createElement("option");
        opt.value = String(idx);
        opt.textContent = style.styleName || "Style " + (idx + 1);
        modsTarget.appendChild(opt);
      });
      modsTarget.value = "0";
    }

    dashboard.classList.add("is-visible");
    dashboard.setAttribute("aria-hidden", "false");
    panels.innerHTML = "";

    tabBtns.forEach(function (btn, idx) {
      btn.style.display = styles[idx] ? "inline-block" : "none";
      if (styles[idx]) {
        btn.textContent = styles[idx].styleName || "Style " + (idx + 1);
      }
    });

    styles.forEach(function (style, sIdx) {
      const rawShots = style.shots || style.content || style.list || style.Shots || [];
      const shots = Array.isArray(rawShots) ? rawShots : [];
      let totalSec = 0;
      shots.forEach(function (sh) {
        totalSec += parseFloat(sh.duration || 0) || 0;
      });

      const panel = document.createElement("div");
      panel.className = "tab-panel " + (sIdx === 0 ? "is-active" : "");
      panel.id = "panel-" + sIdx;

      var treatment = style.director_treatment != null ? String(style.director_treatment) : "";
      let html =
        '<div class="dna-card" style="margin-bottom:12px; padding:12px; border:1px solid var(--blue); border-radius:8px; background:rgba(0,80,200,0.04);">' +
        '<div style="font-size:0.7rem; color:var(--blue); font-weight:bold;">DIRECTOR TREATMENT / 导演阐述</div>' +
        '<div style="font-size:0.85rem; margin-top:6px; white-space:pre-wrap;">' +
        escapeHtml(treatment || "—") +
        "</div></div>" +
        '<div class="dna-card" style="margin-bottom:16px; padding:12px; border:1px dashed var(--blue); border-radius:8px;">' +
        '<div style="font-size:0.7rem; color:var(--blue); font-weight:bold;">VISUAL DNA / NARRATIVE CONTEXT</div>' +
        '<div style="font-size:0.85rem; margin-top:4px;">' +
        escapeHtml(style.visualDNA != null ? style.visualDNA : "—") +
        "</div></div>" +
        '<div class="timeline">';

      shots.forEach(function (shot, i) {
        var durRaw = shot.duration != null ? String(shot.duration).trim() : "";
        var durPill = durRaw ? escapeHtml(durRaw) : "—";
        if (durRaw && !/s$/i.test(durRaw)) durPill += "s";

        html +=
          '<div class="tl-shot" style="margin-bottom:24px;">' +
          '<div class="tl-shot-head" style="display:flex; justify-content:space-between;">' +
          '<span class="tl-no">SHOT ' +
          (i + 1) +
          "</span>" +
          '<span class="tl-pill">' +
          durPill +
          "</span></div>" +
          '<div class="tl-visual" style="font-weight:500; margin-top:6px;"><span class="tl-dot"></span>' +
          escapeHtml(shot.visual || "") +
          "</div>" +
          '<div class="tl-meta" style="font-size:0.75rem; background:rgba(0,0,0,0.02); padding:8px; border-radius:6px; margin-top:8px;">' +
          "<div>🎥 " +
          escapeHtml(shot.motion || "") +
          '</div><div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:4px;">' +
          "<span>📍 Start: " +
          escapeHtml(shot.start_motion || "") +
          "</span><span>📍 End: " +
          escapeHtml(shot.end_motion || "") +
          "</span></div>" +
          '<div style="margin-top:6px;">🔗 ' +
          escapeHtml(shot.transition || "") +
          "</div>" +
          '<div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-top:4px;">' +
          "<span>💡 " +
          escapeHtml(shot.lighting || "") +
          "</span><span>🌊 " +
          escapeHtml(shot.pacing || "") +
          "</span></div></div>" +
          '<div class="tl-audio" style="font-style:italic; color:var(--muted); margin-top:6px;">🔊 ' +
          escapeHtml(shot.audio || "") +
          "</div></div>";
      });

      var minEl = document.getElementById("totalSecMin");
      var maxEl = document.getElementById("totalSecMax");
      var targetMin = minEl ? parseInt(String(minEl.value || "0"), 10) : NaN;
      var targetMax = maxEl ? parseInt(String(maxEl.value || "0"), 10) : NaN;
      if (isNaN(targetMin)) targetMin = 45;
      if (isNaN(targetMax)) targetMax = 60;
      var isWarn = totalSec < targetMin || totalSec > targetMax;

      html +=
        '<div class="total-dur" style="color:' +
        (isWarn ? "red" : "var(--blue)") +
        '; font-weight:bold; border-top:1px solid #eee; padding-top:12px;">⏱️ 脚本总时长估算：' +
        totalSec.toFixed(1) +
        "s " +
        (isWarn ? "(目标 " + targetMin + "-" + targetMax + "s)" : "✅ 达标") +
        "</div></div>";
      panel.innerHTML = html;
      panels.appendChild(panel);
    });

    tabBtns.forEach(function (btn, idx) {
      btn.classList.toggle("is-active", idx === 0 && styles[0]);
      btn.setAttribute("aria-selected", idx === 0 && styles[0] ? "true" : "false");
    });

    tabBtns.forEach(function (btn) {
      btn.onclick = function () {
        document.querySelectorAll(".tab-btn, .tab-panel").forEach(function (el) {
          el.classList.remove("is-active");
        });
        this.classList.add("is-active");
        const pid = this.dataset.tab;
        const pnl = pid != null ? document.getElementById("panel-" + pid) : null;
        if (pnl) pnl.classList.add("is-active");
        document.querySelectorAll(".tab-btn").forEach(function (b) {
          b.setAttribute("aria-selected", b === this ? "true" : "false");
        }, this);
        var modsTargetSync = document.getElementById("storyModsTarget");
        if (modsTargetSync && pid != null && pid !== "") modsTargetSync.value = String(pid);
      };
    });

    if (modsTarget) {
      modsTarget.onchange = function () {
        var tid = String(this.value || "");
        var tabBtn = document.querySelector('.tab-btn[data-tab="' + tid + '"]');
        if (tabBtn && typeof tabBtn.click === "function") tabBtn.click();
      };
    }

    attachGridInteractivity();
  }

  /** 精修返回后：补全漏写的 audio / lighting（不覆盖已有非空内容） */
  function labInferStyleIdForRefine(original, styleIndex) {
    var name = String((original && original.styleName) || "");
    if (/Style\s*A/i.test(name) || /^A[\s\)]/i.test(name)) return "A";
    if (/Style\s*B/i.test(name) || /^B[\s\)]/i.test(name)) return "B";
    if (/Style\s*C/i.test(name) || /^C[\s\)]/i.test(name)) return "C";
    var i = parseInt(styleIndex, 10);
    if (!isNaN(i) && i === 0) return "A";
    if (!isNaN(i) && i === 1) return "B";
    if (!isNaN(i) && i >= 2) return "C";
    return "A";
  }

  function ensureRefinedShotAudioLighting(styleObj, styleId) {
    if (!styleObj || !Array.isArray(styleObj.shots)) return;
    var sid = styleId === "A" || styleId === "B" || styleId === "C" ? styleId : "A";
    var rigA =
      "[Rig 精修兜底] Rim Light 冷轮廓勾边 + Scan Light 窄束沿主立面扫过，强化金属/玻璃微刻面层次。";
    var rigB =
      "[Rig 精修兜底] 自然窗光主光 + 轻 Rim 分离人物与产品体积；弱 Scan 掠过表壳或logo高光一度。";
    var rigC =
      "[Rig 精修兜底] 硬边 Scan Light 高频扫动 + Rim 高光，配合变速段可剪接的闪烁节奏。";
    var audA =
      "[ASMR 精修兜底] 金属棘轮细齿密合的低频咔哒、麂皮/纤维垫与表壳轻触的摩擦、极低环境底噪。";
    var audB =
      "[ASMR 精修兜底] 高级织物与袖口轻掠声、皮革表带孔位穿引的微阻力、远处极弱 ambience。";
    var audC =
      "[ASMR 精修兜底] 磁吸嗒合段落、硬物轻撞的清脆接触、近场 foley 与剪辑点同步的短促抽吸声。";
    var rig = sid === "A" ? rigA : sid === "B" ? rigB : rigC;
    var aud = sid === "A" ? audA : sid === "B" ? audB : audC;
    var si;
    for (si = 0; si < styleObj.shots.length; si++) {
      var sh = styleObj.shots[si];
      if (!sh) continue;
      if (sh.lighting == null || !String(sh.lighting).trim()) sh.lighting = rig;
      if (sh.audio == null || !String(sh.audio).trim()) sh.audio = aud;
    }
  }

  async function refineSingleStyle(original, mods, key, styleIndex) {
    var minElR = document.getElementById("totalSecMin");
    var maxElR = document.getElementById("totalSecMax");
    var targetMin = minElR ? parseFloat(String(minElR.value || "").trim()) : NaN;
    var targetMax = maxElR ? parseFloat(String(maxElR.value || "").trim()) : NaN;
    if (isNaN(targetMin) || targetMin <= 0) targetMin = 45;
    if (isNaN(targetMax) || targetMax <= 0) targetMax = 60;
    if (targetMax < targetMin) {
      var swpR = targetMin;
      targetMin = targetMax;
      targetMax = swpR;
    }

    const systemPrompt =
      "你是一位顶级广告导演，正在进行【局部定稿精修】，目标质感：顶奢级可读性与物理真实。\n\n" +
      "【物理死命令】：\n" +
      "1. 脚本总时长必须严格保持在 " +
      targetMin +
      "-" +
      targetMax +
      " 秒之间。如果时长需要调整，优先通过优化单镜头 pacing（如增加 Slow-motion 的留白）或进行等比例时长伸缩来适配。严禁以任何借口添加无意义的「切片补镜」或「反复横跳」的冗余画面来强行凑数！\n\n" +
      "【动作矢量化】：motion / visual 中**禁止**含糊写「移动」「镜头动一下」；必须优先使用可执行矢量术语并写明方向/幅度，例如 **Arc Orbit（绕拍）**、**Dolly In / Dolly Out（推拉）**、**Rack Focus（拉焦）**、Truck / Pedestal / Pan-Tilt 等，并与上一镜 End State 可剪接对齐。\n\n" +
      "【光影 Rig 注入】：**每一镜**须在 lighting 或 visual 首句前缀中写明具体 Rig，例如 **Scan Light（窄条动态扫描高光）**、**Rim Light（轮廓勾勒分离背景）**；可组合 Fill/背光，但不得整片死平光；以强化金属/玻璃/织物等材质微结构。\n\n" +
      "【ASMR 音效增强】：**每一镜**的 audio 字段必须包含**可感知的物理质感**描写（非空洞形容词），例如金属棘轮**细齿咬合**声、微距下**麂皮/织物纤维**摩擦声、表冠阻尼段落感、玻璃与金属轻碰的**清脆接触**等；与画面动作同步。\n\n" +
      "【矢量化运动与光影扫描·补充】：首镜优先「极速微距 + Scan Light」制造微刻面依次闪高光；旋钮/表冠段落须写阻尼与滚花与指纹的微观咬合；相邻镜须交代矢量衔接（示例可用 Dolly Out 保持重心连贯）。\n\n" +
      "【输出纪律】：严格保留原有 Visual DNA 与产品核心逻辑；仅在【导演精修意见】与上述约束内改写。输出 JSON 结构与原脚本一致（含 director_treatment、shots、styleName 等字段）；为对齐总秒数可微调每镜 duration、pacing，**禁止**为凑时长添加无叙事价值的碎片镜或冗余横跳。\n\n";

    /** 精修：OpenAI Chat Completions（网络层见 llmApiFetch） */
    const res = await llmApiFetch("chat/completions", {
      label: "分镜精修",
      apiKey: key,
      body: JSON.stringify({
        model: window.getTextModel(),
        max_tokens: 8192,
        temperature: 0.2,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: "原脚本：" + JSON.stringify(original) + "\n\n精修意见：" + String(mods || ""),
          },
        ],
        response_format: { type: "json_object" },
      }),
    });

    const data = await res.json();
    const originalContent = String(data?.choices?.[0]?.message?.content || "");
    if (!originalContent.trim()) throw new Error("精修响应为空");
    const jsonSlice = extractOutermostJsonBlock(originalContent);
    if (!jsonSlice) throw new Error("无效的 JSON 格式（无法提取精修对象）");
    const parsed = parseJsonWithClosingBraceRepair(jsonSlice);
    const obj = parsed.style != null ? parsed.style : parsed;
    if (obj && original && original.styleName != null && obj.styleName == null) {
      obj.styleName = original.styleName;
    }
    ensureRefinedShotAudioLighting(obj, labInferStyleIdForRefine(original, styleIndex));
    return obj;
  }

  const btnRefineSelected = document.getElementById("btnRefineSelected");
  if (btnRefineSelected) {
    btnRefineSelected.addEventListener("click", async function () {
      const targetEl = document.getElementById("storyModsTarget");
      const modsEl = document.getElementById("storyScriptMods");
      const apiKey =
        typeof window.getLlmApiKeyFromInput === "function"
          ? window.getLlmApiKeyFromInput()
          : String(document.getElementById("llm-api-key").value || "").trim();
      const targetIdx = targetEl ? String(targetEl.value || "").trim() : "";
      const mods = modsEl ? String(modsEl.value || "").trim() : "";

      if (!mods) return alert("请先输入精修备注（例如：将书房改为更衣间）");
      if (!apiKey) return alert("请输入 OPENAI API KEY");

      const currentStyles = window.__LAST_STORYBOARD_DATA__;
      if (!Array.isArray(currentStyles) || !currentStyles.length) {
        return alert("请先生成三套分镜，再使用精修");
      }
      const idx = parseInt(targetIdx, 10);
      if (isNaN(idx) || idx < 0 || idx >= currentStyles.length) {
        return alert("请先在「修正目标脚本」中选择有效的一套分镜");
      }
      const originalStyle = currentStyles[idx];
      if (!originalStyle) return alert("选中的脚本数据不存在");

      if (typeof window.setLabBusy === "function") window.setLabBusy(true);
      setStoryEngineProgress("正在按导演意见精修选中脚本...", 30);

      try {
        const refinedData = await refineSingleStyle(originalStyle, mods, apiKey, idx);
        currentStyles[idx] = refinedData;
        window.__LAST_STORYBOARD_DATA__ = currentStyles;
        renderStoryboardDashboard({ styles: currentStyles });
        var storyModsTa = document.getElementById("storyScriptMods");
        if (storyModsTa) storyModsTa.value = "";
        var selAfter = document.getElementById("storyModsTarget");
        if (selAfter) selAfter.value = String(idx);
        var tabToActivate = document.querySelector('.tab-btn[data-tab="' + idx + '"]');
        if (tabToActivate && typeof tabToActivate.click === "function") tabToActivate.click();
        setStoryEngineProgress("✅ 精修已应用", 100);
        setTimeout(function () {
          clearStoryEngineProgress();
        }, 2000);
      } catch (err) {
        alert(formatLlmFetchAlertMessage(err, "精修失败"));
        clearStoryEngineProgress();
      } finally {
        if (typeof window.setLabBusy === "function") window.setLabBusy(false);
      }
    });
  }

  var btnFinalizeScript = document.getElementById("btnFinalizeScript");
  if (btnFinalizeScript) {
    btnFinalizeScript.addEventListener("click", function () {
      if (!confirm("确定当前脚本已精修完成？确认后将清理备注区并高亮脚本。")) return;
      var ta = document.getElementById("storyScriptMods");
      if (ta) ta.value = "";
      var dash = document.getElementById("storyDashboard");
      if (dash) {
        dash.classList.add("story-board-finalized");
        dash.style.boxShadow = "inset 4px 0 0 0 #34c759";
      }
      alert("脚本已定稿，可进行后续导出。");
    });
  }

  // ================= 生成视觉分镜图 =================
  var VISUAL_LOADING_HTML =
    "<span style='display:block; animation: pulse 1.5s infinite;'>AI Artist is rendering...</span>";

  function getImageSizeForRatio(ratioStr) {
    var gptSize = "1024x1024";
    if (ratioStr.indexOf("9:16") !== -1) gptSize = "1024x1792";
    else if (ratioStr.indexOf("16:9") !== -1 || ratioStr.indexOf("21:9") !== -1) gptSize = "1792x1024";
    return gptSize;
  }

  function getStyleMoodSuffix(style, sIdx) {
    var name = String((style && style.styleName) || "");
    if (/style\s*a\b/i.test(name) || (sIdx === 0 && !/style\s*[bc]\b/i.test(name))) {
      return "Industrial studio, sharp focus, technical lighting";
    }
    if (/style\s*b\b/i.test(name) || sIdx === 1) {
      return "Natural warm lighting, high-end lifestyle photography, depth of field";
    }
    return "";
  }

  function buildVisualDrawPrompt(shot, style, productName, sIdx) {
    var cleanVisual = String(shot.visual || "").replace(/\(参考素材格[^)]+\)/g, "").trim();
    var exactProductDescription =
      style && style.visualDNA && String(style.visualDNA).trim()
        ? String(style.visualDNA).trim()
        : window.__MASTER_VISUAL_PROMPT__ || productName;
    var parts = [
      "Cinematic commercial storyboard sketch, high-end professional advertising shot.",
      "Product exact appearance: " + exactProductDescription + ".",
      "Action/Scene: " + cleanVisual,
    ];
    var lighting = shot.lighting != null ? String(shot.lighting).trim() : "";
    if (lighting) parts.push("Lighting: " + lighting);
    var motion = shot.motion != null ? String(shot.motion).trim() : "";
    if (motion) parts.push("Camera/Motion: " + motion);
    var mood = getStyleMoodSuffix(style, sIdx);
    if (mood) parts.push(mood);
    return parts.join(" ");
  }

  function requestVisualShotImage(opts) {
    var loading = opts.loading;
    var img = opts.img;
    var redrawBtn = opts.redrawBtn;

    loading.style.display = "flex";
    loading.innerHTML = VISUAL_LOADING_HTML;
    img.style.opacity = "0";
    if (redrawBtn) redrawBtn.disabled = true;

    return llmApiFetch("images/generations", {
      label: "DALL-E 生图",
      apiKey: String(opts.apiKey || "").trim(),
      body: JSON.stringify({
        model: opts.imageModel,
        prompt: opts.drawPrompt,
        n: 1,
        size: opts.imageSize,
        quality: "standard",
        response_format: "url",
      }),
    })
      .then(function (res) {
        return res.json();
      })
      .then(function (genData) {
        if (genData && genData.data && genData.data[0] && genData.data[0].url) {
          img.src = genData.data[0].url;
          img.onload = function () {
            loading.style.display = "none";
            img.style.opacity = "1";
            if (redrawBtn) redrawBtn.disabled = false;
          };
          img.onerror = function () {
            loading.style.display = "flex";
            loading.innerHTML =
              "<span style='color:red; font-size:12px; padding:10px; text-align:center;'>图片加载失败</span>";
            if (redrawBtn) redrawBtn.disabled = false;
          };
        } else {
          throw new Error(
            genData && genData.error && genData.error.message
              ? genData.error.message
              : "生图返回空数据"
          );
        }
      })
      .catch(function (err) {
        console.error("AI 生图失败:", err);
        maybeAlertLlmFetchFailure(err, "DALL-E 生图");
        var hint = formatLlmFetchAlertMessage(err, "DALL-E 生图");
        var bodyHtml =
          "生图失败:<br>" +
          escapeHtml(hint).replace(/\n/g, "<br>");
        loading.style.display = "flex";
        loading.innerHTML =
          "<span style='color:red; font-size:12px; padding:10px; text-align:center; line-height:1.45;'>" +
          bodyHtml +
          "</span>";
        if (redrawBtn) redrawBtn.disabled = false;
      });
  }

  function triggerVisualShotRender(ctx, delayMs) {
    if (!ctx.apiKey) {
      ctx.loading.style.display = "flex";
      ctx.loading.innerHTML =
        "<span style='color:red;'>缺少 OPENAI API KEY（请在页面顶部填写，与分镜脚本共用）</span>";
      return;
    }
    var run = function () {
      requestVisualShotImage(ctx);
    };
    if (delayMs > 0) setTimeout(run, delayMs);
    else run();
  }

  var btnRenderVisualBoard = document.getElementById("btnRenderVisualBoard");
  if (btnRenderVisualBoard) {
    btnRenderVisualBoard.addEventListener("click", function () {
      llmFetchFailAlertShown = false;
      /** 生图：joinLlmApiPath → https://proaiapi.tech/v1/images/generations；模型 dall-e-3（硬编码） */
      const IMAGE_GENERATION_MODEL = window.getImageModel();

      var openaiKeyForImages =
        typeof window.getLlmApiKeyFromInput === "function"
          ? window.getLlmApiKeyFromInput()
          : String(document.getElementById("llm-api-key").value || "").trim();

      if (!document.getElementById("lab-visual-dalle-pulse")) {
        var skPulse = document.createElement("style");
        skPulse.id = "lab-visual-dalle-pulse";
        skPulse.textContent = "@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.45}}";
        document.head.appendChild(skPulse);
      }

      var data = window.__LAST_STORYBOARD_DATA__;
      if (!data || !data.length) return alert("请先点击 Craft Storyboard 生成分镜脚本");
      var container = document.getElementById("visualBoardContainer");
      if (!container) return;

      // 1. 获取用户选择的画幅比例 (如 9:16 Vertical)
      var ratioElBoard = document.getElementById("ratio-select");
      var ratioStr = ratioElBoard ? String(ratioElBoard.value || "") : "";
      var cssRatio = "16 / 9"; // 默认兜底
      var m = ratioStr.match(/(\d+):(\d+)/);
      if (m) cssRatio = m[1] + " / " + m[2];
      var imageSize = getImageSizeForRatio(ratioStr);

      var productEl = document.getElementById("product-input");
      var productName = (productEl && String(productEl.value || "").trim()) || "luxury product";

      container.innerHTML = "";
      container.style.display = "block";

      data.forEach(function (style, sIdx) {
        if (!style || !Array.isArray(style.shots)) return;

        var header = document.createElement("h3");
        header.textContent = style.styleName || "Style " + (sIdx + 1);
        header.style.cssText = "margin: 40px 0 16px; padding-bottom: 8px; border-bottom: 2px solid var(--blue); font-size: 1.2rem;";
        container.appendChild(header);

        // 2. 从左到右、自上而下：显式 LTR + row flow；单卡画幅比由 #ratio-select → cssRatio
        var grid = document.createElement("div");
        grid.style.cssText =
          "display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 24px; direction: ltr; grid-auto-flow: row; justify-items: stretch; align-items: start;";

        style.shots.forEach(function (shot, i) {
          var drawPrompt = buildVisualDrawPrompt(shot, style, productName, sIdx);

          var card = document.createElement("div");
          card.style.cssText = "border: 1px solid var(--border-color); border-radius: 12px; overflow: hidden; background: #fff; box-shadow: 0 4px 12px rgba(0,0,0,0.04); display: flex; flex-direction: column;";

          // 3. 画面框与 Loading 状态
          var imgFrame = document.createElement("div");
          imgFrame.style.cssText =
            "width: 100%; aspect-ratio: " +
            cssRatio +
            "; background: #f5f5f7; position: relative; border-bottom: 1px solid var(--border-color); overflow: hidden;";

          var redrawBtn = document.createElement("button");
          redrawBtn.type = "button";
          redrawBtn.textContent = "🔄 重绘";
          redrawBtn.title = "仅重绘本镜头";
          redrawBtn.style.cssText =
            "position: absolute; top: 8px; right: 8px; z-index: 3; padding: 4px 10px; font-size: 0.75rem; font-weight: 600; border: 1px solid rgba(0,0,0,0.12); border-radius: 8px; background: rgba(255,255,255,0.92); color: #333; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.08); backdrop-filter: blur(4px);";
          imgFrame.appendChild(redrawBtn);

          var loading = document.createElement("div");
          loading.innerHTML = VISUAL_LOADING_HTML;
          loading.style.cssText =
            "position: absolute; inset:0; display:flex; align-items:center; justify-content:center; color: #666; font-size: 0.85rem; font-weight: 500; background: #eef2f5; z-index: 1;";
          imgFrame.appendChild(loading);

          var img = document.createElement("img");
          img.style.cssText =
            "width: 100%; height: 100%; object-fit: cover; display: block; opacity: 0; transition: opacity 0.6s ease;";
          imgFrame.appendChild(img);
          card.appendChild(imgFrame);

          var renderCtx = {
            loading: loading,
            img: img,
            redrawBtn: redrawBtn,
            apiKey: openaiKeyForImages,
            imageModel: IMAGE_GENERATION_MODEL,
            drawPrompt: drawPrompt,
            imageSize: imageSize,
          };

          redrawBtn.addEventListener("click", function (e) {
            e.preventDefault();
            e.stopPropagation();
            renderCtx.drawPrompt = buildVisualDrawPrompt(shot, style, productName, sIdx);
            renderCtx.imageModel = window.getImageModel();
            renderCtx.apiKey =
              typeof window.getLlmApiKeyFromInput === "function"
                ? window.getLlmApiKeyFromInput()
                : String(document.getElementById("llm-api-key").value || "").trim();
            triggerVisualShotRender(renderCtx, 0);
          });

          triggerVisualShotRender(renderCtx, i * 1500);

          // 5. 文本区：自动滤除视觉冗余标记
          var content = document.createElement("div");
          content.style.cssText = "padding: 14px; flex: 1; display: flex; flex-direction: column;";

          var head = document.createElement("div");
          head.style.cssText = "display: flex; justify-content: space-between; font-weight: 600; font-size: 0.85rem; margin-bottom: 10px;";
          head.innerHTML = "<span>SHOT " + (i + 1) + "</span><span style='color: var(--blue); background: rgba(0,102,204,0.08); padding: 2px 8px; border-radius: 6px;'>" + escapeHtml(shot.duration || "-") + "s</span>";
          content.appendChild(head);

          var vis = document.createElement("div");
          vis.style.cssText = "font-size: 0.85rem; line-height: 1.5; color: var(--text); flex: 1;";
          // 去掉文本中丑陋的“(参考素材格 #X)”标记，因为上面已经有图了
          vis.textContent = String(shot.visual || "").replace(/\(参考素材格[^)]+\)/g, "").trim();
          content.appendChild(vis);

          var meta = document.createElement("div");
          meta.style.cssText = "font-size: 0.78rem; color: var(--muted); margin-top: 12px; border-top: 1px dashed #eee; padding-top: 10px;";
          meta.innerHTML = "🎥 " + escapeHtml(shot.motion || "");
          content.appendChild(meta);

          card.appendChild(content);
          grid.appendChild(card);
        });

        container.appendChild(grid);
      });

      // 5. 渲染完毕后，页面平滑滚动至视觉分镜区
      container.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
})();
