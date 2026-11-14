// 只问一次 · 少量交互（全部逻辑在此文件，满足 CSP script-src 'self'）
(function () {
  'use strict';

  var capture = document.getElementById('capture');
  var captureTitle = document.getElementById('capture-title');
  var shotInput = document.getElementById('capture-shot');
  var preview = document.getElementById('shot-preview');

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

  // 全站按 n 唤起秒记（正在输入时不打扰）
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
    // Ctrl/⌘ + Enter 提交秒记
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && capture && !capture.hidden) {
      var form = capture.querySelector('form');
      if (form) form.requestSubmit();
    }
  });

  // 在浮层里 Ctrl+V 贴截图 → 塞进 file input 并预览
  document.addEventListener('paste', function (event) {
    if (!capture || capture.hidden || !shotInput) return;
    var items = (event.clipboardData && event.clipboardData.items) || [];
    for (var i = 0; i < items.length; i += 1) {
      if (items[i].type && items[i].type.indexOf('image/') === 0) {
        var file = items[i].getAsFile();
        if (!file) continue;
        try {
          var dt = new DataTransfer();
          dt.items.add(file);
          shotInput.files = dt.files;
        } catch (err) {
          /* 老浏览器不支持 DataTransfer，忽略 */
        }
        if (preview) {
          preview.innerHTML = '';
          var img = document.createElement('img');
          img.src = URL.createObjectURL(file);
          img.alt = '截图预览';
          preview.appendChild(img);
        }
        event.preventDefault();
        return;
      }
    }
  });

  // 复盘：先看答案，再自评
  var reveal = document.querySelector('[data-reveal]');
  if (reveal) {
    reveal.addEventListener('click', function () {
      var answer = document.getElementById('review-answer');
      var form = document.getElementById('review-form');
      if (answer) answer.hidden = false;
      if (form) form.hidden = false;
      reveal.hidden = true;
    });
  }

  // 复制
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

  // 危险操作确认
  document.addEventListener('submit', function (event) {
    var form = event.target.closest ? event.target.closest('form[data-confirm]') : null;
    if (!form) return;
    if (!window.confirm(form.getAttribute('data-confirm'))) event.preventDefault();
  });

  // 提示自动淡出
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
