const VERT = 'attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }';
const FRAG = (deriv) => `${deriv ? '#extension GL_OES_standard_derivatives : enable\n' : ''}precision highp float;
uniform sampler2D uLights; uniform sampler2D uLand; uniform sampler2D uOvA; uniform sampler2D uOvB;
uniform vec2 uRes; uniform vec3 uGlobe; uniform vec2 uView; uniform vec3 uCapN; uniform vec3 uCapS; uniform float uCapA;
uniform vec2 uSun; uniform float uOvMix; uniform vec2 uOvShift; uniform float uAurGain; uniform float uHatchA; uniform float uDayTint; uniform float uDpr;
uniform vec4 uCov0; uniform vec4 uCov1; uniform vec4 uCov2;
uniform vec3 uNightSea; uniform vec3 uNightLand; uniform vec3 uDaySea; uniform vec3 uDayLand; uniform vec3 uLightsC; uniform vec3 uGold; uniform vec3 uGrid; uniform vec3 uInk;
uniform vec3 uAur; uniform vec3 uAurHi; uniform vec3 uTint; uniform float uDark;
const float PI = 3.14159265;
const float D2R = 0.0174532925;
vec3 vecOf(float lat, float lon) { return vec3(cos(lat) * cos(lon), cos(lat) * sin(lon), sin(lat)); }
float ovAt(float lat, float lon) {
  float la = lat / D2R;
  vec2 uvA = vec2((mod(lon / D2R + uOvShift.x, 360.0) + 0.5) / 362.0, (la + 90.5) / 181.0);
  vec2 uvB = vec2((mod(lon / D2R + uOvShift.y, 360.0) + 0.5) / 362.0, (la + 90.5) / 181.0);
  return mix(texture2D(uOvA, uvA).r, texture2D(uOvB, uvB).r, uOvMix) * 255.0;
}
float covered(float lat, float lon, vec4 c) {
  if (c.w < 0.5) return 0.0;
  float ca = cos(lat) * cos(lon - c.x * D2R);
  return step(cos(c.y * D2R), ca) * step(abs(lat) / D2R, c.z);
}
vec4 surface(float lat, float lon, float z, bool cap) {
  vec2 uv = vec2(fract((lon / D2R + 180.0) / 360.0), clamp((90.0 - lat / D2R) / 180.0, 0.0, 1.0));
  float land = texture2D(uLand, uv).r;
  float lights = smoothstep(0.05, 0.5, texture2D(uLights, uv).r);
  vec3 sun = vecOf(uSun.x, uSun.y), p = vecOf(lat, lon);
  float cz = dot(p, sun);
  float day = smoothstep(-0.30, 0.05, cz);
  vec3 col = mix(mix(uNightSea, uNightLand, land), mix(uDaySea, uDayLand, land), day);
  col = mix(col, uTint, uDayTint * smoothstep(-0.05, 0.1, cz));
  float night = 1.0 - smoothstep(-0.2, 0.02, cz);
  float L = lights * night;
  col = mix(col, uLightsC, clamp(L * (uDark > 0.5 ? 1.15 : 0.9), 0.0, 1.0));
  if (uDark > 0.5) col = mix(col, vec3(1.0, 0.97, 0.88), smoothstep(0.55, 1.0, L) * 0.6);
  ${deriv ? `col = mix(col, uGold, clamp(fwidth(land) * 1.6, 0.0, 1.0) * 0.35 * (uDark > 0.5 ? 1.0 : 1.15));` : ''}
  if (!cap) {
    float latD = lat / D2R, lonD = lon / D2R;
    float dLat = 15.0 - abs(mod(latD, 30.0) - 15.0), dLon = 15.0 - abs(mod(lonD + 360.0, 30.0) - 15.0);
    ${deriv ? `float fLat = max(fwidth(latD), 1e-4), fLon = max(min(fwidth(lonD), fwidth(mod(lonD + 360.0, 360.0))), 1e-4);
    float grid = max(1.0 - smoothstep(0.4, 1.3, dLat / fLat), (1.0 - smoothstep(0.4, 1.3, dLon / fLon)) * step(abs(latD), 88.0));` : `float k = D2R * uGlobe.z * max(z, 0.15);
    float grid = max(1.0 - smoothstep(0.4, 1.3, dLat * k), (1.0 - smoothstep(0.4, 1.3, dLon * cos(lat) * k)) * step(abs(latD), 88.0));`}
    col = mix(col, uGrid, grid * (uDark > 0.5 ? 0.09 : 0.12));
  }
  float term = exp(-pow(cz / 0.006, 2.0));
  col = mix(col, uGold, term * 0.45);
  if (!cap) {
    float cov = max(max(covered(lat, lon, uCov0), covered(lat, lon, uCov1)), covered(lat, lon, uCov2));
    float sp = 7.0 * uDpr;
    float stripe = 1.0 - smoothstep(0.45 * uDpr, 1.1 * uDpr, abs(mod(gl_FragCoord.x + gl_FragCoord.y, sp) - 0.5 * sp));
    col = mix(col, uInk, (1.0 - cov) * stripe * 0.18 * uHatchA);
    col *= 0.75 + 0.25 * smoothstep(0.0, 0.25, z);
  }
  return vec4(col, cz);
}
float aurAt(vec3 q, float s, float zs, bool limb) {
  float lat = asin(clamp(q.z, -1.0, 1.0));
  float lon = atan(q.y, q.x);
  float v = ovAt(lat, lon);
  float cz = dot(vecOf(lat, lon), vecOf(uSun.x, uSun.y));
  float dayS = smoothstep(-0.30, 0.05, cz);
  float a = smoothstep(4.0, 45.0, v) * (1.0 - 0.85 * dayS);
  if (limb) a *= clamp(0.35 * s / max(zs, 1e-3), 1.0, 2.6);
  return a * uAurGain;
}
vec3 toWorld(vec3 v, float lat0, float lon0) {
  vec3 e = vec3(-sin(lon0), cos(lon0), 0.0);
  vec3 n = vec3(-sin(lat0) * cos(lon0), -sin(lat0) * sin(lon0), cos(lat0));
  vec3 c = vec3(cos(lat0) * cos(lon0), cos(lat0) * sin(lon0), sin(lat0));
  return normalize(v.x * e + v.y * n + v.z * c);
}
void main() {
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 d = (px - uGlobe.xy) / uGlobe.z;
  float r2 = dot(d, d);
  float aGreen = 1.017, aRed = 1.034;
  if (r2 < aRed * aRed) {
    vec3 col = vec3(0.0); float alpha = 0.0;
    float x = d.x, y = -d.y;
    if (r2 < 1.0) {
      float z = sqrt(1.0 - r2);
      vec3 w = toWorld(vec3(x, y, z), uView.x, uView.y);
      vec4 s = surface(asin(clamp(w.z, -1.0, 1.0)), atan(w.y, w.x), z, false);
      alpha = 1.0 - smoothstep(1.0 - 1.5 / uGlobe.z, 1.0, sqrt(r2));
      col = s.rgb * alpha;
    }
    float zg = sqrt(max(aGreen * aGreen - r2, 0.0));
    float ag = r2 < aGreen * aGreen ? aurAt(toWorld(vec3(x, y, zg) / aGreen, uView.x, uView.y), aGreen, zg, true) : 0.0;
    float zr = sqrt(max(aRed * aRed - r2, 0.0));
    vec3 wr = toWorld(vec3(x, y, zr) / aRed, uView.x, uView.y);
    float vr = ovAt(asin(clamp(wr.z, -1.0, 1.0)), atan(wr.y, wr.x));
    float ar = aurAt(wr, aRed, zr, true) * 0.45 * smoothstep(12.0, 40.0, vr);
    float k = uDark > 0.5 ? 1.0 : 0.8;
    ag = clamp(ag * k, 0.0, 1.0); ar = clamp(ar * k, 0.0, 1.0);
    col = col * (1.0 - (uDark > 0.5 ? 0.2 : 1.0) * ag) + uAur * ag; alpha = alpha + (1.0 - alpha) * ag;
    col = col * (1.0 - (uDark > 0.5 ? 0.2 : 1.0) * ar) + uAurHi * ar; alpha = alpha + (1.0 - alpha) * ar;
    gl_FragColor = vec4(col, alpha);
    return;
  }
  for (int k = 0; k < 2; k++) {
    vec3 cap = k == 0 ? uCapN : uCapS;
    if (uCapA <= 0.0 || cap.z <= 0.0) continue;
    vec2 q = (px - cap.xy) / cap.z;
    float rr = dot(q, q);
    if (rr >= 1.0) continue;
    float sgn = k == 0 ? 1.0 : -1.0;
    float rho = sqrt(rr) * 0.70710678;
    float lat = sgn * acos(clamp(rho, 0.0, 1.0));
    float th = atan(-sgn * q.x, -q.y);
    float lon = uSun.y + th;
    vec4 s = surface(lat, lon, 1.0, true);
    vec3 col = s.rgb;
    float a = aurAt(vecOf(lat, lon), 1.0, 1.0, false);
    a = clamp(a, 0.0, 1.0);
    col = uDark > 0.5 ? col * (1.0 - 0.2 * a) + uAur * a : mix(col, uAur, clamp(a * 0.8, 0.0, 1.0));
    float edge = 1.0 - smoothstep(1.0 - 1.5 / cap.z, 1.0, sqrt(rr));
    gl_FragColor = vec4(col * edge * uCapA, edge * uCapA);
    return;
  }
  gl_FragColor = vec4(0.0);
}`;

