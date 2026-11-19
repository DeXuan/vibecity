/* VibeCity · 04 城市生成器
   数据 → 空间：13 分类街区（4x4 网格，中心广场），
   每项目一栋楼（InstancedMesh），高度=f(票数,评分)，程序化窗灯纹理，
   Top 票楼顶 beacon 光柱，道路/路灯/广场纪念碑。 */
"use strict";

/* 分类色板（街区主题色） */
const VB_CAT_COLORS = {
  "生活": "#e8926f", "校园": "#6fa8dc", "游戏": "#b58ad4", "社交": "#f2a2c0",
  "健身": "#7bc96f", "公益": "#e8c96f", "户外": "#5fb8a8", "K12": "#f2926f",
  "研发": "#6f8fe8", "个人效率": "#a8d46f", "学习科研": "#d4a86f",
  "面试、路演": "#c96fa8", "纪念代码": "#8ac9d4", "其他": "#9aa4b8",
};

/* 全局城市模型 */
VB.city = {
  group: null, blocks: [],           // 每个 block: {cat, mesh, ids:[projIdx], pos}
  beacons: null, ground: null, roads: null,
  neon: false,
  size: 0,
};

/* 程序化窗灯纹理：白天=玻璃格，霓虹=亮窗矩阵（同一纹理，靠 emissive 切换） */
VB.windowTexture = function () {
  const S = 256, cols = 8, rows = 12;
  const c = document.createElement("canvas"); c.width = c.height = S;
  const g = c.getContext("2d");
  g.fillStyle = "#1a1f2b"; g.fillRect(0, 0, S, S);
  const cw = S / cols, ch = S / rows;
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      const lit = Math.random() < 0.42;
      const pad = 3;
      if (lit) {
        const warm = Math.random();
        g.fillStyle = warm < 0.7 ? "rgba(255,214,140,0.95)" : warm < 0.9 ? "rgba(180,220,255,0.9)" : "rgba(255,170,120,0.9)";
      } else {
        g.fillStyle = "rgba(48,56,74,0.9)";
      }
      g.fillRect(k * cw + pad, r * ch + pad, cw - pad * 2, ch - pad * 2);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
};

/* ═══ 语义主题聚类：按名称+简介关键词归类，同一街区内相似项目相邻排列 ═══
   目标：让「工具箱」街区纵深处自然形成「记账带」「日程带」「学习带」。 */
/* 顺序即优先级：高辨识度主题词在前，泛化词（打卡/计划/清单）放后，
   避免「背单词打卡」被泛化的「打卡」抢走分类。 */
