/*!
    * 闪击战ID大百科
 */
(function () {
    'use strict';

    /* ===================== 配置 ===================== */
    var STEP_LENGTH = 20;                              // 每页条数
    var FILE_EXT = { 1: 'png', 2: 'jpg', 3: 'jpg' };   // Logo/Imgs 里存的是扩展名编号
    var SITE_TITLE = '闪击战ID大百科';
    var SITE_DESC = '本网页旨在帮助国服玩家刊载军团简介。有意见或建议请加Q群：715200589';
    var DATA_URL = 'js/clan.json';
    var RECORD_URL = 'https://clanarc.com/clanLookup/recordLookup';
    var RECOMMEND_COUNT = 5;

    /* ===================== 状态 ===================== */
    var clanData = [];        // 全量军团数据
    var recommendPool = [];   // 推荐候选池
    var beginIndex = 0;       // 当前页第一条
    var endingIndex = STEP_LENGTH - 1;
    var dataIndex = 0;
    var rLogo = [];           // 占位徽章编号池
    var scrollFlag = false;   // 触摸手势：防止滚动时误关闭浮层
    var backBtn = null;
    var currentCid = null;    // 当前详情展示的军团 ID

    /* ===================== DOM 缓存 ===================== */
    var el = {
        searchInput: document.getElementById('searchstr'),
        searchBtn: document.getElementById('search_btn'),
        resetBtn: document.querySelector('.btn.resetBtn'),
        announcement: document.getElementById('announcement_zone'),
        titleBanner: document.getElementById('title-banner'),
        titleText: document.querySelector('#title-banner .title'),
        table: document.querySelector('table.clan_lib'),
        tbody: document.querySelector('table.clan_lib tbody'),
        recommend: document.getElementById('recommend'),
        detail: document.getElementById('detail'),
        detailInner: document.querySelector('#detail .inner'),
        detailWindow: document.querySelector('#detail .window'),
        detailContent: document.querySelector('#detail .content')
    };

    /* ===================== 基础工具 ===================== */
    function $(sel, root) { return (root || document).querySelector(sel); }
    function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
    function on(target, type, handler, opts) { if (target) target.addEventListener(type, handler, opts); }
    function has(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }
    function showInline(node) { if (node) node.style.display = 'inline-block'; }
    function showBlock(node) { if (node) node.style.display = 'block'; }
    function hideEl(node) { if (node) node.style.display = 'none'; }

    /* HTML 转义：修复原版直接拼接用户可控文本导致的 XSS 面 */
    function escapeHTML(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
        });
    }

    /* 正则元字符转义（字符顺序特意调整过，等价于 [.*+?^$(){}|[\]\\]） */
    function escapeRegExp(value) {
        return String(value == null ? '' : value).replace(/[.*+?^{}()|[\]\\$]/g, '\\$&');
    }

    /* 等价于 jQuery 的 outerHeight()（含 padding + border，不含 margin） */
    function outerHeight(node) {
        return node ? node.getBoundingClientRect().height : 0;
    }

    function absoluteURL(path) {
        try { return new URL(path, window.location.href).href; } catch (e) { return path; }
    }

    /* ===================== 动画（Web Animations API 替代 jQuery 动画） ===================== */
    function animate(node, frames, options) {
        if (!node || typeof node.animate !== 'function') return null;
        return node.animate(frames, options);
    }

    /* 下拉展开（替代 slideDown） */
    function slideOpen(node, duration) {
        if (!node) return;
        node.style.display = 'block';
        var height = node.offsetHeight;
        if (!height) return;
        animate(node, [{ height: '0px' }, { height: height + 'px' }], { duration: duration, easing: 'ease' });
    }

    /* 上滑收起（替代 slideUp） */
    function slideClose(node, duration) {
        if (!node) return;
        var height = node.offsetHeight;
        if (!height || node.style.display === 'none') return;
        var anim = animate(node, [{ height: height + 'px' }, { height: '0px' }], { duration: duration, easing: 'ease', fill: 'forwards' });
        if (!anim) { node.style.display = 'none'; return; }
        anim.onfinish = function () { anim.cancel(); node.style.display = 'none'; };
    }

    /* 淡入（替代 fadeIn） */
    function fadeIn(node, duration) {
        if (!node) return;
        node.style.display = 'block';
        animate(node, [{ opacity: 0 }, { opacity: 1 }], { duration: duration, easing: 'ease' });
    }

    /* 淡出（替代 fadeOut） */
    function fadeOut(node, duration, done) {
        if (!node) { if (done) done(); return; }
        node.style.display = 'block';
        var anim = animate(node, [{ opacity: 1 }, { opacity: 0 }], { duration: duration, easing: 'ease', fill: 'forwards' });
        if (!anim) { node.style.display = 'none'; if (done) done(); return; }
        anim.onfinish = function () { anim.cancel(); node.style.display = 'none'; if (done) done(); };
    }

    /* 浮层展开（替代 animate({height:'100%'})） */
    function expandDetailInner() {
        if (!el.detailInner) return;
        var target = el.detailInner.parentNode.clientHeight;
        el.detailInner.style.height = target + 'px';
        animate(el.detailInner, [{ height: '0px' }, { height: target + 'px' }], { duration: 450, easing: 'ease-out' });
    }

    /* 浮层收起 */
    function collapseDetailInner(done) {
        if (!el.detailInner) { if (done) done(); return; }
        var height = el.detailInner.offsetHeight;
        var anim = animate(el.detailInner, [{ height: height + 'px' }, { height: '0px' }], { duration: 500, easing: 'ease', fill: 'forwards' });
        if (!anim) { el.detailInner.style.height = '0px'; if (done) done(); return; }
        anim.onfinish = function () { anim.cancel(); el.detailInner.style.height = '0px'; if (done) done(); };
    }

    /* ===================== URL 参数 ===================== */
    function getQueryStr(name) {
        var value = new URLSearchParams(window.location.search).get(name);
        if (!value) return undefined;
        return value;
    }

    /* ===================== 数据 ===================== */
    function loadData() {
        return fetch(DATA_URL, { credentials: 'same-origin' })
            .then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            })
            .then(function (data) {
                clanData = Array.isArray(data) ? data : [];
                return clanData;
            })
            .catch(function (err) {
                clanData = [];
                if (el.tbody) el.tbody.innerHTML = '<tr><td>数据加载失败，请刷新重试</td></tr>';
                if (el.recommend) el.recommend.innerHTML = '<p>数据加载失败，请刷新重试</p>';
                console.error('[main.js] 军团数据加载失败：', err);
                return clanData;
            });
    }

    /* ===================== 检索 ===================== */
    /**
     * @param {*} keyword 关键词
     * @param {Array} list 数据源
     * @param {'id'|'mid'|'analysis'|undefined} mode
     */
    function toCompare(keyword, list, mode) {
        if (!Array.isArray(list)) return [];
        var kw = keyword == null ? '' : String(keyword);
        var result = [];
        var i, item;

        if (mode === 'id' || mode === 'mid') {
            var field = (mode === 'id') ? 'ID' : 'MID';
            var strict = new RegExp('^' + escapeRegExp(kw) + '$');
            for (i = 0; i < list.length; i++) {
                item = list[i];
                if (has(item, field) && strict.test(String(item[field]))) result.push(item);
            }
            return result;
        }

        if (mode === 'analysis') {   // 筛选“适合上推荐位”的军团
            for (i = 0; i < list.length; i++) {
                item = list[i];
                var desc = String(item.Desc == null ? '' : item.Desc);
                if (desc.indexOf('/repeat') !== -1) {
                    var rep = resolveRepeat(item.MID, desc);
                    if (rep) desc = rep.Desc;
                }
                if (desc.length > 10 && !/^编者/.test(desc) && desc.indexOf('幽灵团') === -1 && /\d/.test(desc)) {
                    result.push(item);
                }
            }
            return result;
        }

        /* 默认：标签/全名 包含关键词，或 ID 包含关键词（不区分大小写） */
        if (!kw) return [];
        var loose = new RegExp(escapeRegExp(kw), 'i');
        for (i = 0; i < list.length; i++) {
            item = list[i];
            if (loose.test(String(item.Tag)) || loose.test(String(item.Full)) || loose.test(String(item.ID))) {
                result.push(item);
            }
        }
        return result;
    }

    /**
     * 解析简介中的自定义指令 /repeat 或 /repeat(军团ID)
     * @returns {{Desc: string}|null}
     */
    function resolveRepeat(mid, desc) {
        var source = String(desc == null ? '' : desc);
        var re = /\/repeat(?:\(([^)]*)\))?/;
        var matched = source.match(re);
        if (!matched) return null;
        var targetId = (matched[1] && matched[1].trim()) ? matched[1].trim() : mid;
        if (targetId == null || targetId === '') return null;
        var hit = toCompare(targetId, clanData, 'id')[0];
        if (!hit || !has(hit, 'Desc')) return null;   // FIX: 原版此处未判空，/repeat 指向不存在 ID 会整页崩
        return { Desc: source.replace(re, String(hit.Desc)) };
    }

    /* 军团建立日期：Data 里存的是“距 1900-01-01 的天数” */
    function processDate(serial) {
        var date = new Date(1900, 0, 1);
        date.setDate(Number(serial) - 1);
        return [date.getFullYear(), date.getMonth() + 1, date.getDate()].join('-');
    }

    /* ===================== 渲染 ===================== */
    function changeTitle(action, count) {
        if (!el.titleText) return;
        el.titleText.innerHTML = (typeof count === 'number')
            ? ('共' + action + count + '个军团')
            : action;
    }

    function insertData(list, index, method) {
        if (!list || !list.length) {
            if (method === 'table' && el.tbody) {
                el.tbody.insertAdjacentHTML('beforeend', '<tr><td>未搜索到相关内容，相关军团可能尚未收录</td></tr>');
            }
            return;
        }
        var i = index || 0;
        var clan = list[i];
        if (!clan) return;

        var ID = clan.ID;
        var tag = '[' + clan.Tag + ']';
        var full = clan.Full;
        var desc = has(clan, 'Desc') ? String(clan.Desc) : '无';
        var rep = resolveRepeat(clan.MID, desc);
        if (rep) desc = rep.Desc;

        switch (method) {
            /* ---------- 列表行 ---------- */
            case 'table': {
                var shortDesc = desc.length > 20 ? desc.substr(0, 19) + '…' : desc;
                el.tbody.insertAdjacentHTML('beforeend',
                    '<tr data-clan-id="' + escapeHTML(ID) + '">' +
                    '<td>' + escapeHTML(ID) + '</td>' +
                    '<td class="orange">' + escapeHTML(tag + ' ' + full) + '</td>' +
                    '<td>' + escapeHTML(shortDesc) + '</td>' +
                    '</tr>');
                break;
            }

            /* ---------- 详情浮层 ---------- */
            case 'detail': {
                var logoURL;
                if (clan.Logo && FILE_EXT[clan.Logo]) {
                    logoURL = 'img/clan/' + ID + '/0.' + FILE_EXT[clan.Logo];
                } else {
                    logoURL = 'img/icons/clanEmblems2x/clan-icon-v2-' + rLogo[Math.floor(Math.random() * rLogo.length)] + '.png';
                }
                setMetaImage(logoURL);

                var estbl = clan.Date ? processDate(clan.Date) : '--';

                var imgsHTML = '';
                if (Array.isArray(clan.Imgs) && clan.Imgs.length) {
                    imgsHTML = '<div class="clan-img"><div class="container">';
                    for (var n = 0; n < clan.Imgs.length; n++) {
                        if (!FILE_EXT[clan.Imgs[n]]) continue;
                        imgsHTML += '<li><img src="./img/clan/' + ID + '/' + (n + 1) + '.' + FILE_EXT[clan.Imgs[n]] + '"></li>';
                    }
                    imgsHTML += '</div></div>';
                }

                var briefHTML = '<div class="clanInfo">' +
                    '<div class="logo"><img src="' + logoURL + '" alt="' + escapeHTML(tag + full) + 'Logo"></div>' +
                    '<div class="info">' +
                    '<p class="orange">' + escapeHTML(tag + ' ' + full) + '</p>' +
                    '<p>ID：' + escapeHTML(ID) + '</p>' +
                    '<p>创建日期：' + escapeHTML(estbl) + '</p>' +
                    '</div></div>';

                var introHTML = '<div class="introduction"><h3>简介</h3><p>' +
                    escapeHTML(desc).replace(/\n/g, '</p><p>') +
                    '</p></div>';

                el.detailContent.insertAdjacentHTML('beforeend', briefHTML + imgsHTML + introHTML);

                if (clan.MID != null) renderFamily(Math.abs(Number(clan.MID)));
                break;
            }

            /* ---------- 相关军团小格 ---------- */
            case 'mid': {
                var cls = (String(ID) === String(currentCid)) ? ' class="current"' : '';
                el.detailContent.querySelector('.clanFamily').insertAdjacentHTML('beforeend',
                    '<div><div data-clan-id="' + escapeHTML(ID) + '"' + cls + '>' +
                    '<span class="orange">' + escapeHTML(tag + ' ' + full) + '</span>' +
                    '<span class="idNumber">ID：' + escapeHTML(ID) + '</span>' +
                    '</div></div>');
                break;
            }
        }
    }

    /* 渲染“相关军团”（军团族） */
    function renderFamily(mid) {
        el.detailContent.insertAdjacentHTML('beforeend', '<div class="clanFamily"><h3>相关军团</h3></div>');
        var family = toCompare(mid, clanData, 'mid');
        for (var i = 0; i < family.length; i++) insertData(family, i, 'mid');
    }

    /* ===================== SEO / meta ===================== */
    function setMetaImage(path) {
        var node = document.querySelector('meta[itemprop="image"]');
        if (node) node.setAttribute('content', absoluteURL(path));
    }
    function setMetaName(value) {
        var node = document.querySelector('meta[itemprop="name"]');
        if (node) node.setAttribute('content', value);
    }
    function setMetaDescription(value) {
        $$('meta[name="description"], meta[itemprop="description"]').forEach(function (node) {
            node.setAttribute('content', value);
        });
    }
    function applyDetailMeta(clan) {
        var title = '[' + clan.Tag + '] ' + clan.Full + '——闪击战ID百科';
        document.title = title;
        setMetaName(title);
        setMetaDescription(clan.Desc ? String(clan.Desc) : SITE_DESC);
    }
    function restoreMeta() {
        document.title = SITE_TITLE;
        setMetaName(SITE_TITLE);
        setMetaDescription(SITE_DESC);
        setMetaImage('favicon.ico');
    }

    /* ===================== 视图切换 ===================== */
    function isDetailOpen() {
        return el.detail ? window.getComputedStyle(el.detail).display !== 'none' : false;
    }

    function updateResetBtn() {
        var empty = !el.searchInput || el.searchInput.value === '';
        $$('.btn.resetBtn > *').forEach(function (node) {
            node.style.display = empty ? 'none' : '';
        });
    }

    function calcTableHeight() {
        var height = window.innerHeight
            - outerHeight($('table.clan_lib thead'))
            - outerHeight(el.titleBanner)
            - outerHeight(document.getElementById('head'));
        if (el.tbody) el.tbody.style.height = Math.max(height, 0) + 'px';
        return height;
    }

    function restorePosition() {
        if (!el.tbody) return;
        if (typeof el.tbody.scrollTo === 'function') el.tbody.scrollTo({ top: 0, behavior: 'smooth' });
        else el.tbody.scrollTop = 0;
    }

    function ensureBackButton() {
        if (backBtn && backBtn.parentNode) return backBtn;
        backBtn = document.createElement('span');
        backBtn.className = 'btn flipBtn back';
        backBtn.innerHTML = '<svg width="1em" height="1em" viewBox="0 0 16 16" class="bi bi-chevron-left" fill="currentColor" xmlns="http://www.w3.org/2000/svg">' +
            '<path fill-rule="evenodd" d="M11.354 1.646a.5.5 0 0 1 0 .708L5.707 8l5.647 5.646a.5.5 0 0 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0z"/></svg>' +
            '<span>返回</span>';
        el.titleBanner.insertBefore(backBtn, el.titleBanner.firstChild);
        backBtn.addEventListener('click', function () { backToRecommend(true); });
        return backBtn;
    }

    /* 搜索侧：渲染结果表 */
    function renderSearchResults(keyword) {
        if (!el.tbody) return;
        el.tbody.innerHTML = '';
        var result = toCompare(keyword, clanData);
        changeTitle('搜索到', result.length);
        if (!result.length) {
            el.tbody.insertAdjacentHTML('beforeend', '<tr><td>未搜索到相关内容，相关军团可能尚未收录</td></tr>');
        } else {
            for (var i = 0; i < result.length; i++) insertData(result, i, 'table');
        }
        slideClose(el.announcement, 250);
        $$('.flipBtn').forEach(hideEl);
        showInline(ensureBackButton());
    }

    function showSearchResults(keyword) {
        hideEl(el.recommend);
        showBlock(el.table);
        restorePosition();
        renderSearchResults(keyword);
    }

    function startSearching(alertWhenEmpty) {
        var keyword = readKeyword();
        if (!keyword) {
            if (alertWhenEmpty) alert('您还没有输入关键词！');
            return;
        }
        window.history.pushState({ page: 'search', keyword: keyword }, '', '?keyword=' + encodeURIComponent(keyword));
        showSearchResults(keyword);
        recordSearchAction(keyword);
    }

    function readKeyword() {
        return el.searchInput ? el.searchInput.value.trim() : '';
    }

    function backToRecommend(useHistory) {
        beginIndex = 0;
        endingIndex = STEP_LENGTH - 1;
        dataIndex = 0;
        hideEl(backBtn);
        hideEl(el.table);
        showBlock(el.recommend);
        if (useHistory !== false) window.history.replaceState({ page: 'home' }, '', './');
        showRecommend();
    }

    /* 详情侧 */
    function openDetailWindow() {
        if (!isDetailOpen()) fadeIn(el.detail, 400);
        expandDetailInner();
        scrollFlag = false;
    }

    function renderDetail(cid) {
        var id = String(cid == null ? '' : cid);
        if (!id) return;
        var numeric = Number(id);
        if (isNaN(numeric) && id.indexOf('隐藏') === -1) return;
        if ((numeric === 0 || numeric % 1 !== 0) && id.indexOf('隐藏') === -1) return;

        var hit = toCompare(id, clanData, 'id');
        if (!hit.length) return;

        currentCid = id;
        el.detailContent.style.display = '';
        insertData(hit, 0, 'detail');
        applyDetailMeta(hit[0]);
        if (el.detailWindow) el.detailWindow.scrollTop = 0;
        openDetailWindow();
    }

    function openDetail(cid, useHistory) {
        if (useHistory !== false) {
            window.history.pushState({ page: 'detail', cid: String(cid) }, '', '?cid=' + encodeURIComponent(cid));
        }
        renderDetail(cid);
    }

    function closeDetail(useHistory) {
        if (useHistory !== false) window.history.replaceState({ page: 'home' }, '', './');
        collapseDetailInner();
        fadeOut(el.detail, 600, function () {
            if (el.detailContent) el.detailContent.innerHTML = '';
            if (el.detailWindow) {
                el.detailWindow.style.transform = 'translateY(0px)';
                el.detailWindow.scrollTop = 0;
            }
        });
        restoreMeta();
        scrollFlag = false;
    }

    /* ===================== 首页推荐 ===================== */
    function showRecommend() {
        if (!el.recommend) return;
        el.recommend.innerHTML = '';
        changeTitle('军团推荐');

        if (!recommendPool.length) {
            el.recommend.innerHTML = '<p>暂无推荐</p>';
            return;
        }

        var picked = [];
        var familySeen = [];
        var guard = 0;
        while (picked.length < RECOMMEND_COUNT && guard < 500) {
            guard++;
            var rand = Math.floor(Math.random() * recommendPool.length);
            if (picked.indexOf(rand) !== -1) continue;
            var clan = recommendPool[rand];
            if (clan.MID != null && familySeen.indexOf(clan.MID) !== -1) continue;   // 同一军团族只出一个
            picked.push(rand);
            if (clan.MID != null) familySeen.push(clan.MID);
        }

        var html = '';
        for (var k = 0; k < picked.length; k++) {
            var item = recommendPool[picked[k]];
            var ID = item.ID;
            var tag = '[' + item.Tag + ']';
            var full = item.Full;
            var desc = item.Desc == null ? '' : String(item.Desc);

            var rep = resolveRepeat(item.MID, desc);
            if (rep) desc = rep.Desc;      // FIX: 原版把 {Desc} 对象赋给 desc，下一行 replace 直接抛错

            var dateHTML = '';
            if (item.Date) {
                dateHTML = '<span class="date">建于：<span class="desc-color">' + escapeHTML(processDate(item.Date)) + '</span></span>';
            }

            var logoHTML;
            if (item.Logo && FILE_EXT[item.Logo]) {
                logoHTML = '<img src="img/clan/' + ID + '/0.' + FILE_EXT[item.Logo] + '">';
            } else {
                logoHTML = '<img src="img/icons/clanEmblems1x/clan-icon-v2-' + rLogo[Math.floor(Math.random() * rLogo.length)] + '.png">';
            }

            html += '<div class="clan-card" data-clan-id="' + escapeHTML(ID) + '">' +
                '<div class="logo">' + logoHTML + '</div>' +
                '<div class="card-content">' +
                '<span class="orange">' + escapeHTML(tag + ' ' + full) + '</span><br>' +
                'ID：<span class="desc-color">' + escapeHTML(ID) + '</span>' + dateHTML +
                '<div class="desc-color">' + escapeHTML(desc).replace(/\n/g, '<br>') + '</div>' +
                '</div></div>';
        }
        el.recommend.insertAdjacentHTML('beforeend', html);
    }

    /* ===================== 分页浏览（保留原有逻辑） ===================== */
    function fetchData() {
        restorePosition();
        var total = clanData.length;
        if (!total || !el.tbody) return;

        changeTitle('收录', total);
        if (beginIndex <= 0) hideEl($('.flipBtn.prev')); else showInline($('.flipBtn.prev'));
        if (endingIndex >= total - 1) hideEl($('.flipBtn.next')); else showInline($('.flipBtn.next'));

        if (beginIndex < 0) beginIndex = 0;
        var last = Math.min(endingIndex, total - 1);

        el.tbody.innerHTML = '';
        for (var i = beginIndex; i <= last; i++) insertData(clanData, i, 'table');
    }

    /* ===================== 埋点 ===================== */
    function recordSearchAction(keyword) {
        try {
            fetch(RECORD_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
                body: new URLSearchParams({ keyword: keyword }).toString(),
                mode: 'cors',
                keepalive: true
            }).catch(function () { /* 埋点失败不影响主流程 */ });
        } catch (e) { /* 忽略 */ }
    }

    /* ===================== 事件绑定 ===================== */
    var touchStartY = 0;
    var touchDistance = 0;

    function bindEvents() {
        var prevBtn = $('.flipBtn.prev');
        var nextBtn = $('.flipBtn.next');

        on(nextBtn, 'click', function () {
            beginIndex += STEP_LENGTH;
            endingIndex += STEP_LENGTH;
            dataIndex = beginIndex;
            fetchData();
        });
        on(prevBtn, 'click', function () {
            beginIndex -= STEP_LENGTH;
            endingIndex -= STEP_LENGTH;
            dataIndex = beginIndex;
            fetchData();
        });

        /* ---- 搜索框 ---- */
        on(el.searchBtn, 'click', function () {
            if (!readKeyword()) return;
            startSearching(false);
        });
        on(el.resetBtn, 'click', function () {
            if (!el.searchInput) return;
            el.searchInput.value = '';
            el.searchInput.focus();
            updateResetBtn();
        });
        on(el.searchInput, 'input', updateResetBtn);
        on(el.searchInput, 'focus', function () { updateResetBtn(); slideOpen(el.announcement, 250); });
        on(el.searchInput, 'click', function () { this.select(); slideOpen(el.announcement, 250); });
        on(el.searchInput, 'keydown', function (e) {
            if (e.key === 'Enter' || e.which === 13) startSearching(true);
        });

        /* ---- Ctrl/Cmd + F ---- */
        on(document, 'keydown', function (e) {
            if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F' || e.which === 70)) {
                e.preventDefault();
                if (el.searchInput) { el.searchInput.focus(); el.searchInput.select(); }
                if (isDetailOpen()) closeDetail(true);
            }
        });

        /* ---- 点击空白处收起公告栏 ---- */
        on(document, 'click', function (e) {
            var target = e.target;
            if (!target.closest) return;
            var inSearch = target.closest('#searchstr');
            var inWrap = target.closest('#announcement_zone .wrap');
            var inCollapse = target.closest('#announcement_zone .toCollapse');
            if ((!inSearch && !inWrap) || inCollapse) slideClose(el.announcement, 250);
        });

        /* ---- 点击列表行 / 推荐卡 打开详情 ---- */
        on(document, 'click', function (e) {
            if (!e.target.closest) return;
            var row = e.target.closest('#content tbody tr[data-clan-id], .clan-card[data-clan-id]');
            if (!row) return;
            openDetail(row.getAttribute('data-clan-id'));
        });

        /* ---- 行按下高亮反馈 ---- */
        on(document, 'mousedown', function (e) {
            if (!e.target.closest) return;
            var row = e.target.closest('#content tbody tr[data-clan-id]');
            if (row && e.which === 1) row.style.backgroundColor = 'rgba(70, 94, 109, 0.5)';
        });
        on(document, 'mouseup', function (e) {
            if (!e.target.closest) return;
            var row = e.target.closest('#content tbody tr[data-clan-id]');
            if (row) row.style.backgroundColor = '';
        });

        /* ---- 族内切换 ---- */
        on(el.detail, 'click', function (e) {
            if (!e.target.closest) return;
            var cell = e.target.closest('.clanFamily [data-clan-id]');
            if (!cell) return;
            var cid = cell.getAttribute('data-clan-id');
            window.history.pushState({ page: 'detail', cid: cid }, '', '?cid=' + encodeURIComponent(cid));
            fadeOut(el.detailContent, 250, function () {
                el.detailContent.innerHTML = '';
                renderDetail(cid);
                fadeIn(el.detailContent, 350);
            });
        });

        /* ---- 关闭浮层 ---- */
        on(el.detail, 'click', function (e) {
            var target = e.target;
            if (!target.closest) return;
            var insideWindow = target.closest('#detail .inner *');
            var isDismiss = target.closest('#detail .dismissBtn');
            if (!insideWindow || isDismiss) closeDetail(true);
        });
        on(el.detail, 'keydown', function () { closeDetail(true); });

        /* ---- 触摸下拉关闭 ---- */
        on(el.detailContent, 'touchstart', function (e) {
            touchStartY = e.touches[0].pageY;
        }, { passive: true });
        on(el.detailContent, 'touchmove', function (e) {
            touchDistance = e.touches[0].pageY - touchStartY;
            if (el.detailWindow && el.detailWindow.scrollTop <= 0 && !scrollFlag) {
                el.detailWindow.style.transform = 'translateY(' + (0.1875 * touchDistance) + 'px)';
            }
        }, { passive: true });
        on(el.detailContent, 'touchend', function () {
            if (!el.detailWindow) return;
            if (el.detailWindow.scrollTop > 0) scrollFlag = false;
            if (touchDistance < -0.2 * el.detailWindow.clientHeight) scrollFlag = true;
            if (touchDistance > 128 && el.detailWindow.scrollTop <= 0 && !scrollFlag) {
                touchDistance = 0;
                closeDetail(true);
            } else {
                el.detailWindow.style.transform = 'translateY(0px)';
            }
        });

        /* ---- 浏览器前进/后退 ---- */
        on(window, 'popstate', function () {
            var cid = getQueryStr('cid');
            var keyword = getQueryStr('keyword');
            if (cid) {
                renderDetail(cid);
            } else if (keyword) {
                if (isDetailOpen()) closeDetail(false);
                if (el.searchInput) el.searchInput.value = keyword;
                updateResetBtn();
                showSearchResults(keyword);
            } else {
                if (isDetailOpen()) closeDetail(false);
                backToRecommend(false);
            }
        });

        on(window, 'resize', calcTableHeight);
    }

    /* ===================== 启动 ===================== */
    function boot() {
        for (var i = 0; i <= 24; i++) rLogo.push(10000 + i);
        for (var j = 2; j <= 26; j++) rLogo.push(20000 + j);

        bindEvents();
        calcTableHeight();
        updateResetBtn();
        setMetaImage('favicon.ico');

        loadData().then(function () {
            recommendPool = toCompare(undefined, clanData, 'analysis');
            showRecommend();

            var cid = getQueryStr('cid');
            var keyword = getQueryStr('keyword');
            if (cid) {
                renderDetail(cid);
            } else if (keyword) {
                if (el.searchInput) el.searchInput.value = keyword;
                updateResetBtn();
                showSearchResults(keyword);
            }
        });
    }

    boot();
})();