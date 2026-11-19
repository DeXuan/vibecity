/* VibeCity · 07 主入口：渲染器 / 场景 / 循环 / 入城 */
"use strict";

VB.resize = function () {
  if (!VB.renderer) return;
  VB.renderer.setSize(innerWidth, innerHeight);
  VB.camera.aspect = innerWidth / innerHeight;
  VB.camera.updateProjectionMatrix();
};

VB.initRender = function () {
  VB.canvas = VB.$("#c");
  try {
    VB.renderer = new THREE.WebGLRenderer({ canvas: VB.canvas, antialias: !VB.lowPerf, powerPreference: "high-performance", preserveDrawingBuffer: true });
  } catch (e) {
    VB.$("#boot").innerHTML = "<p style='color:#f66;font:14px sans-serif'>当前设备不支持 WebGL。</p>";
    return false;
  }
  VB.renderer.outputColorSpace = THREE.SRGBColorSpace || "srgb";
  VB.renderer.toneMapping = THREE.ACESFilmicToneMapping;
  VB.renderer.toneMappingExposure = 1.3;
  VB.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, VB.lowPerf ? 1.25 : 2));
  VB.renderer.setSize(innerWidth, innerHeight);
  VB.scene = new THREE.Scene();
  VB.scene.background = new THREE.Color(0x9db8cc);
  VB.scene.fog = new THREE.Fog(0xbfd0dc, 320, 1500);
  VB.clock = new THREE.Clock();
  VB.initCamera();
  return true;
};

/* 入城 */
VB.enterCity = function () {
  const boot = VB.$("#boot");
  boot.classList.add("fading");
  VB.$("#app").classList.remove("hide");
  setTimeout(() => boot.classList.add("hide"), 850);
  /* 开场：高空俯瞰缓缓拉近 */
  VB.cam.sph = { r: 760, theta: 0.85, phi: 0.52 };
  VB.cam.target.set(0, 10, 0);
  VB.cam.flyTo = {
    t: 0, dur: 3.2,
    fromT: new THREE.Vector3(0, 10, 0),
    fromR: 760, fromPhi: 0.52, fromTheta: 0.85,
    toT: new THREE.Vector3(0, 14, 0), toR: 340, toPhi: 0.66, toTheta: 1.05,
  };
  VB.cam.mode = "orbit";
  /* 城市生长：楼体从地面长起，与开场飞行同步 */
  if (VB.cityGrow) VB.cityGrow.start();
};

/* ═══ F3 性能监控：FPS / draw calls / 三角面 / 几何与纹理内存 ═══ */
VB.perf = { on: false, fps: 0, acc: 0, frames: 0 };
document.addEventListener("keydown", e => {
  if (e.key !== "F3") return;
  e.preventDefault();
  VB.perf.on = !VB.perf.on;
  let el = document.getElementById("perfHud");
  if (VB.perf.on) {
    if (!el) {
      el = document.createElement("div");
      el.id = "perfHud";
      document.body.appendChild(el);
    }
    el.style.display = "block";
  } else if (el) {
    el.style.display = "none";
  }
});

/* 主循环 */
VB.loop = function () {
  requestAnimationFrame(VB.loop);
  const dt = Math.min(VB.clock.getDelta(), 0.05);
  const t = VB.clock.elapsedTime;
  /* 性能采样（1 秒窗口）+ 自适应降级 */
  const P = VB.perf;
  P.acc += dt; P.frames++;
  if (P.acc >= 1) {
    P.fps = P.frames / P.acc;
    P.acc = 0; P.frames = 0;
    /* 连续 2 秒低于 24fps → 降分辨率（仅一次，避免抖动） */
    if (!VB._degraded && P.fps < 24) {
      P.lowStreak = (P.lowStreak || 0) + 1;
      if (P.lowStreak >= 2) {
        VB._degraded = true;
        VB.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1));
        if (VB.cityGrow) VB.cityGrow.active = false;
        console.info("[VibeCity] 帧率偏低，已降至 1x 像素比");
        VB.toast && VB.toast("已自动降低画质以保证流畅");
      }
    } else if (P.fps >= 24) {
      P.lowStreak = 0;
    }
    if (P.on) {
      const el = document.getElementById("perfHud");
      if (el) {
        const info = VB.renderer.info;
        el.textContent = "FPS " + P.fps.toFixed(0)
          + " · calls " + info.render.calls
          + " · tris " + (info.render.triangles / 1000).toFixed(1) + "k"
          + " · geo " + info.memory.geometries
          + " · tex " + info.memory.textures;
      }
    }
  }
  VB.updateCamera(dt, t);
  /* 城市生长动画（入城/刷新时楼体从地面长起） */
  if (VB.cityGrow && VB.cityGrow.active) VB.cityGrow.tick(dt);
  /* 中心宝石旋转 */
  if (VB.city.crown) VB.city.crown.rotation.y = t * 0.7;
  /* ═══ 城市心跳：时间叙事驱动 ═══
     天空随 tod 渐变（晨昏霞光），灯光强度随亮度，beacon 呼吸 */
  if (VB.timeFlow) {
    VB.tod = (VB.tod + dt * 0.02) % 1;          // 一轮约 52s
    if (VB.sky) VB.sky._applyTime(VB.tod);
    /* 灯光随昼夜：正午最强，夜半最弱 */
    const day = Math.sin(VB.tod * Math.PI);
    if (VB.hemiLight) VB.hemiLight.intensity = 0.55 + day * 0.75;
    if (VB.dirLight) VB.dirLight.intensity = 0.35 + day * 1.5;
    /* 天空/雾色随昼夜 */
    if (VB.scene.fog) {
      VB.scene.fog.color.set(VB.city.neon ? 0x0c0f1c : (day > 0.5 ? 0xbfd0dc : 0x1c2236));
      VB.scene.fog.near = 320; VB.scene.fog.far = day > 0.5 ? 1500 : 900;
    }
  }
  /* beacon 呼吸（时间流逝时缓慢明灭） */
  const beams = VB.city.beacons;
  if (beams && beams.mesh) {
    const breath = 0.12 + 0.08 * Math.sin(t * 1.7);
    beams.mesh.material.opacity = VB.city.neon ? 0.32 : breath;
  }
  VB.renderer.render(VB.scene, VB.camera);
};