const VB_SEMANTIC = [
  /* 顺序即优先级：专项高辨识词在前，泛化词在后 */
  { id: "学习答题", re: /背单词|单词|题库|刷题|复习|考试|课程|教育|知识|学习|考点|作业|论文|文献|科研/ },
  { id: "记账理财", re: /记账|计息|账单|预算|理财|支出|收入|开销|借贷|报销|发票|税|工资|股票|基金|保险/ },
  { id: "运动健康", re: /健身|跑步|骑行|热量|体重|饮食|睡眠|健康|步数|卡路里|运动|瑜伽|拉伸|体检|用药|心理/ },
  { id: "二手交易", re: /二手|买卖|租借|置换|捐赠|招领|失物|书市|闲置|交易|拼购|团购|优惠|比价/ },
  { id: "地图出行", re: /地图|路线|导航|定位|通勤|地铁|公交|停车|附近|出行|航班|火车|旅行|旅游|景点|酒店/ },
  { id: "游戏娱乐", re: /剧本杀|推理|闯关|养成|抽卡|对战|像素|游戏|互动|桌游|棋|谜|答题闯关/ },
  { id: "视觉图表", re: /可视化|图表|看板|大屏|报表|排行|统计|分析|数据|仪表盘|曲线/ },
  { id: "AI 助手", re: /AI|大模型|GPT|问答|生成|识别|语音|智能|助手|提示词|对话|Agent/ },
  { id: "内容创作", re: /写作|笔记|博客|小说|绘本|排版|剪辑|图片|音乐|创作|文案|字幕|海报|配图/ },
  { id: "校园教务", re: /课表|点名|考勤|作业|班级|社团|学分|答辩|校园|宿舍|食堂|校历/ },
  { id: "社交搭子", re: /搭子|社交|匹配|交友|组队|拼单|拼饭|社区|论坛|聊天|约|同城/ },
  { id: "日程待办", re: /待办|日程|日历|提醒|倒计时|番茄|专注|打卡|计划|清单|习惯/ },
  { id: "美食烹饪", re: /菜谱|食谱|做饭|烹饪|外卖|餐厅|咖啡|奶茶|烘焙|调味|食材/ },
  { id: "宠物照护", re: /宠物|猫|狗|铲屎|喂养|驱虫|疫苗|领养/ },
  { id: "家居生活", re: /家居|装修|收纳|清洁|家务|租房|物业|维修|菜园|阳台/ },
  { id: "硬件数码", re: /硬件|装机|显卡|主板|树莓派|Arduino|单片机|路由|NAS|服务器|DIY|传感器/ },
  { id: "影音摄影", re: /摄影|相机|修图|滤镜|视频|剪辑|播放器|音乐|歌单|影视|字幕组/ },
  { id: "招聘求职", re: /招聘|求职|简历|面试|offer|实习|岗位|HR|内推/ },
  { id: "公益志愿", re: /公益|志愿|捐|救助|帮扶|环保|低碳|碳排|回收|动保/ },
  { id: "适老无障碍", re: /适老|老人|老年|无障碍|视障|听障|残障|辅助|大字|语音播报/ },
  { id: "儿童教育", re: /儿童|幼儿|亲子|宝宝|小学|早教|绘本|童话|拼音|识字/ },
  { id: "法律政务", re: /法律|合同|律师|诉讼|政务|办事|证件|社保|公积金|政策/ },
  { id: "经营管理", re: /经营|门店|库存|进销存|客户|CRM|订单|供应链|排班|绩效/ },
  { id: "数据采集", re: /爬虫|采集|抓取|监控|告警|日志|埋点|API|接口/ },
  { id: "效率工具", re: /转换|格式化|压缩|批量|快捷|自动化|脚本|剪贴板|截图|OCR|二维码/ },
  { id: "其他", re: /$/ }
];
VB.semanticGroup = function (item) {
  const name = item.n || "";
  const text = name + " " + (item.t || "") + " " + (item.c || "");
  for (const g of VB_SEMANTIC) if (g.id !== "其他" && g.re.test(text)) return g.id;
  /* 兜底 1：英文/数字命名 → 多为工具类 */
  if (/^[A-Za-z0-9\s_\-\.]+$/.test(name)) return "效率工具";
  /* 兜底 2：名称含工具动词/名词 → 效率工具 */
  if (/管理|系统|工具|助手|生成|查询|计算|统计|记录|提醒|转换|整理|分析|追踪|助手|平台/.test(text)) return "效率工具";
  /* 兜底 3：含「小/一/妙」等中式命名或较长描述 → 其他（保留） */
  return "其他";
};

/* 楼高度映射：票数为主 + 评分加成 */
VB.buildingHeight = function (it) {
  const v = it.v || 0, r = it.r || 0;
  return Math.min(64, 7 + Math.sqrt(v) * 1.9 + r * 2.4);
};

/* 城市布局：13 街区排 4x4 网格（跳过中心 2 格做广场），返回每街区原点 */
VB.layoutBlocks = function (cats) {
  const catsSorted = cats.slice().sort((a, b) => b.count - a.count); // 大街区居中
  const gridPos = [];
  for (let gx = 0; gx < 4; gx++) for (let gz = 0; gz < 4; gz++) {
    if ((gx === 1 || gx === 2) && (gz === 1 || gz === 2)) continue; // 中心广场
    gridPos.push([gx, gz]);
  }
  // 街区尺寸：按最大楼数给网格
  const BLOCK = 150, STREET = 14;
  const origin = { x: -1.5 * (BLOCK + STREET), z: -1.5 * (BLOCK + STREET) };
  const layout = {};
  catsSorted.forEach((c, i) => {
    const [gx, gz] = gridPos[i % gridPos.length];
    layout[c.name] = {
      ox: origin.x + gx * (BLOCK + STREET) + BLOCK / 2,
      oz: origin.z + gz * (BLOCK + STREET) + BLOCK / 2,
      w: BLOCK, d: BLOCK,
    };
  });
  return layout;
};

