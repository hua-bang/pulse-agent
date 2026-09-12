(() => {
  const trace = JSON.parse(document.querySelector('#trace').textContent);
  const $ = id => document.getElementById(id);
  const picker = $('scenario');
  trace.scenarios.forEach((scenario, index) => {
    const option = document.createElement('option'); option.value = index; option.textContent = scenario.name;
    picker.appendChild(option);
  });
  let position = 0;
  let timer;
  const scenario = () => trace.scenarios[Number(picker.value)];
  function pause() { clearTimeout(timer); timer = undefined; $('play').textContent = '播放'; }
  function apply(index, incremental = false) {
    const frames = scenario().frames;
    const frame = frames[index];
    if (!incremental) $('card').innerHTML = frame.html;
    else {
      for (const entry of frame.renderedCards) {
        let message = [...$('card').querySelectorAll('[data-message]')].find(node => node.dataset.message === entry.messageId);
        if (!message) {
          const template = document.createElement('template'); template.innerHTML = frame.html;
          message = [...template.content.querySelectorAll('[data-message]')].find(node => node.dataset.message === entry.messageId);
          $('card').appendChild(message);
        } else if (entry.messageId === frame.messageId && !frame.text) {
          if (frame.operation === 'element.content') {
            const element = [...message.querySelectorAll('[data-element]')].find(node => node.dataset.element === frame.elementId);
            if (!element) throw new Error('Replay text target is missing');
            element.innerHTML = frame.texts[frame.elementId];
          } else if (frame.operation !== 'card.settings') message.querySelector('article').innerHTML = entry.html;
        }
      }
    }
    $('fallback').replaceChildren();
    for (const item of frames.slice(0, index + 1).filter(item => item.text)) {
      const text = document.createElement('p'); text.textContent = item.text; $('fallback').appendChild(text);
    }
    position = index; $('position').value = index;
    $('clock').textContent = `${(frame.at / 1000).toFixed(1)}s · ${index + 1}/${frames.length}`;
    $('operation').textContent = frame.operation + (frame.elementId ? ` → ${frame.elementId}` : '');
    const streaming = frame.card?.config?.streaming_mode === true;
    $('native').textContent = streaming ? 'streaming_mode = true' : 'streaming_mode = false';
    $('native').dataset.streaming = String(streaming);
    $('json').textContent = JSON.stringify(frame.cards, null, 2);
    $('next').disabled = index === frames.length - 1;
    $('end').disabled = index === frames.length - 1;
  }
  function reset() {
    pause(); $('position').max = scenario().frames.length - 1;
    $('note').textContent = scenario().note;
    apply(0);
  }
  function tick() {
    const frames = scenario().frames;
    if (position === frames.length - 1) return pause();
    const gap = Math.max(100, frames[position + 1].at - frames[position].at);
    timer = setTimeout(() => { apply(position + 1, true); tick(); }, gap);
  }
  picker.addEventListener('change', reset);
  $('reset').onclick = reset;
  $('play').onclick = () => {
    if (timer) return pause();
    if (position === scenario().frames.length - 1) apply(0);
    $('play').textContent = '暂停'; tick();
  };
  $('next').onclick = () => { pause(); apply(position + 1, true); };
  $('end').onclick = () => { pause(); apply(scenario().frames.length - 1); };
  $('position').oninput = event => { pause(); apply(Number(event.target.value)); };
  $('width').onclick = () => {
    const narrow = $('conversation').classList.toggle('narrow');
    $('width').textContent = narrow ? '切到桌面宽度' : '切到 375px';
  };
  $('card').onclick = event => {
    if (!event.target.closest('[data-stop]')) return;
    const index = trace.scenarios.findIndex(item => item.name === '停止任务');
    if (index < 0) return;
    picker.value = index; reset();
    const stopping = scenario().frames.findIndex(frame => JSON.stringify(frame.cards).includes('正在停止'));
    if (stopping >= 0) apply(stopping);
    $('note').textContent = '正在回放已录制的停止流程；没有真实任务被取消。';
  };
  $('verify').onclick = () => {
    pause();
    const original = picker.value;
    const originalPosition = position;
    const wasNarrow = $('conversation').classList.contains('narrow');
    let checkedFrames = 0;
    let preservedPanels = 0;
    const failures = [];
    for (const narrow of [false, true]) {
      $('conversation').classList.toggle('narrow', narrow);
      for (let item = 0; item < trace.scenarios.length; item++) {
        picker.value = item; reset();
        for (let index = 0; index < scenario().frames.length; index++) {
          const frame = scenario().frames[index];
          const panel = $('card').querySelector('details');
          if (panel) panel.open = false;
          apply(index, index > 0);
          if (index > 0 && (frame.operation === 'element.content' || frame.operation === 'card.settings' || frame.messageId === 'mock-reply') && panel) {
            if ($('card').querySelector('details') !== panel || panel.open) failures.push('折叠状态丢失');
            else preservedPanels++;
          }
          // Open content for layout checks, including long code at narrow width.
          $('card').querySelectorAll('details').forEach(node => { node.open = true; });
          if ($('card').scrollWidth > $('card').clientWidth + 1) failures.push(`${scenario().name}: 卡片横向溢出`);
          if ($('conversation').scrollWidth > $('conversation').clientWidth + 1) failures.push(`${scenario().name}: 会话横向溢出`);
          for (const node of $('card').querySelectorAll('[data-element]')) {
            const expected = document.createElement('div'); expected.innerHTML = frame.texts[node.dataset.element];
            if (node.textContent !== expected.textContent) failures.push(`${scenario().name}: 文本与请求不一致`);
          }
          checkedFrames++;
        }
      }
    }
    picker.value = original; reset(); apply(originalPosition);
    $('conversation').classList.toggle('narrow', wasNarrow);
    $('checks').hidden = false;
    $('checks').textContent = JSON.stringify({
      status: failures.length ? 'failed' : 'passed', scenarios: trace.scenarios.length,
      checkedFrames, preservedPanels, widths: [680, 375], failures,
      unverified: ['飞书真实渲染与动画', '服务端完整校验', '真实权限与网络'],
    }, null, 2);
  };
  reset();
})();
