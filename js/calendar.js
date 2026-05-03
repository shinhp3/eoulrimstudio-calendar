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

  /** @type {{ viewYear: number, viewMonth: number, selected: string | null }} */
  var state = {
    viewYear: new Date().getFullYear(),
    viewMonth: new Date().getMonth(),
    selected: null,
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
    renderGrid();
    renderDetail();
    schedulePush();
  }

  function normalizeEvent(ev, i) {
    if (!ev || typeof ev !== "object") return null;
    var title = String(ev.title || "").trim();
    if (!title) return null;
    var summary = String(ev.summary || "").trim();
    var c = String(ev.color || "").trim();
    if (!/^#[0-9A-Fa-f]{6}$/.test(c)) c = DEFAULT_HIGHLIGHT;
    return {
      id:
        typeof ev.id === "string"
          ? ev.id
          : "legacy-" + i + "-" + title + "-" + String(ev.time || ""),
      title: title,
      summary: summary,
      time: ev.time ? String(ev.time) : "",
      color: c,
      done: !!ev.done,
    };
  }

  function getEventsForDay(key) {
    var all = readAll();
    var list = all[key];
    if (!Array.isArray(list)) return [];
    return list.map(normalizeEvent).filter(Boolean);
  }

  function setEventsForDay(key, list) {
    var map = JSON.parse(JSON.stringify(readAll()));
    if (list.length === 0) delete map[key];
    else map[key] = list;
    writeAll(map);
  }

  function sortEventsForDisplay(list) {
    return list.slice().sort(function (a, b) {
      if (!!a.done !== !!b.done) return a.done ? 1 : -1;
      var ta = a.time || "";
      var tb = b.time || "";
      return ta.localeCompare(tb);
    });
  }

  function formatSelectedLabel(key) {
    if (!key) return "날짜를 선택하세요";
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
      ")"
    );
  }

  function truncate(str, max) {
    if (str.length <= max) return str;
    return str.slice(0, Math.max(0, max - 1)) + "…";
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

  var els = {
    grid: document.getElementById("calendarGrid"),
    viewYearLabel: document.getElementById("viewYearLabel"),
    viewMonthLabel: document.getElementById("viewMonthLabel"),
    btnPrev: document.getElementById("btnPrev"),
    btnNext: document.getElementById("btnNext"),
    btnToday: document.getElementById("btnToday"),
    btnSync: document.getElementById("btnSync"),
    syncStatus: document.getElementById("syncStatus"),
    selectedDateLabel: document.getElementById("selectedDateLabel"),
    eventForm: document.getElementById("eventForm"),
    eventList: document.getElementById("eventList"),
    eventEmpty: document.getElementById("eventEmpty"),
  };

  function setSyncStatus(mode) {
    if (!els.syncStatus) return;
    if (!SYNC_URL) {
      els.syncStatus.textContent = "동기화 없음 · 이 기기에만 저장";
      return;
    }
    if (mode === "server") {
      els.syncStatus.textContent =
        "서버 동기화 · 같은 주소를 연 사람과 목록이 같습니다";
    } else if (mode === "loading") {
      els.syncStatus.textContent = "서버에서 불러오는 중…";
    } else {
      els.syncStatus.textContent =
        "서버와 연결되지 않음 · 로컬만 저장 (동기화 버튼으로 재시도)";
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
      renderGrid();
      renderDetail();
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
    }, 700);
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

  function renderGrid() {
    var y = state.viewYear;
    var m = state.viewMonth;
    els.viewYearLabel.textContent = String(y);
    els.viewMonthLabel.textContent = m + 1 + "월";
    els.viewMonthLabel.setAttribute("datetime", y + "-" + pad(m + 1) + "-01");

    var cells = buildMonthCells(y, m);
    var frag = document.createDocumentFragment();
    var all = readAll();

    cells.forEach(function (cell) {
      var key = toKey(cell.y, cell.m, cell.d);
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "grid__cell";
      btn.setAttribute("role", "gridcell");
      btn.dataset.date = key;

      if (cell.outside) btn.classList.add("grid__cell--outside");

      var wd = new Date(cell.y, cell.m, cell.d).getDay();
      if (wd === 0) btn.classList.add("grid__cell--sun");
      if (wd === 6) btn.classList.add("grid__cell--sat");

      if (!cell.outside && isToday(cell.y, cell.m, cell.d)) {
        btn.classList.add("grid__cell--today");
      }

      if (state.selected === key) btn.classList.add("grid__cell--selected");

      var num = document.createElement("span");
      num.className = "grid__cell-num";
      num.textContent = String(cell.d);
      btn.appendChild(num);

      var rawList = all[key] || [];
      var normalizedCell = Array.isArray(rawList)
        ? rawList.map(normalizeEvent).filter(Boolean)
        : [];
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
          line.className =
            "grid__summary-line" +
            (ev.done ? " grid__summary-line--done" : "");
          line.textContent = truncate(ev.summary || ev.title, 18);
          line.title = ev.title + (ev.time ? " · " + ev.time : "");
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

        var hl = document.createElement("div");
        hl.className = "grid__cell-highlights";
        var maxBars = 8;
        sorted.slice(0, maxBars).forEach(function (ev) {
          var bar = document.createElement("span");
          bar.className =
            "grid__highlight-bar" +
            (ev.done ? " grid__highlight-bar--done" : "");
          bar.style.backgroundColor = ev.color;
          hl.appendChild(bar);
        });
        if (sorted.length > maxBars) {
          var tailBar = document.createElement("span");
          tailBar.className = "grid__highlight-bar grid__highlight-bar--more";
          tailBar.textContent = "+" + (sorted.length - maxBars);
          hl.appendChild(tailBar);
        }
        btn.appendChild(hl);
      }

      if (!cell.outside) {
        btn.addEventListener("click", function () {
          state.selected = key;
          renderGrid();
          renderDetail();
        });
      } else {
        btn.tabIndex = -1;
        btn.setAttribute("aria-hidden", "true");
      }

      frag.appendChild(btn);
    });

    els.grid.replaceChildren(frag);
  }

  function renderDetail() {
    els.selectedDateLabel.textContent = formatSelectedLabel(state.selected);
    els.eventList.innerHTML = "";

    if (!state.selected) {
      els.eventEmpty.textContent =
        "달력에서 날짜를 선택하면 할 일을 추가할 수 있습니다.";
      els.eventEmpty.classList.remove("is-hidden");
      els.eventForm.querySelector("[name=title]").disabled = true;
      els.eventForm.querySelector("[name=summary]").disabled = true;
      els.eventForm.querySelector("[name=time]").disabled = true;
      els.eventForm.querySelectorAll('input[name="color"]').forEach(function (r) {
        r.disabled = true;
      });
      els.eventForm.querySelector("button[type=submit]").disabled = true;
      return;
    }

    els.eventForm.querySelector("[name=title]").disabled = false;
    els.eventForm.querySelector("[name=summary]").disabled = false;
    els.eventForm.querySelector("[name=time]").disabled = false;
    els.eventForm.querySelectorAll('input[name="color"]').forEach(function (r) {
      r.disabled = false;
    });
    els.eventForm.querySelector("button[type=submit]").disabled = false;

    var items = sortEventsForDisplay(getEventsForDay(state.selected));
    if (items.length === 0) {
      els.eventEmpty.textContent = "등록된 할 일이 없습니다.";
      els.eventEmpty.classList.remove("is-hidden");
      return;
    }

    els.eventEmpty.classList.add("is-hidden");

    items.forEach(function (ev) {
      var li = document.createElement("li");
      li.className =
        "event-item" + (ev.done ? " event-item--done" : "");

      var mark = document.createElement("label");
      mark.className = "event-item__check";
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !!ev.done;
      cb.title = "완료 표시";
      cb.addEventListener("change", function () {
        var list = getEventsForDay(state.selected);
        var next = list.map(function (x) {
          if (x.id !== ev.id) return x;
          return Object.assign({}, x, { done: cb.checked });
        });
        setEventsForDay(state.selected, next);
      });
      mark.appendChild(cb);

      var stripe = document.createElement("span");
      stripe.className = "event-item__stripe";
      stripe.style.backgroundColor = ev.color;

      var body = document.createElement("div");
      body.className = "event-item__body";
      var h = document.createElement("p");
      h.className = "event-item__title";
      h.textContent = ev.title;
      body.appendChild(h);
      var sum = document.createElement("p");
      sum.className = "event-item__summary";
      if (ev.summary) {
        sum.textContent = ev.summary;
        body.appendChild(sum);
      }
      if (ev.time) {
        var t = document.createElement("p");
        t.className = "event-item__time";
        t.textContent = ev.time;
        body.appendChild(t);
      }

      var del = document.createElement("button");
      del.type = "button";
      del.className = "btn btn--danger";
      del.textContent = "삭제";
      del.addEventListener("click", function () {
        var list = getEventsForDay(state.selected).filter(function (x) {
          return x.id !== ev.id;
        });
        setEventsForDay(state.selected, list);
      });

      var row = document.createElement("div");
      row.className = "event-item__row";
      row.appendChild(mark);
      row.appendChild(stripe);
      row.appendChild(body);
      row.appendChild(del);

      li.appendChild(row);
      els.eventList.appendChild(li);
    });
  }

  els.btnPrev.addEventListener("click", function () {
    state.viewMonth--;
    if (state.viewMonth < 0) {
      state.viewMonth = 11;
      state.viewYear--;
    }
    renderGrid();
  });

  els.btnNext.addEventListener("click", function () {
    state.viewMonth++;
    if (state.viewMonth > 11) {
      state.viewMonth = 0;
      state.viewYear++;
    }
    renderGrid();
  });

  els.btnToday.addEventListener("click", function () {
    var t = new Date();
    state.viewYear = t.getFullYear();
    state.viewMonth = t.getMonth();
    state.selected = toKey(t.getFullYear(), t.getMonth(), t.getDate());
    renderGrid();
    renderDetail();
  });

  els.btnSync.addEventListener("click", function () {
    pullRemote().then(function () {
      return pushRemote();
    });
  });

  els.eventForm.addEventListener("submit", function (e) {
    e.preventDefault();
    if (!state.selected) return;
    var fd = new FormData(els.eventForm);
    var title = String(fd.get("title") || "").trim();
    var summary = String(fd.get("summary") || "").trim();
    var time = String(fd.get("time") || "").trim();
    var color = String(fd.get("color") || DEFAULT_HIGHLIGHT).trim();
    if (!/^#[0-9A-Fa-f]{6}$/.test(color)) color = DEFAULT_HIGHLIGHT;
    if (!title) return;

    var list = getEventsForDay(state.selected);
    list.push({
      id: Date.now() + "-" + Math.random().toString(36).slice(2, 8),
      title: title,
      summary: summary,
      time: time || "",
      color: color,
      done: false,
    });
    setEventsForDay(state.selected, list);
    els.eventForm.reset();
    var firstColor = els.eventForm.querySelector(
      'input[name="color"][value="' + DEFAULT_HIGHLIGHT + '"]'
    );
    if (firstColor) firstColor.checked = true;
  });

  eventsCache = loadLocalObject();
  renderGrid();
  renderDetail();

  if (!SYNC_URL) {
    setSyncStatus();
    if (els.btnSync) els.btnSync.hidden = true;
  } else {
    setSyncStatus("loading");
    pullRemote();
    setInterval(pullRemote, 45000);
  }
})();