export function hexRgb(c) {
  const m = /rgba?\(([^)]+)\)/.exec(c);
  if (m) return m[1].split(',').slice(0, 3).map((x) => +x / 255);
  const h = c.replace('#', '');
  const v = h.length === 3 ? h.split('').map((x) => x + x) : [h.slice(0, 2), h.slice(2, 4), h.slice(4, 6)];
  return v.map((x) => parseInt(x, 16) / 255);
}

const UNIFORMS = ['uLights', 'uLand', 'uOvA', 'uOvB', 'uRes', 'uGlobe', 'uView', 'uCapN', 'uCapS', 'uCapA', 'uSun', 'uOvMix', 'uOvShift', 'uAurGain', 'uHatchA', 'uDayTint', 'uDpr',
  'uCov0', 'uCov1', 'uCov2', 'uNightSea', 'uNightLand', 'uDaySea', 'uDayLand', 'uLightsC', 'uGold', 'uGrid', 'uInk', 'uAur', 'uAurHi', 'uTint', 'uDark'];

export function initGl(cv) {
  let g = null;
  try { g = cv.getContext('webgl', { premultipliedAlpha: true, antialias: false, alpha: true }) || cv.getContext('experimental-webgl'); } catch { g = null; }
  if (!g) return null;
  const deriv = !!g.getExtension('OES_standard_derivatives');
  const sh = (type, src) => { const s = g.createShader(type); g.shaderSource(s, src); g.compileShader(s); if (!g.getShaderParameter(s, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(s) || 'shader'); return s; };
  try {
    const pr = g.createProgram();
    g.attachShader(pr, sh(g.VERTEX_SHADER, VERT)); g.attachShader(pr, sh(g.FRAGMENT_SHADER, FRAG(deriv))); g.linkProgram(pr);
    if (!g.getProgramParameter(pr, g.LINK_STATUS)) throw new Error('link');
    g.useProgram(pr);
    const buf = g.createBuffer(); g.bindBuffer(g.ARRAY_BUFFER, buf);
    g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), g.STATIC_DRAW);
    const loc = g.getAttribLocation(pr, 'p'); g.enableVertexAttribArray(loc); g.vertexAttribPointer(loc, 2, g.FLOAT, false, 0, 0);
    const U = {};
    for (const n of UNIFORMS) U[n] = g.getUniformLocation(pr, n);
    const tex = [0, 1, 2, 3].map((k) => { const t = g.createTexture(); g.activeTexture(g.TEXTURE0 + k); g.bindTexture(g.TEXTURE_2D, t); return t; });
    g.uniform1i(U.uLights, 0); g.uniform1i(U.uLand, 1); g.uniform1i(U.uOvA, 2); g.uniform1i(U.uOvB, 3);
    return { g, U, tex, deriv };
  } catch { return null; }
}

