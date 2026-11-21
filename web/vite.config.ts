import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 루트(/)에서 서빙. dev 시 NestJS(8087)로 /dashapi·/mxtest(테스트배드 대신 부르기)·/board/api 프록시.
export default defineConfig({
  plugins: [react()],
  base: '/',
  build: { outDir: 'dist', assetsDir: 'dash-assets' },
  // three 는 로그인 화면에서 동적으로 불러온다 — 미리 묶어 두지 않으면 개발 서버가 첫 방문 때 의존성을 다시 묶느라 504 를 낸다
  optimizeDeps: { include: ['three'] },
  server: {
    proxy: { '/dashapi': 'http://localhost:8087', '/mxtest': 'http://localhost:8087', '/board/api': 'http://localhost:8087' },
  },
  test: { environment: 'jsdom', globals: true, setupFiles: ['./src/test-setup.ts'], css: false },
});
