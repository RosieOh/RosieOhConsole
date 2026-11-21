import { Moon, Sun } from 'lucide-react';
import { useState } from 'react';
import LiquidGlass from 'liquid-glass-react';
import { applyTheme, currentTheme } from '../theme';
import { LiquidBg } from './LiquidBg';

const REASON: Record<string, string> = {
  forbidden: '허용된 GitHub 계정만 들어올 수 있습니다. 관리자에게 추가를 요청하세요.',
  expired: '로그인 시간이 지났습니다. 다시 눌러 주세요.',
  failed: 'GitHub 로그인 확인에 실패했습니다. 잠시 후 다시 시도하세요.',
};

export function Login() {
  const reason = new URLSearchParams(location.search).get('login') || '';
  // 로그인에서도 테마를 바꾼다 — 배경(오로라)이 테마를 따라가므로 여기서 보는 게 맞다
  const [dark, setDark] = useState(() => currentTheme() === 'dark');
  const flip = () => { const next = dark ? 'light' : 'dark'; applyTheme(next); setDark(!dark); };
  return (
    <div className="login-wrap">
      <LiquidBg />
      <button className="login-theme" onClick={flip} aria-label="테마 바꾸기" title={dark ? '밝게' : '어둡게'}>
        {dark ? <Sun size={17} /> : <Moon size={17} />}
      </button>
      {/* 이 컴포넌트는 transform: translate(-50%,-50%) 를 항상 걸기 때문에
          position 과 top/left 를 반드시 넘겨야 한다(안 넘기면 내부 레이어가 나란히 흐른다).
          형제로 뿌리는 림/음영 레이어는 styles.css 에서 끄고 테두리를 직접 그린다. */}
      <LiquidGlass
        className="login-glass"
        cornerRadius={28}
        padding="46px 48px 40px"
        displacementScale={68}
        blurAmount={0.06}
        saturation={135}
        aberrationIntensity={2}
        elasticity={0.14}
        style={{ position: 'absolute', top: '50%', left: '50%' }}
      >
        <div className="login-box">
          <span className="login-brand brand-logo" aria-label="RosieOh" />
          <h2>Rosie 콘솔</h2>
          <p>GitHub 계정으로 로그인합니다. 비밀번호는 GitHub 화면에서만 입력합니다.</p>
          {REASON[reason] && <div className="err">{REASON[reason]}</div>}
          <a className="login-cta" href="/dashapi/login">GitHub 으로 로그인</a>
          <a className="login-alt" href="/apk">APK 만 받기 <span>로그인 없이</span></a>
        </div>
      </LiquidGlass>
    </div>
  );
}
