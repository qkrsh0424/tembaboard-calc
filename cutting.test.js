/**
 * CLAUDE.md 4장 테스트 케이스 (TC-1 ~ TC-5) + 계산 규칙 / 출력 / 입력 검증.
 * 실행: node --test
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { colorsForShape, swatchOf } from './colors.js';
import {
  CuttingError,
  calculate,
  calculateItem,
  cutCount,
  cutLength,
  finishedLength,
  formatAdminOrder,
  formatCuttingSheet,
  formatCuttingSheetWithLeftovers,
  formatLeftovers,
  formatOrderSummary,
  leftoverPieces,
  lengthPlan,
  moldingPlan,
  piecesPerSheet,
  resolveShape,
  sheetTails,
  validateItem,
  widthPlan,
} from './cutting.js';

// --- TC-1 (기본) ------------------------------------------------------------
test('TC-1 반달 / 화이트 / 1200 × 2000 / 몰딩 O / 끝단정리 X', () => {
  const item = calculateItem({
    shape: 'half',
    color: '화이트',
    width: 1200,
    height: 2000,
    useMolding: true,
    trimEnds: false,
  });

  assert.equal(item.finishedLength, 1985, '완성 치수 = 2000 - 15');
  assert.equal(item.cutLength, 1990, '재단 길이 = 완성 1985 + 재단손실 5');
  assert.deepEqual(item.widthPlan,
    { boards: 4, strips: 1, covered: 1280, overhang: 80 },
    '가로 1200 = 295 × 4 + 100 × 1');
  assert.equal(item.usableLength, 2440, '끝단정리 X → 2440');
  assert.equal(item.piecesPerSheet, 1, '원장당 = floor(2460 / 2010)');
  assert.equal(item.sheets, 4, '원장 ceil(4 / 1)');
  assert.equal(item.strips, 1, '낱개 ceil(1 / 1)');
  assert.equal(item.cutCount, 5, '재단 횟수 = floor(2440 / 1990) × 5');
  assert.deepEqual(item.molding.items, [{ length: 1200, count: 1 }], '몰딩 = 1200 × 1개');

  const result = calculate([{
    shape: 'half', color: '화이트', width: 1200, height: 2000, useMolding: true, trimEnds: false,
  }]);
  assert.equal(
    formatCuttingSheet(result),
    ['반달-화이트 : 1985 - 4조각', '반달-화이트 100폭 : 1985 - 1조각'].join('\n'),
  );
  assert.equal(
    formatOrderSummary(result),
    [
      '템바보드 타입 / 반달, 색상 / JA3011-화이트 : 4개',
      '재단 필요해요 > 톡톡으로 말씀주세요 : 5개',
      '마감몰딩 1200mm 기준 : 1개',
      '반달템바 (100x2440x9T) : 1개',
    ].join('\n'),
  );
});

// --- TC-2 (원장당 다개수) ---------------------------------------------------
test('TC-2 반달 / 화이트 / 590 × 800 / 몰딩 X / 끝단정리 X', () => {
  const item = calculateItem({
    shape: 'half', color: '화이트', width: 590, height: 800, useMolding: false, trimEnds: false,
  });

  assert.equal(item.finishedLength, 800, '몰딩 미사용 → 완성 치수는 세로 그대로');
  assert.equal(item.cutLength, 805, '재단 길이 = 800 + 5');
  assert.deepEqual(item.widthPlan,
    { boards: 2, strips: 0, covered: 590, overhang: 0 },
    '590 = 295 × 2, 낱개 없음');
  assert.equal(item.piecesPerSheet, 3, 'floor(2440 / 805)');
  assert.equal(item.sheets, 1, 'ceil(2 / 3)');
  assert.equal(item.cutCount, 6, 'floor(2440 / 805) × 2');
  assert.equal(item.molding, null, '몰딩 미사용');
});

// --- TC-3 (끝단 정리 영향) --------------------------------------------------
test('TC-3 TC-2와 동일 + 끝단정리 O', () => {
  const item = calculateItem({
    shape: 'half', color: '화이트', width: 590, height: 800, useMolding: false, trimEnds: true,
  });

  assert.equal(item.usableLength, 2420, '끝단정리 O → 2440 - 20');
  assert.equal(item.piecesPerSheet, 3, 'floor(2420 / 805)');
  assert.equal(item.sheets, 1, 'ceil(2 / 3)');
});

test('TC-3 보강: 끝단정리가 원장당 개수를 가르는 구간', () => {
  // 완성 805 → 재단 810. 끝단정리 X 는 3개(2430), O 는 2개(2420 에 3개는 안 들어감)
  const base = { shape: 'half', color: '화이트', width: 590, height: 805 };
  assert.equal(calculateItem({ ...base, trimEnds: false }).piecesPerSheet, 3, 'floor(2440 / 810)');
  assert.equal(calculateItem({ ...base, trimEnds: true }).piecesPerSheet, 2, 'floor(2420 / 810)');
});

// --- TC-4 (사각 유효폭) -----------------------------------------------------
test('TC-4 사각 / 화이트 / 1200 × 2000 / 몰딩 O — 유효폭 차이', () => {
  const square = calculateItem({
    shape: 'square', color: '화이트', width: 1200, height: 2000, useMolding: true,
  });
  const half = calculateItem({
    shape: 'half', color: '화이트', width: 1200, height: 2000, useMolding: true,
  });

  assert.deepEqual(square.widthPlan,
    { boards: 4, strips: 0, covered: 1200, overhang: 0 },
    '사각 1200 = 300 × 4, 딱 떨어져서 낱개 없음');
  assert.deepEqual(half.widthPlan,
    { boards: 4, strips: 1, covered: 1280, overhang: 80 },
    '반달 1200 = 295 × 4 + 100 × 1');
});

// --- TC-5 (합산) ------------------------------------------------------------
test('TC-5 동일 모양·색상·재단길이 2건은 한 줄로 합산', () => {
  const result = calculate([
    { shape: 'half', color: '화이트', width: 1200, height: 2000, useMolding: true },
    { shape: 'half', color: '화이트', width: 600,  height: 2000, useMolding: true },
  ]);

  // 원장 4 + 2 = 6조각, 낱개 1 + 1 = 2조각
  assert.equal(
    formatCuttingSheet(result),
    ['반달-화이트 : 1985 - 6조각', '반달-화이트 100폭 : 1985 - 2조각'].join('\n'),
  );
  assert.deepEqual(result.boards, [{ shape: '반달', shapeKey: 'half', color: '화이트', sheets: 6 }]);
});

test('TC-5 보강: 사양이 다르면 줄을 나눈다', () => {
  const result = calculate([
    { shape: 'half',   color: '진한티크', width: 1200, height: 2000, useMolding: true },
    { shape: 'square', color: '화이트',   width: 900,  height: 1200, useMolding: false },
  ]);

  // 정렬은 색상별(COLORS 선언 순서) — 화이트가 진한티크보다 앞
  assert.equal(
    formatCuttingSheet(result),
    [
      '사각-화이트 : 1200 - 3조각',
      '반달-진한티크 : 1985 - 4조각',
      '반달-진한티크 100폭 : 1985 - 1조각',
    ].join('\n'),
  );
});

// --- 2.3 가로 채우기 (원장 + 100mm 낱개) ------------------------------------
test('가로는 원장으로 채우고 남는 폭을 100mm 낱개로 메운다', () => {
  assert.deepEqual(widthPlan(400, 300),
    { boards: 1, strips: 1, covered: 400, overhang: 0 },
    '사각 400 → 300 1장 + 100 1장');
  assert.deepEqual(widthPlan(1200, 300),
    { boards: 4, strips: 0, covered: 1200, overhang: 0 });
  assert.deepEqual(widthPlan(1250, 300),
    { boards: 4, strips: 1, covered: 1300, overhang: 50 });
  assert.deepEqual(widthPlan(1400, 300),
    { boards: 4, strips: 2, covered: 1400, overhang: 0 },
    '남는 폭 200 → 낱개 2개 (200 < 300)');
});

test('낱개로 메우는 폭이 원장 폭 이상이면 원장 1장을 쓴다', () => {
  // 사각: 낱개 3개 = 300 ≥ 300 → 원장 1장. 자재량 같고 개수는 적다.
  assert.deepEqual(widthPlan(1450, 300),
    { boards: 5, strips: 0, covered: 1500, overhang: 50 },
    '남는 폭 250 → 낱개 3개 대신 원장 1장');
  // 가로가 유효폭보다 좁아도 마찬가지
  assert.deepEqual(widthPlan(250, 300),
    { boards: 1, strips: 0, covered: 300, overhang: 50 });
  assert.deepEqual(widthPlan(150, 300),
    { boards: 0, strips: 2, covered: 200, overhang: 50 },
    '남는 폭 150 → 낱개 2개 (200 < 300)');
  // 반달은 295 라 낱개 3개(300)면 이미 원장 폭을 넘는다
  assert.deepEqual(widthPlan(500, 295),
    { boards: 2, strips: 0, covered: 590, overhang: 90 },
    '남는 폭 205 → 원장 1장');
  assert.deepEqual(widthPlan(495, 295),
    { boards: 1, strips: 2, covered: 495, overhang: 0 },
    '남는 폭 200 → 낱개 2개 (200 < 295)');
});

test('폭 재단을 하지 않으므로 규격 합계가 시공 폭이고 가로 자투리는 없다', () => {
  const item = calculateItem({ shape: 'square', color: '화이트', width: 1970, height: 1170 });

  assert.deepEqual(item.widthPlan,
    { boards: 6, strips: 2, covered: 2000, overhang: 30 },
    '1970 → 300 × 6 + 100 × 2 = 2000, 30 넘침');

  const result = calculate([{ shape: 'square', color: '화이트', width: 1970, height: 1170 }]);
  assert.ok(!formatLeftovers(result).includes('가로 자르고'), '폭 자투리 줄이 없다');
  assert.ok(leftoverPieces(result).every((p) => p.from !== 'rip'), '폭 자투리 조각이 없다');
});

// --- 2.2b 세로 나누기 (2440 초과) -------------------------------------------
test('세로가 유효길이를 넘으면 나눠서 이어 붙인다', () => {
  // 조각 하나의 최대 완성 길이 = 유효길이 - 재단손실
  assert.deepEqual(lengthPlan(800, 2440), [800], '넘지 않으면 한 조각');
  assert.deepEqual(lengthPlan(2435, 2440), [2435], '딱 맞는 최대치');
  assert.deepEqual(lengthPlan(2436, 2440), [2435, 1], '1mm 넘으면 두 조각');
  assert.deepEqual(lengthPlan(3000, 2440), [2435, 565]);
  assert.deepEqual(lengthPlan(3000, 2420), [2415, 585], '끝단정리 O 면 조각도 짧아짐');
  assert.deepEqual(lengthPlan(7500, 2440), [2435, 2435, 2435, 195], '몇 조각이든 상한 없음');
});

test('세로 3000 사각 1200 — 조각별로 자재를 따로 센다', () => {
  const item = calculateItem({
    shape: 'square', color: '화이트', width: 1200, height: 3000, useMolding: true,
  });

  assert.equal(item.finishedLength, 2985, '3000 - 몰딩 15');
  assert.equal(item.joints, 1, '이음 1군데');
  assert.deepEqual(item.segments.map((s) => s.finishedLength), [2435, 550]);
  assert.deepEqual(item.segments.map((s) => s.cutLength), [2440, 555]);
  // 2440 조각은 원장당 1개 → 4장, 555 조각은 원장당 floor(2460/575) = 4 → 1장
  assert.deepEqual(item.segments.map((s) => s.piecesPerSheet), [1, 4]);
  assert.equal(item.sheets, 5, '4 + 1');

  const result = calculate([{
    shape: 'square', color: '화이트', width: 1200, height: 3000, useMolding: true,
  }]);
  assert.equal(
    formatCuttingSheet(result),
    ['사각-화이트 : 550 - 4조각', '사각-화이트 : 2435 - 4조각'].join('\n'),
  );
  assert.ok(formatOrderSummary(result).includes('템바보드 타입 / 사각, 색상 / JA3011-화이트 : 5개'));
});

test('세로가 아주 길어도 상한 없이 계산한다', () => {
  const item = calculateItem({ shape: 'square', color: '화이트', width: 300, height: 10000 });
  assert.equal(item.segments.length, 5, 'ceil(10000 / 2435)');
  assert.equal(item.segments.reduce((n, s) => n + s.finishedLength, 0), 10000, '완성 길이 합은 그대로');
  assert.equal(item.joints, 4);
});

// --- 2.7 재단 횟수 ----------------------------------------------------------
test('재단 횟수 = 원장에서 나오는 횟수 × 가로 장수', () => {
  // 2440 에서 800 짜리 → 3회, 폭 1200(사각 300) → 4장 → 12회
  assert.equal(cutCount(2440, 805, 4), 12);
  const item = calculateItem({ shape: 'square', color: '화이트', width: 1200, height: 800 });
  assert.equal(item.cutCount, 12);
});

// --- 모양별 취급 색상 / 스토어 옵션명 ---------------------------------------
test('반달에 없는 색은 주문할 수 없다', () => {
  // 연한회색은 사각 전용
  assert.equal(
    validateItem({ shape: 'half', color: '연한회색', width: 600, height: 800 })[0].code,
    'COLOR_NOT_IN_SHAPE',
  );
  assert.deepEqual(validateItem({ shape: 'square', color: '연한회색', width: 600, height: 800 }), []);
  assert.deepEqual(validateItem({ shape: 'half', color: '카키', width: 600, height: 800 }), []);
  assert.equal(colorsForShape('half').length, 6, '반달 6색');
  assert.equal(colorsForShape('square').length, 14, '사각 14색');
});

test("예전 표기 '원형'/'round' 로 들어와도 반달로 처리한다", () => {
  assert.equal(resolveShape('원형').key, 'half');
  assert.equal(resolveShape('round').label, '반달');
});

test('주문 요약은 스토어 옵션명 그대로, 스토어 옵션 순서로 적는다', () => {
  const result = calculate([
    { shape: 'square', color: '밝은오크', width: 1200, height: 2000, useMolding: true },
    { shape: 'half',   color: '카키',     width: 2500, height: 1000, useMolding: true },
  ]);

  assert.equal(
    formatOrderSummary(result),
    [
      // 정렬은 색상별 — 카키가 밝은오크보다 앞
      // 반달 카키 2500 → 원장 8 + 낱개 2, 원장당 floor(2460/1010) = 2
      '템바보드 타입 / 반달, 색상 / JA2210-카키 : 4개',
      '템바보드 타입 / 사각, 색상 / JA6W2-밝은오크 : 4개',
      '재단 필요해요 > 톡톡으로 말씀주세요 : 24개', // 사각 1×4 + 반달 2×10
      '마감몰딩 2440mm 기준 : 1개',
      '마감몰딩 1200mm 기준 : 2개 (카키 1, 밝은오크 1)',
      '반달템바 (100x2440x9T) : 1개',
    ].join('\n'),
  );
});

test('같은 스토어 옵션에 색이 섞이면 내역을 덧붙인다', () => {
  const result = calculate([
    { shape: 'square', color: '화이트', width: 1200, height: 800, useMolding: true },
    { shape: 'square', color: '핑크',   width: 1100, height: 800, useMolding: true },
  ]);

  const text = formatOrderSummary(result);
  assert.ok(text.includes('마감몰딩 1200mm 기준 : 2개 (화이트 1, 핑크 1)'), text);
  assert.ok(text.includes('사각템바 (100x2440x12T) : 1개'), text);
});

// --- 재단 손실 5mm ----------------------------------------------------------
test('재단 손실 — 완성 치수는 보존하고 5mm 크게 잘라낸다', () => {
  assert.equal(finishedLength(2000, true), 1985, '몰딩 O → 2000 - 15');
  assert.equal(cutLength(2000, true), 1990, '완성 1985 + 재단손실 5');
  assert.equal(finishedLength(800, false), 800, '몰딩 X → 그대로');
  assert.equal(cutLength(800, false), 805);
  // 조각 1개당 1회. 3개 뽑으면 원장에서 5 × 3 = 15 를 더 쓴다.
  // 805 × 3 = 2415 ≤ 2440 이라 3개. 5mm 가 없었다면 2400 이라 역시 3개지만,
  // 4개는 3220 이라 어느 쪽이든 안 된다.
  assert.equal(piecesPerSheet(cutLength(800, false), 2440), 3, 'floor(2440 / 805)');
});

// --- 2.5 원장당 개수 검증 (CLAUDE.md 예시) ----------------------------------
test('2.5 원장당 개수 — 커프 0, 재단길이로만 나눈다', () => {
  assert.equal(piecesPerSheet(1985, 2440), 1);
  assert.equal(piecesPerSheet(800, 2440), 3);  // 800 × 3 = 2400 ≤ 2440
  assert.equal(piecesPerSheet(810, 2440), 3);  // 810 × 3 = 2430
  assert.equal(piecesPerSheet(810, 2420), 2);  // 끝단정리하면 3개가 안 들어간다
  assert.equal(piecesPerSheet(2441, 2440), 0); // 원장보다 긴 조각
});

// --- 2.8 몰딩 조합 ----------------------------------------------------------
test('2.8 몰딩 조합 — 개수 최소 → 자투리 최소', () => {
  assert.deepEqual(moldingPlan(1200).items, [{ length: 1200, count: 1 }]);
  assert.deepEqual(moldingPlan(2000).items, [{ length: 2440, count: 1 }]);
  assert.deepEqual(moldingPlan(2500).items, [
    { length: 2440, count: 1 },
    { length: 1200, count: 1 },
  ]);
  // 3700: 2440×2 = 2개 < 2440×1 + 1200×2 = 3개 → 개수 최소 기준으로 2440×2
  assert.deepEqual(moldingPlan(3700).items, [{ length: 2440, count: 2 }]);
});

test('몰딩 주문 내역은 색상·규격별로 합산된다', () => {
  const result = calculate([
    { shape: 'half', color: '화이트', width: 1200, height: 2000, useMolding: true },
    { shape: 'half', color: '화이트', width: 1100, height: 1000, useMolding: true },
  ]);

  assert.deepEqual(result.moldings,
    // shapeKey 는 관리자 주문요약에서 색상 코드를 뽑는 데 쓴다
    [{ color: '화이트', shapeKey: 'half', length: 1200, count: 2 }]);
  assert.equal(
    formatOrderSummary(result),
    [
      // 1200×2000 → 원장 4 + 낱개 1
      // 1100×1000 → 남는 폭 215 라 낱개 3개 대신 원장 1장 → 원장 4장, 원장당 2개 → 2개
      '템바보드 타입 / 반달, 색상 / JA3011-화이트 : 6개',
      '재단 필요해요 > 톡톡으로 말씀주세요 : 13개',
      '마감몰딩 1200mm 기준 : 2개',
      '반달템바 (100x2440x9T) : 1개',
    ].join('\n'),
  );
});

// --- 관리자페이지 주문요약 --------------------------------------------------
test('관리자 주문요약 — 자재 한 종류가 한 줄, 탭으로 나눈다', () => {
  const result = calculate([{ shape: 'square', color: '연한오크', width: 1970, height: 1170 }]);

  assert.equal(
    formatAdminOrder(result),
    [
      '붙이는 사각템바 12T_30cm\t300*2440*12T\tJA8401-연한오크\t3\t300*1170*12T 6조각',
      '붙이는 사각템바 12T_10cm\t100*2440*12T\tJA8401-연한오크\t1\t100*1170*12T 2조각',
    ].join('\n'),
  );
});

test('관리자 주문요약 — 같은 자재에 길이가 여럿이면 / 로 잇고 수량은 합친다', () => {
  const result = calculate([
    { shape: 'square', color: '연한오크', width: 900, height: 2415 },
    { shape: 'square', color: '연한오크', width: 900, height: 855 },
  ]);

  // 2415 → 자재당 1개, 3조각 → 3개. 855 → 자재당 2개, 3조각 → 2개. 합 5개
  assert.equal(
    formatAdminOrder(result),
    '붙이는 사각템바 12T_30cm\t300*2440*12T\tJA8401-연한오크\t5\t'
    + '300*855*12T 3조각 / 300*2415*12T 3조각',
  );
});

test('관리자 주문요약 — 마감몰딩도 한 줄로 나온다 (재단내역 칸 없음)', () => {
  const result = calculate([{
    shape: 'square', color: '연한오크', width: 1970, height: 1170, useMolding: true,
  }]);

  assert.deepEqual(formatAdminOrder(result).split('\n'), [
    '붙이는 사각템바 12T_30cm\t300*2440*12T\tJA8401-연한오크\t3\t300*1155*12T 6조각',
    '붙이는 사각템바 12T_10cm\t100*2440*12T\tJA8401-연한오크\t1\t100*1155*12T 2조각',
    '붙이는 마감몰딩\t15*2440*12T\tJA8401-연한오크\t1',
  ]);
});

test('관리자 주문요약 — 반달 원장 규격은 295 다', () => {
  const result = calculate([{ shape: 'half', color: '화이트', width: 1200, height: 2000 }]);
  const board = formatAdminOrder(result).split('\n')[0];

  assert.ok(board.includes('295*2440*9T'), board);
  assert.ok(board.endsWith('295*2000*9T 4조각'), board);
});

test('관리자 주문요약 — 색상별로 원장 → 낱개 → 몰딩 순으로 묶인다', () => {
  const result = calculate([
    { shape: 'square', color: '연한오크', width: 1970, height: 1170, useMolding: true },
    { shape: 'half', color: '화이트', width: 1200, height: 2000, useMolding: true },
  ]);

  // 화이트가 COLORS 앞자리라 먼저. 각 색 안에서 원장 → 낱개 → 몰딩
  assert.deepEqual(
    formatAdminOrder(result).split('\n').map((l) => l.split('\t').slice(0, 2)),
    [
      ['붙이는 반달템바 9T_30cm', '295*2440*9T'],
      ['붙이는 반달템바 9T_10cm', '100*2440*9T'],
      ['붙이는 마감몰딩', '15*1200*12T'],
      ['붙이는 사각템바 12T_30cm', '300*2440*12T'],
      ['붙이는 사각템바 12T_10cm', '100*2440*12T'],
      ['붙이는 마감몰딩', '15*2440*12T'],
    ],
  );
});

test('관리자 주문요약 — 폭 재단을 하지 않으므로 좁힌 폭이 적히지 않는다', () => {
  const result = calculate([{ shape: 'square', color: '연한오크', width: 1970, height: 1170 }]);
  const strip = formatAdminOrder(result).split('\n').find((l) => l.includes('_10cm'));

  assert.ok(strip.endsWith('100*1170*12T 2조각'), strip);
  assert.ok(!/\b70\*/.test(strip), '70 폭으로 좁힌 줄이 없다');
});

