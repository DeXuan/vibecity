/* VibeCity · 06 UI：启动页 / HUD / 项目卡 / 搜索 / 排行榜 */
"use strict";

VB.ui = {};

/* 启动页 */
VB.ui.buildBoot = function () {
  const boot = VB.$("#boot");
  const data = window.VB_DATA || [];
  const totalVotes = data.reduce((s, x) => s + (x.v || 0), 0);
  boot.innerHTML = `
    <div class="starfield" aria-hidden="true"></div>
    <div class="brand"><h1>VibeCity</h1><em>码上创之城</em></div>
    <div class="tagline">每一份投稿，都是一座楼</div>
    <div class="stats"><span><b>${data.length}</b>栋灵感之楼</span><span><b>${totalVotes}</b>总人气票</span><span><b>${new Set(data.map(x => x.c)).size}</b>个主题街区</span></div>
    <div class="inbox">
      <input class="q" id="searchInput" maxlength="30" placeholder="搜项目名，飞到它的楼…" autocomplete="off">
      <div class="row">
        <button class="btn btn-main" id="enterBtn">入 城</button>
        <button class="btn btn-ghost" id="rankBtn">🏅 人气榜</button>
      </div>
      <div class="hint">拖拽旋转 · 滚轮缩放 · 点击楼宇看项目 · <b>霓虹夜景</b>一键切换</div>
    </div>
    <div class="cats" id="catLegend"></div>`;
  /* 分类图例 */
  const legend = VB.$("#catLegend");
  Object.keys(VB_CAT_COLORS).forEach(c => {
    const n = (window.VB_DATA || []).filter(x => x.c === c).length;
    if (!n) return;
    const i = document.createElement("i");
    i.className = "cat-chip";
    i.innerHTML = `<u style="background:${VB_CAT_COLORS[c]}"></u>${VB.escapeHtml(c)}·${n}`;
    legend.appendChild(i);
  });
  VB.$("#enterBtn").addEventListener("click", () => VB.enterCity());
  VB.$("#rankBtn").addEventListener("click", () => { VB.enterCity(); setTimeout(() => VB.ui.toggleRank(true), 600); });
  VB.$("#searchInput").addEventListener("keydown", e => {
    if (e.key === "Enter") { VB.enterCity(); setTimeout(() => VB.ui.search(VB.$("#searchInput").value), 600); }
  });
  /* 星空 */
  const sf = VB.$(".starfield");
  let stars = "";
  for (let i = 0; i < 50; i++) {
    stars += `<i style="left:${(i * 37 + 13) % 100}%;top:${(i * 61 + 7) % 100}%;--dur:${(2 + i % 5 * .7).toFixed(1)}s;--op:${(0.25 + i % 4 * .18).toFixed(2)};animation-delay:${(i % 7) * .3}s"></i>`;
  }
  sf.innerHTML = stars;
};

