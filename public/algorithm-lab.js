(function (root) {
  const SKILLS = ["Локальные работы", "Работы на подключение и дозаказы", "Аварийные работы"];
  const SPEED = { "Автомобиль": 32, "Пешеход": 5, "Велосипед": 15, "Общественный транспорт": 18 };

  function at(eastKm, northKm) {
    const lat0 = 55.755;
    const lng0 = 37.62;
    return [
      Math.round((lat0 + northKm / 110.574) * 1e5) / 1e5,
      Math.round((lng0 + eastKm / (111.32 * Math.cos(lat0 * Math.PI / 180))) * 1e5) / 1e5,
    ];
  }

  function kmBetween(a, b) {
    const rad = Math.PI / 180;
    const lat1 = a[0] * rad;
    const lat2 = b[0] * rad;
    const dLat = (b[0] - a[0]) * rad;
    const dLng = (b[1] - a[1]) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)) * 1.25;
  }

  function minutes(km, transport) {
    return km / SPEED[transport] * 60;
  }

  function hhmm(value) {
    const rounded = Math.max(0, Math.round(value));
    return `${String(Math.floor(rounded / 60)).padStart(2, "0")}:${String(rounded % 60).padStart(2, "0")}`;
  }

  function parseClock(text) {
    const [h, m] = text.split(":").map(Number);
    return h * 60 + m;
  }

  const engineers = [
    { id: "anna", name: "Анна", start: at(0, 0), shiftStart: parseClock("07:00"), shiftEnd: parseClock("18:00"), skills: ["Локальные работы", "Работы на подключение и дозаказы"], transport: "Автомобиль" },
    { id: "boris", name: "Борис", start: at(2.2, 1.4), shiftStart: parseClock("08:00"), shiftEnd: parseClock("17:00"), skills: SKILLS.slice(), transport: "Автомобиль" },
    { id: "vera", name: "Вера", start: at(-1.1, -0.6), shiftStart: parseClock("09:00"), shiftEnd: parseClock("15:00"), skills: ["Локальные работы"], transport: "Пешеход" },
    { id: "gleb", name: "Глеб", start: at(1.4, 1.8), shiftStart: parseClock("07:30"), shiftEnd: parseClock("17:00"), skills: ["Локальные работы", "Аварийные работы"], transport: "Велосипед" },
    { id: "dina", name: "Дина", start: at(3.6, 2.8), shiftStart: parseClock("10:00"), shiftEnd: parseClock("19:00"), skills: ["Работы на подключение и дозаказы"], transport: "Общественный транспорт" },
  ];

  function job(fields) {
    return {
      priority: "Обычная",
      transport: null,
      cancelled: false,
      ...fields,
      windowStart: parseClock(fields.window[0]),
      windowEnd: parseClock(fields.window[1]),
      point: at(fields.east, fields.north),
    };
  }

  const jobs = [
    job({ id: "L1", address: "Большая Никитская, 9", east: 0.4, north: 0.8, service: 180, window: ["08:00", "15:00"], priority: "Обычная", skill: "Локальные работы", transport: "Автомобиль" }),
    job({ id: "S2", address: "Тверская, 18", east: 0.7, north: 0.4, service: 30, window: ["09:00", "09:30"], priority: "Срочная", skill: "Локальные работы" }),
    job({ id: "S1", address: "Тверская, 12", east: 0.3, north: 0.2, service: 20, window: ["07:00", "10:00"], priority: "Срочная", skill: "Локальные работы" }),
    job({ id: "E1", address: "Садовая-Кудринская, 4", east: 1.6, north: 1.5, service: 60, window: ["10:00", "12:00"], priority: "Срочная", skill: "Аварийные работы", transport: "Автомобиль" }),
    job({ id: "C1", address: "Проспект Мира, 40", east: 3.2, north: 2.5, service: 45, window: ["11:00", "16:00"], priority: "Обычная", skill: "Работы на подключение и дозаказы" }),
    job({ id: "W1", address: "Плющиха, 22", east: -0.9, north: -0.4, service: 30, window: ["12:00", "14:30"], priority: "Обычная", skill: "Локальные работы", transport: "Пешеход" }),
    job({ id: "B1", address: "Красная Пресня, 8", east: 1.2, north: 1.6, service: 25, window: ["09:00", "13:00"], priority: "Обычная", skill: "Локальные работы", transport: "Велосипед" }),
    job({ id: "X1", address: "Кунцево, 7", east: -7.2, north: 1.1, service: 20, window: ["07:10", "07:40"], priority: "Обычная", skill: "Локальные работы" }),
    job({ id: "N1", address: "Остоженка, 16", east: 0.2, north: -1.2, service: 40, window: ["13:00", "16:00"], priority: "Обычная", skill: "Аварийные работы", transport: "Пешеход" }),
    job({ id: "K1", address: "Покровка, 17", east: 2.8, north: 0.6, service: 35, window: ["10:30", "15:00"], priority: "Обычная", skill: "Локальные работы" }),
  ];

  const urgentInsert = job({ id: "U1", address: "Садовая-Черногрязская, 3", east: 2.0, north: 1.2, service: 40, window: ["13:00", "15:00"], priority: "Срочная", skill: "Аварийные работы", transport: "Автомобиль" });

  const initialEvents = [];
  const replanEvents = [
    { type: "отмена заявки", time: "08:30", jobId: "K1" },
    { type: "недоступность инженера", time: "08:40", engineerId: "gleb" },
    { type: "срочная заявка", time: "08:45", job: urgentInsert },
  ];

  function ready(sourceJobs, sourceEngineers, events) {
    const nextJobs = sourceJobs.map(item => ({ ...item }));
    const nextEngineers = sourceEngineers.map(item => ({ ...item, skills: item.skills.slice(), unavailable: false }));
    for (const event of events) {
      if (event.type === "отмена заявки") {
        const found = nextJobs.find(item => item.id === event.jobId);
        if (found) found.cancelled = true;
      }
      if (event.type === "недоступность инженера") {
        const found = nextEngineers.find(item => item.id === event.engineerId);
        if (found) found.unavailable = true;
      }
      if (event.type === "срочная заявка") nextJobs.push({ ...event.job });
    }
    return { jobs: nextJobs, engineers: nextEngineers.filter(item => !item.unavailable) };
  }

  function compatible(engineer, task) {
    if (task.cancelled || engineer.unavailable) return false;
    if (!engineer.skills.includes(task.skill)) return false;
    if (task.transport && engineer.transport !== task.transport) return false;
    return true;
  }

  function simulate(engineer, route) {
    let point = engineer.start;
    let time = engineer.shiftStart;
    let distance = 0;
    let wait = 0;
    const stops = [];
    for (const task of route) {
      const leg = kmBetween(point, task.point);
      const travel = minutes(leg, engineer.transport);
      const arrival = time + travel;
      const start = Math.max(arrival, task.windowStart);
      const end = start + task.service;
      if (start > task.windowEnd || end > engineer.shiftEnd) return null;
      distance += leg;
      wait += Math.max(0, start - arrival);
      stops.push({ jobId: task.id, arrival, start, end, legKm: leg });
      point = task.point;
      time = end;
    }
    return { engineerId: engineer.id, name: engineer.name, stops, km: distance, wait };
  }

  function bestInsertion(engineer, route, task, scoreOf) {
    let best = null;
    for (let index = 0; index <= route.length; index += 1) {
      const candidate = route.slice(0, index).concat(task, route.slice(index));
      const plan = simulate(engineer, candidate);
      if (!plan) continue;
      const addedKm = plan.km - (simulate(engineer, route)?.km ?? 0);
      const addedWait = plan.wait - (simulate(engineer, route)?.wait ?? 0);
      const score = scoreOf({ addedKm, addedWait, opened: route.length === 0, plan });
      if (!best || score < best.score - 1e-9) best = { route: candidate, plan, score, addedKm };
    }
    return best;
  }

  function kmScore(move) {
    return move.addedKm + (move.opened ? 0.35 : 0);
  }

  function waitScore(move) {
    return move.addedWait + move.addedKm * 2 + (move.opened ? 30 : 0);
  }

  function explain(task, pool) {
    if (task.cancelled) return "Заявка отменена и исключена из расчёта.";
    const skilled = pool.filter(item => item.skills.includes(task.skill));
    if (!skilled.length) return `Нет исполнителя с навыком «${task.skill}».`;
    const matched = skilled.filter(item => !task.transport || item.transport === task.transport);
    if (!matched.length) return `Нет исполнителя с навыком «${task.skill}» и транспортом «${task.transport}».`;
    if (!matched.some(item => simulate(item, [task]))) return "Даже свободный подходящий исполнитель не успевает начать работу внутри окна и закончить её внутри смены.";
    return "Подходящие исполнители уже заняты так, что вставить заявку без нарушения окон и смен не удалось.";
  }

  function finish(assignments, pool, allJobs) {
    const routes = [];
    const byJob = new Map();
    for (const engineer of pool) {
      const route = assignments.get(engineer.id) ?? [];
      const plan = route.length ? simulate(engineer, route) : null;
      if (plan) routes.push(plan);
      for (const task of route) byJob.set(task.id, engineer.id);
    }
    const rows = allJobs.map(task => {
      const engineerId = byJob.get(task.id) ?? null;
      return { id: task.id, engineerId, reason: engineerId ? null : explain(task, pool) };
    });
    const active = routes.length;
    const km = routes.reduce((sum, route) => sum + route.km, 0);
    const wait = routes.reduce((sum, route) => sum + route.wait, 0);
    const served = rows.filter(row => row.engineerId);
    const urgent = allJobs.filter(task => task.priority === "Срочная" && !task.cancelled);
    return {
      routes,
      rows,
      metrics: {
        assigned: served.length,
        total: allJobs.length,
        urgentAssigned: served.filter(row => urgent.some(task => task.id === row.id)).length,
        urgentTotal: urgent.length,
        engineers: active,
        km,
        wait,
      },
    };
  }

  function consider(task) {
    return task.windowStart + task.service;
  }

  const orders = {
    timeThenPriority(list) {
      return list.slice().sort((a, b) => consider(a) - consider(b) || priorityRank(b) - priorityRank(a) || a.id.localeCompare(b.id));
    },
    windowEnd(list) {
      return list.slice().sort((a, b) => a.windowEnd - b.windowEnd || priorityRank(b) - priorityRank(a) || a.id.localeCompare(b.id));
    },
    windowStart(list) {
      return list.slice().sort((a, b) => a.windowStart - b.windowStart || priorityRank(b) - priorityRank(a) || a.id.localeCompare(b.id));
    },
    priorityThenEnd(list) {
      return list.slice().sort((a, b) => priorityRank(b) - priorityRank(a) || a.windowEnd - b.windowEnd || a.id.localeCompare(b.id));
    },
    priorityThenTime(list) {
      return list.slice().sort((a, b) => priorityRank(b) - priorityRank(a) || consider(a) - consider(b) || a.id.localeCompare(b.id));
    },
    shortService(list) {
      return list.slice().sort((a, b) => a.service - b.service || a.windowEnd - b.windowEnd || a.id.localeCompare(b.id));
    },
    slack(list) {
      return list.slice().sort((a, b) => (a.windowEnd - consider(a)) - (b.windowEnd - consider(b)) || priorityRank(b) - priorityRank(a) || a.id.localeCompare(b.id));
    },
    input(list) {
      return list.slice();
    },
  };

  function priorityRank(task) {
    return task.priority === "Срочная" ? 2 : 1;
  }

  function seed(pool) {
    return new Map(pool.map(item => [item.id, []]));
  }

  function openJobs(list) {
    return list.filter(task => !task.cancelled);
  }

  function insertInOrder(pool, list, orderName, scoreOf, appendOnly) {
    const assignments = seed(pool);
    const order = orders[orderName](openJobs(list));
    for (const task of order) {
      let chosen = null;
      for (const engineer of pool) {
        if (!compatible(engineer, task)) continue;
        const route = assignments.get(engineer.id);
        const placed = appendOnly
          ? (() => {
            const candidate = route.concat(task);
            const plan = simulate(engineer, candidate);
            if (!plan) return null;
            const previous = simulate(engineer, route);
            return { route: candidate, plan, addedKm: plan.km - (previous?.km ?? 0), addedWait: plan.wait - (previous?.wait ?? 0), opened: route.length === 0 };
          })()
          : bestInsertion(engineer, route, task, scoreOf);
        if (!placed) continue;
        const score = scoreOf(placed);
        if (!chosen || score < chosen.score - 1e-9) chosen = { engineer, ...placed, score };
      }
      if (chosen) assignments.set(chosen.engineer.id, chosen.route);
    }
    return { assignments, order };
  }

  function globalCheapest(pool, list) {
    const assignments = seed(pool);
    const pending = openJobs(list);
    const seen = [];
    while (pending.length) {
      let chosen = null;
      for (const task of pending) {
        for (const engineer of pool) {
          if (!compatible(engineer, task)) continue;
          const placed = bestInsertion(engineer, assignments.get(engineer.id), task, kmScore);
          if (!placed) continue;
          if (!chosen || placed.score < chosen.score - 1e-9) chosen = { task, engineer, ...placed };
        }
      }
      if (!chosen) break;
      assignments.set(chosen.engineer.id, chosen.route);
      seen.push(chosen.task);
      pending.splice(pending.indexOf(chosen.task), 1);
    }
    return { assignments, order: seen };
  }

  function regret(pool, list) {
    const assignments = seed(pool);
    const pending = openJobs(list);
    const seen = [];
    while (pending.length) {
      let selected = null;
      for (const task of pending) {
        const options = [];
        for (const engineer of pool) {
          if (!compatible(engineer, task)) continue;
          const placed = bestInsertion(engineer, assignments.get(engineer.id), task, kmScore);
          if (placed) options.push({ engineer, ...placed });
        }
        options.sort((a, b) => a.score - b.score);
        if (!options.length) continue;
        const regretValue = options.length > 1 ? options[1].score - options[0].score : 1000;
        if (!selected || regretValue > selected.regretValue + 1e-9) selected = { task, regretValue, ...options[0] };
      }
      if (!selected) break;
      assignments.set(selected.engineer.id, selected.route);
      seen.push(selected.task);
      pending.splice(pending.indexOf(selected.task), 1);
    }
    return { assignments, order: seen };
  }

  function relocate(pool, assignments) {
    let guard = 0;
    let moved = true;
    while (moved && guard < 20) {
      moved = false;
      guard += 1;
      for (const from of pool) {
        const route = assignments.get(from.id);
        for (let index = 0; index < route.length; index += 1) {
          const task = route[index];
          const without = route.filter((_, item) => item !== index);
          if (without.length && !simulate(from, without)) continue;
          const fromKm = simulate(from, route)?.km ?? 0;
          const withoutKm = simulate(from, without)?.km ?? 0;
          let best = null;
          for (const to of pool) {
            if (to.id === from.id || !compatible(to, task)) continue;
            const placed = bestInsertion(to, assignments.get(to.id), task, kmScore);
            if (!placed) continue;
            const gain = fromKm - withoutKm - placed.addedKm;
            if (gain > 0.05 && (!best || gain > best.gain)) best = { to, placed, gain };
          }
          if (!best) continue;
          assignments.set(from.id, without);
          assignments.set(best.to.id, best.placed.route);
          moved = true;
          break;
        }
        if (moved) break;
      }
    }
    return assignments;
  }

  function dynamicEarliest(pool, list) {
    const assignments = seed(pool);
    const pending = openJobs(list);
    const seen = [];
    while (pending.length) {
      let selected = null;
      for (const task of pending) {
        for (const engineer of pool) {
          if (!compatible(engineer, task)) continue;
          const placed = bestInsertion(engineer, assignments.get(engineer.id), task, kmScore);
          if (!placed) continue;
          const start = placed.plan.stops.find(stop => stop.jobId === task.id).start;
          if (!selected || start < selected.start - 1e-9 || (Math.abs(start - selected.start) < 1e-9 && placed.score < selected.score)) {
            selected = { task, engineer, start, ...placed };
          }
        }
      }
      if (!selected) break;
      assignments.set(selected.engineer.id, selected.route);
      seen.push(selected.task);
      pending.splice(pending.indexOf(selected.task), 1);
    }
    return { assignments, order: seen };
  }

  function sweep(pool, list) {
    const center = at(0, 0);
    const buckets = new Map(pool.map(item => [item.id, []]));
    const order = [];
    for (const task of orders.timeThenPriority(openJobs(list))) {
      const angle = Math.atan2(task.point[0] - center[0], task.point[1] - center[1]);
      const candidates = pool.filter(item => compatible(item, task)).sort((a, b) => {
        const aAngle = Math.atan2(a.start[0] - center[0], a.start[1] - center[1]);
        const bAngle = Math.atan2(b.start[0] - center[0], b.start[1] - center[1]);
        return Math.abs(aAngle - angle) - Math.abs(bAngle - angle);
      });
      let placed = false;
      for (const engineer of candidates) {
        const route = buckets.get(engineer.id).concat(task);
        if (!simulate(engineer, route)) continue;
        buckets.set(engineer.id, route);
        order.push(task);
        placed = true;
        break;
      }
      if (!placed) order.push(task);
    }
    return { assignments: buckets, order };
  }

  const algorithms = [
    { id: "algorithm1", title: "Освобождение, затем срочность", rule: "Сначала заявки с меньшим значением «начало окна + длительность». При равенстве срочная выше обычной. Заявку ставим в позицию с наименьшим добавленным пробегом.", run: (pool, list) => insertInOrder(pool, list, "timeThenPriority", kmScore, false) },
    { id: "algorithm2", title: "Раньше закрывается окно", rule: "Сначала меньший конец окна, затем срочность. Вставка в самую короткую по километрам позицию.", run: (pool, list) => insertInOrder(pool, list, "windowEnd", kmScore, false) },
    { id: "algorithm3", title: "Раньше открывается окно", rule: "Сначала меньшее начало окна, затем срочность. Вставка по километрам.", run: (pool, list) => insertInOrder(pool, list, "windowStart", kmScore, false) },
    { id: "algorithm4", title: "Сначала срочные", rule: "Сначала все срочные, внутри них более ранний конец окна. Так устроен запасной поиск проекта. Вставка по километрам.", run: (pool, list) => insertInOrder(pool, list, "priorityThenEnd", kmScore, false) },
    { id: "algorithm5", title: "Срочность, затем освобождение", rule: "Сначала срочные, и только внутри одного приоритета сортировка по «начало + длительность».", run: (pool, list) => insertInOrder(pool, list, "priorityThenTime", kmScore, false) },
    { id: "algorithm6", title: "Самая дешёвая пара", rule: "Без сортировки по времени. На каждом шаге берётся самая дешёвая допустимая пара «заявка — место у инженера». Так OR-Tools собирает первый набросок.", run: (pool, list) => globalCheapest(pool, list) },
    { id: "algorithm7", title: "Baseline: первый подходящий", rule: "Входной порядок. Первый инженер, которому заявку можно дописать только в конец.", run: (pool, list) => insertInOrder(pool, list, "input", kmScore, true) },
    { id: "algorithm8", title: "Сначала короткие работы", rule: "Сначала меньшая длительность, затем более ранний конец окна. Вставка по километрам.", run: (pool, list) => insertInOrder(pool, list, "shortService", kmScore, false) },
    { id: "algorithm9", title: "Сначала узкий запас", rule: "Запас = конец окна − (начало + длительность). Меньший запас раньше. Вставка по километрам.", run: (pool, list) => insertInOrder(pool, list, "slack", kmScore, false) },
    { id: "algorithm10", title: "Освобождение, только в конец", rule: "Тот же порядок, что в algorithm1, но место только в конце текущего маршрута, у ближайшего допустимого инженера.", run: (pool, list) => insertInOrder(pool, list, "timeThenPriority", kmScore, true) },
    { id: "algorithm11", title: "Максимальное сожаление", rule: "На каждом шаге берётся заявка, у которой разрыв между лучшим и вторым местом наибольший. Её ставят в лучшее место.", run: (pool, list) => regret(pool, list) },
    { id: "algorithm12", title: "Освобождение и переносы", rule: "Сборка как в algorithm1, затем заявку переносят другому инженеру, пока суммарный пробег падает и окна целы.", run: (pool, list) => { const built = insertInOrder(pool, list, "timeThenPriority", kmScore, false); relocate(pool, built.assignments); return built; } },
    { id: "algorithm13", title: "Освобождение и простой", rule: "Порядок как в algorithm1. Из допустимых мест выбирается то, где меньше ожидание открытия окна, и только потом километры.", run: (pool, list) => insertInOrder(pool, list, "timeThenPriority", waitScore, false) },
    { id: "algorithm14", title: "Кто реально может начаться раньше", rule: "Очередь пересчитывается. Следующей берётся заявка, у которой есть самое раннее допустимое начало с учётом уже собранных маршрутов и дороги.", run: (pool, list) => dynamicEarliest(pool, list) },
    { id: "algorithm15", title: "Сектор от центра", rule: "Порядок освобождения сохраняется, но заявка отдаётся подходящему инженеру, чья база ближе по углу к заявке, и дописывается в конец.", run: (pool, list) => sweep(pool, list) },
  ];

  function changesBetween(before, after, pool) {
    const names = new Map(pool.map(item => [item.id, item.name]));
    const beforePlace = new Map();
    const afterPlace = new Map();
    for (const route of before.routes) route.stops.forEach((stop, index) => beforePlace.set(stop.jobId, { engineerId: route.engineerId, index }));
    for (const route of after.routes) route.stops.forEach((stop, index) => afterPlace.set(stop.jobId, { engineerId: route.engineerId, index }));
    const ids = new Set([...beforePlace.keys(), ...afterPlace.keys()]);
    const lines = [];
    for (const id of ids) {
      const oldPlace = beforePlace.get(id);
      const newPlace = afterPlace.get(id);
      if (oldPlace?.engineerId !== newPlace?.engineerId) {
        const from = oldPlace ? names.get(oldPlace.engineerId) : null;
        const to = newPlace ? names.get(newPlace.engineerId) : null;
        lines.push(from && to ? `${id}: ${from} → ${to}` : to ? `${id}: назначена ${to}` : `${id}: снята с ${from}`);
      } else if (oldPlace && newPlace && oldPlace.index !== newPlace.index) {
        lines.push(`${id}: место в маршруте ${names.get(newPlace.engineerId)} ${oldPlace.index + 1} → ${newPlace.index + 1}`);
      }
    }
    return lines;
  }

  function explainRoute(result, pool, list) {
    const route = result.routes[0];
    if (!route) return "Ни один маршрут не собран.";
    const engineer = pool.find(item => item.id === route.engineerId);
    const tasks = route.stops.map(stop => list.find(item => item.id === stop.jobId));
    const skills = [...new Set(tasks.map(item => item.skill))].join(", ");
    const transports = [...new Set(tasks.map(item => item.transport).filter(Boolean))];
    const transportText = transports.length ? `Транспорт заявок: ${transports.join(", ")}.` : "Отдельного ограничения транспорта у этих заявок нет.";
    return `${engineer.name} получает этот маршрут: навык совпал (${skills}), транспорт инженера — ${engineer.transport}. ${transportText} Смена ${hhmm(engineer.shiftStart)}–${hhmm(engineer.shiftEnd)}. Каждое начало работы попало в окно заявки. Пробег ${route.km.toFixed(1)} км, возврат на базу не требуется.`;
  }

  function runScenario(algorithm, sourceJobs, sourceEngineers, events) {
    const { jobs: list, engineers: pool } = ready(sourceJobs, sourceEngineers, events);
    const built = algorithm.run(pool, list);
    const result = finish(built.assignments, pool, list);
    return { ...result, order: built.order, pool, list };
  }

  function rankResults(items) {
    const ranked = items.slice().sort((a, b) =>
      b.before.metrics.assigned - a.before.metrics.assigned
      || b.before.metrics.urgentAssigned - a.before.metrics.urgentAssigned
      || a.before.metrics.engineers - b.before.metrics.engineers
      || a.before.metrics.km - b.before.metrics.km
    );
    ranked.forEach((item, index) => { item.place = index + 1; });
    return items;
  }

  function scoreDataset(dataset) {
    const rankedInput = algorithms.map(algorithm => {
      const before = runScenario(algorithm, dataset.jobs, dataset.engineers, []);
      const after = runScenario(algorithm, dataset.jobs, dataset.engineers, dataset.events);
      return {
        ...algorithm,
        before,
        after,
        changes: changesBetween(before, after, dataset.engineers),
        explanation: explainRoute(before, before.pool, before.list),
        roster: dataset.engineers,
      };
    });
    return rankResults(rankedInput);
  }

  function leaderboard(packs) {
    const rows = new Map();
    for (const pack of packs) {
      for (const item of pack.results) {
        const row = rows.get(item.id) ?? {
          id: item.id,
          title: item.title,
          points: 0,
          places: [],
          assigned: 0,
          km: 0,
          engineers: 0,
          count: 0,
        };
        row.points += algorithms.length - item.place + 1;
        row.places.push(`${pack.dataset.title.split(",")[0]}: ${item.place}`);
        row.assigned += item.before.metrics.assigned / item.before.metrics.total;
        row.km += item.before.metrics.km;
        row.engineers += item.before.metrics.engineers;
        row.count += 1;
        rows.set(item.id, row);
      }
    }
    return [...rows.values()].sort((a, b) => b.points - a.points || b.assigned - a.assigned || a.km - b.km);
  }

  function benchmarkSets() {
    const external = globalThis.AlgorithmDatasets;
    if (Array.isArray(external) && external.length) return external;
    return [{ id: "demo", title: "Учебный день", seed: 0, engineers, jobs, events: replanEvents }];
  }

  function runAll() {
    const packs = benchmarkSets().map(dataset => ({ dataset, results: scoreDataset(dataset) }));
    return { packs, board: leaderboard(packs), results: packs[0].results };
  }

  function routeTable(routes) {
    if (!routes.length) return "<p>Маршрутов нет.</p>";
    const rows = routes.flatMap(route => route.stops.map((stop, index) => `<tr><td>${route.name}</td><td>${index + 1}</td><td>${stop.jobId}</td><td>${hhmm(stop.arrival)}</td><td>${hhmm(stop.start)}</td><td>${hhmm(stop.end)}</td><td>${stop.legKm.toFixed(1)}</td></tr>`));
    return `<table><tr><th>Исполнитель</th><th>№</th><th>Заявка</th><th>Прибытие</th><th>Начало</th><th>Конец</th><th>Плечо, км</th></tr>${rows.join("")}</table>`;
  }

  function jobTable(rows, pool) {
    const names = new Map(pool.map(item => [item.id, item.name]));
    const body = rows.map(row => `<tr><td>${row.id}</td><td>${row.engineerId ? names.get(row.engineerId) : "не назначена"}</td><td>${row.reason ?? ""}</td></tr>`).join("");
    return `<table><tr><th>Заявка</th><th>Исполнитель</th><th>Причина, если не назначена</th></tr>${body}</table>`;
  }

  function compareTable(caption, rows, results) {
    const head = `<tr><th>${caption}</th>${results.map(item => `<th>${item.id}<br>${item.title}</th>`).join("")}</tr>`;
    const body = rows.map(row => `<tr>${row.map((value, index) => index ? `<td>${value}</td>` : `<th>${value}</th>`).join("")}</tr>`).join("");
    return `<div class="compare"><table>${head}${body}</table></div>`;
  }

  function routeCell(route) {
    if (!route) return "маршрута нет";
    const stops = route.stops.map((stop, index) => `${index + 1}. ${stop.jobId}: прибытие ${hhmm(stop.arrival)}, начало ${hhmm(stop.start)}`).join("<br>");
    return `${stops}<br>пробег ${route.km.toFixed(1)} км`;
  }

  function assignmentCell(row, names) {
    if (!row) return "";
    return row.engineerId ? names.get(row.engineerId) : `не назначена. ${row.reason}`;
  }

  function leaderboardTable(board) {
    const body = board.map((item, index) => `<tr class="${index === 0 ? "taken" : ""}"><td>${index + 1}</td><td>${item.id}</td><td>${item.title}</td><td>${(item.points / item.count).toFixed(1)}</td><td>${item.places.join("<br>")}</td><td>${Math.round(item.assigned / item.count * 100)}%</td><td>${(item.engineers / item.count).toFixed(1)}</td><td>${(item.km / item.count).toFixed(1)}</td></tr>`).join("");
    return `<table><tr><th>Место</th><th>Код</th><th>Правило</th><th>Средний балл</th><th>Место на каждом наборе</th><th>Средняя доля назначенных</th><th>Среднее число исполнителей</th><th>Средний пробег, км</th></tr>${body}</table>`;
  }

  function comparePanel(results, board, dataset) {
    const names = new Map(dataset.engineers.map(item => [item.id, item.name]));
    const planRows = [
      ["Задействовано исполнителей", ...results.map(item => String(item.before.metrics.engineers))],
      ["Суммарный пробег, км", ...results.map(item => item.before.metrics.km.toFixed(1))],
    ];
    for (const engineer of dataset.engineers) {
      planRows.push([`Пробег ${engineer.name}, км`, ...results.map(item => {
        const route = item.before.routes.find(route => route.engineerId === engineer.id);
        return route ? route.km.toFixed(1) : "—";
      })]);
    }
    const routeRows = dataset.engineers.map(engineer => [engineer.name, ...results.map(item => routeCell(item.before.routes.find(route => route.engineerId === engineer.id)))]);
    const jobRows = dataset.jobs.map(task => [task.id, ...results.map(item => assignmentCell(item.before.rows.find(row => row.id === task.id), names))]);
    const afterIds = [...dataset.jobs.map(task => task.id), ...dataset.events.filter(event => event.job).map(event => event.job.id)];
    const afterRows = afterIds.map(id => [id, ...results.map(item => assignmentCell(item.after.rows.find(row => row.id === id), names))]);
    const afterPlan = [
      ["Задействовано исполнителей", ...results.map(item => String(item.after.metrics.engineers))],
      ["Суммарный пробег, км", ...results.map(item => item.after.metrics.km.toFixed(1))],
    ];
    for (const engineer of dataset.engineers) {
      afterPlan.push([`Пробег ${engineer.name}, км`, ...results.map(item => {
        const route = item.after.routes.find(route => route.engineerId === engineer.id);
        return route ? route.km.toFixed(1) : "—";
      })]);
    }
    const afterRoutes = dataset.engineers.map(engineer => [engineer.name, ...results.map(item => routeCell(item.after.routes.find(route => route.engineerId === engineer.id)))]);
    const changeRows = [["Изменения", ...results.map(item => item.changes.length ? item.changes.join("<br>") : "Назначения не изменились.")]];
    const explainRows = [["Почему маршрут такой", ...results.map(item => item.explanation)]];
    return `<section class="lab-panel" data-lab="compare">
      <h3>Таблица лидеров</h3>
      <p>Балл на одном наборе: 15 за первое место и 1 за последнее. Место внутри набора: больше назначенных заявок, затем больше срочных, затем меньше исполнителей, затем меньше километров. В таблице среднее по четырём наборам.</p>
      ${leaderboardTable(board)}
      <h3>Все 15 результатов рядом</h3>
      <p>Ниже колонки первого набора. Строки: маршрут с прибытием и началом, заявка с исполнителем или причиной, пробег, затем план после перепланирования.</p>
      <h4>План до события</h4>
      ${compareTable("План целиком", planRows, results)}
      <h4>Маршрут каждого исполнителя</h4>
      ${compareTable("Исполнитель", routeRows, results)}
      <h4>Назначение каждой заявки</h4>
      ${compareTable("Заявка", jobRows, results)}
      <h4>Почему выбран первый маршрут</h4>
      ${compareTable("Объяснение", explainRows, results)}
      <h4>План после событий набора</h4>
      ${compareTable("План целиком", afterPlan, results)}
      <h4>Маршруты после события</h4>
      ${compareTable("Исполнитель", afterRoutes, results)}
      <h4>Назначения после события</h4>
      ${compareTable("Заявка", afterRows, results)}
      <h4>Что изменилось</h4>
      ${compareTable("Перепланирование", changeRows, results)}
    </section>`;
  }

  function render(host) {
    const report = runAll();
    const results = report.results;
    const summary = results.slice().sort((a, b) => a.place - b.place).map(item => {
      const metric = item.before.metrics;
      return `<tr><td>${item.place}</td><td>${item.id}</td><td>${item.title}</td><td>${metric.assigned}/${metric.total}</td><td>${metric.urgentAssigned}/${metric.urgentTotal}</td><td>${metric.engineers}</td><td>${metric.km.toFixed(1)}</td><td>${Math.round(metric.wait)}</td><td>${item.changes.length}</td></tr>`;
    }).join("");
    const panels = results.map((item, index) => {
      const metric = item.before.metrics;
      const after = item.after.metrics;
      const order = item.before.order.map(task => `${task.id} (${hhmm(consider(task))}, ${task.priority})`).join(" → ");
      const changeText = item.changes.length ? item.changes.map(line => `<li>${line}</li>`).join("") : "<li>Назначения не изменились.</li>";
      return `<section class="lab-panel" data-lab="${item.id}" hidden>
        <h3>${item.id}. ${item.title}</h3>
        <p>${item.rule}</p>
        <p>Место в сравнении: ${item.place} из ${results.length}. Назначено ${metric.assigned} из ${metric.total}, срочных ${metric.urgentAssigned} из ${metric.urgentTotal}, исполнителей ${metric.engineers}, пробег ${metric.km.toFixed(1)} км, ожидание у окон ${Math.round(metric.wait)} мин.</p>
        <h4>Порядок рассмотрения</h4>
        <p>${order || "Заявки выбирались без заранее заданного порядка."}</p>
        <h4>Маршруты до события</h4>
        ${routeTable(item.before.routes)}
        <h4>Заявки до события</h4>
        ${jobTable(item.before.rows, item.roster)}
        <h4>Почему первый маршрут такой</h4>
        <p>${item.explanation}</p>
        <h4>После событий перепланирования</h4>
        <p>Назначено ${after.assigned} из ${after.total}, пробег ${after.km.toFixed(1)} км, исполнителей ${after.engineers}.</p>
        ${routeTable(item.after.routes)}
        ${jobTable(item.after.rows, item.roster)}
        <h4>Что изменилось</h4>
        <ul>${changeText}</ul>
      </section>`;
    }).join("");
    const buttons = `<button type="button" data-lab-tab="compare" class="active">все рядом</button>${results.map(item => `<button type="button" data-lab-tab="${item.id}">${item.id}</button>`).join("")}`;
    const datasetRows = report.packs.map(pack => {
      const set = pack.dataset;
      const urgent = set.jobs.filter(task => task.priority === "Срочная").length;
      const limited = set.jobs.filter(task => task.transport).length;
      const skills = [...new Set(set.jobs.map(task => task.skill))].join("; ");
      return `<tr><td>${set.title}</td><td>${set.seed}</td><td>${set.engineers.length}</td><td>${set.jobs.length}</td><td>${urgent}</td><td>${limited}</td><td>${skills}</td><td>${set.events.map(event => event.type).join(", ")}</td></tr>`;
    }).join("");
    host.innerHTML = `<h2>Сравнение пятнадцати алгоритмов</h2>
      <table><tr><th>Набор</th><th>Seed</th><th>Инженеры</th><th>Заявки</th><th>Срочные</th><th>С ограничением транспорта</th><th>Навыки заявок</th><th>События</th></tr>${datasetRows}</table>
      <p>Оценка эффективности распределения на контрольных наборах данных. Учитываются навыки, транспорт, временные окна и смены инженеров.</p>
      <div class="lab-tabs">${buttons}</div>
      ${comparePanel(results, report.board, report.packs[0].dataset)}
      <table>
        <tr><th>Место</th><th>Код</th><th>Правило</th><th>Назначено</th><th>Срочные</th><th>Исполнители</th><th>Км</th><th>Ожидание, мин</th><th>Изменения после события</th></tr>
        ${summary}
      </table>
      ${panels}`;
    host.querySelectorAll("[data-lab-tab]").forEach(button => {
      button.addEventListener("click", () => {
        host.querySelectorAll("[data-lab-tab]").forEach(item => item.classList.toggle("active", item === button));
        host.querySelectorAll(".lab-panel").forEach(panel => { panel.hidden = panel.dataset.lab !== button.dataset.labTab; });
      });
    });
  }

  root.AlgorithmLab = { engineers, jobs, replanEvents, algorithms, runAll, render, hhmm, consider };
}(typeof window !== "undefined" ? window : globalThis));
