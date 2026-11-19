/* VibeCity · 05 相机：航拍轨道 + 地面漫游 双模式 */
"use strict";

VB.camera = null;
VB.cam = {
  mode: "orbit",               /* orbit | walk */
  target: new THREE.Vector3(0, 10, 0),
  sph: { r: 420, theta: 0.9, phi: 0.62 },   // 球坐标
  drag: { on: false, x: 0, y: 0, x0: 0, y0: 0, btn: 0, moved: false },
  keys: { f: 0, b: 0, l: 0, r: 0 },
  eye: 3.0, vy: 0, onGround: true,
  flyTo: null,                 // {pos, t0, dur, from}
};

VB.initCamera = function () {
  VB.camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.5, 3000);
  VB.applyOrbit();
};

VB.applyOrbit = function () {
  const s = VB.cam.sph;
  const y = Math.max(6, s.r * Math.sin(s.phi));
  const rx = s.r * Math.cos(s.phi);
  VB.camera.position.set(
    VB.cam.target.x + rx * Math.sin(s.theta),
    y,
    VB.cam.target.z + rx * Math.cos(s.theta)
  );
  VB.camera.lookAt(VB.cam.target);
};

VB.setOrbit = function () { VB.cam.mode = "orbit"; VB.applyOrbit(); };

/* 地面漫游：贴地 + WASD */
VB.setWalk = function () {
  const c = VB.cam;
  c.mode = "walk";
  /* 从当前相机位置落到地面 */
  const h = 0;
  c.pos = VB.camera.position.clone();
  c.pos.y = h + c.eye;
  c.yaw = Math.atan2(VB.cam.target.x - c.pos.x, VB.cam.target.z - c.pos.z);
  c.pitch = -0.06;
};

VB.fpMove = function (e) {
  const c = VB.cam;
  if (c.mode !== "walk" || !c.fp) return;
  c.yaw -= (e.movementX || 0) * 0.0022;
  c.pitch = Math.max(-1.1, Math.min(1.1, c.pitch - (e.movementY || 0) * 0.0018));
};

VB.startDrag = function (x, y, btn) {
  const c = VB.cam;
  c.drag.on = true; c.drag.x = x; c.drag.y = y; c.drag.x0 = x; c.drag.y0 = y;
  c.drag.btn = btn || 0; c.drag.moved = false;
};
VB.moveDrag = function (x, y) {
  const c = VB.cam;
  if (!c.drag.on || c.flyTo) return;
  const dx = x - c.drag.x, dy = y - c.drag.y;
  c.drag.x = x; c.drag.y = y;
  if (Math.abs(x - c.drag.x0) > 6 || Math.abs(y - c.drag.y0) > 6) c.drag.moved = true;
  if (c.mode === "orbit") {
    const sph = c.sph;   /* 修复：s 原先只在右键分支声明，左键旋转会抛 ReferenceError */
    if (c.drag.btn === 2) { /* 右键平移 */
      const px = -dx * sph.r * 0.0012, pz = -dy * sph.r * 0.0012;
      c.target.x += px * Math.cos(sph.theta) + pz * Math.sin(sph.theta);
      c.target.z += -px * Math.sin(sph.theta) + pz * Math.cos(sph.theta);
    } else {
      sph.theta -= dx * 0.0055;
      sph.phi = Math.max(0.08, Math.min(1.35, sph.phi - dy * 0.004));
    }
    VB.applyOrbit();
  } else {
    c.yaw -= dx * 0.0052;
    c.pitch = Math.max(-1.1, Math.min(1.1, c.pitch - dy * 0.004));
  }
};
VB.endDrag = function () { VB.cam.drag.on = false; };
VB.wheelZoom = function (dy) {
  const c = VB.cam;
  if (c.mode !== "orbit") return;
  c.sph.r = Math.max(40, Math.min(1200, c.sph.r + dy * 0.4));
  VB.applyOrbit();
};

VB.setKey = function (code, down) {
  const k = VB.cam.keys;
  switch (code) {
    case "KeyW": case "ArrowUp": k.f = down ? 1 : 0; break;
    case "KeyS": case "ArrowDown": k.b = down ? 1 : 0; break;
    case "KeyA": case "ArrowLeft": k.l = down ? 1 : 0; break;
    case "KeyD": case "ArrowRight": k.r = down ? 1 : 0; break;
    case "ShiftLeft": case "ShiftRight": VB.keys = VB.keys || {}; VB.keys.shift = !!down; break;
    case "Space":
      if (down && VB.cam.mode === "walk" && VB.cam.onGround) { VB.cam.vy = 10; VB.cam.onGround = false; }
      break;
  }
};