/* HUD */
VB.ui.buildHud = function () {
  const app = VB.$("#app");
  app.innerHTML = `
  <div id="cinema" aria-hidden="true"></div>
  <div id="hud">
    <div class="corner" id="ctl">
      <div class="g">
        <button class="ctlbtn primary" id="viewBtn" title="航拍 / 漫游">🛸 航拍</button>
        <button class="ctlbtn" id="neonBtn" title="白昼 / 霓虹夜景">🌆 霓虹</button>
        <button class="ctlbtn" id="searchBtn" title="搜索项目">🔍</button>
        <button class="ctlbtn" id="rankBtn2" title="人气榜">🏅</button>
        <button class="ctlbtn" id="listBtn" title="项目列表（键盘可操作）" aria-label="项目列表">📋</button>
        <button class="ctlbtn" id="distBtn" title="街区导览">🗺</button>
        <button class="ctlbtn" id="helpBtn" title="操作说明">❔</button>
        <button class="ctlbtn" id="homeBtn" title="回到入口">🏠</button>
      </div>
    </div>
    <div class="corner" id="brandTag"><b>VibeCity</b><span id="brandSub">码上创之城</span></div>
    <div class="corner" id="timeBar">
      <span id="todLabel">清晨</span>
      <input type="range" id="todRng" min="0" max="100" value="32" aria-label="时间">
      <button class="todBtn" id="flowBtn" title="昼夜自动流动">⏸</button>
    </div>
    <div class="corner" id="distNav" class="hide"><div id="distChips"></div></div>
    <div id="joy" class="hide"><div class="joy-base"><div class="joy-knob"></div></div></div>
  </div>
  <div id="searchBox" class="hide"><input id="searchInput2" maxlength="30" placeholder="搜项目名，回车飞行定位…"><button id="searchGo">飞</button></div>
  <div id="projCard" class="hide"></div>
  <div id="rankPanel" class="hide"><div class="rp-head"><b>🏅 人气榜 Top 20</b><button id="rankClose">✕</button></div><div id="rankList"></div></div>
  <div id="listPanel" class="hide" role="dialog" aria-modal="true" aria-label="项目列表"><div class="lp-head"><b>📋 全部项目</b><input id="lpSearch" placeholder="筛选…" aria-label="筛选项目"><button id="lpClose" aria-label="关闭">✕</button></div><div id="lpRows" role="listbox" aria-label="项目条目"></div><div class="lp-foot" id="lpFoot"></div></div>
  <div id="srLive" class="sr-only" role="status" aria-live="polite"></div>
  <div id="toast"></div>`;

  VB.$("#viewBtn").addEventListener("click", e => {
    if (VB.cam.mode === "orbit") {
      VB.setWalk();
      e.currentTarget.textContent = "🚶 漫游";
      VB.toast("漫游模式：WASD 走动 · 空格跳 · Esc 回航拍");
    } else { VB.setOrbit(); e.currentTarget.textContent = "🛸 航拍"; }
    if (VB.ui.syncJoystick) VB.ui.syncJoystick();
    VB.savePrefs();
  });
  VB.$("#neonBtn").addEventListener("click", e => {
    const on = !VB.city.neon;
    VB.setNeon(on);
    VB.sky && VB.sky._setNeon(on);
    e.currentTarget.textContent = on ? "☀ 白昼" : "🌆 霓虹";
    e.currentTarget.classList.toggle("on", on);
    if (VB.scene.fog) VB.scene.fog.color.set(on ? 0x0c0f1c : 0xbfd0dc);
    VB.toast(on ? "霓虹夜景 · 灵感点亮城市" : "白昼模式");
    VB.savePrefs();
  });
  /* 时间滑杆：手动调昼夜 */
  const todRng = VB.$("#todRng"), todLabel = VB.$("#todLabel");
  const todName = v => v < 0.18 ? "深夜" : v < 0.35 ? "清晨" : v < 0.62 ? "正午" : v < 0.84 ? "黄昏" : "深夜";
  const applyTod = v => {
    VB.tod = Math.max(0, Math.min(1, v));
    if (VB.sky && VB.sky._applyTime) VB.sky._applyTime(VB.tod);
    const day = Math.sin(VB.tod * Math.PI);
    if (VB.hemiLight) VB.hemiLight.intensity = 0.55 + day * 0.75;
    if (VB.dirLight) VB.dirLight.intensity = 0.35 + day * 1.5;
    if (VB.scene.fog && !VB.city.neon) VB.scene.fog.color.set(day > 0.5 ? 0xbfd0dc : 0x1c2236);
    todLabel.textContent = todName(VB.tod);
    todRng.value = Math.round(VB.tod * 100);
  };
  todRng.addEventListener("input", e => {
    VB.timeFlow = false; VB.$("#flowBtn").textContent = "▶";
    applyTod(+e.target.value / 100);
    VB.savePrefs();
  });
  VB.$("#flowBtn").addEventListener("click", e => {
    VB.timeFlow = !VB.timeFlow;
    e.currentTarget.textContent = VB.timeFlow ? "⏸" : "▶";
    VB.toast(VB.timeFlow ? "昼夜自动流动已开启（一轮约 52 秒）" : "时间已冻结");
    VB.savePrefs();
  });
  VB.ui.applyTod = applyTod;

  /* ═══ 项目列表视图（无障碍 + 键盘可达） ═══ */
  VB.ui.list = { open: false, cursor: -1, rows: [], filter: "" };
  const lp = () => VB.$("#listPanel");
  VB.ui.srSay = msg => {
    const el = VB.$("#srLive");
    if (el) el.textContent = msg;
  };
  VB.ui.renderList = function () {
    const q = VB.ui.list.filter.trim();
    const data = window.VB_DATA || [];
    let idxs = data.map((x, i) => i);
    if (q) idxs = idxs.filter(i => (data[i].n || "").includes(q) || (data[i].t || "").includes(q) || (data[i].c || "").includes(q));
    /* 上限 300 条，避免 DOM 过重 */
    const shown = idxs.slice(0, 300);
    VB.ui.list.rows = shown;
    const box = VB.$("#lpRows");
    box.innerHTML = shown.map((i, k) => {
      const x = data[i];
      return `<div class="lp-row" role="option" tabindex="${k === 0 ? 0 : -1}" data-i="${i}" data-k="${k}"
        aria-label="${VB.escapeHtml(x.n)}，${VB.escapeHtml(x.c)}，${x.v || 0} 票">
        <u style="background:${VB_CAT_COLORS[x.c] || "#9aa4b8"}"></u>
        <b>${VB.escapeHtml(x.n)}</b>
        <span>${VB.escapeHtml(x.c)} · ${x.v || 0}票</span>
      </div>`;
    }).join("");
    VB.ui.list.cursor = shown.length ? 0 : -1;
    VB.$("#lpFoot").textContent = shown.length
      ? `共 ${idxs.length} 项${idxs.length > 300 ? "（显示前 300）" : ""} · ↑↓ 移动 · Enter 定位 · Esc 关闭`
      : "无匹配项目";
    box.querySelectorAll(".lp-row").forEach(row => {
      row.addEventListener("click", () => VB.ui.listGo(+row.dataset.i));
    });
    if (shown.length) VB.ui.srSay("列表已加载，" + idxs.length + " 个项目");
  };
  VB.ui.listGo = function (idx) {
    VB.ui.listClose();
    VB.flyToBuilding(idx);
    setTimeout(() => VB.ui.showProj(idx), 1700);
    VB.ui.srSay("已定位到项目");
  };
  VB.ui.listOpen = function () {
    /* 若仍在启动页，先入城，否则 #app 隐藏导致面板不可聚焦 */
    const app = VB.$("#app");
    if (app && app.classList.contains("hide")) {
      if (VB.enterCity) VB.enterCity();
    }
    VB.ui.list.open = true;
    lp().classList.remove("hide");
    if (!VB.$("#lpRows").dataset.filled) { VB.ui.renderList(); VB.$("#lpRows").dataset.filled = "1"; }
    /* 延迟一帧聚焦：等样式生效（display 从 none 切换为 flex） */
    requestAnimationFrame(() => {
      const first = VB.$("#lpRows .lp-row");
      if (first) { first.tabIndex = 0; first.focus(); }
    });
  };
  VB.ui.listClose = function () {
    VB.ui.list.open = false;
    lp().classList.add("hide");
  };
  VB.ui.listMove = function (dir) {
    const rows = Array.from(VB.$("#lpRows").querySelectorAll(".lp-row"));
    if (!rows.length) return;
    VB.ui.list.cursor = Math.max(0, Math.min(rows.length - 1, VB.ui.list.cursor + dir));
    rows.forEach((r, k) => { r.tabIndex = k === VB.ui.list.cursor ? 0 : -1; });
    const cur = rows[VB.ui.list.cursor];
    cur.focus();
    const x = (window.VB_DATA || [])[+cur.dataset.i];
    if (x) VB.ui.srSay(x.n + "，" + x.c);
  };
  VB.$("#listBtn").addEventListener("click", () => { VB.ui.list.open ? VB.ui.listClose() : VB.ui.listOpen(); });
  VB.$("#lpClose").addEventListener("click", () => VB.ui.listClose());
  VB.$("#lpSearch").addEventListener("input", VB.debounce(e => {
    VB.ui.list.filter = e.target.value;
    VB.ui.renderList();
  }, 160));
  VB.$("#listPanel").addEventListener("keydown", e => {
    if (e.key === "ArrowDown") { e.preventDefault(); VB.ui.listMove(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); VB.ui.listMove(-1); }
    else if (e.key === "Enter") {
      const cur = VB.$("#lpRows .lp-row[tabindex='0']");
      if (cur) VB.ui.listGo(+cur.dataset.i);
    }
  });

  /* 街区导览：按分类飞行 */
  VB.$("#distBtn").addEventListener("click", () => {
    const box = VB.$("#distChips");
    if (!box.dataset.filled) {
      const counts = {};
      (window.VB_DATA || []).forEach(x => counts[x.c] = (counts[x.c] || 0) + 1);
      box.innerHTML = Object.keys(VB_CAT_COLORS).filter(c => counts[c])
        .map(c => `<button class="distChip" data-cat="${VB.escapeHtml(c)}"><u style="background:${VB_CAT_COLORS[c]}"></u>${VB.escapeHtml(c)}·${counts[c]}</button>`).join("");
      box.dataset.filled = "1";
      box.querySelectorAll(".distChip").forEach(b => b.addEventListener("click", () => VB.ui.flyToCategory(b.dataset.cat)));
    }
    VB.$("#distNav").classList.toggle("show");
  });

  /* 帮助 */
  VB.$("#helpBtn").addEventListener("click", () => {
    let h = VB.$("#helpPanel");
    if (h) { h.classList.toggle("show"); return; }
    h = document.createElement("div");
    h.id = "helpPanel"; h.className = "show";
    h.innerHTML = `<div class="hp-head"><b>操作指南</b><button id="hpClose">✕</button></div>
      <div class="hp-row"><kbd>拖拽</kbd> 旋转视角 · <kbd>滚轮</kbd> 缩放 · <kbd>右键拖</kbd> 平移</div>
      <div class="hp-row"><kbd>单击楼宇</kbd> 查看项目 · <kbd>🔍</kbd> 搜索飞行定位</div>
      <div class="hp-row"><kbd>🚶</kbd> 漫游模式下 <kbd>WASD</kbd> 走动 · <kbd>空格</kbd> 跳跃 · <kbd>Esc</kbd> 回航拍</div>
      <div class="hp-row"><kbd>🗺</kbd> 街区导览 · <kbd>🏅</kbd> 人气榜 · <kbd>🌆</kbd> 霓虹夜景</div>
      <div class="hp-row">时间滑杆可调昼夜；<kbd>⏸</kbd> 自动流动 · <kbd>?lite=1</kbd> 低配模式</div>`;
    document.body.appendChild(h);
    VB.$("#hpClose").addEventListener("click", () => h.classList.remove("show"));
  });

  VB.$("#searchBtn").addEventListener("click", () => VB.$("#searchBox").classList.toggle("show"));
  VB.$("#rankBtn2").addEventListener("click", () => VB.ui.toggleRank());
  VB.$("#homeBtn").addEventListener("click", () => {
    VB.$("#app").classList.add("hide");
    VB.$("#boot").classList.remove("hide");
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
  });
  VB.$("#rankClose").addEventListener("click", () => VB.ui.toggleRank(false));
  VB.$("#searchGo").addEventListener("click", () => VB.ui.search(VB.$("#searchInput2").value));
  VB.$("#searchInput2").addEventListener("keydown", e => { if (e.key === "Enter") VB.ui.search(e.target.value); });

  /* 画布交互 */
  const cvs = VB.canvas;
  cvs.addEventListener("pointerdown", e => {
    if (e.button === 0) VB.ui.tryPick(e.clientX, e.clientY);
    VB.startDrag(e.clientX, e.clientY, e.button);
  });
  window.addEventListener("pointermove", e => VB.moveDrag(e.clientX, e.clientY));
  window.addEventListener("pointerup", () => VB.endDrag());
  window.addEventListener("wheel", e => VB.wheelZoom(e.deltaY), { passive: true });
  const onKeyDown = e => {
    VB.setKey(e.code, true);
    if (e.code === "Escape") {
      /* Esc 优先级：关项目卡 > 关排行 > 退出漫游 */
      const card = VB.$("#projCard");
      if (card && !card.classList.contains("hide")) { card.classList.add("hide"); return; }
      const lp2 = VB.$("#listPanel");
      if (lp2 && !lp2.classList.contains("hide")) { VB.ui.listClose(); return; }
      const rp = VB.$("#rankPanel");
      if (rp && !rp.classList.contains("hide")) { VB.ui.toggleRank(false); return; }
      if (VB.cam.mode === "walk") { VB.setOrbit(); VB.ui.syncJoystick && VB.ui.syncJoystick(); VB.$("#viewBtn").textContent = "🛸 航拍"; }
    }
    if (e.code === "Space") e.preventDefault();
  };
  /* 只挂 window：keydown 从 document 冒泡到 window，注册两处会导致每次按键处理两次 */
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", e => VB.setKey(e.code, false));
  document.addEventListener("mousemove", e => VB.fpMove(e));
  /* ═══ 移动端虚拟摇杆（漫游模式） ═══ */
  VB.ui.initJoystick = function () {
    const joy = VB.$("#joy");
    if (!joy) return;
    const knob = joy.querySelector(".joy-knob");
    let active = false, cx = 0, cy = 0;
    const R = 44;
    const onMove = (x, y) => {
      let dx = (x - cx) / R, dy = (y - cy) / R;
      const len = Math.hypot(dx, dy);
      if (len > 1) { dx /= len; dy /= len; }
      knob.style.transform = `translate(${dx * R * 0.7}px, ${dy * R * 0.7}px)`;
      VB.cam.keys.f = dy < -0.28 ? 1 : 0;
      VB.cam.keys.b = dy > 0.28 ? 1 : 0;
      VB.cam.keys.l = dx < -0.28 ? 1 : 0;
      VB.cam.keys.r = dx > 0.28 ? 1 : 0;
    };
    const reset = () => {
      active = false;
      knob.style.transform = "translate(0,0)";
      VB.cam.keys.f = VB.cam.keys.b = VB.cam.keys.l = VB.cam.keys.r = 0;
    };
    joy.addEventListener("pointerdown", e => {
      if (e.pointerType !== "touch") return;
      active = true;
      const r = joy.getBoundingClientRect();
      cx = r.left + r.width / 2; cy = r.top + r.height / 2;
      onMove(e.clientX, e.clientY);
      e.stopPropagation();
    });
    joy.addEventListener("pointermove", e => {
      if (!active || e.pointerType !== "touch") return;
      onMove(e.clientX, e.clientY);
      e.stopPropagation();
    });
    joy.addEventListener("pointerup", reset);
    joy.addEventListener("pointercancel", reset);
  };
  VB.ui.initJoystick();
  /* 摇杆仅漫游模式可见 */
  VB.ui.syncJoystick = () => {
    const joy = VB.$("#joy");
    if (!joy) return;
    /* 真实缺陷修复：原判断只看 UA（桌面 UA 恒 false），窄视口/触屏设备也应可用 */
    const touchable = "ontouchstart" in window || (navigator.maxTouchPoints || 0) > 0;
    const narrow = window.innerWidth <= 760;
    const show = VB.cam.mode === "walk" && (VB.isMobile || touchable || narrow);
    joy.classList.toggle("hide", !show);
  };
  VB.ui.syncJoystick();

  /* 触摸：双指缩放 + 单指旋转（pinch 函数此前定义但从未绑定） */
  cvs.addEventListener("pointerdown", e => { if (e.pointerType === "touch") VB.pinchDown(e); });
  cvs.addEventListener("pointermove", e => { if (e.pointerType === "touch") VB.pinchMove(e); });
  cvs.addEventListener("pointerup", e => { if (e.pointerType === "touch") VB.pinchUp(e); });
  cvs.addEventListener("pointercancel", e => { if (e.pointerType === "touch") VB.pinchUp(e); });
  window.addEventListener("resize", () => VB.resize());

  /* 品牌栏副标题：动态项目数与街区数（避免硬编码随数据刷新失真） */
  const bsub = VB.$("#brandSub");
  if (bsub) {
    const d = window.VB_DATA || [];
    const cats = new Set(d.map(x => x.c)).size;
    bsub.textContent = "码上创之城 · " + d.length + " 栋灵感之楼 · " + cats + " 街区";
  }
};

