/**
 * 템바보드 재단 계산 로직.
 * UI 코드 없음. 순수 계산 + 출력 텍스트 포맷만 담당한다.
 * 규칙 출처: CLAUDE.md 2장(계산 로직), 3장(출력 형식).
 */
import { COLOR_ORDER, findColor, isColorAvailable, storeColorLabel } from './colors.js';
import { STORE_OPTIONS, ADMIN_PRODUCTS, ADMIN_SIZE_SUFFIX, ADMIN_MOLDING } from './store-options.js';
import { boardPrice, stripPrice, cuttingPrice } from './pricing.js';

/** 모양별 원장 규격. 유효폭 = 실측폭(옆판 겹침 손실 없음). */
export const SHAPES = {
  half:   { key: 'half',   label: '반달', effectiveWidth: 295, sheetLength: 2440 },
  square: { key: 'square', label: '사각', effectiveWidth: 300, sheetLength: 2440 },
};

/** 예전 표기(원형)로 들어온 입력도 계속 받는다. */
export const SHAPE_ALIASES = { round: 'half', 원형: 'half' };

/**
 * 톱날 손실(커프). 조각과 조각 사이에만 발생.
 *
 * 0 이다. 예전에 20 을 썼는데 톱날이 먹는 길이는 조각마다 빠지는 재단손실
 * (CUT_LOSS 5)로 이미 세고 있어서 이중 계산이었다.
 * 커프를 따로 빼야 하는 톱으로 바뀌면 이 값만 올린다.
 */
export const KERF = 0;
/** 끝단 정리 선택 시 원장에서 빠지는 길이. */
export const TRIM_LOSS = 20;
/** 마감몰딩 두께. 보드 세로와 별개로 위·아래에 붙는다 (배치도에만 쓴다). */
export const MOLDING_THICKNESS = 15;
/** 재단 손실. 조각을 자를 때마다 세로가 이만큼 줄어든다. 조각 1개당 1회. */
export const CUT_LOSS = 5;
/** 낱개 템바 폭 (100 × 2440). 원장으로 못 채우는 자투리 폭을 이걸로 메운다. */
export const STRIP_WIDTH = 100;
/** 마감몰딩 규격 (15 × L × 12t). 긴 것부터. */
export const MOLDING_LENGTHS = [2440, 1200];
export const MOLDING_TYPE = '민자';

/** 자재 종류: 원장(유효폭) / 낱개 템바(100폭) */
export const STOCK_BOARD = 'board';
export const STOCK_STRIP = 'strip';

export class CuttingError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CuttingError';
    this.code = code;
  }
}

export function resolveShape(shape) {
  if (typeof shape === 'string') {
    if (SHAPES[shape]) return SHAPES[shape];
    if (SHAPE_ALIASES[shape]) return SHAPES[SHAPE_ALIASES[shape]];
    const byLabel = Object.values(SHAPES).find((s) => s.label === shape);
    if (byLabel) return byLabel;
  }
  throw new CuttingError('INVALID_SHAPE', `알 수 없는 모양: ${shape}`);
}

// --- 2.2 완성 치수 / 재단 길이 (세로) ---------------------------------------
// 완성 치수 = 고객 입력 세로 = 보드 높이. 몰딩은 보드 위·아래에 따로 붙으므로
// 세로에서 빼지 않는다 (2026-10-16 변경. 전에는 상단 몰딩 15 를 뺐다).
export function finishedLength(height) {
  return height;
}

// 재단하면 조각 세로가 5mm 줄어든다. 완성 치수를 맞추려면 그만큼 크게 잘라야 하므로
// 원장에서 실제로 잘라내는 길이(= 원장 점유 길이)는 완성 치수 + 5.
// 자재 소요량·재단 횟수·자투리는 전부 이 길이로 센다.
// 다만 화면과 지시서에 적는 숫자는 완성 치수다 (formatCuttingSheet 참고).
export function cutLength(height) {
  return finishedLength(height) + CUT_LOSS;
}

// --- 2.2b 세로 나누기 -------------------------------------------------------
// 세로가 원장 유효길이를 넘으면 한 장으로 못 뽑는다. 길이를 나눠서 이어 붙인다.
// 조각 하나가 가질 수 있는 최대 완성 길이 = 유효길이 - 재단손실.
// 이음을 최소로 하려고 앞 조각부터 최대로 채우고 마지막 조각이 나머지를 갖는다.
export function lengthPlan(finished, usableLength) {
  const max = usableLength - CUT_LOSS;
  const count = Math.max(1, Math.ceil(finished / max));
  const segments = [];
  let left = finished;
  for (let i = 0; i < count; i++) {
    const seg = Math.min(max, left);
    segments.push(seg);
    left -= seg;
  }
  return segments;
}

