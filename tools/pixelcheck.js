/* PoemVerse 截图像素验收工具（纯 Node，零依赖）
   用法: node tools/pixelcheck.js <png1> <png2> ...
   输出: 每张图的天空/地面平均色、亮度直方图、ASCII 亮度构图、色彩多样性 */
const fs = require("fs");
const zlib = require("zlib");

function decodePNG(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not png");
  let pos = 8, width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.slice(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === "IDAT") idat.push(data);
    pos += 12 + len;
  }
  if (bitDepth !== 8 || colorType !== 2 || interlace !== 0) {
    throw new Error(`unsupported png: depth=${bitDepth} color=${colorType} interlace=${interlace}`);
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * 3;
  const out = Buffer.alloc(height * stride);
  // 逆滤波
  const paeth = (a, b, c) => {
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  let ri = 0;
  for (let y = 0; y < height; y++) {
    const f = raw[ri++];
    const line = y * stride;
    const prev = (y - 1) * stride;
    for (let x = 0; x < stride; x++) {
      const cur = raw[ri + x];
      const a = x >= 3 ? out[line + x - 3] : 0;
      const b = y > 0 ? out[prev + x] : 0;
      const c = y > 0 && x >= 3 ? out[prev + x - 3] : 0;
      let v;
      switch (f) {
        case 0: v = cur; break;
        case 1: v = cur + a; break;
        case 2: v = cur + b; break;
        case 3: v = cur + ((a + b) >> 1); break;
        case 4: v = cur + paeth(a, b, c); break;
        default: throw new Error("bad filter " + f);
      }
      out[line + x] = v & 255;
    }
    ri += stride;
  }
  return { width, height, data: out };
}

const GLYPHS = " .:-=+*#%@";
function report(file) {
  const { width, height, data } = decodePNG(file);
  const stride = width * 3;
  const avg = (y0a, y1a) => {
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = Math.floor(height * y0a); y < Math.floor(height * y1a); y += 2)
      for (let x = 0; x < width; x += 2) {
        const i = y * stride + x * 3;
        r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
      }
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  };
  const sky = avg(0.02, 0.12), horizon = avg(0.40, 0.52), ground = avg(0.70, 0.96);
  // ASCII 亮度图
  const AW = 72, AH = 26;
  let ascii = "";
  for (let ay = 0; ay < AH; ay++) {
    let row = "";
    for (let ax = 0; ax < AW; ax++) {
      let acc = 0, n = 0;
      const x0 = Math.floor(ax / AW * width), x1 = Math.floor((ax + 1) / AW * width);
      const y0 = Math.floor(ay / AH * height), y1 = Math.floor((ay + 1) / AH * height);
      for (let y = y0; y < y1; y += Math.max(1, Math.floor((y1 - y0) / 2)))
        for (let x = x0; x < x1; x += Math.max(1, Math.floor((x1 - x0) / 2))) {
          const i = y * stride + x * 3;
          acc += (data[i] + data[i + 1] + data[i + 2]) / 3; n++;
        }
      acc /= Math.max(1, n);
      row += GLYPHS[Math.min(GLYPHS.length - 1, Math.floor(acc / 256 * GLYPHS.length))];
    }
    ascii += row + "\n";
  }
  // 色彩多样性
  const buckets = new Set();
  let lit = 0, tot = 0;
  for (let y = 0; y < height; y += 5)
    for (let x = 0; x < width; x += 5) {
      const i = y * stride + x * 3;
      buckets.add(`${data[i] >> 5},${data[i + 1] >> 5},${data[i + 2] >> 5}`);
      tot++; if (data[i] + data[i + 1] + data[i + 2] > 60) lit++;
    }
  console.log(`\n===== ${file.split(/[\\/]/).pop()} (${width}x${height}) =====`);
  console.log(`sky[${sky}]  horizon[${horizon}]  ground[${ground}]  colorBuckets=${buckets.size}  lit=${(lit / tot * 100).toFixed(0)}%`);
  console.log(ascii);
}

process.argv.slice(2).forEach(report);