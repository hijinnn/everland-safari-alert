import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function config(env) {
  const repository = env.GITHUB_REPOSITORY;
  const token = env.GITHUB_TOKEN;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository || '') || !token) {
    throw new Error('워크플로 제어에 필요한 GitHub 저장소 또는 토큰이 없습니다.');
  }
  return {
    url: `https://api.github.com/repos/${repository}/actions/workflows/safari-alert.yml`,
    headers: {
      Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'EverlandSafariAvailability/1.0',
    },
  };
}

async function githubRequest(url, options, fetchImpl) {
  try { return await fetchImpl(url, { ...options, signal: AbortSignal.timeout(15000) }); }
  catch { throw new Error('GitHub 워크플로 연결 실패 또는 응답 시간 초과'); }
}

export async function isWorkflowEnabled(env = process.env, fetchImpl = fetch) {
  if (env.GITHUB_ACTIONS !== 'true') return true;
  const { url, headers } = config(env);
  const response = await githubRequest(url, { headers }, fetchImpl);
  if (!response.ok) throw new Error(`워크플로 상태 조회 실패: HTTP ${response.status}`);
  let data;
  try { data = await response.json(); } catch { throw new Error('워크플로 상태 응답 형식 오류'); }
  if (data.state === 'active') return true;
  if (['disabled_manually', 'disabled_inactivity', 'disabled_fork', 'deleted'].includes(data.state)) return false;
  throw new Error('알 수 없는 워크플로 활성 상태');
}

export async function startNextRun(env = process.env, fetchImpl = fetch) {
  if (env.GITHUB_REF !== 'refs/heads/main' || env.TEST_NOTIFICATION === 'true') return false;
  if (!await isWorkflowEnabled(env, fetchImpl)) {
    console.log('워크플로가 Disable되어 다음 감시를 시작하지 않습니다.');
    return false;
  }
  const { url, headers } = config(env);
  const response = await githubRequest(`${url}/dispatches`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: 'main', inputs: { test_notification: false } }),
  }, fetchImpl);
  if (response.status !== 204) throw new Error(`다음 감시 실행 요청 실패: HTTP ${response.status}`);
  console.log('다음 main 감시 실행을 요청했습니다.');
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  startNextRun().catch(error => { console.error(error.message); process.exitCode = 1; });
}
