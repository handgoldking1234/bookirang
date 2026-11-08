// Vercel 어댑터: /api/booktalk → 북토킹 모듈 서버 로직
// 환경변수: ANTHROPIC_API_KEY (필수), OPENAI_API_KEY (선택, 자연스러운 목소리)
//          CLAUDE_MODEL_OCR, CLAUDE_MODEL_CHAT, CLAUDE_MODEL, OPENAI_TTS_MODEL, OPENAI_TTS_VOICE, OPENAI_STT_MODEL (선택)
const { handleBookTalk } = require('../booktalk/server/handler');

module.exports = async function (req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST만 가능해요' }); return; }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const out = await handleBookTalk(body, {
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.CLAUDE_MODEL,
      ocrModel: process.env.CLAUDE_MODEL_OCR,
      chatModel: process.env.CLAUDE_MODEL_CHAT,
      openaiKey: process.env.OPENAI_API_KEY,
      ttsModel: process.env.OPENAI_TTS_MODEL,
      ttsVoice: process.env.OPENAI_TTS_VOICE,
      sttModel: process.env.OPENAI_STT_MODEL
    });
    res.status(200).json(out);
  } catch (e) {
    res.status(500).json({ error: e.message || '오류가 났어요' });
  }
};