/* 飞行定位：相机平滑飞向目标楼上空 */
VB.flyToBuilding = function (idx) {
  const p = VB.projPos[idx];
  if (!p) return;
  VB.cam.mode = "orbit";
  VB.cam.flyTo = {
    t: 0, dur: 1.6,
    fromT: VB.cam.target.clone(),
    fromR: VB.cam.sph.r, fromPhi: VB.cam.sph.phi, fromTheta: VB.cam.sph.theta,
    toT: new THREE.Vector3(p.x, Math.min(24, p.h + 6), p.z),
    toR: Math.max(60, p.h + 55), toPhi: 0.75, toTheta: VB.cam.sph.theta + 0.35,
  };
};

VB.updateCamera = function (dt, t) {
  const c = VB.cam;
  if (c.flyTo) {
    const f = c.flyTo;
    f.t += dt / f.dur;
    const k = f.t >= 1 ? 1 : (1 - Math.pow(1 - f.t, 3)); /* easeOutCubic */
    c.target.lerpVectors(f.fromT, f.toT, k);
    c.sph.r = f.fromR + (f.toR - f.fromR) * k;
    c.sph.phi = f.fromPhi + (f.toPhi - f.fromPhi) * k;
    c.sph.theta = f.fromTheta + (f.toTheta - f.fromTheta) * k;
    VB.applyOrbit();
    if (f.t >= 1) c.flyTo = null;
    return;
  }
  if (c.mode === "walk") {
    const speed = 16 * (VB.keys && VB.keys.shift ? 2.2 : 1);
    const fwd = new THREE.Vector3(Math.sin(c.yaw), 0, Math.cos(c.yaw));
    const right = new THREE.Vector3(Math.cos(c.yaw), 0, -Math.sin(c.yaw));
    const mv = new THREE.Vector3();
    if (c.keys.f) mv.add(fwd);
    if (c.keys.b) mv.sub(fwd);
    if (c.keys.r) mv.add(right);
    if (c.keys.l) mv.sub(right);
    if (mv.lengthSq() > 0) {
      mv.normalize().multiplyScalar(speed * dt);
      c.pos.add(mv);
    }
    /* 重力 + 地面（城市地面 y=0；允许上楼顶不处理碰撞，简化） */
    c.vy -= 26 * dt;
    c.pos.y += c.vy * dt;
    if (c.pos.y <= c.eye) { c.pos.y = c.eye; c.vy = 0; c.onGround = true; }
    /* 视线 */
    const look = new THREE.Vector3(
      c.pos.x - Math.sin(c.yaw) * Math.cos(c.pitch),
      c.pos.y + Math.sin(c.pitch) * 3,
      c.pos.z - Math.cos(c.yaw) * Math.cos(c.pitch)
    );
    VB.camera.position.copy(c.pos);
    VB.camera.lookAt(look);
  }
};

/* ═══ 双指缩放（移动端） ═══ */
VB._pinch = { pts: new Map(), dist: 0 };
VB.pinchDown = function (e) {
  const P = VB._pinch;
  P.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (P.pts.size === 2) {
    const [a, b] = [...P.pts.values()];
    P.dist = Math.hypot(a.x - b.x, a.y - b.y);
    VB.cam.drag.on = false; /* 双指时暂停旋转 */
  }
};
VB.pinchMove = function (e) {
  const P = VB._pinch;
  if (!P.pts.has(e.pointerId)) return;
  P.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (P.pts.size === 2 && P.dist > 0) {
    const [a, b] = [...P.pts.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    VB.wheelZoom((P.dist - d) * 2.2);
    P.dist = d;
  }
};
VB.pinchUp = function (e) { VB._pinch.pts.delete(e.pointerId); VB._pinch.dist = 0; };


/* ═══ 街区飞行：飞向某分类街区中心 ═══ */
VB._flyToCategory = function (cat) {
  const block = (VB.city.blocks || []).find(b => b.cat === cat);
  if (!block) { VB.toast("未找到该街区"); return; }
  const L = block.layout;
  VB.cam.mode = "orbit";
  VB.cam.flyTo = {
    t: 0, dur: 1.8,
    fromT: VB.cam.target.clone(),
    fromR: VB.cam.sph.r, fromPhi: VB.cam.sph.phi, fromTheta: VB.cam.sph.theta,
    toT: new THREE.Vector3(L.ox, 16, L.oz),
    toR: 165, toPhi: 0.72, toTheta: VB.cam.sph.theta + 0.28,
  };
  VB.toast("飞往 " + cat + " 街区 · " + (block.projIdx || []).length + " 栋楼");
};