/* 街区飞行（来自相机模块的延迟挂载） */
VB.ui.flyToCategory = function (cat) { VB._flyToCategory(cat); };

/* 搜索：名称/一句话模糊匹配 → 飞行定位 + 弹卡 */
VB.ui.search = function (q) {
  q = (q || "").trim();
  if (!q) return;
  const data = window.VB_DATA || [];
  const hit = data.findIndex(x => (x.n || "").includes(q) || (x.t || "").includes(q));
  if (hit < 0) { VB.toast("没找到「" + q.slice(0, 10) + "」换个词试试"); return; }
  VB.flyToBuilding(hit);
  setTimeout(() => VB.ui.showProj(hit), 1700);
};

/* 排行榜 */
VB.ui.toggleRank = function (force) {
  const p = VB.$("#rankPanel");
  const show = force !== undefined ? force : p.classList.contains("hide");
  if (show && !p.dataset.filled) {
    const data = window.VB_DATA || [];
    const top = data.map((x, i) => ({ x, i })).sort((a, b) => (b.x.v || 0) - (a.x.v || 0)).slice(0, 20);
    VB.$("#rankList").innerHTML = top.map(({ x, i }, k) => `
      <div class="rank-row" data-i="${i}">
        <em class="no ${k < 3 ? "top" + (k + 1) : ""}">${k + 1}</em>
        <div class="rr-main"><b>${VB.escapeHtml(x.n)}</b><span>${VB.escapeHtml(x.t || "")}</span></div>
        <div class="rr-vote">${x.v || 0} 票</div>
      </div>`).join("");
    p.dataset.filled = "1";
    VB.$$("#rankList .rank-row").forEach(row => {
      row.addEventListener("click", () => {
        const i = +row.dataset.i;
        VB.flyToBuilding(i);
        setTimeout(() => VB.ui.showProj(i), 1700);
        VB.ui.toggleRank(false);
      });
    });
  }
  p.classList.toggle("hide", !show);
};

