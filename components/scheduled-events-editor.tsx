"use client";
import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { BackendGeocodingProvider, type Coordinate } from "@/lib/map-providers";
import { parseTime } from "@/lib/data-editor";
import { createTzReplanEvent, type TzReplanEvent } from "@/lib/generator-files";
import { ALL_SKILLS, SKILL_EQUIPMENT_POOLS } from "@/lib/domain";
import { eventKey, type EventOutcomes } from "@/lib/scheduled-events";
import { jobPriorityLevel, minutesLabel, type Engineer, type Job, type Region } from "@/lib/vrptw";

export type EventEditorDraft = { type:TzReplanEvent["type"]; eventTime:string; entityId:string; editing?:string; urgentMode?:"existing"|"new"; location:string; form:{ address:string;lon:string;lat:string;region:Region;start:string;end:string;service:string;skill:string;equipment:string;transport:string } };

export function ScheduledEventsEditor({ jobs, engineers, events, outcomes, time, started, busy, draft, plannedStarts, onDraft, onSave, onRemove, onRewind }: {
  jobs: Job[]; engineers: Engineer[]; events: TzReplanEvent[]; outcomes: EventOutcomes; time: number; started: boolean; busy: boolean;
  plannedStarts?:Record<string,number>;
  draft:EventEditorDraft | null; onDraft:(value:EventEditorDraft)=>void;
  onSave: (event:TzReplanEvent, oldKey?:string) => void; onRemove: (key:string) => void;
  onRewind:(time:number)=>void;
}) {
  const [type,setType] = useState<TzReplanEvent["type"]>(draft?.type ?? "отмена заявки");
  const [eventTime,setEventTime] = useState(draft?.eventTime ?? "16:00");
  const [entityId,setEntityId] = useState(draft?.entityId ?? "");
  const [editing,setEditing] = useState<string | undefined>(draft?.editing);
  const [urgentMode,setUrgentMode] = useState<"existing"|"new">(draft?.urgentMode ?? "new");
  const [error,setError] = useState("");
  const [creating,setCreating] = useState(false);
  const [location,setLocation] = useState(draft?.location ?? "new");
  const [form,setForm] = useState(draft?.form ?? { address:"", lon:"", lat:"", region:"Восток" as Region, start:"16:00", end:"18:00", service:"60", skill:"", equipment:"", transport:"" });
  useEffect(()=>onDraft({type,eventTime,entityId,editing,urgentMode,location,form}),[type,eventTime,entityId,editing,urgentMode,location,form,onDraft]);
  const skills = [...new Set([...ALL_SKILLS,...engineers.flatMap(engineer=>engineer.skills),...jobs.map(job=>job.kind),...(form.skill ? [form.skill] : [])])];
  const skill = form.skill || skills[0] || "Локальные работы";
  const equipmentOptions = [...new Set([...(SKILL_EQUIPMENT_POOLS[skill] ?? []), ...jobs.filter(job => job.kind === skill).map(job => job.equipment), ...engineers.filter(engineer => engineer.skills.includes(skill)).flatMap(engineer => engineer.equipmentOptions ?? engineer.equipment)])];
  const equipment = form.equipment || equipmentOptions[0] || "Диагностический комплект";
  const cancelJobs = [...jobs, ...events.flatMap(event => event.job ? [event.job] : [])];
  const elevatableJobs=cancelJobs.filter(job=>!job.cancelled && jobPriorityLevel(job)===1);
  const selectedEntity = entityId || (type === "срочная заявка" && urgentMode === "existing" ? elevatableJobs[0]?.id : type === "отмена заявки" ? cancelJobs[0]?.id : engineers[0]?.id) || "";
  const edit = (event:TzReplanEvent) => {
    if (started && parseTime(event.time)<=time) onRewind(Math.max(450,parseTime(event.time)-1));
    setEditing(eventKey(event)); setType(event.type); setEventTime(event.time); setEntityId(event.job ? "" : event.entityId); setUrgentMode(event.job ? "new" : "existing"); setError("");
    if (event.job) { const job=event.job; setLocation("new"); setForm({ address:job.address, lon:String(job.coordinates[0]), lat:String(job.coordinates[1]), region:job.region, start:minutesLabel(job.windowStart), end:minutesLabel(job.windowEnd), service:String(job.serviceMinutes), skill:job.kind, equipment:job.equipment, transport:job.requiredTransport }); }
  };
  const submit = async () => {
    setError("");
    const minute = parseTime(eventTime);
    if (!Number.isFinite(minute) || minute < 450 || minute > 1320) { setError("Укажите время появления события с 07:30 до 22:00."); return; }
    if (started && minute < Math.floor(time)) { setError("Событие нельзя добавить в прошлое. Сначала переместите время просмотра к моменту до события."); return; }
    if (type === "отмена заявки" || (type === "срочная заявка" && urgentMode === "existing")) {
      const target=cancelJobs.find(job=>job.id===selectedEntity);
      const appearance=events.find(event=>event.job?.id===selectedEntity);
      if (!target) { setError("Выберите существующую заявку."); return; }
      if (appearance && parseTime(appearance.time)>minute) { setError("Событие не может произойти до появления выбранной заявки."); return; }
      if (minute>=target.windowEnd || (started && plannedStarts?.[target.id]!=null && minute>=plannedStarts[target.id])) { setError("Заявка к этому времени уже началась или её окно завершилось. Выберите более раннее время."); return; }
    }
    setCreating(true);
    try {
      let job:Job | undefined;
      if (type === "новая заявка" || (type === "срочная заявка" && urgentMode === "new")) {
        const start=parseTime(form.start), end=parseTime(form.end), service=Number(form.service);
        if (!Number.isFinite(start) || !Number.isFinite(end) || start < 450 || end > 1320 || end <= start || end <= minute || !Number.isInteger(service) || service < 5 || service > 480 || Math.max(start,minute) + service > end) throw new Error("Проверьте окно и длительность: работы должны помещаться после появления заявки, до 22:00.");
        const known = jobs.find(item => item.id === location);
        let coordinates:Coordinate | null = known?.geocodeVerified ? known.coordinates : null;
        const address=known?.address ?? form.address.trim();
        if (!address) throw new Error("Укажите адрес новой заявки.");
        if (!known && (form.lon.trim() || form.lat.trim())) {
          const lon=Number(form.lon.replace(",",".")),lat=Number(form.lat.replace(",","."));
          if (!form.lon.trim() || !form.lat.trim() || !Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon)>180 || Math.abs(lat)>90) throw new Error("Укажите обе корректные координаты.");
          coordinates=[lon,lat];
        } else if (!coordinates) coordinates=await new BackendGeocodingProvider("nominatim").geocode(address);
        if (!coordinates) throw new Error("Адрес не найден. Уточните его или задайте координаты вручную.");
        const usedIds = new Set(cancelJobs.map(item => item.id));
        let number = Math.max(0,...cancelJobs.map(item => Number(item.id)).filter(Number.isFinite)) + 1;
        while (usedIds.has(String(number).padStart(4,"0"))) number++;
        const urgent=type==="срочная заявка";
        job = { id: events.find(event=>eventKey(event)===editing && event.job)?.entityId ?? String(number).padStart(4,"0"), address, coordinates, region:known?.region ?? form.region, area:known?.area ?? form.region, time:`${form.start}–${form.end}`, windowStart:start, windowEnd:end, serviceMinutes:service, kind:skill, workType:skill, equipment, requiredTransport:form.transport, priority:urgent?2:1, urgency:urgent?"urgent":"normal", engineerId:null, baselineEngineerId:null, tone:urgent?"amber":"teal", risk:false, source:"Событие генератора", status:"Новая", executionStatus:"not_started", geocodeVerified:true, geocodeQuality:known?.geocodeVerified ? known.geocodeQuality : (form.lon && !known ? "manual" : "street"), normSource:"введено пользователем" };
      }
      if (!job && !selectedEntity) throw new Error("Выберите заявку или инженера.");
      const event=createTzReplanEvent({ type, time:eventTime, entityId:job ? undefined : selectedEntity, job, jobs, engineers, events:events.filter(event => eventKey(event)!==editing) });
      if (events.some(item=>eventKey(item)!==editing && eventKey(item)===eventKey(event))) throw new Error("Такое событие уже добавлено.");
      onSave(event,editing); setEditing(undefined);
    } catch (error) { setError(error instanceof Error ? error.message : "Не удалось создать событие"); }
    finally { setCreating(false); }
  };
  const field = (key:keyof typeof form, value:string) => setForm(current => ({ ...current, [key]:value }));
  return <section className="scheduled-editor" aria-label="Настройка событий сценария"><p className="scheduled-help">Укажите, что произойдёт и во сколько. Событие применяется автоматически при достижении этого времени на шкале просмотра. До него заявки и назначения остаются прежними.</p>
    <fieldset disabled={busy || creating}><div className="scheduled-fields">
      <label>Тип события<select value={type} onChange={event => { setType(event.target.value as TzReplanEvent["type"]); setEntityId(""); setEditing(undefined); setError(""); }}><option>отмена заявки</option><option>недоступность инженера</option><option>срочная заявка</option><option>новая заявка</option></select></label>
      <label>Время появления<input aria-label="Время появления события" type="time" min="07:30" max="22:00" value={eventTime} onChange={event => setEventTime(event.target.value)} /></label>
      {type === "отмена заявки" && <label className="scheduled-wide">Отменяемая заявка<select aria-label="Отменяемая заявка" value={selectedEntity} onChange={event=>setEntityId(event.target.value)}>{cancelJobs.map(job => <option key={job.id} value={job.id}>№{job.id} · {job.address} · {job.time}</option>)}</select></label>}
      {type === "недоступность инженера" && <label className="scheduled-wide">Инженер<select aria-label="Инженер события" value={selectedEntity} onChange={event=>setEntityId(event.target.value)}>{engineers.map(engineer=><option key={engineer.id} value={engineer.id}>{engineer.name} · {engineer.id}</option>)}</select></label>}
      {type === "срочная заявка" && <label className="scheduled-wide">Что сделать<select aria-label="Действие со срочной заявкой" value={urgentMode} onChange={event=>{setUrgentMode(event.target.value as "existing"|"new");setEntityId("");setEditing(undefined);setError("");}}><option value="existing">Повысить приоритет существующей заявки</option><option value="new">Создать новую срочную заявку</option></select></label>}
      {type === "срочная заявка" && urgentMode === "existing" && <label className="scheduled-wide">Какую заявку сделать срочной<select aria-label="Заявка для повышения приоритета" value={selectedEntity} onChange={event=>setEntityId(event.target.value)}>{elevatableJobs.map(job=><option key={job.id} value={job.id}>№{job.id} · {job.address} · окно {job.time}</option>)}</select><small>Приоритет изменится в указанное время. Заявка не создаётся заново.</small></label>}
      {(type === "новая заявка" || (type === "срочная заявка" && urgentMode === "new")) && <>
        <label className="scheduled-wide">Адрес новой заявки<select aria-label="Источник адреса новой заявки" value={location} onChange={event=>setLocation(event.target.value)}><option value="new">Ввести адрес и координаты</option>{jobs.map(job=><option key={job.id} value={job.id}>Взять адрес заявки №{job.id} · {job.address}</option>)}</select><small>Создаётся отдельная заявка с новым номером.</small></label>
        {location === "new" && <><label className="scheduled-wide">Адрес<input value={form.address} onChange={event=>field("address",event.target.value)} /></label><label>Долгота, если адрес не найден<input value={form.lon} onChange={event=>field("lon",event.target.value)} /></label><label>Широта<input value={form.lat} onChange={event=>field("lat",event.target.value)} /></label><label>Зона<select value={form.region} onChange={event=>field("region",event.target.value)}>{["Восток","Юго-восток","Югоцентр"].map(region=><option key={region}>{region}</option>)}</select></label></>}
        <label>Окно с<input type="time" value={form.start} onChange={event=>field("start",event.target.value)} /></label><label>Окно до<input type="time" value={form.end} onChange={event=>field("end",event.target.value)} /></label><label>Длительность, мин<input type="number" min="5" max="480" value={form.service} onChange={event=>field("service",event.target.value)} /></label>
        <label>Навык<select value={skill} onChange={event=>setForm(current=>({...current,skill:event.target.value,equipment:""}))}>{skills.map(value=><option key={value}>{value}</option>)}</select></label>
        <label>Оборудование<select value={equipment} onChange={event=>field("equipment",event.target.value)}>{equipmentOptions.map(value=><option key={value}>{value}</option>)}</select></label>
        <label>Требуемый транспорт<select value={form.transport} onChange={event=>field("transport",event.target.value)}><option value="">Не ограничен</option>{["Автомобиль","Пешком","Велосипед","Общественный транспорт","Служебный вертолёт"].map(value=><option key={value}>{value}</option>)}</select></label>
        <p className="scheduled-wide scheduled-help">Приоритет новой заявки — {type === "срочная заявка" ? "повышенный" : "обычный"}. Оборудование инженеров в течение смены не меняется.</p>
      </>}
    </div><div className="scheduled-actions"><button type="button" className="generator-primary-btn" onClick={()=>void submit()}><Plus size={14} />{creating ? "Проверяем адрес…" : editing ? "Сохранить событие" : "Добавить событие"}</button>{editing && <button type="button" className="generator-ghost-btn" onClick={()=>{setEditing(undefined);setError("");}}>Отменить редактирование</button>}</div></fieldset>
    {error && <p role="alert" className="form-error">{error}</p>}
    <div className="scheduled-list">{[...events].sort((a,b)=>a.time.localeCompare(b.time)).map(event=>{
      const key=eventKey(event), occurred=started && parseTime(event.time)<=time, outcome=occurred ? outcomes[key] : undefined;
      const description=event.job ? `Новая №${event.entityId} · ${event.job.address} · ${event.job.time} · ${event.job.serviceMinutes} мин · ${event.job.kind} · ${event.job.equipment} · транспорт: ${event.job.requiredTransport || "не ограничен"}` : event.type === "отмена заявки" ? `№${event.entityId} · ${cancelJobs.find(job=>job.id===event.entityId)?.address ?? "заявка"}` : event.type === "срочная заявка" ? `Повышение приоритета №${event.entityId} · ${cancelJobs.find(job=>job.id===event.entityId)?.address ?? "заявка"}` : engineers.find(engineer=>engineer.id===event.entityId)?.name ?? event.entityId;
      return <article key={key}><div><strong>{event.time} · {event.type}</strong><p>{description}</p><small>{outcome?.status === "applied" ? "Применено" : outcome?.status === "failed" ? `Не применено: ${outcome.message}` : "Ожидает времени появления"}</small></div><button type="button" disabled={busy} title={occurred ? "Время просмотра вернётся до события, затем можно сохранить изменения" : "Изменить событие"} aria-label={`Изменить событие ${event.time}, ${event.entityId}`} onClick={()=>edit(event)}><Pencil size={16} /></button><button type="button" disabled={busy || occurred} title={occurred ? "Для удаления сначала вернитесь до события по шкале времени" : "Удалить событие"} aria-label={`Удалить событие ${event.time}, ${event.entityId}`} onClick={()=>onRemove(key)}><Trash2 size={16} /></button></article>;
    })}{!events.length && <p className="scheduled-help">Событий пока нет. Можно отменить заявку, повысить её приоритет, создать новую заявку или указать недоступность инженера.</p>}</div>
  </section>;
}
