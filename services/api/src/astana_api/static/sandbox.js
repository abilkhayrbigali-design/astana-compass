"use strict";

(() => {
  const TIMEZONE = "Asia/Almaty";
  const $ = (id) => document.getElementById(id);
  const form = $("request-form");
  const state = {
    mode: null, syntheticSeen: false, lastRequest: null, dirty: true,
    places: new Map(), recommendations: [], selected: [], selectButtons: new Map(),
    recommendBusy: false, itineraryBusy: false, recommendVersion: 0,
    itineraryVersion: 0, recommendController: null, itineraryController: null,
  };
  const FACT_NAMES = new Map([
    ["indoor", "В помещении"], ["wheelchair_accessible", "Доступность на коляске"],
    ["child_friendly", "Подходит для детей"], ["free_entry", "Бесплатный вход"],
    ["open_at_requested_time", "Работа в выбранное время"], ["quiet", "Тихое место"],
    ["has_wifi", "Wi-Fi"], ["has_power_outlets", "Розетки"],
    ["visit_duration_seconds", "Время посещения, секунды"],
  ]);
  const STATUS_NAMES = new Map([
    ["matched", "Подходит"], ["partial", "С оговорками"],
    ["no_match", "Нет подходящих вариантов"], ["needs_clarification", "Нужно уточнение"],
  ]);
  const ERROR_NAMES = new Map([
    ["unsupported_transport", "Этот способ передвижения пока не поддерживается. Выберите «Пешком»."],
    ["provider_unavailable", "Сервис пока не готов. Проверьте состояние API выше и попробуйте снова."],
    ["rate_limited", "API занят. Повторите запрос чуть позже."],
    ["invalid_request", "API не принял параметры. Проверьте поля и подробности ответа."],
    ["not_found", "Объект не найден в текущем каталоге."],
    ["internal_error", "API не смог выполнить запрос. Подробности доступны в JSON ответа."],
  ]);
  const PRESETS = {
    indoor: { query: "Хочу провести час в помещении и немного отдохнуть.", budget: 60, indoor: "required", wheelchair: "none", transport: "walking", note: "В fixture ожидаются варианты с подтверждённым indoor=true. Нажмите «Получить варианты»." },
    accessibility: { query: "Нужно место, доступное на коляске.", budget: 60, indoor: "none", wheelchair: "required", transport: "walking", note: "Проверка: неизвестная доступность не должна проходить как выполненное обязательное условие." },
    short: { query: "У меня только одна минута на прогулку.", budget: 1, indoor: "none", wheelchair: "none", transport: "walking", note: "В fixture ожидается пустая выдача: дорога и посещение должны поместиться в одну минуту." },
    transport: { query: "Хочу посмотреть места поблизости на велосипеде.", budget: 60, indoor: "none", wheelchair: "none", transport: "cycling", note: "Ожидается ошибка unsupported_transport. API не должен незаметно заменить велосипед ходьбой." },
  };

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined && text !== null) element.textContent = String(text);
    return element;
  }

  function list(value) { return Array.isArray(value) ? value : []; }
  function text(value) { return typeof value === "string" ? value : ""; }
  function validSeconds(value) { return Number.isInteger(value) && value >= 0; }
  function factName(key) { return FACT_NAMES.get(key) || String(key); }
  function duration(value) {
    if (!Number.isFinite(value) || value < 0) return "нет данных";
    if (value < 60) return `${Math.ceil(value)} с`;
    const minutes = Math.ceil(value / 60);
    return minutes >= 60 ? `${Math.floor(minutes / 60)} ч${minutes % 60 ? ` ${minutes % 60} мин` : ""}` : `${minutes} мин`;
  }
  function distance(value) {
    if (!Number.isFinite(value) || value < 0) return "нет данных";
    return value < 1000 ? `${Math.round(value)} м` : `${new Intl.NumberFormat("ru", { maximumFractionDigits: 1 }).format(value / 1000)} км`;
  }
  function dateParts(date) {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    });
    return Object.fromEntries(formatter.formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  }
  function localDateTime(date) {
    const part = dateParts(date);
    return `${part.year}-${part.month}-${part.day}T${part.hour}:${part.minute}`;
  }
  function zonedISO(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
    if (!match) throw new Error("Укажите дату и время начала прогулки.");
    const [, year, month, day, hour, minute] = match.map(Number);
    const target = Date.UTC(year, month - 1, day, hour, minute);
    let instant = target;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const shown = dateParts(new Date(instant));
      const shifted = Date.UTC(Number(shown.year), Number(shown.month) - 1, Number(shown.day), Number(shown.hour), Number(shown.minute), Number(shown.second));
      instant += target - shifted;
    }
    if (!Number.isFinite(instant) || localDateTime(new Date(instant)) !== value) {
      throw new Error("Проверьте дату и время для Asia/Almaty.");
    }
    return new Date(instant).toISOString();
  }
  function readableDate(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "дата неизвестна";
    return new Intl.DateTimeFormat("ru", { timeZone: TIMEZONE, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
  }

  function updateMode(header, data) {
    const normalized = header === "fixture" || header === "live" ? header : "unknown";
    if (Array.isArray(data?.places)) state.syntheticSeen = data.places.some((place) => place?.is_synthetic === true);
    const display = normalized === "live" && state.syntheticSeen ? "synthetic-in-live" : normalized;
    if (state.mode === display) return;
    state.mode = display;
    const banner = $("data-banner");
    banner.className = "data-banner";
    if (display === "fixture") {
      $("mode-pill").textContent = "Режим: fixture";
      $("banner-title").textContent = "Тестовые данные — искусственные места";
      $("banner-copy").textContent = "Это проверка интеграции. Точки не являются реальными рекомендациями по Астане. Поиск fixture учитывает расстояние и фильтры, но игнорирует смысл текста запроса; путь рассчитан приблизительно.";
    } else if (display === "live") {
      banner.classList.add("banner-live");
      $("mode-pill").textContent = "Режим: live";
      $("banner-title").textContent = "Подключён режим live";
      $("banner-copy").textContent = "API использует подключённые сервисы и каталог. Для каждой рекомендации проверяйте источники, неизвестные факты и способ расчёта пути ниже.";
    } else if (display === "synthetic-in-live") {
      $("mode-pill").textContent = "Live · синтетический ответ";
      $("banner-title").textContent = "В ответе есть синтетические места";
      $("banner-copy").textContent = "Заголовок сообщает live, но объекты отмечены is_synthetic. Эти результаты нельзя считать реальными городскими рекомендациями. Посмотрите JSON ответа.";
    } else {
      banner.classList.add("banner-pending");
      $("mode-pill").textContent = "Режим: не указан";
      $("banner-title").textContent = "API не указал режим данных";
      $("banner-copy").textContent = "В ответе нет распознанного заголовка X-Astana-Data-Mode. Статус происхождения данных пока не подтверждён; подробности ответа доступны ниже.";
    }
  }

  async function api(path, body, signal) {
    const started = performance.now();
    const response = await fetch(path, {
      method: body === undefined ? "GET" : "POST", cache: "no-store",
      credentials: "same-origin", signal,
      headers: body === undefined ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const raw = await response.text();
    let data;
    try { data = JSON.parse(raw); } catch { data = { unparsed_body: raw }; }
    const result = {
      data, httpStatus: response.status, mode: response.headers.get("X-Astana-Data-Mode"),
      requestId: response.headers.get("X-Request-ID"), elapsed: Math.round(performance.now() - started),
    };
    updateMode(result.mode, data);
    if (!response.ok) {
      const error = new Error(ERROR_NAMES.get(data?.error?.code) || `API вернул HTTP ${response.status}.`);
      error.result = result;
      throw error;
    }
    if (!data || typeof data !== "object" || Array.isArray(data) || Object.hasOwn(data, "unparsed_body")) {
      const error = new Error("API вернул ответ, который не удалось прочитать как JSON-объект.");
      error.result = result;
      throw error;
    }
    return result;
  }

  function debug(prefix, path, request, result) {
    $(`${prefix}-debug`).hidden = false;
    $(`${prefix}-request`).textContent = JSON.stringify(request, null, 2);
    $(`${prefix}-response`).textContent = JSON.stringify(result?.data ?? { error: "HTTP-ответ не получен" }, null, 2);
    $(`${prefix}-http`).textContent = `POST ${path} · ${result ? `HTTP ${result.httpStatus} · ${result.elapsed} мс` : "ошибка соединения"} · X-Astana-Data-Mode: ${result?.mode || "не указан"}${result?.requestId ? ` · Request ID: ${result.requestId}` : ""}`;
  }

  function showEmpty(container, title, description, endpoint) {
    const block = node("div", "empty-state");
    block.append(node("span", "empty-mark", "↗"), node("h3", "", title), node("p", "", description));
    if (endpoint) block.append(node("span", "empty-endpoint", endpoint));
    container.replaceChildren(block);
  }
  function showError(container, error) {
    const block = node("div", "error-box");
    block.setAttribute("role", "alert");
    block.append(node("h3", "", "Запрос не выполнен"), node("p", "", error.message || "Не удалось связаться с API. Проверьте, что приложение запущено."));
    const detail = error.result?.data?.error;
    if (detail?.code) block.append(node("p", "evidence-refs", `Код: ${detail.code}`));
    for (const entry of list(detail?.details)) block.append(node("p", "", `${text(entry.field)}: ${text(entry.issue)}`));
    container.replaceChildren(block);
  }
  function warnings(values) {
    const items = [...new Set(list(values).filter((value) => typeof value === "string" && value))];
    if (!items.length) return null;
    const ul = node("ul", "warning-list");
    for (const warning of items) {
      const translated = warning === "SYNTHETIC: integration fixtures only; not real city recommendations."
        ? "Синтетические данные: это проверка интеграции, а не реальные городские рекомендации."
        : warning === "Fixture retrieval ignores semantic query intent."
          ? "Тестовый поиск игнорирует смысл запроса. Явные фильтры проверяются отдельно."
          : warning;
      ul.append(node("li", "", translated));
    }
    return ul;
  }
  function appendWarnings(container, values) {
    const element = warnings(values);
    if (element) container.append(element);
  }
  function badge(label, tone = "") { return node("span", `state-tag ${tone}`.trim(), label); }
  function constraints(evaluations) {
    const ul = node("ul", "constraint-list");
    for (const evaluation of list(evaluations)) {
      const li = node("li");
      const heading = node("div", "constraint-heading");
      heading.append(node("strong", "", factName(evaluation.key)));
      heading.append(node("span", "muted", evaluation.strength === "required" ? "· обязательно" : "· желательно"));
      const outcome = evaluation.outcome;
      heading.append(badge(outcome === "satisfied" ? "Подтверждено" : outcome === "unsatisfied" ? "Не выполнено" : "Неизвестно", outcome === "satisfied" ? "tag-success" : "tag-warning"));
      li.append(heading, node("p", "", evaluation.explanation));
      if (list(evaluation.evidence_ids).length) li.append(node("div", "evidence-refs", `Свидетельства: ${evaluation.evidence_ids.join(", ")}`));
      ul.append(li);
    }
    return ul;
  }
  function sources(evidence) {
    const ul = node("ul", "source-list");
    for (const item of list(evidence)) {
      const li = node("li");
      li.append(node("strong", "", item.source_name || "Источник без названия"));
      li.append(node("span", "source-url", item.source_url));
      li.append(node("span", "", `${item.is_synthetic ? "Синтетический · " : ""}ID: ${item.id} · получено ${readableDate(item.retrieved_at)}`));
      ul.append(li);
    }
    return ul;
  }
  function facts(place, route) {
    const details = node("details", "facts-disclosure");
    details.append(node("summary", "", "Факты и источники"));
    const content = node("div", "facts-content");
    const ul = node("ul", "fact-list");
    for (const fact of list(place.facts)) {
      const li = node("li");
      li.append(node("strong", "", factName(fact.key)));
      if (fact.status === "known") {
        const value = fact.value === true ? "да" : fact.value === false ? "нет" : JSON.stringify(fact.value);
        li.append(node("span", "", `: ${value}`), badge("По источнику", "tag-success"));
      } else {
        li.append(badge(fact.status === "conflicting" ? "Источники расходятся" : "Нет данных", "tag-warning"));
      }
      if (fact.note) li.append(node("p", "muted", fact.note));
      if (list(fact.evidence_ids).length) li.append(node("div", "evidence-refs", fact.evidence_ids.join(", ")));
      ul.append(li);
    }
    if (ul.childElementCount) content.append(ul);
    else content.append(node("p", "muted", "Дополнительных подтверждённых фактов нет."));
    content.append(sources(place.evidence));
    if (route && list(route.evidence).length) {
      content.append(node("p", "form-note", "Основание расчёта пути"), sources(route.evidence));
    }
    details.append(content);
    return details;
  }
  function timing(total, travel, visit, budget) {
    const box = node("div");
    const row = node("div", "timing-row");
    row.append(node("span", "", `В пути: ${duration(travel)}`), node("span", "", `Посещение: ≈ ${duration(visit)}`));
    const labels = node("div", "budget-line");
    labels.append(node("strong", "", `План: ≈ ${duration(total)}`), node("span", "muted", `из ${duration(budget)}`));
    const progress = node("progress");
    progress.max = budget;
    progress.value = Math.min(total, budget);
    progress.setAttribute("aria-label", `План ${duration(total)} из доступных ${duration(budget)}`);
    box.append(row, labels, progress);
    return box;
  }
  function routeNote(route) {
    const note = node("div", "route-note");
    if (route?.method === "approximate") {
      note.append(node("p", "", "Приблизительная оценка: реальный пеший путь не построен, геометрии маршрута нет. Уличные барьеры и доступность проходов не проверены."));
    } else {
      note.append(node("p", "", `Путь рассчитан провайдером ${text(route?.provider)}. ${distance(route?.distance_meters)}.`));
    }
    note.append(node("p", "", `${route?.includes_return ? "Возвращение к старту включено." : "Возвращение к старту не включено."} Дистанция: ${distance(route?.distance_meters)}.`));
    if (list(route?.assumptions).length) {
      const details = node("details");
      details.append(node("summary", "", "Допущения расчёта"));
      for (const assumption of route.assumptions) details.append(node("p", "", assumption));
      note.append(details);
    }
    return note;
  }

  function readRequest() {
    if (!form.reportValidity()) return null;
    const query = $("query").value.trim();
    const minutes = Number($("budget").value);
    const lat = Number($("latitude").value), lon = Number($("longitude").value);
    if (!query) throw new Error("Введите короткое описание прогулки.");
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) throw new Error("Укажите от 1 до 1440 целых минут.");
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new Error("Проверьте широту и долготу точки старта.");
    const requestedConstraints = [];
    for (const [id, key] of [["indoor", "indoor"], ["wheelchair", "wheelchair_accessible"]]) {
      const strength = $(id).value;
      if (strength === "required" || strength === "preferred") requestedConstraints.push({ key, value: true, strength });
    }
    return {
      query, locale: $("locale").value, origin: { lat, lon },
      start_at: zonedISO($("start-at").value), timezone: TIMEZONE,
      available_seconds: minutes * 60, transport: $("transport").value,
      return_to_origin: $("return-to-origin").checked, constraints: requestedConstraints, limit: 3,
    };
  }
  function setFormError(message) {
    $("form-error").hidden = !message;
    $("form-error").textContent = message || "";
  }
  function updateButtons() {
    $("recommend-button").disabled = state.recommendBusy;
    $("recommend-button").firstElementChild.textContent = state.recommendBusy ? "Получаем варианты…" : "Получить варианты";
    $("itinerary-button").disabled = state.itineraryBusy || state.recommendBusy || state.dirty || !state.lastRequest || !state.selected.length;
    $("itinerary-button").firstElementChild.textContent = state.itineraryBusy ? "Проверяем весь маршрут…" : "Рассчитать выбранный маршрут";
    $("results-section").setAttribute("aria-busy", String(state.recommendBusy));
    $("itinerary-section").setAttribute("aria-busy", String(state.itineraryBusy));
    for (const [id, button] of state.selectButtons) {
      const selected = state.selected.includes(id);
      button.textContent = selected ? "✓ Выбрано" : "+ В маршрут";
      button.setAttribute("aria-pressed", String(selected));
      button.disabled = state.dirty || state.recommendBusy || (!selected && state.selected.length >= 3);
    }
  }
  function invalidateItinerary() {
    state.itineraryVersion += 1;
    state.itineraryController?.abort();
    state.itineraryController = null;
    state.itineraryBusy = false;
    $("itinerary-content").replaceChildren();
    $("itinerary-status").textContent = "";
    $("itinerary-debug").hidden = true;
    updateButtons();
  }
  function renderSelection(focusIndex) {
    const target = $("selected-list");
    target.replaceChildren();
    state.selected.forEach((id, index) => {
      const name = state.places.get(id)?.name || id;
      const li = node("li");
      li.tabIndex = -1;
      li.append(node("span", "stop-index", index + 1), node("span", "stop-name", name));
      const controls = node("div", "stop-controls");
      for (const [delta, label, symbol] of [[-1, "Поднять", "↑"], [1, "Опустить", "↓"]]) {
        const button = node("button", "", symbol);
        button.type = "button";
        button.setAttribute("aria-label", `${label} остановку «${name}»`);
        button.disabled = index + delta < 0 || index + delta >= state.selected.length;
        button.addEventListener("click", () => {
          [state.selected[index], state.selected[index + delta]] = [state.selected[index + delta], state.selected[index]];
          invalidateItinerary();
          renderSelection(index + delta);
        });
        controls.append(button);
      }
      const remove = node("button", "", "×");
      remove.type = "button";
      remove.setAttribute("aria-label", `Убрать остановку «${name}»`);
      remove.addEventListener("click", () => {
        state.selected = state.selected.filter((value) => value !== id);
        invalidateItinerary();
        renderSelection(Math.min(index, state.selected.length - 1));
      });
      controls.append(remove);
      li.append(controls);
      target.append(li);
    });
    $("selection-empty").hidden = state.selected.length > 0;
    $("selected-count").textContent = `${state.selected.length} / 3`;
    $("selection-note").textContent = state.dirty && state.lastRequest
      ? "Условия изменились. Получите новые варианты перед расчётом маршрута."
      : state.selected.length ? "API проверит все остановки в этом порядке и общий бюджет. Выбранные места не будут сокращены незаметно." : "";
    updateButtons();
    if (Number.isInteger(focusIndex) && focusIndex >= 0) target.children[focusIndex]?.focus();
  }
  function markChanged() {
    const wasLoading = state.recommendBusy;
    state.dirty = true;
    state.recommendVersion += 1;
    state.recommendController?.abort();
    state.recommendController = null;
    state.recommendBusy = false;
    invalidateItinerary();
    setFormError("");
    if (state.lastRequest || wasLoading) {
      $("results-state").textContent = "Условия изменены";
      $("recommend-status").textContent = "Нажмите «Получить варианты», чтобы проверить новые условия.";
      if (wasLoading) showEmpty($("results-content"), "Параметры обновлены", "Отправьте новый запрос, когда будете готовы.", "POST /v1/recommendations");
    }
    renderSelection();
  }

  function validateRecommendations(data, request) {
    if (!STATUS_NAMES.has(data.status) || !Array.isArray(data.recommendations) || !Array.isArray(data.places)) throw new Error("Ответ рекомендаций не соответствует ожидаемому контракту. Посмотрите JSON.");
    const found = new Map(data.places.map((place) => [place.id, place]));
    if (["no_match", "needs_clarification"].includes(data.status) && (data.recommendations.length || data.places.length)) throw new Error("Ошибка контракта: пустой статус содержит рекомендации.");
    if (data.recommendations.length > 3) throw new Error("Ошибка контракта: API вернул больше трёх вариантов.");
    const ids = new Set();
    for (const item of data.recommendations) {
      if (!found.has(item.place_id) || ids.has(item.place_id) || !item.route || !validSeconds(item.total_duration_seconds) || !validSeconds(item.visit_duration_seconds) || !validSeconds(item.route.duration_seconds) || item.total_duration_seconds !== item.visit_duration_seconds + item.route.duration_seconds || item.total_duration_seconds > request.available_seconds) throw new Error("Ошибка контракта: проверьте ссылки на места и временной бюджет в JSON ответа.");
      if (item.route.method === "approximate" && item.route.geometry !== null) throw new Error("Ошибка контракта: приблизительный путь содержит геометрию.");
      ids.add(item.place_id);
    }
    return found;
  }

  function renderRecommendations(data, request) {
    const target = $("results-content");
    target.replaceChildren();
    state.places = validateRecommendations(data, request);
    state.recommendations = data.recommendations;
    state.selectButtons.clear();
    $("results-state").textContent = STATUS_NAMES.get(data.status);
    $("results-state").className = `neutral-tag ${data.status === "matched" ? "tag-success" : "tag-warning"}`;
    $("response-context").hidden = false;
    $("response-context").textContent = `${duration(request.available_seconds)} · ${readableDate(request.start_at)} · Asia/Almaty · ${request.return_to_origin ? "с возвращением" : "без возвращения"}`;
    appendWarnings(target, data.warnings);
    if (!data.recommendations.length) {
      const empty = node("div");
      showEmpty(empty, data.status === "needs_clarification" ? "Уточните запрос" : "Подходящих вариантов нет", "Обязательные условия не ослаблены. Измените фильтры или запас времени и отправьте новый запрос.");
      for (const question of list(data.clarification_questions)) empty.append(node("p", "form-note", question));
      target.append(empty);
      return;
    }
    const cards = node("div", "result-list");
    for (const recommendation of data.recommendations) {
      const place = state.places.get(recommendation.place_id);
      const card = node("article", "place-card");
      const header = node("div", "card-heading");
      const heading = node("div");
      heading.append(node("p", "card-kicker", `ВАРИАНТ ${recommendation.rank}`), node("h3", "", place.name));
      const select = node("button", "secondary-button", "+ В маршрут");
      select.type = "button";
      select.setAttribute("aria-pressed", "false");
      select.setAttribute("aria-label", `Выбрать остановку «${place.name}»`);
      select.addEventListener("click", () => {
        if (state.dirty) return;
        if (state.selected.includes(place.id)) state.selected = state.selected.filter((id) => id !== place.id);
        else if (state.selected.length < 3) state.selected.push(place.id);
        invalidateItinerary();
        renderSelection();
      });
      state.selectButtons.set(place.id, select);
      header.append(heading, select);
      const tags = node("div", "card-tags");
      if (place.is_synthetic) tags.append(badge("Синтетическая точка", "tag-warning"));
      for (const category of list(place.categories)) tags.append(badge(category));
      card.append(header, tags, node("p", "card-why", recommendation.why));
      const activity = node("div", "activity-box");
      activity.append(node("strong", "", "Идея занятия · не факт о месте"), node("p", "", recommendation.suggested_activity));
      card.append(activity, timing(recommendation.total_duration_seconds, recommendation.route.duration_seconds, recommendation.visit_duration_seconds, request.available_seconds));
      card.append(routeNote(recommendation.route), constraints(recommendation.constraint_evaluations));
      appendWarnings(card, recommendation.warnings);
      card.append(facts(place, recommendation.route));
      cards.append(card);
    }
    target.append(cards);
    updateButtons();
  }

  async function recommend(event) {
    event.preventDefault();
    let request;
    try { request = readRequest(); } catch (error) { setFormError(error.message); return; }
    if (!request) return;
    setFormError("");
    state.recommendController?.abort();
    const controller = new AbortController();
    state.recommendController = controller;
    const version = ++state.recommendVersion;
    const timer = setTimeout(() => controller.abort(), 20000);
    state.recommendBusy = true;
    state.lastRequest = null;
    state.dirty = true;
    state.selected = [];
    state.selectButtons.clear();
    invalidateItinerary();
    renderSelection();
    $("recommend-debug").hidden = true;
    $("response-context").hidden = true;
    $("results-state").textContent = "Выполняем запрос";
    $("results-state").className = "neutral-tag";
    $("recommend-status").textContent = "Проверяем доступные места, ограничения и время…";
    showEmpty($("results-content"), "Получаем варианты", "Запрос отправлен в API приложения.", "POST /v1/recommendations");
    let receivedResult;
    try {
      const result = await api("/v1/recommendations", request, controller.signal);
      if (version !== state.recommendVersion) return;
      receivedResult = result;
      debug("recommend", "/v1/recommendations", request, result);
      renderRecommendations(result.data, request);
      state.lastRequest = request;
      state.dirty = false;
      $("recommend-status").textContent = `Получен ответ · ${result.elapsed} мс`;
    } catch (error) {
      if (version !== state.recommendVersion) return;
      state.lastRequest = null;
      state.dirty = true;
      state.selectButtons.clear();
      if (error.name === "AbortError") error = new Error("API не ответил за 20 секунд. Попробуйте ещё раз.");
      else if (error instanceof TypeError) error = new Error(receivedResult ? "Ответ рекомендаций не соответствует ожидаемому контракту. Посмотрите JSON." : "Не удалось связаться с API. Проверьте, что приложение запущено.");
      debug("recommend", "/v1/recommendations", request, error.result || receivedResult);
      showError($("results-content"), error);
      $("results-state").textContent = "Ошибка запроса";
      $("results-state").className = "neutral-tag tag-error";
      $("recommend-status").textContent = "Ответ можно проверить в JSON ниже.";
    } finally {
      clearTimeout(timer);
      if (version === state.recommendVersion) {
        state.recommendBusy = false;
        state.recommendController = null;
        renderSelection();
      }
    }
  }

  function renderItinerary(data, request) {
    const target = $("itinerary-content");
    target.replaceChildren();
    if (!STATUS_NAMES.has(data.status) || !Array.isArray(data.stops) || !Array.isArray(data.places)) throw new Error("Ответ маршрута не соответствует ожидаемому контракту. Посмотрите JSON.");
    if (["no_match", "needs_clarification"].includes(data.status)) {
      if (data.stops.length || data.places.length || data.route !== null) throw new Error("Ошибка контракта: неуспешный ответ содержит часть маршрута.");
      appendWarnings(target, data.warnings);
      const empty = node("div");
      showEmpty(empty, data.status === "needs_clarification" ? "Нужно уточнение" : "Маршрут не составлен", "Все выбранные остановки сохранены выше. Можно убрать остановку или проверить другие условия новым поиском.");
      for (const question of list(data.clarification_questions)) empty.append(node("p", "form-note", question));
      target.append(empty);
      return;
    }
    if (data.stops.length !== request.place_ids.length || data.stops.some((stop, index) => stop.place_id !== request.place_ids[index] || stop.order !== index + 1)) throw new Error("Ошибка контракта: API изменил состав или порядок выбранных остановок. Исходный выбор сохранён.");
    const places = new Map(data.places.map((place) => [place.id, place]));
    if (!data.route || !validSeconds(data.route.duration_seconds) || !validSeconds(data.total_duration_seconds) || data.stops.some((stop) => !places.has(stop.place_id) || !validSeconds(stop.visit_duration_seconds))) throw new Error("Ошибка контракта: в маршруте отсутствуют места или временные оценки.");
    const visit = data.stops.reduce((sum, stop) => sum + stop.visit_duration_seconds, 0);
    if (data.total_duration_seconds !== visit + data.route.duration_seconds || data.total_duration_seconds > request.available_seconds || data.route.includes_return !== request.return_to_origin) throw new Error("Ошибка контракта: общий бюджет или возвращение к старту рассчитаны неверно.");
    if (data.route.method === "approximate" && data.route.geometry !== null) throw new Error("Ошибка контракта: приблизительный маршрут содержит геометрию.");
    appendWarnings(target, data.warnings);
    const summary = node("div", "itinerary-summary");
    summary.append(node("h3", "", `${data.stops.length} ${data.stops.length === 1 ? "остановка" : "остановки"} · ${STATUS_NAMES.get(data.status).toLowerCase()}`));
    summary.append(timing(data.total_duration_seconds, data.route.duration_seconds, visit, request.available_seconds));
    target.append(summary, routeNote(data.route));
    const stops = node("ol", "itinerary-stops");
    for (const stop of data.stops) {
      const place = places.get(stop.place_id);
      const li = node("li");
      li.append(node("strong", "", place.name), node("p", "", `Посещение: ≈ ${duration(stop.visit_duration_seconds)}`));
      const idea = node("div", "activity-box");
      idea.append(node("strong", "", "Идея занятия · не факт о месте"), node("p", "", stop.suggested_activity));
      li.append(idea, constraints(stop.constraint_evaluations), facts(place));
      stops.append(li);
    }
    target.append(stops);
  }

  async function itinerary() {
    if (state.dirty || !state.lastRequest || !state.selected.length || state.selected.length > 3) return;
    const request = { ...state.lastRequest, place_ids: [...state.selected] };
    state.itineraryController?.abort();
    const controller = new AbortController();
    state.itineraryController = controller;
    const version = ++state.itineraryVersion;
    const timer = setTimeout(() => controller.abort(), 20000);
    state.itineraryBusy = true;
    updateButtons();
    $("itinerary-content").replaceChildren();
    $("itinerary-debug").hidden = true;
    $("itinerary-status").textContent = "Проверяем все выбранные остановки и полный путь…";
    let receivedResult;
    try {
      const result = await api("/v1/itineraries", request, controller.signal);
      if (version !== state.itineraryVersion) return;
      receivedResult = result;
      debug("itinerary", "/v1/itineraries", request, result);
      renderItinerary(result.data, request);
      $("itinerary-status").textContent = `${STATUS_NAMES.get(result.data.status)} · ${result.elapsed} мс`;
    } catch (error) {
      if (version !== state.itineraryVersion) return;
      if (error.name === "AbortError") error = new Error("API не ответил за 20 секунд. Выбранные остановки сохранены.");
      else if (error instanceof TypeError) error = new Error(receivedResult ? "Ответ маршрута не соответствует ожидаемому контракту. Посмотрите JSON." : "Не удалось связаться с API. Выбранные остановки сохранены.");
      debug("itinerary", "/v1/itineraries", request, error.result || receivedResult);
      showError($("itinerary-content"), error);
      $("itinerary-status").textContent = "Маршрут не подтверждён. Исходный выбор сохранён выше.";
    } finally {
      clearTimeout(timer);
      if (version === state.itineraryVersion) {
        state.itineraryBusy = false;
        state.itineraryController = null;
        updateButtons();
      }
    }
  }

  async function refreshStatus() {
    $("refresh-status").disabled = true;
    for (const id of ["live-status", "ready-status"]) { $(id).textContent = "Проверяем…"; $(id).classList.remove("status-error"); }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const settled = await Promise.allSettled([
      api("/v1/health/live", undefined, controller.signal),
      api("/v1/health/ready", undefined, controller.signal),
      api("/v1/data-status", undefined, controller.signal),
      api("/v1/places", undefined, controller.signal),
    ]);
    clearTimeout(timer);
    for (const [index, prefix] of [[0, "live"], [1, "ready"]]) {
      const result = settled[index];
      const ok = result.status === "fulfilled" && result.value.data.status === "ok";
      $(`${prefix}-status`).textContent = ok ? (prefix === "live" ? "На связи" : "Готово к запросам") : "Недоступно";
      $(`${prefix}-status`).classList.toggle("status-error", !ok);
      $(`${prefix}-detail`).textContent = result.status === "fulfilled"
        ? `HTTP ${result.value.httpStatus} · ${result.value.data.version || "API"} · ${readableDate(result.value.data.checked_at)}`
        : result.reason.result ? `HTTP ${result.reason.result.httpStatus} · ${result.reason.result.data?.error?.code || "ошибка API"}` : "Нет соединения с API";
    }
    const dataStatus = settled[2];
    $("catalog-status").textContent = dataStatus.status === "fulfilled" ? String(dataStatus.value.data.total_places ?? "—") : "Недоступно";
    $("catalog-detail").textContent = dataStatus.status === "fulfilled" ? `Обновлено ${readableDate(dataStatus.value.data.checked_at)}` : "Проверьте готовность сервисов";
    const catalog = $("catalog-content");
    catalog.replaceChildren();
    const places = settled[3];
    if (places.status === "fulfilled") {
      const ul = node("ul", "catalog-list");
      for (const place of list(places.value.data.places)) {
        const li = node("li");
        li.append(node("strong", "", place.name), node("span", "", `${place.is_synthetic ? "Синтетическая точка · " : ""}${place.id}`));
        const unknown = list(place.facts).filter((fact) => fact.status !== "known").map((fact) => factName(fact.key));
        if (unknown.length) li.append(node("p", "muted", `Не подтверждено: ${unknown.join(", ")}`));
        ul.append(li);
      }
      catalog.append(ul.childElementCount ? ul : node("p", "muted", "Каталог пока пуст."));
      if (places.value.data.next_cursor) catalog.append(node("p", "muted", "Показана первая страница каталога. Полная пагинация доступна в /docs."));
    } else catalog.append(node("p", "muted", "Каталог не удалось загрузить. Проверьте состояние API."));
    if (dataStatus.status === "fulfilled") {
      const sourceItems = list(dataStatus.value.data.sources);
      if (!sourceItems.length) catalog.append(node("p", "muted", "API не предоставил статусы внешних источников."));
      for (const source of sourceItems) {
        catalog.append(node("p", "form-note", `${source.source_name} · ${source.status} · ${source.place_count} мест`));
        appendWarnings(catalog, source.warnings);
      }
    }
    $("refresh-status").disabled = false;
  }

  $("start-at").value = localDateTime(new Date());
  form.addEventListener("submit", recommend);
  form.addEventListener("input", () => {
    document.querySelectorAll("[data-preset]").forEach((button) => button.setAttribute("aria-pressed", "false"));
    markChanged();
  });
  document.querySelectorAll("[data-preset]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.preset === "indoor"));
    button.addEventListener("click", () => {
      const preset = PRESETS[button.dataset.preset];
      if (!preset) return;
      for (const field of ["query", "budget", "indoor", "transport"]) $(field).value = preset[field];
      $("wheelchair").value = preset.wheelchair;
      $("latitude").value = "51.089";
      $("longitude").value = "71.419";
      $("return-to-origin").checked = true;
      markChanged();
      document.querySelectorAll("[data-preset]").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
      $("preset-note").textContent = preset.note;
    });
  });
  $("itinerary-button").addEventListener("click", itinerary);
  $("refresh-status").addEventListener("click", refreshStatus);
  renderSelection();
  refreshStatus();
})();
