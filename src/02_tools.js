/* VibeCity · 02 工具与全局（含大气天空 shader，自 poemverse v2.0 管线复用） */
"use strict";
const VB = {
  VER: "1.0.0",
  canvas: null, renderer: null, scene: null, camera: null, clock: null,
  world: null, state: {}, lowPerf: false, isMobile: /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent),
};
VB.$ = (s, all) => all ? Array.from(document.querySelectorAll(s)) : document.querySelector(s);
VB.$$ = sel => Array.from(document.querySelectorAll(sel));
/* 防抖：列表筛选等高频输入使用（此前遗漏定义，曾导致 buildHud 中断） */
VB.debounce = function (fn, ms) {
  let t = 0;
  return function () {
    const args = arguments, self = this;
    clearTimeout(t);
    t = setTimeout(() => fn.apply(self, args), ms);
  };
};
/* 显式暴露到 window：顶层 const 不会自动挂载，影响调试与外部集成 */
if (typeof window !== "undefined") window.VB = VB;  /* 修复：toggleRank 依赖但未定义 */
VB.rand = (a, b) => a + Math.random() * (b - a);
VB.pick = arr => arr[Math.floor(Math.random() * arr.length)];
VB.TAU = Math.PI * 2;
VB.escapeHtml = str => String(str == null ? "" : str).replace(/[&<>"']/g, ch => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[ch]);

let toastTimer = 0;
VB.toast = msg => {
  const el = VB.$("#toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
};

/* ═══ 大气散射天空（自 poemverse v2.0 复用） ═══ */
const VB_SKY_VERT = `
varying vec3 vWorldDir;
void main(){
  vWorldDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const VB_SKY_FRAG = `
precision highp float;
varying vec3 vWorldDir;
uniform vec3 uSunDir;
uniform vec3 uZenithDay;
uniform vec3 uHorizonDay;
uniform vec3 uZenithNight;
uniform vec3 uHorizonNight;
uniform vec3 uSunColor;
uniform float uDay;
uniform float uGlow;
float rayleigh(float cosT){ return 0.75 * (1.0 + cosT * cosT); }
float mie(float cosT, float g){
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * 3.14159265 * pow(1.0 + g2 - 2.0 * g * cosT, 1.5));
}
void main(){
  vec3 dir = normalize(vWorldDir);
  float horizon = pow(1.0 - clamp(abs(dir.y) * 1.6, 0.0, 1.0), 2.2);
  vec3 zenith = mix(uZenithNight, uZenithDay, uDay);
  vec3 horiz  = mix(uHorizonNight, uHorizonDay, uDay);
  vec3 col = mix(zenith, horiz, horizon);
  float cosT = dot(dir, normalize(uSunDir));
  float sunUp = smoothstep(-0.15, 0.15, uSunDir.y);
  float r = rayleigh(cosT) * 0.28 * sunUp;
  col += vec3(0.28, 0.45, 0.85) * r * uDay * (0.35 + horizon * 0.65);
  float m = mie(cosT, 0.76) * 0.09 * sunUp;
  col += uSunColor * m * (0.5 + uGlow);
  float disk = smoothstep(0.9985, 0.9996, cosT);
  float halo = smoothstep(0.985, 0.999, cosT) * 0.5;
  col += uSunColor * (disk * 3.0 + halo) * sunUp;
  float dusk = uGlow * pow(1.0 - clamp(abs(dir.y) * 3.0, 0.0, 1.0), 3.0);
  float towardSun = pow(max(0.0, cosT), 2.0);
  col += uSunColor * dusk * towardSun * 1.1;
  float n = fract(sin(dot(floor(dir.xy * 240.0), vec2(12.9898,78.233))) * 43758.5453);
  float star = step(0.9985, n) * (1.0 - uDay) * smoothstep(0.0, 0.3, dir.y);
  col += vec3(star * 0.8);
  gl_FragColor = vec4(col, 1.0);
}`;
/* 城市白昼色板（晴朗蓝调）与夜色板 */
VB.buildSky = function () {
  const R = 900;
  const geo = new THREE.SphereGeometry(R, 32, 20);
  const uniforms = {
    uSunDir: { value: new THREE.Vector3(0.5, 0.6, 0.4).normalize() },
    uZenithDay: { value: new THREE.Color("#3f74b8") },
    uHorizonDay: { value: new THREE.Color("#cfe0ea") },
    uZenithNight: { value: new THREE.Color("#0a1024") },
    uHorizonNight: { value: new THREE.Color("#1c2640") },
    uSunColor: { value: new THREE.Color("#fff0d0") },
    uDay: { value: 1 }, uGlow: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    vertexShader: VB_SKY_VERT, fragmentShader: VB_SKY_FRAG,
    uniforms, side: THREE.BackSide, depthWrite: false, fog: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -100;
  mesh._setNeon = on => {
    uniforms.uDay.value = on ? 0.06 : 1;
    uniforms.uSunDir.value.set(0.5, on ? -0.3 : 0.6, 0.4).normalize();
    if (on) uniforms.uHorizonDay.value.set("#2c3350");
    else uniforms.uHorizonDay.value.set("#cfe0ea");
  };
  /* 昼夜时间驱动：tod 0夜→0.5正午→1夜，晨昏霞光自动 */
  mesh._applyTime = function (tod, mood) {
    const day = Math.min(1, Math.sin(tod * Math.PI) * 1.35 + 0.12);
    uniforms.uDay.value = day;
    const angle = (tod - 0.5) * Math.PI;
    uniforms.uSunDir.value.set(Math.cos(angle) * 0.85, Math.sin(angle) * 0.9, 0.35).normalize();
    const dT = Math.min(Math.abs(tod - 0.24), Math.abs(tod - 0.76));
    uniforms.uGlow.value = Math.max(0, 1 - dT * 6);
  };
  VB.skyUniforms = uniforms;
  return mesh;
};