// --- 자투리 -----------------------------------------------------------------
test('세로 자투리 — 가득 채운 자재와 마지막 자재를 나눠 계산', () => {
  // L=700, 자재당 3개(2100 사용), 4개 필요 → 자재 2개
  //   1개: 3개 뽑고 남음 2440 - 2100 = 340
  //   2개: 1개 뽑고 남음 2440 - 700  = 1740
  assert.deepEqual(sheetTails(4, 3, 2440, 700), [
    { length: 1740, count: 1 },
    { length: 340, count: 1 },
  ]);
  // 딱 맞아떨어지면 자투리 없음 (610 × 4 = 2440)
  assert.deepEqual(sheetTails(8, 4, 2440, 610), []);
});

test('TC-1 자투리 — 원장/낱개를 나눠 적는다', () => {
  const result = calculate([{
    shape: 'half', color: '화이트', width: 1200, height: 2000, useMolding: true, trimEnds: false,
  }]);

  assert.equal(
    formatLeftovers(result),
    [
      '반달-화이트 : 가로 295 X 세로 450, 4개 (세로 자르고 남은 부분)',
      '반달-화이트 : 가로 100 X 세로 450, 1개 (세로 자르고 남은 부분)',
      '마감몰딩-화이트 : 남는 길이 없음',
    ].join('\n'),
  );
});

