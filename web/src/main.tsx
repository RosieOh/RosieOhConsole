import React from 'react';
import { createRoot } from 'react-dom/client';
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import './theme';
import './styles.css';
import './grid';
import { App } from './App';
import { LiquidBg } from './components/LiquidBg';
import { Apks } from './components/Apks';

// /apk — 로그인 없이 APK 만 받는 화면(사내망)
const publicApk = /^\/apk\/?$/.test(location.pathname);

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {publicApk ? (
      // 로그인 없는 APK 화면도 콘솔과 같은 틀(검은 프레임 + 둥근 캔버스)
      <div className="frame pub">
        <LiquidBg />
        <header className="fr-top"><span className="fr-brand"><span className="brand-logo" aria-label="RosieOh" /><span className="fr-tag">APK 보관함</span></span></header>
        <div className="fr-canvas"><main className="main fr-main"><div className="pub-wrap"><Apks publicPage /></div></main></div>
      </div>
    ) : <App />}
  </React.StrictMode>,
);
