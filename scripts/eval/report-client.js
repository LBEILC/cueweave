(() => {
  const rows = [...document.querySelectorAll('.group')];
  const search = document.querySelector('#search');
  const issues = document.querySelector('#issues');
  const differences = document.querySelector('#differences');
  const status = document.querySelector('#filter-status');
  const saveStatus = document.querySelector('#save-status');
  const storageKey = 'cueweave-review-' + document.body.dataset.reviewKey;
  let reviews = {};
  try {
    reviews = JSON.parse(localStorage.getItem(storageKey) || '{}');
  } catch {
    saveStatus.textContent = '浏览器本地存储不可用。备注仍可编辑，请导出 JSON 保存。';
  }
  if (!reviews || typeof reviews !== 'object' || Array.isArray(reviews)) reviews = {};
  const searchable = new Map(rows.map((row) => [row, row.textContent.toLocaleLowerCase()]));
  function filter() {
    const query = search.value.trim().toLocaleLowerCase();
    let count = 0;
    for (const row of rows) {
      row.hidden =
        !searchable.get(row).includes(query) ||
        (issues.checked && row.dataset.issue !== 'true') ||
        (differences?.checked && row.dataset.different !== 'true');
      if (!row.hidden) count++;
    }
    status.textContent = `显示 ${count} / ${rows.length} 个原文范围`;
    document.querySelector('#empty').hidden = count > 0;
  }
  search.addEventListener('input', filter);
  issues.addEventListener('change', filter);
  differences?.addEventListener('change', filter);
  function jump(ms) {
    const row = rows.find((item) => Number(item.dataset.end) >= ms);
    if (!row) {
      status.textContent = '该时间超过本次评测范围。';
      return;
    }
    search.value = '';
    issues.checked = false;
    if (differences) differences.checked = false;
    filter();
    row.scrollIntoView({ block: 'start' });
    history.replaceState(null, '', '#' + row.id);
  }
  document.querySelector('#jump-button').addEventListener('click', () => {
    const value = document.querySelector('#jump').value.trim();
    if (!/^\d+(?::[0-5]?\d){0,2}(?:\.\d+)?$/.test(value)) {
      status.textContent = '请输入秒数或 mm:ss，例如 21:56。';
      return;
    }
    jump(value.split(':').reduce((sum, part) => sum * 60 + Number(part), 0) * 1000);
  });
  for (const link of document.querySelectorAll('[data-jump]'))
    link.addEventListener('click', (event) => {
      event.preventDefault();
      jump(Number(link.dataset.jump));
    });
  for (const row of rows)
    for (const input of row.querySelectorAll('[data-field]')) {
      const saved = reviews[row.id]?.[input.dataset.field];
      input.value = typeof saved === 'string' ? saved : '';
      input.addEventListener('input', () => {
        reviews[row.id] = {
          ...reviews[row.id],
          [input.dataset.field]: input.value,
          startMs: Number(row.dataset.start),
          endMs: Number(row.dataset.end),
        };
        try {
          localStorage.setItem(storageKey, JSON.stringify(reviews));
          saveStatus.textContent = '备注已存入当前浏览器。可导出 JSON 留存。';
        } catch {
          saveStatus.textContent = '本地保存失败。请点击“导出评审”保存备注。';
        }
      });
    }
  document.querySelector('#export').addEventListener('click', () => {
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
  filter();
})();
