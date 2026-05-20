/**
 * 无感智能版 — 行业隔离：单字工具词纠偏家居，专业词标题命中；多模态笔记本校准
 * 全类目词表后台静默补全，推断无 UI 提示
 */
(function (global) {
  try {
    var taxonomyGraph = {
    家居百货: ["刷", "刷子", "镜", "镜子", "靠垫", "垫", "枕", "座", "收纳", "伞", "架", "架子", "盒", "盒子", "具", "家具", "灯", "席", "桌", "椅", "床", "柜", "帘", "沙发", "茶几", "地毯", "装修", "五金", "毯"],

    美妆个护: ["化妆刷", "化妆镜", "化妆", "美容", "肤", "精华", "面膜", "洗护", "发", "香水", "洁面", "沐浴", "淋浴", "喷雾", "皂", "霜", "乳", "液", "膏", "粉", "美甲", "个护"],

    汽配养护: ["洗车刷", "洗车液", "机油", "汽车", "汽配", "保养", "记录仪", "清洗", "轮毂", "车用", "后视镜", "玻璃水", "胎", "雨刮", "内饰", "贴膜", "车膜", "泵"],

    办公美术: ["马克笔", "油画棒", "油画", "彩铅", "颜料", "画", "笔", "纸", "墨", "册", "文具", "素描", "水彩", "本子", "手账", "记事", "宣纸", "砚"],

    "3C数码": ["电脑", "手机", "平板", "耳机", "智能", "显示器", "相机", "充电", "数据线", "键鼠", "屏幕", "芯片", "数码"],

    服饰内衣: ["衬衫", "旗袍", "马面裙", "汉服", "西装", "衣", "衫", "裙", "袍", "裤", "装", "服", "领", "袖", "袜", "内衣", "帽", "巾", "穿", "戴", "饰", "丝绸"],

    鞋靴箱包: ["鞋", "靴", "包", "箱", "袋", "邮差包", "背包", "旅行箱", "手提包", "钱包", "凉鞋", "运动鞋", "皮具"],

    家用电器: ["吸尘器", "洗衣机", "冰箱", "空调", "电视", "破壁机", "加湿器", "扫地机", "微波炉", "家电", "净化器", "壶", "锅"],

    珠宝饰品: ["项链", "戒指", "钻", "金", "银", "珍珠", "翡翠", "首饰", "珠宝", "腕表", "手表", "机械表", "机芯", "钟表", "胸针", "玉", "玛瑙", "饰"],

    母婴玩具: ["婴", "娃", "童", "奶瓶", "尿布", "母婴", "玩具", "推车", "积木", "拼图", "安全座椅", "孕", "产", "模型"],

    食品饮料: ["食", "喝", "饮", "奶", "零食", "咖啡", "茶叶", "生鲜", "水果", "肉", "饮料", "坚果", "酒", "粮", "油"],

    运动户外: ["运", "动", "跑", "球", "健身", "瑜伽", "露营", "骑行", "户外", "帐篷", "垂钓", "鱼竿", "登山", "潜水"],

    工业工具: ["电钻", "五金", "轴承", "泵", "测量", "实验", "工具", "焊接", "零件", "扳手", "螺丝", "阀"],

    医疗保健: ["医", "药", "康", "补", "保健", "口罩", "按摩", "理疗", "维他命", "钙片", "血压计", "计生", "体温"],

    手工纺织: ["缝", "织", "绣", "针", "线", "裁剪", "缝纫机", "布", "绸", "丝", "面料", "里料", "纺织", "雪纺", "sewing"],

    乐器器材: ["琴", "吉他", "乐器", "钢琴", "鼓", "笛", "小提琴", "音响", "麦克风", "唱片", "节拍器"],

    宠物用品: ["猫", "狗", "宠", "粮", "砂", "罐", "爪", "牵引", "水族", "宠用"],

    生鲜园艺: ["花", "木", "苗", "种子", "肥料", "农药", "农具", "植物", "土壤"],
  };

  function containsText(text, k) {
    if (text == null || k == null || k === "") return false;
    var s = String(k);
    var p = String(text);
    // 关键词或正文任一侧含拉丁字母 → 大小写不敏感；纯中文 toLowerCase 为恒等
    if (/[a-zA-Z]/.test(s) || /[a-zA-Z]/.test(p)) {
      return p.toLowerCase().indexOf(s.toLowerCase()) !== -1;
    }
    return p.indexOf(s) !== -1;
  }

  function infer(opts) {
    opts = opts || {};
    var p = String(opts.productText || "").trim();
    var b = String(opts.briefText || "").trim();
    var hasImg = !!opts.hasImage;
    if (!p && !b) return "";

    var scores = [];
    var pb = p + b;

    for (var cat in taxonomyGraph) {
      if (!Object.prototype.hasOwnProperty.call(taxonomyGraph, cat)) continue;
      var keywords = taxonomyGraph[cat];
      var score = 0;
      var i;

      for (i = 0; i < keywords.length; i++) {
        var k = keywords[i];
        if (containsText(p, k)) {
          score += k.length > 1 ? 20 : 10;
        }
      }

      /* 排除：产品名含「表」且类目字段含「机」（如机械表）→ 禁止归入 3C */
      if (cat === "3C数码") {
        var catHint = String(opts.categoryText || "").trim();
        if (containsText(p, "表") && catHint.indexOf("机") !== -1) {
          score = 0;
        }
      }

      /* 钟表 / 奢侈品语境：压制「机械×手表」误归 3C（关键词「相机」等仍可能命中） */
      if (/(机械表|腕表|机芯|手表|钟表|玑镂|表圈|陀飞轮)/.test(pb)) {
        if (cat === "珠宝饰品") score += 65;
        if (cat === "3C数码") score = Math.floor(score * 0.2);
      }

      if (cat === "汽配养护" && /[画笔纸]/.test(p)) {
        score = 0;
      }
      if (cat === "办公美术" && /[电脑充]/.test(p)) {
        score = 0;
      }

      if (/^(刷|刷子|镜|镜子|架|架子|盒|盒子)$/.test(p) && cat !== "家居百货") {
        score -= 30;
      }

      if (pb.indexOf("笔记本") !== -1) {
        if (cat === "3C数码") {
          score += hasImg ? 50 : 5;
        }
        if (cat === "办公美术") {
          score += hasImg ? 0 : 45;
        }
      }

      if (score > 0) {
        scores.push({ name: cat, score: score });
      }
    }

    scores.sort(function (a, b2) {
      return b2.score - a.score;
    });
    return scores.length > 0 ? scores[0].name : "通用类目";
  }

  global.EcommerceTaxonomy = {
    infer: infer,
    getAllCategories: function () {
      return Object.keys(taxonomyGraph).concat(["通用类目"]);
    },
  };
  } catch (err) {
    console.warn("[EcommerceTaxonomy] 初始化失败，已使用安全占位实现。", err);
    global.EcommerceTaxonomy = {
      infer: function () {
        return "";
      },
      getAllCategories: function () {
        return [];
      },
    };
  }
})(typeof window !== "undefined" ? window : this);