// --- 2.3 가로 채우기 --------------------------------------------------------
// 원장(유효폭)으로 채울 수 있는 만큼 채우고, 남는 폭은 100mm 낱개 템바로 메운다.
// 예) 사각 400 → 300 × 1장 + 100 × 1장
//
// 단, 낱개로 메우는 폭이 원장 폭 이상이면 원장 1장으로 대신한다.
// 자재량은 같거나 적으면서 개수는 적기 때문. (사각 남는 폭 250 → 낱개 3개 300 = 원장 1장)
// 그래서 낱개는 최대 (유효폭 - 100) 폭까지만 쓴다. 사각 200 / 반달 195.
//
// ⚠️ 폭 재단은 하지 않는다. 세로만 자를 수 있고 가로는 규격(유효폭 / 100) 그대로 나간다.
// 그래서 시공 폭은 규격 합계로 고정되고, 요청 가로보다 넘치는 만큼이 overhang 이다.
// 모자라면 벽이 비므로 항상 덮는 쪽(올림)으로 맞춘다. 넘치는 폭은 현장에서 처리한다.
export function widthPlan(width, effectiveWidth) {
  let boards = Math.floor(width / effectiveWidth);
  const rest = width - boards * effectiveWidth;
  let strips = rest > 0 ? Math.ceil(rest / STRIP_WIDTH) : 0;

  if (strips * STRIP_WIDTH >= effectiveWidth) {
    boards += 1;
    strips = 0;
  }

  const covered = boards * effectiveWidth + strips * STRIP_WIDTH;
  return {
    boards,
    strips,
    /** 규격대로 깔았을 때 실제 시공 폭 */
    covered,
    /** 요청 가로보다 넘치는 폭. 우리가 자르지 않으므로 자투리가 아니다 */
    overhang: covered - width,
  };
}

// 원장 장수를 정해 두고 남는 폭을 낱개로 메운 배치. 몇 장으로 할지는 calculate() 가
// 주문 전체 금액을 보고 정한다(2.3).
export function planWithBoards(width, effectiveWidth, boards) {
  const strips = Math.max(0, Math.ceil((width - boards * effectiveWidth) / STRIP_WIDTH));
  const covered = boards * effectiveWidth + strips * STRIP_WIDTH;
  return { boards, strips, covered, overhang: covered - width };
}

/** 재단 조각 총 개수 (원장 조각 + 낱개 조각) */
export function pieceCount(width, effectiveWidth) {
  const plan = widthPlan(width, effectiveWidth);
  return plan.boards + plan.strips;
}

// --- 2.4 원장 유효 길이 -----------------------------------------------------
export function usableSheetLength(shapeSpec, trimEnds) {
  return shapeSpec.sheetLength - (trimEnds ? TRIM_LOSS : 0);
}

// --- 2.5 원장 1개당 뽑을 수 있는 개수 ---------------------------------------
// n × L + (n-1) × KERF ≤ 유효길이  →  n = floor((유효길이 + KERF) / (L + KERF))
export function piecesPerSheet(length, usableLength) {
  if (length > usableLength) return 0;
  return Math.floor((usableLength + KERF) / (length + KERF));
}

// --- 2.6 소요 원장 수 -------------------------------------------------------
export function sheetsNeeded(pieces, perSheet) {
  if (perSheet <= 0) throw new CuttingError('NO_FIT', '원장에서 뽑을 수 없는 길이입니다.');
  return Math.ceil(pieces / perSheet);
}

// --- 2.7 재단 횟수 (스토어 '재단 필요해요' 수량) ----------------------------
// 원장 길이를 재단 길이로 나눈 횟수 × 가로 장수.
// 예) 2440 / 800 → 3회, 폭 1200(사각 300) → 4장 → 3 × 4 = 12회
export function cutCount(usableLength, length, pieces) {
  return Math.floor(usableLength / length) * pieces;
}

// --- 2.8 몰딩 수량 ----------------------------------------------------------
// 필요 길이 = 고객 입력 가로. 2440/1200 조합으로 덮는다.
// 1순위 총 개수 최소, 2순위 자투리 최소. 이음부 커프 손실은 계산하지 않는다.
export function moldingPlan(width) {
  const [long, short] = MOLDING_LENGTHS;
  let best = null;
  for (let a = 0; a <= Math.ceil(width / long); a++) {
    const rest = width - a * long;
    const b = rest > 0 ? Math.ceil(rest / short) : 0;
    const total = a * long + b * short;
    const cand = { count: a + b, leftover: total - width, total, pieces: { [long]: a, [short]: b } };
    if (!best || cand.count < best.count || (cand.count === best.count && cand.leftover < best.leftover)) {
      best = cand;
    }
  }
  const items = MOLDING_LENGTHS
    .filter((len) => best.pieces[len] > 0)
    .map((len) => ({ length: len, count: best.pieces[len] }));
  return { items, count: best.count, total: best.total, leftover: best.leftover };
}

