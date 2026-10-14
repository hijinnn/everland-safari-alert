import { readFile, writeFile, mkdir, appendFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isWorkflowEnabled } from './workflow-control.mjs';

export const MENU_ID = '01020100000000000004';
export const BOOKING_URL = `https://reservation.everland.com/web/el.do?method=getProduct&top_menu_id=01&high_menu_id=0102&menu_id=${MENU_ID}`;
const API_URL = 'https://reservation.everland.com/web/comm.do';
const USER_AGENT = 'Mozilla/5.0 (compatible; EverlandSafariAvailability/1.0)';

export function validateDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00+09:00`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new Error('TARGET_DATE는 유효한 YYYY-MM-DD 날짜여야 합니다.');
  }
  return value;
}

function checkedAt() {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'medium',
  }).format(new Date()) + ' KST';
}

export function decodeResult(payload) {
  let result = payload?.result;
  if (typeof result === 'string') {
    try { result = JSON.parse(result); } catch { throw new Error('에버랜드 result가 올바른 JSON이 아닙니다.'); }
  }
  if (!result || typeof result !== 'object') throw new Error('에버랜드 응답에 result가 없습니다.');
  return result;
}

export function parseStatus(payload) {
  const code = String(decodeResult(payload).resultCode ?? '');
  if (code === '-1') return false;
  if (code === '00') return true;
  throw new Error(`알 수 없는 예약 상태 코드: ${code || '(없음)'}`);
}

export function parseCalendar(payload, date) {
  const result = decodeResult(payload);
  const compact = date.replaceAll('-', '');
  if (result.cur_mon !== compact.slice(0, 6) || !Array.isArray(result.calList)) {
    throw new Error('예약 달력의 월 또는 날짜 목록이 올바르지 않습니다.');
  }
  const day = result.calList.find(row => Number(row.date) === Number(compact.slice(6)));
  if (!day || !['0', '1', '2'].includes(String(day.capaFg))) throw new Error('예약 달력에서 대상 날짜 상태를 확인할 수 없습니다.');
  // 날짜 선택 가능 여부와 checkCapaWoS를 함께 확인한다. capaFg=1 단독으로 알리지 않는다.
  return String(day.selected) === 'true' && String(day.capaFg) === '1';
}

export function parseProducts(payload) {
  const products = decodeResult(payload);
  if (!Array.isArray(products)) throw new Error('상품 목록 형식이 올바르지 않습니다.');
  return products.some(product => product.MENU_ID === MENU_ID && product.CAPA_ITEM_DIV_CD === 'C004' &&
    product.CAPA_FG === 'CAPA' && product.USE_YN === 'Y' && product.DISP_YN === 'Y' &&
    /^\d+$/.test(String(product.SELL_AMT)) && Number(product.SELL_AMT) > 0);
}

async function requestJson(url, options = {}, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(url, {
      ...options,
      headers: { 'User-Agent': USER_AGENT, Referer: BOOKING_URL, 'X-Requested-With': 'XMLHttpRequest', ...options.headers },
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new Error('에버랜드 연결 실패 또는 15초 응답 시간 초과');
  }
  if (!response.ok) throw new Error(`에버랜드 조회 실패: HTTP ${response.status}`);
  try { return await response.json(); } catch {
    throw new Error('에버랜드가 JSON 대신 로그인·오류·차단 페이지를 반환했습니다.');
  }
}

function postParams(params) {
  return { method: 'POST', body: new URLSearchParams(params) };
}

export async function checkAvailability(date, fetchImpl = fetch) {
  const compact = date.replaceAll('-', '');
  const status = await requestJson(`${API_URL}?${new URLSearchParams({ cmethod: 'checkCapaWoS', menu_id: MENU_ID, visit_pl_dt: compact })}`, {}, fetchImpl);
  if (!parseStatus(status)) return { available: false, reason: '잔여 수량 없음' };
  const calendar = await requestJson(API_URL, postParams({
    method: 'calendarWoS', s_top_menu_id: '01', chkMenuId: MENU_ID,
    param_mon: compact.slice(0, 6), dispChannel: '', cache_yn: 'N',
  }), fetchImpl);
  if (!parseCalendar(calendar, date)) return { available: false, reason: '달력에서 예약 불가 / 미오픈' };
  const products = await requestJson(API_URL, postParams({
    cmethod: 'getProdInfoNewWoS', top_menu_id: '01', leaf_menu_id: MENU_ID, visit_pl_dt: compact,
    prod_cd: '', menu_seq_no: '', co_cd: '', productSearch: 'Y',
  }), fetchImpl);
  if (!parseProducts(products)) return { available: false, reason: '판매 가능한 사파리 상품 없음' };
  return { available: true, reason: '예약 가능 표시 확인 (정확한 시간·수량은 예약 화면에서 확인)' };
}

export function shouldNotify(previous, available, nowMs, remindMs = 30 * 60_000) {
  return available && (previous.available !== true || !previous.lastAlertAt || nowMs - previous.lastAlertAt >= remindMs);
}

export async function sendTelegram(message, env = process.env, fetchImpl = fetch) {
  const token = env.SAFARI_TELEGRAM_BOT_TOKEN || env.TELEGRAM_BOT_TOKEN;
  const chatId = env.SAFARI_TELEGRAM_CHAT_ID || env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) throw new Error('새 텔레그램 봇 토큰과 채팅 ID를 설정하세요.');
  let response;
  try {
    response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(15000),
    });
  } catch { throw new Error('텔레그램 연결 실패 또는 응답 시간 초과'); }
  let result;
  try { result = await response.json(); } catch { throw new Error(`텔레그램 응답 형식 오류: HTTP ${response.status}`); }
  if (!response.ok || result.ok !== true) throw new Error(`텔레그램 전송 실패: HTTP ${response.status}`);
}

async function loadState(path, date) {
  let state;
  try { state = JSON.parse(await readFile(path, 'utf8')); } catch (error) {
    if (error.code === 'ENOENT') return { date, available: false };
    throw new Error('알림 상태 파일을 읽을 수 없습니다. 파일을 확인하세요.');
  }
  if (state.date !== date) return { date, available: false };
  return state;
}

async function saveState(path, state) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(`${path}.tmp`, JSON.stringify(state, null, 2) + '\n');
  await rename(`${path}.tmp`, path);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, 'state_changed=true\n');
}

export async function runCheck({ date, statePath, dryRun, check = checkAvailability, send = sendTelegram }) {
  const previous = await loadState(statePath, date);
  const result = await check(date);
  console.log(`${date} / ${checkedAt()} / ${result.reason}`);
  if (dryRun) return result;
  const next = { ...previous, date, available: result.available };
  const now = Date.now();
  if (shouldNotify(previous, result.available, now)) {
    await send(`🦁 에버랜드 사파리 스페셜투어 예약 가능 표시\n\n이용일: ${date}\n정확한 시간과 수량은 예약 화면에서 확인해주세요.\n${BOOKING_URL}\n\n확인: ${checkedAt()}\n예약 가능 상태가 유지되면 30분 후 다시 알려드립니다. 예약을 마치면 알림 작업을 중지하세요.`);
    next.lastAlertAt = now;
    console.log('텔레그램 알림 전송 완료');
  }
  if (JSON.stringify(next) !== JSON.stringify(previous)) await saveState(statePath, next);
  return result;
}

export async function main(args = process.argv.slice(2), env = process.env, {
  check = runCheck, enabled = () => isWorkflowEnabled(env), now = Date.now,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
  const date = validateDate(env.TARGET_DATE || '2026-10-24');
  if (args.includes('--test-notification') || env.TEST_NOTIFICATION === 'true') {
    await sendTelegram(`✅ 사파리 알림 연결 테스트\n대상 이용일: ${date}\n실제 빈자리 알림이 아닙니다.`, env);
    console.log('테스트 알림 전송 완료');
    return;
  }
  const dryRun = args.includes('--dry-run');
  const watch = args.includes('--watch');
  if (!dryRun && (!(env.SAFARI_TELEGRAM_BOT_TOKEN || env.TELEGRAM_BOT_TOKEN) || !(env.SAFARI_TELEGRAM_CHAT_ID || env.TELEGRAM_CHAT_ID))) {
    throw new Error('텔레그램 봇 토큰과 채팅 ID가 필요합니다. 조회만 하려면 --dry-run을 사용하세요.');
  }
  const seconds = Number(env.POLL_INTERVAL_SECONDS || 10);
  const duration = Number(env.WATCH_SECONDS || 0);
  if (!Number.isFinite(seconds) || seconds < 10 || !Number.isFinite(duration) || duration < 0) throw new Error('조회 간격은 10초 이상, 감시 시간은 0 이상의 숫자여야 합니다.');
  const deadline = duration > 0 ? now() + duration * 1000 : Infinity;
  const statePath = resolve(env.STATE_FILE || '.state/safari.json');
  let failures = 0;
  do {
    try {
      if (!await enabled()) {
        console.log('워크플로가 Disable되어 감시를 종료합니다.');
        return;
      }
      await check({ date, statePath, dryRun, send: message => sendTelegram(message, env) });
      failures = 0;
    } catch (error) {
      failures += 1;
      console.error(`${checkedAt()} / ${error.message}`);
      if (!watch) throw new Error('조회 또는 알림 실패. 예약 가능 여부를 확인할 수 없습니다.');
    }
    if (!watch || now() + seconds * 1000 >= deadline) break;
    await sleep(seconds * 1000);
  } while (true);
  if (failures) throw new Error('마지막 예약 상태 조회 또는 알림이 실패했습니다.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
