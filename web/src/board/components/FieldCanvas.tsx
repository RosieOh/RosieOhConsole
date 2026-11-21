import { useEffect, useRef } from 'react';
import { field } from '../lib/field';

/** 배경 장의 두 층 — 뒤(점 격자·색 번짐)와 위(빛 띠, 화면 섞기 screen).
 *  콘솔 안에서는 화면 전체가 아니라 보드 상자를 덮는다(absolute) — fixed 면
 *  위층이 콘솔 메뉴·도크 위로 올라온다(#148). */
export function FieldCanvas() {
  const back = useRef<HTMLCanvasElement>(null), top = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (back.current && top.current) field.mount(back.current, top.current);
    return () => field.unmount();
  }, []);
  return (
    <>
      <canvas ref={back} aria-hidden="true" className="board-field" />
      <canvas ref={top} aria-hidden="true" className="board-field-top" />
    </>
  );
}
