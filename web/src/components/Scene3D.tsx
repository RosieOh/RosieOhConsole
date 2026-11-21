import { useEffect, useRef } from 'react';

/* 로그인 첫 화면의 3D 배경 — 로고의 고리(o)와 점을 크게, 주위로 작은 고리·입자가 천천히 떠다닌다.
   - three 는 여기서만 동적으로 불러온다(로그인 화면에서만 받는다, 콘솔 본체 크기에 안 들어감)
   - 테마(밝게/어둡게)를 따라 색을 바꾼다(html[data-theme] 를 지켜본다)
   - 움직임 줄이기 설정이면 한 장만 그린다. WebGL 이 안 되면 onFail → 기존 오로라 배경으로
   - 마우스·손가락 위치로 시점이 살짝 따라간다 */

const PALETTE = {
  light: { ring: 0xe0435a, dot: 0xe0435a, small: [0xf4a6b3, 0xffc9a8, 0xc9c2ff, 0xa9d8ff], dust: 0xd98a96, fog: 0xf3eef0, key: 0xffffff, rim: 0xffb3c1, amb: 0.75 },
  dark: { ring: 0xe0435a, dot: 0xff6f86, small: [0x7a2e3b, 0x8a5a3c, 0x4b4580, 0x2f5878], dust: 0xff8fa3, fog: 0x15131a, key: 0xffe7ec, rim: 0xe0435a, amb: 0.35 },
};

/**
 * 담긴 상자(부모)를 채운다. focusX·focusY: 고리를 둘 자리(상자 안 비율, 0~1).
 * subtle: 작은 고리·입자를 줄이고 느리게 — 로그인 왼쪽 패널처럼 배경으로 은은하게 둘 때
 */