test('TC-3 자투리 — 끝단정리 O 면 유효길이가 줄어 자투리도 달라진다', () => {
  const plain = calculateItem({ shape: 'half', color: '화이트', width: 590, height: 800 });
  const trimmed = calculateItem({ shape: 'half', color: '화이트', width: 590, height: 800, trimEnds: true });

  assert.equal(plain.usableLength, 2440);
  assert.equal(trimmed.usableLength, 2420);
  assert.deepEqual(sheetTails(2, 3, plain.usableLength, 805), [{ length: 830, count: 1 }]);
  assert.deepEqual(sheetTails(2, 3, trimmed.usableLength, 805), [{ length: 810, count: 1 }]);
});

test('합산된 사양은 자투리도 합산 기준으로 다시 계산한다', () => {
  const result = calculate([
    { shape: 'half', color: '화이트', width: 600, height: 800 },
    { shape: 'half', color: '화이트', width: 600, height: 800 },
  ]);

  // 원장 2 + 2 = 4조각 → 자재당 3개 → 원장 2개 (3개 + 1개). 낱개 2조각 → 1개
  assert.equal(
    formatLeftovers(result),
    [
      '반달-화이트 : 가로 295 X 세로 1635, 1개 (세로 자르고 남은 부분)', // 1조각만 뽑은 자재
      '반달-화이트 : 가로 295 X 세로 25, 1개 (세로 자르고 남은 부분)',   // 2440 - 805×3
      '반달-화이트 : 가로 100 X 세로 830, 1개 (세로 자르고 남은 부분)',  // 2440 - 805×2
    ].join('\n'),
  );
});