// --- 자투리 -----------------------------------------------------------------
// (1) 세로 자르고 남은 부분: 자재 끝에 남는 토막.
//     마지막 자재는 조각 수가 모자랄 수 있으므로 따로 계산한다.
//     커프는 조각과 조각 사이에만 계산한다(2.5 모델). 남는 토막을 톱으로 떼어내는
//     마지막 1컷(20mm)은 빼지 않은 값이다.
export function sheetTails(pieces, perSheet, usableLength, length) {
  const sheets = sheetsNeeded(pieces, perSheet);
  const lastCount = pieces - (sheets - 1) * perSheet;
  const tailOf = (n) => usableLength - (n * length + (n - 1) * KERF);

  const map = new Map();
  const add = (tail, count) => {
    if (tail > 0 && count > 0) map.set(tail, (map.get(tail) ?? 0) + count);
  };
  add(tailOf(perSheet), sheets - 1); // 가득 채운 자재
  add(tailOf(lastCount), 1);         // 마지막 자재

  return [...map.entries()]
    .map(([tail, count]) => ({ length: tail, count }))
    .sort((a, b) => b.length - a.length);
}

// (2) 폭 재단은 하지 않으므로 가로 자투리는 나오지 않는다. widthPlan().overhang 참조.
// (3) 몰딩 자투리는 moldingPlan().leftover 참조.

/** 붙는 몰딩 면 수. useMolding = 상단, bottomMolding = 하단 */
export function moldingSides(input) {
  return (input.useMolding ? 1 : 0) + (input.bottomMolding ? 1 : 0);
}

// --- 입력 검증 (CLAUDE.md 5-(4)) --------------------------------------------
export function validateItem(input) {
  const errors = [];
  const { width, height } = input;

  let shapeSpec = null;
  try {
    shapeSpec = resolveShape(input.shape);
  } catch (e) {
    errors.push({ code: e.code, message: e.message });
  }

  if (!findColor(input.color)) {
    errors.push({ code: 'INVALID_COLOR', message: `알 수 없는 색상: ${input.color}` });
  } else if (shapeSpec && !isColorAvailable(input.color, shapeSpec.key)) {
    errors.push({
      code: 'COLOR_NOT_IN_SHAPE',
      message: `${shapeSpec.label}에는 ${input.color}이(가) 없습니다.`,
    });
  }
  if (!Number.isFinite(width) || width <= 0) {
    errors.push({ code: 'INVALID_WIDTH', message: '가로는 0보다 큰 값이어야 합니다.' });
  }
  if (!Number.isFinite(height) || height <= 0) {
    errors.push({ code: 'INVALID_HEIGHT', message: '세로는 0보다 큰 값이어야 합니다.' });
  }
  // 세로 상한은 두지 않는다. 유효길이를 넘으면 나눠서 이어 붙인다(lengthPlan).
  return errors;
}

/**
 * 항목 1건 계산. 검증 실패 시 CuttingError 를 던진다.
 * boards: 원장 장수를 정해 준다 (planWithBoards). 없으면 widthPlan 기본 배치. calculate() 가 정한다.
 */
export function calculateItem(input, boards = null) {
  const errors = validateItem(input);
  if (errors.length > 0) {
    const err = new CuttingError(errors[0].code, errors[0].message);
    err.errors = errors;
    throw err;
  }

  const shapeSpec = resolveShape(input.shape);
  const { width, height, useMolding = false, bottomMolding = false, trimEnds = false } = input;
  const sides = moldingSides(input);

  const finished = finishedLength(height);
  const usableLength = usableSheetLength(shapeSpec, trimEnds);
  const plan = boards === null
    ? widthPlan(width, shapeSpec.effectiveWidth)
    : planWithBoards(width, shapeSpec.effectiveWidth, boards);
  const pieces = plan.boards + plan.strips;

  // 세로가 유효길이를 넘으면 여러 조각으로 나눠 이어 붙인다.
  const segments = lengthPlan(finished, usableLength).map((segFinished) => {
    const length = segFinished + CUT_LOSS;
    const perSheet = piecesPerSheet(length, usableLength);
    // 원장과 낱개는 자재가 다르므로 소요 수량도 따로 센다.
    const stocks = [
      { kind: STOCK_BOARD, stockWidth: shapeSpec.effectiveWidth, pieces: plan.boards },
      { kind: STOCK_STRIP, stockWidth: STRIP_WIDTH, pieces: plan.strips },
    ]
      .filter((s) => s.pieces > 0)
      .map((s) => ({ ...s, bars: sheetsNeeded(s.pieces, perSheet) }));

    return {
      finishedLength: segFinished,
      cutLength: length,
      piecesPerSheet: perSheet,
      pieces,
      stocks,
    };
  });

  const barsOf = (kind) => segments.reduce(
    (n, seg) => n + seg.stocks.filter((s) => s.kind === kind).reduce((m, s) => m + s.bars, 0), 0);

  return {
    input: { ...input, useMolding, bottomMolding, trimEnds },
    shape: shapeSpec,
    color: findColor(input.color),
    width,
    height,
    finishedLength: finished,
    /** 첫 조각 기준. 나눠진 경우 전체는 segments 참조. */
    cutLength: segments[0].cutLength,
    segments,
    /** 이음 개수 (0이면 한 장으로 나옴) */
    joints: segments.length - 1,
    widthPlan: plan,
    pieces,
    usableLength,
    piecesPerSheet: segments[0].piecesPerSheet,
    sheets: barsOf(STOCK_BOARD),
    strips: barsOf(STOCK_STRIP),
    cutCount: segments.reduce((n, seg) => n + cutCount(usableLength, seg.cutLength, seg.pieces), 0),
    /** 몰딩 한 면 분량. 면 수는 moldingSides */
    molding: sides > 0 ? moldingPlan(width) : null,
    moldingSides: sides,
  };
}

