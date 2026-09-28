/**
 * 스토어 판매가. 계산 로직과 분리한다. 가격이 바뀌면 이 파일만 고친다.
 * 단가 미확인 항목은 null 로 두고, 견적에서 '단가 미정'으로 표시하며 합계에서 뺀다.
 */
import { storeColorLabel } from './colors.js';
import { STORE_OPTIONS } from './store-options.js';
import { MOLDING_LENGTHS, SHAPES } from './cutting.js';

export const PRICES = {
  /** 원장 (300 규격) */
  board: {
    half: { default: 40500 },              // 300 반달템바. 색상 무관
    square: { default: 45000 },            // 300 사각템바. 색상 무관
  },
  /** 100mm 낱개 템바 */
  strip: {
    square: 16000,
    half: 16000,
  },
  /** 마감몰딩 */
  moldingByLength: {
    2440: 8000,
    1200: 4000,
  },
  /** 재단 1회당 단가 */
  cutting: 500,
};

export function boardPrice(shapeKey, colorName) {
  const table = PRICES.board[shapeKey];
  if (!table) return null;
  return table.byColor?.[colorName] ?? table.default ?? null;
}

export const stripPrice = (shapeKey) => PRICES.strip[shapeKey] ?? null;
export const moldingPrice = (length) => PRICES.moldingByLength[length] ?? null;
export const cuttingPrice = () => PRICES.cutting;

/** 원 단위 표기 */
export const won = (n) => `${n.toLocaleString('ko-KR')}원`;

/**
 * 견적. 줄 구성과 순서는 주문 요약과 똑같이 맞춘다.
 * 단가를 모르는 줄은 amount = null 이고 합계에서 빠진다.
 */
export function quote(result) {
  const lines = [];
  const push = (label, count, unit) => {
    if (count > 0) lines.push({ label, count, unit, amount: unit === null ? null : unit * count });
  };

  for (const b of result.boards) {
    push(
      `${STORE_OPTIONS.shape} / ${b.shape}, ${STORE_OPTIONS.color} / ${storeColorLabel(b.color, b.shapeKey)}`,
      b.sheets,
      boardPrice(b.shapeKey, b.color),
    );
  }
  push(STORE_OPTIONS.cutting, result.cutCount, cuttingPrice());
  for (const length of MOLDING_LENGTHS) {
    const count = result.moldings.filter((m) => m.length === length).reduce((n, m) => n + m.count, 0);
    push(STORE_OPTIONS.moldingByLength[length], count, moldingPrice(length));
  }
  for (const shapeKey of Object.keys(SHAPES)) {
    const count = result.stripOrders.filter((s) => s.shapeKey === shapeKey).reduce((n, s) => n + s.bars, 0);
    push(STORE_OPTIONS.stripByShape[shapeKey], count, stripPrice(shapeKey));
  }

  return {
    lines,
    total: lines.reduce((sum, l) => sum + (l.amount ?? 0), 0),
    unknown: lines.filter((l) => l.amount === null),
  };
}

export function formatQuote(result) {
  const q = quote(result);
  const lines = q.lines.map((l) => (l.amount === null
    ? `${l.label} : ${l.count}개 × 단가 미정`
    : `${l.label} : ${l.count}개 × ${won(l.unit)} = ${won(l.amount)}`));
  lines.push(`합계 : ${won(q.total)}`);
  if (q.unknown.length > 0) {
    lines.push(`※ 단가 미정 ${q.unknown.map((l) => l.label).join(', ')} 은(는) 합계에서 빠져 있습니다.`);
  }
  return lines.join('\n');
}