test('몰딩 자투리는 색상별 합계', () => {
  const result = calculate([
    { shape: 'square', color: '화이트', width: 2500, height: 800, useMolding: true },
  ]);
  // 2440 + 1200 = 3640, 필요 2500 → 1140 남음
  assert.deepEqual(result.moldingLeftovers, [{ color: '화이트', shapeKey: 'square', leftover: 1140, count: 1 }]);
  assert.ok(formatLeftovers(result).includes('마감몰딩-화이트 : 1140 남음'));
});

test('자투리가 하나도 없으면 그렇게 적는다', () => {
  // 완성 605 → 재단 610. 자재당 4개(610×4 = 2440)를 딱 채우고,
  // 가로 1180 = 295×4 라 낱개도 없다.
  const result = calculate([
    { shape: 'half', color: '화이트', width: 1180, height: 605, useMolding: false },
  ]);
  assert.equal(formatLeftovers(result), '');
  assert.equal(
    formatCuttingSheetWithLeftovers(result),
    ['반달-화이트 : 605 - 4조각', '', '--- 자투리 ---', '자투리 없음'].join('\n'),
  );
});

// --- 5-(4) 입력 검증 --------------------------------------------------------
test('입력 검증 — 0/음수, 몰딩 차감 후 0 이하, 원장 초과', () => {
  const base = { shape: 'half', color: '화이트' };

  assert.equal(validateItem({ ...base, width: 0, height: 800 })[0].code, 'INVALID_WIDTH');
  assert.equal(validateItem({ ...base, width: -10, height: 800 })[0].code, 'INVALID_WIDTH');
  assert.equal(validateItem({ ...base, width: 600, height: 0 })[0].code, 'INVALID_HEIGHT');
  assert.equal(validateItem({ ...base, width: 600, height: NaN })[0].code, 'INVALID_HEIGHT');

  assert.equal(
    validateItem({ ...base, width: 600, height: 15, useMolding: true })[0].code,
    'CUT_LENGTH_TOO_SMALL',
  );
  // 세로 상한은 없다. 유효길이를 넘으면 나눠서 이어 붙인다.
  assert.deepEqual(validateItem({ ...base, width: 600, height: 2441 }), []);
  assert.deepEqual(validateItem({ ...base, width: 600, height: 9000 }), []);
  assert.deepEqual(validateItem({ ...base, width: 600, height: 2430, trimEnds: true }), []);

  assert.equal(validateItem({ ...base, shape: '삼각', width: 600, height: 800 })[0].code, 'INVALID_SHAPE');
  assert.equal(validateItem({ ...base, color: '없는색', width: 600, height: 800 })[0].code, 'INVALID_COLOR');
});

