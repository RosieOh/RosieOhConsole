// 사내망 http 주소에서는 navigator.clipboard 가 없다 — 숨은 textarea 로 복사
export function copyText(text: string) {
  if (window.isSecureContext && navigator.clipboard) return navigator.clipboard.writeText(text);
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); } finally { ta.remove(); }
  return Promise.resolve();
}
