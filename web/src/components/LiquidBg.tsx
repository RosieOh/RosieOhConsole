import { useEffect, useRef, useState } from 'react';

/* 팔레트는 받은 다섯 톤의 단색 램프:
     #E5F3FC · #C1E7F7 · #A5D2E6 · #8BBFCF · #73A6C5
   한 계열이라 섞여도 탁해지지 않는다(보색을 섞으면 무채색이 된다).
   좌표계를 노이즈로 비틀기 때문에 원이 떠다니는 게 아니라 액체처럼 늘어나고 갈라진다. */

const VERT = `
attribute vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = `
precision highp float;
uniform vec2  u_res;
uniform float u_t;
uniform float u_dark;
uniform float u_boost;   // 이스터 에그 — 미러볼

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}
float blob(vec2 uv, vec2 c, float r) {
  float d = length(uv - c) / r;
  return exp(-d * d * 1.75);
}

/* 색상환 한 바퀴 — 미러볼이 쓴다 */
vec3 hue2rgb(float h) {
  return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
}

/* 오로라 커튼 한 겹 — 가로로 촘촘하고 세로로 길게 늘인 노이즈를 접으면(abs)
   세로 주름이 선다. 그 주름이 가로로 흐르면 커튼이 나부끼는 것처럼 보인다. */