test('calculateItem 은 검증 실패 시 CuttingError 를 던진다', () => {
  assert.throws(
    () => calculateItem({ shape: 'half', color: '화이트', width: 600, height: 15, useMolding: true }),
    (err) => err instanceof CuttingError && err.code === 'CUT_LENGTH_TOO_SMALL',
  );
});

// --- 끝단정리가 다른 동일 사양 ----------------------------------------------
test('끝단정리 여부가 다르면 자재당 개수를 따로 계산하고 재단 줄은 합친다', () => {
  const result = calculate([
    { shape: 'half', color: '화이트', width: 590, height: 795, trimEnds: false }, // 2조각 / 자재당 3 → 1개
    { shape: 'half', color: '화이트', width: 590, height: 795, trimEnds: true },  // 2조각 / 자재당 2 → 1개
  ]);

  assert.equal(formatCuttingSheet(result), '반달-화이트 : 795 - 4조각');
  assert.deepEqual(result.boards, [{ shape: '반달', shapeKey: 'half', color: '화이트', sheets: 2 }]);
});

// --- 4. 도면 데이터 ---------------------------------------------------------
test('벽면 배치도 — 열 폭 합이 시공 가로, 행 길이 합이 세로', () => {
  const result = calculate([{
    shape: 'half', color: '화이트', width: 1200, height: 2000, useMolding: true,
  }]);
  const wall = result.walls[0];

  assert.deepEqual(wall.columns.map((c) => [c.kind, c.width]), [
    ['board', 295], ['board', 295], ['board', 295], ['board', 295],
    ['strip', 100], // 폭 재단을 안 하므로 낱개도 100 그대로
  ]);
  assert.equal(wall.columns.reduce((n, c) => n + c.width, 0), 1280, '열 폭 합 = 시공 가로');
  assert.equal(wall.covered, 1280);
  assert.equal(wall.overhang, 80, '요청 1200 보다 80 넘친다');

  assert.deepEqual(wall.rows, [
    { kind: 'molding', length: 15 },
    { kind: 'piece', length: 1985, cutLength: 1990 },
  ]);
  assert.equal(wall.rows.reduce((n, r) => n + r.length, 0), 2000, '행 길이 합 = 세로');
});

