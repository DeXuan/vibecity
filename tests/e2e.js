/**
 * VibeCity 自动化回归测试（Playwright）
 * 运行：node tests/e2e.js
 * 覆盖：启动/入城/渲染/拾取/搜索/排行/街区导览/时间/霓虹/帮助/移动端/错误恢复
 */
const path = require("path");
const PW = require("playwright");

const URL = process.env.VB_URL || "http://127.0.0.1:8765/index.html";
const results = [];
let browser, page;

function ok(name, extra) {
  results.push({ name, pass: true, extra });
  console.log("PASS  " + name + (extra ? "  → " + JSON.stringify(extra) : ""));
}
function fail(name, err) {
  results.push({ name, pass: false, error: String(err && err.message || err).slice(0, 300) });
  console.log("FAIL  " + name + "  → " + (err && err.message || err));
}

async function test(name, fn) {
  try { const r = await fn(); ok(name, r); }
  catch (e) { fail(name, e); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); }

(async () => {
  browser = await PW.chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  page = await ctx.newPage();

  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", m => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", e => pageErrors.push(e.message));

  /* ---------- 1. 启动 ---------- */
  await test("01 页面加载与启动页", async () => {
    await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForFunction(() => typeof VB !== "undefined" && typeof VB.initRender === "function", { timeout: 30000 });
    await page.waitForFunction(() => VB.city && VB.city.blocks && VB.city.blocks.length > 0, { timeout: 30000 });
    const st = await page.evaluate(() => ({
      title: document.title,
      dataLen: (window.VB_DATA || []).length,
      blocks: VB.city.blocks.length,
      projPosN: Object.keys(VB.projPos || {}).length,
      bootVisible: !document.querySelector("#boot").classList.contains("hide"),
      renderer: !!VB.renderer,
      sky: !!VB.sky,
      legend: document.querySelectorAll(".cat-chip").length
    }));
    assert(st.dataLen >= 400, "数据应 ≥400，实际 " + st.dataLen);
    assert(st.blocks >= 13, "街区应 ≥13，实际 " + st.blocks);
    assert(st.projPosN === st.dataLen, "楼体位置全覆盖");
    assert(st.bootVisible, "启动页可见");
    assert(st.renderer && st.sky, "渲染器与天空已创建");
    return st;
  });

  /* ---------- 2. 入城 ---------- */
  await test("02 入城与开场飞行", async () => {
    await page.evaluate(() => VB.enterCity());
    await page.waitForTimeout(500);
    const st = await page.evaluate(() => ({
      appVisible: !VB.$("#app").classList.contains("hide"),
      flying: !!VB.cam.flyTo,
      mode: VB.cam.mode
    }));
    assert(st.appVisible, "应用层应显示");
    assert(st.flying, "开场应触发相机飞行");
    assert(st.mode === "orbit", "应为航拍模式");
    return st;
  });

  /* ---------- 3. 渲染质量 ---------- */
  await test("03 渲染管线与性能", async () => {
    await page.waitForTimeout(3600); // 等开场飞行结束
    const st = await page.evaluate(() => {
      VB.renderer.render(VB.scene, VB.camera);
      const info = VB.renderer.info.render;
      return {
        drawCalls: info.calls,
        triangles: info.triangles,
        toneMapping: VB.renderer.toneMapping,
        shadow: VB.renderer.shadowMap.enabled,
        skyShader: !!VB.sky.material.isShaderMaterial,
        neonMats: (VB.city.cityMats || []).length
      };
    });
    assert(st.drawCalls < 80, "draw calls 应 <80，实际 " + st.drawCalls);
    assert(st.triangles > 1000, "三角面应 >1000");
    assert(st.skyShader, "天空应为 ShaderMaterial");
    return st;
  });

  /* ---------- 4. 昼夜心跳（本轮修复点） ---------- */
  await test("04 昼夜心跳驱动（timeFlow/hemiLight 初始化修复）", async () => {
    const st = await page.evaluate(async () => {
      const before = { tod: VB.tod, hemi: VB.hemiLight && VB.hemiLight.intensity, flow: VB.timeFlow };
      await new Promise(r => setTimeout(r, 1200));
      const after = { tod: VB.tod, hemi: VB.hemiLight && VB.hemiLight.intensity };
      return { before, after, hemiExists: !!VB.hemiLight, flowInit: typeof VB.timeFlow === "boolean" };
    });
    assert(st.hemiExists, "hemiLight 必须存在（原缺陷：未保存引用）");
    assert(st.flowInit, "timeFlow 必须已初始化（原缺陷：死代码）");
    assert(st.after.tod !== st.before.tod, "tod 应随时间推进");
    return st;
  });

  /* ---------- 5. 时间滑杆（新增） ---------- */
  await test("05 时间滑杆手动调节", async () => {
    const st = await page.evaluate(() => {
      const rng = VB.$("#todRng");
      rng.value = 95;
      rng.dispatchEvent(new Event("input", { bubbles: true }));
      return {
        tod: +VB.tod.toFixed(2),
        label: VB.$("#todLabel").textContent,
        flowOff: VB.timeFlow === false
      };
    });
    assert(st.tod > 0.9, "tod 应被设为 0.95");
    assert(st.label === "深夜", "标签应为深夜，实际 " + st.label);
    assert(st.flowOff, "手动调节应暂停自动流动");
    // 恢复
    await page.evaluate(() => { VB.timeFlow = true; VB.tod = 0.32; VB.ui.applyTod(0.32); });
    return st;
  });

  /* ---------- 6. 楼体拾取（P0 修复点） ---------- */
  await test("06 楼体拾取精确性与防误触", async () => {
    const st = await page.evaluate(() => {
      // 找一个高楼的屏幕坐标
      let bestIdx = -1, bestH = -1;
      for (let i = 0; i < (window.VB_DATA || []).length; i++) {
        const p = VB.projPos[i];
        if (p && p.h > bestH) { bestH = p.h; bestIdx = i; }
      }
      const p = VB.projPos[bestIdx];
      VB.cam.sph = { r: 150, theta: 0.9, phi: 0.95 };
      VB.cam.target.set(p.x, p.h * 0.5, p.z);
      VB.cam.flyTo = null;
      VB.applyOrbit();
      VB.renderer.render(VB.scene, VB.camera);
      const v = new THREE.Vector3(p.x, p.h * 0.55, p.z).project(VB.camera);
      const sx = Math.round((v.x * 0.5 + 0.5) * innerWidth);
      const sy = Math.round((-v.y * 0.5 + 0.5) * innerHeight);
      VB.ui.tryPick(sx, sy);
      const shown1 = !VB.$("#projCard").classList.contains("hide");
      const title1 = (VB.$("#projCard").textContent || "").slice(0, 30);
      // 拖拽后不应再拾取
      VB.$("#projCard").classList.add("hide");
      VB.startDrag(100, 100, 0);
      VB.moveDrag(160, 160);
      VB.ui.tryPick(sx, sy);
      const shownAfterDrag = !VB.$("#projCard").classList.contains("hide");
      VB.endDrag();
      return { bestIdx, screen: [sx, sy], shown1, title1, shownAfterDrag };
    });
    assert(st.shown1, "点击楼体应弹出项目卡");
    assert(!st.shownAfterDrag, "拖拽后不应误触弹卡");
    return st;
  });

  /* ---------- 7. 搜索飞行 ---------- */
  await test("07 搜索飞行定位", async () => {
    const st = await page.evaluate(async () => {
      VB.$("#projCard").classList.add("hide");
      VB.ui.search("装点准");
      const fly = !!VB.cam.flyTo;
      await new Promise(r => setTimeout(r, 2100));
      return {
        flyTriggered: fly,
        cardShown: !VB.$("#projCard").classList.contains("hide"),
        target: VB.cam.target.toArray().map(v => Math.round(v))
      };
    });
    assert(st.flyTriggered, "应触发飞行");
    assert(st.cardShown, "飞行后应弹出项目卡");
    return st;
  });

  /* ---------- 8. 排行榜 ---------- */
  await test("08 人气榜渲染与跳转", async () => {
    await page.evaluate(() => VB.ui.toggleRank(true));
    await page.waitForTimeout(400);
    const st = await page.evaluate(() => ({
      shown: !VB.$("#rankPanel").classList.contains("hide"),
      rows: document.querySelectorAll("#rankList .rank-row").length,
      topName: document.querySelector("#rankList .rank-row b")?.textContent
    }));
    assert(st.shown, "排行面板应显示");
    assert(st.rows === 20, "应有 20 行，实际 " + st.rows);
    await page.evaluate(() => VB.ui.toggleRank(false));
    return st;
  });

  /* ---------- 9. 街区导览（新增） ---------- */
  await test("09 街区导览分类飞行", async () => {
    const st = await page.evaluate(async () => {
      VB.$("#distBtn").click();
      const shown = VB.$("#distNav").classList.contains("show");
      const chips = document.querySelectorAll(".distChip").length;
      const first = document.querySelector(".distChip");
      const cat = first ? first.dataset.cat : null;
      if (first) first.click();
      const flying = !!VB.cam.flyTo;
      await new Promise(r => setTimeout(r, 2000));
      return { shown, chips, cat, flying, mode: VB.cam.mode };
    });
    assert(st.shown, "导览面板应显示");
    assert(st.chips >= 10, "分类芯片应 ≥10，实际 " + st.chips);
    assert(st.flying, "点击分类应触发飞行");
    return st;
  });

  /* ---------- 10. 霓虹切换 ---------- */
  await test("10 白昼/霓虹切换", async () => {
    const st = await page.evaluate(() => {
      VB.$("#neonBtn").click();
      const on = { neon: VB.city.neon, emissive: VB.city.cityMats[0].emissiveIntensity, btnOn: VB.$("#neonBtn").classList.contains("on") };
      VB.$("#neonBtn").click();
      const off = { neon: VB.city.neon, emissive: VB.city.cityMats[0].emissiveIntensity };
      return { on, off };
    });
    assert(st.on.neon && st.on.emissive > 0.5, "霓虹应开启且窗灯发光");
    assert(!st.off.neon && st.off.emissive < 0.1, "白昼应关闭发光");
    return st;
  });

  /* ---------- 11. 漫游模式 ---------- */
  await test("11 漫游模式与键盘移动", async () => {
    const st = await page.evaluate(async () => {
      VB.$("#viewBtn").click();
      const mode = VB.cam.mode;
      const p0 = VB.camera.position.clone();
      VB.setKey("KeyW", true);
      await new Promise(r => setTimeout(r, 800));
      VB.setKey("KeyW", false);
      const p1 = VB.camera.position.clone();
      const moved = p0.distanceTo(p1) > 0.5;
      return { mode, moved, dist: +p0.distanceTo(p1).toFixed(2) };
    });
    assert(st.mode === "walk", "应进入漫游模式");
    assert(st.moved, "W 键应使相机移动，位移 " + st.dist);
    await page.evaluate(() => { VB.setOrbit(); VB.$("#viewBtn").textContent = "🛸 航拍"; });
    return st;
  });

  /* ---------- 12. 帮助面板（新增） ---------- */
  await test("12 操作帮助面板", async () => {
    const st = await page.evaluate(() => {
      VB.$("#helpBtn").click();
      const p = VB.$("#helpPanel");
      const shown = !!p && p.classList.contains("show");
      const rows = p ? p.querySelectorAll(".hp-row").length : 0;
      if (p) VB.$("#hpClose").click();
      return { shown, rows, closed: p ? !p.classList.contains("show") : false };
    });
    assert(st.shown, "帮助面板应显示");
    assert(st.rows >= 4, "指南条目应 ≥4");
    assert(st.closed, "可关闭");
    return st;
  });

  /* ---------- 13. 楼顶装饰（新增） ---------- */
  await test("13 楼顶装饰实例化", async () => {
    const st = await page.evaluate(() => {
      let antenna = 0, tank = 0, instanced = 0;
      VB.city.group.traverse(o => {
        if (o.isInstancedMesh) {
          instanced++;
          const g = o.geometry;
          if (g.type === "CylinderGeometry") {
            const rad = g.parameters.radiusTop;
            if (rad < 0.4) antenna += o.count;
            else if (rad === 0.5) tank += o.count;
          }
        }
      });
      return { instancedMeshes: instanced, antenna, tank };
    });
    assert(st.instancedMeshes >= 14, "实例化网格应 ≥14");
    assert(st.antenna + st.tank > 0, "应有楼顶装饰");
    return st;
  });

  /* ---------- 14. XSS 防护 ---------- */
  await test("14 项目卡 XSS 转义", async () => {
    const st = await page.evaluate(() => {
      window.__xss = false;
      const evil = '<img src=x onerror="window.__xss=true">';
      VB.ui.showProj = VB.ui.showProj; // keep
      const idx = 0;
      const orig = window.VB_DATA[idx];
      window.VB_DATA[idx] = { ...orig, n: evil, t: evil };
      VB.ui.showProj(idx);
      const card = VB.$("#projCard");
      const hasImg = card.querySelectorAll("img").length;
      const fired = window.__xss;
      window.VB_DATA[idx] = orig;
      card.classList.add("hide");
      return { hasImg, fired, escaped: card.textContent.includes("<img") };
    });
    assert(st.hasImg === 0, "不应生成 img 标签");
    assert(!st.fired, "不应执行脚本");
    assert(st.escaped, "应显示为纯文本");
    return st;
  });

  /* ---------- 15. hash 直达入口校验 ---------- */
  await test("15 hash 直达与非法输入拦截", async () => {
    const st = await page.evaluate(() => {
      const valid = (h) => h.length >= 2 && h.length <= 40 && /^[\p{Script=Han}\w\s，。！？、·「」-]+$/u.test(h);
      return {
        validName: valid("装点准"),
        validVerse: valid("大漠孤烟直"),
        rejectScript: !valid("<script>alert(1)</script>"),
        rejectLong: !valid("a".repeat(60)),
        rejectShort: !valid("a")
      };
    });
    assert(st.validName && st.validVerse, "合法输入应通过");
    assert(st.rejectScript, "脚本注入应被拦截");
    assert(st.rejectLong && st.rejectShort, "长度限制应生效");
    return st;
  });

  /* ---------- 16. 数据完整性 ---------- */
  await test("16 数据完整性与一致性", async () => {
    const st = await page.evaluate(() => {
      const d = window.VB_DATA;
      const cats = new Set(d.map(x => x.c));
      const missingUrl = d.filter(x => !x.u).length;
      const withVotes = d.filter(x => (x.v || 0) > 0).length;
      const maxVote = Math.max(...d.map(x => x.v || 0));
      return { total: d.length, categories: cats.size, missingUrl, withVotes, maxVote };
    });
    assert(st.total >= 400, "总数应 ≥400，实际 " + st.total);
    assert(st.categories >= 13, "分类应 ≥13");
    assert(st.maxVote > 500, "应有人气王（>500 票）");
    return st;
  });

  /* ---------- 17. 回退入口 ---------- */
  await test("17 回到入口", async () => {
    const st = await page.evaluate(() => {
      VB.$("#homeBtn").click();
      return {
        appHidden: VB.$("#app").classList.contains("hide"),
        bootShown: !VB.$("#boot").classList.contains("hide")
      };
    });
    assert(st.appHidden && st.bootShown, "应回到启动页");
    return st;
  });

  /* ---------- 18. 移动端视口 ---------- */
  await test("18 移动端视口适配", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);
    const st = await page.evaluate(() => {
      const ctl = VB.$("#ctl");
      const timeBar = VB.$("#timeBar");
      const r = ctl.getBoundingClientRect();
      const tr = timeBar.getBoundingClientRect();
      return {
        canvasW: VB.canvas.width,
        camAspect: +VB.camera.aspect.toFixed(3),
        ctlInside: r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1,
        timeBarInside: tr.right <= innerWidth + 1
      };
    });
    assert(st.camAspect > 0.4 && st.camAspect < 0.5, "宽高比应适配竖屏，实际 " + st.camAspect);
    assert(st.ctlInside, "控制组不应溢出");
    await page.setViewportSize({ width: 1280, height: 720 });
    return st;
  });

  /* ---------- 20. 偏好持久化（本轮新增） ---------- */
  await test("20 偏好持久化与刷新还原", async () => {
    // 设置：tod=0.8、霓虹开、漫游关
    await page.evaluate(() => {
      VB.timeFlow = false;
      VB.ui.applyTod(0.8);
      if (!VB.city.neon) VB.$("#neonBtn").click();
      VB.savePrefs();
    });
    const saved = await page.evaluate(() => VB.prefs.load());
    assert(saved && typeof saved.tod === "number", "偏好应已写入 localStorage");
    assert(Math.abs(saved.tod - 0.8) < 0.01, "tod 应持久化为 0.8，实际 " + saved.tod);
    assert(saved.neon === true, "霓虹状态应持久化");

    // 刷新后应还原
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => VB.city && VB.city.blocks && VB.city.blocks.length > 0, { timeout: 30000 });
    await page.waitForTimeout(1200);
    const restored = await page.evaluate(() => ({
      tod: +VB.tod.toFixed(2),
      neon: VB.city.neon,
      neonBtnOn: VB.$("#neonBtn").classList.contains("on"),
      flow: VB.timeFlow
    }));
    assert(Math.abs(restored.tod - 0.8) < 0.02, "刷新后 tod 应还原为 0.8，实际 " + restored.tod);
    assert(restored.neon === true, "刷新后霓虹应仍开启");
    // 清理，避免影响后续测试
    await page.evaluate(() => { VB.prefs.clear(); VB.timeFlow = true; VB.setNeon(false); if (VB.sky) VB.sky._setNeon(false); });
    return { saved, restored };
  });

  /* ---------- 21. 移动端虚拟摇杆（本轮新增） ---------- */
  await test("21 移动端虚拟摇杆", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    const st = await page.evaluate(async () => {
      // 进入漫游 → 摇杆应出现
      VB.setWalk();
      VB.ui.syncJoystick();
      const joy = VB.$("#joy");
      const visibleInWalk = joy && !joy.classList.contains("hide");
      // 模拟摇杆输入（直接设 keys，等价于摇杆拖动结果）
      const p0 = VB.camera.position.clone();
      VB.cam.keys.f = 1;
      await new Promise(r => setTimeout(r, 700));
      VB.cam.keys.f = 0;
      const moved = p0.distanceTo(VB.camera.position) > 0.5;
      // 回航拍 → 摇杆隐藏
      VB.setOrbit();
      VB.ui.syncJoystick();
      const hiddenInOrbit = joy.classList.contains("hide");
      return { visibleInWalk, moved, hiddenInOrbit, dist: +p0.distanceTo(VB.camera.position).toFixed(2) };
    });
    assert(st.visibleInWalk, "漫游模式下摇杆应可见");
    assert(st.moved, "摇杆输入应驱动相机移动");
    assert(st.hiddenInOrbit, "航拍模式下摇杆应隐藏");
    await page.setViewportSize({ width: 1280, height: 720 });
    return st;
  });

  /* ---------- 22. F3 性能面板（本轮新增） ---------- */
  await test("22 F3 性能面板", async () => {
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "F3", bubbles: true })));
    await page.waitForTimeout(1400);
    const st = await page.evaluate(() => {
      const el = document.getElementById("perfHud");
      return { exists: !!el, visible: el && el.style.display === "block", text: el ? el.textContent : "" };
    });
    assert(st.exists && st.visible, "F3 应唤出性能面板");
    assert(/FPS/.test(st.text || ""), "面板应显示 FPS，实际：" + st.text);
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "F3", bubbles: true })));
    return st;
  });

  /* ---------- 23. 数据刷新脚本产物一致性 ---------- */
  await test("23 数据刷新脚本可执行性", async () => {
    const { execFileSync } = require("child_process");
    const out = execFileSync("node", ["tools/refresh-data.js", "--dry-run"], {
      encoding: "utf8", cwd: path.join(__dirname, ".."), timeout: 90000
    });
    assert(/去重后 \d+ 项/.test(out), "脚本应输出去重统计");
    assert(/分类分布/.test(out), "脚本应输出分类分布");
    const m = out.match(/去重后 (\d+) 项/);
    return { reported: m ? +m[1] : null, dryRunOK: true };
  });

  /* ---------- 24. 项目卡四维评分条（本轮新增） ---------- */
  await test("24 项目卡四维评分拆解", async () => {
    const st = await page.evaluate(() => {
      // 找一条带 d 字段的数据
      const idx = (window.VB_DATA || []).findIndex(x => Array.isArray(x.d) && x.d.length === 4);
      if (idx < 0) return { hasDims: false, note: "数据无四维字段" };
      VB.ui.showProj(idx);
      const card = VB.$("#projCard");
      const rows = card.querySelectorAll(".pc-dim");
      const bars = card.querySelectorAll(".pc-dim .bar b");
      const labels = [...card.querySelectorAll(".pc-dim span")].map(e => e.textContent);
      const hasCopy = !!VB.$("#pcCopy");
      card.classList.add("hide");
      return {
        hasDims: true, idx, dataDims: window.VB_DATA[idx].d,
        rows: rows.length, bars: bars.length, labels, hasCopy,
        firstBarWidth: bars[0] ? bars[0].style.width : null
      };
    });
    assert(st.hasDims, "数据应含四维评分字段 d");
    assert(st.rows === 4, "应渲染 4 条评分，实际 " + st.rows);
    assert(st.labels.join(",") === "创意,完整,实用,体验", "维度名不符：" + st.labels.join(","));
    assert(st.bars === 4, "应有 4 条进度条");
    assert(st.hasCopy, "应有复制链接按钮");
    assert(/%$/.test(st.firstBarWidth || ""), "评分条宽度应为百分比");
    return st;
  });

  /* ---------- 25. Esc 分级关闭（本轮新增） ---------- */
  await test("25 Esc 分级关闭优先级", async () => {
    // 用真实键盘事件（合成 KeyboardEvent 缺少 code 字段，与真实键不一致）
    await page.evaluate(() => VB.ui.showProj(0));
    const cardOpen = await page.evaluate(() => !VB.$("#projCard").classList.contains("hide"));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
    const cardClosed = await page.evaluate(() => VB.$("#projCard").classList.contains("hide"));

    await page.evaluate(() => VB.ui.toggleRank(true));
    const rankOpen = await page.evaluate(() => !VB.$("#rankPanel").classList.contains("hide"));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
    const rankClosed = await page.evaluate(() => VB.$("#rankPanel").classList.contains("hide"));

    assert(cardOpen, "项目卡应先打开");
    assert(cardClosed, "Esc 应关闭项目卡");
    assert(rankOpen, "排行应先打开");
    assert(rankClosed, "Esc 应关闭排行面板");
    return { cardOpen, cardClosed, rankOpen, rankClosed };
  });

  /* ---------- 26. 深链复制定位链接（本轮新增） ---------- */
  await test("26 复制定位链接", async () => {
    const st = await page.evaluate(() => {
      VB.ui.showProj(0);
      const x = window.VB_DATA[0];
      const expected = location.origin + location.pathname + "#" + encodeURIComponent(x.n);
      let captured = null;
      // 拦截 clipboard 写入以验证内容
      const origClip = navigator.clipboard && navigator.clipboard.writeText;
      if (navigator.clipboard) {
        navigator.clipboard.writeText = (t) => { captured = t; return Promise.resolve(); };
      }
      VB.$("#pcCopy").click();
      if (navigator.clipboard && origClip) navigator.clipboard.writeText = origClip;
      VB.$("#projCard").classList.add("hide");
      return { expected, captured, ok: captured === expected };
    });
    // clipboard API 在 http 非安全上下文可能不可用，退化为检查按钮存在
    const btnExists = await page.evaluate(() => !!VB.$("#pcCopy") || (VB.ui.showProj(0), !!VB.$("#pcCopy")));
    assert(btnExists, "复制按钮应存在");
    if (st.captured) assert(st.ok, "复制内容应为该项目的深链");
    return st;
  });

  /* ---------- 27. 模块契约与构建校验（本轮新增） ---------- */
  await test("27 构建含模块契约校验", async () => {
    const { execFileSync } = require("child_process");
    const out = execFileSync("python", ["build.py"], {
      encoding: "utf8", cwd: path.join(__dirname, ".."), timeout: 120000
    });
    assert(/模块契约校验通过/.test(out), "构建应输出模块契约校验");
    assert(/JS 语法校验通过/.test(out), "构建应输出语法校验");
    return { hasModuleCheck: true, hasSyntaxCheck: true };
  });

  /* ---------- 28. 数据四维字段覆盖率 ---------- */
  await test("28 数据四维字段覆盖率", async () => {
    const st = await page.evaluate(() => {
      const d = window.VB_DATA || [];
      const withDims = d.filter(x => Array.isArray(x.d) && x.d.length === 4).length;
      const avgDim = withDims ? d.filter(x => x.d).reduce((a, x) => a + x.d.reduce((m, n) => m + n, 0) / 4, 0) / withDims : 0;
      return { total: d.length, withDims, coverage: +(withDims / d.length * 100).toFixed(1), avgDim: +avgDim.toFixed(2) };
    });
    assert(st.withDims > 0, "应有项目含四维评分");
    assert(st.coverage >= 20, "覆盖率应 ≥20%，实际 " + st.coverage + "%");
    return st;
  });

  /* ---------- 29. 城市生长动画（本轮新增） ---------- */
  await test("29 城市生长动画", async () => {
    const st = await page.evaluate(async () => {
      // 触发入城（含生长）
      VB.setOrbit();
      VB.cityGrow.dur = 0.6;
      VB.cityGrow.start();
      const activeAtStart = VB.cityGrow.active;
      // 采样初始高度（应为压扁态）
      const readH = () => {
        const blk = VB.city.blocks[0];
        const m = new THREE.Matrix4();
        const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
        blk.mesh.getMatrixAt(0, m); m.decompose(p, q, s);
        return +s.y.toFixed(3);
      };
      const h0 = readH();
      await new Promise(r => setTimeout(r, 900));
      const h1 = readH();
      const activeAfter = VB.cityGrow.active;
      return { activeAtStart, h0, h1, activeAfter, grew: h1 > h0 };
    });
    assert(st.activeAtStart, "生长动画应启动");
    assert(st.grew, "楼体高度应从压扁态生长（" + st.h0 + " → " + st.h1 + "）");
    assert(!st.activeAfter, "动画应自动结束");
    return st;
  });

  /* ---------- 30. 语义产业带聚类（本轮新增） ---------- */
  await test("30 语义产业带聚类", async () => {
    const st = await page.evaluate(() => {
      // 1) 分组函数可用且能命中
      const samples = [
        { n: "记账小助手", t: "记录支出与预算" },
        { n: "背单词打卡", t: "每天学习十个单词" },
        { n: "剧本杀", t: "多人在线推理游戏" },
        { n: "随便一个", t: "毫无关键词的描述" }
      ];
      const mapped = samples.map(x => VB.semanticGroup(x));
      // 2) 街区内是否记录了语义分布
      const blocksWithGroups = VB.city.blocks.filter(b => b.groups && Object.keys(b.groups).length > 0);
      const totalGroups = blocksWithGroups.reduce((a, b) => a + Object.keys(b.groups).length, 0);
      return {
        mapped,
        hitCount: mapped.filter(m => m !== "其他").length,
        blocksWithGroups: blocksWithGroups.length,
        totalGroups,
        semanticRules: VB_SEMANTIC.length
      };
    });
    assert(st.semanticRules >= 10, "语义规则应 ≥10 条");
    assert(st.hitCount === 3, "4 个样本应命中 3 个语义组，实际 " + st.hitCount);
    assert(st.mapped[0] === "记账理财", "记账应归入记账理财，实际 " + st.mapped[0]);
    assert(st.mapped[1] === "学习答题", "背单词应归入学习答题");
    assert(st.mapped[2] === "游戏娱乐", "剧本杀应归入游戏娱乐");
    assert(st.blocksWithGroups >= 10, "应有 ≥10 个街区含语义分布");
    return st;
  });

  /* ---------- 31. 语义相邻性：同组项目在街区内连续 ---------- */
  await test("31 语义相邻性验证", async () => {
    const st = await page.evaluate(() => {
      // 取最大街区，检查其 projIdx 序列的语义分组是否“成块相邻”
      let best = null;
      VB.city.blocks.forEach(b => { if (!best || b.projIdx.length > best.projIdx.length) best = b; });
      const seq = best.projIdx.map(i => VB.semanticGroup(window.VB_DATA[i]));
      let breaks = 0;
      for (let i = 1; i < seq.length; i++) if (seq[i] !== seq[i - 1]) breaks++;
      const unique = new Set(seq).size;
      return { cat: best.cat, n: seq.length, breaks, unique, ratio: +(breaks / seq.length).toFixed(2) };
    });
    // 同组相邻 → 分段数应接近组数，远小于项目数
    assert(st.breaks < st.n * 0.9, "分组切换次数应远小于项目数（" + st.breaks + "/" + st.n + "）");
    return st;
  });

  /* ---------- 32. 低配检测与自适应降级（本轮新增） ---------- */
  await test("32 自适应降级机制", async () => {
    const st = await page.evaluate(() => ({
      lowPerf: VB.lowPerf,
      hasPerf: !!VB.perf,
      hasDegradeFlag: "_degraded" in VB,
      pixelRatio: VB.renderer.getPixelRatio(),
      growRespectsLowPerf: typeof VB.cityGrow.start === "function"
    }));
    assert(typeof st.lowPerf === "boolean", "lowPerf 状态应为布尔");
    assert(st.hasPerf, "性能采样对象应存在");
    return st;
  });

  /* ---------- 33. 生长动画在低配下跳过 ---------- */
  await test("33 低配下跳过生长动画", async () => {
    const st = await page.evaluate(() => {
      const orig = VB.lowPerf;
      VB.lowPerf = true;
      VB.cityGrow.active = false;
      VB.cityGrow.start();
      const skipped = VB.cityGrow.active === false;
      VB.lowPerf = orig;
      return { skipped };
    });
    assert(st.skipped, "低配模式应跳过生长动画以保帧率");
    return st;
  });

  /* ---------- 34. 数据刷新后重建不破坏语义分组 ---------- */
  await test("34 刷新数据后语义分组稳定", async () => {
    const st = await page.evaluate(() => {
      const d = window.VB_DATA || [];
      const groups = {};
      d.forEach(x => { const g = VB.semanticGroup(x); groups[g] = (groups[g] || 0) + 1; });
      const covered = Object.keys(groups).filter(g => g !== "其他").length;
      return { total: d.length, groups: Object.keys(groups).length, covered, dist: groups };
    });
    assert(st.groups >= 8, "语义分组数应 ≥8，实际 " + st.groups);
    assert(st.covered >= 7, "应命中 ≥7 个语义组");
    return st;
  });

  /* ---------- 35. 语义覆盖率提升（本轮 P0） ---------- */
  await test("35 语义覆盖率（其他类 <15%）", async () => {
    const st = await page.evaluate(() => {
      const d = window.VB_DATA || [];
      const groups = {};
      d.forEach(x => { const g = VB.semanticGroup(x); groups[g] = (groups[g] || 0) + 1; });
      const other = groups["其他"] || 0;
      return { total: d.length, other, otherPct: +(other / d.length * 100).toFixed(1), groupCount: Object.keys(groups).length, dist: groups };
    });
    assert(st.groupCount >= 15, "语义分组数应 ≥15，实际 " + st.groupCount);
    assert(st.otherPct < 15, "「其他」类应 <15%，实际 " + st.otherPct + "%");
    return st;
  });

  /* ---------- 36. 项目列表可打开与虚拟滚动 ---------- */
  await test("36 项目列表视图", async () => {
    // #hud 为 pointer-events:none（真实点击由子元素自身可点性保证），
    // Playwright 的 actionability 检查会误判，故用 DOM 事件触发
    await page.evaluate(() => VB.$("#listBtn").click());
    await page.waitForTimeout(400);
    const st = await page.evaluate(() => {
      const panel = VB.$("#listPanel");
      const rows = document.querySelectorAll(".lp-row");
      return {
        shown: !panel.classList.contains("hide"),
        rows: rows.length,
        ariaRole: panel.getAttribute("role"),
        ariaLabel: panel.getAttribute("aria-label"),
        firstTabIndex: rows[0] ? rows[0].tabIndex : -1,
        hasFoot: !!VB.$("#lpFoot").textContent
      };
    });
    assert(st.shown, "列表面板应打开");
    assert(st.rows > 0, "应渲染项目行");
    assert(st.ariaRole === "dialog", "应有 dialog 角色");
    assert(st.ariaLabel, "应有 aria-label");
    assert(st.firstTabIndex === 0, "首行应可 Tab 聚焦");
    return st;
  });

  /* ---------- 37. 列表键盘导航（↑↓ + Enter 定位） ---------- */
  await test("37 列表键盘导航", async () => {
    await page.evaluate(() => VB.enterCity());
    await page.waitForTimeout(1500);
    await page.evaluate(() => { if (!VB.ui.list.open) VB.ui.listOpen(); });
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      const r = VB.$("#lpRows .lp-row");
      if (r) { r.tabIndex = 0; r.focus(); }
    });
    await page.waitForTimeout(200);
    const before = await page.evaluate(() => VB.ui.list.cursor);
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(120);
    const afterDown = await page.evaluate(() => VB.ui.list.cursor);
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(120);
    const afterUp = await page.evaluate(() => VB.ui.list.cursor);
    // Enter 定位
    const idxBefore = await page.evaluate(() => VB.ui.list.rows[VB.ui.list.cursor]);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(300);
    const st = await page.evaluate(() => ({
      panelClosed: VB.$("#listPanel").classList.contains("hide"),
      flying: !!VB.cam.flyTo,
      srText: VB.$("#srLive").textContent
    }));
    assert(afterDown === before + 1, "↓ 应移动光标 " + before + "→" + afterDown);
    assert(afterUp === before, "↑ 应回退光标");
    assert(st.panelClosed, "Enter 后应关闭列表");
    assert(st.flying, "Enter 应触发飞行定位");
    assert(st.srText.length > 0, "应有 aria-live 播报");
    return { before, afterDown, afterUp, ...st, targetIdx: idxBefore };
  });

  /* ---------- 38. 列表筛选功能 ---------- */
  await test("38 列表筛选", async () => {
    await page.evaluate(() => VB.ui.listOpen());
    await page.waitForTimeout(300);
    const all = await page.evaluate(() => document.querySelectorAll(".lp-row").length);
    await page.evaluate(() => {
      const inp = VB.$("#lpSearch");
      inp.value = "记账";
      inp.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.waitForTimeout(450);
    const filtered = await page.evaluate(() => ({
      rows: document.querySelectorAll(".lp-row").length,
      foot: VB.$("#lpFoot").textContent
    }));
    await page.evaluate(() => VB.ui.listClose());
    assert(all > 100, "未筛选时应有多行");
    assert(filtered.rows < all, "筛选后行数应减少（" + all + " → " + filtered.rows + "）");
    return { all, filtered: filtered.rows, foot: filtered.foot };
  });

  /* ---------- 39. aria-live 状态区存在 ---------- */
  await test("39 无障碍状态播报区", async () => {
    const st = await page.evaluate(() => {
      const el = VB.$("#srLive");
      return {
        exists: !!el,
        role: el ? el.getAttribute("role") : null,
        live: el ? el.getAttribute("aria-live") : null,
        hiddenClass: el ? el.classList.contains("sr-only") : false
      };
    });
    assert(st.exists, "应有 aria-live 状态区");
    assert(st.role === "status", "role 应为 status");
    assert(st.live === "polite", "aria-live 应为 polite");
    assert(st.hiddenClass, "视觉应隐藏（sr-only）");
    return st;
  });

  /* ---------- 40. 作品链接 100% 可用（P0 修复） ---------- */
  await test("40 作品链接全部为可用外链", async () => {
    const st = await page.evaluate(() => {
      const d = window.VB_DATA || [];
      const relative = d.filter(x => (x.u || "").startsWith("/"));
      const nonHttp = d.filter(x => x.u && !/^https?:\/\//i.test(x.u));
      const empty = d.filter(x => !x.u);
      return {
        total: d.length,
        relative: relative.length,
        nonHttp: nonHttp.length,
        empty: empty.length,
        sample: d[0] ? d[0].u : null,
        relSample: relative[0] ? relative[0].n + " → " + relative[0].u : null
      };
    });
    assert(st.relative === 0, "不应有相对路径链接，实际 " + st.relative + " 条，例：" + st.relSample);
    assert(st.nonHttp === 0, "所有链接应为 http(s)，实际异常 " + st.nonHttp + " 条");
    assert(/^https?:\/\//i.test(st.sample || ""), "首项链接应为完整 URL");
    return st;
  });

  /* ---------- 41. 键盘监听无重复绑定 ---------- */
  await test("41 键盘监听只绑定一次", async () => {
    const st = await page.evaluate(() => {
      /* 通过 setKey 调用计数验证：真实按一次键应只触发一次 */
      let calls = 0;
      const orig = VB.setKey;
      VB.setKey = function (code, down) { calls++; return orig.call(VB, code, down); };
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW", key: "w", bubbles: true }));
      VB.setKey = orig;
      return { calls };
    });
    // window 与 document 双绑会得到 2
    assert(st.calls === 1, "单次按键应只调用 setKey 1 次，实际 " + st.calls + " 次（重复绑定）");
    return st;
  });

  /* ---------- 42. 项目卡焦点管理与外部链接属性 ---------- */
  await test("42 项目卡焦点管理与链接安全属性", async () => {
    await page.evaluate(() => VB.enterCity());
    await page.waitForTimeout(1200);
    const st = await page.evaluate(() => {
      // 找一个有外链的项目
      const idx = (window.VB_DATA || []).findIndex(x => /^https?:\/\//i.test(x.u || ""));
      if (idx < 0) return { error: "无外链项目" };
      VB.ui.showProj(idx);
      const card = VB.$("#projCard");
      const closeBtn = VB.$("#pcClose");
      const link = card.querySelector(".pc-link");
      const focusedOnOpen = document.activeElement === closeBtn;
      const relAttr = link ? link.getAttribute("rel") : null;
      const note = card.querySelector(".pc-note");
      // 关闭后焦点归还
      closeBtn.click();
      const hidden = card.classList.contains("hide");
      return {
        focusedOnOpen, relAttr, hasNote: !!note,
        hidden, hasTarget: link ? link.getAttribute("target") : null
      };
    });
    assert(st.focusedOnOpen, "打开卡片应自动聚焦关闭按钮");
    assert(st.relAttr === "noopener noreferrer", "外链 rel 应为 noopener noreferrer，实际 " + st.relAttr);
    assert(st.hasTarget === "_blank", "外链应新窗口打开");
    assert(st.hasNote, "应提示「外部作品」");
    assert(st.hidden, "点击关闭应隐藏卡片");
    return st;
  });

  /* ---------- 43. 无四维数据时星级降级 ---------- */
  await test("43 无维度数据降级为综合星级", async () => {
    const st = await page.evaluate(() => {
      const d = window.VB_DATA || [];
      // 找一个无 d 但有 r 的项目
      const idx = d.findIndex(x => !x.d && x.r > 0);
      if (idx < 0) return { skipped: true, note: "所有项目均有四维数据" };
      VB.ui.showProj(idx);
      const card = VB.$("#projCard");
      const rows = card.querySelectorAll(".pc-dim");
      const label = rows[0] ? rows[0].querySelector("span").textContent : null;
      const barW = rows[0] ? rows[0].querySelector("b").style.width : null;
      card.classList.add("hide");
      return { idx, rows: rows.length, label, barW, rating: d[idx].r };
    });
    if (st.skipped) return st;
    assert(st.rows === 1, "应降级为单条综合星级，实际 " + st.rows);
    assert(st.label === "综合", "标签应为「综合」，实际 " + st.label);
    assert(/%$/.test(st.barW || ""), "应有进度条宽度");
    return st;
  });

  /* ---------- 19. 无运行时错误 ---------- */
  await test("19 全程无 JS 运行时错误", async () => {
    const critical = pageErrors.filter(e => !/ResizeObserver|favicon/.test(e));
    assert(critical.length === 0, "页面异常: " + critical.slice(0, 3).join(" | "));
    return { pageErrors: pageErrors.length, consoleErrors: consoleErrors.length };
  });

  /* ---------- 汇总 ---------- */
  await browser.close();
  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass);
  console.log("\n" + "=".repeat(64));
  console.log(`测试结果：${passed}/${results.length} 通过`);
  if (failed.length) {
    console.log("失败项：");
    failed.forEach(f => console.log("  ✗ " + f.name + " → " + f.error));
  }
  console.log("=".repeat(64));
  process.exit(failed.length ? 1 : 0);
})().catch(async e => {
  console.error("测试框架异常：", e);
  try { await browser.close(); } catch (_) {}
  process.exit(2);
});