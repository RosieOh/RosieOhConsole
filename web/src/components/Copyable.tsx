import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { copyText } from '../copy';

// 작업할 때 자주 복사하는 값(IP·도메인·컨테이너 이름) — 값 옆 작은 복사 버튼. 카드 클릭으로 번지지 않게 막는다
export function Copyable({ text, mono = true }: { text: string; mono?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <span className={'copyable' + (mono ? ' mono' : '')}>
      <span className="copyable-text" title={text}>{text}</span>
      <button type="button" className="copy-btn" title={done ? '복사됨' : `${text} 복사`} aria-label={`${text} 복사`}
        onClick={(e) => { e.stopPropagation(); void copyText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1200); }); }}>
        {done ? <Check size={12} /> : <Copy size={12} />}
      </button>
    </span>
  );
}