float curtain(vec2 q, float t, float fx, float fy, float sx, float sy, float seed) {
  float n = fbm(vec2(q.x * fx + t * sx, q.y * fy - t * sy) + seed);
  return 1.0 - abs(n * 2.0 - 1.0);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  uv.y = 1.0 - uv.y;
  float ar = u_res.x / u_res.y;
  vec2 q = vec2(uv.x * ar, uv.y);

  float t = u_t;

  /* 큰 결로 한 번 비튼다 — 커튼이 곧은 띠가 아니라 휘게 */
  vec2 w1 = vec2(fbm(q * 1.15 + t * 0.055), fbm(q * 1.15 + 4.3 - t * 0.047)) - 0.5;
  q += w1 * 0.165;

  vec3 col = vec3(0.925, 0.969, 0.996);              // #ECF7FE

  vec2 c1 = vec2(0.167 * ar + sin(t * 0.104) * 0.235, 0.098 + cos(t * 0.085) * 0.175);
  vec2 c2 = vec2(0.903 * ar + cos(t * 0.151) * 0.260, 0.321 + sin(t * 0.211) * 0.205);
  vec2 c3 = vec2(0.505 * ar + sin(t * 0.131) * 0.295, 0.964 + cos(t * 0.112) * 0.150);
  vec2 c4 = vec2(0.486 * ar + cos(t * 0.256) * 0.280, 0.437 + sin(t * 0.171) * 0.235);
  vec2 c5 = vec2(0.748 * ar + sin(t * 0.284) * 0.210, 0.777 + cos(t * 0.236) * 0.195);
  vec2 c6 = vec2(0.230 * ar + cos(t * 0.188) * 0.250, 0.620 + sin(t * 0.143) * 0.215);

  float b1 = 1.0 + sin(t * 0.160) * 0.22;
  float b2 = 1.0 + cos(t * 0.117) * 0.18;

  // 바탕 — 은은한 색 지대. 오로라가 앉을 하늘.
  col = mix(col, vec3(0.463, 0.831, 0.804), blob(q, c2, 0.222 * b1) * 0.62);
  col = mix(col, vec3(0.655, 0.855, 0.969), blob(q, c3, 0.285 / b2) * 0.70);
  col = mix(col, vec3(0.310, 0.659, 0.831), blob(q, c5, 0.132 * b2) * 0.46);
  col = mix(col, vec3(0.498, 0.776, 0.937), blob(q, c6, 0.235 / b1) * 0.58);
  col = mix(col, vec3(0.600, 0.898, 0.878), blob(q, c4, 0.205 / b1) * 0.48);
  col = mix(col, vec3(1.000, 1.000, 1.000), blob(q, c1, 0.264 * b1) * 0.68);

  /* ── 오로라 ── 커튼 세 겹을 서로 다른 속도로 흘려 간섭시킨다.
     가로 주파수는 높게(촘촘한 세로 주름), 세로 주파수는 낮게(길게 늘어진 띠). */
  float a1 = curtain(q, t, 3.10, 0.46,  0.150, 0.042,  0.0);
  float a2 = curtain(q, t, 5.40, 0.33, -0.112, 0.031, 11.3);
  float a3 = curtain(q, t, 1.90, 0.62,  0.071, 0.019, 23.9);

  float veil = pow(max(a1 * 0.70 + a2 * 0.46 + a3 * 0.38 - 0.74, 0.0), 1.35);
  veil *= smoothstep(1.10, 0.05, uv.y);              // 위쪽이 밝다
  veil = min(veil, 1.0);

  /* 오로라 색 — 아래는 청록, 위로 갈수록 하늘에서 연보라로. 세로로 색이 변해야
     커튼처럼 읽힌다(한 가지 색이면 그냥 얼룩이다). */
  float h = clamp(uv.y * 1.25 + fbm(q * 0.7 + t * 0.03) * 0.45 - 0.22, 0.0, 1.0);
  vec3 glow = mix(mix(vec3(0.447, 0.925, 0.816),    // 청록
                      vec3(0.541, 0.835, 0.980), h),  // 하늘
                  vec3(0.776, 0.741, 0.976),          // 연보라
                  smoothstep(0.55, 1.0, 1.0 - h) * 0.55);

  col = mix(col, glow, veil * 0.62);
  // 주름 꼭대기만 하얗게 — 커튼의 날
  col = mix(col, vec3(1.0), pow(veil, 3.2) * 0.42);

  /* 밤 오로라 — 밝은 한 벌을 통째로 곱해 어둡게 하면 커튼까지 같이 죽는다.
     밤하늘은 '어두운 바탕 + 빛나는 커튼'이므로, 바탕은 깊게 깔고 커튼은 더한다. */
  vec3 night = vec3(0.012, 0.027, 0.055);                    // #03070E 더 깊은 밤하늘
  night += max(col - vec3(0.925, 0.969, 0.996), 0.0) * 0.10;   // 낮의 색 지대는 거의 버린다
  /* 네온 — 시안에서 보라, 끝에 마젠타. 어두운 바탕에서는 색이 진해야 빛으로 읽힌다. */
  vec3 neon = mix(mix(vec3(0.247, 0.925, 1.000),   // 전기 시안
                      vec3(0.396, 0.639, 1.000), h),  // 코발트
                  vec3(0.871, 0.388, 0.925),          // 마젠타
                  smoothstep(0.52, 1.0, 1.0 - h) * 0.75);
  night += neon * veil * 1.55;                               // 커튼은 더 세게                               // 커튼은 빛이라 더한다
  night += vec3(0.80, 0.96, 1.0) * pow(veil, 3.6) * 0.72;    // 주름 꼭대기는 희게 탄다
  col = mix(col, night, u_dark);

  /* ══ 미러볼 ══ 'Rosie 콘솔' 을 연달아 누르면 10초 동안 돈다.
     진짜 미러볼은 광선이 아니라 '네모난 빛 조각'이 방을 훑고 지나간다.
     각도·반지름을 칸으로 잘라 조각을 만들고, 그 격자를 통째로 돌린다.
     전체화면 고속 명멸(3Hz 이상)은 광과민성 발작을 유발하므로 전역 맥동은 ~1.7Hz 로 묶고,
     대신 조각 하나하나가 제각각 깜빡이게 해서 번쩍이는 체감을 만든다. */
  if (u_boost > 0.001) {
    vec2 pp = uv - vec2(0.5, 0.34);        // 공은 천장 쪽에 달려 있다
    pp.x *= ar;
    float ang = atan(pp.y, pp.x) / 6.2831853 + 0.5;
    float rad = length(pp);
    float spin = t * 0.17;

    vec3 light = vec3(0.0);
    // 격자 두 겹 — 큰 조각이 느리게, 잔 조각이 빠르게 돈다
    for (int k = 0; k < 2; k++) {
      float cols = k == 0 ? 34.0 : 54.0;
      float rows = k == 0 ? 15.0 : 23.0;
      float dir  = k == 0 ? 1.0 : -0.62;

      vec2 uvc = vec2((ang + spin * dir) * cols, rad * rows);
      vec2 cell = floor(uvc);
      vec2 f = fract(uvc);

      // 조각 — 가장자리를 부드럽게 해서 빛처럼 보이게
      float sq = smoothstep(0.10, 0.34, f.x) * smoothstep(0.90, 0.66, f.x)
               * smoothstep(0.14, 0.38, f.y) * smoothstep(0.86, 0.62, f.y);

      float r1 = hash(cell + float(k) * 31.7);
      float r2 = hash(cell + float(k) * 11.3 + 5.1);
      // 조각마다 제 리듬으로 깜빡인다(전역이 아니라 칸 단위라 안전하다)
      float on = smoothstep(0.45, 0.75, fract(r1 + t * (0.5 + r2 * 0.9)));
      vec3 tint = hue2rgb(fract(r2 + t * 0.09 + float(k) * 0.3));

      light += tint * sq * on * (k == 0 ? 1.0 : 0.65);
    }
    // 멀수록 흐려진다 — 방 저편으로 퍼지는 빛
    light *= 1.25 * exp(-rad * 0.85);

    // 공 자체 — 작게 빛나는 구
    float ball = smoothstep(0.075, 0.045, rad);
    light += vec3(1.0) * ball * (0.65 + 0.35 * sin(t * 9.0));
    light += vec3(1.0) * pow(max(0.0, 1.0 - rad * 3.2), 5.0) * 0.5;

    light *= 0.80 + 0.20 * sin(t * 10.6);     // 전역 맥동 ≈1.7Hz

    col = mix(col, clamp(light + col * 0.22, 0.0, 1.0), u_boost);
  }

  col += (hash(gl_FragCoord.xy + fract(t)) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}`;

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error((gl.getShaderInfoLog(s) || '컴파일 실패').trim().slice(0, 160));
  }
  return s;
}

export function LiquidBg() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [fail, setFail] = useState('');

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    let raf = 0;
    let gl: WebGLRenderingContext | null = null;

    try {
      gl = (cv.getContext('webgl', { antialias: false, alpha: false, depth: false }) ||
            cv.getContext('experimental-webgl')) as WebGLRenderingContext | null;
      if (!gl) throw new Error('getContext 가 null — 이 브라우저/기기에서 WebGL 사용 불가');

      const prog = gl.createProgram()!;
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        throw new Error((gl.getProgramInfoLog(prog) || '링크 실패').trim().slice(0, 160));
      }
      gl.useProgram(prog);

      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'p');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

      const uRes = gl.getUniformLocation(prog, 'u_res');
      const uT = gl.getUniformLocation(prog, 'u_t');
      const uDark = gl.getUniformLocation(prog, 'u_dark');
      const uBoost = gl.getUniformLocation(prog, 'u_boost');

      // 레티나에서 전면 프래그먼트 셰이더를 2배로 돌리면 팬이 돈다
      const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
      const resize = () => {
        const w = Math.max(1, Math.round(cv.clientWidth * dpr));
        const h = Math.max(1, Math.round(cv.clientHeight * dpr));
        if (cv.width !== w || cv.height !== h) {
          cv.width = w; cv.height = h;
          cv.dataset.size = `${cv.clientWidth}x${cv.clientHeight}@${dpr}`;
          gl!.viewport(0, 0, w, h);
        }
        gl!.uniform2f(uRes, cv.width, cv.height);
      };
      window.addEventListener('resize', resize);

      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const slow = reduce ? 0.5 : 1;
      // 이스터 에그 — 'Rosie 콘솔' 을 연달아 누르면 오로라가 한동안 과충전된다
      let boostUntil = 0;
      const onBoost = () => { boostUntil = performance.now() + 10000; };
      window.addEventListener('mx:aurora', onBoost);
      // 속도를 바꿔도 시간이 튀지 않게 누적으로 센다
      let tAccum = 0;
      let tPrev = performance.now();
      let checked = false;

      const frame = () => {
        raf = requestAnimationFrame(frame);
        if (document.hidden) return;
        resize();
        // float 정밀도가 20분 뒤에 뭉개지지 않게 감아준다
        const nowMs = performance.now();
        // 남은 시간에 따라 0 까지 부드럽게 내려온다(갑자기 꺼지면 깜짝 놀란다)
        const left = Math.max(0, boostUntil - nowMs) / 10000;
        const boost = left * left * (3 - 2 * left);          // smoothstep
        gl!.uniform1f(uBoost, boost);
        tAccum += ((nowMs - tPrev) / 1000) * slow * (1 + boost * 1.6);
        tPrev = nowMs;
        gl!.uniform1f(uT, tAccum % 3600);
        gl!.uniform1f(uDark, document.documentElement.dataset.theme === 'dark' ? 1 : 0);
        gl!.drawArrays(gl!.TRIANGLES, 0, 3);

        if (!checked) {
          checked = true;
          const px = new Uint8Array(4);
          gl!.readPixels(1, 1, 1, 1, gl!.RGBA, gl!.UNSIGNED_BYTE, px);
          if (px[0] === 0 && px[1] === 0 && px[2] === 0) {
            setFail('그렸는데 픽셀이 비었음 — 드라이버가 셰이더 출력을 버림');
          }
        }
      };
      raf = requestAnimationFrame(frame);

      return () => {
        cancelAnimationFrame(raf);
        window.removeEventListener('resize', resize);
        window.removeEventListener('mx:aurora', onBoost);
      };
    } catch (e) {
      setFail(e instanceof Error ? e.message : String(e));
      return () => cancelAnimationFrame(raf);
    }
  }, []);

  return (
    <>
      <canvas ref={ref} className="liquid-bg" aria-hidden="true" data-state={fail ? 'fail' : 'ok'} />
      {fail && <small className="liquid-bg-diag">WebGL 배경 꺼짐 · {fail}</small>}
    </>
  );
}
