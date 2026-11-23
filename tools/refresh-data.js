#!/usr/bin/env node
/**
 * VibeCity 数据刷新脚本
 * 从 CSDN 码上创公开接口拉取全部投稿，去重精简后写入 src/03_data.js
 *
 * 用法：
 *   node tools/refresh-data.js            # 刷新数据
 *   node tools/refresh-data.js --dry-run  # 只报告，不写文件
 *
 * 定时（Linux/macOS）：
 *   crontab -e
 *   每个 6 小时的整点执行：cd /path/to/vb-city && /usr/bin/node tools/refresh-data.js >> /tmp/vb-refresh.log 2>&1
 *
 * 刷新后需重新构建：python build.py && ./deploy.sh
 */
"use strict";
const fs = require("fs");
const path = require("path");
const https = require("https");

const API = "https://vb.csdn.net/api/products?all=1";
const OUT = path.join(__dirname, "..", "src", "03_data.js");
const DRY = process.argv.includes("--dry-run");

/* 链接归一化：接口返回的相对路径（/apps/xxx/）在静态站会 404，
   补全上游域名 vb.csdn.net 使其成为可用外链 */
const UPSTREAM = "https://vb.csdn.net";
function normalizeUrl(u) {
  const raw = String(u || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw.slice(0, 200);
  if (raw.startsWith("//")) return ("https:" + raw).slice(0, 200);
  if (raw.startsWith("/")) return (UPSTREAM + raw).slice(0, 200);
  return (UPSTREAM + "/" + raw).slice(0, 200);
}

const CATS = ["生活", "校园", "游戏", "社交", "健身", "公益", "户外", "K12", "研发", "个人效率", "学习科研", "面试、路演", "纪念代码", "其他"];

function fetchOnce(url, useProxy) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : require("http");
    const opts = { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } };
    /* 直连模式：绕过系统代理（部分环境代理会 RST 掉该域名） */
    if (!useProxy) opts.agent = new mod.Agent({ keepAlive: false });
    const req = mod.get(url, opts, res => {
      if (res.statusCode !== 200) return reject(new Error("HTTP " + res.statusCode));
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
        catch (e) { reject(new Error("JSON 解析失败：" + e.message)); }
      });
    });
    req.on("error", reject);
    req.setTimeout(25000, () => req.destroy(new Error("超时 25s")));
  });
}

/* 通道 3：调用系统 curl（Node 内置 DNS 在部分网络环境解析到不可达 IP，
   curl 走系统解析/代理，是实际可用路径；零新增依赖） */
function fetchViaCurl(url) {
  const { execFileSync } = require("child_process");
  const raw = execFileSync("curl", ["-s", "--noproxy", "*", "-m", "40",
    "-H", "User-Agent: Mozilla/5.0", "-H", "Accept: application/json", url],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(raw);
}

async function fetchJSON(url) {
  const attempts = [
    { fn: () => fetchOnce(url, false), label: "直连" },
    { fn: () => fetchViaCurl(url),      label: "curl" },
    { fn: () => fetchOnce(url, true),   label: "默认通道" },
  ];
  let lastErr;
  for (const a of attempts) {
    try {
      const data = await a.fn();
      if (!Array.isArray(data)) throw new Error("返回非数组");
      console.log("[refresh] 通道 " + a.label + " 成功（" + data.length + " 条）");
      return data;
    } catch (e) {
      lastErr = e;
      console.warn("[refresh] 通道 " + a.label + " 失败：" + String(e.message || e).slice(0, 80));
      await new Promise(r => setTimeout(r, 800));
    }
  }
  throw lastErr;
}

function catOf(x) {
  for (const c of (x.categories || [])) if (CATS.includes(c)) return c;
  return "其他";
}

(async () => {
  console.log("[refresh] 拉取 " + API);
  let raw;
  try {
    raw = await fetchJSON(API);
  } catch (e) {
    console.error("[refresh] 拉取失败：" + e.message);
    process.exit(1);
  }
  if (!Array.isArray(raw)) {
    console.error("[refresh] 接口返回格式异常（非数组），已中止以免破坏数据");
    process.exit(1);
  }
  console.log("[refresh] 原始投稿 " + raw.length + " 条");

  /* 去重：同名取票数最高 */
  const best = new Map();
  for (const x of raw) {
    const n = x.name;
    if (!n) continue;
    const prev = best.get(n);
    if (!prev || (x.voteCount || 0) > (prev.voteCount || 0)) best.set(n, x);
  }

  const items = [];
  for (const x of best.values()) {
    const r = x.avgRatings || {};
    const dims = [r.creativity || 0, r.completeness || 0, r.usefulness || 0, r.experience || 0];
    const avg = r.creativity !== undefined
      ? Math.round(dims.reduce((a, b) => a + b, 0) / 4 * 100) / 100
      : 0;
    const item = {
      n: String(x.name).slice(0, 24),
      t: String(x.tagline || "").slice(0, 50),
      c: catOf(x),
      v: x.voteCount || 0,
      r: avg,
      u: normalizeUrl(x.url),
      p: x.appPlatformLabel || ""
    };
    /* 四维拆解（创意/完整/实用/体验），全为 0 时不写入以省体积 */
    if (dims.some(d => d > 0)) item.d = dims.map(d => Math.round(d * 10) / 10);
    items.push(item);
  }
  items.sort((a, b) => b.v - a.v);

  const cats = {};
  items.forEach(it => { cats[it.c] = (cats[it.c] || 0) + 1; });
  console.log("[refresh] 去重后 " + items.length + " 项");
  console.log("[refresh] 分类分布：" + JSON.stringify(cats));

  /* 数据健全性校验：防止上游改格式导致城市塌陷 */
  const bad = items.filter(it => !it.n || !it.c);
  if (bad.length > items.length * 0.2) {
    console.error("[refresh] 异常：超过 20% 记录缺少名称/分类，已中止");
    process.exit(1);
  }

  const out = "/* VibeCity 数据：" + items.length + " 独特项目（由 " + raw.length + " 投稿去重精简）\n"
    + "   last refreshed: " + new Date().toISOString() + "\n"
    + "   刷新命令：node tools/refresh-data.js */\n"
    + "window.VB_DATA = " + JSON.stringify(items) + ";\n";

  if (DRY) {
    console.log("[refresh] --dry-run：不写入文件。预计 " + Buffer.byteLength(out) + " 字节");
    return;
  }
  fs.writeFileSync(OUT, out, "utf8");
  console.log("[refresh] 已写入 " + OUT + "（" + Math.round(Buffer.byteLength(out) / 1024) + " KB）");
  console.log("[refresh] 下一步：python build.py && ./deploy.sh");
})().catch(e => {
  console.error("[refresh] 未预期异常：" + e.message);
  process.exit(1);
});