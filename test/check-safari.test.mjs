import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MENU_ID, bookingClosed, validateDate, parseStatus, parseCalendar, parseProducts,
  checkAvailability, shouldNotify, runCheck, sendTelegram,
} from '../check-safari.mjs';

const date = '2026-10-24';
const calendar = (selected = 'true', capaFg = '1') => ({ result: {
  cur_mon: '202610', calList: [{ date: '24', selected, capaFg }],
} });
const products = { result: [{ MENU_ID, CAPA_ITEM_DIV_CD: 'C004', CAPA_FG: 'CAPA',
  USE_YN: 'Y', DISP_YN: 'Y', SELL_AMT: '350000' }] };

function responses(payloads) {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    const payload = payloads.shift();
    if (payload instanceof Error) throw payload;
    assert.notEqual(payload, undefined, 'unexpected extra request');
    return { ok: true, status: 200, json: async () => payload };
  };
  return { fetch, calls };
}

test('방문 당일 0시 KST에 종료하고 잘못된 날짜를 거절한다', () => {
  assert.equal(bookingClosed(date, new Date('2026-10-23T14:59:59Z')), false);
  assert.equal(bookingClosed(date, new Date('2026-10-23T15:00:00Z')), true);
  assert.equal(validateDate(date), date);
  assert.throws(() => validateDate('2026-02-30'));
  assert.throws(() => validateDate('20261024'));
});

test('문서에서 확인한 잔여 없음 코드와 기존 발렛의 성공 코드를 구별한다', () => {
  assert.equal(parseStatus({ result: { resultCode: '-1' } }), false);
  assert.equal(parseStatus({ result: '{"resultCode":"00"}' }), true);
  for (const payload of [{}, { result: [] }, { result: { resultCode: '99' } }, { result: 'bad' }]) {
    assert.throws(() => parseStatus(payload));
  }
});

test('달력의 대상 월과 날짜 선택 가능 여부를 확인한다', () => {
  assert.equal(parseCalendar(calendar(), date), true);
  assert.equal(parseCalendar(calendar('', '1'), date), false);
  assert.equal(parseCalendar(calendar('true', '2'), date), false);
  assert.throws(() => parseCalendar(calendar(), '2026-11-24'));
  assert.throws(() => parseCalendar({ result: { cur_mon: '202610', calList: [] } }, date));
});

test('사파리 판매 상품만 허용하고 가격 미정 및 다른 상품은 거절한다', () => {
  assert.equal(parseProducts(products), true);
  assert.equal(parseProducts({ result: [{ ...products.result[0], SELL_AMT: '-' }] }), false);
  assert.equal(parseProducts({ result: [{ ...products.result[0], MENU_ID: 'valet' }] }), false);
  assert.equal(parseProducts({ result: [] }), false);
  assert.throws(() => parseProducts({ result: { error: true } }));
});

test('잔여 없음이면 추가 API 요청을 하지 않는다', async () => {
  const api = responses([{ result: { resultCode: '-1' } }]);
  assert.equal((await checkAvailability(date, api.fetch)).available, false);
  assert.equal(api.calls.length, 1);
  assert.match(api.calls[0].url, /visit_pl_dt=20261024/);
  assert.match(api.calls[0].url, new RegExp(MENU_ID));
});

test('상태, 달력, 판매 상품이 모두 일치해야 예약 가능으로 판정한다', async () => {
  const api = responses([{ result: { resultCode: '00' } }, calendar(), products]);
  assert.equal((await checkAvailability(date, api.fetch)).available, true);
  assert.equal(api.calls.length, 3);
  assert.equal(api.calls[1].options.body.get('param_mon'), '202610');
  assert.equal(api.calls[2].options.body.get('visit_pl_dt'), '20261024');
  const unavailable = responses([{ result: { resultCode: '00' } }, calendar('', '0')]);
  assert.equal((await checkAvailability(date, unavailable.fetch)).available, false);
  assert.equal(unavailable.calls.length, 2);
});

test('HTML, 네트워크 오류, HTTP 오류를 매진 또는 빈자리로 오인하지 않는다', async () => {
  await assert.rejects(checkAvailability(date, async () => ({ ok: true, json: async () => { throw new Error('HTML'); } })), /JSON 대신/);
  await assert.rejects(checkAvailability(date, async () => ({ ok: false, status: 403 })), /HTTP 403/);
  await assert.rejects(checkAvailability(date, async () => { throw new Error('network'); }), /연결 실패/);
});

test('최초 빈자리와 재등장은 즉시 알리고, 유지 중에는 30분 간격으로 알린다', () => {
  const now = 2_000_000;
  assert.equal(shouldNotify({}, true, now), true);
  assert.equal(shouldNotify({ available: true, lastAlertAt: now }, true, now + 1000), false);
  assert.equal(shouldNotify({ available: true, lastAlertAt: now }, true, now + 1_800_000), true);
  assert.equal(shouldNotify({ available: false, lastAlertAt: now }, true, now + 1000), true);
  assert.equal(shouldNotify({}, false, now), false);
});

test('전송 성공 후에만 알림 상태를 저장하며 재시작 중복 알림을 억제한다', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'safari-test-'));
  const statePath = join(directory, 'safari.json');
  let sent = 0;
  const available = async () => ({ available: true, reason: 'test' });
  try {
    await assert.rejects(runCheck({ date, statePath, check: available, send: async () => { throw new Error('send failed'); } }), /send failed/);
    await assert.rejects(readFile(statePath), { code: 'ENOENT' });
    const send = async () => { sent += 1; };
    await runCheck({ date, statePath, check: available, send });
    await runCheck({ date, statePath, check: available, send });
    assert.equal(sent, 1);
    await runCheck({ date, statePath, check: async () => ({ available: false, reason: 'sold out' }), send });
    await runCheck({ date, statePath, check: available, send });
    assert.equal(sent, 2);
    assert.equal(JSON.parse(await readFile(statePath, 'utf8')).available, true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('조회 전용 실행은 상태 파일과 텔레그램을 변경하지 않는다', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'safari-test-'));
  const statePath = join(directory, 'safari.json');
  try {
    await runCheck({ date, statePath, dryRun: true, check: async () => ({ available: true, reason: 'test' }), send: async () => assert.fail('should not send') });
    await assert.rejects(readFile(statePath), { code: 'ENOENT' });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('텔레그램 토큰을 오류에 포함하지 않으며 지정한 새 채팅으로 보낸다', async () => {
  const env = { SAFARI_TELEGRAM_BOT_TOKEN: 'secret-token', SAFARI_TELEGRAM_CHAT_ID: 'new-chat' };
  await sendTelegram('test', env, async (url, options) => {
    assert.equal(JSON.parse(options.body).chat_id, 'new-chat');
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  });
  await assert.rejects(sendTelegram('test', env, async () => { throw new Error('secret-token'); }), error => !error.message.includes('secret-token'));
  await assert.rejects(sendTelegram('test', env, async () => ({ ok: false, status: 401, json: async () => ({ ok: false }) })), /HTTP 401/);
});
