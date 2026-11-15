// 只问一次 · 少量交互（全部逻辑在此文件，满足 CSP script-src 'self'）
(function () {
  'use strict';

  var CSRF = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';
  var capture = document.getElementById('capture');
  var captureTitle = document.getElementById('capture-title');

  function isTyping(el) {
    if (!el) return false;
    var tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }

  function openCapture() {
    if (!capture) return;
    capture.hidden = false;
    if (captureTitle) {
      captureTitle.focus();
      captureTitle.select();
    }
  }

  function closeCapture() {
    if (!capture) return;
    capture.hidden = true;
  }

  document.addEventListener('click', function (event) {
    if (event.target.closest && event.target.closest('[data-open-capture]')) {
      event.preventDefault();
      openCapture();
      return;
    }
    if (event.target.closest && event.target.closest('[data-close-capture]')) {
      closeCapture();
    }
  });

  // ---------- 粘贴截图 ----------

  function clipboardImages(event) {
    var dt = event.clipboardData;
    if (!dt) return [];
    var out = [];
    var i;
    if (dt.items) {
      for (i = 0; i < dt.items.length; i += 1) {
        var item = dt.items[i];
        if (item.kind === 'file' && item.type && item.type.indexOf('image/') === 0) {
          var file = item.getAsFile();
          if (file) out.push(file);
        }
      }
    }
    if (!out.length && dt.files) {
      for (i = 0; i < dt.files.length; i += 1) {
        if (dt.files[i].type && dt.files[i].type.indexOf('image/') === 0) out.push(dt.files[i]);
      }
    }
    return out;
  }

  function tipOf(strip) {
    var tip = strip.querySelector('.paste-tip');
    if (tip) return tip;
    tip = document.createElement('span');
    tip.className = 'paste-tip';
    strip.appendChild(tip);
    return tip;
  }

  /** 找到（必要时创建）某个字段下方的缩略图条 */
  function stripFor(form, field) {
    if (field) {
      var found = form.querySelector('.paste-strip[data-field="' + field + '"]');
      if (found) return found;
    }

    var strip = document.createElement('div');
    strip.className = 'paste-strip';
    strip.setAttribute('data-strip', '');
    if (field) strip.setAttribute('data-field', field);

    var input = field ? form.querySelector('[name="' + field + '"]') : null;
    var anchor = input ? input.closest('.field') || input : null;

    if (anchor && anchor.parentNode) {
      anchor.parentNode.insertBefore(strip, anchor.nextSibling);
    } else {
      var actions = form.querySelector('.form-actions') || form.querySelector('.form-foot');
      if (actions && actions.parentNode) actions.parentNode.insertBefore(strip, actions);
      else form.appendChild(strip);
    }

    tipOf(strip).textContent = 'Ctrl+V 可粘贴截图';
    return strip;
  }

  function removeThumb(btn, id, base) {
    fetch(base + '/' + id, {
      method: 'DELETE',
      headers: { 'x-csrf-token': CSRF },
      credentials: 'same-origin',
    })
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        if (!data || !data.ok) throw new Error((data && data.error) || '删除失败');
        var thumb = btn.closest('.paste-thumb');
        var strip = thumb && thumb.parentNode;
        if (thumb) thumb.remove();
        if (strip && !strip.querySelector('.paste-thumb')) strip.remove();
      })
      .catch(function (err) {
        window.alert('删除失败：' + err.message);
      });
  }

  function makeThumb(path, id, base) {
    var wrap = document.createElement('span');
    wrap.className = 'paste-thumb';

    var img = document.createElement('img');
    img.src = path;
    img.alt = '截图';
    wrap.appendChild(img);

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip-x';
    btn.title = '删除这张截图';
    btn.textContent = '×';
    btn.addEventListener('click', function () {
      removeThumb(btn, id, base);
    });
    wrap.appendChild(btn);

    return wrap;
  }

  function uploadPaste(form, file, field) {
    var url = form.getAttribute('data-paste-upload');
    var base = form.getAttribute('data-artifact-base');
    if (!url || !base) return;

    var strip = stripFor(form, field);
    var tip = tipOf(strip);
    tip.textContent = '上传中…';

    var fd = new FormData();
    fd.append('shot', file, 'paste.png');
    if (field) fd.append('field', field);

    fetch(url, {
      method: 'POST',
      body: fd,
      headers: { 'x-csrf-token': CSRF },
      credentials: 'same-origin',
    })
      .then(function (res) {
        return res.json().catch(function () {
          throw new Error('服务端没有返回 JSON（可能文件太大）');
        });
      })
      .then(function (data) {
        if (!data || !data.ok) throw new Error((data && data.error) || '上传失败');
        strip.insertBefore(makeThumb(data.path, data.id, base), tip);
        tip.textContent = '已添加 · 保存后可见';
      })
      .catch(function (err) {
        tip.textContent = '粘贴失败：' + err.message + '（可以改用「补充截图」）';
      });
  }

  /** 还没保存的卡片（秒记浮层 / 新建页）：把图塞进 file input，随表单一起提交 */
  function applyFile(form, files) {
    var input = form.querySelector('input[type="file"][name="shot"]');
    if (!input) return;
    try {
      var dt = new DataTransfer();
      for (var i = 0; i < files.length; i += 1) dt.items.add(files[i]);
      input.files = dt.files;
    } catch (err) {
      return;
    }
    var preview = form.querySelector('[data-file-preview]');
    if (!preview) return;
    preview.innerHTML = '';
    var img = document.createElement('img');
    img.src = URL.createObjectURL(files[0]);
    img.alt = '截图预览';
    preview.appendChild(img);
  }

  document.addEventListener('paste', function (event) {
    var files = clipboardImages(event);
    if (!files.length) return;

    var target = event.target;
    var form = target && target.closest ? target.closest('form') : null;
    if (!form && capture && !capture.hidden) form = capture.querySelector('form');

    // 焦点不在表单里（比如刚点完页面空白处就按 Ctrl+V）：退回页面上的上传表单
    if (!form || (!form.hasAttribute('data-paste-upload') && !form.hasAttribute('data-paste-file'))) {
      form = document.querySelector('form[data-paste-upload]') || form;
    }
    if (!form) return;

    if (form.hasAttribute('data-paste-file')) {
      event.preventDefault();
      applyFile(form, files);
      return;
    }

    if (form.hasAttribute('data-paste-upload')) {
      event.preventDefault();
      // 焦点在哪个框，图就挂在哪个框下面；找不到就挂到表单末尾
      var field = target && target.name && target.closest('form') === form ? target.name : null;
      var details = form.closest('details');
      if (details && !details.open) details.open = true;
      uploadPaste(form, files[0], field);
    }
  });

  // 已经保存过的截图：点 × 直接删
  document.addEventListener('click', function (event) {
    var btn = event.target.closest && event.target.closest('[data-delete-artifact]');
    if (!btn) return;
    if (!window.confirm('删除这张截图？卡片和文字不会受影响。')) return;
    removeThumb(btn, btn.getAttribute('data-id'), btn.getAttribute('data-base'));
  });

  // ---------- 键盘 ----------

  function submitForm(form) {
    if (!form) return;
    if (typeof form.requestSubmit === 'function') form.requestSubmit();
    else form.submit();
  }

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      closeCapture();
      return;
    }

    if ((event.key === 'n' || event.key === 'N') && !event.metaKey && !event.ctrlKey && !event.altKey) {
      if (!isTyping(document.activeElement)) {
        event.preventDefault();
        openCapture();
      }
      return;
    }

    // Ctrl/⌘ + S：保存当前表单（浏览器默认的"另存网页"太容易误触）
    if ((event.key === 's' || event.key === 'S') && (event.metaKey || event.ctrlKey) && !event.altKey) {
      var saveForm = document.activeElement && document.activeElement.closest
        ? document.activeElement.closest('form')
        : null;
      if (saveForm) {
        event.preventDefault();
        submitForm(saveForm);
        return;
      }
    }

    // Ctrl/⌘ + Enter：提交当前所在的表单
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      var active = document.activeElement;
      var form = active && active.closest ? active.closest('form') : null;
      if (!form && capture && !capture.hidden) form = capture.querySelector('form');
      if (form) {
        event.preventDefault();
        submitForm(form);
      }
      return;
    }

    // 复盘页：1 记得住 / 2 有点模糊 / 3 完全忘了
    var reviewForm = document.getElementById('review-form');
    if (reviewForm && !reviewForm.hidden && !isTyping(document.activeElement)) {
      var result = { 1: 'good', 2: 'fuzzy', 3: 'bad' }[event.key];
      if (result) {
        var btn = reviewForm.querySelector('button[value="' + result + '"]');
        if (btn) {
          event.preventDefault();
          btn.click();
        }
      }
    }
  });

  // ---------- 复盘：先看答案，再自评 ----------

  var reveal = document.querySelector('[data-reveal]');
  if (reveal) {
    reveal.addEventListener('click', function () {
      var answer = document.getElementById('review-answer');
      var form = document.getElementById('review-form');
      if (answer) answer.hidden = false;
      if (form) form.hidden = false;
      reveal.hidden = true;
      var first = form && form.querySelector('button');
      if (first) first.focus();
    });
  }

  // ---------- 复制 ----------

  document.addEventListener('click', function (event) {
    var btn = event.target.closest && event.target.closest('[data-copy]');
    if (!btn) return;
    var target = document.getElementById(btn.getAttribute('data-copy'));
    if (!target) return;
    var text = target.textContent;
    var done = function () {
      var old = btn.textContent;
      btn.textContent = '已复制';
      setTimeout(function () {
        btn.textContent = old;
      }, 1200);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () {});
    } else {
      var range = document.createRange();
      range.selectNodeContents(target);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      try {
        document.execCommand('copy');
        done();
      } catch (err) {
        /* ignore */
      }
      sel.removeAllRanges();
    }
  });

  // ---------- 危险操作确认 ----------

  document.addEventListener('submit', function (event) {
    var form = event.target.closest ? event.target.closest('form[data-confirm]') : null;
    if (!form) return;
    if (!window.confirm(form.getAttribute('data-confirm'))) event.preventDefault();
  });

  // ---------- 提交中：按钮变「保存中…」，防连点 ----------

  document.addEventListener('submit', function (event) {
    if (event.defaultPrevented) return;
    var form = event.target;
    if (!form.hasAttribute('data-busy')) return;
    var btn = form.querySelector('button[type="submit"]');
    if (!btn) return;
    if (btn.dataset.busy === '1') {
      event.preventDefault();
      return;
    }
    btn.dataset.busy = '1';
    btn.dataset.label = btn.textContent;
    btn.textContent = '保存中…';
    btn.disabled = true;
    setTimeout(function () {
      btn.disabled = false;
      btn.textContent = btn.dataset.label || '保存';
      btn.dataset.busy = '';
    }, 8000);
  });

  // ---------- 提示自动淡出 ----------

  var flash = document.querySelector('.flash');
  if (flash) {
    setTimeout(function () {
      flash.style.transition = 'opacity .6s ease';
      flash.style.opacity = '0';
      setTimeout(function () {
        if (flash.parentNode) flash.parentNode.removeChild(flash);
      }, 650);
    }, 4200);
  }
})();
