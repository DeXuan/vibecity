#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""构建《VibeCity 码上创之城》单文件应用。
拼接 src/* 与 vendor/three.min.js -> index.html
构建后抽取 <script> 用 node --check 校验语法，并把 PV.VER 注入产物以便追溯。
用法: python build.py        （产物: index.html）
"""
import os, re, sys, datetime, subprocess, tempfile

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, "src")

def read(p, binary=False):
    with open(p, "rb" if binary else "r", encoding=None if binary else "utf-8") as f:
        return f.read()

def read_version():
    """从 src/02_tools.js 读取 PV.VER 的当前值（只读，不修改业务代码）。"""
    tools = read(os.path.join(SRC, "02_tools.js"))
    m = re.search(r'\bVER\s*:\s*["\']([^"\']+)["\']', tools)
    if not m:
        raise RuntimeError("无法在 src/02_tools.js 中解析 PV.VER")
    return m.group(1)

def validate_scripts(html):
    """抽取所有 <script> 内容写临时文件，用 node --check 校验，失败抛异常。"""
    scripts = re.findall(r"<script\b[^>]*>(.*?)</script>", html, re.S)
    if not scripts:
        raise RuntimeError("构建产物中未找到 <script> 区块")
    for i, code in enumerate(scripts, 1):
        fd, path = tempfile.mkstemp(suffix=".js")
        os.write(fd, code.encode("utf-8"))
        os.close(fd)
        try:
            try:
                r = subprocess.run(["node", "--check", path],
                                   capture_output=True, text=True)
            except FileNotFoundError:
                raise RuntimeError("node --check 不可用：请确认 node 已加入 PATH")
            if r.returncode != 0:
                detail = (r.stderr or r.stdout or "").strip()
                raise RuntimeError("JS 语法校验失败 (script #%d):\n%s" % (i, detail))
        finally:
            os.remove(path)

def css_minify(css):
    """极简 CSS 压缩：去注释与多余空白（保留字符串内样式的内容安全）。"""
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    css = re.sub(r"\s+", " ", css)
    css = re.sub(r"\s*([{}:;,>])\s*", r"\1", css)
    return css.strip()

def js_minify_safe(js):
    """不做真正压缩（保持可读、避免破坏），只去掉块注释和多余空行，控制体积。"""
    js = re.sub(r"/\*.*?\*/", "", js, flags=re.S)
    js = re.sub(r"\n\s*\n+", "\n", js)
    return js.strip()


def check_module_order(parts):
    """模块契约校验：确认 02_tools 定义 VB 全局后，后续模块才引用 VB 全局方法。
    （单文件应用不使用 ES Module 以保证 file:// 离线可用，此处以构建期校验补足约束）"""
    blob = "".join(parts)
    # 1) VB 必须由 02_tools.js 首先定义
    i_def = blob.find("const VB = {")
    i_first_use = blob.find("VB.city = {")
    if i_def < 0:
        raise SystemExit("[build] 模块契约错误：未找到 const VB 定义（02_tools.js）")
    if i_first_use >= 0 and i_first_use < i_def:
        raise SystemExit("[build] 模块契约错误：VB 在定义前被使用")
    # 2) 关键模块顺序：02 -> 03 -> 04 -> 05 -> 06 -> 07 -> 08
    order = ["02_tools", "03_data", "04_city", "05_camera", "06_ui", "07_main", "08_prefs"]
    pos = {}
    for name in order:
        marker = "/* ==== %s ==== */" % name
        pos[name] = blob.find(marker)
    missing = [n for n, v in pos.items() if v < 0]
    if missing:
        raise SystemExit("[build] 模块契约错误：缺少模块 %s" % ", ".join(missing))
    seq = [pos[n] for n in order]
    if seq != sorted(seq):
        raise SystemExit("[build] 模块契约错误：模块顺序不符合约定 02..08")
    print("[build] 模块契约校验通过（顺序 02→03→04→05→06→07→08）")

    # 3) 符号存在性校验：捕获「调用了未定义的 VB.xxx」这类致命错误
    import re as _re
    src_dir = os.path.join(ROOT, "src")
    all_src = ""
    for fn in sorted(os.listdir(src_dir)):
        if fn.endswith(".js"):
            all_src += read(os.path.join(src_dir, fn))
    # 收集所有定义过的 VB.xxx（赋值/函数/对象字面量成员）
    defined = set(_re.findall(r"VB\.([A-Za-z_$][\w$]*)\s*=", all_src))
    defined |= set(_re.findall(r"VB\.([A-Za-z_$][\w$]*)\s*:", all_src))
    # 收集所有被调用/引用的 VB.xxx
    used = set(_re.findall(r"VB\.([A-Za-z_$][\w$]*)\s*[(.]", all_src))
    # 白名单：来自 three.js 或运行时动态挂载
    allowlist = {"city", "cityGrow", "prefs", "perf", "ui", "cam", "audio", "scene", "renderer",
                 "camera", "canvas", "clock", "world", "sky", "tod", "timeFlow", "lowPerf",
                 "isMobile", "hemiLight", "dirLight", "escapeHtml", "projPos", "VER", "$", "$$",
                 "debounce", "toast", "rand", "pick", "TAU", "semanticGroup", "applyPrefs", "savePrefs"}
    missing = sorted(u for u in used if u not in defined and u not in allowlist)
    if missing:
        raise SystemExit("[build] 符号校验失败：以下 VB 成员被引用但从未定义 → %s" % ", ".join(missing))
    print("[build] 符号存在性校验通过")

