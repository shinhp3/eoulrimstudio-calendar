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

  function deleteLine(lineId) {
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

  function truncate(str, max) {
    if (str.length <= max) return str;
    return str.slice(0, Math.max(0, max - 1)) + "…";
  }

  function sortEventsForDisplay(list) {
    return list.slice().sort(function (a, b) {
      return (a.title || "").localeCompare(b.title || "", "ko");
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

  /** 같은 주에서 선택만 되어 있고 칸 번호가 연속일 때 막대 하나로 묶음 */
  function computeSelectionRuns(rowCells) {
    var cols = [];
    rowCells.forEach(function (rc) {
      if (rc.outside) return;
      if (!selectedDates[rc.key]) return;
      cols.push(rc.col);
    });
    cols = cols
      .filter(function (v, i, a) {
        return a.indexOf(v) === i;
      })
      .sort(function (a, b) {
        return a - b;
      });
    var runs = [];
    var i = 0;
    while (i < cols.length) {
      var start = cols[i];
      var j = i;
      while (j + 1 < cols.length && cols[j + 1] === cols[j] + 1) j++;
      runs.push({
        startCol: start,
        spanCols: cols[j] - start + 1,
      });
      i = j + 1;
    }
    return runs;
  }

  var els = {
    shell: document.getElementById("calendarGridShell"),
    viewPeriodLabel: document.getElementById("viewPeriodLabel"),
    btnPrev: document.getElementById("btnPrev"),
    btnNext: document.getElementById("btnNext"),
    btnToday: document.getElementById("btnToday"),
    syncStatus: document.getElementById("syncStatus"),
    dayMemoDateLabel: document.getElementById("dayMemoDateLabel"),
    dayMemoList: document.getElementById("dayMemoList"),
    dayMemoEmpty: document.getElementById("dayMemoEmpty"),
    selectionSummary: document.getElementById("selectionSummary"),
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
    } else {
      els.syncStatus.textContent =
        "서버와 연결되지 않았습니다. 변경은 로컬에만 저장되며 곧 다시 동기화합니다.";
    }
  }

  async function pullRemote() {
    if (!SYNC_URL) return;
    setSyncStatus("loading");
    try {
      var res = await fetch(SYNC_URL, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      var data = await res.json();
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
      if (!res.ok) throw new Error(String(res.status));
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

  function formatFocusHeading(key) {
    var p = parseKey(key);
    var dt = new Date(p.y, p.m, p.d);
    var w = ["일", "월", "화", "수", "목", "금", "토"][dt.getDay()];
    return (
      p.y +
      "년 " +
      (p.m + 1) +
      "월 " +
      p.d +
      "일 (" +
      w +
      ") 메모"
    );
  }

  function refreshUi() {
    renderPeriod();
    renderGrid();
    renderDayMemosPanel();
    renderSelectionSummary();
    syncMemoFormState();
  }

  function renderPeriod() {
    var y = state.viewYear;
    var m = state.viewMonth;
    els.viewPeriodLabel.textContent = y + "년 " + (m + 1) + "월";
  }

  function renderSelectionSummary() {
    var keys = Object.keys(selectedDates).filter(function (k) {
      return selectedDates[k];
    });
    var lines = [];
    if (keys.length > 0) {
      lines.push("선택된 날짜 " + keys.length + "일 · 추가하면 모두에 같은 줄로 표시됩니다.");
    } else {
      lines.push("날짜를 클릭할 때마다 선택이 더해지거나 빠집니다. 한 줄에서 붙어 있는 날은 아래 막대도 이어집니다.");
    }
    if (focusDate) {
      lines.push("포커스: " + formatFocusHeading(focusDate).replace(" 메모", ""));
    }
    els.selectionSummary.textContent = lines.join(" ");
  }

  function syncMemoFormState() {
    var ok = getTargetsForMemo().length > 0;
    els.memoInput.disabled = !ok;
    els.memoForm.querySelector(".btn--primary").disabled = !ok;
    els.memoForm.querySelectorAll(".color-chip").forEach(function (btn) {
      btn.disabled = !ok;
    });
  }

  function renderDayMemosPanel() {
    els.dayMemoList.innerHTML = "";

    if (!focusDate) {
      els.dayMemoDateLabel.textContent = "";
      els.dayMemoEmpty.textContent =
        "달력에서 날짜를 눌러 메모를 확인하세요.";
      els.dayMemoEmpty.classList.remove("is-hidden");
      return;
    }

    els.dayMemoDateLabel.textContent = formatFocusHeading(focusDate).replace(
      " 메모",
      ""
    );

    var items = sortEventsForDisplay(
      normalizedListForKey(focusDate, readAll())
    );

    if (items.length === 0) {
      els.dayMemoEmpty.textContent = "이 날짜에는 메모가 없습니다.";
      els.dayMemoEmpty.classList.remove("is-hidden");
      return;
    }

    els.dayMemoEmpty.classList.add("is-hidden");

    items.forEach(function (ev) {
      var li = document.createElement("li");
      li.className = "day-memo-item";

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
      del.addEventListener("click", function () {
        deleteLine(ev.lineId);
      });

      row.appendChild(stripe);
      row.appendChild(body);
      row.appendChild(del);

      li.appendChild(row);
      els.dayMemoList.appendChild(li);
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

      var streakLayer = document.createElement("div");
      streakLayer.className = "calendar-week-pack__streaks";
      streakLayer.setAttribute("aria-hidden", "true");

      var rowCells = [];

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

        var normalizedCell = normalizedListForKey(key, all);
        var sorted = sortEventsForDisplay(normalizedCell);

        if (sorted.length > 0 && !cell.outside) {
          btn.classList.add("grid__cell--has-items");

          var bodyWrap = document.createElement("div");
          bodyWrap.className = "grid__cell-body";

          var sums = document.createElement("div");
          sums.className = "grid__cell-summaries";
          var maxLines = 4;
          sorted.slice(0, maxLines).forEach(function (ev) {
            var line = document.createElement("span");
            line.className = "grid__summary-line";
            line.textContent = truncate(ev.summary || ev.title, 20);
            line.title = ev.title;
            sums.appendChild(line);
          });
          if (sorted.length > maxLines) {
            var moreSum = document.createElement("span");
            moreSum.className = "grid__summary-more";
            moreSum.textContent = "+" + (sorted.length - maxLines);
            sums.appendChild(moreSum);
          }
          bodyWrap.appendChild(sums);
          btn.appendChild(bodyWrap);
        }

        if (!cell.outside) {
          btn.addEventListener("click", function () {
            toggleSelected(key);
            focusDate = key;
            refreshUi();
          });
        } else {
          btn.tabIndex = -1;
          btn.setAttribute("aria-hidden", "true");
        }

        rowEl.appendChild(btn);
      }

      computeSelectionRuns(rowCells).forEach(function (run) {
        var selSeg = document.createElement("span");
        selSeg.className =
          "calendar-streak-segment calendar-streak-segment--selection";
        selSeg.style.gridColumn =
          run.startCol + 1 + " / span " + run.spanCols;
        streakLayer.appendChild(selSeg);
      });

      var runs = computeStreakRuns(rowCells, all);
      runs.forEach(function (run) {
        var seg = document.createElement("span");
        seg.className =
          "calendar-streak-segment" +
          (run.done ? " calendar-streak-segment--done" : "");
        seg.style.gridColumn = run.startCol + 1 + " / span " + run.spanCols;
        seg.style.backgroundColor = run.color;
        streakLayer.appendChild(seg);
      });

      pack.appendChild(rowEl);
      pack.appendChild(streakLayer);
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
