/**
 * 交互元素遍历测试脚本
 * 遍历 portfolio 网站里所有可点击 / 可滑动 / 可交互的元素，
 * 逐个触发并检查是否报错、是否有可见反馈，最后输出测试报告。
 *
 * 用法: node interaction_test.js [file-url-or-path]
 */
const { chromium } = require('playwright');
const path = require('path');

const TARGET = process.argv[2] ||
  'file://' + path.resolve(process.env.HOME, 'Documents/codebuddy/portfolio/index.html');

// ── 测试结果收集 ──
const results = {
  pageErrors: [],
  consoleErrors: [],
  clickable: [],
  scrollable: [],
  interactive: [],
  summary: {},
};

function tag(el) {
  // 在浏览器上下文里生成元素描述（此函数序列化后注入）
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  page.on('pageerror', e => results.pageErrors.push(e.message));
  page.on('console', m => {
    if (m.type() === 'error') results.consoleErrors.push(m.text());
  });

  console.log('打开页面:', TARGET);
  await page.goto(TARGET, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(1500);

  // ── 0. 先触发 hero 翻页，进入正文 ──
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(1600);

  // ── 1. 盘点所有交互元素 ──
  const inventory = await page.evaluate(() => {
    function describe(el) {
      const id = el.id ? '#' + el.id : '';
      const cls = (el.className && typeof el.className === 'string')
        ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
      const txt = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24);
      return `${el.tagName.toLowerCase()}${id}${cls}${txt ? ' "' + txt + '"' : ''}`;
    }
    function visible(el) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.display !== 'none' &&
             cs.visibility !== 'hidden' && cs.opacity !== '0';
    }

    // 可点击：a / button / [onclick] / [role=button] / cursor:pointer / gallery-item
    const clickSel = 'a, button, [onclick], [role="button"], .gallery-item, .nav-hamburger, .nav-drawer-link, .gv-close, .gv-nav, .copy-trigger, [data-copy]';
    const clickEls = Array.from(document.querySelectorAll(clickSel));

    // 额外: 计算样式带 cursor:pointer 的元素
    const allEls = Array.from(document.querySelectorAll('body *'));
    const pointerEls = allEls.filter(el => {
      const cs = getComputedStyle(el);
      return cs.cursor === 'pointer' && !clickEls.includes(el);
    });

    // 可滑动: overflow auto/scroll, 或自定义滚轮/触摸监听容器
    const scrollEls = allEls.filter(el => {
      const cs = getComputedStyle(el);
      const oy = cs.overflowY, ox = cs.overflowX;
      const scrollableStyle = ['auto', 'scroll'].includes(oy) || ['auto', 'scroll'].includes(ox);
      const canScroll = el.scrollHeight > el.clientHeight + 4 || el.scrollWidth > el.clientWidth + 4;
      return scrollableStyle && canScroll;
    });

    // 表单/输入类交互
    const formEls = Array.from(document.querySelectorAll('input, textarea, select, [contenteditable="true"]'));

    return {
      clickable: clickEls.filter(visible).map(describe),
      pointer: pointerEls.filter(visible).map(describe),
      scrollable: scrollEls.map(describe),
      form: formEls.filter(visible).map(describe),
      counts: {
        clickable: clickEls.filter(visible).length,
        pointer: pointerEls.filter(visible).length,
        scrollable: scrollEls.length,
        form: formEls.filter(visible).length,
      }
    };
  });

  console.log('\n── 交互元素盘点 ──');
  console.log('可点击元素:', inventory.counts.clickable);
  console.log('cursor:pointer 元素:', inventory.counts.pointer);
  console.log('可滚动容器:', inventory.counts.scrollable);
  console.log('表单/输入元素:', inventory.counts.form);

  results.summary.inventory = inventory.counts;
  results.summary.clickableList = inventory.clickable;
  results.summary.pointerList = inventory.pointer;
  results.summary.scrollableList = inventory.scrollable;

  // ── 2. 逐个测试 nav 锚点链接跳转 ──
  console.log('\n── 测试 nav 锚点跳转 ──');
  const navLinks = await page.$$eval('.nav-links a', els => els.map(a => a.getAttribute('href')));
  for (const href of navLinks) {
    if (!href || !href.startsWith('#')) continue;
    try {
      await page.click(`.nav-links a[href="${href}"]`, { timeout: 3000 });
      await page.waitForTimeout(900);
      const scrolledTo = await page.evaluate((h) => {
        const t = document.getElementById(h.slice(1));
        if (!t) return 'target-missing';
        const r = t.getBoundingClientRect();
        return Math.abs(r.top) < window.innerHeight ? 'ok' : 'off-screen(' + Math.round(r.top) + ')';
      }, href);
      results.clickable.push({ type: 'nav-anchor', target: href, result: scrolledTo });
      console.log(`  ${href} -> ${scrolledTo}`);
    } catch (e) {
      results.clickable.push({ type: 'nav-anchor', target: href, result: 'ERROR: ' + e.message });
      console.log(`  ${href} -> ERROR`);
    }
  }

  // ── 3. 测试 gallery viewer 打开/切换/关闭 ──
  console.log('\n── 测试 gallery 沉浸式查看器 ──');
  const galleryItems = await page.$$('#gallery .gallery-item');
  console.log('gallery 卡片数:', galleryItems.length);
  const itemCount = galleryItems.length;
  for (let i = 0; i < itemCount; i++) {
    try {
      // 确保上一轮 overlay 完全关闭
      await page.evaluate(() => {
        const ov = document.getElementById('gv-overlay');
        if (ov) { ov.classList.remove('active'); ov.setAttribute('aria-hidden', 'true'); }
        document.body.style.overflow = '';
        document.getElementById('gallery').scrollIntoView();
      });
      await page.waitForTimeout(300);
      // 用 JS 直接触发第 i 张卡片的 click，绕开 overlay 拦截
      await page.evaluate((idx) => {
        const items = document.querySelectorAll('#gallery .gallery-item');
        if (items[idx]) items[idx].click();
      }, i);
      await page.waitForTimeout(900);
      const opened = await page.evaluate(() => {
        const ov = document.getElementById('gv-overlay');
        const slides = document.querySelectorAll('#gv-stage .gv-slide');
        const activeImg = document.querySelector('#gv-stage .gv-slide.active img') ||
                          document.querySelector('#gv-stage .gv-slide img');
        return {
          active: ov && ov.classList.contains('active'),
          slides: slides.length,
          imgLoaded: activeImg ? (activeImg.complete && activeImg.naturalWidth > 0) : false,
          counter: (document.getElementById('gv-counter') || {}).textContent || '',
        };
      });
      // 切换下一张
      let switched = 'n/a';
      if (opened.slides > 1) {
        const before = opened.counter;
        await page.mouse.wheel(0, 200);
        await page.waitForTimeout(700);
        const after = await page.evaluate(() =>
          (document.getElementById('gv-counter') || {}).textContent || '');
        switched = before + ' -> ' + after;
      }
      // 关闭：用 JS 直接触发关闭按钮，避免 overlay 拦截
      await page.evaluate(() => {
        const btn = document.getElementById('gv-close');
        if (btn) btn.click();
      });
      // 等 overlay 彻底失活 + pointer-events 恢复 none
      await page.waitForFunction(() => {
        const ov = document.getElementById('gv-overlay');
        return ov && !ov.classList.contains('active') &&
               getComputedStyle(ov).pointerEvents === 'none';
      }, { timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(300);
      const closed = await page.evaluate(() =>
        !document.getElementById('gv-overlay').classList.contains('active'));

      const rec = {
        type: 'gallery-item', index: i,
        opened: opened.active, slides: opened.slides,
        imgLoaded: opened.imgLoaded, switch: switched, closed,
      };
      results.interactive.push(rec);
      console.log(`  卡片#${i}: 打开=${opened.active} 张数=${opened.slides} 图片加载=${opened.imgLoaded} 切换=${switched} 关闭=${closed}`);
    } catch (e) {
      results.interactive.push({ type: 'gallery-item', index: i, result: 'ERROR: ' + e.message });
      console.log(`  卡片#${i}: ERROR ${e.message}`);
    }
  }

  // ── 4. 测试移动端汉堡菜单 (缩小视口) ──
  console.log('\n── 测试移动端汉堡菜单 ──');
  // 确保 viewer 完全关闭并移除残留拦截层
  await page.evaluate(() => {
    const ov = document.getElementById('gv-overlay');
    if (ov) {
      ov.classList.remove('active');
      ov.setAttribute('aria-hidden', 'true');
      ov.style.pointerEvents = 'none';
    }
    document.body.style.overflow = '';
  });
  await page.waitForTimeout(300);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  try {
    const hamburgerVisible = await page.isVisible('#nav-hamburger');
    if (hamburgerVisible) {
      // 用 JS 直接触发点击，绕开可能的覆盖层拦截
      await page.evaluate(() => document.getElementById('nav-hamburger').click());
      await page.waitForTimeout(500);
      const drawerOpen = await page.evaluate(() =>
        document.getElementById('nav-drawer').classList.contains('open'));
      await page.evaluate(() => {
        const s = document.getElementById('nav-scrim');
        if (s) s.click();
      });
      await page.waitForTimeout(400);
      const drawerClosed = await page.evaluate(() =>
        !document.getElementById('nav-drawer').classList.contains('open'));
      results.interactive.push({ type: 'hamburger', open: drawerOpen, closeByScrim: drawerClosed });
      console.log(`  汉堡菜单: 打开=${drawerOpen} 遮罩关闭=${drawerClosed}`);
    } else {
      console.log('  汉堡菜单在移动端不可见 (异常)');
      results.interactive.push({ type: 'hamburger', result: 'not-visible' });
    }
  } catch (e) {
    console.log('  汉堡菜单 ERROR:', e.message);
    results.interactive.push({ type: 'hamburger', result: 'ERROR: ' + e.message });
  }

  // ── 5. 汇总 ──
  results.summary.errors = {
    pageErrors: results.pageErrors.length,
    consoleErrors: results.consoleErrors.length,
  };

  console.log('\n══════════ 测试报告汇总 ══════════');
  console.log('页面 JS 错误:', results.pageErrors.length);
  results.pageErrors.slice(0, 10).forEach(e => console.log('  ✗', e));
  console.log('Console 错误:', results.consoleErrors.length);
  results.consoleErrors.slice(0, 10).forEach(e => console.log('  ✗', e));

  const fs = require('fs');
  const reportPath = path.resolve(process.env.HOME,
    'Documents/codebuddy/portfolio/interaction_test_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
  console.log('\n详细报告已写入:', reportPath);

  await browser.close();
})();