test('벽면 배치도 — 세로가 나뉘면 행도 나뉜다', () => {
  const result = calculate([{
    shape: 'square', color: '화이트', width: 1200, height: 3000, useMolding: true,
  }]);
  const wall = result.walls[0];

  assert.deepEqual(wall.rows.map((r) => r.length), [15, 2435, 550]);
  assert.equal(wall.rows.reduce((n, r) => n + r.length, 0), 3000);
});

test('재단 도면 — 자재 1개에 들어가는 조각과 남는 길이', () => {
  const result = calculate([{ shape: 'square', color: '화이트', width: 600, height: 800 }]);

  // 재단 805, 자재당 3개인데 조각은 2개뿐 → 자재 1개에 2조각, 남음 2440 - 1610
  assert.deepEqual(result.barGroups, [{
    shape: '사각', shapeKey: 'square', color: '화이트', kind: 'board', stockWidth: 300,
    sheetLength: 2440, usableLength: 2440, trimEnds: false,
    cutLength: 805, finishedLength: 800, count: 2, used: 1610, tail: 830, bars: 1,
  }]);
});

test('재단 도면 — 같은 모양 자재는 묶고 개수는 소요 수량과 맞는다', () => {
  const result = calculate([{
    shape: 'half', color: '화이트', width: 1200, height: 2000, useMolding: true,
  }]);

  assert.deepEqual(result.barGroups.map((g) => [g.kind, g.count, g.tail, g.bars]), [
    ['board', 1, 450, 4], // 2440 - 1990
    ['strip', 1, 450, 1],
  ]);

  const boardBars = result.barGroups.filter((g) => g.kind === 'board').reduce((n, g) => n + g.bars, 0);
  const stripBars = result.barGroups.filter((g) => g.kind === 'strip').reduce((n, g) => n + g.bars, 0);
  assert.equal(boardBars, result.boards[0].sheets, '원장 수와 일치');
  assert.equal(stripBars, result.stripOrders[0].bars, '낱개 수와 일치');
});

