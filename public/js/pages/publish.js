import { api, upload, uploadLarge, html, mount, $, $$, fmt, toast, toastError, navigate, confirmBox } from '../lib.js';
import { state, isMod } from '../state.js';
import { icon } from '../components.js';

const MAX_SHOTS = 12;

export default async function publish(el, { params }) {
  const editing = params.id ? await api(`/games/${params.id}`) : null;
  if (editing && !editing.can_edit) throw new Error('У вас нет доступа к редактированию этой игры');
  const g = editing || {
    title: '', short_desc: '', description: '', genre: '', tags: [], version: '1.0',
    platform: 'Windows', requirements: '', category: '', price: 0, external_url: '', screenshots: [], launch: '',
  };
  const maxBytes = state.meta.maxGameMb * 1024 * 1024;
  let source = editing ? (editing.source === 'github' ? 'github' : editing.external ? 'link' : 'file') : 'file';

  const note = isMod()
    ? 'Вы модератор — изменения публикуются сразу, без проверки.'
    : editing
      ? 'После сохранения игра отправится на повторную проверку и временно пропадёт из магазина.'
      : 'После отправки игру проверит модератор. Вы получите уведомление, когда она появится в магазине.';

  mount(el, html`<div class="page-head">
      <h1>${editing ? `Редактирование: ${g.title}` : 'Опубликовать игру или программу'}</h1>
      <p class="muted">${note}</p>
    </div>
    <form class="publish" id="pub" novalidate>
      <div class="pub-main">
        <section class="card pad">
          <h3 class="card-title">${icon('box', 18, 'accent')} Откуда брать файл</h3>
          <div class="seg src-seg" id="src-seg">
            <button type="button" data-src="file">${icon('upload', 15)} Файл</button>
            <button type="button" data-src="github">${icon('code', 15)} GitHub</button>
            <button type="button" data-src="link">${icon('external', 15)} Ссылка</button>
          </div>

          <div class="src-pane" data-pane="file">
            <label class="dropzone" id="dz-file">
              <input type="file" id="f-game" hidden>
              ${icon('upload', 30, 'accent')}
              <b>Перетащите файл сюда или нажмите, чтобы выбрать</b>
              <span class="muted xs">ZIP, RAR, 7z, EXE, APK — ${maxBytes ? `до ${fmt.bytes(maxBytes)}` : 'любого размера'}. Большие файлы загружаются частями и докачиваются при обрыве связи.</span>
              <span class="dz-file" id="file-info">${editing?.source === 'file' && editing.file_name && !editing.external ? `Текущий файл: ${editing.file_name} · ${fmt.bytes(editing.file_size)}` : ''}</span>
            </label>
          </div>

          <div class="src-pane" data-pane="github">
            <div class="field"><label for="gh-repo">Репозиторий GitHub</label>
              <div class="gh-row">
                <input class="input" id="gh-repo" placeholder="https://github.com/автор/проект" value="${g.github?.repo ? `https://github.com/${g.github.repo}` : ''}" spellcheck="false" autocomplete="off">
                <button type="button" class="btn btn-soft" id="gh-find">${icon('search', 15)} Найти</button>
              </div>
            </div>
            <label class="check"><input type="checkbox" id="gh-pre" ${g.github?.prerelease ? 'checked' : ''}> Брать и предварительные версии (pre-release, beta)</label>
            <div id="gh-preview"></div>
            <div class="note">${icon('refresh', 16)}<span>Новые релизы с GitHub появляются в магазине автоматически — сервер проверяет их каждые несколько минут.
              Игроки получат уведомление, а программа HYTEAM обновит установленную игру сама.</span></div>
          </div>

          <div class="src-pane" data-pane="link">
            <div class="field"><label for="p-url">Ссылка на скачивание</label>
              <input class="input" id="p-url" name="external_url" type="url" maxlength="500" value="${editing?.external ? g.external_url || '' : ''}" placeholder="https://…">
              <div class="field-hint">Google Диск, Яндекс Диск, itch.io и т. п. Такая игра открывается у игроков в браузере.</div></div>
          </div>

          <div class="field launch-field"><label for="p-launch">Файл запуска <span class="muted">— необязательно</span></label>
            <input class="input" id="p-launch" name="launch_path" maxlength="200" value="${g.launch || ''}" placeholder="например, game.exe или start.bat">
            <div class="field-hint">Что запускает кнопка «Играть» в программе HYTEAM. Если не указать — программа найдёт .exe сама.</div></div>
        </section>

        <section class="card pad">
          <h3 class="card-title">${icon('edit', 18, 'accent')} Основное</h3>
          <div class="field"><label for="p-title">Название *</label>
            <input class="input" id="p-title" name="title" required minlength="2" maxlength="80" value="${g.title}" placeholder="Например: Neon Drift"></div>
          <div class="field"><label for="p-short">Краткое описание</label>
            <input class="input" id="p-short" name="short_desc" maxlength="300" value="${g.short_desc}" placeholder="Одна-две фразы для карточки в магазине"></div>
          <div class="field"><label for="p-desc">Полное описание</label>
            <textarea class="input" id="p-desc" name="description" rows="8" maxlength="20000" placeholder="Сюжет, особенности, управление, что нового в версии…">${g.description}</textarea></div>
          <div class="form-row">
            <div class="field"><label for="p-genre">Жанр</label>
              <select class="input" id="p-genre" name="genre">${state.meta.genres.map((x) => html`<option ${x === g.genre ? 'selected' : ''}>${x}</option>`)}</select></div>
            <div class="field"><label for="p-platform">Платформа</label>
              <select class="input" id="p-platform" name="platform">${state.meta.platforms.map((x) => html`<option ${x === g.platform ? 'selected' : ''}>${x}</option>`)}</select></div>
            <div class="field"><label for="p-version">Версия</label>
              <input class="input" id="p-version" name="version" maxlength="30" value="${g.version}">
              <div class="field-hint" id="ver-hint" hidden>Берётся из релиза GitHub</div></div>
          </div>
          <div class="form-row">
            <div class="field"><label for="p-cat">Категория программы <span class="muted">— для фильтра в магазине</span></label>
              <select class="input" id="p-cat" name="category"><option value="">Без категории (игра)</option>${state.meta.categories.map((x) => html`<option ${x === g.category ? 'selected' : ''}>${x}</option>`)}</select></div>
            <div class="field"><label for="p-price">Цена, ₽ <span class="muted">— 0 = бесплатно</span></label>
              <input class="input" id="p-price" name="price" type="number" min="0" max="1000000" step="1" value="${g.price || 0}">
              <div class="field-hint">Деньги с покупок приходят на ваш баланс HYTEAM</div></div>
          </div>
          <div class="field"><label for="p-tags">Теги <span class="muted">— через запятую, до 10</span></label>
            <input class="input" id="p-tags" name="tags" value="${g.tags.join(', ')}" placeholder="пиксель-арт, кооператив, рогалик">
            <div class="chips" id="tag-preview"></div></div>
          <div class="field"><label for="p-req">Системные требования</label>
            <textarea class="input" id="p-req" name="requirements" rows="4" maxlength="3000" placeholder="ОС: Windows 10&#10;Процессор: Intel Core i3&#10;Память: 4 ГБ ОЗУ">${g.requirements}</textarea></div>
        </section>
      </div>

      <div class="pub-side">
        <section class="card pad">
          <h3 class="card-title">${icon('image', 18, 'accent')} Обложка</h3>
          <label class="dropzone cover-drop" id="dz-cover">
            <input type="file" id="f-cover" accept="image/png,image/jpeg,image/webp,image/gif" hidden>
            <div class="cover-preview" id="cover-preview">${g.cover ? html`<img src="${g.cover}" alt="">` : html`${icon('image', 28)}<span class="muted xs">16:9 · JPG, PNG, WEBP</span>`}</div>
          </label>
          <p class="muted xs gh-cover-hint" hidden>Без своей обложки возьмём картинку репозитория с GitHub.</p>
        </section>
        <section class="card pad">
          <h3 class="card-title">${icon('monitor', 18, 'accent')} Скриншоты <span class="muted" id="shot-count"></span></h3>
          <div class="thumbs" id="shots"></div>
          <label class="btn btn-soft btn-block">${icon('plus', 16)} Добавить скриншоты
            <input type="file" id="f-shots" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden></label>
        </section>
        <section class="card pad submit-card">
          <button class="btn btn-primary btn-lg btn-block" type="submit" id="pub-submit">${icon(editing ? 'check' : 'send', 18)} ${editing ? 'Сохранить изменения' : 'Отправить на модерацию'}</button>
          <div class="progress" id="progress" hidden><i></i><span></span></div>
          ${editing ? html`<a class="btn btn-ghost btn-block" href="#/game/${g.id}">Отмена</a>` : ''}
          <p class="muted xs">Публикуя, вы подтверждаете, что у вас есть права на распространение и файл не содержит вредоносного кода.</p>
        </section>
      </div>
    </form>`);

  const form = $('#pub', el);
  let gameFile = null;
  let coverFile = null;
  const newShots = [];
  const existingShots = [...(g.screenshots || [])];
  let ghPreview = null;
  let ghAsset = g.github?.asset ?? '';

  // ----- Источник файла -----
  const setSource = (s) => {
    source = s;
    $$('#src-seg button', el).forEach((b) => b.classList.toggle('on', b.dataset.src === s));
    $$('.src-pane', el).forEach((p) => (p.hidden = p.dataset.pane !== s));
    $('.launch-field', el).hidden = s === 'link';
    $('#p-version', el).disabled = s === 'github';
    $('#ver-hint', el).hidden = s !== 'github';
    $('.gh-cover-hint', el).hidden = s !== 'github';
  };
  $('#src-seg', el).addEventListener('click', (e) => {
    const b = e.target.closest('[data-src]');
    if (b) setSource(b.dataset.src);
  });
  setSource(source);

  // ----- GitHub -----
  const ghBox = $('#gh-preview', el);
  const prettify = (name) => name.replace(/[-_.]+/g, ' ').replace(/\s+/g, ' ').trim();
  async function findRepo({ prefill = true } = {}) {
    const repo = $('#gh-repo', el).value.trim();
    if (!repo) return toast('Вставьте ссылку на репозиторий GitHub', 'err');
    mount(ghBox, html`<div class="tunnel-row"><div class="spinner sm"></div><span>Смотрю релизы на GitHub…</span></div>`);
    try {
      ghPreview = await api(`/github/preview?repo=${encodeURIComponent(repo)}&prerelease=${$('#gh-pre', el).checked ? 1 : 0}`);
    } catch (e) {
      ghPreview = null;
      mount(ghBox, html`<div class="reject-note">${icon('ban', 14)} ${e.message}</div>`);
      return;
    }
    const p = ghPreview;
    mount(ghBox, html`<div class="gh-card">
      <div class="gh-head">
        <span class="gh-ic">${icon('code', 18)}</span>
        <div class="grow"><a class="link" href="${p.url}" target="_blank" rel="noopener">${p.repo}</a>
          <div class="muted xs">${icon('star', 11, 'fill star-c')} ${fmt.num(p.stars)}${p.license ? ` · ${p.license}` : ''} · релиз от ${fmt.date(p.release.published_at)}</div></div>
        <span class="chip chip-accent">${p.release.tag}${p.release.prerelease ? ' · pre' : ''}</span>
      </div>
      ${p.description ? html`<p class="muted sm">${p.description}</p>` : ''}
      <div class="field"><label for="gh-asset">Какой файл брать из релиза</label>
        <select class="input" id="gh-asset">
          <option value="">Автоматически для Windows — сейчас: ${p.auto}</option>
          ${p.assets.map((a) => html`<option value="${a.pattern}">${a.name} · ${fmt.bytes(a.size)} · ${fmt.num(a.downloads)} загрузок</option>`)}
          <option value=":source">Архив исходного кода (zip)</option>
        </select>
        <div class="field-hint">Запоминаем шаблон имени без номера версии — в следующих релизах нужный файл найдётся сам.</div></div>
    </div>`);
    const sel = $('#gh-asset', el);
    if ([...sel.options].some((o) => o.value === ghAsset)) sel.value = ghAsset;
    sel.addEventListener('change', () => (ghAsset = sel.value));
    if (prefill) {
      const fill = (id, value) => {
        const input = $(id, el);
        if (input && !input.value.trim() && value) input.value = value;
      };
      fill('#p-title', prettify(p.repo.split('/')[1]).slice(0, 80));
      fill('#p-short', p.description.slice(0, 300));
      fill('#p-desc', `${p.description}\n\nИсходный код и история версий: ${p.url}`.trim());
      fill('#p-tags', p.topics.slice(0, 8).join(', '));
      renderTags();
    }
    $('#p-version', el).value = p.release.tag;
  }
  $('#gh-find', el).addEventListener('click', () => findRepo());
  $('#gh-repo', el).addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      findRepo();
    }
  });
  $('#gh-pre', el).addEventListener('change', () => ghPreview && findRepo({ prefill: false }));
  if (source === 'github' && g.github?.repo) findRepo({ prefill: false });

  // ----- Теги -----
  const tagsInput = $('#p-tags', el);
  function renderTags() {
    const tags = [...new Set(tagsInput.value.split(',').map((t) => t.trim()).filter(Boolean))].slice(0, 10);
    mount($('#tag-preview', el), html`${tags.map((t) => html`<span class="tag">${t}</span>`)}`);
  }
  tagsInput.addEventListener('input', renderTags);
  renderTags();

  // ----- Файл игры -----
  const setGameFile = (f) => {
    if (!f) return;
    if (maxBytes && f.size > maxBytes) return toast(`Файл больше ${fmt.bytes(maxBytes)}`, 'err');
    gameFile = f;
    $('#file-info', el).textContent = `Выбран: ${f.name} · ${fmt.bytes(f.size)}`;
    $('#dz-file', el).classList.add('has-file');
  };
  $('#f-game', el).addEventListener('change', (e) => setGameFile(e.target.files[0]));

  // ----- Обложка -----
  const setCover = (f) => {
    if (!f || !f.type.startsWith('image/')) return;
    coverFile = f;
    mount($('#cover-preview', el), html`<img src="${URL.createObjectURL(f)}" alt="">`);
  };
  $('#f-cover', el).addEventListener('change', (e) => setCover(e.target.files[0]));

  for (const [zone, handler] of [['#dz-file', setGameFile], ['#dz-cover', setCover]]) {
    const z = $(zone, el);
    z.addEventListener('dragover', (e) => {
      e.preventDefault();
      z.classList.add('drag');
    });
    z.addEventListener('dragleave', () => z.classList.remove('drag'));
    z.addEventListener('drop', (e) => {
      e.preventDefault();
      z.classList.remove('drag');
      handler(e.dataTransfer.files[0]);
    });
  }

  // ----- Скриншоты -----
  const renderShots = () => {
    const total = existingShots.length + newShots.length;
    $('#shot-count', el).textContent = `${total}/${MAX_SHOTS}`;
    mount($('#shots', el), html`
      ${existingShots.map((s) => html`<div class="thumb"><img src="${s.url}" alt=""><button type="button" class="thumb-x" data-old="${s.id}" title="Удалить">${icon('x', 12)}</button></div>`)}
      ${newShots.map((f, i) => html`<div class="thumb new"><img src="${f.preview}" alt=""><button type="button" class="thumb-x" data-new="${i}" title="Убрать">${icon('x', 12)}</button></div>`)}`);
  };
  $('#f-shots', el).addEventListener('change', (e) => {
    for (const f of e.target.files) {
      if (existingShots.length + newShots.length >= MAX_SHOTS) {
        toast(`Не больше ${MAX_SHOTS} скриншотов`, 'err');
        break;
      }
      f.preview = URL.createObjectURL(f);
      newShots.push(f);
    }
    e.target.value = '';
    renderShots();
  });
  $('#shots', el).addEventListener('click', async (e) => {
    const old = e.target.closest('[data-old]');
    const neu = e.target.closest('[data-new]');
    if (neu) {
      newShots.splice(Number(neu.dataset.new), 1);
      renderShots();
    }
    if (old) {
      if (!(await confirmBox('Удалить скриншот?', { ok: 'Удалить', danger: true }))) return;
      try {
        await api(`/games/${g.id}/screenshots/${old.dataset.old}`, { method: 'DELETE' });
        existingShots.splice(existingShots.findIndex((s) => String(s.id) === old.dataset.old), 1);
        renderShots();
      } catch (err) {
        toastError(err);
      }
    }
  });
  renderShots();

  // ----- Отправка -----
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = $('#p-title', el).value.trim();
    if (title.length < 2) return toast('Укажите название', 'err');
    const hasOldFile = editing?.source === 'file' && !editing.external && editing.file_name;
    if (source === 'file' && !gameFile && !hasOldFile) return toast('Выберите файл игры', 'err');
    if (source === 'link' && !$('#p-url', el).value.trim()) return toast('Укажите ссылку на скачивание', 'err');
    if (source === 'github' && !$('#gh-repo', el).value.trim()) return toast('Укажите репозиторий GitHub', 'err');

    const btn = $('#pub-submit', el);
    const bar = $('#progress', el);
    const progress = (p, text) => {
      $('i', bar).style.width = `${Math.round(p * 100)}%`;
      $('span', bar).textContent = text;
    };
    btn.disabled = true;
    bar.hidden = false;
    try {
      const fd = new FormData();
      for (const field of form.elements) {
        if (field.name && field.type !== 'file' && !field.disabled) fd.append(field.name, field.value);
      }
      fd.set('source', source);
      if (source === 'github') {
        fd.append('github_repo', $('#gh-repo', el).value.trim());
        fd.append('github_asset', ghAsset);
        fd.append('github_prerelease', $('#gh-pre', el).checked ? '1' : '0');
      }
      if (source === 'file' && gameFile) {
        const id = await uploadLarge(gameFile, {
          onProgress: (p, sent) => progress(p, `Загрузка файла: ${Math.floor(p * 100)}% · ${fmt.bytes(sent)} из ${fmt.bytes(gameFile.size)}`),
        });
        fd.append('upload_id', id);
      }
      if (coverFile) fd.append('cover', coverFile);
      for (const f of newShots) fd.append('screenshots', f);
      progress(0, source === 'github' ? 'Получаю релиз с GitHub…' : 'Сохранение…');
      const res = await upload(editing ? `/games/${g.id}` : '/games', fd, {
        method: editing ? 'PUT' : 'POST',
        onProgress: (p) => progress(p, p < 1 ? `Сохранение… ${Math.round(p * 100)}%` : 'Обработка…'),
      });
      if (res.warning) toast(res.warning, 'err');
      toast(res.status === 'approved' ? 'Опубликовано!' : 'Отправлено на модерацию');
      navigate(`/game/${res.id}`);
    } catch (err) {
      toastError(err);
      btn.disabled = false;
      bar.hidden = true;
    }
  });
}