VB.boot = function () {
  try {
    /* 低配判定：显式参数 > 设备信号（窄屏+低核数 / 低 DPR） */
    const forced = /[?&]lite=1/.test(location.search);
    const weak = (navigator.hardwareConcurrency || 8) <= 2
      || (navigator.deviceMemory && navigator.deviceMemory <= 2);
    VB.lowPerf = forced || !!weak;
    if (VB.lowPerf) console.info("[VibeCity] 低配模式" + (forced ? "（显式指定）" : "（设备信号触发）"));
  } catch (e) {}
  /* 昼夜心跳状态初始化（缺失会导致主循环时间叙事整段失效） */
  VB.timeFlow = true;
  VB.tod = 0.32;            /* 从清晨起步 */
  if (!VB.initRender()) return;
  /* 光照 */
  const hemi = new THREE.HemisphereLight(0xcfe4ff, 0x3a4054, 1.0);
  const dir = new THREE.DirectionalLight(0xfff2dd, 1.6);
  dir.position.set(140, 190, 80);
  VB.scene.add(hemi, dir);
  VB.hemiLight = hemi;      /* 保存引用（原代码丢失，昼夜动画失效） */
  VB.dirLight = dir;
  /* 城市 */
  VB.createCity();
  VB.scene.add(VB.city.group);
  /* 天空 */
  VB.sky = VB.buildSky();
  VB.scene.add(VB.sky);
  VB.ui.buildBoot();
  VB.ui.buildHud();
  /* 恢复上次偏好（昼夜/霓虹/视角） */
  try { VB.applyPrefs(); } catch (e) { console.warn("[VibeCity] prefs restore failed", e); }
  VB.loop();
  /* hash 直达：#项目名 */
  const h = decodeURIComponent((location.hash || "").replace(/^#/, ""));
  /* hash 直达输入校验：长度 2-40，白名单字符（中英数字空格标点） */
  const hashSafe = h.length >= 2 && h.length <= 40 && /^[\p{Script=Han}\w\s，。！？、·「」-]+$/u.test(h);
  if (hashSafe) setTimeout(() => { VB.enterCity(); setTimeout(() => VB.ui.search(h), 800); }, 500);
};

/* 启动容错：任何初始化异常都不白屏，展示可读错误提示 */
function vbFatal(msg) {
  const boot = document.getElementById("boot");
  if (boot) {
    boot.classList.remove("hide", "fading");
    boot.innerHTML = '<div style="max-width:520px;padding:32px;text-align:center;font:14px/1.9 -apple-system,PingFang SC,sans-serif;color:#eef1f6">'
      + '<div style="font-size:22px;font-weight:800;margin-bottom:12px">城市未能升起</div>'
      + '<div style="color:#8b94ab">' + VB.escapeHtml(String(msg || "未知错误")) + '</div>'
      + '<div style="color:#6a7390;margin-top:16px;font-size:12px">请刷新重试，或用 ?lite=1 打开低配模式</div></div>';
  }
}
window.addEventListener("DOMContentLoaded", () => {
  try {
    VB.boot();
  } catch (e) {
    console.error("[VibeCity] boot failed:", e);
    vbFatal(e && e.message ? e.message : e);
  }
  window.addEventListener("error", e => console.warn("[VibeCity]", e.message || e));
});