/* 城市构建主入口 */
VB.createCity = function () {
  const data = window.VB_DATA || [];
  const g = new THREE.Group();
  const city = VB.city;
  city.group = g;
  city.size = 4 * 150 + 3 * 14 + 40;

  /* ---- 分组街区 ---- */
  const byCat = {};
  data.forEach((it, i) => {
    (byCat[it.c] = byCat[it.c] || []).push({ it, idx: i });
  });
  const cats = Object.keys(byCat).map(name => ({ name, count: byCat[name].length }));
  const layout = VB.layoutBlocks(cats);

  const winTex = VB.windowTexture();
  const cityMats = [];

  cats.forEach(({ name }) => {
    /* 语义排序：同组相邻 → 街区内形成"产业带"；组内按票数降序 */
    const list = byCat[name].slice().sort((a, b) => {
      const ga = VB.semanticGroup(a.it), gb = VB.semanticGroup(b.it);
      if (ga !== gb) return ga < gb ? -1 : 1;
      return (b.it.v || 0) - (a.it.v || 0);
    });
    const L = layout[name];
    const color = new THREE.Color(VB_CAT_COLORS[name] || "#9aa4b8");
    /* 街区内网格排楼：cols 根据楼数自适应 */
    const cols = Math.ceil(Math.sqrt(list.length));
    const cell = L.w / (cols + 1);
    /* 每栋楼的变换矩阵 */
    const mats = [];
    const projIdx = [];
    list.forEach(({ it, idx }, k) => {
      const gx = k % cols, gz = Math.floor(k / cols);
      const jitter = cell * 0.18;
      const x = L.ox - L.w / 2 + cell * (gx + 1) + VB.rand(-jitter, jitter);
      const z = L.oz - L.w / 2 + cell * (gz + 1) + VB.rand(-jitter, jitter);
      const h = VB.buildingHeight(it);
      const w = Math.min(cell * 0.62, 9);
      const d = Math.min(cell * 0.62, 9);
      const rot = VB.rand(-0.04, 0.04);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rot, 0));
      m.compose(new THREE.Vector3(x, h / 2, z), q, new THREE.Vector3(w, h, d));
      mats.push(m);
      projIdx.push(idx);
      VB.projPos[idx] = { x, z, h, cat: name };  /* 拾取/搜索/beacon 统一索引 */
    });
    /* 一个街区一个 InstancedMesh（BoxGeometry 顶点在 ±0.5，y 需归一到 0..1） */
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    boxGeo.translate(0, 0.5, 0); // 底面在 y=0
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff, emissive: 0xffffff, emissiveMap: winTex,
      emissiveIntensity: 0.0, roughness: 0.78, metalness: 0.06,
    });
    cityMats.push(mat);
    const inst = new THREE.InstancedMesh(boxGeo, mat, mats.length);
    mats.forEach((m, i) => inst.setMatrixAt(i, m));
    /* per-instance 颜色：分类色 × 明度微扰 */
    const cTmp = new THREE.Color();
    mats.forEach((m, i) => {
      cTmp.copy(color).offsetHSL(0, 0, VB.rand(-0.06, 0.06));
      inst.setColorAt(i, cTmp);
    });
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    inst.castShadow = false; inst.receiveShadow = false;
    inst.frustumCulled = false;
    g.add(inst);
    const groups = {};
    list.forEach(({ it }) => { const g = VB.semanticGroup(it); groups[g] = (groups[g] || 0) + 1; });
    city.blocks.push({ cat: name, mesh: inst, projIdx, layout: L, targets: mats, groups });
  });

  /* ---- 地面 ---- */
  const groundGeo = new THREE.PlaneGeometry(city.size * 1.4, city.size * 1.4);
  groundGeo.rotateX(-Math.PI / 2);
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x2e3547, roughness: 0.95 });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.position.y = -0.05;
  ground.receiveShadow = false;
  g.add(ground);
  city.ground = ground;

  /* ---- 道路：街区之间的十字网格线（发暗条带） ---- */
  const roadMat = new THREE.MeshStandardMaterial({ color: 0x3a4156, roughness: 0.9 });
  const roads = new THREE.Group();
  const span = 4 * 150 + 3 * 14;
  for (let i = 0; i <= 4; i++) {
    const p = -1.5 * (150 + 14) - 75 + i * (150 + 14) - 7;
    const r1 = new THREE.Mesh(new THREE.PlaneGeometry(span + 60, 12), roadMat);
    r1.rotation.x = -Math.PI / 2; r1.position.set(0, 0.02, p); roads.add(r1);
    const r2 = new THREE.Mesh(new THREE.PlaneGeometry(12, span + 60), roadMat);
    r2.rotation.x = -Math.PI / 2; r2.position.set(p, 0.02, 0); roads.add(r2);
  }
  g.add(roads);
  city.roads = roads;

  /* ---- 中心广场：纪念碑 + 环形灯 ---- */
  const mon = new THREE.Group();
  const stele = new THREE.Mesh(new THREE.BoxGeometry(16, 22, 16),
    new THREE.MeshStandardMaterial({ color: 0x2c3448, roughness: 0.7, metalness: 0.25 }));
  stele.position.y = 11; mon.add(stele);
  const crown = new THREE.Mesh(new THREE.OctahedronGeometry(6),
    new THREE.MeshStandardMaterial({ color: 0xffd98e, emissive: 0xffc35e, emissiveIntensity: 1.4, roughness: 0.3 }));
  crown.position.y = 27; mon.add(crown);
  VB.city.crown = crown;
  /* 环形光带 */
  const ring = new THREE.Mesh(new THREE.TorusGeometry(34, 0.5, 8, 64),
    new THREE.MeshStandardMaterial({ color: 0x6fa8ff, emissive: 0x5f9aff, emissiveIntensity: 1.1 }));
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.4; mon.add(ring);
  g.add(mon);

  /* ---- 楼顶装饰：天线 + 水塔（实例化，仅 2 个 draw call） ---- */
  const roofData = [];
  (VB.city.blocks || []).forEach(blk => {
    blk.projIdx.forEach((pidx, ii) => {
      const p = VB.projPos[pidx];
      if (!p) return;
      /* 高楼更可能带天线，矮楼带水塔，随机分布 ~45% */
      if (Math.random() > 0.55) return;
      roofData.push({ x: p.x, z: p.z, y: p.h, tall: p.h > 22 });
    });
  });
  if (roofData.length) {
    const ant = roofData.filter(r => r.tall);
    const tanks = roofData.filter(r => !r.tall);
    const mkInst = (geo, mat, list, scaleFn) => {
      const inst = new THREE.InstancedMesh(geo, mat, list.length);
      const m = new THREE.Matrix4();
      list.forEach((r, i) => {
        const s = scaleFn(r);
        m.compose(new THREE.Vector3(r.x, r.y, r.z), new THREE.Quaternion(), new THREE.Vector3(s.s, s.h, s.s));
        inst.setMatrixAt(i, m);
      });
      inst.frustumCulled = false;
      return inst;
    };
    if (ant.length) {
      /* 天线：细高圆柱，底部在楼顶 → 几何体上移半高 */
      const ag = new THREE.CylinderGeometry(0.18, 0.28, 1, 5);
      ag.translate(0, 0.5, 0); /* 归一到底面在 0，实例用高度缩放 */
      const am = new THREE.MeshStandardMaterial({ color: 0x8a93a8, roughness: 0.6, metalness: 0.5 });
      g.add(mkInst(ag, am, ant, r => ({ s: 1, h: 6 + (r.y % 7) })));
    }
    if (tanks.length) {
      /* 水塔：矮胖圆柱 */
      const tg = new THREE.CylinderGeometry(0.5, 0.5, 1, 6);
      tg.translate(0, 0.5, 0);
      const tm = new THREE.MeshStandardMaterial({ color: 0x6a7386, roughness: 0.85 });
      g.add(mkInst(tg, tm, tanks, r => ({ s: 1.6 + (r.y % 3) * 0.2, h: 2.2 })));
    }
  }

  /* ---- Top 票 beacon 光柱 ---- */
  const top = data.map((it, i) => ({ it, i })).sort((a, b) => (b.it.v || 0) - (a.it.v || 0)).slice(0, 60);
  const beamGeo = new THREE.CylinderGeometry(0.6, 0.6, 60, 6, 1, true);
  beamGeo.translate(0, 30, 0);
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xffe2a8, transparent: true, opacity: 0.16,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const beams = new THREE.InstancedMesh(beamGeo, beamMat, top.length);
  const bPos = []; // 记录 beacon 位置用于拾取跳转
  top.forEach(({ it, i }, k) => {
    const pos = VB.projPos[i];
    if (!pos) return;
    const m = new THREE.Matrix4().setPosition(pos.x, 0, pos.z);
    beams.setMatrixAt(k, m);
    bPos.push({ idx: i, pos });
  });
  beams.count = bPos.length;
  beams.frustumCulled = false;
  g.add(beams);
  city.beacons = { mesh: beams, list: bPos };

  /* ---- 记录每栋楼位置（拾取/跳转/beacon 用） ---- */
  city.cityMats = cityMats;
  return g;
};