test('모든 취급 색상에 도면용 색값이 있다', () => {
  for (const shapeKey of ['half', 'square']) {
    for (const c of colorsForShape(shapeKey)) {
      const hex = swatchOf(c.name, shapeKey);
      assert.match(hex ?? '', /^#[0-9A-Fa-f]{6}$/, `${shapeKey} ${c.name} 색값 없음`);
    }
  }
});

test('재단 도면 묶음에 모양 키가 들어 있다 (색 조회용)', () => {
  const result = calculate([{ shape: 'half', color: '카키', width: 600, height: 800 }]);
  assert.equal(result.barGroups[0].shapeKey, 'half');
  assert.equal(swatchOf(result.barGroups[0].color, result.barGroups[0].shapeKey), '#A19A85');
});

test('자투리 목록 — 재단 후 손에 남는 조각을 한 곳에 모은다', () => {
  const result = calculate([{
    shape: 'half', color: '화이트', width: 1200, height: 4000, useMolding: true,
  }]);

  assert.deepEqual(
    leftoverPieces(result).map((p) => [p.shape, p.width, p.length, p.count, p.from]),
    [
      // 완성 3985 = 2435 + 1550 → 재단 2440 + 1555
      ['반달', 295, 885, 4, 'cut'],   // 1555 조각을 뽑은 원장 4장, 2440 - 1555
      ['반달', 100, 885, 1, 'cut'],   // 낱개에서도 같은 길이가 남는다
    ],
    '큰 조각부터 (넓이 기준)',
  );
});

test('자투리 목록의 조각 수는 자투리 텍스트와 일치한다', () => {
  const result = calculate([
    { shape: 'half', color: '화이트', width: 1200, height: 2000, useMolding: true },
    { shape: 'square', color: '핑크', width: 700, height: 900, useMolding: true, trimEnds: true },
  ]);

  const fromText = formatLeftovers(result)
    .split('\n')
    .filter((l) => !l.startsWith('마감몰딩'))
    .reduce((n, l) => n + Number(l.match(/, (\d+)개/)[1]), 0);
  const fromList = leftoverPieces(result)
    .filter((p) => p.from !== 'molding')
    .reduce((n, p) => n + p.count, 0);

  assert.equal(fromList, fromText);
});
