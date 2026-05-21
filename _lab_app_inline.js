/**
 * Ad Variant Lab - Director's Creative Engine (V2.0)
 * 完全对齐 .cursorrules.js 工业标准：
 * 1. 矢量化运动 (Vectorized Motion)
 * 2. 智能光影系统 (Lighting Rig)
 * 3. 视觉 DNA 提取 (Visual DNA)
 * 4. 空间坐标锚点 (Space Anchors)
 * 5. 绝对数据绑定 (Atomic Data Binding)
 *
 * 说明：卖点简报 LLM（directorVisionTransformLLM、renderBriefFromParsed）在 index.html 的内联脚本中，不在本文件。
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

  const API_IMAGE_MAX_SIDE = 1024;
  const API_IMAGE_JPEG_QUALITY = 0.8;

  /** 等比例缩放后转 JPEG Base64，避免 Vision API 请求体过大 (413) */
  function fileToCompressedBase64(file) {
    return new Promise(function (resolve, reject) {
      if (!file) {
        reject(new Error("无效文件"));
        return;
      }
      var blobUrl = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(blobUrl);
        var w = img.naturalWidth || img.width;
        var h = img.naturalHeight || img.height;
        if (!w || !h) {
          reject(new Error("无法读取图片尺寸"));
          return;
        }
        var maxSide = API_IMAGE_MAX_SIDE;
        if (w > maxSide || h > maxSide) {
          if (w >= h) {
            h = Math.round((h * maxSide) / w);
            w = maxSide;
          } else {
            w = Math.round((w * maxSide) / h);
            h = maxSide;
          }
        }
        var canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        var ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Canvas 不可用"));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        try {
          resolve(canvas.toDataURL("image/jpeg", API_IMAGE_JPEG_QUALITY));
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = function () {
        URL.revokeObjectURL(blobUrl);
        reject(new Error("图片加载失败"));
      };
      img.src = blobUrl;
    });
  }

  /* ========== 网络层（不修改分镜导演逻辑） ==========
   * - Origin：浏览器对跨域 fetch 自动附加，JS 无法手动设置（非缺失字段）
   * - Referer：由 referrerPolicy 控制；当前默认 strict-origin-when-cross-origin（见 index.html → llmApiFetch）
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
      throw new Error("llmApiFetch 未加载，请确认 index.html 已引入网络层脚本");
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
        "[分镜引擎] 当前为 file:// 协议。请安装 Live Server，右键 index.html → Open with Live Server，" +
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
        const b64 = await fileToCompressedBase64(batchFiles[j]);
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

        const rawContent = String(data.choices[0].message.content)
          .replace(/```json\s*|```/gi, "")
          .trim();
        const parsed = JSON.parse(rawContent);

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
    return "";
  }

  btnCraftStoryboard.addEventListener("click", async function () {
    if (btnCraftStoryboard.disabled) return;
    btnCraftStoryboard.disabled = true;
    var originalBtnText = btnCraftStoryboard.textContent;
    btnCraftStoryboard.textContent = "推演中... (请勿重复点击)";

    try {
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

      if (!apiKey) {
        alert("请先输入 OPENAI API KEY");
        return;
      }
      if (!briefContent || briefContent.indexOf("【API 请求失败】") !== -1) {
        alert("请先上传素材并等待‘卖点简报’解析完成");
        return;
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

      initDashboardSkeleton();
      setLabBusy(false);

      await generateThreeStyleStoryboards(params, apiKey, function (idx, styleObj) {
        renderSingleStylePanel(idx, styleObj);
      });

      finalizeProgressiveStoryboardDashboard();
      setStoryEngineProgress("✅ 三套分镜已全部就绪", 100);
      setTimeout(function () {
        clearStoryEngineProgress();
      }, 2200);
    } catch (err) {
      alert(formatLlmFetchAlertMessage(err, "分镜引擎故障"));
      clearStoryEngineProgress();
    } finally {
      setLabBusy(false);
      btnCraftStoryboard.disabled = false;
      btnCraftStoryboard.textContent = originalBtnText;
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

  /** 结构化提取 + JSON.parse；失败时再试尾逗号修复与括号补全兜底 */
  function extractAndParseStoryboardJson(raw) {
    var s = String(raw == null ? "" : raw)
      .replace(/```json\s*|```/gi, "")
      .trim();
    var jsonMatch = s.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("AI 返回了非 JSON 格式的废话");
    try {
      return JSON.parse(jsonMatch[0]);
    } catch (e) {
      var repaired = jsonMatch[0].replace(/,\s*([\]}])/g, "$1");
      try {
        return JSON.parse(repaired);
      } catch (e2) {
        return parseJsonWithClosingBraceRepair(jsonMatch[0]);
      }
    }
  }

  /** 终极智能补全：支持对象 {} 和 数组 [] 混合嵌套精准修复（仅作兜底） */
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

  async function generateThreeStyleStoryboards(p, key, onStyleReady) {
    setStoryEngineProgress("分镜引擎启动：将依次处理 Style A / B / C…", 1);

    const files = typeof window.__getStoryboardImageFiles === "function" ? window.__getStoryboardImageFiles() : [];
    const base64Images = [];
    for (let i = 0; i < Math.min(files.length, 6); i++) {
      base64Images.push(await fileToCompressedBase64(files[i]));
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
    var catalogSlotCount = Math.min(galItems.length > 0 ? galItems.length : n, 6);

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
        name: "Style A (核心属性揭秘 / Core Attribute)",
        focus:
          "【动态推演：材质与功能本源】请根据当前产品类目自行推演最适配的视觉风格！严禁无脑套用3C/美妆模板。如果产品是工业机械，请展现力量与工程结构；如果是宠物食品，请展现原切质感与食欲。重点：剥离冗杂环境，用最极致的光影和机位（如微距/透视）放大产品最核心的物理或功能特征。",
      },
      {
        id: "B",
        name: "Style B (场景与情绪共生 / Context & Emotion)",
        focus:
          "【动态推演：真实使用语境】必须基于 [usage_scenarios] 推演最符合该品类目标受众的生活/使用场景。禁止强行制造高级感。如果是户外装备，必须有泥土与风雨的粗粝感；如果是母婴用品，必须有温和柔软的交互。通过一连串自然的动作流，让产品与使用者产生情绪共鸣。",
      },
      {
        id: "C",
        name: "Style C (感官刺激与钩子 / Hook-Driven)",
        focus:
          "【动态推演：反常规视觉奇观】彻底打破常规！根据品类特性，设计极具反差感或视觉欺骗性的开场。强制使用 Match Cut（匹配剪辑）、极端视角或夸张的音效放大体验。动作必须快、准、狠，绝不拖泥带水，让观众在第一秒就被按在屏幕前。",
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
      if (styleOpts.id === "C" || styleOpts.styleId === "C") return true;
      var nm = String(styleOpts.styleName || styleOpts.name || "");
      return /style\s*c\b/i.test(nm);
    }

    /** Style C：单镜不得超过 2.5s，违规则抛错要求模型重写 */
    function assertStyleCShotDurationLimit(shots, phase) {
      var maxSec = 2.5;
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
      var STYLE_C_SHOT_CAP_SEC = 2.5;
      if (styleC) assertStyleCShotDurationLimit(shots, "校准前");

      if (styleC) {
        var styleCMaxTotal = roundDurD(shots.length * STYLE_C_SHOT_CAP_SEC);
        var minShotsNeeded = Math.ceil(lo / STYLE_C_SHOT_CAP_SEC);
        if (styleCMaxTotal < lo - 0.02) {
          throw new Error(
            "Style C 物理死锁：当前 " +
              shots.length +
              " 镜 × " +
              STYLE_C_SHOT_CAP_SEC +
              "s 上限 = " +
              styleCMaxTotal +
              "s，无法达到目标下限 " +
              lo +
              "s。至少需要 " +
              minShotsNeeded +
              " 镜。请重新生成分镜（增加镜头数，禁止拉长单镜）。"
          );
        }
      }

      var GRID_VISUAL_CAP_RE = /宫格|分屏|阵列/;

      function shotMaxDurationCap(shot) {
        if (styleC) return 2.5;
        var vis = String(shot && shot.visual != null ? shot.visual : "");
        if (GRID_VISUAL_CAP_RE.test(vis)) return hi * 0.5;
        return 5;
      }

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
        if (styleC) {
          for (i = 0; i < shots.length; i++) shots[i].duration = STYLE_C_SHOT_CAP_SEC;
        } else {
          var mid0 = roundDurD((lo + hi) / 2);
          var per0 = Math.max(0.25, roundDurD(mid0 / shots.length));
          for (i = 0; i < shots.length; i++) shots[i].duration = per0;
        }
        stripWeights();
        if (styleC) assertStyleCShotDurationLimit(shots, "校准后");
        return;
      }

      var scale = 1;
      var targetIdeal = roundDurD(lo + (hi - lo) * 0.4); // 目标定在区间中位偏上，拒绝踩底线
      if (rawSum < targetIdeal) scale = targetIdeal / rawSum;
      else if (rawSum > hi + 0.02) scale = hi / rawSum;
      var goal = rawSum < targetIdeal ? targetIdeal : rawSum > hi + 0.02 ? hi : rawSum;

      var tot = 0;
      for (i = 0; i < shots.length; i++) {
        var d = parseFloat(shots[i].duration) || 0;
        var scaled = roundDurD(d * scale);
        var capI = shotMaxDurationCap(shots[i]);
        if (scaled > capI) scaled = capI;
        shots[i].duration = scaled;
        tot += shots[i].duration;
      }
      stripWeights();

      tot = roundDurD(tot);
      var drift = roundDurD(goal - tot);
      if (shots.length && Math.abs(drift) >= 0.005) {
        var minAllowed = 0.5;
        if (drift > 0) {
          for (i = shots.length - 1; i >= 0 && drift >= 0.005; i--) {
            var cur = parseFloat(shots[i].duration) || 0;
            var maxAllowed = shotMaxDurationCap(shots[i]);
            var headroom = Math.max(0, roundDurD(maxAllowed - cur));
            if (headroom <= 0) continue;
            var add = drift <= headroom ? drift : headroom;
            shots[i].duration = roundDurD(cur + add);
            drift = roundDurD(drift - add);
          }
        } else {
          for (i = shots.length - 1; i >= 0 && drift <= -0.005; i--) {
            var cur2 = parseFloat(shots[i].duration) || 0;
            var slack = Math.max(0, roundDurD(cur2 - minAllowed));
            if (slack <= 0) continue;
            var sub = -drift <= slack ? -drift : slack;
            shots[i].duration = roundDurD(cur2 - sub);
            drift = roundDurD(drift + sub);
          }
        }
      }

      if (styleC) assertStyleCShotDurationLimit(shots, "校准后");

      var totFinal = 0;
      for (i = 0; i < shots.length; i++) totFinal += parseFloat(shots[i].duration) || 0;
      totFinal = roundDurD(totFinal);
      if (styleC && totFinal < lo - 0.02) {
        var capSum = roundDurD(shots.length * STYLE_C_SHOT_CAP_SEC);
        if (capSum >= lo - 0.02) {
          for (i = 0; i < shots.length; i++) shots[i].duration = STYLE_C_SHOT_CAP_SEC;
          totFinal = capSum;
          if (totFinal > hi + 0.02) {
            var sc = hi / totFinal;
            totFinal = 0;
            for (i = 0; i < shots.length; i++) {
              shots[i].duration = roundDurD(
                Math.min(STYLE_C_SHOT_CAP_SEC, (parseFloat(shots[i].duration) || 0) * sc)
              );
              totFinal += shots[i].duration;
            }
            totFinal = roundDurD(totFinal);
          }
        }
        if (totFinal < lo - 0.02) {
          throw new Error(
            "Style C 物理死锁：校准后总长 " +
              totFinal +
              "s，低于目标下限 " +
              lo +
              "s（" +
              shots.length +
              " 镜 × " +
              STYLE_C_SHOT_CAP_SEC +
              "s 上限 = " +
              capSum +
              "s）。需要至少 " +
              Math.ceil(lo / STYLE_C_SHOT_CAP_SEC) +
              " 镜。"
          );
        }
        if (styleC) assertStyleCShotDurationLimit(shots, "校准后");
      }
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
        var vis = stripSystemTokensFromVisual(String(shots[i].visual || ""));
        vis = vis.replace(GRID_REF_REPLACE_G, function () {
          return "";
        });
        vis = vis.replace(/参考素材格[^)]*\)/g, "");
        vis = collapseSpaces(vis);

        var k = parseInt(shots[i].source_image_id, 10);
        if (isNaN(k) || k < 1) k = 1;
        if (galleryCount && k > galleryCount) k = galleryCount;
        if (!galleryCount) k = 1;

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

      var platformStr = String(p.platform || "");
      var isShortVideo = /TikTok|Reels|Shorts|小红书|Instagram/.test(platformStr);
      var isStyleC = isStyleCFastCut(styleCfg);
      var avgShotLen = isShortVideo || isStyleC ? 1.5 : 3.5;
      var theoreticalShots = Math.ceil(targetMax / avgShotLen);

      var targetNodes = 4;
      if (theoreticalShots <= 6) {
        targetNodes = 4;
      } else if (theoreticalShots <= 12) {
        targetNodes = 9;
      } else if (theoreticalShots <= 20) {
        targetNodes = 16;
      } else if (theoreticalShots <= 27) {
        targetNodes = 25;
      } else {
        var remainder = theoreticalShots - 25;
        if (remainder <= 6) targetNodes = 25 + 4;
        else if (remainder <= 12) targetNodes = 25 + 9;
        else if (remainder <= 20) targetNodes = 25 + 16;
        else targetNodes = 25 + 25;
      }

      var minShotsPhysics = isStyleC ? Math.ceil(targetMin / 2.5) : 0;
      if (isStyleC && targetNodes < minShotsPhysics) {
        targetNodes = minShotsPhysics;
      }

      setStoryEngineProgress(
        styleCfg.name + " 正在生成，当前时长匹配目标镜头数: " + targetNodes + " 镜...",
        8 + (typeof styleIndex === "number" ? styleIndex : 0) * 28
      );

      var dynamicPacingBlock =
        "【最高级别数学死命令：阶梯式镜头定额】\n" +
        "当前目标总时长为【" +
        targetMin +
        "-" +
        targetMax +
        "s】。\n" +
        "💥 智能化分镜要求：全片共需【" +
        targetNodes +
        " 个镜头】（基于 4/9/16/25 阶梯矩阵推算）。系统将分多批请求你撰写；每批 user 消息会写明本批须输出的镜头数，严禁单批多写或少写。\n" +
        "🔥【全平台通用法则】：前 3 秒（第 1 镜或前 2 镜）必须是极具视觉冲击力的 Hook！\n" +
        (isShortVideo || isStyleC
          ? "👉 【短视频/Style C 法则】：单镜严禁超过 2.5 秒，用 " +
            targetNodes +
            " 镜的高频切换填满总时长。"
          : "👉 【传统/电商法则】：必须严格分配 " +
            targetNodes +
            " 镜，允许局部出现 4-6s 包含复杂空间调度（如 Arc Orbit）的长镜。") +
        "\n⚡ 警告：如果总时长极长，导致分配到 " +
        targetNodes +
        " 镜后单镜时长依然超标，请在 visual 中调用「宫格分屏阵列」在同一镜内高频闪烁吸收时长，绝不允许通过拖长单个画面的秒数来注水！\n";

      const systemPrompt =
        `你是一位身价千万的商业广告导演。你现在的任务是生成一份「初稿即过稿」的专业脚本。

【全行业过稿死命令】：
1. 风格差异化：三套方案视觉语言、场景与节奏必须差异巨大；严禁三套写成同一口吻。各套须严格执行 user 消息中的「本套风格动态推演要求」。
2. 矢量运镜：每一镜须含明确镜头运动术语（Dolly In, Arc Orbit, Rack Focus 等），禁止含糊的「镜头动一下」。
3. 灯光系统：每镜须指定 Lighting Rig，并按**当前产品品类**匹配（勿无脑套用 3C/美妆模板）。
4. 剪接锚点：Shot N 结束态与 Shot N+1 起幅须可剪接对齐，严禁空间瞬移。
5. 叙事闭环：结尾须让观众读懂产品价值或最终形态，禁止只有过程无结论。

【输出格式】：只输出合法 JSON，visual 描述必须是充满镜头感的纯中文，严禁含糊其辞。第 1 镜须直接呈现产品本体或可读的局部核心（禁止纯人物/纯风景无产品前摇）。
${buildUniversalBindingPromptBlock(catalogSlotCount)}
${dynamicPacingBlock}
【物理算数死命令】：所有镜头的 duration 累加总和必须严格落在 ${targetMin}-${targetMax} 秒之间！${isStyleC ? "Style C 单镜 duration 不得超过 2.5s，须用足够镜头数填满总长。" : "非 Style C 可用宫格分屏阵列镜分配较长 duration 吸收总长，禁止少量呆板单镜糊弄。"}
【技术铁律·解析兼容】顶层含字符串 director_treatment、visualDNA（必填：顶级英文 DALL-E 生图 Prompt）与数组 shots；每镜须含 source_image_id（整数）、matching_reason、duration（物理秒数）、visual（纯中文画面，不含素材格引用）、motion。严禁 duration_weight！
【输出格式要求】：shots 中 source_image_id 必须为整数；不要在 visual 内写任何参考图/素材格描述，引用由后期脚本自动挂载。若 JSON 无法闭合，请在末尾补全所有闭合符号，严禁省略。
只输出合法 JSON，严禁 markdown 包裹。`;

      var userTextBlock =
        "【投放平台】：" +
        (platformStr || "未指定") +
        "\n" +
        "【总时长目标】：" +
        targetMin +
        "-" +
        targetMax +
        "s\n" +
        "【产品定位与核心卖点】：\n" +
        "产品：" +
        String(p.product != null ? p.product : "未填写") +
        " (" +
        (p.category && String(p.category).trim() ? String(p.category).trim() : "未分类") +
        ")\n" +
        "简报：" +
        String(p.brief != null ? p.brief : "无") +
        "\n" +
        "【场景库】：" +
        usageScenariosForPrompt +
        "\n\n" +
        "⚡【单点多维拆解法则（防注水死命令）】：如果简报提供的卖点很少，绝对禁止拉长单镜时长来凑数！你必须把一个单薄的卖点拆解为 4 个视觉维度分镜呈现：1.物理表象(特写材质) 2.动作触发(如何操作/交互) 3.痛点对比(没有它的惨状) 4.情绪收益(使用后的神态/氛围)。必须用高密度的多维镜头填满时长！\n\n" +
        "【本套风格动态推演要求：" +
        styleCfg.name +
        "】\n" +
        styleCfg.focus +
        "\n\n指令：请仔细观察提供的产品图，结合卖点、品类和平台特性设计分镜。强制要求：1. 严格遵守动态推演的风格设定。2. 在 \`visualDNA\` 中输出一段【顶级英文 DALL-E 生图 Prompt】。3. 每镜 source_image_id 必须与画面语义和素材目录一致。\n" +
        gridHint;

      var userContent = [{ type: "text", text: userTextBlock }];
      base64Images.forEach(function (b64) {
        userContent.push({ type: "image_url", image_url: { url: b64, detail: "high" } });
      });

      var lastError = null;
      var styleObj = { shots: [] };
      var originalContent = "";

      // ====== 🚀 分批流水线生成 (Batching) 开始 ======
      var currentShots = [];
      var batchSize = 12; // 绝对安全区：每次最多逼 AI 吐 12 镜，防断流
      var batchCount = 0;
      var maxBatches = Math.ceil(targetNodes / batchSize) + 1; // 防死循环兜底
      var lastShotContext = null;

      while (currentShots.length < targetNodes && batchCount < maxBatches) {
        batchCount++;
        var shotsToRequest = Math.min(batchSize, targetNodes - currentShots.length);

        setStoryEngineProgress(
          styleCfg.name + " 正在分批生成 (第 " + batchCount + " 批)... 已完成 " + currentShots.length + "/" + targetNodes + " 镜", 
          10 + (currentShots.length / targetNodes) * 30
        );

        // 动态构建当前批次的系统 Prompt
        var currentSystemPrompt = systemPrompt;
        if (batchCount > 1 && lastShotContext) {
           currentSystemPrompt += `\n\n【分批串联死命令】：这是第 ${batchCount} 批请求，请接着上一批继续写！你本次只需输出 ${shotsToRequest} 个镜头。上一镜（第${currentShots.length}镜）画面是：“${lastShotContext.visual}”，动作是：“${lastShotContext.motion}”。请确保本批次第 1 镜与上一镜在动作和空间上完美衔接！`;
        }

        var batchSuccess = false;
        // 每批次最多允许重试 2 次
        for (var attempt = 1; attempt <= 2; attempt++) {
          try {
            const res = await llmApiFetch("chat/completions", {
              label: styleCfg.name + " 分镜 (批次 " + batchCount + ")",
              apiKey: key,
              body: JSON.stringify({
                model: window.getTextModel(),
                max_tokens: 8192,
                temperature: attempt === 1 ? 0.1 : 0.3,
                messages: [
                  { role: "system", content: currentSystemPrompt },
                  { role: "user", content: userContent },
                ],
                response_format: { type: "json_object" },
              }),
            });

            const data = await res.json();
            originalContent = String(data?.choices?.[0]?.message?.content || "");
            if (!originalContent.trim()) throw new Error("批次响应为空");

            const parsed = extractAndParseStoryboardJson(originalContent);
            var tempStyleObj = parsed.style != null ? parsed.style : parsed;

            if (!tempStyleObj.shots || !Array.isArray(tempStyleObj.shots)) throw new Error("本批次缺少分镜数组");

            // 第一批保存最外层的元数据 (DNA & 阐述)
            if (batchCount === 1) {
                styleObj.director_treatment = tempStyleObj.director_treatment;
                styleObj.visualDNA = tempStyleObj.visualDNA;
            }

            // 将本批次的镜头拼接到总数组中
            currentShots = currentShots.concat(tempStyleObj.shots);

            // 记录本批最后一镜，供下一次循环承接使用
            if (currentShots.length > 0) {
                var ls = currentShots[currentShots.length - 1];
                lastShotContext = { visual: ls.visual, motion: ls.motion };
            }

            batchSuccess = true;
            break; // 成功则跳出当前批次的重试循环
          } catch (e) {
            lastError = e;
            console.warn(`[批次重试] ${styleCfg.name} 第 ${batchCount} 批次第 ${attempt} 次失败:`, e);
          }
        }
        
        // 如果某一整个批次连续失败，直接打断 while，拿着已有的镜头强行往下走，绝不抛错卡死！
        if (!batchSuccess) {
            console.warn(`[分批中断] ${styleCfg.name} 第 ${batchCount} 批次彻底失败，带着已生成的 ${currentShots.length} 镜强行进入后续时长校准。`);
            break; 
        }
      }

      styleObj.shots = currentShots;

      // 只有当一镜都没生成出来时，才抛出致命错误
      if (!styleObj.shots.length) {
        throw new Error(styleCfg.name + " 连续生成失败：" + String(lastError && lastError.message ? lastError.message : lastError));
      }

      // 彻底废除原来的强硬抛错卡死逻辑，改为控制台软警告，强行放行
      var acceptableMin = Math.max(4, Math.floor(targetNodes * 0.5));
      if (styleObj.shots.length < acceptableMin) {
        console.warn("AI 镜头数偏少，但为了系统稳定已放行：期望 " + targetNodes + " 镜，实际 " + styleObj.shots.length + " 镜。");
      }
      // ====== 🚀 分批流水线生成 (Batching) 结束 ======

      try {
        setStoryEngineProgress(styleCfg.name + " 正在进行视觉闭环校验…", 42 + (typeof styleIndex === "number" ? styleIndex : 0) * 26);

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
      const results = [null, null, null];
      for (var si = 0; si < stylesToCraft.length; si++) {
        if (si > 0) await sleep(500);
        const singleStyleObj = await craftSingleStyle(stylesToCraft[si], si);
        results[si] = singleStyleObj;
        if (typeof onStyleReady === "function") {
          onStyleReady(si, singleStyleObj);
        }
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

  var storyboardTabHandlersBound = false;

  function buildStoryboardPanelHtml(style, sIdx) {
    void sIdx;
    const rawShots = style.shots || style.content || style.list || style.Shots || [];
    const shots = Array.isArray(rawShots) ? rawShots : [];
    var totalSec = 0;
    shots.forEach(function (sh) {
      totalSec += parseFloat(sh.duration || 0) || 0;
    });

    var treatment = style.director_treatment != null ? String(style.director_treatment) : "";
    var html =
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
      "</div>";

    var hasVisualUrls = shots.some(function (sh) {
      return sh && sh.visual_image_url;
    });
    if (hasVisualUrls) {
      var ratioElRestore = document.getElementById("ratio-select");
      var ratioStrRestore = ratioElRestore ? String(ratioElRestore.value || "") : "";
      var cssRatioRestore = "16 / 9";
      var mRestore = ratioStrRestore.match(/(\d+):(\d+)/);
      if (mRestore) cssRatioRestore = mRestore[1] + " / " + mRestore[2];

      html +=
        '<div class="style-visual-board" style="margin-top:24px;">' +
        '<h3 style="margin:0 0 16px;padding-bottom:8px;border-bottom:2px solid var(--blue);font-size:1.2rem;">🖼️ 视觉分镜图</h3>' +
        '<div class="style-visual-board-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:24px;direction:ltr;grid-auto-flow:row;">';

      shots.forEach(function (shot, vi) {
        var visUrl = shot && shot.visual_image_url ? String(shot.visual_image_url) : "";
        if (!visUrl) return;
        html +=
          '<div class="visual-shot-card" style="border:1px solid var(--border-color);border-radius:12px;overflow:hidden;background:#fff;box-shadow:0 4px 12px rgba(0,0,0,0.04);">' +
          '<div style="width:100%;aspect-ratio:' +
          cssRatioRestore +
          ';background:#f5f5f7;overflow:hidden;border-bottom:1px solid var(--border-color);">' +
          '<img src="' +
          escapeHtml(visUrl) +
          '" alt="" style="width:100%;height:100%;object-fit:cover;display:block;" loading="lazy" />' +
          "</div>" +
          '<div style="padding:14px;font-size:0.85rem;font-weight:600;">SHOT ' +
          (vi + 1) +
          "</div></div>";
      });

      html += "</div></div>";
    }

    html += "</div>";
    return html;
  }

  function syncStoryboardModsDropdown(styles) {
    var modsTarget = document.getElementById("storyModsTarget");
    if (!modsTarget || !Array.isArray(styles)) return;

    var oldVal = modsTarget.value;

    modsTarget.innerHTML = "";
    var hasAny = false;
    styles.forEach(function (style, idx) {
      if (!style) return;
      hasAny = true;
      var opt = document.createElement("option");
      opt.value = String(idx);
      opt.textContent = style.styleName || "Style " + (idx + 1);
      modsTarget.appendChild(opt);
    });

    if (hasAny) {
      modsTarget.removeAttribute("disabled");
      if (oldVal && modsTarget.querySelector('option[value="' + oldVal + '"]')) {
        modsTarget.value = oldVal;
      } else if (!modsTarget.value) {
        modsTarget.value = "0";
      }
    }
  }

  function bindStoryboardTabHandlers() {
    if (storyboardTabHandlersBound) return;
    storyboardTabHandlersBound = true;

    var tabBtns = document.querySelectorAll(".tab-btn");
    tabBtns.forEach(function (btn) {
      btn.onclick = function () {
        document.querySelectorAll(".tab-btn, .tab-panel").forEach(function (el) {
          el.classList.remove("is-active");
        });
        this.classList.add("is-active");
        var pid = this.dataset.tab;
        var pnl = pid != null ? document.getElementById("panel-" + pid) : null;
        if (pnl) pnl.classList.add("is-active");
        document.querySelectorAll(".tab-btn").forEach(function (b) {
          b.setAttribute("aria-selected", b === this ? "true" : "false");
        }, this);
        var modsTargetSync = document.getElementById("storyModsTarget");
        if (modsTargetSync && pid != null && pid !== "") modsTargetSync.value = String(pid);
      };
    });

    var modsTarget = document.getElementById("storyModsTarget");
    if (modsTarget) {
      modsTarget.onchange = function () {
        var tid = String(this.value || "");
        var tabBtn = document.querySelector('.tab-btn[data-tab="' + tid + '"]');
        if (tabBtn && typeof tabBtn.click === "function") tabBtn.click();
      };
    }
  }

  /** 渐进式渲染：点击生成时立即展示三 Tab 骨架（仅初始化一次，后续只注入单片） */
  function initDashboardSkeleton() {
    var dashboard = document.getElementById("storyDashboard");
    var panels = document.getElementById("tabPanels");
    var tabBtns = document.querySelectorAll(".tab-btn");
    var modsTarget = document.getElementById("storyModsTarget");
    if (!dashboard || !panels) return;

    if (!document.getElementById("lab-visual-dalle-pulse")) {
      var skPulse = document.createElement("style");
      skPulse.id = "lab-visual-dalle-pulse";
      skPulse.textContent = "@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.45}}";
      document.head.appendChild(skPulse);
    }

    window.__LAST_STORYBOARD_DATA__ = [null, null, null];

    if (modsTarget) {
      modsTarget.innerHTML = "";
      modsTarget.setAttribute("disabled", "true");
    }

    dashboard.classList.add("is-visible");
    dashboard.setAttribute("aria-hidden", "false");
    panels.innerHTML = "";

    tabBtns.forEach(function (btn, idx) {
      btn.style.display = "inline-block";
      btn.innerHTML =
        '<span style="animation:pulse 1.5s infinite;opacity:0.6;">⏳ Style ' +
        (idx + 1) +
        " 生成中...</span>";
      btn.classList.remove("is-active");
      btn.setAttribute("aria-selected", "false");

      var panel = document.createElement("div");
      panel.className = "tab-panel";
      panel.id = "panel-" + idx;
      panel.innerHTML =
        '<div style="padding:40px;text-align:center;color:var(--muted);">' +
        '<span style="animation:pulse 1.5s infinite;">正在推演第 ' +
        (idx + 1) +
        " 套分镜，请稍候...</span></div>";
      panels.appendChild(panel);
    });

    if (tabBtns[0]) {
      tabBtns[0].classList.add("is-active");
      tabBtns[0].setAttribute("aria-selected", "true");
    }
    var firstPanel = document.getElementById("panel-0");
    if (firstPanel) firstPanel.classList.add("is-active");

    dashboard.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /** 渐进式渲染：仅替换 panel-{sIdx} 内容，不清空 panels 容器 */
  function renderSingleStylePanel(sIdx, style) {
    if (!style) return;

    var tabBtn = document.querySelector('.tab-btn[data-tab="' + sIdx + '"]');
    var panel = document.getElementById("panel-" + sIdx);
    if (!panel) return;

    var slots = window.__LAST_STORYBOARD_DATA__;
    if (!Array.isArray(slots)) slots = [null, null, null];
    slots[sIdx] = style;
    window.__LAST_STORYBOARD_DATA__ = slots;

    if (tabBtn) {
      tabBtn.textContent = style.styleName || "Style " + (sIdx + 1);
    }

    syncStoryboardModsDropdown(slots);

    panel.innerHTML = buildStoryboardPanelHtml(style, sIdx);
    attachGridInteractivity();
  }

  /** 渐进式渲染：三套就绪后绑定 Tab 切换（宫格悬浮已在单片注入时绑定） */
  function finalizeProgressiveStoryboardDashboard() {
    bindStoryboardTabHandlers();
  }

  function renderStoryboardDashboard(data) {
    const dashboard = document.getElementById("storyDashboard");
    const panels = document.getElementById("tabPanels");
    const tabBtns = document.querySelectorAll(".tab-btn");
    if (!dashboard || !panels) return;

    const styles =
      (data != null && data.styles) || (Array.isArray(data) ? data : []);
    if (!Array.isArray(styles) || styles.length === 0) {
      return alert("AI 未返回有效分镜数据，请重试");
    }

    window.__LAST_STORYBOARD_DATA__ = styles;

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
      if (!style) return;
      var panel = document.createElement("div");
      panel.className = "tab-panel " + (sIdx === 0 ? "is-active" : "");
      panel.id = "panel-" + sIdx;
      panel.innerHTML = buildStoryboardPanelHtml(style, sIdx);
      panels.appendChild(panel);
    });

    tabBtns.forEach(function (btn, idx) {
      btn.classList.toggle("is-active", idx === 0 && styles[0]);
      btn.setAttribute("aria-selected", idx === 0 && styles[0] ? "true" : "false");
    });

    syncStoryboardModsDropdown(styles);
    bindStoryboardTabHandlers();
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
    const parsed = extractAndParseStoryboardJson(originalContent);
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
      return "Sterile clean environment, macro probe lens, pure white and grey background, extreme micro-details, sharp focus, NO clutter, pristine material texture.";
    }
    if (/style\s*b\b/i.test(name) || sIdx === 1) {
      return "High-end lifestyle photography, warm afternoon sunlight, beautiful depth of field, blurred background, cinematic bokeh, authentic and elegant.";
    }
    return "Dynamic angle, motion blur, high contrast dramatic lighting, deep shadows, aggressive composition, extreme visual impact.";
  }

  function buildVisualDrawPrompt(shot, style, productName, sIdx) {
    var cleanVisual = String(shot.visual || "").replace(/\(参考素材格[^)]+\)/g, "").trim();
    var exactProductDescription =
      style && style.visualDNA && String(style.visualDNA).trim()
        ? String(style.visualDNA).trim()
        : window.__MASTER_VISUAL_PROMPT__ || productName;

    var catEl = document.getElementById("category-input");
    var category = catEl ? String(catEl.value || "").trim() : "";

    var parts = [
      "Hyper-realistic high-end commercial photography, photorealistic masterpiece, shot on ARRI Alexa 65, Zeiss Master Prime lens, 8k resolution, highly detailed.",
    ];
    if (category) parts.push("Industry visual style: Top-tier luxury " + category + " commercial aesthetic, perfectly matching the industry's highest visual standards.");

    parts.push("Product exact appearance: " + exactProductDescription + ".");
    parts.push("Action/Scene: " + cleanVisual);

    var lighting = shot.lighting != null ? String(shot.lighting).trim() : "";
    if (lighting) parts.push("Lighting: " + lighting + ", professional studio quality.");
    var motion = shot.motion != null ? String(shot.motion).trim() : "";
    if (motion) parts.push("Camera/Motion: " + motion);

    var mood = getStyleMoodSuffix(style, sIdx);
    if (mood) parts.push(mood);

    return parts.join(" ");
  }

  function labSleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function isVisualRateLimitError(err) {
    var msg = String(err && err.message ? err.message : err || "");
    return /\b429\b|rate\s*limit|too many requests/i.test(msg);
  }

  function requestVisualShotImage(opts) {
    var loading = opts.loading;
    var img = opts.img;
    var redrawBtn = opts.redrawBtn;

    loading.style.display = "flex";
    loading.innerHTML = VISUAL_LOADING_HTML;
    img.style.opacity = "0";
    if (redrawBtn) redrawBtn.disabled = true;

    var apiPath = "images/generations";

    function runImageGenAttempt(retriesLeft) {
      return llmApiFetch(apiPath, {
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
        .catch(function (err) {
          if (retriesLeft > 0 && isVisualRateLimitError(err)) {
            loading.innerHTML =
              "<span style='font-size:12px;color:#666;'>限流冷却中，2.5s 后重试…</span>";
            return labSleep(2500).then(function () {
              return runImageGenAttempt(retriesLeft - 1);
            });
          }
          throw err;
        });
    }

    return runImageGenAttempt(1)
      .then(function (genData) {
        if (genData && genData.data && genData.data[0] && genData.data[0].url) {
          img.src = genData.data[0].url;
          if (opts.shot) opts.shot.visual_image_url = genData.data[0].url;
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

  /** 慢速排队池：严格单线程，且任务间强制间隔 delayMs，防止 DALL-E 429 限流 */
  function runVisualRenderConcurrencyPool(taskFns, maxConcurrency) {
    void maxConcurrency;
    var fns = Array.isArray(taskFns) ? taskFns : [];
    if (!fns.length) return Promise.resolve();

    var delayMs = 10000;

    return new Promise(function (resolve) {
      var idx = 0;

      function pump() {
        if (idx >= fns.length) {
          resolve();
          return;
        }
        var taskFn = fns[idx++];
        Promise.resolve()
          .then(function () {
            return typeof taskFn === "function" ? taskFn() : Promise.resolve();
          })
          .catch(function (err) {
            console.error("[Visual] 队列任务失败:", err);
          })
          .finally(function () {
            if (idx < fns.length) {
              setTimeout(pump, delayMs);
            } else {
              resolve();
            }
          });
      }
      pump();
    });
  }

  function triggerVisualShotRender(ctx) {
    if (!ctx.apiKey) {
      ctx.loading.style.display = "flex";
      ctx.loading.innerHTML =
        "<span style='color:red;'>缺少 OPENAI API KEY（请在页面顶部填写，与分镜脚本共用）</span>";
      return Promise.resolve();
    }
    return requestVisualShotImage(ctx);
  }

  var btnRenderVisualBoard = document.getElementById("btnRenderVisualBoard");
  if (btnRenderVisualBoard) {
    btnRenderVisualBoard.addEventListener("click", function () {
      llmFetchFailAlertShown = false;
      /** 生图：joinLlmApiPath → /api/proxy/v1/images/generations（Vercel 同源代理）；模型 dall-e-3（硬编码） */
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

      var activeTabBtn = document.querySelector(".tab-btn.is-active");
      var sIdx = activeTabBtn ? parseInt(String(activeTabBtn.dataset.tab || "0"), 10) : 0;
      if (isNaN(sIdx) || sIdx < 0) sIdx = 0;

      var style = data[sIdx];
      if (!style || !Array.isArray(style.shots) || !style.shots.length) {
        return alert("当前 Tab 无有效分镜，请先生成分镜脚本");
      }

      var panel = document.getElementById("panel-" + sIdx);
      if (!panel) return;

      var container = panel.querySelector(".style-visual-board");
      if (!container) {
        container = document.createElement("div");
        container.className = "style-visual-board";
        container.style.cssText = "margin-top: 24px;";
        panel.appendChild(container);
      } else {
        container.innerHTML = "";
      }

      var legacyVisualHost = document.getElementById("visualBoardContainer");
      if (legacyVisualHost) {
        legacyVisualHost.style.display = "none";
        legacyVisualHost.innerHTML = "";
      }

      // 1. 获取用户选择的画幅比例 (如 9:16 Vertical)
      var ratioElBoard = document.getElementById("ratio-select");
      var ratioStr = ratioElBoard ? String(ratioElBoard.value || "") : "";
      var cssRatio = "16 / 9"; // 默认兜底
      var m = ratioStr.match(/(\d+):(\d+)/);
      if (m) cssRatio = m[1] + " / " + m[2];
      var imageSize = getImageSizeForRatio(ratioStr);

      var productEl = document.getElementById("product-input");
      var productName = (productEl && String(productEl.value || "").trim()) || "luxury product";

      var visualRenderTasks = [];

      var header = document.createElement("h3");
      header.textContent = style.styleName || "Style " + (sIdx + 1);
      header.style.cssText = "margin: 0 0 16px; padding-bottom: 8px; border-bottom: 2px solid var(--blue); font-size: 1.2rem;";
      container.appendChild(header);

      var grid = document.createElement("div");
      grid.className = "style-visual-board-grid";
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
            shot: shot,
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
            triggerVisualShotRender(renderCtx);
          });

          visualRenderTasks.push(function () {
            return triggerVisualShotRender(renderCtx);
          });

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

      runVisualRenderConcurrencyPool(visualRenderTasks);

      container.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  var btnCopyMarkdownFeishu = document.getElementById("btnCopyMarkdownFeishu");
  if (btnCopyMarkdownFeishu) {
    btnCopyMarkdownFeishu.addEventListener("click", function () {
      var data = window.__LAST_STORYBOARD_DATA__;
      if (!data || !data.length) return alert("暂无分镜数据可复制，请先生成脚本。");

      var activeTabBtn = document.querySelector(".tab-btn.is-active");
      var sIdx = activeTabBtn ? parseInt(String(activeTabBtn.dataset.tab || "0"), 10) : 0;
      if (isNaN(sIdx) || sIdx < 0) sIdx = 0;

      var style = data[sIdx];
      if (!style || !Array.isArray(style.shots) || !style.shots.length) {
        return alert("当前脚本数据异常，无法复制。");
      }

      var md = "### " + (style.styleName || "AI 分镜脚本") + "\n\n";
      md += "| 镜头 | 画面描述 (Visual) | 镜头运动 (Motion) | 旁白/音效 (Audio) | 时长 (s) |\n";
      md += "| :--- | :--- | :--- | :--- | :--- |\n";

      style.shots.forEach(function (shot, i) {
        var visual = String(shot.visual || "")
          .replace(/\n/g, " ")
          .replace(/\|/g, "｜");
        var motion = String(shot.motion || "")
          .replace(/\n/g, " ")
          .replace(/\|/g, "｜");
        var audio = String(shot.audio || "")
          .replace(/\n/g, " ")
          .replace(/\|/g, "｜");
        var duration = shot.duration != null ? shot.duration : "-";

        md +=
          "| **" +
          (i + 1) +
          "** | " +
          visual +
          " | " +
          motion +
          " | " +
          audio +
          " | " +
          duration +
          "s |\n";
      });

      navigator.clipboard.writeText(md).then(function () {
        var originalText = btnCopyMarkdownFeishu.textContent;
        btnCopyMarkdownFeishu.textContent = "✅ 已复制到剪贴板！";
        setTimeout(function () {
          btnCopyMarkdownFeishu.textContent = originalText;
        }, 2000);
      }).catch(function (err) {
        alert("复制失败，请检查浏览器剪贴板权限：" + err);
      });
    });
  }
})();
