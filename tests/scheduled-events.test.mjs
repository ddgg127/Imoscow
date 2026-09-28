import assert from "node:assert/strict";
import test from "node:test";
import { eventKey, nextDueEvent, planAtTime, invalidateFutureEvents, scheduledEventChange } from "../lib/scheduled-events.ts";
import { createTzReplanEvent, generateTzDataset, eventsToTzCsv } from "../lib/generator-files.ts";
import { importPlanText } from "../lib/import-data.ts";
import { saveTravel, restoreTravel, createWorkspaceWriter } from "../lib/workspace-storage.ts";
import { fallbackTravel, resultFromRouteOrder } from "../lib/vrptw.ts";
import { cancelJobLocally } from "../lib/temporal-replan.ts";
import { engineerSpeedKmh } from "../lib/transport-speed.ts";

const centers={"Восток":[37.78,55.71],"Юго-восток":[37.67,55.59],"Югоцентр":[37.61,55.65]};
const engineer={id:"E1",name:"Инженер 1",initials:"И1",color:"#6547e7",region:"Восток",start:[37.78,55.71],transport:"Автомобиль",skills:["Локальные работы"],equipment:["Диагностический комплект"],shiftStart:480,shiftEnd:1320};
const job=(id,start=990)=>({id,address:"Москва, тестовая точка",coordinates:[37.78,55.71],region:"Восток",area:"Москва",time:"16:30–20:00",windowStart:start,windowEnd:1200,serviceMinutes:30,kind:"Локальные работы",equipment:"Диагностический комплект",requiredTransport:"",geocodeVerified:true,geocodeQuality:"manual",priority:1,urgency:"normal",engineerId:null,baselineEngineerId:null,tone:"blue",risk:false,executionStatus:"not_started"});
const travel=fallbackTravel(24);
const jobs=[job("0001"),job("0002",1050)];
const initial=resultFromRouteOrder([engineer],jobs,[{engineerId:"E1",jobIds:["0001","0002"]}],{speedKmh:24,travel});
const cancel={type:"отмена заявки",time:"16:00",entityId:"0001"};

