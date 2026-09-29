/**
 * 벽 사진 + 색상 선택 → 템바보드가 붙은 이미지를 만들어 돌려준다.
 *
 * 힉스필드 API 를 쓴다. 모델은 Marketing Studio Image 2.5 Flare
 * (= 커넥터로 테스트했던 GPT Image 2.5 Flare 와 같은 모델).
 *
 * 생성이 30~60초 걸려서 서버리스 함수 하나로는 타임아웃이 난다. 그래서 둘로 나눈다.
 *   POST /api/preview          → 사진 업로드 + 생성 요청 → { requestId }
 *   GET  /api/preview?id=...   → 상태 조회 → { status } 또는 { status, imageUrl }
 * 브라우저가 몇 초 간격으로 GET 을 두드린다.
 *
 * 키는 환경변수 두 개에 둔다. 코드에도 git 에도 절대 넣지 않는다.
 *   HF_API_KEY_ID / HF_API_KEY_SECRET
 * console.higgsfield.ai 에서 발급하고 Vercel > Settings > Environment Variables 에 넣는다.
 */

const API = 'https://api.higgsfield.ai';
const ENDPOINT = process.env.PREVIEW_ENDPOINT || 'marketing-studio/image/flare';
/** low/medium/high/xhigh/max. 올릴수록 장당 비용이 오른다. */
const QUALITY = process.env.PREVIEW_QUALITY || 'low';
const RESOLUTION = process.env.PREVIEW_RESOLUTION || '1k';

/**
 * 업로드 상한. 프론트가 긴 변 1280px JPEG 로 줄여 보내므로 보통 200~500KB 다.
 * Vercel 서버리스 함수는 요청 본문이 4.5MB 를 넘으면 함수까지 오지도 않는다.
 */
const MAX_BYTES = 3 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
/**
 * 이 엔드포인트가 받는 비율. 스키마에 없는 값을 보내면 400 이 난다.
 * ('auto' 도 있지만 enhance_prompt=false 에서는 정사각으로 떨어져서 뺐다)
 */
const ALLOWED_RATIO = new Set([
  '1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9',
]);

/**
 * 한 인스턴스가 살아 있는 동안의 호출 간격 제한.
 * ponytail: 인스턴스 단위 방어라 완전하지 않다. 진짜 남용을 막으려면 Vercel KV 로 일일 한도.
 */
const lastCallAt = new Map();
const MIN_GAP_MS = 3000;

/**
 * 붙여넣을 때 딸려오는 앞뒤 공백·줄바꿈을 털어낸다.
 * 이게 섞이면 헤더가 깨져서 401 이 나는데 화면만 봐서는 원인을 알 수 없다.
 */
const keyId = () => (process.env.HF_API_KEY_ID || '').trim();
const keySecret = () => (process.env.HF_API_KEY_SECRET || '').trim();
const authHeader = () => `Key ${keyId()}:${keySecret()}`;

export default async function handler(req, res) {
  if (!keyId() || !keySecret()) {
    return res.status(500).json({ error: '힉스필드 API 키가 설정되지 않았습니다.' });
  }
  if (req.method === 'GET') return status(req, res);
  if (req.method === 'POST') return submit(req, res);
  return res.status(405).json({ error: 'POST 또는 GET 으로 보내 주세요.' });
}

/** 생성 요청을 넣고 requestId 만 돌려준다. 결과는 기다리지 않는다. */
async function submit(req, res) {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const now = Date.now();
  if (now - (lastCallAt.get(ip) ?? 0) < MIN_GAP_MS) {
    return res.status(429).json({ error: '잠시 후 다시 시도해 주세요.' });
  }
  lastCallAt.set(ip, now);

  const { imageBase64, mimeType, prompt, aspectRatio } = req.body ?? {};
  if (typeof imageBase64 !== 'string' || !imageBase64) {
    return res.status(400).json({ error: '사진이 없습니다.' });
  }
  if (!ALLOWED_MIME.has(mimeType)) {
    return res.status(400).json({ error: 'JPG / PNG / WEBP 만 올릴 수 있습니다.' });
  }
  // base64 4글자 = 3바이트
  if (imageBase64.length * 0.75 > MAX_BYTES) {
    return res.status(413).json({ error: '사진이 너무 큽니다.' });
  }
  if (typeof prompt !== 'string' || !prompt || prompt.length > 4000) {
    return res.status(400).json({ error: '요청 내용이 올바르지 않습니다.' });
  }
  const ratio = ALLOWED_RATIO.has(aspectRatio) ? aspectRatio : '16:9';

  try {
    const slotRes = await fetch(`${API}/files/generate-upload-url`, {
      method: 'POST',
      headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ content_type: mimeType }),
    });
    if (!slotRes.ok) throw new Error(`upload-url ${slotRes.status} ${await slotRes.text()}`);
    const slot = await slotRes.json();

    const putRes = await fetch(slot.upload_url, {
      method: 'PUT',
      headers: slot.upload_headers ?? { 'Content-Type': mimeType },
      body: Buffer.from(imageBase64, 'base64'),
    });
    if (!putRes.ok) throw new Error(`put ${putRes.status}`);

    const genRes = await fetch(`${API}/${ENDPOINT}`, {
      method: 'POST',
      headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        image_urls: [slot.public_url],
        aspect_ratio: ratio,
        resolution: RESOLUTION,
        quality: QUALITY,
        enhance_prompt: false,
      }),
    });
    if (!genRes.ok) throw new Error(`generate ${genRes.status} ${await genRes.text()}`);
    const job = await genRes.json();

    return res.status(200).json({ requestId: job.request_id });
  } catch (e) {
    console.error('submit', e);
    // 어느 단계에서 몇 번으로 막혔는지만 실어 보낸다.
    // 응답 본문은 넣지 않는다 — 키나 내부 정보가 섞여 나갈 수 있다.
    const code = String(e.message || '').split(' ').slice(0, 2).join(' ');
    const error = code.endsWith(' 401')
      ? '힉스필드 API 키가 올바르지 않습니다. 키 ID 와 Secret 을 다시 확인해 주세요.'
      : '이미지를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.';
    return res.status(502).json({ error, code });
  }
}

/** 브라우저가 몇 초마다 부른다. 완료면 이미지 주소를 준다. */
async function status(req, res) {
  const id = req.query?.id;
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) {
    return res.status(400).json({ error: '잘못된 요청입니다.' });
  }
  try {
    const r = await fetch(`${API}/requests/${id}/status`, {
      headers: { Authorization: authHeader() },
    });
    if (!r.ok) throw new Error(`status ${r.status}`);
    const data = await r.json();

    if (data.status === 'completed') {
      const url = data.images?.[0]?.url;
      if (!url) throw new Error('완료됐는데 이미지가 없다');
      return res.status(200).json({ status: 'completed', imageUrl: url });
    }
    if (data.status === 'failed' || data.status === 'canceled') {
      return res.status(200).json({
        status: 'failed',
        error: '이 사진으로는 합성하지 못했습니다. 벽이 잘 보이는 다른 사진으로 시도해 주세요.',
      });
    }
    return res.status(200).json({ status: data.status ?? 'queued' });
  } catch (e) {
    console.error('status', e);
    return res.status(502).json({ error: '상태를 확인하지 못했습니다.' });
  }
}
