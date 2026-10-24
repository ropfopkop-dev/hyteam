// Текущий адрес магазина в файле server-address.json репозитория GitHub.
// Сервер публикует туда адрес туннеля, когда он меняется; программа HYTEAM читает его при запуске
// и подключается сама — друзьям не нужно вводить адрес, даже если он …trycloudflare.com и меняется.
const FILE = 'server-address.json';
const UA = 'HYTEAM';

const apiUrl = (repo) => `https://api.github.com/repos/${repo}/contents/${FILE}`;

/** Прочитать опубликованный адрес. Возвращает origin или '' (сеть, GitHub недоступен, файла нет). */
export async function fetchAddress(repo, { fetchFn = fetch, timeout = 5000 } = {}) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '')) return '';
  // API отдаёт свежий файл сразу; raw.githubusercontent.com — запасной вариант (кэш до 5 минут).
  for (const [url, headers] of [
    [apiUrl(repo), { Accept: 'application/vnd.github.raw+json', 'User-Agent': UA }],
    [`https://raw.githubusercontent.com/${repo}/main/${FILE}`, { 'User-Agent': UA }],
  ]) {
    try {
      const res = await fetchFn(url, { headers, cache: 'no-store', signal: AbortSignal.timeout(timeout) });
      if (!res.ok) continue;
      const u = new URL(String((await res.json()).url || ''));
      if (u.protocol === 'https:' || u.protocol === 'http:') return u.origin;
    } catch {
      /* пробуем следующий источник */
    }
  }
  return '';
}

/**
 * Записать адрес в репозиторий. token — fine-grained токен GitHub с правом Contents: Read and write
 * только на этот репозиторий. Возвращает 'same', если адрес не изменился.
 */
export async function publishAddress(repo, token, url, { fetchFn = fetch } = {}) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': UA,
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const origin = new URL(url).origin;
  const cur = await fetchFn(apiUrl(repo), { headers, cache: 'no-store', signal: AbortSignal.timeout(15000) });
  let sha;
  if (cur.ok) {
    const j = await cur.json();
    sha = j.sha;
    try {
      if (JSON.parse(Buffer.from(j.content, 'base64').toString('utf8')).url === origin) return 'same';
    } catch {
      /* файл испорчен — перезапишем */
    }
  } else if (cur.status !== 404) {
    throw new Error(cur.status === 401 ? 'GitHub не принял токен — проверьте его' : `GitHub ответил ${cur.status}`);
  }
  const body = JSON.stringify({ url: origin, updated: new Date().toISOString() }, null, 2) + '\n';
  const res = await fetchFn(apiUrl(repo), {
    method: 'PUT',
    headers,
    body: JSON.stringify({ message: `Адрес сервера: ${origin}`, content: Buffer.from(body).toString('base64'), sha }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    throw new Error(res.status === 403 || res.status === 404
      ? 'У токена нет права записи в репозиторий (нужно Contents: Read and write)'
      : `GitHub ответил ${res.status}`);
  }
  return 'updated';
}