// --- 3. 합산 / 정렬 ---------------------------------------------------------
// 동일 사양(모양 + 색상 + 재단길이 + 자재)은 합산하여 한 줄로 출력. 정렬은 색상별.
function colorRank(name) {
  return COLOR_ORDER.has(name) ? COLOR_ORDER.get(name) : Number.MAX_SAFE_INTEGER;
}

function bySpec(a, b) {
  return (
    colorRank(a.color) - colorRank(b.color) ||
    (a.color ?? '').localeCompare(b.color ?? '') ||
    (a.shape ?? '').localeCompare(b.shape ?? '') ||
    (a.kind === STOCK_STRIP ? 1 : 0) - (b.kind === STOCK_STRIP ? 1 : 0) ||
    (a.cutLength ?? 0) - (b.cutLength ?? 0) ||
    (a.length ?? 0) - (b.length ?? 0)
  );
}

// 같은 자재(모양 + 색상 + 재단길이 + 끝단정리 + 원장/낱개)끼리 묶어 소요 수량을 센다.
function bucketsOf(items) {
  // 원장당 개수는 끝단정리 여부에 따라 달라지므로 소요 수량 계산은 trimEnds 까지 묶는다.
  const buckets = new Map();
  for (const item of items) {
    for (const seg of item.segments) {
      for (const stock of seg.stocks) {
        const key = [item.shape.label, item.color.name, seg.cutLength, item.input.trimEnds, stock.kind].join('|');
        const bucket = buckets.get(key) ?? {
          shape: item.shape.label,
          shapeKey: item.shape.key,
          color: item.color.name,
          kind: stock.kind,
          stockWidth: stock.stockWidth,
          cutLength: seg.cutLength,
          finishedLength: seg.finishedLength,
          piecesPerSheet: seg.piecesPerSheet,
          usableLength: item.usableLength,
          sheetLength: item.shape.sheetLength,
          trimEnds: item.input.trimEnds,
          pieces: 0,
        };
        bucket.pieces += stock.pieces;
        buckets.set(key, bucket);
      }
    }
  }
  for (const bucket of buckets.values()) {
    bucket.bars = sheetsNeeded(bucket.pieces, bucket.piecesPerSheet);
    // 자투리는 합산된 조각 수 기준으로 다시 계산한다.
    // (2건을 한 자재에 몰아 뽑으면 자투리도 줄어들기 때문)
    bucket.sheetTails = sheetTails(bucket.pieces, bucket.piecesPerSheet, bucket.usableLength, bucket.cutLength);
  }
  return buckets;
}