test("event activates at 16:00, rewind restores original and replay never schedules it twice",()=>{
  assert.equal(nextDueEvent([cancel],{},959.999),null);
  assert.equal(nextDueEvent([cancel],{},960),cancel);
  const change=scheduledEventChange(cancel,initial,[engineer],[]);
  const changed=cancelJobLocally(initial,[engineer],change.jobs,change.dispatch,24,travel).result;
  const history=[{time:960,before:initial}];
  const outcomes={[eventKey(cancel)]:{time:960,status:"applied",message:""}};
  assert.equal(planAtTime(changed,history,959),initial);
  assert.equal(planAtTime(changed,history,960),changed);
  assert.equal(nextDueEvent([cancel],outcomes,959),null);
  assert.equal(nextDueEvent([cancel],outcomes,1100),null);
  const restored=structuredClone({changed,history,outcomes});
  assert.deepEqual(planAtTime(restored.changed,restored.history,959),initial);
  assert.equal(nextDueEvent([cancel],restored.outcomes,1100),null);
});
test("manual recalculation invalidates future cache but preserves past events",()=>{
  const early={...cancel,time:"10:00",entityId:"0002"};
  const outcomes={[eventKey(early)]:{time:600,status:"applied"},[eventKey(cancel)]:{time:960,status:"applied"}};
  const retained=invalidateFutureEvents(outcomes,[{time:600,before:initial},{time:960,before:initial}],900);
  assert.deepEqual(Object.keys(retained.outcomes),[eventKey(early)]);
  assert.deepEqual(retained.history.map(item=>item.time),[600]);
  assert.equal(nextDueEvent([early,cancel],retained.outcomes,1000),cancel);
});
test("crossing multiple events processes chronological order and stable ties",()=>{
  const early={...cancel,time:"09:00"},same={...cancel,entityId:"0002"};
  const list=[cancel,early,same],outcomes={};
  for(const event of [early,cancel,same]) {
    assert.equal(nextDueEvent(list,outcomes,1200),event);
    outcomes[eventKey(event)]={status:"applied",time:960};
  }
  assert.equal(nextDueEvent(list,outcomes,1200),null);
});
test("failed event is not retried on playback; manual recalculation enables retry",()=>{
  const outcomes={[eventKey(cancel)]:{status:"failed",time:960,message:"offline"}};
  assert.equal(nextDueEvent([cancel],outcomes,1000),null);
  assert.equal(nextDueEvent([cancel],invalidateFutureEvents(outcomes,[],900).outcomes,1000),cancel);
});
test("cancellation rejects active, completed, absent and already cancelled jobs",()=>{
  const stop=initial.routes[0].stops[0];
  assert.throws(()=>scheduledEventChange({...cancel,time:"16:30"},initial,[engineer],[]),/выполняется/);
  assert.throws(()=>scheduledEventChange({...cancel,time:"17:00"},initial,[engineer],[]),/выполнена/);
  assert.throws(()=>scheduledEventChange({...cancel,entityId:"9999"},initial,[engineer],[]),/отсутствует/);
  assert.ok(stop.start===990);
  assert.throws(()=>scheduledEventChange(cancel,{...initial,jobs:initial.jobs.map(j=>({...j,cancelled:true}))},[engineer],[]),/отменена/);
});
test("factory targets selected request/engineer and retains custom urgent parameters",()=>{
  assert.equal(createTzReplanEvent({...cancel,jobs,engineers:[engineer]}).entityId,"0001");
  assert.equal(createTzReplanEvent({type:"недоступность инженера",time:"16:00",entityId:"E1",jobs,engineers:[engineer]}).entityId,"E1");
  const urgent=job("0003",960);
  const event=createTzReplanEvent({type:"срочная заявка",time:"16:00",job:urgent,jobs,engineers:[engineer]});
  assert.equal(event.job.serviceMinutes,30);assert.deepEqual(event.job.coordinates,urgent.coordinates);assert.equal(event.job.priority,2);
  assert.throws(()=>createTzReplanEvent({type:"срочная заявка",time:"21:00",job:urgent,jobs,engineers:[engineer]}),/не помещаются/);
  assert.throws(()=>scheduledEventChange({...event,job:{...event.job,geocodeVerified:false}},initial,[engineer],[]),/не подтверждены/);
  assert.throws(()=>createTzReplanEvent({...cancel,entityId:"9999",jobs,engineers:[engineer]}),/не найдена/);
  assert.throws(()=>createTzReplanEvent({...cancel,jobs,engineers:[engineer],events:[cancel]}),/уже создано/);
  assert.throws(()=>createTzReplanEvent({...cancel,entityId:"0003",time:"15:59",jobs,engineers:[engineer],events:[event]}),/до её появления/);
});
test("an existing request becomes urgent only before work starts; an ordinary event creates a normal request",()=>{
  const elevate=createTzReplanEvent({type:"срочная заявка",time:"16:00",entityId:"0001",jobs,engineers:[engineer]});
  assert.equal(elevate.job,undefined);
  const change=scheduledEventChange(elevate,initial,[engineer],[]);
  assert.equal(change.dispatch.type,"recalculate");
  assert.equal(change.jobs.find(item=>item.id==="0001").priority,2);
  assert.throws(()=>scheduledEventChange({...elevate,time:"16:30"},initial,[engineer],[]),/началась/);
  assert.throws(()=>createTzReplanEvent({...elevate,time:"20:00",jobs,engineers:[engineer]}),/после конца/);
  const ordinary=createTzReplanEvent({type:"новая заявка",time:"16:00",job:job("0003",960),jobs,engineers:[engineer]});
  assert.equal(ordinary.job.priority,1);
  assert.equal(scheduledEventChange(ordinary,initial,[engineer],[]).jobs.find(item=>item.id==="0003").urgency,"normal");
});
test("new ordinary and existing urgent events survive JSON and CSV import",()=>{
  const ordinary=createTzReplanEvent({type:"новая заявка",time:"16:00",job:job("0003",960),jobs,engineers:[engineer]});
  const elevated=createTzReplanEvent({type:"срочная заявка",time:"15:00",entityId:"0002",jobs,engineers:[engineer]});
  const events=[ordinary,elevated];
  for(const imported of [importPlanText(JSON.stringify({jobs,engineers:[engineer],events:events.map(event=>({...event,jobId:event.job ? undefined : event.entityId}))}),"data.json",centers),importPlanText(eventsToTzCsv(events),"events.csv",centers)]) {
    assert.equal(imported.events.length,2);
    assert.equal(imported.events.find(event=>event.type==="новая заявка").job.priority,1);
    assert.equal(imported.events.find(event=>event.type==="срочная заявка").entityId,"0002");
    assert.equal(imported.events.find(event=>event.type==="срочная заявка").job,undefined);
  }
});
test("a normal request created by an event can be raised later, but not before it appears",()=>{
  const ordinary=createTzReplanEvent({type:"новая заявка",time:"16:00",job:job("0003",960),jobs,engineers:[engineer]});
  const elevated=createTzReplanEvent({type:"срочная заявка",time:"16:15",entityId:"0003",jobs,engineers:[engineer],events:[ordinary]});
  assert.equal(elevated.job,undefined);
  assert.throws(()=>createTzReplanEvent({...elevated,time:"15:45",jobs,engineers:[engineer],events:[ordinary]}),/до её появления/);
  assert.throws(()=>createTzReplanEvent({...cancel,entityId:"0003",time:"15:45",jobs,engineers:[engineer],events:[ordinary]}),/до её появления/);
});
test("walking speed is realistic even for an old generated 24 km/h override",()=>{
  assert.equal(engineerSpeedKmh("Пешком",24,24),6);
  assert.equal(engineerSpeedKmh("Пешком",undefined,24),6);
  assert.equal(engineerSpeedKmh("Автомобиль",24,24),24);
  const generated=generateTzDataset({jobs:20,engineers:8,seed:19});
  assert.ok(generated.engineers.filter(item=>item.transport==="Пешком").every(item=>item.speedKmh===undefined));
});
test("JSON and event CSV retain explicit targets and urgent parameters",()=>{
  const urgent=createTzReplanEvent({type:"срочная заявка",time:"16:00",job:job("0003",960),jobs,engineers:[engineer]});
  const events=[cancel,{type:"недоступность инженера",time:"17:00",entityId:"E1"},urgent];
  const json=importPlanText(JSON.stringify({jobs,engineers:[engineer],events:events.map(e=>({type:e.type,time:e.time,jobId:e.type==="отмена заявки" ? e.entityId : undefined,engineerId:e.type==="недоступность инженера" ? e.entityId : undefined,job:e.job}))}),"data.json",centers);
  const csv=importPlanText(eventsToTzCsv(events),"replan_events.csv",centers);
  for(const imported of [json,csv]) {
    assert.equal(imported.events.length,3);
    assert.equal(imported.events.find(e=>e.type==="отмена заявки").entityId,"0001");
    assert.equal(imported.events.find(e=>e.type==="недоступность инженера").entityId,"E1");
    const j=imported.events.find(e=>e.job).job;
    assert.equal(j.windowStart,960);assert.equal(j.serviceMinutes,30);assert.equal(j.equipment,job("x").equipment);assert.equal(j.priority,2);
  }
});
test("generated urgent events have enough window after their appearance",()=>{
  for(const seed of [1,42,78]) {
    const dataset=generateTzDataset({jobs:51,engineers:12,windowMinutes:240,speedKmh:24,urgentEvents:5,seed});
    for(const event of dataset.events.filter(e=>e.job)) {
      const [h,m]=event.time.split(":").map(Number);
      assert.ok(Math.max(h*60+m,event.job.windowStart)+event.job.serviceMinutes<=event.job.windowEnd);
    }
    const imported=importPlanText(eventsToTzCsv(dataset.events),"events.csv",centers);
    for(const event of dataset.events.filter(e=>e.job)) {
      const restored=imported.events.find(e=>e.entityId===event.entityId && e.type===event.type).job;
      assert.equal(restored.kind,event.job.kind);
      assert.equal(restored.equipment,event.job.equipment);
      assert.equal(restored.serviceMinutes,event.job.serviceMinutes);
    }
  }
});
test("import never certifies a saved region-centre fallback as a verified address",()=>{
  const unverified={...job("0001"),geocodeVerified:false,geocodeQuality:"fallback"};
  const imported=importPlanText(JSON.stringify({jobs:[unverified]}),"unverified.json",centers);
  assert.equal(imported.jobs[0].geocodeVerified,false);
  assert.equal(imported.jobs[0].geocodeQuality,"fallback");
});
test("restoring travel preserves distances, durations and transport modes exactly",()=>{
  const points=[[37.78,55.71],[37.79,55.72]],matrix={distanceKm:()=>12.345,durationMin:()=>47.125,knows:()=>true,forTransport:()=>({distanceKm:()=>4.123,durationMin:()=>9.875,knows:()=>false})};
  const restored=restoreTravel(JSON.parse(JSON.stringify(saveTravel(matrix,points,["Велосипед"]))),24);
  assert.equal(restored.distanceKm(...points),12.345);assert.equal(restored.durationMin(...points),47.125);assert.equal(restored.knows(...points),true);
  assert.equal(restored.forTransport("Велосипед").durationMin(...points),9.875);assert.equal(restored.forTransport("Велосипед").knows(...points),false);
  assert.equal(restored.knows(points[0],[37.8,55.8]),false);
  assert.ok(Number.isFinite(restored.durationMin(points[0],[37.8,55.8])));
});
test("storage queue saves cleared scenario last and recovers after write errors",async()=>{
  const saved=[];let release;
  const writer=createWorkspaceWriter(async value=>{if(value==="old") await new Promise(resolve=>release=resolve);if(value==="fail") throw Error("disk");saved.push(value);});
  const old=writer("old");await Promise.resolve();await Promise.resolve();
  const cleared=writer("clear");release();await Promise.all([old,cleared]);
  assert.deepEqual(saved,["old","clear"]);
  await assert.rejects(writer("fail"));await writer("new");assert.deepEqual(saved,["old","clear","new"]);
});
