/**
 * 단가 / 견적 테스트.
 * 실행: node --test
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { calculate } from './cutting.js';
import { PRICES, boardPrice, cuttingPrice, formatQuote, moldingPrice, quote, stripPrice, won } from './pricing.js';

test('원장 단가는 색상과 무관하다', () => {
  assert.equal(boardPrice('half', '화이트'), 40500);
  assert.equal(boardPrice('half', '카키'), 40500);
  assert.equal(boardPrice('square', '화이트'), 45000);
  assert.equal(boardPrice('square', '진한오크'), 45000);
  assert.equal(boardPrice('square', '밝은오크'), 45000);
});

test('낱개 템바 / 마감몰딩 단가', () => {
  assert.equal(stripPrice('square'), 16000);
  assert.equal(stripPrice('half'), 16000);
  assert.equal(moldingPrice(2440), 8000);
  assert.equal(moldingPrice(1200), 4000);
  assert.equal(cuttingPrice(), 500, '재단 1회당');
});

test('TC-1 견적 — 반달 화이트 1200 × 2000 몰딩 O', () => {
  const result = calculate([{
    shape: 'half', color: '화이트', width: 1200, height: 2000, useMolding: true,
  }]);
  const q = quote(result);

  assert.deepEqual(q.lines.map((l) => [l.label, l.count, l.amount]), [
    ['템바보드 타입 / 반달, 색상 / JA3011-화이트', 4, 162000], // 4 × 40,500
    ['재단 필요해요 > 톡톡으로 말씀주세요', 5, 2500],                                // 5 × 500
    ['마감몰딩 1200mm 기준', 1, 4000],
    ['반달템바 (100x2440x9T)', 1, 16000],
  ]);
  assert.equal(q.total, 184500);
  assert.equal(q.unknown.length, 0, '미정 단가 없음');
});

test('사각 견적 — 낱개까지 합산', () => {
  const result = calculate([{ shape: 'square', color: '진한오크', width: 400, height: 800 }]);
  const q = quote(result);

  // 원장 1장 45,000 + 재단 6회 3,000 + 낱개 1개 16,000
  assert.equal(q.total, 64000);
  assert.ok(formatQuote(result).includes('합계 : 64,000원'));
});

test('재단비는 재단 횟수만큼 붙는다', () => {
  const result = calculate([{ shape: 'square', color: '화이트', width: 300, height: 800 }]);
  // 원장 1장 45,000 + 재단 floor(2440/805) × 1 = 3회 × 500
  assert.ok(formatQuote(result).includes('재단 필요해요 > 톡톡으로 말씀주세요 : 3개 × 500원 = 1,500원'));
  assert.equal(quote(result).total, 46500);
});

test('단가를 모르는 항목은 합계에서 빠지고 그렇게 적는다', () => {
  const saved = PRICES.cutting;
  PRICES.cutting = null;
  try {
    const result = calculate([{ shape: 'square', color: '화이트', width: 300, height: 800 }]);
    const text = formatQuote(result);
    assert.ok(text.includes('재단 필요해요 > 톡톡으로 말씀주세요 : 3개 × 단가 미정'), text);
    assert.ok(text.includes('※ 단가 미정'), text);
    assert.equal(quote(result).total, 45000, '원장 1장만 합산');
  } finally {
    PRICES.cutting = saved;
  }
});

test('금액 표기', () => {
  assert.equal(won(0), '0원');
  assert.equal(won(1234567), '1,234,567원');
});