// --- 2.3 원장/낱개 배치 고르기 ---------------------------------------------
// 재단면마다 원장을 몇 장 쓸지(나머지는 낱개)를 주문 전체 금액이 가장 적게 고른다.
// 자재는 조각 길이가 같으면(모양 + 색상 + 재단길이 + 끝단정리, bucketsOf 와 같은 기준) 나눠 쓴다.
// 세로가 달라도 나눈 조각 길이가 같으면 묶이므로(3000 의 565 조각과 565 한 장),
// 그런 재단면끼리 이어서 한 묶음으로 따진다.
// 금액은 묶음 안 조각 길이별 원장 조각 합·낱개 조각 합으로만 정해지므로 그 합을 상태로 DP 한다.
// 같은 금액이면 기본 배치(widthPlan)에서 바꾼 면이 적은 쪽 → 넘치는 폭이 적은 쪽.
function chooseBoards(items) {
  const chosen = items.map((it) => it.widthPlan.boards);
  const stockKey = (it, seg) => [it.shape.key, it.color.name, seg.cutLength, it.input.trimEnds].join('|');

  // 조각 길이를 공유하는 재단면끼리 묶는다 (union-find)
  const parent = items.map((_, i) => i);
  const root = (i) => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  const owner = new Map();
  items.forEach((it, i) => it.segments.forEach((seg) => {
    const k = stockKey(it, seg);
    if (owner.has(k)) parent[root(i)] = root(owner.get(k)); else owner.set(k, i);
  }));
  const groups = new Map();
  items.forEach((_, i) => groups.set(root(i), [...(groups.get(root(i)) ?? []), i]));

  for (const idx of groups.values()) {
    const first = items[idx[0]];
    const W = first.shape.effectiveWidth;
    const bp = boardPrice(first.shape.key, first.color.name) ?? 0;
    const sp = stripPrice(first.shape.key) ?? 0;
    const cp = cuttingPrice() ?? 0;

    // 묶음 안 조각 길이 목록. 재단면마다 길이별 조각 배수(5000 → 2435 × 2 + 130)를 센다.
    const lengths = [];
    const mult = idx.map((i) => {
      const m = new Map();
      for (const seg of items[i].segments) {
        let L = lengths.findIndex((x) => x.cutLength === seg.cutLength);
        if (L < 0) L = lengths.push(seg) - 1;
        m.set(L, (m.get(L) ?? 0) + 1);
      }
      return m;
    });
    const cost = (tot) => lengths.reduce((won, seg, L) => {
      const B = tot[2 * L], S = tot[2 * L + 1];
      return won + Math.ceil(B / seg.piecesPerSheet) * bp + Math.ceil(S / seg.piecesPerSheet) * sp
        + Math.floor(first.usableLength / seg.cutLength) * (B + S) * cp;
    }, 0);

    // 상태: 길이별 [원장 합, 낱개 합] → { changed, overhang, picks }
    let states = new Map([['', { tot: new Array(lengths.length * 2).fill(0), changed: 0, overhang: 0, picks: [] }]]);
    idx.forEach((i, n) => {
      const { width } = items[i];
      const base = items[i].widthPlan.boards;
      const next = new Map();
      for (const st of states.values()) {
        for (let b = 0; b <= Math.ceil(width / W); b++) {
          const p = planWithBoards(width, W, b);
          const tot = [...st.tot];
          for (const [L, k] of mult[n]) { tot[2 * L] += k * p.boards; tot[2 * L + 1] += k * p.strips; }
          const cand = {
            tot, changed: st.changed + (b !== base), overhang: st.overhang + p.overhang, picks: [...st.picks, b],
          };
          const key = tot.join('|');
          const old = next.get(key);
          if (!old || cand.changed < old.changed || (cand.changed === old.changed && cand.overhang < old.overhang)) {
            next.set(key, cand);
          }
        }
      }
      states = next;
    });
    let best = null;
    for (const st of states.values()) {
      const score = [cost(st.tot), st.changed, st.overhang];
      const k = best ? score.findIndex((v, j) => v !== best.score[j]) : -1;
      if (!best || (k >= 0 && score[k] < best.score[k])) best = { score, picks: st.picks };
    }
    idx.forEach((i, n) => { chosen[i] = best.picks[n]; });
  }
  return chosen;
}