/* 项目卡 */
VB.ui.showProj = function (idx) {
  const x = (window.VB_DATA || [])[idx];
  if (!x) return;
  VB.ui._curProj = idx;
  /* 记录打开前的焦点，关闭时归还（键盘用户不丢位置） */
  VB.ui._prevFocus = document.activeElement;
  const card = VB.$("#projCard");
  const color = VB_CAT_COLORS[x.c] || "#9aa4b8";
  const DIM_NAMES = ["创意", "完整", "实用", "体验"];
  /* 四维评分条；无维度数据时降级为综合星级条，避免视觉断层 */
  let dimsHtml = "";
  if (Array.isArray(x.d) && x.d.length === 4) {
    dimsHtml = '<div class="pc-dims">' + x.d.map((v, i) =>
      `<div class="pc-dim"><span>${DIM_NAMES[i]}</span>` +
      `<i class="bar"><b style="width:${Math.max(2, Math.min(100, v / 5 * 100))}%;background:${color}"></b></i>` +
      `<em>${v.toFixed(1)}</em></div>`).join("") + "</div>";
  } else if (x.r > 0) {
    dimsHtml = '<div class="pc-dims"><div class="pc-dim"><span>综合</span>' +
      `<i class="bar"><b style="width:${Math.max(2, Math.min(100, x.r / 5 * 100))}%;background:${color}"></b></i>` +
      `<em>${(+x.r).toFixed(1)}</em></div></div>`;
  }
  const isExternal = /^https?:\/\//i.test(x.u || "");
  card.innerHTML = `
    <div class="pc-head"><u style="background:${color}"></u><b>${VB.escapeHtml(x.n)}</b><button id="pcClose" aria-label="关闭">✕</button></div>
    <div class="pc-tag">${VB.escapeHtml(x.t || "")}</div>
    <div class="pc-meta"><span>${VB.escapeHtml(x.c)}</span>${x.p ? `<span>${VB.escapeHtml(x.p)}</span>` : ""}</div>
    <div class="pc-stats"><i>⭐ ${x.r || 0}</i><i>🎫 ${x.v || 0} 票</i></div>
    ${dimsHtml}
    <div class="pc-actions">
      ${x.u ? `<a class="pc-link" href="${VB.escapeHtml(x.u)}" target="_blank" rel="noopener noreferrer">打开作品 ↗</a>` : ""}
      <button class="pc-copy" id="pcCopy" title="复制定位链接">🔗</button>
    </div>
    ${isExternal ? '<div class="pc-note">外部作品 · 新窗口打开</div>' : ""}`;
  card.classList.remove("hide");
  const closeBtn = VB.$("#pcClose");
  const close = () => {
    card.classList.add("hide");
    /* 归还焦点 */
    const prev = VB.ui._prevFocus;
    if (prev && typeof prev.focus === "function") { try { prev.focus(); } catch (e) {} }
  };
  closeBtn.addEventListener("click", close);
  /* 焦点进入卡片，键盘用户可立即操作 */
  try { closeBtn.focus(); } catch (e) {}
  /* 复制深链 */
  const copyBtn = VB.$("#pcCopy");
  if (copyBtn) {
    copyBtn.addEventListener("click", () => {
      const link = location.origin + location.pathname + "#" + encodeURIComponent(x.n);
      const done = () => VB.toast("已复制定位链接");
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(link).then(done, () => VB.toast("复制失败，请手动复制地址"));
      } else {
        const ta = document.createElement("textarea");
        ta.value = link; document.body.appendChild(ta); ta.select();
        try { document.execCommand("copy"); done(); } catch (e) { VB.toast("复制失败"); }
        ta.remove();
      }
    });
  }
};

/* 拾取：raycaster 命中 InstancedMesh 的 instanceId */
VB.ui.tryPick = function (cx, cy) {
  if (!VB.city.blocks) return;
  if (VB.cam.drag && VB.cam.drag.moved) return; /* 拖拽后不拾取 */
  if (VB.cam.flyTo) return; /* 飞行动画中不拾取 */
  const mouse = new THREE.Vector2((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1);
  const rc = new THREE.Raycaster();
  rc.setFromCamera(mouse, VB.camera);
  /* 仅楼体 Mesh 参与拾取（地面/道路/光柱除外，防穿透误点） */
  const targets = VB.city.blocks.map(b => b.mesh);
  /* 近平面优化：楼群半径 ~340，从摄像机出发射线只测到 ~400 */
  rc.far = 420;
  const hits = rc.intersectObjects(targets, false);
  if (!hits.length) return;
  const h = hits[0];
  const block = VB.city.blocks.find(b => b.mesh === h.object);
  if (!block) return;
  const projIdx = block.projIdx[h.instanceId];
  if (projIdx === undefined) return;
  VB.ui.showProj(projIdx);
};