/* 位置索引在 createCity 内落楼时直接记录（保证与渲染一致） */
VB.projPos = {};

/* 霓虹/白昼切换 */
VB.setNeon = function (on) {
  VB.city.neon = !!on;
  const mats = VB.city.cityMats || [];
  mats.forEach(m => { m.emissiveIntensity = on ? 1.15 : 0.0; m.needsUpdate = true; });
  const beamMat = VB.city.beacons && VB.city.beacons.mesh.material;
  if (beamMat) beamMat.opacity = on ? 0.3 : 0.14;
  if (VB.city.ground) VB.city.ground.material.color.set(on ? 0x10131f : 0x2e3547);
  if (VB.city.roads) VB.city.roads.children.forEach(r => r.material.color.set(on ? 0x1a2030 : 0x3a4156));
};

/* ═══ 城市生长动画：楼体从地面长到目标高度 ═══
   做法：把每个实例矩阵的缩放 y 从 0 插值到目标值（实例化，零额外 draw call）。
   与「重建城市」相比，视觉上是同一座城市在生长，适合首次入城与数据刷新。 */
VB.cityGrow = {
  active: false, t: 0, dur: 2.4,
  start() {
    const c = VB.city;
    if (!c || !c.blocks || !c.blocks.length) return;
    if (VB.lowPerf) return; /* 低配跳过动画，直接终态 */
    /* 记录每个实例的位置与目标缩放 */
    const m4 = new THREE.Matrix4();
    const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
    c.blocks.forEach(blk => {
      blk._grow = [];
      blk.targets.forEach((mat, i) => {
        mat.decompose(pos, quat, scl);
        blk._grow.push({ x: pos.x, y: pos.y, z: pos.z, qx: quat.x, qy: quat.y, qz: quat.z, qw: quat.w, sx: scl.x, sy: scl.y, sz: scl.z });
      });
    });
    this.active = true;
    this.t = 0;
    /* 初始：高度压到 0（楼体贴地平躺 → 视觉即"未建成"） */
    this.apply(0);
  },
  apply(k) {
    const c = VB.city;
    const m4 = new THREE.Matrix4();
    const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
    c.blocks.forEach(blk => {
      if (!blk._grow) return;
      blk._grow.forEach((g, i) => {
        const h = Math.max(0.001, g.sy * k);          /* y 缩放从 0 → 目标 */
        pos.set(g.x, h / 2, g.z);                     /* 底面始终贴地：中心随高度上移 */
        quat.set(g.qx, g.qy, g.qz, g.qw);
        scl.set(g.sx, h, g.sz);
        m4.compose(pos, quat, scl);
        blk.mesh.setMatrixAt(i, m4);
      });
      blk.mesh.instanceMatrix.needsUpdate = true;
    });
  },
  tick(dt) {
    if (!this.active) return;
    this.t += dt;
    let k = this.t / this.dur;
    if (k >= 1) { k = 1; this.active = false; }
    /* easeOutCubic：先快后慢，像被建起来 */
    const e = 1 - Math.pow(1 - k, 3);
    this.apply(e);
  },
  /* 数据刷新后「原地长高」：旧高度 → 新高度（用于定时刷新场景） */
  regrow(dur) {
    this.dur = dur || 1.6;
    this.start();
  }
};