export function calculate(inputs) {
  // 2.3 원장/낱개 배치는 주문 전체 금액으로 고른다 (chooseBoards).
  const base = inputs.map((input) => calculateItem(input));
  const items = chooseBoards(base)
    .map((boards, i) => (boards === base[i].widthPlan.boards ? base[i] : calculateItem(inputs[i], boards)));
  const buckets = bucketsOf(items);

  // 재단 지시서: 모양 + 색상 + 재단길이 + 자재
  const cutMap = new Map();
  for (const b of buckets.values()) {
    const key = [b.shape, b.color, b.cutLength, b.kind].join('|');
    const row = cutMap.get(key) ?? {
      shape: b.shape, shapeKey: b.shapeKey, color: b.color, kind: b.kind, stockWidth: b.stockWidth,
      cutLength: b.cutLength, finishedLength: b.finishedLength, pieces: 0,
    };
    row.pieces += b.pieces;
    cutMap.set(key, row);
  }
  const cuts = [...cutMap.values()].sort(bySpec);

  // 주문 수량: 모양 + 색상 + 자재
  const stockMap = new Map();
  for (const b of buckets.values()) {
    const key = [b.shape, b.color, b.kind].join('|');
    const row = stockMap.get(key) ?? {
      shape: b.shape, shapeKey: b.shapeKey, color: b.color, kind: b.kind,
      stockWidth: b.stockWidth, sheetLength: b.sheetLength, bars: 0,
    };
    row.bars += b.bars;
    stockMap.set(key, row);
  }
  const stocks = [...stockMap.values()].sort(bySpec);
  const boards = stocks
    .filter((s) => s.kind === STOCK_BOARD)
    .map((s) => ({ shape: s.shape, shapeKey: s.shapeKey, color: s.color, sheets: s.bars }));
  const stripOrders = stocks.filter((s) => s.kind === STOCK_STRIP);

  // 몰딩: 색상 + 규격. 색상은 보드 색상을 따라간다.
  const moldingMap = new Map();
  for (const item of items) {
    if (!item.molding) continue;
    for (const m of item.molding.items) {
      const key = `${item.color.name}|${m.length}`;
      // 몰딩은 규격이 하나뿐이라 색상 + 길이로만 묶는다. 색상 코드를 뽑을 모양은
      // 이 몰딩을 부른 첫 재단면의 것을 쓴다.
      const row = moldingMap.get(key)
        ?? { color: item.color.name, shapeKey: item.shape.key, length: m.length, count: 0 };
      row.count += m.count * item.moldingSides;
      moldingMap.set(key, row);
    }
  }
  const moldings = [...moldingMap.values()].sort(bySpec);

  // 자투리: 재단 지시서와 같은 단위로 묶는다.
  const leftoverMap = new Map();
  for (const b of buckets.values()) {
    const key = [b.shape, b.color, b.cutLength, b.kind].join('|');
    const row = leftoverMap.get(key) ?? {
      shape: b.shape, shapeKey: b.shapeKey, color: b.color, kind: b.kind, stockWidth: b.stockWidth,
      cutLength: b.cutLength, sheetTails: [],
    };
    row.sheetTails.push(...b.sheetTails);
    leftoverMap.set(key, row);
  }
  const leftovers = [...leftoverMap.values()]
    .map((row) => ({
      ...row,
      sheetTails: [...row.sheetTails
        .reduce((m, t) => m.set(t.length, (m.get(t.length) ?? 0) + t.count), new Map())]
        .map(([length, count]) => ({ length, count }))
        .sort((a, b) => b.length - a.length),
    }))
    .sort(bySpec);

  // 몰딩 자투리. 따로 떨어지는 조각이므로 길이별로 센다(합산하지 않는다).
  const moldingLeftoverMap = new Map();
  for (const item of items) {
    if (!item.molding) continue;
    const key = [item.color.name, item.shape.key, item.molding.leftover].join('|');
    const row = moldingLeftoverMap.get(key) ??
      { color: item.color.name, shapeKey: item.shape.key, leftover: item.molding.leftover, count: 0 };
    row.count += item.moldingSides;
    moldingLeftoverMap.set(key, row);
  }
  const moldingLeftovers = [...moldingLeftoverMap.values()].sort(bySpec);

  return {
    items,
    boards,
    stripOrders,
    /** 모양 + 색상 + 자재 단위. 관리자 주문요약이 이 단위로 한 줄씩 낸다 */
    stocks,
    cuts,
    moldings,
    leftovers,
    moldingLeftovers,
    cutCount: items.reduce((n, it) => n + it.cutCount, 0),
    joints: items.reduce((n, it) => n + it.joints, 0),
    barGroups: barGroupsOf([...buckets.values()].sort(bySpec)),
    walls: items.map(wallLayout),
  };
}

// --- 4. 도면 데이터 ---------------------------------------------------------
// 숫자와 그림이 어긋나지 않도록, 계산에 쓴 버킷에서 그대로 뽑는다.

/**
 * 자재 1개(원장 또는 낱개)에 조각이 어떻게 들어가는지.
 * 같은 모양의 자재는 묶어서 bars 개수로 센다.
 */
export function barGroupsOf(buckets) {
  const groups = new Map();
  for (const b of buckets) {
    let left = b.pieces;
    while (left > 0) {
      const count = Math.min(b.piecesPerSheet, left);
      const used = count * b.cutLength + (count - 1) * KERF;
      const key = [b.shape, b.color, b.kind, b.cutLength, count, b.trimEnds].join('|');
      const group = groups.get(key) ?? {
        shape: b.shape,
        shapeKey: b.shapeKey,
        color: b.color,
        kind: b.kind,
        stockWidth: b.stockWidth,
        sheetLength: b.sheetLength,
        usableLength: b.usableLength,
        trimEnds: b.trimEnds,
        cutLength: b.cutLength,
        /** 도면에 적는 값. 재단 지시서와 같게 완성 치수를 쓴다. */
        finishedLength: b.finishedLength,
        /** 자재 1개에 들어가는 조각 수 */
        count,
        used,
        tail: b.usableLength - used,
        /** 이렇게 생긴 자재가 몇 개인지 */
        bars: 0,
      };
      group.bars += 1;
      groups.set(key, group);
      left -= count;
    }
  }
  return [...groups.values()];
}

