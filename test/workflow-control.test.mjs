import test from 'node:test';
import assert from 'node:assert/strict';
import { isWorkflowEnabled, startNextRun } from '../workflow-control.mjs';

const env = {
  GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'hijinnn/everland-safari-alert',
  GITHUB_REF: 'refs/heads/main', GITHUB_TOKEN: 'test-secret',
};

test('로컬 감시는 GitHub 상태 조회를 필요로 하지 않는다', async () => {
  assert.equal(await isWorkflowEnabled({}, async () => assert.fail('must not fetch')), true);
});

test('활성 상태에서만 다음 main 감시 실행을 요청한다', async () => {
  const calls = [];
  assert.equal(await startNextRun(env, async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) return { ok: true, json: async () => ({ state: 'active' }) };
    return { status: 204 };
  }), true);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.method, 'POST');
  assert.deepEqual(JSON.parse(calls[1].options.body), { ref: 'main', inputs: { test_notification: false } });
});

test('Disable 상태에서는 다음 실행을 요청하지 않는다', async () => {
  for (const state of ['disabled_manually', 'disabled_inactivity', 'disabled_fork', 'deleted']) {
    let calls = 0;
    assert.equal(await startNextRun(env, async () => {
      calls += 1;
      return { ok: true, json: async () => ({ state }) };
    }), false);
    assert.equal(calls, 1);
  }
});

test('dev 또는 연결 테스트 실행은 연속 감시를 시작하지 않는다', async () => {
  const noFetch = async () => assert.fail('must not fetch');
  assert.equal(await startNextRun({ ...env, GITHUB_REF: 'refs/heads/dev' }, noFetch), false);
  assert.equal(await startNextRun({ ...env, TEST_NOTIFICATION: 'true' }, noFetch), false);
});

test('활성 상태 확인 실패와 알 수 없는 상태에서 다음 실행을 시작하지 않는다', async () => {
  await assert.rejects(startNextRun(env, async () => ({ ok: false, status: 403 })), /HTTP 403/);
  await assert.rejects(startNextRun(env, async () => ({ ok: true, json: async () => ({ state: 'unknown' }) })), /알 수 없는/);
  await assert.rejects(startNextRun(env, async () => { throw new Error('test-secret'); }), error => !error.message.includes('test-secret'));
});

test('다음 실행 요청 실패를 성공으로 표시하지 않는다', async () => {
  let calls = 0;
  await assert.rejects(startNextRun(env, async () => {
    if (++calls === 1) return { ok: true, json: async () => ({ state: 'active' }) };
    return { status: 422 };
  }), /HTTP 422/);
});
