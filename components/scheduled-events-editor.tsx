"use client";
import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { BackendGeocodingProvider, type Coordinate } from "@/lib/map-providers";
import { parseTime } from "@/lib/data-editor";
import { createTzReplanEvent, type TzReplanEvent } from "@/lib/generator-files";
import { ALL_SKILLS, SKILL_EQUIPMENT_POOLS } from "@/lib/domain";
import { eventKey, type EventOutcomes } from "@/lib/scheduled-events";
import { minutesLabel, type Engineer, type Job, type Region } from "@/lib/vrptw";

export type EventEditorDraft = { type:TzReplanEvent["type"]; eventTime:string; entityId:string; editing?:string; location:string; form:{ address:string;lon:string;lat:string;region:Region;start:string;end:string;service:string;skill:string;equipment:string;transport:string } };

export function ScheduledEventsEditor({ jobs, engineers, events, outcomes, time, started, busy, draft, onDraft, onSave, onRemove }: {
  jobs: Job[]; engineers: Engineer[]; events: TzReplanEvent[]; outcomes: EventOutcomes; time: number; started: boolean; busy: boolean;
  draft:EventEditorDraft | null; onDraft:(value:EventEditorDraft)=>void;
  onSave: (event:TzReplanEvent, oldKey?:string) => void; onRemove: (key:string) => void;
}) {
  const [type,setType] = useState<TzReplanEvent["type"]>(draft?.type ?? "отмена заявки");
  const [eventTime,setEventTime] = useState(draft?.eventTime ?? "16:00");
  const [entityId,setEntityId] = useState(draft?.entityId ?? "");
  const [editing,setEditing] = useState<string | undefined>(draft?.editing);
  const [error,setError] = useState("");
  const [creating,setCreating] = useState(false);
  const [location,setLocation] = useState(draft?.location ?? jobs[0]?.id ?? "new");
  const [form,setForm] = useState(draft?.form ?? { address:"", lon:"", lat:"", region:"Восток" as Region, start:"16:00", end:"18:00", service:"60", skill:"", equipment:"", transport:"" });
  useEffect(()=>onDraft({type,eventTime,entityId,editing,location,form}),[type,eventTime,entityId,editing,location,form,onDraft]);
  const skills = [...new Set([...ALL_SKILLS,...engineers.flatMap(engineer=>engineer.skills),...jobs.map(job=>job.kind),...(form.skill ? [form.skill] : [])])];
  const skill = form.skill || skills[0] || "Локальные работы";
  const equipmentOptions = [...new Set([...(SKILL_EQUIPMENT_POOLS[skill] ?? []), ...jobs.filter(job => job.kind === skill).map(job => job.equipment), ...engineers.filter(engineer => engineer.skills.includes(skill)).flatMap(engineer => engineer.equipmentOptions ?? engineer.equipment)])];
  const equipment = form.equipment || equipmentOptions[0] || "Диагностический комплект";
  const cancelJobs = [...jobs, ...events.flatMap(event => event.job ? [event.job] : [])];
  const selectedEntity = entityId || (type === "отмена заявки" ? cancelJobs[0]?.id : engineers[0]?.id) || "";
  const edit = (event:TzReplanEvent) => {
    setEditing(eventKey(event)); setType(event.type); setEventTime(event.time); setEntityId(event.entityId); setError("");
    if (event.job) { const job=event.job; setLocation("new"); setForm({ address:job.address, lon:String(job.coordinates[0]), lat:String(job.coordinates[1]), region:job.region, start:minutesLabel(job.windowStart), end:minutesLabel(job.windowEnd), service:String(job.serviceMinutes), skill:job.kind, equipment:job.equipment, transport:job.requiredTransport }); }
  };
  const submit = async () => {
    setError("");
    const minute = parseTime(eventTime);
    if (!Number.isFinite(minute) || minute < 450 || minute > 1320) { setError("Укажите время появления события с 07:30 до 22:00."); return; }
    if (started && minute < Math.floor(time)) { setError("Событие нельзя добавить в прошлое. Сначала переместите время просмотра к моменту до события."); return; }
    setCreating(true);
    try {
      let job:Job | undefined;
      if (type === "срочная заявка") {
        const start=parseTime(form.start), end=parseTime(form.end), service=Number(form.service);
        if (!Number.isFinite(start) || !Number.isFinite(end) || start < 450 || end > 1320 || end <= start || end <= minute || !Number.isInteger(service) || service < 5 || service > 480 || Math.max(start,minute) + service > end) throw new Error("Проверьте окно и длительность: работы должны помещаться после появления заявки, до 22:00.");
        const known = jobs.find(item => item.id === location);
        let coordinates:Coordinate | null = known?.geocodeVerified ? known.coordinates : null;
        const address=known?.address ?? form.address.trim();
        if (!address) throw new Error("Укажите адрес срочной заявки.");
        if (!known && (form.lon.trim() || form.lat.trim())) {
          const lon=Number(form.lon.replace(",",".")),lat=Number(form.lat.replace(",","."));
          if (!form.lon.trim() || !form.lat.trim() || !Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon)>180 || Math.abs(lat)>90) throw new Error("Укажите обе корректные координаты.");
          coordinates=[lon,lat];
        } else if (!coordinates) coordinates=await new BackendGeocodingProvider("nominatim").geocode(address);
        if (!coordinates) throw new Error("Адрес не найден. Уточните его или задайте координаты вручную.");
        const usedIds = new Set(cancelJobs.map(item => item.id));
        let number = Math.max(0,...cancelJobs.map(item => Number(item.id)).filter(Number.isFinite)) + 1;
        while (usedIds.has(String(number).padStart(4,"0"))) number++;
        job = { id: events.find(event=>eventKey(event)===editing && event.type==="срочная заявка")?.entityId ?? String(number).padStart(4,"0"), address, coordinates, region:known?.region ?? form.region, area:known?.area ?? form.region, time:`${form.start}–${form.end}`, windowStart:start, windowEnd:end, serviceMinutes:service, kind:skill, workType:skill, equipment, requiredTransport:form.transport, priority:2, urgency:"urgent", engineerId:null, baselineEngineerId:null, tone:"amber", risk:false, source:"Событие генератора", status:"Новая", executionStatus:"not_started", geocodeVerified:true, geocodeQuality:known?.geocodeVerified ? known.geocodeQuality : (form.lon && !known ? "manual" : "street"), normSource:"введено пользователем" };
      }
      if (type !== "срочная заявка" && !selectedEntity) throw new Error("Выберите заявку или инженера.");
      const event=createTzReplanEvent({ type, time:eventTime, entityId:type === "срочная заявка" ? undefined : selectedEntity, job, jobs, engineers, events:events.filter(event => eventKey(event)!==editing) });
      if (events.some(item=>eventKey(item)!==editing && eventKey(item)===eventKey(event))) throw new Error("Такое событие уже добавлено.");
      onSave(event,editing); setEditing(undefined);
    } catch (error) { setError(error instanceof Error ? error.message : "Не удалось создать событие"); }
    finally { setCreating(false); }
  };
  const field = (key:keyof typeof form, value:string) => setForm(current => ({ ...current, [key]:value }));
  return <section className="scheduled-editor" aria-label="Настройка событий сценария"><p className="scheduled-help">Укажите, что произойдёт и во сколько. Событие применяется автоматически при достижении этого времени на шкале просмотра. До него заявки и назначения остаются прежними.</p>
    <fieldset disabled={busy || creating}><div className="scheduled-fields">
      <label>Тип события<select value={type} onChange={event => { setType(event.target.value as TzReplanEvent["type"]); setEntityId(""); }}><option>отмена заявки</option><option>недоступность инженера</option><option>срочная заявка</option></select></label>
      <label>Время появления<input aria-label="Время появления события" type="time" min="07:30" max="22:00" value={eventTime} onChange={event => setEventTime(event.target.value)} /></label>
      {type === "отмена заявки" && <label className="scheduled-wide">Отменяемая заявка<select aria-label="Отменяемая заявка" value={selectedEntity} onChange={event=>setEntityId(event.target.value)}>{cancelJobs.map(job => <option key={job.id} value={job.id}>№{job.id} · {job.address} · {job.time}</option>)}</select></label>}
      {type === "недоступность инженера" && <label className="scheduled-wide">Инженер<select aria-label="Инженер события" value={selectedEntity} onChange={event=>setEntityId(event.target.value)}>{engineers.map(engineer=><option key={engineer.id} value={engineer.id}>{engineer.name} · {engineer.id}</option>)}</select></label>}
      {type === "срочная заявка" && <>
        <label className="scheduled-wide">Место работ<select value={location} onChange={event=>setLocation(event.target.value)}><option value="new">Новый адрес</option>{jobs.map(job=><option key={job.id} value={job.id}>{job.address} · точка №{job.id}</option>)}</select></label>
        {location === "new" && <><label className="scheduled-wide">Адрес<input value={form.address} onChange={event=>field("address",event.target.value)} /></label><label>Долгота, если адрес не найден<input value={form.lon} onChange={event=>field("lon",event.target.value)} /></label><label>Широта<input value={form.lat} onChange={event=>field("lat",event.target.value)} /></label><label>Зона<select value={form.region} onChange={event=>field("region",event.target.value)}>{["Восток","Юго-восток","Югоцентр"].map(region=><option key={region}>{region}</option>)}</select></label></>}
        <label>Окно с<input type="time" value={form.start} onChange={event=>field("start",event.target.value)} /></label><label>Окно до<input type="time" value={form.end} onChange={event=>field("end",event.target.value)} /></label><label>Длительность, мин<input type="number" min="5" max="480" value={form.service} onChange={event=>field("service",event.target.value)} /></label>
        <label>Навык<select value={skill} onChange={event=>setForm(current=>({...current,skill:event.target.value,equipment:""}))}>{skills.map(value=><option key={value}>{value}</option>)}</select></label>
        <label>Оборудование<select value={equipment} onChange={event=>field("equipment",event.target.value)}>{equipmentOptions.map(value=><option key={value}>{value}</option>)}</select></label>
        <label>Требуемый транспорт<select value={form.transport} onChange={event=>field("transport",event.target.value)}><option value="">Не ограничен</option>{["Автомобиль","Пешком","Велосипед","Общественный транспорт","Служебный вертолёт"].map(value=><option key={value}>{value}</option>)}</select></label>
        <p className="scheduled-wide scheduled-help">Приоритет новой заявки — повышенный. Выданное инженерам оборудование в течение смены не меняется.</p>
      </>}
    </div><div className="scheduled-actions"><button type="button" className="generator-primary-btn" onClick={()=>void submit()}><Plus size={14} />{creating ? "Проверяем адрес…" : editing ? "Сохранить событие" : "Добавить событие"}</button>{editing && <button type="button" className="generator-ghost-btn" onClick={()=>{setEditing(undefined);setError("");}}>Отменить редактирование</button>}</div></fieldset>
    {error && <p role="alert" className="form-error">{error}</p>}
    <div className="scheduled-list">{[...events].sort((a,b)=>a.time.localeCompare(b.time)).map(event=>{
      const key=eventKey(event), occurred=started && parseTime(event.time)<=time, outcome=occurred ? outcomes[key] : undefined;
      const description=event.job ? `${event.job.address} · ${event.job.time} · ${event.job.serviceMinutes} мин · ${event.job.kind} · ${event.job.equipment} · транспорт: ${event.job.requiredTransport || "не ограничен"}` : event.type === "отмена заявки" ? `№${event.entityId} · ${cancelJobs.find(job=>job.id===event.entityId)?.address ?? "заявка"}` : engineers.find(engineer=>engineer.id===event.entityId)?.name ?? event.entityId;
      return <article key={key}><div><strong>{event.time} · {event.type}</strong><p>{description}</p><small>{outcome?.status === "applied" ? "Применено" : outcome?.status === "failed" ? `Не применено: ${outcome.message}` : "Ожидает времени появления"}</small></div><button type="button" disabled={busy || occurred} aria-label={`Изменить событие ${event.time}, ${event.entityId}`} onClick={()=>edit(event)}><Pencil size={16} /></button><button type="button" disabled={busy || occurred} aria-label={`Удалить событие ${event.time}, ${event.entityId}`} onClick={()=>onRemove(key)}><Trash2 size={16} /></button></article>;
    })}{!events.length && <p className="scheduled-help">Событий пока нет. Добавьте отмену конкретной заявки, недоступность инженера или новую срочную заявку.</p>}</div>
  </section>;
}