/**
 * 벽면 배치도. 가로는 자재 열, 세로는 조각(이음)으로 나뉜다.
 * 폭 재단을 하지 않으므로 열은 모두 규격 폭 그대로다.
 * 그래서 시공 폭(covered)이 요청 가로보다 넓을 수 있고, 그 차이가 overhang 이다.
 */
export function wallLayout(item) {
  const { boards, strips, covered, overhang } = item.widthPlan;
  const columns = [
    ...Array.from({ length: boards }, () => ({ kind: STOCK_BOARD, width: item.shape.effectiveWidth })),
    ...Array.from({ length: strips }, () => ({ kind: STOCK_STRIP, width: STRIP_WIDTH })),
  ];

  const rows = [];
  if (item.input.useMolding) rows.push({ kind: 'molding', length: MOLDING_THICKNESS });
  for (const seg of item.segments) {
    rows.push({ kind: 'piece', length: seg.finishedLength, cutLength: seg.cutLength });
  }
  if (item.input.bottomMolding) rows.push({ kind: 'molding', length: MOLDING_THICKNESS });

  /** height = 보드 + 몰딩 전체 높이 (행 길이 합) */
  return { width: item.width, covered, overhang, height: item.height + item.moldingSides * MOLDING_THICKNESS, columns, rows };
}

/**
 * 자투리 목록. 재단이 끝나고 손에 남는 조각을 한 곳에 모은다.
 * 같은 크기·같은 출처는 묶어서 센다.
 */
export function leftoverPieces(result) {
  const map = new Map();
  const add = (p) => {
    const key = [p.shape, p.color, p.width, p.length, p.from].join('|');
    const row = map.get(key) ?? { ...p, count: 0 };
    row.count += p.count;
    map.set(key, row);
  };

  for (const row of result.leftovers) {
    for (const t of row.sheetTails) {
      add({ shape: row.shape, shapeKey: row.shapeKey, color: row.color, kind: row.kind,
        width: row.stockWidth, length: t.length, count: t.count, from: 'cut' });
    }
  }
  for (const m of result.moldingLeftovers) {
    if (m.leftover <= 0) continue;
    add({ shape: '마감몰딩', shapeKey: m.shapeKey, color: m.color, kind: 'molding',
      width: 15, length: m.leftover, count: m.count, from: 'molding' });
  }

  return [...map.values()].sort((a, b) => b.width * b.length - a.width * a.length);
}

export const LEFTOVER_SOURCE = {
  cut: '세로 자르고 남은 부분',
  molding: '마감몰딩 남은 길이',
};

// --- 3. 출력 형식 -----------------------------------------------------------

/** 같은 스토어 옵션에 색이 둘 이상 섞이면 괄호로 내역을 덧붙인다. */
function colorNote(rows, countOf) {
  return rows.length > 1 ? ` (${rows.map((r) => `${r.color} ${countOf(r)}`).join(', ')})` : '';
}

/**
 * 주문 요약. 스토어 옵션명 그대로 적어서 주문서와 한 줄씩 대조할 수 있게 한다.
 * 줄 순서도 스토어 옵션 순서를 따른다.
 */
export function formatOrderSummary(result) {
  const lines = result.boards.map((b) =>
    `${STORE_OPTIONS.shape} / ${b.shape}, ${STORE_OPTIONS.color} / ` +
    `${storeColorLabel(b.color, b.shapeKey)} : ${b.sheets}개`);

  if (result.cutCount > 0) {
    lines.push(`${STORE_OPTIONS.cutting} : ${result.cutCount}개`);
  }

  for (const length of MOLDING_LENGTHS) {
    const rows = result.moldings.filter((m) => m.length === length);
    if (rows.length === 0) continue;
    const total = rows.reduce((sum, m) => sum + m.count, 0);
    lines.push(`${STORE_OPTIONS.moldingByLength[length]} : ${total}개${colorNote(rows, (r) => r.count)}`);
  }

  for (const shapeKey of Object.keys(SHAPES)) {
    const rows = result.stripOrders.filter((s) => s.shapeKey === shapeKey);
    if (rows.length === 0) continue;
    const total = rows.reduce((sum, s) => sum + s.bars, 0);
    lines.push(`${STORE_OPTIONS.stripByShape[shapeKey]} : ${total}개${colorNote(rows, (r) => r.bars)}`);
  }

  return lines.join('\n');
}

/**
 * 관리자페이지 주문요약. 한 줄이 자재 한 종류다.
 *
 *   상품명 \t 자재규격 \t 색상 \t 수량(자재 개수) \t 재단내역
 *   붙이는 사각템바 12T_30cm \t 300*2440*12T \t JA8401-연한오크 \t 3 \t 300*1170*12T 6조각
 *
 * 탭으로 나눠서 표에 그대로 붙여넣을 수 있게 한다. 색상별로 원장 → 낱개 → 몰딩 순.
 * 재단내역의 세로 숫자는 재단 지시서와 같게 **완성 치수**다.
 * 폭은 자재 규격 그대로다. 폭 재단을 하지 않으므로 좁혀 적는 줄은 나오지 않는다.
 * 마감몰딩은 자르지 않으므로 재단내역 칸 없이 4칸만 낸다.
 */
