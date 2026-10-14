// 봇 토큰은 .env에서만 읽고 채팅 ID만 출력한다. 메시지 본문과 사용자 이름은 출력하지 않는다.
const token = process.env.SAFARI_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
try {
  if (!token) throw new Error('.env의 TELEGRAM_BOT_TOKEN을 먼저 설정하세요.');
  let response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/getUpdates`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timeout: 0, allowed_updates: ['message', 'channel_post'] }),
      signal: AbortSignal.timeout(15000),
    });
  } catch { throw new Error('텔레그램 연결 실패'); }
  const data = await response.json();
  if (!response.ok || data.ok !== true) throw new Error(`텔레그램 조회 실패: HTTP ${response.status}`);
  const chats = new Map();
  for (const update of data.result) {
    const chat = (update.message || update.channel_post)?.chat;
    if (chat) chats.set(chat.id, chat.type);
  }
  if (!chats.size) throw new Error('새 봇에게 /start를 보내거나 새 그룹에 봇을 추가한 뒤 /start@봇사용자명을 보내고 다시 실행하세요.');
  for (const [id, type] of chats) console.log(`TELEGRAM_CHAT_ID=${id} (${type})`);
} catch (error) {
  // 네트워크 예외나 JSON 파싱 오류의 원문에는 토큰 URL이 들어갈 수 있다.
  console.error(error instanceof SyntaxError ? '텔레그램 응답 형식 오류' : error.message);
  process.exitCode = 1;
}
