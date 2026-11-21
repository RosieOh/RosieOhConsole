import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 루트(/)에서 서빙. dev 시 NestJS(8087)로 /dashapi·/mxtest(테스트배드 대신 부르기)·/board/api 프록시.
export default defineConfig({
  plugins: [react()],
  base: '/',
  build: { outDir: 'dist', assetsDir: 'dash-assets' },
  server: {
    proxy: { '/dashapi': 'http://localhost:8087', '/mxtest': 'http://localhost:8087', '/board/api': 'http://localhost:8087' },
  },
  test: { environment: 'jsdom', globals: true, setupFiles: ['./src/test-setup.ts'], css: false },
});