export function formatAdminOrder(result) {
  const rows = [];

  for (const s of result.stocks) {
    const product = ADMIN_PRODUCTS[s.shapeKey];
    const width = s.kind === STOCK_STRIP ? STRIP_WIDTH : product.boardWidth;
    const spec = (length) => `${width}*${length}*${product.thickness}`;
    const detail = result.cuts
      .filter((c) => c.shapeKey === s.shapeKey && c.color === s.color && c.kind === s.kind)
      .map((c) => `${spec(c.finishedLength)} ${c.pieces}조각`)
      .join(' / ');

    rows.push({
      color: s.color,
      kindRank: s.kind === STOCK_STRIP ? 1 : 0,
      shape: s.shape,
      sub: 0,
      cells: [
        product.name + ADMIN_SIZE_SUFFIX[s.kind],
        spec(s.sheetLength),
        storeColorLabel(s.color, s.shapeKey),
        s.bars,
        detail,
      ],
    });
  }

  // 몰딩은 우리가 자르지 않으므로 재단내역 칸 없이 4칸이다.
  for (const m of result.moldings) {
    rows.push({
      color: m.color,
      kindRank: 2,
      shape: '',
      sub: -m.length, // 긴 규격부터
      cells: [
        ADMIN_MOLDING.name,
        `${ADMIN_MOLDING.width}*${m.length}*${ADMIN_MOLDING.thickness}`,
        storeColorLabel(m.color, m.shapeKey),
        m.count,
      ],
    });
  }

  return rows
    .sort((a, b) => (
      colorRank(a.color) - colorRank(b.color) ||
      a.kindRank - b.kindRank ||
      a.shape.localeCompare(b.shape) ||
      a.sub - b.sub
    ))
    .map((r) => r.cells.join('\t'))
    .join('\n');
}

/**
 * 재단 지시서. 작업장용이라 색상 이름만 쓴다. 낱개는 100폭으로 표시.
 * 적는 숫자는 **완성 치수**다. 재단손실 5mm 는 자르는 쪽이 감안한다.
 * (읽는 사람이 주문한 치수를 그대로 보게 하려는 것. 원장 점유 길이는 cutLength)
 */
export function formatCuttingSheet(result) {
  const lines = result.cuts.map((c) => {
    const stock = c.kind === STOCK_STRIP ? ` ${STRIP_WIDTH}폭` : '';
    return `${c.shape}-${c.color}${stock} : ${c.finishedLength} - ${c.pieces}조각`;
  });

  // 마감몰딩은 자르지 않지만, 어느 색 몰딩이 어디(상단/하단)에 몇 개 같이 나가는지 적는다.
  const colors = [...new Set(result.moldings.map((m) => m.color))];
  for (const color of colors) {
    const faces = result.items.filter((it) => it.color.name === color);
    const where = [
      faces.some((it) => it.input.useMolding) && '상단',
      faces.some((it) => it.input.bottomMolding) && '하단',
    ].filter(Boolean).join('·');
    const specs = result.moldings
      .filter((m) => m.color === color)
      .sort((a, b) => b.length - a.length)
      .map((m) => `${m.length} - ${m.count}개`)
      .join(', ');
    lines.push(`마감몰딩-${color} (${where}) : ${specs}`);
  }
  return lines.join('\n');
}

export const NO_LEFTOVER_TEXT = '자투리 없음';

/**
 * 자투리 내역.
 * 작업장 용어(원장/자투리) 대신 실제 조각 크기를 가로 X 세로로 적는다.
 */
export function formatLeftovers(result) {
  const lines = [];
  for (const row of result.leftovers) {
    for (const t of row.sheetTails) {
      lines.push(`${row.shape}-${row.color} : 가로 ${row.stockWidth} X 세로 ${t.length}, ${t.count}개 (세로 자르고 남은 부분)`);
    }
  }
  for (const m of result.moldingLeftovers) {
    if (m.leftover <= 0) {
      lines.push(`마감몰딩-${m.color} : 남는 길이 없음`);
    } else {
      lines.push(`마감몰딩-${m.color} : ${m.leftover} 남음` + (m.count > 1 ? `, ${m.count}개` : ''));
    }
  }
  return lines.join('\n');
}

/** 재단 지시서 + 자투리 (클립보드 복사용 전체 텍스트) */
export function formatCuttingSheetWithLeftovers(result) {
  const leftovers = formatLeftovers(result) || NO_LEFTOVER_TEXT;
  return `${formatCuttingSheet(result)}\n\n--- 자투리 ---\n${leftovers}`;
}
