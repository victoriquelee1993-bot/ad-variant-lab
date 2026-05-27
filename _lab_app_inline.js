/**
 * Ad Variant Lab - Director's Creative Engine (V3.0 - 终极4A大厂上线级闭环版)
 * 100% 严密对齐平台、画布画幅、产品、卖点、定位五维变量。
 * 完全对齐 .cursorrules.js 工业标准：
 * 1. 矢量化运动 (Vectorized Motion)
 * 2. 智能光影系统 (Lighting Rig)
 * 3. 视觉 DNA 提取 (Visual DNA)
 * 4. 空间坐标锚点 (Space Anchors)
 * 5. 绝对数据绑定 (Atomic Data Binding)
 *
 * 说明：卖点简报 LLM（directorVisionTransformLLM、renderBriefFromParsed）在 index.html 的内联脚本中，不在本文件。
 *
 * TODO: 若未来接入 html2canvas 导出分镜板，需在此处理 <video> 标签截帧，防止导出黑屏。
 *       可调用 prepareVideosForDomCapture(root) / restoreVideosAfterDomCapture(state)。
 */
(function () {
  // 1. 强制协议检测：防止 file:// 协议导致的 CORS 跨域拦截
  if (location.protocol === "file:") {
    var errorMsg =
      "错误：检测到运行在 file:// 协议下。请使用 Live Server 插件打开此页面，否则 LLM API 无法访问。";
    console.error(errorMsg);
    alert(errorMsg);
    return;
  }

  // 2. 定义全局中断控制器：用于取消未完成的生成任务
  let currentStoryboardController = null;
  const safeSetLabBusy = window.setLabBusy || function () {};

  const btnCraftStoryboard = document.getElementById("btnCraftStoryboard");
  if (!btnCraftStoryboard) return;

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  var VISUAL_LOADING_HTML =
    "<span style='display:block; animation: pulse 1.5s infinite;'>AI Artist is rendering...</span>";

  const API_IMAGE_MAX_SIDE = 800;
  const API_IMAGE_JPEG_QUALITY = 0.7;

  /** 等比例缩放后转 JPEG Base64（无文件体积拦截，大图由 Canvas 缩至 API_IMAGE_MAX_SIDE） */
  function fileToCompressedBase64(file) {
    return new Promise(function (resolve, reject) {
      if (!file) {
        reject(new Error("无效文件"));
        return;
      }

      var blobUrl = URL.createObjectURL(file);
      var img = new Image();

      img.onload = function () {
        // 异步闭包：大图解码后让出主线程，再执行 Canvas 缩放，减轻卡顿
        setTimeout(function () {
          try {
            var maxSide = API_IMAGE_MAX_SIDE;
            var w = img.naturalWidth || img.width;
            var h = img.naturalHeight || img.height;
            if (!w || !h) {
              reject(new Error("无法读取图片尺寸"));
              return;
            }
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
            resolve(canvas.toDataURL("image/jpeg", API_IMAGE_JPEG_QUALITY));
          } catch (e) {
            reject(e);
          } finally {
            URL.revokeObjectURL(blobUrl);
          }
        }, 0);
      };

      img.onerror = function () {
        URL.revokeObjectURL(blobUrl);
        reject(new Error("图片加载失败"));
      };
      img.src = blobUrl;
    });
  }

  function isProductVideoFile(file) {
    if (!file) return false;
    if (file.type && /^video\//i.test(file.type)) return true;
    return /\.(mp4|mov|webm)$/i.test(file.name || "");
  }

  var SHOT_GRID_REF_RE = /\((?:参考|动态)素材格\s*#(\d+)\)/;
  var SHOT_DYNAMIC_GRID_RE = /\(\s*动态素材格\s*#\d+\s*\)/;

  /** 读取宫格 DOM 元数据：data-visual-class、data-visual-features、data-asset-type */
  function getGalleryCellMeta(idx0) {
    var items = document.querySelectorAll("#product-gallery .gallery-item");
    var el = items[idx0];
    if (!el) return null;
    var cls = (el.getAttribute("data-visual-class") || "").trim().toLowerCase();
    var feats = (el.getAttribute("data-visual-features") || el.getAttribute("data-visual-notes") || "").trim();
    var assetType = (el.getAttribute("data-asset-type") || "").trim().toLowerCase();
    if (!assetType && el.querySelector("video")) assetType = "video";
    return { className: cls, features: feats, type: assetType || "image" };
  }

  function parseShotGridRefFromVisual(visual) {
    var m = String(visual || "").match(SHOT_GRID_REF_RE);
    if (!m) return null;
    var index = parseInt(m[1], 10);
    if (isNaN(index) || index < 1) return null;
    return {
      index: index,
      isDynamic: SHOT_DYNAMIC_GRID_RE.test(String(visual || "")),
    };
  }

  function resolveShotGallerySlotIndex(shot) {
    if (!shot) return null;
    var fromVisual = parseShotGridRefFromVisual(shot.visual);
    if (fromVisual) return fromVisual.index;
    var sid = parseInt(shot.source_image_id, 10);
    if (!isNaN(sid) && sid >= 1) return sid;
    return null;
  }

  /** 当前镜头是否绑定动态视频素材格（禁止向 MJ 等静态生图生态传递视频 URL） */
  function shotUsesDynamicVideoAsset(shot) {
    if (!shot) return false;
    if (SHOT_DYNAMIC_GRID_RE.test(String(shot.visual || ""))) return true;
    var slot = resolveShotGallerySlotIndex(shot);
    if (slot == null) return false;
    var meta = getGalleryCellMeta(slot - 1);
    return !!(meta && meta.type === "video");
  }

  /** 剥离 MJ 提示词中的视频垫图 URL 与 --sref / --cref 参数 */
  function sanitizeMjPromptForVideoAsset(text) {
    var s = String(text || "");
    s = s.replace(/\b--sref(?:-\w+)?\s+\S+/gi, "");
    s = s.replace(/\b--cref(?:-\w+)?\s+\S+/gi, "");
    s = s.replace(/\b--sv\s+\S+/gi, "");
    s = s.replace(/\b--iw\s+\S+/gi, "");
    s = s.replace(/https?:\/\/\S+/gi, "");
    s = s.replace(/\bblob:\S+/gi, "");
    s = s.replace(/\S+\.(?:mp4|mov|webm|m4v)(?:\?\S*)?/gi, "");
    s = s.replace(/\s{2,}/g, " ").replace(/,\s*,/g, ",").trim();
    return s;
  }

  /**
   * html2canvas / DOM 截图前：将 <video> 当前帧替换为临时 <img>，避免导出黑屏。
   * @returns {Array} 还原句柄，传给 restoreVideosAfterDomCapture
   */
  function prepareVideosForDomCapture(root) {
    var scope = root && root.querySelectorAll ? root : document;
    var videos = scope.querySelectorAll ? scope.querySelectorAll("video") : [];
    var replacements = [];
    var vi;
    for (vi = 0; vi < videos.length; vi++) {
      var video = videos[vi];
      try {
        var vw = video.videoWidth;
        var vh = video.videoHeight;
        if (!vw || !vh) continue;
        var canvas = document.createElement("canvas");
        canvas.width = vw;
        canvas.height = vh;
        var ctx = canvas.getContext("2d");
        if (!ctx) continue;
        ctx.drawImage(video, 0, 0, vw, vh);
        var dataUrl = canvas.toDataURL("image/png");
        var placeholder = document.createElement("img");
        placeholder.src = dataUrl;
        placeholder.className = "lab-video-capture-placeholder";
        placeholder.setAttribute("data-lab-video-capture", "1");
        placeholder.style.cssText =
          video.style.cssText ||
          "width:100%;height:100%;object-fit:cover;display:block;";
        var parent = video.parentNode;
        if (!parent) continue;
        var prevDisplay = video.style.display;
        parent.insertBefore(placeholder, video);
        video.style.display = "none";
        replacements.push({ video: video, placeholder: placeholder, prevDisplay: prevDisplay });
      } catch (capErr) {
        console.warn("[Lab] video frame capture failed:", capErr);
      }
    }
    return replacements;
  }

  function restoreVideosAfterDomCapture(replacements) {
    if (!Array.isArray(replacements)) return;
    var ri;
    for (ri = 0; ri < replacements.length; ri++) {
      var r = replacements[ri];
      if (r.placeholder && r.placeholder.parentNode) {
        r.placeholder.parentNode.removeChild(r.placeholder);
      }
      if (r.video) {
        r.video.style.display = r.prevDisplay != null ? r.prevDisplay : "";
      }
    }
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
    options = options || {};
    if (!options.signal && currentStoryboardController) {
      options.signal = currentStoryboardController.signal;
    }
    return window.llmApiFetch(path, options);
  }

  function abortStoryboardGeneration() {
    if (currentStoryboardController) {
      currentStoryboardController.abort();
      currentStoryboardController = null;
    }
  }

  window.__abortStoryboardGeneration = abortStoryboardGeneration;

  var llmFetchFailAlertShown = false;

  function maybeAlertLlmFetchFailure(err, context) {
    if (llmFetchFailAlertShown || !shouldAlertApiFailure(err)) return;
    llmFetchFailAlertShown = true;
    alert(formatLlmFetchAlertMessage(err, context));
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

      const imageSlotsInBatch = [];

      for (let j = 0; j < batchFiles.length; j++) {
        const file = batchFiles[j];
        const globalIdx = i + j;
        if (isProductVideoFile(file)) {
          combinedImages[globalIdx] = { class: "INTERACTIVE", features: "动态视频素材" };
          continue;
        }
        imageSlotsInBatch.push({ j: j, globalIdx: globalIdx, file: file });
      }

      if (imageSlotsInBatch.length === 0) {
        continue;
      }

      const content = [
        {
          type: "text",
          text:
            '你是一位顶级商业广告摄影指导。请仔细观察这些产品图片（本批共 ' +
            imageSlotsInBatch.length +
            ' 张，请按顺序逐张输出 images 数组，长度必须等于 ' +
            imageSlotsInBatch.length +
            '）。1. 识别品牌/型号或具体物理特征（不限品类）。2. 为每张图标注通用景别标签 class（仅限四选一：ESTABLISHING / HERO_SHOT / DETAIL_MACRO / INTERACTIVE）。3. 在 features 中写材质、反光、景别与可见细节（可含 matte/磨砂 等英文材质词）。返回JSON：{"master_prompt": "用于DALL-E的顶级英文产品外观描述", "images": [{"class": "HERO_SHOT", "features": "高度具体的物理特征与景别描述"}]}',
        },
      ];

      for (let k = 0; k < imageSlotsInBatch.length; k++) {
        const b64 = await fileToCompressedBase64(imageSlotsInBatch[k].file);
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

        for (let k = 0; k < imageSlotsInBatch.length; k++) {
          const globalIdx = imageSlotsInBatch[k].globalIdx;
          const entry = batchImages[k];
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
        for (let k = 0; k < imageSlotsInBatch.length; k++) {
          const globalIdx = imageSlotsInBatch[k].globalIdx;
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
    if (currentStoryboardController) currentStoryboardController.abort();
    currentStoryboardController = new AbortController();

    btnCraftStoryboard.disabled = true;
    var originalBtnText = btnCraftStoryboard.textContent;
    btnCraftStoryboard.textContent = "推演中... (请勿重复点击)";

    try {
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
        positioning: (function () {
          var posEl = document.getElementById("positioning-select") || document.getElementById("positioning-input");
          var posVal = posEl ? String(posEl.value || "").trim() : "";
          return posVal || "高端/轻奢/大众消费";
        })(),
        brief: briefContent,
        mods: storyModsEl ? String(storyModsEl.value || "") : "",
        materialCount: getMaterialGridCount(),
        usage_scenarios: collectUsageScenarios(),
      };

      safeSetLabBusy(true);
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
      resetStoryEngineProgressState();
      window.__STORY_ENGINE_GENERATING__ = true;
      safeSetLabBusy(false);

      await generateThreeStyleStoryboards(params, apiKey, function (idx, styleObj) {
        renderSingleStylePanel(idx, styleObj);
      });

      finalizeProgressiveStoryboardDashboard();
      setStoryEngineProgress("✅ 三套分镜已全部就绪", 100);
      window.__STORY_ENGINE_GENERATING__ = false;
      setTimeout(function () {
        clearStoryEngineProgress(true);
      }, 2200);
    } catch (err) {
      console.error("分镜生成异常:", err);
      var errMsg = err && err.message ? String(err.message) : String(err || "");
      if (errMsg.indexOf("【已取消】") === -1) {
        alert(formatLlmFetchAlertMessage(err, "分镜引擎故障"));
      }
      window.__STORY_ENGINE_GENERATING__ = false;
      clearStoryEngineProgress(true);
    } finally {
      currentStoryboardController = null;
      safeSetLabBusy(false);
      btnCraftStoryboard.disabled = false;
      btnCraftStoryboard.textContent = originalBtnText;
    }
  });

  /** 分镜引擎实时进度（插入在 Craft Storyboard 按钮下方） */
  var storyEngineProgressPctFloor = 0;

  function resetStoryEngineProgressState() {
    storyEngineProgressPctFloor = 0;
  }

  function setStoryEngineProgress(text, pct, opts) {
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
    opts = opts || {};
    if (!opts.preserveLabel && text != null && String(text).trim()) {
      if (lab) lab.textContent = String(text);
    }
    if (typeof pct === "number" && !isNaN(pct)) {
      if (opts.monotonic) {
        storyEngineProgressPctFloor = Math.max(storyEngineProgressPctFloor, pct);
        pct = storyEngineProgressPctFloor;
      }
      if (bar) bar.style.width = Math.max(0, Math.min(100, pct)) + "%";
    } else if (pct == null && opts.monotonic && bar) {
      bar.style.width = Math.max(0, Math.min(100, storyEngineProgressPctFloor)) + "%";
    }
  }

  function clearStoryEngineProgress(force) {
    if (!force && window.__STORY_ENGINE_GENERATING__) return;
    var host = document.getElementById("lab-story-engine-progress");
    if (host) host.remove();
    if (force) resetStoryEngineProgressState();
  }

  /** 结构化提取 + JSON.parse；失败时使用括号补全兜底 */
  function extractAndParseStoryboardJson(raw) {
    var s = String(raw || "")
      .replace(/```json\s*|```/gi, "")
      .trim();
    // 核心优化：去除可能干扰 JSON 的嵌套转义引号
    s = s.replace(/\\"/g, "");

    var jsonMatch = s.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("AI 返回了非 JSON 格式内容");

    try {
      return JSON.parse(jsonMatch[0]);
    } catch (e) {
      return parseJsonWithClosingBraceRepair(jsonMatch[0]);
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
      if (isProductVideoFile(files[i])) continue;
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
      { id: "A", name: "Style A (核心属性揭秘 / Core Attribute)" },
      { id: "B", name: "Style B (场景与情绪共生 / Context & Emotion)" },
      { id: "C", name: "Style C (感官刺激与钩子 / Hook-Driven)" },
    ];

    /** 读取宫格 DOM 元数据（可选）：data-visual-class、data-visual-features — 见模块级 getGalleryCellMeta */

    var GRID_REF_RE = /\((?:参考|动态)素材格\s*#(\d+)\)/;

    var GRID_REF_REPLACE_G = /\((?:参考|动态)素材格\s*#\d+\)/g;

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

    function stripSystemTokensFromVisual(vis) {
      var s = String(vis || "");
      s = s.replace(GRID_REF_REPLACE_G, "");
      s = s.replace(/\((?:参考|动态)素材格\s*：\s*无\)/g, "");
      s = s.replace(/(?:参考|动态)素材格|素材格/g, "");
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

    /** Style C：普通单镜不得超过 2.5s；宫格/分屏/阵列镜豁免（可承载更长秒数） */
    function assertStyleCShotDurationLimit(shots, phase) {
      var maxSec = 2.5;
      var bad = [];
      var GRID_VISUAL_CAP_RE = /宫格|分屏|阵列/;
      var si;
      for (si = 0; si < shots.length; si++) {
        if (!shots[si]) continue;
        var vis = String(shots[si].visual || "");
        if (GRID_VISUAL_CAP_RE.test(vis)) continue;
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
          "）：普通单镜严禁超过 " +
          maxSec +
          "s，检测到：" +
          detail +
          "。请重写分镜，禁止用长镜头凑总时长。"
      );
    }

    /** 时长宽容区间：Sum∈[lo,hi] 不缩放；偏短缩至 targetIdeal=lo+(hi-lo)*0.4；偏长压至 hi；写回 duration 并剔除 duration_weight */
    function clampShotDurationsToWindow(shots, targetMin, targetMax, styleOpts, productName) {
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

      // 🛑 核心修正：注释或删掉校准前的 assertStyleCShotDurationLimit 断言！
      // 允许 AI 原始输出秒数溢出，交由下方的弹性缩放和强行取整算法进行平滑重塑。
      // if (styleC) assertStyleCShotDurationLimit(shots, "校准前");

      var GRID_VISUAL_CAP_RE = /宫格|分屏|阵列/;

      if (styleC) {
        var styleCMaxTotal = roundDurD(shots.length * STYLE_C_SHOT_CAP_SEC);
        var minShotsNeeded = Math.ceil(lo / STYLE_C_SHOT_CAP_SEC);
        if (styleCMaxTotal < lo - 0.02) {
          console.warn(
            "剧情信息量不足以支撑目标时长，已自动扩展至最高承载剧情段落（Style C：当前 " +
              shots.length +
              " 镜 × " +
              STYLE_C_SHOT_CAP_SEC +
              "s = " +
              styleCMaxTotal +
              "s < 目标下限 " +
              lo +
              "s，建议至少 " +
              minShotsNeeded +
              " 镜；系统将尝试在末尾补足终章镜头）。"
          );
        }
      }

      function shotMaxDurationCap(shot) {
        var vis = String(shot && shot.visual != null ? shot.visual : "");
        // 宫格/分屏/阵列镜头统一允许较长秒数（Style C 也必须豁免，吸收总时长）
        if (GRID_VISUAL_CAP_RE.test(vis)) return hi * 0.5;
        // 普通快剪镜头死卡 2.5s
        if (styleC) return 2.5;
        return 8;
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

      /**
       * 工业级重构：整数时长最终形态（彻底杜绝无意义的补帧与机械横跳）
       */
      function enforceIntegerDuration() {
        var INT_MIN_SHOT = 1;
        var si;
        var intLo = Math.ceil(lo);
        var intHi = Math.floor(hi);
        if (intHi < intLo) {
          var swapInt = intLo;
          intLo = intHi;
          intHi = swapInt;
        }

        function sumIntegerTotal() {
          var s = 0;
          for (si = 0; si < shots.length; si++) {
            s += parseInt(shots[si].duration, 10) || 0;
          }
          return s;
        }

        // 1. 首次取整
        for (si = 0; si < shots.length; si++) {
          if (!shots[si]) continue;
          var rd = Math.round(parseFloat(shots[si].duration) || 0);
          var capSi = Math.floor(shotMaxDurationCap(shots[si]));
          shots[si].duration = Number(Math.max(INT_MIN_SHOT, Math.min(capSi, rd)));
        }

        var total = sumIntegerTotal();

        // 2. 总长超过上限：从最长镜头优先平滑减扣
        var trimPasses = 0;
        while (total > intHi && trimPasses < shots.length * 10) {
          trimPasses++;
          var trimIdx = -1;
          var trimDur = -1;
          for (si = 0; si < shots.length; si++) {
            var td = parseInt(shots[si].duration, 10) || 0;
            if (td <= INT_MIN_SHOT) continue;
            if (td > trimDur) {
              trimDur = td;
              trimIdx = si;
            }
          }
          if (trimIdx < 0) break;
          shots[trimIdx].duration = Number(shots[trimIdx].duration) - 1;
          total = sumIntegerTotal();
        }

        // 3. 总长不足下限时，坚决拒绝无脑追加定格镜头；按叙事权重阶梯伸缩
        var expandPasses = 0;
        while (total < intLo && expandPasses < shots.length * 10) {
          expandPasses++;
          var expIdx = -1;
          var maxHeadroom = -1;

          for (si = 0; si < shots.length; si++) {
            var curD = parseInt(shots[si].duration, 10) || 0;
            var capD = Math.floor(shotMaxDurationCap(shots[si]));
            var headroom = capD - curD;

            var visText = String(shots[si].visual || "").toLowerCase();
            var isComplexMotion = /orbit|dolly|focus|traverse|绕拍|推拉|拉焦/i.test(visText);
            if (isComplexMotion) headroom += 2;

            if (headroom > maxHeadroom && curD < capD) {
              maxHeadroom = headroom;
              expIdx = si;
            }
          }

          if (expIdx < 0) {
            if (shots.length) {
              var lastIdx = shots.length - 1;
              var curLastD = parseInt(shots[lastIdx].duration, 10) || 0;
              var lastCap = Math.floor(shotMaxDurationCap(shots[lastIdx]));
              if (curLastD >= lastCap) {
                if (styleC) {
                  console.warn("Style C 补短红线硬性放行保护。");
                }
                break;
              }
              shots[lastIdx].duration = Number(curLastD + 1);
              total++;
            } else {
              break;
            }
          } else {
            shots[expIdx].duration = Number(shots[expIdx].duration) + 1;
            total = sumIntegerTotal();
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
          for (i = 0; i < shots.length; i++) {
            if (GRID_VISUAL_CAP_RE.test(String(shots[i].visual || ""))) continue;
            shots[i].duration = STYLE_C_SHOT_CAP_SEC;
          }
        } else {
          var mid0 = roundDurD((lo + hi) / 2);
          var per0 = Math.max(0.25, roundDurD(mid0 / shots.length));
          for (i = 0; i < shots.length; i++) shots[i].duration = per0;
        }
        stripWeights();
        if (styleC) assertStyleCShotDurationLimit(shots, "校准后");
        enforceIntegerDuration();
        return;
      }

      if (rawSum >= lo && rawSum <= hi) {
        stripWeights();
        if (styleC) assertStyleCShotDurationLimit(shots, "校准后");
        enforceIntegerDuration();
        return;
      }

      var scale = 1;
      var targetIdeal = roundDurD(lo + (hi - lo) * 0.4);
      var goal = rawSum;
      if (rawSum < lo) {
        goal = targetIdeal; // 不贴底线，缩放至区间 40% 处
        scale = goal / rawSum;
      } else if (rawSum > hi) {
        goal = hi;
        scale = goal / rawSum;
      }

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
        var maxPasses = 10;
        var passes = 0;
        var lastDrift = drift;

        while (Math.abs(drift) >= 0.005 && passes < maxPasses) {
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
          if (lastDrift === drift) break;
          lastDrift = drift;
          passes++;
        }
      }

      if (styleC) assertStyleCShotDurationLimit(shots, "校准后");

      var totFinal = 0;
      for (i = 0; i < shots.length; i++) totFinal += parseFloat(shots[i].duration) || 0;
      totFinal = roundDurD(totFinal);
      if (styleC && totFinal < lo - 0.02) {
        var capSum = roundDurD(shots.length * STYLE_C_SHOT_CAP_SEC);
        if (capSum >= lo - 0.02) {
          for (i = 0; i < shots.length; i++) {
            if (GRID_VISUAL_CAP_RE.test(String(shots[i].visual || ""))) continue;
            shots[i].duration = STYLE_C_SHOT_CAP_SEC;
          }
          totFinal = 0;
          for (i = 0; i < shots.length; i++) totFinal += parseFloat(shots[i].duration) || 0;
          totFinal = roundDurD(totFinal);
          if (totFinal > hi + 0.02) {
            var sc = hi / totFinal;
            totFinal = 0;
            for (i = 0; i < shots.length; i++) {
              shots[i].duration = roundDurD(
                Math.min(shotMaxDurationCap(shots[i]), (parseFloat(shots[i].duration) || 0) * sc)
              );
              totFinal += shots[i].duration;
            }
            totFinal = roundDurD(totFinal);
          }
        }
        if (totFinal < lo - 0.02) {
          console.warn(
            "剧情信息量不足以支撑目标时长，已自动扩展至最高承载剧情段落（Style C 校准后总长 " +
              totFinal +
              "s < 目标下限 " +
              lo +
              "s，将在整数校准阶段补足终章镜头）。"
          );
        }
        if (styleC) assertStyleCShotDurationLimit(shots, "校准后");
      }

      enforceIntegerDuration();
      stripWeights();
      if (styleC) assertStyleCShotDurationLimit(shots, "整数校准后");
    }

    /**
     * 与 data-visual-class / features 冲突时：就地改写 visual，不中断生成。
     * 通用景别纠偏：universalAssetCorrection 处理「特写文案配全景图」类指鹿为马。
     * 支持解耦结构：优先用 source_image_id 绑定宫格，visual 可为无 # 的纯中文。
     */
    function applyStoryboardVisualRewrites(styleObj, p) {
      var shots = styleObj.shots;
      if (!Array.isArray(shots)) return;
      var galleryCount = document.querySelectorAll("#product-gallery .gallery-item").length;

      for (var i = 0; i < shots.length; i++) {
        if (!shots[i]) continue;
        var vis = stripSystemTokensFromVisual(String(shots[i].visual || ""));
        vis = vis.replace(GRID_REF_REPLACE_G, function () {
          return "";
        });
        vis = vis.replace(/(?:参考|动态)素材格[^)]*\)/g, "");
        vis = collapseSpaces(vis);

        var k = parseInt(shots[i].source_image_id, 10);
        if (isNaN(k) || k < 1) k = 1;
        if (galleryCount && k > galleryCount) k = galleryCount;
        if (!galleryCount) k = 1;

        var meta = galleryCount > 0 ? getGalleryCellMeta(k - 1) : null;

        if (meta) universalAssetCorrection(shots[i], meta);

        // 同步提取更新后的视觉文本，防止上一步的修改被覆盖
        vis = String(shots[i].visual || "");

        // 只做空格清理
        vis = collapseSpaces(vis);

        var tagPrefix = meta && meta.type === "video" ? "动态素材格" : "参考素材格";

        if (!new RegExp("\\(" + tagPrefix).test(vis)) {
          vis =
            (vis ? vis + " " : "") +
            (galleryCount ? "(" + tagPrefix + " #" + k + ")" : "(" + tagPrefix + "：无)");
        }

        if (vis.replace(GRID_REF_REPLACE_G, "").trim().length < 8) {
          vis =
            "镜头平稳聚焦当前核心画面要素，呈现极致高级的视觉张力。(" +
            tagPrefix +
            " #" +
            k +
            ")";
        }

        shots[i].visual = vis;
        if (shots[i].audio != null) {
          shots[i].audio = collapseSpaces(String(shots[i].audio || ""));
        }
      }
    }

    /** 非解耦轨道路径：与解耦共用宽容区间时长校准 */
    function autoAdjustDuration(styleObj, targetMin, targetMax, styleCfg, p) {
      void p;
      if (!styleObj || !Array.isArray(styleObj.shots) || !styleObj.shots.length) return;
      var prod =
        p && p.product != null
          ? String(p.product)
          : (document.getElementById("product-input")
              ? String(document.getElementById("product-input").value || "")
              : "");
      clampShotDurationsToWindow(styleObj.shots, targetMin, targetMax, styleCfg, prod);
    }

    /** 兜底：打断连续三镜同一素材格编号（满足防惰性管线约束） */
    function breakTripleConsecutiveGridRefs(styleObj, styleCfg) {
      void styleCfg;
      var shots = styleObj.shots;
      if (!Array.isArray(shots) || shots.length < 3) return;
      var gc = document.querySelectorAll("#product-gallery .gallery-item").length;
      // 如果上传的参考图小于等于 3 张，直接放行，不强制打断连续引用
      if (gc <= 3) return;

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
        shots[i].visual = String(shots[i].visual || "").replace(GRID_REF_RE, function (match, p1) {
          return match.replace("#" + p1, "#" + alt);
        });
      }
    }

    /**
     * 逻辑冲突自检（非阻塞）：强制对比相邻镜头空间状态。
     * @param {Array|Object} shotsOrStyle — shots 数组，或含 .shots 的 styleObj
     */
    function validateContinuity(shotsOrStyle, styleCfg) {
      var shots;
      var styleLabel = "";
      if (Array.isArray(shotsOrStyle)) {
        shots = shotsOrStyle;
        styleLabel =
          (styleCfg && (styleCfg.styleName || styleCfg.name)) ? String(styleCfg.styleName || styleCfg.name) : "";
      } else {
        shots = shotsOrStyle && shotsOrStyle.shots;
        styleLabel = (shotsOrStyle && shotsOrStyle.styleName) || (styleCfg && (styleCfg.styleName || styleCfg.name)) || "";
      }
      if (!Array.isArray(shots) || shots.length < 2) return;

      var TRANSITION_RE =
        /转场|过渡|匹配剪辑|match\s*cut|跳切|切至|切换|硬切|蒙太奇|叠化|淡入|淡出|dissolve|cross\s*fade|剪辑点|承接|衔接|主观镜头|pov|反应镜头|时间压缩|跳接/i;
      var MACRO_RE = /特写|微距|大特写|macro|close[- ]?up|detail/i;
      var WIDE_RE = /全景|远景|大全景|establishing|wide|full[- ]?shot/i;
      var CONFLICT_RE = /无法承接|不连贯|毫无承接|空间跳跃|无故瞬移|逻辑断裂/i;
      var RISK_TAG = "需检查：跳轴风险";

      function hasTransition(text) {
        return TRANSITION_RE.test(String(text || ""));
      }

      function scaleOf(text) {
        var t = String(text || "");
        if (MACRO_RE.test(t)) return "macro";
        if (WIDE_RE.test(t)) return "wide";
        return "neutral";
      }

      function hasAxisRisk(endText, startText) {
        var e = String(endText || "");
        var s = String(startText || "");
        var eLeft = /(左侧|画面左|向左|左方|viewer\s*left)/i.test(e);
        var eRight = /(右侧|画面右|向右|右方|viewer\s*right)/i.test(e);
        var sLeft = /(左侧|画面左|向左|左方|viewer\s*left)/i.test(s);
        var sRight = /(右侧|画面右|向右|右方|viewer\s*right)/i.test(s);
        return (eLeft && sRight && !sLeft) || (eRight && sLeft && !sRight);
      }

      function appendVisualTransitionHint(shot, hint) {
        var vis = String(shot.visual || "").trim();
        if (vis.indexOf("【转场过渡】") !== -1) return;
        shot.visual = vis ? vis + " 【转场过渡】" + (hint || "匹配剪辑转场") : "【转场过渡】" + (hint || "匹配剪辑转场");
      }

      function markContinuityRisk(shot, detail) {
        var cc = String(shot.continuity_check || "").trim();
        if (cc.indexOf("跳轴风险") !== -1 || cc.indexOf(RISK_TAG) !== -1) return;
        shot.continuity_check = cc
          ? "⚠️ 风险：" + RISK_TAG + (detail ? "（" + detail + "）" : "") + " " + cc
          : "⚠️ 风险：" + RISK_TAG + (detail ? "（" + detail + "）" : "");
      }

      var WEAR_ON_RE = /(戴上|佩戴|穿上)/;
      var WEAR_OFF_RE = /(摘下|取下|脱下)/;
      var INTERNAL_EXPOSE_RE = /(后盖|透底|内衬|机芯|内部)/;
      var PHYSICAL_BREAK_MSG = "物理穿帮（产品已佩戴，无法展示背部或内部特征，请修改动线）";

      function markPhysicalWearBreak(shot) {
        var cc = String(shot.continuity_check || "").trim();
        if (cc.indexOf("物理穿帮") !== -1) return;
        shot.continuity_check = cc
          ? "⚠️ 风险：" + PHYSICAL_BREAK_MSG + "。" + cc
          : "⚠️ 风险：" + PHYSICAL_BREAK_MSG + "。";
      }

      function advanceWearState(text, worn) {
        var t = String(text || "");
        if (WEAR_OFF_RE.test(t)) return false;
        if (WEAR_ON_RE.test(t)) return true;
        return worn;
      }

      var productWorn = false;
      var i;
      for (i = 0; i < shots.length; i++) {
        var shot = shots[i];
        if (!shot) continue;

        if (i > 0) {
          var prev = shots[i - 1];
          var cur = shot;
          if (!prev || !cur) continue;

          if (productWorn) {
            var curVisWear = String(cur.visual || "");
            var startMWear = String(cur.start_motion || cur.motion || "");
            var currentShotHasTakeOffAction =
              WEAR_OFF_RE.test(curVisWear) || WEAR_OFF_RE.test(startMWear);
            // 豁免：如果本镜头同时伴随“摘下/脱下”的动作，则允许展示内部/后盖
            if (
              !currentShotHasTakeOffAction &&
              (INTERNAL_EXPOSE_RE.test(curVisWear) || INTERNAL_EXPOSE_RE.test(startMWear))
            ) {
              markPhysicalWearBreak(cur);
            }
          }

        var prevVis = String(prev.visual || "");
        var curVis = String(cur.visual || "");
        var endM = String(prev.end_motion || prev.motion || "");
        var startM = String(cur.start_motion || cur.motion || "");
        var contCheck = String(cur.continuity_check || "");
        var ctx = endM + " " + startM + " " + contCheck + " " + curVis;

        var prevScale = scaleOf(endM);
        var curScale = scaleOf(startM);
        var visualMacroToWide =
          (prevVis.indexOf("特写") !== -1 && curVis.indexOf("全景") !== -1) ||
          (prevScale === "macro" && curScale === "wide");

        if (visualMacroToWide && !hasTransition(ctx)) {
          markContinuityRisk(cur, "特写接全景或 end_motion→start_motion 景别割裂");
          appendVisualTransitionHint(cur, "通过推拉镜头过渡");
          contCheck = String(cur.continuity_check || "");
          ctx = endM + " " + startM + " " + contCheck + " " + String(cur.visual || "");
        }

        var scaleConflict =
          (prevScale === "macro" && curScale === "wide") || (prevScale === "wide" && curScale === "macro");
        var transPresent = hasTransition(ctx);
        var axisRisk = hasAxisRisk(endM, startM);

        if (scaleConflict && !transPresent) {
          appendVisualTransitionHint(cur, "通过匹配剪辑转场");
          transPresent = hasTransition(
            endM + " " + startM + " " + contCheck + " " + String(cur.visual || "")
          );
        }

        var unfixable = false;
        var detail = "";

        if (axisRisk && !transPresent) {
          unfixable = true;
          detail = "左右空间朝向冲突且缺乏过渡说明";
        } else if (scaleConflict && !transPresent) {
          unfixable = true;
          detail = "景别跨度大（如特写接全景）且缺乏过渡词";
        } else if (CONFLICT_RE.test(contCheck) && !hasTransition(contCheck)) {
          unfixable = true;
          detail = "continuity_check 自述不连贯且无剪辑解释";
        }

        if (unfixable) {
          console.warn(
            "[validateContinuity] " +
              (styleLabel || "分镜") +
              " 第 " +
              (i + 1) +
              " 镜衔接风险（前一镜 end_motion → 本镜 start_motion）：",
            { prevIndex: i, shotIndex: i + 1, end_motion: endM, start_motion: startM, continuity_check: contCheck }
          );
          markContinuityRisk(cur, detail);
        }
        }

        var wearChunk =
          String(shot.visual || "") + " " + String(shot.end_motion || shot.motion || "");
        productWorn = advanceWearState(wearChunk, productWorn);
      }
    }

    /** 视觉闭环审计（非阻塞）：冲突已由 applyStoryboardVisualRewrites 就地消歧，此处保留扩展钩子 */
    function validateStoryboardGridVisualClosure(styleObj, styleCfg) {
      void styleObj;
      void styleCfg;
    }

    /** 与 initDashboardSkeleton 共享的三槽位全局缓存，供分批/分幕实时上屏 */
    var liveResults = window.__LAST_STORYBOARD_DATA__;
    if (!Array.isArray(liveResults)) {
      liveResults = [null, null, null];
    } else {
      liveResults = liveResults.slice();
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

      // ================= 🎯 核心重构：前端五维参数咬合模型（平台/画幅/类目/产品/定位） =================
      var platformStr = String(p.platform || "通用平台");
      var ratioStr = String(p.ratio || "16:9");
      var productLabelForStyle = String(p.product != null ? p.product : "未填写说明");
      var categoryLabelForStyle = p.category && String(p.category).trim() ? String(p.category).trim() : "通用类目";
      var positionElForInput = document.getElementById("positioning-select") || document.getElementById("positioning-input");
      var positioningStr =
        p.positioning && String(p.positioning).trim()
          ? String(p.positioning).trim()
          : positionElForInput && String(positionElForInput.value || "").trim()
            ? String(positionElForInput.value).trim()
            : "高端/轻奢/大众消费";
      var isShortVideoPool = /TikTok|Reels|Shorts|小红书|Instagram/i.test(platformStr);
      var isEcomListing = /Amazon|Listing|PDP|AliExpress|Temu|Shopify/i.test(platformStr);

      var isStyleA = styleCfg.id === "A" || styleIndex === 0;
      var isStyleB = styleCfg.id === "B" || styleIndex === 1;
      var isStyleC = isStyleCFastCut(styleCfg);

      var STYLE_A_DUR_MIN = 3.5;
      var STYLE_A_DUR_MAX = 6.0;
      var STYLE_B_DUR_MIN = 2.0;
      var STYLE_B_DUR_MAX = 4.0;
      var STYLE_C_DUR_MIN = 0.5;
      var STYLE_C_DUR_MAX = 1.5;
      var STYLE_C_SHOT_SEC = 1.0;

      var avgShotLen = 3.0;
      if (isStyleC) {
        avgShotLen = (STYLE_C_DUR_MIN + STYLE_C_DUR_MAX) / 2;
      } else if (isStyleA) {
        avgShotLen = (STYLE_A_DUR_MIN + STYLE_A_DUR_MAX) / 2;
      } else {
        avgShotLen = (STYLE_B_DUR_MIN + STYLE_B_DUR_MAX) / 2;
      }

      var dynamicTargetDur = targetMin + (targetMax - targetMin) * (isStyleC ? 0.9 : isStyleA ? 0.5 : 0.6);
      var targetNodes = Math.ceil(dynamicTargetDur / avgShotLen);
      var minNodes = Math.max(4, targetNodes - 2);
      var maxNodes = Math.min(20, targetNodes + 3);
      if (isStyleC) {
        minNodes = Math.max(18, Math.ceil(targetMin / STYLE_C_DUR_MAX));
        targetNodes = Math.max(24, Math.ceil(targetMax / avgShotLen));
        maxNodes = Math.min(55, Math.ceil(targetMax / STYLE_C_DUR_MIN));
      } else if (isStyleA) {
        minNodes = Math.max(3, Math.ceil(targetMin / STYLE_A_DUR_MAX));
        targetNodes = Math.max(3, Math.round(dynamicTargetDur / avgShotLen));
        maxNodes = Math.min(12, Math.floor(targetMax / STYLE_A_DUR_MIN));
        if (targetMax <= 20) {
          targetNodes = Math.min(targetNodes, 4);
          maxNodes = Math.min(maxNodes, 4);
        }
      } else if (isStyleB) {
        minNodes = Math.max(4, Math.ceil(targetMin / STYLE_B_DUR_MAX));
        targetNodes = Math.max(targetNodes, Math.ceil(dynamicTargetDur / avgShotLen));
        maxNodes = Math.min(22, Math.floor(targetMax / STYLE_B_DUR_MIN));
      }

      setStoryEngineProgress(
        styleCfg.name + " 正在生成，当前时长匹配目标镜头数: " + targetNodes + " 镜...",
        8 + (typeof styleIndex === "number" ? styleIndex : 0) * 28
      );

      // 1. 平台常规展现逻辑（从第二镜起生效；第一镜服从本套 Style 的【第一镜 · 正面强制动作】）
      var platformHookRule = "";
      if (isShortVideoPool) {
        platformHookRule =
          "【平台常规 · 短视频流钩子（第二镜起）】：当前投放平台为【" +
          platformStr +
          "】。前 3 秒须强制吸睛，但吸睛手段【必须】严格执行本套 Style 的【第一镜 · 正面强制动作】；禁止用「产品全貌说明书」或 Hero Shot 偷懒顶替第一镜。从第二镜起可叠加极具侵略性的特写动态、ASMR 交互、材质流光或 UI 高能变幻。";
      } else if (isEcomListing) {
        platformHookRule =
          "【平台常规 · 电商货架看货（第二镜起）】：当前投放平台为【" +
          platformStr +
          "】。消费者核心心理是看货——全片须在第二镜及之后安排【清晰正面展示产品主体全貌或核心功能界面 Hero Shot】的时刻；但【绝不可】用该机制改写本套 Style 规定的第一镜起手，第一镜禁止产品全貌说明书式开场！";
      } else {
        platformHookRule =
          "【平台常规 · 横屏 TVC/大银幕（第二镜起）】：当前投放平台为【" +
          platformStr +
          "】。从第二镜起可使用高级广角大景别或情绪氛围调度；第一镜仍须 100% 服从本套 Style 的【第一镜 · 正面强制动作】，注重电影感质感与视听呼吸感。";
      }

      // 2. 🛑 画幅构图约束（将用户选择的 Ratio 强力注入镜头描述，防止出图画幅拉伸崩塌）
      var aspectCompositionRule =
        "【画布大小构图死命令】：当前画布大小为【" +
        ratioStr +
        "】。你在描述视觉元素陈设时，必须完全对齐该画布的物理重心：\n" +
        "- 若为 9:16 / 4:5（竖屏），视觉元素必须纵向居中堆叠分布，多用 Pedestal（垂直升降）运镜，注意画面上下留白；\n" +
        "- 若为 16:9 / 21:9（横屏），多用 Truck（横向平移）或 Arc Orbit（圆弧绕拍），全面展开横向的空间张力。";

      // 3. 🛑 三套完全平等、皆可独立上线、全行业通用的 4A 级平行创意大纲
      var dynamicCreativeAngle =
        "【核心投放平台】：🚨 " +
        platformStr +
        " 🚨\n" +
        "【当前画布大小】：📐 " +
        ratioStr +
        " 📐\n" +
        "【产品定位约束】：💎 当前产品定位为【" +
        positioningStr +
        "】。你必须让全片的场景奢华度、画面色调、演员调性、灯光高级感完全匹配该定位！如果是高奢，用无菌克制的高级打光与冷色调；如果是大众消费，注重亲和力与高饱满色彩。\n" +
        "【行业类目约束】：📦 本片服务于【" +
        categoryLabelForStyle +
        "】行业的【" +
        productLabelForStyle +
        "】。须结合下方「实体类别推断」结果提取本品类视觉隐喻，严禁生搬其它行业套路。\n\n" +
        platformHookRule +
        "\n" +
        aspectCompositionRule +
        "\n\n";

      var adaptiveEntityMappingBlock =
        "【前置死命令：跨品类自适应转换器 · Adaptive Entity Mapping】\n" +
        "在生成分镜前，你必须首先根据用户输入的产品名、类目、简报与卖点，判断其属于以下哪一类实体，并严格按照该类别的视觉隐喻执行本套风格（写入 director_treatment 首句须明示类别）：\n" +
        "1. [硬实体]（如 3C 数码、家电、汽车）：强调工业材质、精密结构、物理反馈。\n" +
        "2. [软实体/日化]（如美妆、食品、服饰）：强调流体/粉末质感、肌肤触感、色彩张力。\n" +
        "3. [虚拟/软件]（如 App、游戏、SaaS）：强调 UI 界面空间化（悬浮玻璃拟态）、代码数据流、指尖交互特效。\n" +
        "4. [无形服务/平价物]（如保险、物流、日用百货）：将概念具象化（排版、几何图形隐喻安全/效率），或对平价物进行极其夸张的质感升格。\n\n";

      var stylePhysicalIsolationBlock =
        "【绝对物理隔离 · 本套 Style 视听防火墙】\n" +
        "你当前仅允许执行本套 Style 的物理法则，与另外两套风格【零交叉、零借用】：\n" +
        (isStyleA
          ? "- 【隔离禁令】严禁 Whip Pan、Match Cut、快切、微电影式人物剧情线、生活场景叙事、ASMR 暴力砸击、0.5s–1.5s 碎镜；你的世界是「极慢 + 隐喻空镜 + 极微距产品切片」。\n"
          : isStyleB
            ? "- 【隔离禁令】严禁 Style A 式全程微观悬念堆叠（禁止全片只有肌理无人物）；严禁 Style C 式 0.5s 碎镜轰炸、Whip Pan 残影、无剧情物理砸击；你的世界是「固定主角 + 动作延续 + 2–4s 呼吸镜」。\n"
            : "- 【隔离禁令】严禁 Style A 式 3.5s+ 慢镜拉焦悬念、严禁 Style B 式舒缓人物起幅与长呼吸叙事；严禁把产品安安静静摆着拍；你的世界是「0.5–1.5s 感官碎片快剪 + 生理反应 + 极速残影」。\n");

      var minMetaphorBrollShots = Math.max(1, Math.ceil(targetNodes * 0.4));
      var maxDirectProductShots = Math.max(1, targetNodes - minMetaphorBrollShots);

      var antiProductOnlyMandateBlock = "";
      if (isStyleA || isStyleC) {
        antiProductOnlyMandateBlock =
          "【反产品说明书死命令 · Anti-Product-Only Mandate】\n" +
          "真正的商业大片绝不是 100% 的时间都在展示产品本体！若全片沦为「纯产品堆砌 / 说明书式摆拍」，视为严重创意事故，Client 会直接拒稿！\n" +
          "【全局死命令：强插空镜与隐喻】本套 Style " +
          (isStyleA ? "A" : "C") +
          " 中，【至少 " +
          minMetaphorBrollShots +
          " 镜（≥全片 40%）】必须是「非产品本体」画面：高级视觉隐喻 B-roll、自然奇观空镜、环境/情绪/生理反应碎片！直接展示产品本体的镜头【不得超过 " +
          maxDirectProductShots +
          " 镜】。\n" +
          "在 `director_treatment` 中须明示：① 本套核心视觉隐喻词典（至少 3 组，与卖点一一对应）；② 逐镜标注 `[隐喻空镜]` 或 `[产品触发镜]`。\n\n";
      }

      var adaptiveStyleRuleBlock = "";
      if (isStyleA) {
        adaptiveStyleRuleBlock =
          "【本套执行 · Style A (Precision - 高冷悬念与视觉隐喻)】\n" +
          stylePhysicalIsolationBlock +
          antiProductOnlyMandateBlock +
          "【第一镜 · 正面强制动作】第一镜【必须且只能】是【非产品本体】的高级视觉隐喻或自然奇观空镜（如墨滴炸开、日全食光晕、冰川纹理），严禁产品全貌/全名及 `(参考素材格 #X)`。\n" +
          "核心精神：剥离环境、极致放大、冷峻科研感——但【绝不是】围着产品绕圈的说明书！\n" +
          "【破局指令 · 反产品说明书】严禁整支片子只围着产品绕圈！必须使用【高级视觉隐喻】表达每一个卖点；产品只是隐喻体系中的「最后一枚拼图」。\n" +
          "【镜头强制要求 · 隐喻空镜】至少 " +
          minMetaphorBrollShots +
          " 镜必须是与卖点绑定的隐喻 B-roll / 自然奇观：\n" +
          "  - 卖点偏速度/性能 → 穿插光爆、流体金属、深海漩涡、疾风掠沙等微距空镜；\n" +
          "  - 卖点偏材质/工艺 → 穿插丝绸剥落、冰川开裂、沙丘纹理、矿晶断面等自然奇观；\n" +
          "  - 卖点偏色彩/设计 → 穿插墨滴扩散、极光色带、日全食光晕、棱镜折射等抽象空镜；\n" +
          "  - 虚拟/软件 → 穿插数据洪流、玻璃拟态碎裂、代码雨、拓扑网格等界面隐喻空镜。\n" +
          "【文本示范 · 必须达到此颗粒度】：\n" +
          "  「镜头1：一滴黑色墨水在纯白虚空中极速炸开，边缘拉出丝状尾迹（隐喻色彩张力）；\n" +
          "   镜头2：极慢 Rack Focus，焦点从虚化的产品边缘冷光滑至金属倒角肌理（产品仅局部切片）；\n" +
          "   镜头3：巨大日全食光晕在画面中央缓慢呼吸（隐喻设计哲学）；\n" +
          "   末镜：产品 Hero 轮廓在冷峻 Rim Light 下首次完整定格。」\n" +
          "【镜头节奏死命令】极静、极慢！每一镜 `duration` 必须在 " +
          STYLE_A_DUR_MIN +
          "–" +
          STYLE_A_DUR_MAX +
          " 秒之间。本套目标总长 " +
          targetMin +
          "–" +
          targetMax +
          "s，系统分配【" +
          minNodes +
          "–" +
          maxNodes +
          " 镜（精准 " +
          targetNodes +
          " 镜）】；若总长约 15s，全篇最多 3–4 镜，其中至少 " +
          minMetaphorBrollShots +
          " 镜必须是隐喻空镜！\n" +
          "【悬念锁死命令】：本风格的灵魂是「藏」！在脚本的前 30% 进度中，【绝对禁止】展示产品的全貌！只能通过极端的微距（Macro）、抽象的局部轮廓、在黑暗中被边缘光（Rim Light）勾勒出的剪影来呈现。产品全景必须作为视觉高潮，保留到后半段才能释出。\n" +
          "【拒绝微距死循环】：严禁连续 3 个镜头都在产品表面进行微距平移！必须严格遵循「产品局部微观 ⇄ 自然/工业隐喻空镜」的交替法则。\n" +
          "【视觉死命令】运镜【只能】Slow Dolly In、Rack Focus 或 Slow Pull Back；隐喻空镜与产品切片严格交替，每镜换一个视角，禁止连续两镜拍同一产品部位。\n" +
          "【光影剥离法则】高对比 Rim Light / Scan Light 剥离形体——暗调中只留轮廓与材质高光，客观克制，用光影「藏」与「露」控制悬念节奏。\n";
      } else if (isStyleB) {
        adaptiveStyleRuleBlock =
          "【本套执行 · Style B (Human/Lifestyle - 微电影级连贯叙事)】\n" +
          stylePhysicalIsolationBlock +
          "【第一镜 · 正面强制动作】第一镜【必须且只能】聚焦于主角出场或环境氛围建立（如主角的特写动作、场景的空间感）。禁止在第一镜硬塞产品展示。产品必须作为剧情道具在后续自然介入。\n" +
          "核心精神：人物情绪弧线、固定主场景内的【真实生活/商务动线】、连续可承接的物理动作——绝不是围着产品转圈的产品说明书！\n" +
          "【镜头节奏死命令】影视级叙事节奏，每一镜 `duration` 必须在 " +
          STYLE_B_DUR_MIN +
          "–" +
          STYLE_B_DUR_MAX +
          " 秒之间，配合主角表演呼吸感。本套须精准产出 " +
          targetNodes +
          " 镜（允许区间 " +
          minNodes +
          "–" +
          maxNodes +
          " 镜）。\n" +
          "【动作连贯死命令】必须在 director_treatment 中写明 1 名【固定主角】+ 1 个【固定主场景】+ 一条清晰的【动线时间轴】（起势互动 → 状态转化 → 动线延展收束）。前后镜头必须是同一套动作的顺滑延续（例：镜1案前沉思把玩 → 镜2佩戴整装 → 镜3走向落地窗 → 镜4抬腕看表时的自信情绪），禁止生硬跳切 unrelated 画面。\n" +
          "  - 第二镜起产品/服务作为推动情绪的「道具」介入；卖点须嵌入具体生活动作（整理袖口、推门、抬腕、举杯），禁止连续 3 镜以上主角定在原地只把玩产品。\n" +
          "  - 虚拟/服务：屏幕内容仅以过肩或眼中倒影出现；空间与时间绝对连贯。\n" +
          "【物理状态锁死命令】佩戴类/穿戴类产品（腕表、珠宝、服饰、鞋帽等）一旦在镜头中被「佩戴/戴上/穿上」，【绝对禁止】在后续镜头中出现无法被观众看到的部位（如腕表透底后盖、机芯、服装内衬、鞋内结构）！除非 `visual`/`motion` 中明确写出「摘下」「取下」「脱下」或「翻转表背/翻开内衬」等可看见背面的动作。\n" +
          "【拒绝枯燥摆拍，强制行为动线】严禁让主角定在原地连续 3 个镜头只把玩/端详产品！必须设计真实的生活/商务动线（例：案前沉思把玩 → 佩戴整装 → 走向落地窗/准备出门 → 抬腕看表时的自信情绪）。每一个卖点必须极其自然地融入上述【生活动作】，而非旁白式功能罗列。\n";
      } else {
        adaptiveStyleRuleBlock =
          "【本套执行 · Style C (Sensory - 极致快剪与感官反应)】\n" +
          stylePhysicalIsolationBlock +
          antiProductOnlyMandateBlock +
          "【第一镜 · 正面强制动作】第一镜【必须且只能】是【非产品本体】的感官碎片：环境失控（震波涟漪、霓虹狂闪、玻璃震颤）或人类生理反应（瞳孔骤缩、皮肤战栗），也可以是极度暴力的物理交互破局；禁止静止产品全貌。\n" +
          "核心精神：高频次转场、物理极限测试、ASMR 听觉轰炸——产品只是触发感官风暴的「开关」，不是每一镜的主角！\n" +
          "【反产品说明书死刑线】：全片如果高达 30-50 个镜头，直接展示产品的镜头【绝对不允许超过总数的 30%】！剩下的 70% 必须全部是【不含产品的感官奇观】（如：纯粹的瞳孔震颤、纯粹的水杯碎裂、纯粹的音波震荡）。严禁拿产品在镜头前晃来晃去！如果连续 2 个镜头都在展示产品不同角度，将被视为重大生产事故！\n" +
          "【镜头强制要求 · 感官碎片】至少 " +
          minMetaphorBrollShots +
          " 镜（≥40%）必须是「非产品本体」画面，单镜 " +
          STYLE_C_DUR_MIN +
          "–" +
          STYLE_C_DUR_MAX +
          "s 快剪中必须穿插：\n" +
          "  - 人类生理：瞳孔骤缩特写、起鸡皮疙瘩的皮肤、带汗水的侧脸残影、喉结吞咽、指节发白攥拳；\n" +
          "  - 环境失控：随节拍疯狂闪烁的霓虹灯、被震碎的玻璃杯、桌面水杯疯狂涟漪、粉尘在光束中爆炸；\n" +
          "  - 听觉可视化：重低音震纹、耳膜共鸣式的画面抖动、肾上腺素飙升的心跳残影。\n" +
          "  产品镜头仅作为链条中的「触发开关」，【不得超过 " +
          maxDirectProductShots +
          " 镜】，且必须嵌在反应碎片之间，禁止连续两镜纯产品。\n" +
          "【文本示范 · 必须达到此颗粒度】：\n" +
          "  「0.5s：超低频音响重低音，画面边缘产生暗角震颤；\n" +
          "   0.5s：旁边桌上水杯水面疯狂泛起同心涟漪（环境失控）；\n" +
          "   0.5s：主角带汗水的侧脸残影 Whip Pan 掠过（生理反应）；\n" +
          "   0.5s：产品特写以撞击感砸向镜头（触发开关，非说明书摆拍）。」\n" +
          "【镜头节奏死命令】极度狂暴！每一镜 `duration` 必须死卡在 " +
          STYLE_C_DUR_MIN +
          "–" +
          STYLE_C_DUR_MAX +
          " 秒（宫格/阵列分屏镜除外）。本套须精准产出 " +
          targetNodes +
          " 镜（不少于 " +
          minNodes +
          " 镜，可至 " +
          maxNodes +
          " 镜）！\n" +
          "【暴力奇观死命令】产品相关镜必须伴随环境/生理连锁反应（砸击→涟漪→皮肤战栗→产品残影），禁止孤立的产品破坏特写连发；虚拟类用 UI 爆破、弹窗砸击、数据残影，同样须穿插「用户生理/环境反馈」碎片。\n" +
          "【音效死命令】每一镜 `audio` 必须咬合重低音下潜或极其清脆的 ASMR 物理破坏声，生理镜须有呼吸/心跳/耳鸣等近场 foley。高潮可闪现宫格阵列。\n" +
          "【无限制扩容法则】：当镜头数量庞大时，【绝对禁止】死守单一场景或人物！你拥有无限预算：1. 疯狂加人（不同身份面孔）；2. 疯狂换景（多维空间跳跃）；3. 疯狂加辅助意象（自然现象/工业毁坏等）。\n" +
          "🚨【品牌定位绝对服从锁】：你的所有『换人、换景、加辅助意象』的操作，【绝对不允许】违背当前传入的『产品定位 (" +
          positioningStr +
          ")』！\n" +
          "- 若定位是【高奢/顶奢】：扩展场景只能是私人美术馆/极简高定后台/深邃抽象空间；人物必须是克制优雅的高智感面孔，严禁市井、泥泞或廉价感！\n" +
          "- 若定位是【科技先锋】：扩展场景必须是无尘实验室/赛博都市/数据流空间；辅助意象用液态金属/电流/机械矩阵。\n" +
          "- 若定位是【大众消费/年轻潮酷】：才能使用街头、派对等烟火气浓重的鲜活场景。\n" +
          "每一次视觉跳跃，都必须用极其契合品牌定位的美学去严格包装！\n";
      }

      var priorityWeightDeclaration =
        "【指令权重申明 · 最高执行判定】以下关于三大风格（Style A/B/C）的【第一镜/开场动作】设定，具有超越任何「平台常规展现逻辑」的最高优先级！无论用户选择什么投放平台，绝对禁止使用「直接展示产品全貌」这种庸俗的开场来覆盖风格自身的艺术设定。\n\n";

      var globalCoreRulesBlock =
        "【全局核心规则】\n" +
        "【片尾多SKU/变色法则】：如果视觉素材分析报告中指出该产品存在多种颜色或形态变体，【严禁】在前期主线剧情中强行塞入不同颜色以免破坏叙事节奏。前期剧情请保持使用主打色。\n" +
        "你【必须且只能】在每一个风格的【最后一个镜头（定格/落幅）】或倒数第二个镜头，设计一个「极速多色切换 (Color Transition / Match Cut)」或「全色系同框阵列展示」的专属视觉桥段，以此来收尾。必须确保片尾涵盖了素材中出现的所有颜色。\n\n";

      var briefForPacing = String(p.brief != null ? p.brief : "无");
      var dynamicPacingBlock =
        "【分镜管线 · 时长与节奏匹配法则（与本套 Style 物理隔离绑定）】\n" +
        "当前目标总时长区间为【" +
        targetMin +
        " - " +
        targetMax +
        "s】。系统为本套 Style 分配【" +
        minNodes +
        "–" +
        maxNodes +
        " 镜】，你【必须且只能】精准产出 " +
        targetNodes +
        " 个镜头！各镜 `duration` 之和必须落入该总时长区间。\n" +
        "🛑 你必须死磕前端输入的【产品卖点】，将其作为每一镜推进的绝对核心：\n" +
        briefForPacing +
        "\n";

      if (isStyleA) {
        dynamicPacingBlock +=
          "👉 【Style A 极慢隐喻管线】：全片 " +
          targetNodes +
          " 镜，每镜 " +
          STYLE_A_DUR_MIN +
          "–" +
          STYLE_A_DUR_MAX +
          "s；其中【至少 " +
          minMetaphorBrollShots +
          " 镜必须是 `[隐喻空镜]`】（自然奇观/抽象 B-roll），产品 `[触发镜]` 不得超过 " +
          maxDirectProductShots +
          " 镜！前 " +
          (targetNodes > 1 ? targetNodes - 1 : 0) +
          " 镜禁止产品全貌，隐喻空镜与产品局部切片必须交替出现；仅末镜允许 Hero 定格。即使投放平台为短视频，也【不得】加快节奏或砍掉空镜！\n";
      } else if (isStyleB) {
        dynamicPacingBlock +=
          "👉 【Style B 微电影管线】：全片 " +
          targetNodes +
          " 镜，每镜 " +
          STYLE_B_DUR_MIN +
          "–" +
          STYLE_B_DUR_MAX +
          "s，以主角动作链串联；禁止 Style A 式全程微距悬念，禁止 Style C 式 sub-1.5s 碎剪。少于 " +
          minNodes +
          " 镜或动作断档视为生产事故！\n";
      } else {
        dynamicPacingBlock +=
          "👉 【Style C 感官碎片快剪管线】：全片 " +
          targetNodes +
          " 镜，每镜 " +
          STYLE_C_DUR_MIN +
          "–" +
          STYLE_C_DUR_MAX +
          "s；【至少 " +
          minMetaphorBrollShots +
          " 镜必须是 `[感官碎片]`】（生理反应/环境失控，非产品本体），产品 `[触发镜]` 不得超过 " +
          maxDirectProductShots +
          " 镜！剪辑链必须是「反应→环境→产品→反应」交替，禁止连续纯产品破坏镜。少于 " +
          minNodes +
          " 镜将被判定为严重生产事故！\n";
      }

      const systemPrompt = `${priorityWeightDeclaration}你是一位轴线逻辑强悍、精通 4A 大厂全套提案心法的顶级 TVC 广告片导演。
你的唯一任务是：基于用户输入的行业、产品、卖点、平台、画幅与定位，为本套风格定制一套可独立上线的 Client-ready 分镜脚本。你必须先完成「实体类别推断」，再严格执行下方本套 Style 的跨品类自适应规则。

${globalCoreRulesBlock}【导演最高铁律】
1. 🛑 绝对物理隔离：严格遵守本套 Style 的【镜头节奏死命令】与【绝对物理隔离】，禁止混入另外两套风格的运镜速度、单镜时长或叙事手法。
2. 🛑 反产品说明书${isStyleA || isStyleC ? "（Style A/C 死刑线）" : ""}：${isStyleA || isStyleC ? "全片≥40% 镜头必须是「非产品本体」的隐喻空镜或感官碎片；禁止纯产品堆砌摆拍！" : "本套须避免机械说明书式摆拍，卖点须通过具体视听动作呈现。"}
3. 🛑 拒绝陪衬：本套提案必须 100% 紧扣产品本体与用户具体卖点，视听视角须与另外两套风格（若存在）彻底可区分。
4. 🛑 纯正语言纪律：除 \`eng_prompt\` 必须是精炼的纯英文生图词（须随实体类别适配：实体侧重材质/光效，虚拟侧重 UI/空间化界面，服务侧重排版/符号隐喻）外，其余字段必须【全部使用纯正专业中文】！绝对禁止中英混杂！
5. 🛑 第一镜纪律：第一镜【必须且只能】执行本套 Style 的【第一镜 · 正面强制动作】；平台常规逻辑仅从第二镜起叠加；每镜 \`duration\` 必须落在本套 Style 规定的秒数区间内！
6. 🛑 System 标记滤除：\`visual\` 正文内绝对不准包含 #、素材格 或任何系统内部编号文字，必须是纯粹、高可读性的画面描述。
7. 🛑 片尾多SKU/变色：若素材存在多色/多形态变体，主线仅保持主打色；多色展示【只能】落在末镜或倒数第二镜，以 Color Transition / Match Cut 或全色系同框阵列收尾，须涵盖素材全部颜色。

${adaptiveEntityMappingBlock}
${adaptiveStyleRuleBlock}
${dynamicCreativeAngle}
${dynamicPacingBlock}

严格返回最外层为标准的合法 JSON 结构：{"styleName": "...", "director_treatment": "...", "visualDNA": "...", "shots": [{"source_image_id": 1, "visual": "纯中文画面描述", "eng_prompt": "English prompt for image gen", "motion": "专业矢量运镜", "start_motion": "...", "end_motion": "...", "audio": "物理 ASMR 音效", "lighting": "工业打光 Rig", "pacing": "...", "duration": 3}]}
${buildUniversalBindingPromptBlock(catalogSlotCount)}`;

      var userTextBlock =
        "【投放平台】：" + (platformStr || "未指定") + "\n" +
        "【画幅比例】：" + ratioStr + "\n" +
        "【产品定位】：" + positioningStr + "\n" +
        "【总时长目标】：" + targetMin + "-" + targetMax + "s\n" +
        "【产品定位与核心卖点】：\n产品：" + productLabelForStyle + "\n简报：" + String(p.brief != null ? p.brief : "无") + "\n" +
        "【场景库】：" + usageScenariosForPrompt + "\n\n" +
        "【本套风格编号：" + styleCfg.name + "】\n" +
        gridHint;

      var userContent = [{ type: "text", text: userTextBlock }];
      base64Images.forEach(function (b64) {
        userContent.push({ type: "image_url", image_url: { url: b64, detail: "high" } });
      });

      var lastError = null;
      var styleObj = { shots: [] };
      var originalContent = "";
      var fullContentLogs = [];

      // ====== 🚀 分批流水线生成 (Batching) 开始 ======
      var currentShots = [];
      var batchSize = 12; // 绝对安全区：每次最多逼 AI 吐 12 镜，防断流
      var batchCount = 0;
      var maxBatches = isStyleC ? 8 : Math.ceil(targetNodes / batchSize) + 1; // Style C：最多 8 批接力，网络闪断时继续补齐
      var lastShotContext = null;

      function styleBatchProgressPct(doneShots) {
        var styleBase = 8 + (typeof styleIndex === "number" ? styleIndex : 0) * 28;
        var styleSpan = 28;
        var ratio = targetNodes > 0 ? Math.min(1, doneShots / targetNodes) : 0;
        return styleBase + ratio * styleSpan;
      }

      function flushPartialStoryboardToScreen(batchActDone) {
        while (liveResults.length < 3) liveResults.push(null);
        var partialStyleSnapshot = {
          styleName: styleObj.styleName || styleCfg.name,
          director_treatment: styleObj.director_treatment || "",
          visualDNA: styleObj.visualDNA || "",
          shots: currentShots.slice(),
          _generating: currentShots.length < targetNodes,
        };
        liveResults[styleIndex] = partialStyleSnapshot;
        window.__LAST_STORYBOARD_DATA__ = liveResults;
        try {
          renderStoryboardDashboard(null, { incrementalPartial: true });
        } catch (renderErr) {
          console.warn("[渐进上屏] 分镜板刷新跳过:", renderErr);
        }
        var pct = styleBatchProgressPct(currentShots.length);
        if (batchActDone === 1 && currentShots.length < targetNodes) {
          setStoryEngineProgress(
            "🎬 第一幕（起幅悬念）已生成并解锁，正在无缝衔接第二幕（核心卖点）...",
            pct,
            { monotonic: true }
          );
        } else if (batchActDone === 2 && currentShots.length < targetNodes) {
          setStoryEngineProgress(
            "⚡ 前两幕剧情已锁死上屏，正在全力冲刺第三幕（高潮定格）...",
            pct,
            { monotonic: true }
          );
        }
      }

      while (currentShots.length < targetNodes && batchCount < maxBatches) {
        batchCount++;
        var stopBatching = false;
        var shotsToRequest = Math.min(batchSize, targetNodes - currentShots.length);
        if (shotsToRequest <= 0) break;

        setStoryEngineProgress(
          batchCount === 1
            ? styleCfg.name + " 正在推演第一幕（起幅悬念）… 已完成 " + currentShots.length + "/" + targetNodes + " 镜"
            : batchCount > 3
              ? styleCfg.name +
                " 正在分批生成 (第 " +
                batchCount +
                " 批)... 已完成 " +
                currentShots.length +
                "/" +
                targetNodes +
                " 镜"
              : null,
          styleBatchProgressPct(currentShots.length),
          batchCount === 2 || batchCount === 3 ? { preserveLabel: true, monotonic: true } : { monotonic: true }
        );

        // --- 1. 强制生成序列，但赋予素材“脑补”特权 ---
        var batchBlueprintStr = "";
        if (catalogSlotCount > 1) {
          var blueprintIds = [];
          var recentIds = [];
          if (currentShots.length > 0) recentIds.push(parseInt(currentShots[currentShots.length - 1].source_image_id, 10));
          if (currentShots.length > 1) recentIds.push(parseInt(currentShots[currentShots.length - 2].source_image_id, 10));

          for (var bi = 0; bi < shotsToRequest; bi++) {
            var pool = [];
            for (var c = 1; c <= catalogSlotCount; c++) {
              if (recentIds.indexOf(c) === -1) pool.push(c);
            }
            if (pool.length === 0) pool = [1];
            var pick = pool[Math.floor(Math.random() * pool.length)];
            blueprintIds.push(pick);
            recentIds.unshift(pick);
            if (recentIds.length > 2) recentIds.pop();
          }

          batchBlueprintStr =
            "【系统底层锁定】：本批次的 `source_image_id` 序列已锁定为：" +
            blueprintIds.join(" -> ") +
            "。\n" +
            "⚠️【核弹级豁免权】：如果当前风格要求你写隐喻空镜、自然奇观、生理反应碎片、生活场景或抽象奇观（Style A/C 的 B-roll 与 Style B/C 的开场），请你【完全无视】该素材图里真正画了什么！尽情虚构你要的电影画面，把这个 ID 纯粹当成后台占位符！绝不要被素材绑架！";
        } else {
          batchBlueprintStr = "【单素材变奏】：仅1张图。请运用极度微距、光影切换或人物遮挡等手段制造画面差异。";
        }
        if (isStyleC) {
          batchBlueprintStr +=
            "\n🚨【Style C 极速跳跃死命令】：你现在的任务是制造视觉风暴！如果不知道写什么，立刻【换人】、【换场景】、【加微剧情】！本批次中，你必须在『 [不同人物的极致情绪/肢体] ⇄ [毫不相干的多维空间/环境异象] ⇄ [极其克制的产品一瞥] ⇄ [抽象的辅助意象蒙太奇] 』之间疯狂横跳！【绝对不允许】连续 3 个镜头停留在同一个物理空间，绝不许重复同一种生理反应！";
        }

        // --- 2. 动态构建大厂商业片三幕剧锚点（确保全部紧扣产品本体，从结构上彻底拉开雷同度） ---
        var narrativePhase = "";
        if (batchCount === 1) {
          if (isStyleA) {
            narrativePhase =
              "【第一幕：迷局与暗示】本批每镜 " +
              STYLE_A_DUR_MIN +
              "–" +
              STYLE_A_DUR_MAX +
              "s，仅 Slow Dolly In / Rack Focus。只能出现隐喻空镜和产品极小局部的微距特写（如一丝反光、一个倒影），整体画面保持极简和深邃的暗调；【绝对禁止】产品全貌。在 visual 开头标注 `[隐喻空镜]` 或 `[产品触发镜]`。";
          } else if (isStyleB) {
            narrativePhase =
              "【第一幕：环境与情绪起幅】交代环境与情绪基调；固定主角出场或空间氛围建立，并与产品产生初步互动（把玩/凝视/轻触），禁止第一镜硬塞产品全貌。本批每镜 duration 必须 " +
              STYLE_B_DUR_MIN +
              "–" +
              STYLE_B_DUR_MAX +
              "s。须为后续动线埋下伏笔（案前、窗前、门厅等），禁止连续 3 镜原地把玩产品。";
          } else {
            narrativePhase =
              "【第一幕：感官碎片起幅】本批每镜 " +
              STYLE_C_DUR_MIN +
              "–" +
              STYLE_C_DUR_MAX +
              "s。第一镜必须是【非产品】感官碎片（涟漪/瞳孔/霓虹狂闪/重低音震纹）；本批至少一半为 `[感官碎片]`，产品 `[触发镜]` 须嵌在反应链中，禁止连续纯产品。在 visual 开头标注镜型。";
          }
        } else if (batchCount === 2) {
          if (isStyleA) {
            narrativePhase =
              "【第二幕：解构与质感】本批每镜 " +
              STYLE_A_DUR_MIN +
              "–" +
              STYLE_A_DUR_MAX +
              "s；镜头开始缓慢推进，光影开始流动（如 Scan Light 扫过），展示材质的极致工艺，隐喻元素开始与产品产生视觉共鸣（如水波纹叠化到金属拉丝）。产品仍仅局部切片，【禁止】全貌。";
          } else if (isStyleB) {
            narrativePhase =
              "【第二幕：状态转化与功能】本批必须发生明确的「状态转化」（戴上/穿上/启动/整装），配合特写展示核心功能；佩戴类产品在已佩戴后【禁止】展示后盖/透底/内衬/机芯等穿帮画面，除非动作写明摘下或翻转。同一固定主角与同一场景内，卖点融入连续动作链，每镜 " +
              STYLE_B_DUR_MIN +
              "–" +
              STYLE_B_DUR_MAX +
              "s，禁止跳切 unrelated 场景。";
          } else {
            narrativePhase =
              "【第二幕：生理-环境-产品链】每镜 " +
              STYLE_C_DUR_MIN +
              "–" +
              STYLE_C_DUR_MAX +
              "s；以「环境失控→生理反应→产品触发」快剪链铺陈卖点，至少本批一半镜为 `[感官碎片]`，禁止产品说明书连拍。";
          }
        } else {
          if (isStyleA) {
            narrativePhase =
              "【第三幕：全貌释出】本批若含末镜，彻底打破悬念，利用宏大的打光和极慢的后退运镜（Slow Pull Back）展现产品极具压迫感和奢华感的全貌 Hero 定格；此前镜须维持 `[隐喻空镜]` 与产品切片交替，每镜 " +
              STYLE_A_DUR_MIN +
              "–" +
              STYLE_A_DUR_MAX +
              "s。";
          } else if (isStyleB) {
            narrativePhase =
              "【第三幕：动线延展与情绪升华】动作延展与情绪升华（准备出发、走向落地窗、抬腕看表、迎接挑战等），通过真实生活/商务动线收尾展示全貌，【禁止】原地呆坐连拍。在固定场景内完成情绪释放与 Hero 定格，每镜 " +
              STYLE_B_DUR_MIN +
              "–" +
              STYLE_B_DUR_MAX +
              "s，动作链须与前一镜顺滑衔接。";
          } else {
            narrativePhase =
              "【第三幕：感官总爆】每镜 " +
              STYLE_C_DUR_MIN +
              "–" +
              STYLE_C_DUR_MAX +
              "s；最高密度 `[感官碎片]` + Whip Pan/砸击/宫格阵列，Hero 产品须在生理/环境连锁反应中定格，禁止孤立产品说明书收尾。";
          }
        }

        var currentSystemPrompt = systemPrompt;
        if (batchCount === 1) {
          currentSystemPrompt +=
            "\n\n" +
            narrativePhase +
            "\n\n" +
            batchBlueprintStr +
            "\n\n🚨【强制定量指令】：这是第 1 批。你【必须且只能】精确输出 " +
            shotsToRequest +
            " 个镜头！请将这 " +
            shotsToRequest +
            " 镜合理分配在开场和铺垫中。少于 " +
            shotsToRequest +
            " 镜将被判定为生产事故！仅输出合法 JSON。";
        } else if (batchCount > 1 && lastShotContext) {
          if (isStyleA) {
            batchBlueprintStr +=
              "\n🛑【高冷防连拍】：上一镜的画面是「" +
              lastShotContext.visual +
              "」。如果上一镜是微距产品局部，本镜请务必切向一个高质感的【隐喻空镜】；如果上一镜是隐喻，本镜请回到产品。同时，【绝对禁止】复用前文已经出现过的隐喻元素（例如前面用过水、冰，后面就只能用光影、几何或粉末等其他元素），必须保持视觉新鲜感！";
          }
          if (isStyleC) {
            batchBlueprintStr +=
              "\n🛑【时空强制刷新锁】：上一镜是「" +
              lastShotContext.visual +
              "」。本镜【必须】彻底切换物理空间或更换出场人物！如果上一镜是室内，这镜就切室外/抽象空间；如果上一镜是局部，这镜就切群像大景；如果上一镜出现了产品，这镜【绝对禁止】再提产品，必须用其他辅助元素或群演反应来推进张力！";
          }
          var deficit = targetNodes - currentShots.length;
          var pastVisuals = currentShots
            .map(function (s, idx) {
              return "Shot " + (idx + 1) + ": " + s.visual;
            })
            .join(" | ");

          currentSystemPrompt +=
            "\n\n" +
            narrativePhase +
            "\n\n" +
            batchBlueprintStr +
            "\n\n🚨【分批串联指令】：这是第 " +
            batchCount +
            " 批请求。请顺滑承接上一镜，继续横向展开故事厚度，补充至少 " +
            Math.min(batchSize, deficit) +
            " 个镜头。\n" +
            "上一镜落幅是：「" +
            lastShotContext.visual +
            "」。\n" +
            "🛑【防雷同死命令】：前文已生成：[" +
            pastVisuals +
            "]。接下来的镜头【绝对禁止】复用上述场景或动作结构！必须向下推进剧情！";
        }

        var batchSuccess = false;
        for (var attempt = 1; attempt <= 2; attempt++) {
          try {
            var currentMessages = [
              { role: "system", content: currentSystemPrompt },
              { role: "user", content: userContent },
            ];

            var dynamicTemp = styleCfg.id === "C" ? 0.85 : 0.7;
            if (attempt > 1) dynamicTemp += 0.1;

            const res = await llmApiFetch("chat/completions", {
              label: styleCfg.name + " 分镜 (批次 " + batchCount + ")",
              apiKey: key,
              timeout: 180000,
              body: JSON.stringify({
                model: window.getTextModel(),
                max_tokens: 8192,
                temperature: dynamicTemp,
                messages: currentMessages,
                response_format: { type: "json_object" },
              }),
            });

            const data = await res.json();
            originalContent = String(
              (data &&
                data.choices &&
                data.choices[0] &&
                data.choices[0].message &&
                data.choices[0].message.content) ||
                ""
            );
            if (!originalContent.trim()) throw new Error("批次响应为空");
            fullContentLogs.push(originalContent);

            const parsed = extractAndParseStoryboardJson(originalContent);
            var tempStyleObj = parsed.style != null ? parsed.style : parsed;

            if (!tempStyleObj.shots || !Array.isArray(tempStyleObj.shots)) throw new Error("本批次缺少分镜数组");

            if (batchCount === 1) {
              styleObj.director_treatment = tempStyleObj.director_treatment;
              styleObj.visualDNA = tempStyleObj.visualDNA;
              if (tempStyleObj.styleName != null && String(tempStyleObj.styleName).trim()) {
                styleObj.styleName = String(tempStyleObj.styleName).trim();
              }
            }

            currentShots = currentShots.concat(tempStyleObj.shots);
            styleObj.shots = currentShots;

            // 断点实时渲染：本幕 Batch 解析并入 shots 后立即上屏，不等待循环结束
            flushPartialStoryboardToScreen(batchCount);

            if (tempStyleObj.shots.length === 0) {
              console.warn("[批次断流] " + styleCfg.name + " 第 " + batchCount + " 批返回 0 镜，继续下一批接力。");
            }
            if (currentShots.length >= targetNodes) {
              stopBatching = true;
            }

            if (currentShots.length > 0) {
              var ls = currentShots[currentShots.length - 1];
              lastShotContext = { visual: ls.visual, motion: ls.motion };
            }

            batchSuccess = true;
            break;
          } catch (e) {
            lastError = e;
            console.warn("[批次重试] " + styleCfg.name + " 第 " + batchCount + " 批次第 " + attempt + " 次失败:", e);
          }
        }

        if (!batchSuccess) {
          console.warn(
            "[批次断流] " +
              styleCfg.name +
              " 第 " +
              batchCount +
              " 批次请求失败，已生成 " +
              currentShots.length +
              "/" +
              targetNodes +
              " 镜，继续下一批接力。"
          );
          continue;
        }
        if (stopBatching || currentShots.length >= targetNodes) {
          break;
        }
      }

      styleObj.shots = currentShots;

      if (!styleObj.shots.length) {
        throw new Error(
          styleCfg.name + " 连续生成失败：" + String(lastError && lastError.message ? lastError.message : lastError)
        );
      }

      var acceptableMin = isStyleA
        ? Math.max(3, Math.floor(targetNodes * 0.6))
        : isStyleC
          ? Math.max(minNodes, Math.floor(targetNodes * 0.5))
          : Math.max(4, Math.floor(targetNodes * 0.5));
      if (styleObj.shots.length < acceptableMin) {
        console.warn("AI 镜头数偏少，已放行：期望 " + targetNodes + " 镜，实际 " + styleObj.shots.length + " 镜。");
      }
      // ====== 🚀 分批流水线生成 (Batching) 结束 ======

      try {
        setStoryEngineProgress(styleCfg.name + " 正在进行视觉闭环校验…", 42 + (typeof styleIndex === "number" ? styleIndex : 0) * 26);

        if (!styleObj.styleName || !String(styleObj.styleName).trim()) {
          styleObj.styleName = styleCfg.name;
        }
        if (styleObj.visualDNA == null) styleObj.visualDNA = "";
        if (styleObj.director_treatment == null || !String(styleObj.director_treatment).trim()) {
          styleObj.director_treatment =
            styleCfg.id === "A"
              ? "【导演阐述·内核解码】以克制、客观的专业镜头语言解构核心价值。视觉重心在于剥离冗余环境，用微距/特写、严谨的光影（如 Scan/Rim Light）及缓慢推进的运镜，最大化呈现其物理工艺或逻辑深度。"
              : styleCfg.id === "B"
                ? "【导演阐述·人文共振】将产品/服务无缝融入高级且真实的生活流。视觉重心在于捕捉人物的情绪蜕变与自然互动，通过暖调窗光与散景，营造极强的代入感与共鸣感。"
                : "【导演阐述·感官风暴】旨在通过高频视听刺激掠夺注意力。视觉重心在于极速快剪、Match Cut 转场、运动模糊与高爆 ASMR 节奏，通过强烈的动静反差与视觉奇观刻画品牌张力。";
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
            if (isNaN(d) || d <= 0) d = 2;
            sh.duration = Number(Math.max(1, Math.round(d)));
            if (Object.prototype.hasOwnProperty.call(sh, "duration_weight")) {
              try {
                delete sh.duration_weight;
              } catch (eDw) {
                sh.duration_weight = void 0;
              }
            }
          }
          setStoryEngineProgress(styleCfg.name + " 正在物理校准总时长…", 78 + (typeof styleIndex === "number" ? styleIndex : 0) * 6);
          clampShotDurationsToWindow(
            styleObj.shots,
            targetMin,
            targetMax,
            styleCfg,
            String(p.product != null ? p.product : "")
          );
          for (hi = 0; hi < styleObj.shots.length; hi++) fillDefaultShotFields(styleObj.shots[hi], styleCfg);
          applyStoryboardVisualRewrites(styleObj, p);
          breakTripleConsecutiveGridRefs(styleObj, styleCfg);
          validateContinuity(styleObj.shots, styleCfg);
          validateStoryboardGridVisualClosure(styleObj, styleCfg);
        } else {
          applyStoryboardVisualRewrites(styleObj, p);
          breakTripleConsecutiveGridRefs(styleObj, styleCfg);
          validateContinuity(styleObj.shots, styleCfg);
          validateStoryboardGridVisualClosure(styleObj, styleCfg);
          setStoryEngineProgress(styleCfg.name + " 正在物理校准总时长…", 78 + (typeof styleIndex === "number" ? styleIndex : 0) * 6);
          autoAdjustDuration(styleObj, targetMin, targetMax, styleCfg, p);
        }

        try {
          delete styleObj._generating;
        } catch (eGen) {
          styleObj._generating = void 0;
        }
        liveResults[styleIndex] = styleObj;
        window.__LAST_STORYBOARD_DATA__ = liveResults;

        return styleObj;
      } catch (e) {
        console.error("导演纠偏 - " + styleCfg.name + " 解析/校验异常:", e);
        console.error(
          "导演纠偏 - " + styleCfg.name + " 原始 content（完整多批次记录）:",
          fullContentLogs.join("\n\n--- 批次分割线 ---\n\n")
        );
        var lastAttemptContent =
          fullContentLogs.length > 0 ? fullContentLogs[fullContentLogs.length - 1] : originalContent;
        console.error(
          "导演纠偏 - " + styleCfg.name + " 提取尝试片段(最后一批):",
          extractOutermostJsonBlock(lastAttemptContent)
        );
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
        try {
          const singleStyleObj = await craftSingleStyle(stylesToCraft[si], si);
          results[si] = singleStyleObj;
          if (typeof onStyleReady === "function") {
            onStyleReady(si, singleStyleObj);
          }
        } catch (styleErr) {
          var styleErrMsg = styleErr && styleErr.message ? String(styleErr.message) : String(styleErr || "");
          if (styleErrMsg.indexOf("【已取消】") !== -1) {
            throw styleErr;
          }
          console.error(
            "[分镜引擎] " + (stylesToCraft[si] && stylesToCraft[si].name ? stylesToCraft[si].name : "Style " + si) +
              " 生成失败，已跳过本套：",
            styleErr
          );
          results[si] = null;
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

    const REF_RE = /(?:参考|动态)素材格\s*#(\d+)/;
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
        var targetMedia = cell ? cell.querySelector("img, video") : null;
        if (!targetMedia) return;

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
        var isVideo = targetMedia.tagName.toLowerCase() === "video";
        var img = document.createElement(isVideo ? "video" : "img");
        img.src = targetMedia.src;
        if (isVideo) {
          img.autoplay = true;
          img.loop = true;
          img.muted = true;
          img.playsInline = true;
        } else {
          img.alt = targetMedia.alt || "";
        }
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
  var storyboardRedrawDelegationBound = false;

  function handleStoryboardShotRedraw(btn) {
    var sIdx = parseInt(String(btn.getAttribute("data-tab-index") || ""), 10);
    var shotIdx = parseInt(String(btn.getAttribute("data-shot-index") || ""), 10);
    if (isNaN(sIdx)) {
      var panelEl = btn.closest(".tab-panel");
      if (panelEl && panelEl.id) {
        var pm = panelEl.id.match(/panel-(\d+)/);
        if (pm) sIdx = parseInt(pm[1], 10);
      }
    }
    if (isNaN(sIdx) || sIdx < 0 || isNaN(shotIdx) || shotIdx < 0) return;

    var data = window.__LAST_STORYBOARD_DATA__;
    if (!data || !data[sIdx] || !Array.isArray(data[sIdx].shots)) return;
    var style = data[sIdx];
    var shot = style.shots[shotIdx];
    if (!shot) return;

    var card = btn.closest(".visual-shot-card");
    if (!card) return;
    var loading = card.querySelector(".visual-shot-loading");
    var img = card.querySelector("img.visual-shot-img");
    if (!loading || !img) return;

    var productEl = document.getElementById("product-input");
    var productName = (productEl && String(productEl.value || "").trim()) || "luxury product";
    var ratioElBoard = document.getElementById("ratio-select");
    var ratioStr = ratioElBoard ? String(ratioElBoard.value || "") : "";
    var imageSize = getImageSizeForRatio(ratioStr);

    var renderCtx = {
      loading: loading,
      img: img,
      redrawBtn: btn,
      shot: shot,
      apiKey:
        typeof window.getLlmApiKeyFromInput === "function"
          ? window.getLlmApiKeyFromInput()
          : String(document.getElementById("llm-api-key").value || "").trim(),
      imageModel: window.getImageModel(),
      drawPrompt: buildVisualDrawPrompt(shot, style, productName, sIdx, "dalle"),
      imageSize: imageSize,
    };
    triggerVisualShotRender(renderCtx);
  }

  function bindStoryboardRedrawDelegation() {
    var dashboard = document.getElementById("storyDashboard");
    if (!dashboard || storyboardRedrawDelegationBound) return;
    storyboardRedrawDelegationBound = true;
    dashboard.addEventListener("click", function (e) {
      var btn = e.target && e.target.closest ? e.target.closest(".btn-redraw-shot") : null;
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      handleStoryboardShotRedraw(btn);
    });
  }

  function buildStoryboardPanelHtml(style, sIdx) {
    if (!style || typeof style !== "object") style = { shots: [] };
    if (typeof sIdx !== "number" || isNaN(sIdx)) sIdx = 0;
    const rawShots = style.shots || style.content || style.list || style.Shots || [];
    const shots = Array.isArray(rawShots)
      ? rawShots.filter(function (sh) {
          return sh && typeof sh === "object";
        })
      : [];
    var totalSec = 0;
    shots.forEach(function (sh) {
      totalSec += parseInt(sh.duration, 10) || 0;
    });

    var treatment = style.director_treatment != null ? String(style.director_treatment) : "";
    var html = "";
    if (style._generating) {
      html +=
        '<div style="margin-bottom:12px;padding:10px 12px;border:1px dashed var(--blue);border-radius:8px;background:rgba(0,80,200,0.06);font-size:0.82rem;color:#444;line-height:1.45;">' +
        "⏳ 本套分镜仍在后台生成中，后续幕次将自动解锁并追加到时间轴…" +
        "</div>";
    }
    html +=
      '<div class="dna-card" style="margin-bottom:12px; padding:12px; border:1px solid var(--blue); border-radius:8px; background:rgba(0,80,200,0.04);">' +
      '<div style="font-size:0.7rem; color:var(--blue); font-weight:bold;">DIRECTOR TREATMENT / 导演阐述</div>' +
      '<div style="font-size:0.85rem; margin-top:6px; white-space:pre-wrap;">' +
      escapeHtml(treatment || "—") +
      "</div></div>" +
      '<div class="timeline">';

    shots.forEach(function (shot, i) {
      var durRaw = shot.duration != null ? String(shot.duration).trim() : "";
      var durPill = durRaw ? escapeHtml(durRaw) : "—";
      if (durRaw && !/s$/i.test(durRaw)) durPill += "s";

      var contCheck = String(shot.continuity_check || "");
      var continuityBadge = /⚠️\s*风险|需检查：跳轴风险/.test(contCheck)
        ? '<span class="tl-continuity-warn" style="display:inline-block;padding:2px 8px;font-size:0.68rem;font-weight:700;line-height:1.35;color:#7a5a00;background:#fff3cd;border:1px solid #ffc107;border-radius:6px;white-space:nowrap;" title="' +
          escapeHtml(contCheck) +
          '">⚠️ 连贯性需核查</span>'
        : "";

      html +=
        '<div class="tl-shot" style="margin-bottom:24px;">' +
        '<div class="tl-shot-head" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">' +
        '<span class="tl-no">SHOT ' +
        (i + 1) +
        "</span>" +
        '<div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">' +
        continuityBadge +
        '<span class="tl-pill">' +
        durPill +
        "</span></div></div>" +
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
      totalSec +
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
        var loadingDisplay = visUrl ? "none" : "flex";
        var imgOpacity = visUrl ? "1" : "0";
        html +=
          '<div class="visual-shot-card" style="border:1px solid var(--border-color);border-radius:12px;overflow:hidden;background:#fff;box-shadow:0 4px 12px rgba(0,0,0,0.04);display:flex;flex-direction:column;">' +
          '<div style="width:100%;aspect-ratio:' +
          cssRatioRestore +
          ';background:#f5f5f7;position:relative;border-bottom:1px solid var(--border-color);overflow:hidden;">' +
          '<button type="button" class="btn-redraw-shot" data-shot-index="' +
          vi +
          '" data-tab-index="' +
          sIdx +
          '" title="仅重绘本镜头" style="position:absolute;top:8px;right:8px;z-index:3;padding:4px 10px;font-size:0.75rem;font-weight:600;border:1px solid rgba(0,0,0,0.12);border-radius:8px;background:rgba(255,255,255,0.92);color:#333;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.08);backdrop-filter:blur(4px);">🔄 重绘</button>' +
          '<div class="visual-shot-loading" style="position:absolute;inset:0;display:' +
          loadingDisplay +
          ';align-items:center;justify-content:center;color:#666;font-size:0.85rem;font-weight:500;background:#eef2f5;z-index:1;">' +
          VISUAL_LOADING_HTML +
          "</div>" +
          '<img class="visual-shot-img" src="' +
          escapeHtml(visUrl) +
          '" alt="" style="width:100%;height:100%;object-fit:cover;display:block;opacity:' +
          imgOpacity +
          ';transition:opacity 0.6s ease;" loading="lazy" />' +
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
      if (!style || !Array.isArray(style.shots) || !style.shots.length) return;
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

    bindStoryboardTabHandlers();
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
    bindStoryboardRedrawDelegation();
  }

  function renderStoryboardDashboard(data, opts) {
    opts = opts || {};
    var incrementalPartial = !!opts.incrementalPartial;
    const dashboard = document.getElementById("storyDashboard");
    const panels = document.getElementById("tabPanels");
    const tabBtns = document.querySelectorAll(".tab-btn");
    if (!dashboard || !panels) return;

    try {
    const styles =
      (data != null && data.styles) ||
      (Array.isArray(data) && data.length ? data : null) ||
      (Array.isArray(window.__LAST_STORYBOARD_DATA__) ? window.__LAST_STORYBOARD_DATA__ : []);

    if (!Array.isArray(styles) || styles.length === 0) {
      if (incrementalPartial) return;
      return alert("AI 未返回有效分镜数据，请重试");
    }

    var hasRenderable = styles.some(function (s) {
      return s && Array.isArray(s.shots) && s.shots.length > 0;
    });
    if (!hasRenderable) {
      if (incrementalPartial) return;
      return alert("AI 未返回有效分镜数据，请重试");
    }

    window.__LAST_STORYBOARD_DATA__ = styles;

    dashboard.classList.add("is-visible");
    dashboard.setAttribute("aria-hidden", "false");

    var isIncremental = panels.querySelector(".tab-panel") != null;
    if (!isIncremental) {
      panels.innerHTML = "";
    }

    tabBtns.forEach(function (btn, idx) {
      var st = styles[idx];
      if (st && Array.isArray(st.shots) && st.shots.length) {
        btn.style.display = "inline-block";
        var label = st.styleName || "Style " + (idx + 1);
        if (st._generating) label += " …生成中";
        btn.textContent = label;
      } else if (!isIncremental) {
        btn.style.display = "none";
      }
    });

    styles.forEach(function (style, sIdx) {
      if (!style || !Array.isArray(style.shots) || !style.shots.length) return;
      var panel = document.getElementById("panel-" + sIdx);
      if (!panel) {
        panel = document.createElement("div");
        panel.className = "tab-panel";
        panel.id = "panel-" + sIdx;
        panels.appendChild(panel);
      }
      panel.innerHTML = buildStoryboardPanelHtml(style, sIdx);
    });

    if (!isIncremental) {
      tabBtns.forEach(function (btn, idx) {
        btn.classList.toggle("is-active", idx === 0 && styles[0]);
        btn.setAttribute("aria-selected", idx === 0 && styles[0] ? "true" : "false");
      });
      var firstPanel = document.getElementById("panel-0");
      if (firstPanel) firstPanel.classList.add("is-active");
    }

    syncStoryboardModsDropdown(styles);
    bindStoryboardTabHandlers();
    bindStoryboardRedrawDelegation();
    attachGridInteractivity();
    } catch (renderErr) {
      if (!incrementalPartial) throw renderErr;
      console.warn("[renderStoryboardDashboard] 半成品渐进渲染跳过:", renderErr);
    }
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
      "[Rig 精修兜底] Rim Light 冷轮廓勾边 + Scan Light 窄束扫描，强化材质微结构或 UI 界面的立体层次。";
    var rigB =
      "[Rig 精修兜底] 自然窗光主光 + 轻 Rim 分离人物与背景；营造高级且真实的呼吸感。";
    var rigC =
      "[Rig 精修兜底] 硬边高反差光影 + 局部强补光，配合变速段可剪接的闪烁节奏。";
    var audA =
      "[ASMR 精修兜底] 极低环境底噪，配合微距下的精密物理咬合声、材质摩擦声或高级清脆的 UI 交互音效。";
    var audB =
      "[ASMR 精修兜底] 真实环境的极弱 ambience，配合人物自然的呼吸、衣物摩擦或环境白噪音。";
    var audC =
      "[ASMR 精修兜底] 极具压迫感的高爆音效（磁吸/撞击/重低音下潜等），近场 foley 与剪辑点死死咬合。";
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
      " 秒之间。如果时长需要调整，优先通过优化单镜头 pacing 或进行等比例伸缩来适配。严禁强行凑数！\n\n" +
      "【动作矢量化】：motion / visual 中**禁止**含糊写「移动」；必须使用可执行矢量术语（如 Arc Orbit, Dolly In, Rack Focus 等）。\n\n" +
      "【光影 Rig 注入】：**每一镜**须在 lighting 中写明具体 Rig（如 Scan Light 扫描高光、Rim Light 轮廓光），以强化产品特定材质或界面的立体层次。\n\n" +
      "【ASMR 音效增强】：**每一镜**的 audio 字段必须根据产品形态（实体/虚拟/服饰）包含**可感知的具体质感**描写，如物理咬合声、织物摩擦声或 UI 清脆反馈声，与画面动作同步。\n\n" +
      "【细节与衔接】：首镜优先「极速微距 + Scan Light」制造微结构高光；涉及交互段落须写出阻尼、触感或反馈的微观细节；相邻镜须交代矢量衔接。\n\n" +
      "【输出纪律】：严格保留原有 Visual DNA 与核心逻辑。输出 JSON 结构与原脚本一致（含 director_treatment、shots 等）。\n\n";

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
    const originalContent = String(
      (data &&
        data.choices &&
        data.choices[0] &&
        data.choices[0].message &&
        data.choices[0].message.content) ||
        ""
    );
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

      safeSetLabBusy(true);
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
        safeSetLabBusy(false);
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
  function getImageSizeForRatio(ratioStr) {
    var gptSize = "1024x1024";
    if (ratioStr.indexOf("9:16") !== -1) gptSize = "1024x1792";
    else if (ratioStr.indexOf("16:9") !== -1 || ratioStr.indexOf("21:9") !== -1) gptSize = "1792x1024";
    return gptSize;
  }

  function getStyleMoodSuffix(style, sIdx) {
    var name = String((style && style.styleName) || "");
    if (/style\s*a\b/i.test(name) || (sIdx === 0 && !/style\s*[bc]\b/i.test(name))) {
      return "extreme micro-details, sharp technical focus, pristine texture or UI clarity, cinematic clinical lighting, minimalist premium presentation, commercial standard.";
    }
    if (/style\s*b\b/i.test(name) || sIdx === 1) {
      return "High-end lifestyle photography, warm afternoon ambient light, soft natural shadows, beautiful depth of field, blurred background, cinematic elegant bokeh, organic and authentic feel.";
    }
    return "Surreal avant-garde cinematography, high contrast dramatic chiaroscuro lighting, deep liquid dark background, explosive abstract textures, aggressive composition, intentional motion blur, extreme visual impact, award-winning commercial tvc style.";
  }

  /** 全行业顶级商业摄影 — 材质 → 物理/光影约束（供 DALL·E 工业级出图） */
  var MATERIAL_PROPERTIES_MAP = {
    // 3C/精密制造
    金属: "brushed metallic surface, anisotropic micro-scratches, sharp highlight edges, premium industrial finish",
    玻璃: "translucent refractive glass, high-end optical clarity, subtle caustic light reflections, premium oleophobic coating",
    塑料: "matte finished polymer, uniform light diffusion, high-quality industrial injection molding, soft-touch texture",
    // 美妆/洗护
    精华: "macro liquid dynamics, viscous fluid simulation, glowing subsurface scattering, pure luminous backlight",
    膏霜: "creamy rich texture, macro smudging details, soft diffused ambient occlusion, luxurious skincare photography",
    粉底: "fine powder particles, velvety matte finish, microscopic skin texture blending, elegant cosmetic lighting",
    // 珠宝/配饰
    钻石: "brilliant cut facets, intense chromatic dispersion, macro ray-traced caustics, dark background with spot illumination",
    皮: "full-grain leather texture, soft natural light absorption, intricate stitch detailing, rich patina finish",
    // 食品/饮料
    食品: "appetizing textures, macro food photography, steam or fresh moisture highlights, high-contrast appetizing lighting",
    水: "dynamic splashing water droplets, high-speed macro photography, crystal clear surface tension, refreshing cool lighting",
    咖啡: "rich dark espresso tones, golden crema micro-bubbles, warm inviting backlight, macro liquid swirls",
    // 服饰/布料
    布料: "macro weave structure, soft fabric draping, gentle rim light on fibers, tactile textile photography",
    丝绸: "flowing silk folds, liquid-like specular highlights, elegant wave dynamics, luxurious soft illumination",
  };

  var MATERIAL_DEFAULT_COMMERCIAL =
    "Material physics (general product): industrial-grade PBR surface fidelity, controlled studio speculars, premium commercial packshot standard.";

  var MATERIAL_VIRTUAL_UI =
    "Digital interface: sleek flat design, glowing neon accents, high-end UI/UX presentation, holographic projection elements, crisp vector-like graphics, modern tech aesthetic.";

  function resolveMaterialConstraintLine(productName, category) {
    var hay = (String(productName || "") + " " + String(category || "")).toLowerCase();

    if (/app|软件|系统|界面|ui|虚拟|数字|平台|服务|数据|网络/i.test(hay)) {
      return MATERIAL_VIRTUAL_UI;
    }

    var lines = [];
    var matKey;
    for (matKey in MATERIAL_PROPERTIES_MAP) {
      if (!Object.prototype.hasOwnProperty.call(MATERIAL_PROPERTIES_MAP, matKey)) continue;
      if (hay.indexOf(String(matKey).toLowerCase()) !== -1) {
        lines.push(MATERIAL_PROPERTIES_MAP[matKey]);
      }
    }
    if (lines.length) return "Physically accurate PBR surface, rim-light edge separation. " + lines.join(" ");
    return (
      "Physically accurate PBR surface, rim-light edge separation. " +
      MATERIAL_DEFAULT_COMMERCIAL
    );
  }

  function collapseSpacesForDraw(s) {
    return String(s || "")
      .replace(/\s{2,}/g, " ")
      .replace(/\s+([，。、；：])/g, "$1")
      .trim();
  }

  /** 仅剥离系统标记与剪辑术语；供 UI 展示时勿调用（面板须保留原汁原味剧本） */
  function stripVideoEditTermsForDraw(originalVisualText) {
    var cleanPrompt = String(originalVisualText || "").replace(/\((?:参考|动态)素材格[^)]+\)/g, "");
    cleanPrompt = cleanPrompt.replace(/[0-9.]+[s秒]极速快剪|[0-9.]+[s秒]/g, "");
    cleanPrompt = cleanPrompt.replace(/快剪|匹配剪辑|转场|运镜残影|极速甩镜|Whip Pan|Match Cut/gi, "");
    return collapseSpacesForDraw(cleanPrompt);
  }

  function isStyleCForDraw(style, sIdx) {
    var styleName = style && style.styleName ? String(style.styleName) : "";
    return /style\s*c\b/i.test(styleName) || (typeof sIdx === "number" && sIdx === 2);
  }

  /** 生图专用：在 strip 基础上追加高速摄影定格语义（DALL·E / MJ / Nano Banner 等底层 Prompt） */
  function sanitizeVisualForImageGen(originalVisualText, style, sIdx) {
    var cleanPrompt = stripVideoEditTermsForDraw(originalVisualText);
    if (isStyleCForDraw(style, sIdx) || /炸裂|飞溅|狂暴|极速/.test(cleanPrompt)) {
      cleanPrompt +=
        "，高速摄影瞬间定格 (High-speed photography frozen motion), 画面极其清晰锐利, 无运动模糊";
    }
    return cleanPrompt.trim();
  }

  /**
   * 构建送往生图引擎的 Prompt（与分镜 UI 展示严格分离）。
   * 分镜面板上须直接展示 shot.visual 原文；仅本函数返回值可传入 DALL·E / MJ / Nano Banner。
   */
  function buildVisualDrawPrompt(shot, style, productName, sIdx, mode) {
    if (!mode) mode = "dalle";
    var exactProductDescription = style && style.visualDNA ? style.visualDNA : productName;
    var engPrompt =
      shot.eng_prompt != null && String(shot.eng_prompt).trim() ? String(shot.eng_prompt).trim() : "";
    var sceneCore = engPrompt
      ? sanitizeVisualForImageGen(engPrompt, style, sIdx)
      : sanitizeVisualForImageGen(shot.visual || "", style, sIdx);
    var mood = getStyleMoodSuffix(style, sIdx);
    var motionHint = stripVideoEditTermsForDraw(shot.motion || "");
    var lighting =
      shot.lighting != null && String(shot.lighting).trim() ? String(shot.lighting).trim() : "";

    if (mode === "dalle") {
      var categoryEl = document.getElementById("category-input");
      var category = categoryEl ? String(categoryEl.value || "").trim() : "";
      var materialLine = resolveMaterialConstraintLine(productName, category);
      var dalleParts = [
        "Hyper-realistic commercial product photography, 8K, shot on ARRI Alexa 65, Zeiss Master Prime optics",
        sceneCore,
        "Product details: " + exactProductDescription,
        lighting ? "Lighting rig: " + lighting : "",
        motionHint && !isStyleCForDraw(style, sIdx) ? "Camera motion: " + motionHint : "",
        materialLine,
        mood,
      ];
      return dalleParts
        .filter(function (p) {
          return p && String(p).trim();
        })
        .join(", ");
    }

    if (mode === "mj") {
      var mjCore = sceneCore;
      if (shotUsesDynamicVideoAsset(shot)) {
        mjCore = sanitizeMjPromptForVideoAsset(mjCore);
      }
      var mjLine = [
        "Cinematic high-end photography",
        mjCore,
        "Product details: " + exactProductDescription,
        mood,
        "8k resolution, photorealistic, shot on ARRI Alexa",
      ].join(", ");
      if (shotUsesDynamicVideoAsset(shot)) {
        mjLine = sanitizeMjPromptForVideoAsset(mjLine);
      }
      return mjLine;
    }
    // Nano Banner：电商强转化流（sceneCore 已为静态化洗稿结果）
    return [
      "Commercial e-commerce banner",
      sceneCore,
      "Product details: " + exactProductDescription,
      "clean background with negative space for text",
      "sharp focus, professional studio shot",
      mood,
    ]
      .filter(function (p) {
        return p && String(p).trim();
      })
      .join(", ");
  }

  function labSleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  /** 429 限流冷却：在 loading 节点上显示秒级倒计时 */
  function labSleepWithCountdown(ms, loadingEl, messagePrefix) {
    var totalSec = Math.max(1, Math.ceil(ms / 1000));
    var prefix = messagePrefix || "限流冷却中";
    return new Promise(function (resolve) {
      var left = totalSec;
      function renderTick() {
        if (loadingEl) {
          loadingEl.innerHTML =
            "<span style='font-size:12px;color:#666;line-height:1.45;text-align:center;padding:8px;display:block;'>" +
            prefix +
            "，<strong>" +
            left +
            "</strong>s 后自动重试…</span>";
        }
      }
      renderTick();
      function tick() {
        left--;
        if (left <= 0) {
          resolve();
          return;
        }
        renderTick();
        setTimeout(tick, 1000);
      }
      setTimeout(tick, 1000);
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
            return labSleepWithCountdown(10000, loading, "DALL-E 限流冷却中").then(function () {
              loading.innerHTML = VISUAL_LOADING_HTML;
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

    var runToken = Date.now();
    window.__VISUAL_RENDER_TOKEN = runToken;

    var delayMs = 8000;

    return new Promise(function (resolve) {
      var idx = 0;

      function pump() {
        if (window.__VISUAL_RENDER_TOKEN !== runToken) {
          resolve();
          return;
        }
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
          var drawPrompt = buildVisualDrawPrompt(shot, style, productName, sIdx, "dalle");

          var card = document.createElement("div");
          card.className = "visual-shot-card";
          card.style.cssText = "border: 1px solid var(--border-color); border-radius: 12px; overflow: hidden; background: #fff; box-shadow: 0 4px 12px rgba(0,0,0,0.04); display: flex; flex-direction: column;";

          // 3. 画面框与 Loading 状态
          var imgFrame = document.createElement("div");
          imgFrame.style.cssText =
            "width: 100%; aspect-ratio: " +
            cssRatio +
            "; background: #f5f5f7; position: relative; border-bottom: 1px solid var(--border-color); overflow: hidden;";

          var redrawBtn = document.createElement("button");
          redrawBtn.type = "button";
          redrawBtn.className = "btn-redraw-shot";
          redrawBtn.setAttribute("data-shot-index", String(i));
          redrawBtn.setAttribute("data-tab-index", String(sIdx));
          redrawBtn.textContent = "🔄 重绘";
          redrawBtn.title = "仅重绘本镜头";
          redrawBtn.style.cssText =
            "position: absolute; top: 8px; right: 8px; z-index: 3; padding: 4px 10px; font-size: 0.75rem; font-weight: 600; border: 1px solid rgba(0,0,0,0.12); border-radius: 8px; background: rgba(255,255,255,0.92); color: #333; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.08); backdrop-filter: blur(4px);";
          imgFrame.appendChild(redrawBtn);

          var loading = document.createElement("div");
          loading.className = "visual-shot-loading";
          loading.innerHTML = VISUAL_LOADING_HTML;
          loading.style.cssText =
            "position: absolute; inset:0; display:flex; align-items:center; justify-content:center; color: #666; font-size: 0.85rem; font-weight: 500; background: #eef2f5; z-index: 1;";
          imgFrame.appendChild(loading);

          var img = document.createElement("img");
          img.className = "visual-shot-img";
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
            renderCtx.drawPrompt = buildVisualDrawPrompt(shot, style, productName, sIdx, "dalle");
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

          // 5. 文本区：展示原汁原味剧本（洗稿仅发生在 buildVisualDrawPrompt → 生图 API）
          var content = document.createElement("div");
          content.style.cssText = "padding: 14px; flex: 1; display: flex; flex-direction: column;";

          var head = document.createElement("div");
          head.style.cssText = "display: flex; justify-content: space-between; font-weight: 600; font-size: 0.85rem; margin-bottom: 10px;";
          head.innerHTML = "<span>SHOT " + (i + 1) + "</span><span style='color: var(--blue); background: rgba(0,102,204,0.08); padding: 2px 8px; border-radius: 6px;'>" + escapeHtml(shot.duration || "-") + "s</span>";
          content.appendChild(head);

          var vis = document.createElement("div");
          vis.style.cssText = "font-size: 0.85rem; line-height: 1.5; color: var(--text); flex: 1;";
          vis.textContent = String(shot.visual || "").trim();
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

  // ================= 提示词弹窗渲染引擎 =================
  function openPromptModal(title, segments) {
    var modal = document.getElementById("prompt-display-modal");
    var titleEl = document.getElementById("prompt-modal-title");
    var contentEl = document.getElementById("prompt-modal-content");
    if (!modal || !titleEl || !contentEl) return;

    titleEl.textContent = title;
    contentEl.innerHTML = "";

    segments.forEach(function(seg, i) {
      var card = document.createElement("div");
      card.className = "prompt-card";

      var header = document.createElement("div");
      header.className = "prompt-card__header";

      var titleSpan = document.createElement("span");
      titleSpan.textContent = "SHOT " + (i + 1);

      var copyBtn = document.createElement("button");
      copyBtn.className = "btn-copy-icon";
      copyBtn.innerHTML = '📋 复制';
      copyBtn.onclick = function() {
        navigator.clipboard.writeText(seg.content).then(function() {
          var oldHtml = copyBtn.innerHTML;
          copyBtn.innerHTML = '✅ 已复制';
          copyBtn.style.color = '#34c759';
          copyBtn.style.borderColor = '#34c759';
          copyBtn.style.background = 'rgba(52, 199, 89, 0.08)';
          setTimeout(function() {
            copyBtn.innerHTML = oldHtml;
            copyBtn.style.color = '';
            copyBtn.style.borderColor = '';
            copyBtn.style.background = '';
          }, 2000);
        }).catch(function(err) {
          alert("复制失败：" + err);
        });
      };

      header.appendChild(titleSpan);
      header.appendChild(copyBtn);

      var body = document.createElement("div");
      body.className = "prompt-card__content";
      body.textContent = seg.content;

      card.appendChild(header);
      card.appendChild(body);
      contentEl.appendChild(card);
    });

    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
  }

  var closePromptBtn = document.getElementById("btn-close-prompt-modal");
  var promptModal = document.getElementById("prompt-display-modal");
  if (closePromptBtn && promptModal) {
    closePromptBtn.addEventListener("click", function() {
      promptModal.classList.remove("is-open");
      promptModal.setAttribute("aria-hidden", "true");
    });
    promptModal.addEventListener("click", function(e) {
      if (e.target === promptModal) {
        promptModal.classList.remove("is-open");
        promptModal.setAttribute("aria-hidden", "true");
      }
    });
  }

  function buildMidjourneyImagineLine(shot, style, productName, sIdx, mjSuffix) {
    var drawPrompt = buildVisualDrawPrompt(shot, style, productName, sIdx, "mj");
    return "/imagine prompt: " + drawPrompt + mjSuffix;
  }

  // ================= 导出 Midjourney 商业级提示词 =================
  function getMidjourneyArFromRatioSelect() {
    var ratioEl = document.getElementById("ratio-select");
    var ratioStr = ratioEl ? String(ratioEl.value || "") : "";
    var ar = "--ar 16:9";
    if (ratioStr.indexOf("9:16") !== -1) ar = "--ar 9:16";
    else if (ratioStr.indexOf("16:9") !== -1) ar = "--ar 16:9";
    else if (ratioStr.indexOf("21:9") !== -1) ar = "--ar 21:9";
    else if (ratioStr.indexOf("4:5") !== -1) ar = "--ar 4:5";
    else if (ratioStr.indexOf("2:3") !== -1) ar = "--ar 2:3";
    else if (ratioStr.indexOf("1:1") !== -1) ar = "--ar 1:1";
    return ar;
  }

  var btnCopyNanoBannerPrompt = document.getElementById("btnCopyNanoBannerPrompt");
  if (btnCopyNanoBannerPrompt) {
    btnCopyNanoBannerPrompt.addEventListener("click", function () {
      var data = window.__LAST_STORYBOARD_DATA__;
      if (!data || !data.length) return alert("暂无分镜数据，请先生成脚本。");

      var activeTabBtn = document.querySelector(".tab-btn.is-active");
      var sIdx = activeTabBtn ? parseInt(String(activeTabBtn.dataset.tab || "0"), 10) : 0;
      if (isNaN(sIdx) || sIdx < 0) sIdx = 0;

      var style = data[sIdx];
      if (!style || !Array.isArray(style.shots) || !style.shots.length) {
        return alert("当前脚本数据异常，无法提取提示词。");
      }

      var productEl = document.getElementById("product-input");
      var productName = (productEl && String(productEl.value || "").trim()) || "luxury product";

      var ar = getMidjourneyArFromRatioSelect();
      var mjSuffix = " --style raw --v 6.0 --q 2 " + ar;

      var segments = style.shots.map(function (shot, i) {
        return { content: buildMidjourneyImagineLine(shot, style, productName, sIdx, mjSuffix) };
      });

      openPromptModal("🎨 导出 Midjourney 商业级提示词", segments);
    });
  }

  var btnCopyOriginalNanoBanner = document.getElementById("btnCopyOriginalNanoBanner");
  if (btnCopyOriginalNanoBanner) {
    btnCopyOriginalNanoBanner.addEventListener("click", function () {
      var data = window.__LAST_STORYBOARD_DATA__;
      if (!data || !data.length) return alert("暂无分镜数据，请先生成脚本。");

      var activeTabBtn = document.querySelector(".tab-btn.is-active");
      var sIdx = activeTabBtn ? parseInt(String(activeTabBtn.dataset.tab || "0"), 10) : 0;
      if (isNaN(sIdx) || sIdx < 0) sIdx = 0;

      var style = data[sIdx];
      if (!style || !Array.isArray(style.shots) || !style.shots.length) {
        return alert("当前脚本数据异常，无法提取提示词。");
      }

      var productEl = document.getElementById("product-input");
      var productName = (productEl && String(productEl.value || "").trim()) || "luxury product";

      var segments = style.shots.map(function (shot, i) {
        var drawPrompt = buildVisualDrawPrompt(shot, style, productName, sIdx, "nano");
        return { content: drawPrompt };
      });

      openPromptModal("📝 导出 Nano Banner 提示词", segments);
    });
  }
})();
