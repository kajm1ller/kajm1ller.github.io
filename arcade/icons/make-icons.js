// Generates the PNG app icons (no image library needed): node arcade/icons/make-icons.js
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

function crc32(buf) {
    let c, crc = 0xffffffff;
    for (let n = 0; n < buf.length; n++) {
        c = (crc ^ buf[n]) & 0xff;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crc = (crc >>> 8) ^ c;
    }
    return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
}
function png(size, pix) {
    const stride = size * 4 + 1;
    const raw = Buffer.alloc(stride * size);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const [r, g, b] = pix(x / size, y / size);
            const o = y * stride + 1 + x * 4;
            raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = 255;
        }
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(size, 0);
    ihdr.writeUInt32BE(size, 4);
    ihdr[8] = 8; ihdr[9] = 6;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

// A gold coin with a "K" on a purple background; `scale` shrinks the art for the maskable safe zone
function art(scale) {
    return (u, v) => {
        const bg = mix([60, 28, 110], [12, 10, 18], Math.min(1, Math.hypot(u - 0.5, v - 0.2) * 1.3));
        const x = (u - 0.5) / scale, y = (v - 0.5) / scale, d = Math.hypot(x, y);
        if (d > 0.36) return bg;
        if (d > 0.325) return [138, 93, 8];
        const gold = mix([255, 233, 163], [200, 144, 28], Math.min(1, d / 0.33 + (y + 0.3) * 0.3));
        const stem = Math.abs(x + 0.09) < 0.04 && Math.abs(y) < 0.2;
        const arms = x > -0.09 && x < 0.15 && Math.abs(Math.abs(y) - (x + 0.09) * 0.9) < 0.04 && Math.abs(y) < 0.2;
        return stem || arms ? [90, 58, 0] : gold;
    };
}
const out = __dirname;
fs.writeFileSync(path.join(out, 'icon-512.png'), png(512, art(1.15)));
fs.writeFileSync(path.join(out, 'icon-192.png'), png(192, art(1.15)));
fs.writeFileSync(path.join(out, 'icon-180.png'), png(180, art(1.15)));
fs.writeFileSync(path.join(out, 'icon-maskable-512.png'), png(512, art(0.8)));