def main():
    ver = read_version()
    parts = []
    # head: meta + css（PV_BUILD_VER 占位符稍后统一替换）
    css = css_minify(read(os.path.join(SRC, "01_style.css")))
    parts.append("""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no,viewport-fit=cover">
<meta name="robots" content="index,follow">
<meta name="description" content="VibeCity 码上创之城：把 CSDN 码上创大赛 410 份投稿项目，程序化生成一座可以走进去的 3D 城市。每项目一栋楼，分类即街区，票数即楼高。">>
<meta name="pv-build-ver" content="__PV_BUILD_VER__">
<title>VibeCity 码上创之城 · 410 栋灵感之楼</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0' stop-color='%23f5d9a8'/%3E%3Cstop offset='1' stop-color='%23c96a9e'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='100' height='100' rx='22' fill='%230b0d16'/%3E%3Ctext x='50' y='68' font-size='56' text-anchor='middle' fill='url(%23g)' font-family='serif'%3E梦%3C/text%3E%3C/svg%3E">
<link rel="manifest" href="manifest.json">
<meta name="theme-color" content="#0b0d16">
<style>
""" + css + """
</style>
</head>
<body>
<div id="boot"></div>
<div id="app" class="hide"></div>
<canvas id="c"></canvas>
<noscript><div style="font:14px/1.8 sans-serif;padding:40px;text-align:center">梦笔需要启用 JavaScript。</div></noscript>
<script>
window.PV_BUILD_VER = "__PV_BUILD_VER__";
""")
    # three.js 内联
    parts.append("\n/* ==== three.min.js r160 (内联) ==== */\n")
    with open(os.path.join(ROOT, "vendor", "three.min.js"), "r", encoding="utf-8", errors="ignore") as f:
        parts.append(f.read())
    # 应用源码（按序拼接）
    for f in sorted(os.listdir(SRC)):
        if f.endswith(".js") and re.match(r"^\d{2}_", f):
            js = js_minify_safe(read(os.path.join(SRC, f)))
            name = os.path.splitext(f)[0]
            parts.append("\n/* ==== %s ==== */\n" % name)
            parts.append(js)
    parts.append("""
</script>
</body>
</html>
""")
    html = "".join(parts).replace("__PV_BUILD_VER__", ver)

    # 构建后语法校验：失败则抛异常 -> 由 __main__ 捕获并报错退出
    validate_scripts(html)

    out = os.path.join(ROOT, "index.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(html)
    size = os.path.getsize(out) / 1024.0
    ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print("[build] JS 语法校验通过 (node --check)")
    check_module_order(parts)
    print("[build] OK -> index.html  ver=%s  %.1f KB  %s" % (ver, size, ts))

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("[build] FAILED: %s" % e, file=sys.stderr)
        sys.exit(1)
