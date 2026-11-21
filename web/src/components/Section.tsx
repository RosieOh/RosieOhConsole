// 구역 카드 — 아이콘 + 제목 머리말, 아래 내용. 글자만 늘어놓지 않고 묶어서 구분
export function Section({ icon: I, title, right, children, tone, flush }: {
  icon?: React.ComponentType<{ size?: number }>; title: React.ReactNode; right?: React.ReactNode; children?: React.ReactNode;
  tone?: 'bad' | 'warn' | 'ok'; flush?: boolean;
}) {
  return (
    <section className={'box' + (tone ? ' ' + tone : '')}>
      <header className="box-head">{I && <span className="box-icon"><I size={15} /></span>}<span className="box-title">{title}</span>{right && <span className="box-right">{right}</span>}</header>
      <div className={'box-body' + (flush ? ' flush' : '')}>{children}</div>
    </section>
  );
}