export function uploadImage(G, k, im) {
  const { g } = G;
  g.activeTexture(g.TEXTURE0 + k); g.bindTexture(g.TEXTURE_2D, G.tex[k]);
  g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  g.pixelStorei(g.UNPACK_COLORSPACE_CONVERSION_WEBGL, g.NONE);
  g.texImage2D(g.TEXTURE_2D, 0, g.LUMINANCE, g.LUMINANCE, g.UNSIGNED_BYTE, im);
  g.generateMipmap(g.TEXTURE_2D);
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR_MIPMAP_LINEAR); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.REPEAT); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
}

export function uploadGrid(G, k, grid) {
  const { g } = G;
  g.activeTexture(g.TEXTURE0 + k); g.bindTexture(g.TEXTURE_2D, G.tex[k]);
  g.pixelStorei(g.UNPACK_ALIGNMENT, 1);
  g.texImage2D(g.TEXTURE_2D, 0, g.LUMINANCE, 362, 181, 0, g.LUMINANCE, g.UNSIGNED_BYTE, grid);
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
}

export function drawGl(G, P) {
  const { g, U } = G;
  g.viewport(0, 0, g.canvas.width, g.canvas.height);
  g.clearColor(0, 0, 0, 0); g.clear(g.COLOR_BUFFER_BIT);
  g.uniform2f(U.uRes, g.canvas.width, g.canvas.height);
  g.uniform3f(U.uGlobe, ...P.globe); g.uniform2f(U.uView, ...P.view);
  g.uniform3f(U.uCapN, ...P.capN); g.uniform3f(U.uCapS, ...P.capS); g.uniform1f(U.uCapA, P.capA);
  g.uniform2f(U.uSun, ...P.sun); g.uniform1f(U.uOvMix, P.ovMix); g.uniform2f(U.uOvShift, ...P.ovShift);
  g.uniform1f(U.uAurGain, P.aurGain); g.uniform1f(U.uHatchA, P.hatchA); g.uniform1f(U.uDayTint, P.dayTint); g.uniform1f(U.uDpr, P.dpr);
  g.uniform4f(U.uCov0, ...P.cov[0]); g.uniform4f(U.uCov1, ...P.cov[1]); g.uniform4f(U.uCov2, ...P.cov[2]);
  for (const k of ['NightSea', 'NightLand', 'DaySea', 'DayLand', 'LightsC', 'Gold', 'Grid', 'Ink', 'Aur', 'AurHi', 'Tint']) g.uniform3fv(U['u' + k], P.colors[k]);
  g.uniform1f(U.uDark, P.dark ? 1 : 0);
  g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
}
