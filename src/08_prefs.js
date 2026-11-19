/* VibeCity · 08 偏好持久化：昼夜 / 霓虹 / 视角 / 音量，刷新后还原 */
"use strict";

VB.prefs = {
  KEY: "vibeCity_prefs",

  load() {
    try {
      const raw = localStorage.getItem(this.KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  },

  save(patch) {
    try {
      const cur = this.load() || {};
      localStorage.setItem(this.KEY, JSON.stringify(Object.assign(cur, patch)));
    } catch (e) { /* 隐私模式/配额满时静默降级 */ }
  },

  clear() {
    try { localStorage.removeItem(this.KEY); } catch (e) {}
  }
};

/* 启动时恢复偏好（在 buildHud 之后调用，此时 UI 已就绪） */
VB.applyPrefs = function () {
  const p = VB.prefs.load();
  if (!p) return null;

  /* 1) 昼夜时刻 */
  if (typeof p.tod === "number") {
    VB.tod = Math.max(0, Math.min(1, p.tod));
    if (VB.ui.applyTod) VB.ui.applyTod(VB.tod);
  }
  /* 2) 自动流动开关 */
  if (typeof p.timeFlow === "boolean") {
    VB.timeFlow = p.timeFlow;
    const fb = VB.$("#flowBtn");
    if (fb) fb.textContent = VB.timeFlow ? "⏸" : "▶";
  }
  /* 3) 霓虹模式 */
  if (p.neon) {
    VB.setNeon(true);
    if (VB.sky && VB.sky._setNeon) VB.sky._setNeon(true);
    const nb = VB.$("#neonBtn");
    if (nb) { nb.textContent = "☀ 白昼"; nb.classList.add("on"); }
    if (VB.scene.fog) VB.scene.fog.color.set(0x0c0f1c);
  }
  /* 4) 漫游模式 */
  if (p.walk) {
    VB.setWalk();
    const vb = VB.$("#viewBtn");
    if (vb) vb.textContent = "🚶 漫游";
  }
  return p;
};

/* 统一收集当前状态并写入（各交互点调用） */
VB.savePrefs = function () {
  VB.prefs.save({
    tod: Math.round(VB.tod * 1000) / 1000,
    timeFlow: !!VB.timeFlow,
    neon: !!(VB.city && VB.city.neon),
    walk: VB.cam && VB.cam.mode === "walk"
  });
};