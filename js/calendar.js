(function () {
  "use strict";

  var STORAGE_KEY = "eoulrim_calendar_events_v2";
  var LEGACY_STORAGE_KEY = "eoulrim_calendar_events_v1";
  var DEFAULT_HIGHLIGHT = "#fde047";

  var SYNC_URL = (function () {
    var m = document.querySelector('meta[name="calendar-sync-url"]');
    return m ? String(m.getAttribute("content") || "").trim() : "";
  })();

  /** @type {Record<string, unknown[]> | null} */
  var eventsCache = null;
  var pushTimer = null;
  var pushInFlight = false;

  /** @type {Record<string, boolean>} */
  var selectedDates = Object.create(null);

  /** @type {string | null} */
  var focusDate = null;

  /** false면 날짜 한 번에 하나만 선택 */
  var multiSelectMode = false;

  var state = {
    viewYear: new Date().getFullYear(),
    viewMonth: new Date().getMonth(),
  };

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function toKey(y, m, d) {
    return y + "-" + pad(m + 1) + "-" + pad(d);
  }

  function parseKey(key) {
    var p = key.split("-").map(Number);
    return { y: p[0], m: p[1] - 1, d: p[2] };
  }

  function loadLocalObject() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          return /** @type {Record<string, unknown[]>} */ (parsed);
        }
      }
      var leg = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (leg) {
        var oldMap = JSON.parse(leg);
        if (typeof oldMap === "object" && oldMap !== null && !Array.isArray(oldMap)) {
          saveLocalObject(/** @type {Record<string, unknown[]>} */ (oldMap));
          localStorage.removeItem(LEGACY_STORAGE_KEY);
          return /** @type {Record<string, unknown[]>} */ (oldMap);
        }
      }
    } catch (e) {
      /* ignore */
    }
    return {};
  }

  function saveLocalObject(map) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  }

  function readAll() {
    if (!eventsCache) eventsCache = loadLocalObject();
    return eventsCache;
  }

  function writeAll(map) {
    eventsCache = map;
    saveLocalObject(map);
    refreshUi();
    schedulePush();
  }

  function normalizeEvent(ev, i) {
    if (!ev || typeof ev !== "object") return null;
    var title = String(ev.title || "").trim();
    if (!title) return null;
    var summary = String(ev.summary || "").trim();
    var c = String(ev.color || "").trim();
    if (!/^#[0-9A-Fa-f]{6}$/.test(c)) c = DEFAULT_HIGHLIGHT;
    var id =
      typeof ev.id === "string"
        ? ev.id
        : "legacy-" + i + "-" + title + "-" + String(ev.time || "");
    var rawLine =
      typeof ev.lineId === "string" ? String(ev.lineId).trim() : "";
    var lineId = rawLine || id;
    return {
      id: id,
      lineId: lineId,
      title: title,
      summary: summary,
      time: ev.time ? String(ev.time) : "",
      color: c,
      done: !!ev.done,
    };
  }

  function normalizedListForKey(key, map) {
    var list = map[key];
    if (!Array.isArray(list)) return [];
    return list.map(normalizeEvent).filter(Boolean);
  }

  function getTargetsForMemo() {
    var keys = Object.keys(selectedDates).filter(function (k) {
      return selectedDates[k];
    });
    if (keys.length > 0) return keys.slice().sort();
    if (focusDate) return [focusDate];
    return [];
  }

  function toggleSelected(key) {
    if (selectedDates[key]) delete selectedDates[key];
    else selectedDates[key] = true;
  }

  /** lineId가 등장하는 서로 다른 날짜 키 개수 */
  function countDateKeysWithLineId(lineId) {
    var map = readAll();
    var n = 0;
    Object.keys(map).forEach(function (key) {
      var list = map[key];
      if (!Array.isArray(list)) return;
      for (var i = 0; i < list.length; i++) {
        var ev = normalizeEvent(list[i], i);
        if (ev && ev.lineId === lineId) {
          n++;
          return;
        }
      }
    });
    return n;
  }

  /** 같은 lineId가 여러 날에 있을 때, 각 날의 done이 모두 같은지 */
  function lineIdDoneIsUniformAcrossDates(lineId) {
    var map = readAll();
    var seenDone = null;
    var mixed = false;
    Object.keys(map).forEach(function (key) {
      var list = map[key];
      if (!Array.isArray(list)) return;
      for (var i = 0; i < list.length; i++) {
        var n = normalizeEvent(list[i], i);
        if (!n || n.lineId !== lineId) continue;
        var d = !!n.done;
        if (seenDone === null) seenDone = d;
        else if (seenDone !== d) mixed = true;
        break;
      }
    });
    return !mixed;
  }

  function deleteLineAll(lineId) {
    var map = JSON.parse(JSON.stringify(readAll()));
    Object.keys(map).forEach(function (key) {
      var list = map[key];
      if (!Array.isArray(list)) return;
      var next = [];
      list.forEach(function (ev, idx) {
        var n = normalizeEvent(ev, idx);
        if (!n || n.lineId !== lineId) next.push(ev);
      });
      if (next.length === 0) delete map[key];
      else map[key] = next;
    });
    writeAll(map);
  }

  function deleteLineForDate(lineId, dateKey) {
    var map = JSON.parse(JSON.stringify(readAll()));
    var list = map[dateKey];
    if (!Array.isArray(list)) return;
    var next = [];
    list.forEach(function (ev, idx) {
      var n = normalizeEvent(ev, idx);
      if (!n || n.lineId !== lineId) next.push(ev);
    });
    if (next.length === 0) delete map[dateKey];
    else map[dateKey] = next;
    writeAll(map);
  }

  /** 미완료 위 · 완료(취소선) 아래 */
  function sortDayMemosForPanel(list) {
    var cmp = function (a, b) {
      return (a.title || "").localeCompare(b.title || "", "ko");
    };
    var active = list.filter(function (x) {
      return !x.done;
    });
    var done = list.filter(function (x) {
      return x.done;
    });
    active.sort(cmp);
    done.sort(cmp);
    return active.concat(done);
  }

  function toggleLineDoneAll(lineId) {
    var map = JSON.parse(JSON.stringify(readAll()));
    var seen = false;
    var allDone = true;
    Object.keys(map).forEach(function (key) {
      var list = map[key];
      if (!Array.isArray(list)) return;
      list.forEach(function (ev, idx) {
        var n = normalizeEvent(ev, idx);
        if (!n || n.lineId !== lineId) return;
        seen = true;
        if (!n.done) allDone = false;
      });
    });
    if (!seen) return;
    var next = !allDone;
    Object.keys(map).forEach(function (key) {
      var list = map[key];
      if (!Array.isArray(list)) return;
      list.forEach(function (ev, idx) {
        var n = normalizeEvent(ev, idx);
        if (!n || n.lineId !== lineId) return;
        ev.done = next;
      });
    });
    writeAll(map);
  }

  function toggleLineDoneForDate(lineId, dateKey) {
    var map = JSON.parse(JSON.stringify(readAll()));
    var list = map[dateKey];
    if (!Array.isArray(list)) return;
    var seen = false;
    var allDone = true;
    list.forEach(function (ev, idx) {
      var n = normalizeEvent(ev, idx);
      if (!n || n.lineId !== lineId) return;
      seen = true;
      if (!n.done) allDone = false;
    });
    if (!seen) return;
    var next = !allDone;
    list.forEach(function (ev, idx) {
      var n = normalizeEvent(ev, idx);
      if (!n || n.lineId !== lineId) return;
      ev.done = next;
    });
    map[dateKey] = list;
    writeAll(map);
  }

  /** @type {{ kind: string, lineId: string, dateKey: string | null } | null} */
  var pendingScopeAction = null;

  function closeScopeModal() {
    pendingScopeAction = null;
    var modal = document.getElementById("scopeConfirmModal");
    if (modal) {
      modal.classList.add("is-hidden");
      modal.setAttribute("aria-hidden", "true");
    }
    document.body.classList.remove("scope-modal-open");
  }

  function openScopeModal(kind, lineId, dateKey) {
    pendingScopeAction = {
      kind: kind,
      lineId: lineId,
      dateKey: dateKey || focusDate,
    };
    var modal = document.getElementById("scopeConfirmModal");
    var title = document.getElementById("scopeModalTitle");
    var msg = document.getElementById("scopeModalMessage");
    var btnThis = document.getElementById("scopeModalThisDay");
    var btnAll = document.getElementById("scopeModalAllDays");
    if (!modal || !title || !msg || !btnThis || !btnAll) return;

    btnThis.textContent = "이 날짜만";
    btnAll.textContent = "모든 날짜";
    btnThis.className = "btn btn--ghost scope-modal__action-btn";

    if (kind === "delete") {
      title.textContent = "메모 삭제";
      msg.textContent = "같은 줄로 묶인 메모가 여러 날짜에 있어요.";
      btnAll.className = "btn btn--danger scope-modal__action-btn";
    } else {
      title.textContent = "완료 표시";
      msg.textContent = "같은 줄이 여러 날짜에 걸려 있어요.";
      btnAll.className = "btn btn--primary scope-modal__action-btn";
    }

    modal.classList.remove("is-hidden");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("scope-modal-open");
    btnThis.focus();
  }

  function requestDeleteLine(lineId, dateKey) {
    var dk = dateKey || focusDate;
    if (countDateKeysWithLineId(lineId) <= 1) {
      deleteLineAll(lineId);
      return;
    }
    if (!dk) {
      deleteLineAll(lineId);
      return;
    }
    openScopeModal("delete", lineId, dk);
  }

  function requestToggleLineDone(lineId, dateKey) {
    var dk = dateKey || focusDate;
    if (countDateKeysWithLineId(lineId) <= 1) {
      toggleLineDoneAll(lineId);
      return;
    }
    if (!dk) {
      toggleLineDoneAll(lineId);
      return;
    }
    if (!lineIdDoneIsUniformAcrossDates(lineId)) {
      toggleLineDoneForDate(lineId, dk);
      return;
    }
    openScopeModal("toggle", lineId, dk);
  }

  function initScopeModal() {
    var cancel = document.getElementById("scopeModalCancel");
    var backdrop = document.getElementById("scopeModalBackdrop");
    var btnThis = document.getElementById("scopeModalThisDay");
    var btnAll = document.getElementById("scopeModalAllDays");
    if (!cancel || !backdrop || !btnThis || !btnAll) return;

    cancel.addEventListener("click", closeScopeModal);
    backdrop.addEventListener("click", closeScopeModal);
    btnThis.addEventListener("click", function () {
      var p = pendingScopeAction;
      var dk = p && (p.dateKey || focusDate);
      if (!p || !dk) {
        closeScopeModal();
        return;
      }
      var kind = p.kind;
      var lid = p.lineId;
      closeScopeModal();
      if (kind === "delete") deleteLineForDate(lid, dk);
      else toggleLineDoneForDate(lid, dk);
    });
    btnAll.addEventListener("click", function () {
      var p = pendingScopeAction;
      if (!p) {
        closeScopeModal();
        return;
      }
      var kind = p.kind;
      var lid = p.lineId;
      closeScopeModal();
      if (kind === "delete") deleteLineAll(lid);
      else toggleLineDoneAll(lid);
    });

    document.addEventListener("keydown", function (e) {
      var modal = document.getElementById("scopeConfirmModal");
      if (!modal || modal.classList.contains("is-hidden")) return;
      if (e.key === "Escape") {
        e.preventDefault();
        closeScopeModal();
      }
    });
  }

  function daysInMonth(y, m) {
    return new Date(y, m + 1, 0).getDate();
  }

  function buildMonthCells(y, m) {
    var first = new Date(y, m, 1);
    var startWeekday = first.getDay();
    var dim = daysInMonth(y, m);
    var prevDim = daysInMonth(y, m - 1);
    var cells = [];

    for (var i = 0; i < startWeekday; i++) {
      var d = prevDim - startWeekday + i + 1;
      var pm = m - 1;
      var py = y;
      if (pm < 0) {
        pm = 11;
        py--;
      }
      cells.push({ y: py, m: pm, d: d, outside: true });
    }

    for (var day = 1; day <= dim; day++) {
      cells.push({ y: y, m: m, d: day, outside: false });
    }

    var tail = 42 - cells.length;
    if (tail < 0) tail = 0;
    var nm = m + 1;
    var ny = y;
    if (nm > 11) {
      nm = 0;
      ny++;
    }
    for (var j = 1; j <= tail; j++) {
      cells.push({ y: ny, m: nm, d: j, outside: true });
    }

    return cells;
  }

  var STREAK_BAND_PX = 17;

  /** lineId 접두 타임스탬프(메모 생성 순서). 없으면 0 */
  function lineIdTimeKey(lineId) {
    var n = parseInt(String(lineId).split("-")[0], 10);
    return isNaN(n) ? 0 : n;
  }

  function computeStreakRuns(rowCells, map) {
    var lineMeta = Object.create(null);

    rowCells.forEach(function (rc) {
      if (rc.outside) return;
      var evs = normalizedListForKey(rc.key, map);
      evs.forEach(function (ev) {
        var lid = ev.lineId;
        if (!lineMeta[lid]) {
          lineMeta[lid] = {
            cols: [],
            color: ev.color,
            done: !!ev.done,
          };
        }
        lineMeta[lid].cols.push(rc.col);
        lineMeta[lid].done = lineMeta[lid].done && !!ev.done;
      });
    });

    var runs = [];
    Object.keys(lineMeta).forEach(function (lid) {
      var cols = lineMeta[lid].cols
        .filter(function (v, i, a) {
          return a.indexOf(v) === i;
        })
        .sort(function (a, b) {
          return a - b;
        });
      if (cols.length === 0) return;

      var start = cols[0];
      var prev = cols[0];
      for (var i = 1; i < cols.length; i++) {
        var next = cols[i];
        if (next === prev + 1) {
          prev = next;
          continue;
        }
        runs.push({
          lineId: lid,
          startCol: start,
          spanCols: prev - start + 1,
          color: lineMeta[lid].color,
          done: lineMeta[lid].done,
        });
        start = next;
        prev = next;
      }
      runs.push({
        lineId: lid,
        startCol: start,
        spanCols: prev - start + 1,
        color: lineMeta[lid].color,
        done: lineMeta[lid].done,
      });
    });

    runs.sort(function (a, b) {
      return a.startCol - b.startCol || a.spanCols - b.spanCols;
    });

    return runs;
  }

  var els = {
    shell: document.getElementById("calendarGridShell"),
    viewPeriodHeading: document.getElementById("viewPeriodHeading"),
    multiSelectToggle: document.getElementById("multiSelectToggle"),
    periodPickerTrigger: document.getElementById("periodPickerTrigger"),
    periodPickerPopover: document.getElementById("periodPickerPopover"),
    periodYearSelect: document.getElementById("periodYearSelect"),
    periodMonthSelect: document.getElementById("periodMonthSelect"),
    btnPrev: document.getElementById("btnPrev"),
    btnNext: document.getElementById("btnNext"),
    btnToday: document.getElementById("btnToday"),
    syncStatus: document.getElementById("syncStatus"),
    dayMemoStacks: document.getElementById("dayMemoStacks"),
    memoForm: document.getElementById("memoForm"),
    memoInput: document.getElementById("memoInput"),
    hiddenColor: document.getElementById("hiddenColor"),
  };

  function setSyncStatus(mode) {
    if (!els.syncStatus) return;
    if (!SYNC_URL) {
      els.syncStatus.textContent = "";
      return;
    }
    if (mode === "server") {
      els.syncStatus.textContent = "서버와 동기화됨 · 같은 주소를 연 사람과 목록이 같습니다.";
    } else if (mode === "loading") {
      els.syncStatus.textContent = "서버에서 불러오는 중…";
    } else if (mode === "bad_endpoint") {
      els.syncStatus.textContent =
        "동기화 주소가 JSON API가 아닙니다. Workers에 github-calendar-sync.js(또는 KV용 calendar-sync.js)를 배포하고 메타 URL을 /api/calendar-events 로 맞추세요.";
    } else {
      els.syncStatus.textContent =
        "서버와 연결되지 않았습니다. 변경은 로컬에만 저장되며 곧 다시 동기화합니다.";
    }
  }

  function looksLikeHtmlResponse(text) {
    var t = String(text || "").trim();
    if (!t) return false;
    var low = t.slice(0, 64).toLowerCase();
    return low.startsWith("<!doctype") || low.startsWith("<html");
  }

  async function pullRemote() {
    if (!SYNC_URL) return;
    setSyncStatus("loading");
    try {
      var res = await fetch(SYNC_URL, { cache: "no-store" });
      var raw = await res.text();
      if (!res.ok) {
        if (res.status === 404 || res.status === 405) setSyncStatus("bad_endpoint");
        else setSyncStatus("offline");
        return;
      }
      if (looksLikeHtmlResponse(raw)) {
        setSyncStatus("bad_endpoint");
        return;
      }
      var ct = (res.headers.get("content-type") || "").toLowerCase();
      if (ct.indexOf("application/json") === -1 && raw.trim().charAt(0) !== "{") {
        setSyncStatus("bad_endpoint");
        return;
      }
      var data = JSON.parse(raw);
      if (typeof data !== "object" || data === null || Array.isArray(data)) {
        throw new Error("bad payload");
      }
      eventsCache = /** @type {Record<string, unknown[]>} */ (data);
      saveLocalObject(eventsCache);
      refreshUi();
      setSyncStatus("server");
    } catch (e) {
      setSyncStatus("offline");
    }
  }

  function schedulePush() {
    if (!SYNC_URL) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(function () {
      pushRemote();
    }, 650);
  }

  async function pushRemote() {
    if (!SYNC_URL || pushInFlight) return;
    pushInFlight = true;
    try {
      var body = JSON.stringify(readAll());
      var res = await fetch(SYNC_URL, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: body,
      });
      var raw = await res.text();
      if (!res.ok) {
        if (res.status === 404 || res.status === 405 || looksLikeHtmlResponse(raw)) {
          setSyncStatus("bad_endpoint");
        } else {
          setSyncStatus("offline");
        }
        return;
      }
      setSyncStatus("server");
    } catch (e) {
      setSyncStatus("offline");
    } finally {
      pushInFlight = false;
    }
  }

  function isToday(y, m, d) {
    var t = new Date();
    return (
      t.getFullYear() === y &&
      t.getMonth() === m &&
      t.getDate() === d
    );
  }

  /** 우측 패널 상단 날짜 한 줄 */
  function formatMemoPanelDate(key) {
    var p = parseKey(key);
    var dt = new Date(p.y, p.m, p.d);
    var w = ["일", "월", "화", "수", "목", "금", "토"][dt.getDay()];
    return (
      p.y + ". " + (p.m + 1) + ". " + p.d + " · " + w
    );
  }

  function refreshUi() {
    renderPeriod();
    renderGrid();
    renderDayMemosPanel();
    syncMemoFormState();
  }

  var PERIOD_YEAR_MIN = 1970;
  var PERIOD_YEAR_MAX = 2075;

  var periodSelectSyncing = false;

  function setPeriodPopoverOpen(open) {
    if (!els.periodPickerPopover || !els.periodPickerTrigger) return;
    if (open) {
      els.periodPickerPopover.classList.remove("is-hidden");
      els.periodPickerPopover.setAttribute("aria-hidden", "false");
      els.periodPickerTrigger.setAttribute("aria-expanded", "true");
    } else {
      els.periodPickerPopover.classList.add("is-hidden");
      els.periodPickerPopover.setAttribute("aria-hidden", "true");
      els.periodPickerTrigger.setAttribute("aria-expanded", "false");
    }
  }

  function initMultiSelectControl() {
    if (!els.multiSelectToggle) return;
    els.multiSelectToggle.checked = false;
    els.multiSelectToggle.addEventListener("change", function () {
      multiSelectMode = !!els.multiSelectToggle.checked;
      if (!multiSelectMode) {
        var keys = Object.keys(selectedDates).filter(function (k) {
          return selectedDates[k];
        });
        if (keys.length > 1) {
          selectedDates = Object.create(null);
          if (focusDate && keys.indexOf(focusDate) !== -1) {
            selectedDates[focusDate] = true;
          } else {
            selectedDates[keys[0]] = true;
            focusDate = keys[0];
          }
        }
      }
      refreshUi();
    });
  }

  function initPeriodPicker() {
    if (!els.periodYearSelect || !els.periodMonthSelect || !els.periodPickerTrigger) return;
    if (els.periodYearSelect.options.length > 0) return;

    for (var y = PERIOD_YEAR_MIN; y <= PERIOD_YEAR_MAX; y++) {
      var oy = document.createElement("option");
      oy.value = String(y);
      oy.textContent = y + "년";
      els.periodYearSelect.appendChild(oy);
    }
    for (var m = 1; m <= 12; m++) {
      var om = document.createElement("option");
      om.value = String(m);
      om.textContent = m + "월";
      els.periodMonthSelect.appendChild(om);
    }

    function applyFromSelects() {
      if (periodSelectSyncing) return;
      var ny = parseInt(String(els.periodYearSelect.value), 10);
      var nm = parseInt(String(els.periodMonthSelect.value), 10) - 1;
      if (isNaN(ny) || isNaN(nm)) return;
      ny = Math.max(PERIOD_YEAR_MIN, Math.min(PERIOD_YEAR_MAX, ny));
      nm = Math.max(0, Math.min(11, nm));
      if (ny !== state.viewYear || nm !== state.viewMonth) {
        state.viewYear = ny;
        state.viewMonth = nm;
        refreshUi();
      }
    }

    els.periodYearSelect.addEventListener("change", applyFromSelects);
    els.periodMonthSelect.addEventListener("change", applyFromSelects);

    els.periodPickerTrigger.addEventListener("click", function (e) {
      e.stopPropagation();
      var willOpen = els.periodPickerPopover.classList.contains("is-hidden");
      setPeriodPopoverOpen(willOpen);
    });

    document.addEventListener(
      "click",
      function (e) {
        if (
          !els.periodPickerPopover ||
          els.periodPickerPopover.classList.contains("is-hidden")
        ) {
          return;
        }
        var t = e.target;
        if (
          els.periodPickerTrigger.contains(t) ||
          els.periodPickerPopover.contains(t)
        ) {
          return;
        }
        setPeriodPopoverOpen(false);
      },
      true
    );

    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      if (
        els.periodPickerPopover &&
        !els.periodPickerPopover.classList.contains("is-hidden")
      ) {
        setPeriodPopoverOpen(false);
      }
    });
  }

  function renderPeriod() {
    var y = state.viewYear;
    var m = state.viewMonth;
    if (els.viewPeriodHeading) {
      els.viewPeriodHeading.textContent = y + "년 " + (m + 1) + "월";
    }
    if (els.periodYearSelect && els.periodMonthSelect) {
      periodSelectSyncing = true;
      els.periodYearSelect.value = String(
        Math.max(PERIOD_YEAR_MIN, Math.min(PERIOD_YEAR_MAX, y))
      );
      els.periodMonthSelect.value = String(Math.max(1, Math.min(12, m + 1)));
      periodSelectSyncing = false;
    }
  }

  function syncMemoFormState() {
    var ok = getTargetsForMemo().length > 0;
    els.memoInput.disabled = !ok;
    els.memoForm.querySelector(".btn--primary").disabled = !ok;
    els.memoForm.querySelectorAll(".color-chip").forEach(function (btn) {
      btn.disabled = !ok;
    });
  }

  /** 패널에 표시할 날짜 키 (다중 선택 시 여러 개) */
  function keysForMemoPanel() {
    if (!focusDate) return [];
    if (multiSelectMode) {
      var keys = Object.keys(selectedDates).filter(function (k) {
        return selectedDates[k];
      });
      keys.sort();
      if (keys.length > 1) return keys;
    }
    return [focusDate];
  }

  function renderDayMemosPanel() {
    if (!els.dayMemoStacks) return;
    els.dayMemoStacks.innerHTML = "";

    var keys = keysForMemoPanel();
    if (keys.length === 0) return;

    var map = readAll();
    var multiStacks = keys.length > 1;

    keys.forEach(function (dateKey) {
      var stack = document.createElement("article");
      stack.className = "day-memo-stack";
      if (dateKey === focusDate) stack.classList.add("day-memo-stack--focus");

      var dateEl = document.createElement("p");
      dateEl.className = "day-memo-stack__date";
      dateEl.textContent = formatMemoPanelDate(dateKey);
      if (multiStacks) {
        dateEl.classList.add("day-memo-stack__date--clickable");
        dateEl.title = "달력에서 이 날로 포커스";
        dateEl.addEventListener("click", function () {
          focusDate = dateKey;
          refreshUi();
        });
      }

      var ul = document.createElement("ul");
      ul.className = "day-memo-list";

      var items = sortDayMemosForPanel(normalizedListForKey(dateKey, map));

      if (items.length === 0) {
        var emptyLi = document.createElement("li");
        emptyLi.className = "day-memo-stack__empty";
        emptyLi.textContent = "메모 없음";
        ul.appendChild(emptyLi);
      } else {
        items.forEach(function (ev) {
          var li = document.createElement("li");
          li.className = "day-memo-item" + (ev.done ? " is-done" : "");

          var row = document.createElement("div");
          row.className = "day-memo-item__row";

          var stripe = document.createElement("span");
          stripe.className = "day-memo-item__stripe";
          stripe.style.backgroundColor = ev.color;

          var body = document.createElement("div");
          body.className = "day-memo-item__body";
          var p = document.createElement("p");
          p.className = "day-memo-item__text";
          p.textContent = ev.title;
          body.appendChild(p);

          var del = document.createElement("button");
          del.type = "button";
          del.className = "btn-trash";
          del.setAttribute("aria-label", "삭제");
          del.innerHTML =
            '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><path d="M10 11v6M14 11v6"/></svg>';
          del.addEventListener("click", function (e) {
            e.stopPropagation();
            requestDeleteLine(ev.lineId, dateKey);
          });

          row.addEventListener("click", function (e) {
            if (e.target.closest(".btn-trash")) return;
            requestToggleLineDone(ev.lineId, dateKey);
          });

          row.appendChild(stripe);
          row.appendChild(body);
          row.appendChild(del);

          li.appendChild(row);
          ul.appendChild(li);
        });
      }

      stack.appendChild(dateEl);
      stack.appendChild(ul);
      els.dayMemoStacks.appendChild(stack);
    });
  }

  function renderGrid() {
    var y = state.viewYear;
    var m = state.viewMonth;
    var cells = buildMonthCells(y, m);
    var all = readAll();
    var frag = document.createDocumentFragment();

    for (let w = 0; w < 6; w++) {
      var pack = document.createElement("div");
      pack.className = "calendar-week-pack";

      var rowEl = document.createElement("div");
      rowEl.className = "calendar-week-pack__cells";

      var rowCells = [];
      var rowButtons = [];

      for (let c = 0; c < 7; c++) {
        let idx = w * 7 + c;
        let cell = cells[idx];
        let key = toKey(cell.y, cell.m, cell.d);

        rowCells.push({ key: key, outside: cell.outside, col: c });

        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "grid__cell";
        btn.dataset.date = key;

        if (cell.outside) btn.classList.add("grid__cell--outside");

        var wd = new Date(cell.y, cell.m, cell.d).getDay();
        if (wd === 0) btn.classList.add("grid__cell--sun");
        if (wd === 6) btn.classList.add("grid__cell--sat");

        if (!cell.outside && isToday(cell.y, cell.m, cell.d)) {
          btn.classList.add("grid__cell--today");
        }

        if (focusDate === key) btn.classList.add("grid__cell--focus");
        if (selectedDates[key]) btn.classList.add("grid__cell--picked");

        var num = document.createElement("span");
        num.className = "grid__cell-num";
        num.textContent = String(cell.d);
        btn.appendChild(num);

        if (!cell.outside) {
          btn.addEventListener("click", function () {
            if (multiSelectMode) {
              toggleSelected(key);
            } else {
              selectedDates = Object.create(null);
              selectedDates[key] = true;
            }
            focusDate = key;
            refreshUi();
          });
        } else {
          btn.tabIndex = -1;
          btn.setAttribute("aria-hidden", "true");
        }

        rowEl.appendChild(btn);
        rowButtons.push(btn);
      }

      var runs = computeStreakRuns(rowCells, all);

      var runsByLineId = Object.create(null);
      runs.forEach(function (run) {
        if (!runsByLineId[run.lineId]) runsByLineId[run.lineId] = [];
        runsByLineId[run.lineId].push(run);
      });

      var uniqueLineIds = Object.keys(runsByLineId);
      uniqueLineIds.sort(function (a, b) {
        return lineIdTimeKey(b) - lineIdTimeKey(a);
      });

      var colSlotOwner = [];
      for (var ci = 0; ci < 7; ci++) {
        colSlotOwner[ci] = Object.create(null);
      }

      var slotByLineId = Object.create(null);

      uniqueLineIds.forEach(function (lid) {
        var lineRuns = runsByLineId[lid];
        var s = 0;
        for (;;) {
          var ok = true;
          for (var ri = 0; ri < lineRuns.length && ok; ri++) {
            var rn = lineRuns[ri];
            for (var col = rn.startCol; col < rn.startCol + rn.spanCols; col++) {
              if (col < 0 || col > 6) continue;
              var owner = colSlotOwner[col][s];
              if (owner != null && owner !== lid) {
                ok = false;
                break;
              }
            }
          }
          if (ok) break;
          s++;
        }
        slotByLineId[lid] = s;
        for (var rj = 0; rj < lineRuns.length; rj++) {
          var rx = lineRuns[rj];
          for (var col2 = rx.startCol; col2 < rx.startCol + rx.spanCols; col2++) {
            if (col2 < 0 || col2 > 6) continue;
            colSlotOwner[col2][s] = lid;
          }
        }
      });

      var maxSlotIdx = 0;
      uniqueLineIds.forEach(function (lid) {
        maxSlotIdx = Math.max(maxSlotIdx, slotByLineId[lid]);
      });

      var bandCount =
        uniqueLineIds.length === 0 ? 0 : maxSlotIdx + 1;

      var padExtra = 8;
      var streakPad =
        bandCount === 0 ? 13 : bandCount * STREAK_BAND_PX + padExtra;
      rowEl.style.setProperty("--cell-streak-pad", streakPad + "px");

      var stripHeightPx = bandCount === 0 ? 0 : bandCount * STREAK_BAND_PX;

      var colBands = [[], [], [], [], [], [], []];
      runs.forEach(function (run) {
        var slot = slotByLineId[run.lineId];
        for (var col = run.startCol; col < run.startCol + run.spanCols; col++) {
          if (col < 0 || col > 6) continue;
          colBands[col].push({
            slot: slot,
            color: run.color,
            done: run.done,
          });
        }
      });

      for (let c = 0; c < 7; c++) {
        var strip = document.createElement("div");
        strip.className = "grid__cell-streak-stripes";
        strip.setAttribute("aria-hidden", "true");
        strip.style.height = stripHeightPx + "px";
        colBands[c].forEach(function (seg) {
          var span = document.createElement("span");
          span.className =
            "calendar-streak-segment" +
            (seg.done ? " calendar-streak-segment--done" : "");
          span.style.backgroundColor = seg.color;
          span.style.height = STREAK_BAND_PX + "px";
          span.style.bottom = seg.slot * STREAK_BAND_PX + "px";
          strip.appendChild(span);
        });
        rowButtons[c].appendChild(strip);
      }

      pack.appendChild(rowEl);
      frag.appendChild(pack);
    }

    els.shell.replaceChildren(frag);
  }

  els.btnPrev.addEventListener("click", function () {
    state.viewMonth--;
    if (state.viewMonth < 0) {
      state.viewMonth = 11;
      state.viewYear--;
    }
    refreshUi();
  });

  els.btnNext.addEventListener("click", function () {
    state.viewMonth++;
    if (state.viewMonth > 11) {
      state.viewMonth = 0;
      state.viewYear++;
    }
    refreshUi();
  });

  els.btnToday.addEventListener("click", function () {
    var t = new Date();
    state.viewYear = t.getFullYear();
    state.viewMonth = t.getMonth();
    var key = toKey(t.getFullYear(), t.getMonth(), t.getDate());
    selectedDates = Object.create(null);
    selectedDates[key] = true;
    focusDate = key;
    refreshUi();
  });

  els.memoForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var memo = String(els.memoInput.value || "").trim();
    if (!memo) return;

    var targets = getTargetsForMemo();
    if (targets.length === 0) return;

    var color = String(els.hiddenColor.value || DEFAULT_HIGHLIGHT).trim();
    if (!/^#[0-9A-Fa-f]{6}$/.test(color)) color = DEFAULT_HIGHLIGHT;

    var lineId =
      Date.now() + "-" + Math.random().toString(36).slice(2, 10);

    var map = JSON.parse(JSON.stringify(readAll()));
    targets.forEach(function (key) {
      var list = Array.isArray(map[key]) ? map[key].slice() : [];
      list.push({
        id:
          lineId +
          "-" +
          key +
          "-" +
          Math.random().toString(36).slice(2, 6),
        lineId: lineId,
        title: memo,
        summary: "",
        time: "",
        color: color,
        done: false,
      });
      map[key] = list;
    });

    els.memoInput.value = "";
    focusDate = targets[targets.length - 1];
    selectedDates = Object.create(null);
    if (multiSelectMode) {
      targets.forEach(function (k) {
        selectedDates[k] = true;
      });
    } else if (focusDate) {
      selectedDates[focusDate] = true;
    }
    writeAll(map);
  });

  document.querySelectorAll(".color-chip").forEach(function (chip) {
    chip.addEventListener("click", function () {
      var col = chip.getAttribute("data-color") || DEFAULT_HIGHLIGHT;
      els.hiddenColor.value = col;
      document.querySelectorAll(".color-chip").forEach(function (c) {
        c.classList.remove("color-chip--active");
        c.setAttribute("aria-pressed", "false");
      });
      chip.classList.add("color-chip--active");
      chip.setAttribute("aria-pressed", "true");
    });
  });

  initMultiSelectControl();
  initPeriodPicker();
  initScopeModal();

  eventsCache = loadLocalObject();
  refreshUi();

  if (!SYNC_URL) {
    setSyncStatus();
  } else {
    setSyncStatus("loading");
    pullRemote();
    setInterval(pullRemote, 45000);
  }
})();
