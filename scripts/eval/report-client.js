(() => {
  const data = JSON.parse(document.querySelector('#report-data').textContent);
  const rows = data.rows;
  const byId = new Map(rows.map((row, index) => [row.id, index]));
  const results = document.querySelector('#results');
  const search = document.querySelector('#search');
  const issues = document.querySelector('#issues');
  const differences = document.querySelector('#differences');
  const status = document.querySelector('#filter-status');
  const saveStatus = document.querySelector('#save-status');
  const rowPagers = [...document.querySelectorAll('[data-pager="rows"]')];
  const logPager = document.querySelector('[data-pager="logs"]');
  const logs = document.querySelector('#log-results');
  const allLogs = document.querySelector('.all-logs');
  const storageKey = 'cueweave-review-' + document.body.dataset.reviewKey;
  let reviews = {};
  let page = 0;
  let logPage = 0;
  let filtered = rows;
  let searchTimer;
  let saveTimer;
  let dirty = false;
  try {
    reviews = JSON.parse(localStorage.getItem(storageKey) || '{}');
  } catch {
    saveStatus.textContent = '浏览器本地存储不可用。备注仍可编辑，请导出 JSON 保存。';
  }
  if (!reviews || typeof reviews !== 'object' || Array.isArray(reviews)) reviews = {};

  function persistReviews() {
    clearTimeout(saveTimer);
    if (!dirty) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(reviews));
      dirty = false;
      saveStatus.textContent = '备注已存入当前浏览器。可导出 JSON 留存。';
    } catch {
      saveStatus.textContent = '本地保存失败。请点击“导出评审”保存备注。';
    }
  }
  function updatePager(pager, current, total, size) {
    const count = Math.max(1, Math.ceil(total / size));
    pager.hidden = total <= size;
    pager.querySelector('[data-page-label]').textContent = `第 ${current + 1} / ${count} 页`;
    pager.querySelector('[data-page-step="-1"]').disabled = current === 0;
    pager.querySelector('[data-page-step="1"]').disabled = current >= count - 1;
  }
  function renderPage(scroll = false, keepInitial = false) {
    persistReviews();
    page = Math.max(0, Math.min(page, Math.max(0, Math.ceil(filtered.length / data.pageSize) - 1)));
    const start = page * data.pageSize;
    if (!keepInitial)
      results.innerHTML = filtered
        .slice(start, start + data.pageSize)
        .map((row) => row.html)
        .join('');
    for (const pager of rowPagers) updatePager(pager, page, filtered.length, data.pageSize);
    status.textContent = filtered.length
      ? `匹配 ${filtered.length} / ${rows.length} 个原文范围 · 当前 ${start + 1}—${Math.min(start + data.pageSize, filtered.length)}`
      : `匹配 0 / ${rows.length} 个原文范围`;
    document.querySelector('#empty').hidden = filtered.length > 0;
    if (scroll) {
      const first = results.querySelector('.group');
      first?.focus({ preventScroll: true });
      (first ?? status).scrollIntoView({ block: 'start' });
    }
  }
  function filter() {
    clearTimeout(searchTimer);
    searchTimer = undefined;
    const query = search.value.trim().toLocaleLowerCase();
    filtered = rows.filter(
      (row) =>
        row.search.includes(query) &&
        (!issues.checked || row.issue) &&
        (!differences?.checked || row.different),
    );
    page = 0;
    renderPage();
  }
  search.addEventListener('input', (event) => {
    clearTimeout(searchTimer);
    if (!event.isComposing) searchTimer = setTimeout(filter, 140);
  });
  search.addEventListener('compositionend', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(filter, 140);
  });
  issues.addEventListener('change', filter);
  differences?.addEventListener('change', filter);
  for (const pager of rowPagers)
    pager.addEventListener('click', (event) => {
      const button = event.target.closest('[data-page-step]');
      if (!button || button.disabled) return;
      if (searchTimer) filter();
      page += Number(button.dataset.pageStep);
      renderPage(true);
      const first = filtered[page * data.pageSize];
      if (first) history.replaceState(null, '', '#' + first.id);
    });

  function reveal(id, updateHash = true) {
    const index = byId.get(id);
    if (index === undefined) return false;
    clearTimeout(searchTimer);
    searchTimer = undefined;
    search.value = '';
    issues.checked = false;
    if (differences) differences.checked = false;
    filtered = rows;
    page = Math.floor(index / data.pageSize);
    renderPage();
    const row = document.getElementById(id);
    row.focus({ preventScroll: true });
    row.scrollIntoView({ block: 'start' });
    if (updateHash) history.replaceState(null, '', '#' + id);
    return true;
  }
  function jump(ms) {
    const row = rows.find((row) => row.endMs > ms);
    if (!row) {
      status.textContent = '该时间超过本次评测范围。';
      return;
    }
    reveal(row.id);
  }
  document.querySelector('#jump-button').addEventListener('click', () => {
    const value = document.querySelector('#jump').value.trim();
    if (!/^\d+(?::[0-5]?\d){0,2}(?:\.\d+)?$/.test(value)) {
      status.textContent = '请输入秒数或 mm:ss，例如 21:56。';
      return;
    }
    jump(value.split(':').reduce((sum, part) => sum * 60 + Number(part), 0) * 1000);
  });
  document.querySelector('#jump').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      document.querySelector('#jump-button').click();
    }
  });
  for (const link of document.querySelectorAll('[data-jump]'))
    link.addEventListener('click', (event) => {
      event.preventDefault();
      jump(Number(link.dataset.jump));
    });
  window.addEventListener('hashchange', () => {
    const id = location.hash.slice(1);
    if (!document.getElementById(id)) reveal(id, false);
  });

  // Form fields exist only for reviews that have actually been opened.
  results.addEventListener(
    'toggle',
    (event) => {
      const details = event.target;
      if (!details.matches('.review') || !details.open || details.querySelector('[data-field]'))
        return;
      const row = details.closest('.group');
      details.append(document.querySelector('#review-template').content.cloneNode(true));
      for (const input of details.querySelectorAll('[data-field]')) {
        const saved = reviews[row.id]?.[input.dataset.field];
        input.value = typeof saved === 'string' ? saved : '';
      }
    },
    true,
  );
  results.addEventListener('input', (event) => {
    const input = event.target;
    if (!input.matches('[data-field]')) return;
    const row = input.closest('.group');
    reviews[row.id] = {
      ...reviews[row.id],
      [input.dataset.field]: input.value,
      startMs: Number(row.dataset.start),
      endMs: Number(row.dataset.end),
    };
    dirty = true;
    saveStatus.textContent = '备注待保存…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persistReviews, 250);
  });
  results.addEventListener('focusout', persistReviews);
  window.addEventListener('pagehide', persistReviews);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') persistReviews();
  });

  function renderLogs() {
    logPage = Math.max(
      0,
      Math.min(logPage, Math.max(0, Math.ceil(data.logs.length / data.logPageSize) - 1)),
    );
    logs.innerHTML = data.logs
      .slice(logPage * data.logPageSize, (logPage + 1) * data.logPageSize)
      .join('');
    updatePager(logPager, logPage, data.logs.length, data.logPageSize);
  }
  allLogs.addEventListener('toggle', () => {
    if (allLogs.open) renderLogs();
    else logs.replaceChildren();
  });
  logPager.addEventListener('click', (event) => {
    const button = event.target.closest('[data-page-step]');
    if (!button || button.disabled) return;
    logPage += Number(button.dataset.pageStep);
    renderLogs();
    allLogs.scrollIntoView({ block: 'start' });
  });
  document.querySelector('#export').addEventListener('click', () => {
    persistReviews();
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            {
              schema: 1,
              reportId: document.body.dataset.reviewKey,
              exportedAt: new Date().toISOString(),
              reviews,
            },
            null,
            2,
          ),
        ],
        { type: 'application/json' },
      ),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'cueweave-review.json';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    saveStatus.textContent = '已请求下载评审 JSON，请检查浏览器下载记录。';
  });
  if (!reveal(location.hash.slice(1), false)) renderPage(false, true);
})();