export function Scene3D({ onFail, focusX = 0.5, focusY = 0.42, subtle = true }: { onFail?: () => void; focusX?: number; focusY?: number; subtle?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const focus = useRef({ x: focusX, y: focusY });
  focus.current = { x: focusX, y: focusY };

  useEffect(() => {
    let stop = () => {};
    let gone = false;
    import('three').then((T) => {
      const el = box.current;
      if (gone || !el) return;
      let renderer: InstanceType<typeof T.WebGLRenderer>;
      try {
        renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
      } catch { onFail?.(); return; }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.outputColorSpace = T.SRGBColorSpace;
      renderer.toneMapping = T.ACESFilmicToneMapping;
      el.appendChild(renderer.domElement);

      const scene = new T.Scene();
      const camera = new T.PerspectiveCamera(42, 1, 0.1, 100);
      camera.position.set(0, 0, 11);
      scene.fog = new T.Fog(0xffffff, 9, 26);

      // ── 빛 ──
      const amb = new T.AmbientLight(0xffffff, 0.6);
      const key = new T.DirectionalLight(0xffffff, 2.2); key.position.set(4, 6, 8);
      const rim = new T.PointLight(0xffffff, 40, 30); rim.position.set(-6, -3, 4);
      scene.add(amb, key, rim);

      // ── 주인공: 로고의 고리와 점 ──
      const hero = new T.Group();
      const ringMat = new T.MeshPhysicalMaterial({ roughness: 0.22, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.15, sheen: 0.4 });
      const ring = new T.Mesh(new T.TorusGeometry(1.75, 0.5, 64, 180), ringMat);
      const dotMat = new T.MeshPhysicalMaterial({ roughness: 0.3, metalness: 0.1, clearcoat: 1 });
      const dot = new T.Mesh(new T.SphereGeometry(0.42, 48, 48), dotMat);
      hero.add(ring, dot);
      scene.add(hero);

      // ── 떠다니는 작은 고리들(인스턴스 하나로) ──
      const N = subtle ? 16 : 46;
      const smallGeo = new T.TorusGeometry(0.32, 0.09, 16, 48);
      const smallMat = new T.MeshStandardMaterial({ roughness: 0.45, metalness: 0.05, transparent: true, opacity: 0.85 });
      const smalls = new T.InstancedMesh(smallGeo, smallMat, N);
      const seeds = Array.from({ length: N }, () => ({
        x: (Math.random() - 0.5) * 22, y: (Math.random() - 0.5) * 13, z: -2 - Math.random() * 12,
        s: 0.5 + Math.random() * 1.3, rx: Math.random() * Math.PI, ry: Math.random() * Math.PI,
        vx: (Math.random() - 0.5) * (subtle ? 0.12 : 0.25), vy: (subtle ? 0.04 : 0.08) + Math.random() * (subtle ? 0.1 : 0.22), spin: (Math.random() - 0.5) * 0.8, c: Math.floor(Math.random() * 4),
      }));
      scene.add(smalls);

      // ── 먼지(입자) ──
      const P = subtle ? 180 : 520;
      const pos = new Float32Array(P * 3);
      for (let i = 0; i < P; i++) { pos[i * 3] = (Math.random() - 0.5) * 30; pos[i * 3 + 1] = (Math.random() - 0.5) * 18; pos[i * 3 + 2] = -Math.random() * 16; }
      const dustGeo = new T.BufferGeometry();
      dustGeo.setAttribute('position', new T.BufferAttribute(pos, 3));
      const dustMat = new T.PointsMaterial({ size: 0.05, transparent: true, opacity: 0.7, depthWrite: false });
      const dust = new T.Points(dustGeo, dustMat);
      scene.add(dust);

      // ── 테마 색 ──
      const tmp = new T.Color();
      const applyTheme = () => {
        const p = document.documentElement.dataset.theme === 'dark' ? PALETTE.dark : PALETTE.light;
        ringMat.color.setHex(p.ring); dotMat.color.setHex(p.dot);
        dustMat.color.setHex(p.dust); (scene.fog as InstanceType<typeof T.Fog>).color.setHex(p.fog);
        amb.intensity = p.amb; key.color.setHex(p.key); rim.color.setHex(p.rim);
        seeds.forEach((s, i) => smalls.setColorAt(i, tmp.setHex(p.small[s.c])));
        if (smalls.instanceColor) smalls.instanceColor.needsUpdate = true;
      };
      applyTheme();
      const themeWatch = new MutationObserver(applyTheme);
      themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

      // ── 크기 — 상자 비율(focusX·Y)의 자리에, 상자가 작으면 고리도 작게 ──
      const fit = () => {
        const w = el.clientWidth || window.innerWidth, h = el.clientHeight || window.innerHeight;
        renderer.setSize(w, h, false);
        camera.aspect = w / h; camera.updateProjectionMatrix();
        // 상자 비율 → 세계 좌표. 카메라 z=11, 세로 시야 42°, 고리는 z=-1.5
        const halfH = Math.tan((42 / 2) * Math.PI / 180) * (11 + 1.5), halfW = halfH * camera.aspect;
        hero.position.set((focus.current.x * 2 - 1) * halfW, (1 - focus.current.y * 2) * halfH, -1.5);
        hero.scale.setScalar(Math.min(0.95, Math.max(0.42, Math.min(w, h * 1.15) / 860)));
      };
      fit();
      const ro = new ResizeObserver(fit);
      ro.observe(el);

      // ── 시점 따라가기 ──
      const aim = { x: 0, y: 0 };
      const onMove = (e: PointerEvent) => { aim.x = (e.clientX / window.innerWidth - 0.5) * 2; aim.y = (e.clientY / window.innerHeight - 0.5) * 2; };
      window.addEventListener('pointermove', onMove, { passive: true });

      const m = new T.Matrix4(), q = new T.Quaternion(), e3 = new T.Euler(), v = new T.Vector3(), sc = new T.Vector3();
      const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const clock = new T.Clock();
      let raf = 0;
      const frame = () => {
        const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
        const k = subtle ? 0.6 : 1;
        ring.rotation.set(0.5 + Math.sin(t * 0.3 * k) * 0.25, t * 0.35 * k, Math.sin(t * 0.2 * k) * 0.1);
        dot.position.set(Math.cos(t * 0.8 * k) * 2.7, 1.6 + Math.sin(t * 1.1 * k) * 0.35, Math.sin(t * 0.8 * k) * 1.2);
        hero.rotation.y = Math.sin(t * 0.15) * 0.2;
        seeds.forEach((s, i) => {
          if (!still) { s.x += s.vx * dt; s.y += s.vy * dt; s.rx += s.spin * dt; s.ry += s.spin * 0.7 * dt; }
          if (s.y > 7.5) { s.y = -7.5; s.x = (Math.random() - 0.5) * 22; }
          if (s.x > 12) s.x = -12; else if (s.x < -12) s.x = 12;
          m.compose(v.set(s.x, s.y, s.z), q.setFromEuler(e3.set(s.rx, s.ry, 0)), sc.setScalar(s.s));
          smalls.setMatrixAt(i, m);
        });
        smalls.instanceMatrix.needsUpdate = true;
        dust.rotation.y = t * 0.012; dust.position.y = Math.sin(t * 0.1) * 0.3;
        camera.position.x += (aim.x * (subtle ? 0.5 : 0.9) - camera.position.x) * 0.04;
        camera.position.y += (-aim.y * (subtle ? 0.35 : 0.6) - camera.position.y) * 0.04;
        camera.lookAt(0, 0, 0);
        renderer.render(scene, camera);
        if (!still) raf = requestAnimationFrame(frame);
      };
      frame();

      stop = () => {
        cancelAnimationFrame(raf);
        ro.disconnect(); themeWatch.disconnect();
        window.removeEventListener('pointermove', onMove);
        [ring.geometry, dot.geometry, smallGeo, dustGeo].forEach((g) => g.dispose());
        [ringMat, dotMat, smallMat, dustMat].forEach((x) => x.dispose());
        renderer.dispose();
        renderer.domElement.remove();
      };
    }).catch(() => onFail?.());
    return () => { gone = true; stop(); };
  }, []);   // eslint-disable-line

  return <div ref={box} className="scene3d" aria-hidden="true" />;
}
