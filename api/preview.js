/**
 * 벽 사진 + 색상 선택 → 템바보드가 붙은 이미지를 AI 로 만들어 돌려준다.
 *
 * 브라우저에서 직접 부르면 API 키가 노출되므로 이 함수가 대신 부른다.
 * 키는 환경변수 GEMINI_API_KEY 에 둔다 (Vercel > Settings > Environment Variables).
 *
 * 배포: 저장소를 Vercel 에 연결하면 이 파일이 자동으로 /api/preview 가 된다.
 */

const MODEL = process.env.PREVIEW_MODEL || 'gemini-2.5-flash-image';
const ENDPOINT = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

/**
 * 업로드 상한. 프론트가 긴 변 1280px JPEG 로 줄여서 보내므로 보통 200~500KB 다.
 * Vercel 서버리스 함수는 요청 본문이 4.5MB 를 넘으면 함수까지 오지도 않는다.
 */
const MAX_BYTES = 3 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

/**
 * 한 인스턴스가 살아 있는 동안의 호출 간격 제한.
 * 서버리스라 인스턴스가 여러 개면 우회되지만, 실수로 새로고침을 연타했을 때
 * 크레딧이 줄줄 새는 것 정도는 막는다.
 * ponytail: 인스턴스 단위 방어. 진짜 남용을 막아야 하면 Vercel KV 로 IP·일일 한도를 건다.
 */
const lastCallAt = new Map();
const MIN_GAP_MS = 3000;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST 로 보내 주세요.' });
  }
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return res.status(500).json({ error: 'GEMINI_API_KEY 가 설정되지 않았습니다.' });
  }

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const now = Date.now();
  if (now - (lastCallAt.get(ip) ?? 0) < MIN_GAP_MS) {
    return res.status(429).json({ error: '잠시 후 다시 시도해 주세요.' });
  }
  lastCallAt.set(ip, now);

  const { imageBase64, mimeType, prompt } = req.body ?? {};
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
  if (typeof prompt !== 'string' || prompt.length > 4000) {
    return res.status(400).json({ error: '요청 내용이 올바르지 않습니다.' });
  }

  try {
    const upstream = await fetch(ENDPOINT(MODEL), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            { inline_data: { mime_type: mimeType, data: imageBase64 } },
            { text: prompt },
          ],
        }],
      }),
    });

    if (!upstream.ok) {
      const detail = await upstream.text();
      console.error('image api error', upstream.status, detail.slice(0, 500));
      return res.status(502).json({ error: '이미지를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.' });
    }

    const data = await upstream.json();
    const parts = data?.candidates?.[0]?.content?.parts ?? [];
    // 응답 형식이 inline_data / inlineData 둘 다로 오는 경우가 있어 양쪽을 본다
    const image = parts.map((p) => p.inline_data ?? p.inlineData).find((d) => d?.data);

    if (!image) {
      // 모델이 이미지를 거절하고 텍스트만 돌려주는 경우 (사람 얼굴이 크게 나온 사진 등)
      const text = parts.map((p) => p.text).filter(Boolean).join(' ').slice(0, 200);
      console.error('no image in response', text);
      return res.status(422).json({
        error: '이 사진으로는 합성하지 못했습니다. 벽이 잘 보이는 다른 사진으로 시도해 주세요.',
      });
    }

    return res.status(200).json({
      imageBase64: image.data,
      mimeType: image.mime_type ?? image.mimeType ?? 'image/png',
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: '이미지를 만들지 못했습니다.' });
  }
}
