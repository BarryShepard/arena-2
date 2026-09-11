// Evaluated exclusively in QuickJS; returned dispatch is retained only by host.
// createSpatial is embedded as source text so host and guest share one sweep implementation.
import { createSpatial } from "../engine/spatial.js";
export const bootstrap =
  `function(limits) {
'use strict';
const spatial=(${createSpatial})();
` +
  String.raw`
const LIMITS=Object.freeze(limits), parse=JSON.parse, stringify=JSON.stringify, freeze=Object.freeze;
let character, context, commands=[], nextEntity=0, nextTimer=0;
const finite=Number.isFinite, isArray=Array.isArray;

const timers=new Map();
const setTimer=timers.set.bind(timers), deleteTimer=timers.delete.bind(timers), timerEntries=timers.entries.bind(timers), hasTimer=timers.has.bind(timers);
const timerSize=Object.getOwnPropertyDescriptor(Map.prototype,'size').get.bind(timers);
const ownDefine=Object.defineProperty;
ownDefine(globalThis,'defineCharacter',{value:defineCharacter,configurable:true});
function defineCharacter(c){if(character)throw Error('Character already defined');character=c;}
function check(v,name){if(typeof v==='number'){if(!finite(v))throw Error('Invalid finite '+name);}else if(v&&typeof v==='object')for(const k of Object.keys(v))check(v[k],k);}
function emit(op,data){if(commands.length>=LIMITS.commands)throw Error('Command budget exceeded');check(data,op);commands.push({op,...data});}
const STEP_KINDS=['wait','effect','sound','shake','run'];
const api={
 entity:id=>context.world.entities.find(e=>e.id===id)||null,
 queryCircle:({x,y,radius})=>context.world.entities.filter(e=>Math.hypot(e.x-x,e.y-y)<=radius+e.radius),
 lineOfSight:(from,to)=>!context.world.obstacles.some(r=>{
 for(const v of [from.x,from.y,to.x,to.y])if(!finite(v))throw Error('Invalid line segment');
 let lo=0,hi=1;for(const [a,b,min,max]of [[from.x,to.x,r.x,r.x+r.w],[from.y,to.y,r.y,r.y+r.h]]){const d=b-a;if(d===0){if(a<min||a>max)return false;}else{const t1=(min-a)/d,t2=(max-a)/d;lo=Math.max(lo,Math.min(t1,t2));hi=Math.min(hi,Math.max(t1,t2));if(lo>hi)return false;}}return true;
 }),
 raycast:({from,to,radius=0,ignore=[]}={})=>{
  for(const v of [from?.x,from?.y,to?.x,to?.y,radius])if(!finite(v))throw Error('Invalid raycast');
  if(radius<0||!isArray(ignore))throw Error('Invalid raycast');
  return spatial.sweep({x:from.x,y:from.y},{x:to.x,y:to.y},radius,context.world,ignore);
 },
 spawn:spec=>{const id=context.ownerId+':'+(++nextEntity);emit('spawn',{id,spec});return id;},
 patch:(id,changes)=>emit('patch',{id,changes}),destroy:id=>emit('destroy',{id}),
 damage:(id,amount,sourceId)=>emit('damage',{id,amount,sourceId}),
 impulse:(id,vector)=>emit('impulse',{id,vector}),heal:(id,amount)=>emit('heal',{id,amount}),
 effect:spec=>emit('effect',{spec}),sound:(asset,options={})=>emit('sound',{asset,options}),
 shake:(amount,seconds)=>emit('shake',{amount,seconds}),slot:(index,state)=>emit('slot',{index,state}),
 after:(seconds,callback,options)=>addTimer(seconds,callback,false,options),every:(seconds,callback,options)=>addTimer(seconds,callback,true,options),
 sequence:(steps,options)=>addSequence(steps,options),cancel:id=>deleteTimer(id)
};
// options.entityId: undefined → context entity, null → owner scope, string → that entity.
function scope(options){if(options===undefined)options={};if(!options||typeof options!=='object')throw Error('Invalid timer options');const id=options.entityId===undefined?context.entityId:options.entityId;if(id!==null&&typeof id!=='string')throw Error('Invalid timer options');return id;}
function reserve(){if(timerSize()>=LIMITS.timers)throw Error('Timer budget exceeded');return ++nextTimer;}
// after(0, cb) fires next tick (like {wait:0}); every() needs a positive period.
function addTimer(seconds,callback,repeat,options){if(!finite(seconds)||seconds<0||(repeat&&seconds===0)||typeof callback!=='function')throw Error('Invalid timer');const entityId=scope(options),id=reserve();setTimer(id,{at:context.world.time+seconds,seconds,callback,repeat,entityId});return id;}
function addSequence(steps,options){
 if(!isArray(steps)||steps.length>64)throw Error('Invalid sequence');
 for(const s of steps){
  if(!s||typeof s!=='object')throw Error('Invalid sequence');
  const keys=Object.keys(s).filter(k=>k!=='options');
  if(keys.length!==1||!STEP_KINDS.includes(keys[0])||('options' in s&&keys[0]!=='sound'))throw Error('Invalid sequence');
  if(keys[0]==='wait'&&!(finite(s.wait)&&s.wait>=0))throw Error('Invalid sequence');
  if(keys[0]==='run'&&typeof s.run!=='function')throw Error('Invalid sequence');
  if(keys[0]==='shake'&&(!s.shake||typeof s.shake!=='object'))throw Error('Invalid sequence');
 }
 const entityId=scope(options),id=reserve(),seq={steps:[...steps],index:0,at:0,entityId};
 setTimer(id,seq);runSteps(id,seq);return id;
}
function runSteps(id,seq){
 while(hasTimer(id)&&seq.index<seq.steps.length){
  const s=seq.steps[seq.index++];
  if('wait' in s){seq.at=context.world.time+s.wait;return;}
  if('effect' in s)api.effect(s.effect);else if('sound' in s)api.sound(s.sound,s.options);else if('shake' in s)api.shake(s.shake.amount,s.shake.seconds);else s.run(context);
 }
 deleteTimer(id);
}
freeze(api);
return function(json){const p=parse(json);
if(p.kind==='seal'){delete globalThis.defineCharacter;if(!character)throw Error('Missing defineCharacter');return '{}';}
commands=[];
const entityId=p.kind==='event'?(p.event.type==='death'?null:p.event.entityId??null):p.selfId??null;
const base={...p,api,entityId};context=base;let response=null;
 if(p.kind==='spawn')character.spawn?.(context);
 if(p.kind==='tick'){
  const alive=Object.create(null);for(const e of p.world.entities)alive[e.id]=true;
  for(const [id,t] of [...timerEntries()]){
   if(!hasTimer(id))continue; // cancelled by an earlier callback this tick
   if(t.entityId!==null&&!alive[t.entityId]){deleteTimer(id);continue;}
   if(t.at>p.world.time)continue;
   context={...base,entityId:t.entityId};
   if(t.steps)runSteps(id,t);else{if(t.repeat)t.at=p.world.time+t.seconds;else deleteTimer(id);t.callback(context);}
  }
  context=base;
  for(let slot=0;slot<4;slot++){const s=p.input.slots[slot];for(const [flag,phase]of [['pressed','press'],['held','hold'],['released','release']])if(s[flag])character.ability?.(context,{slot,phase});}
  character.update?.(context,p.dt);
 }
 // Responses cross the same JSON bridge as commands: NaN/Infinity would become null and be silently ignored by the host.
 if(p.kind==='event'){response=character.event?.(context,p.event)??null;check(response,'response');}
 const out=stringify({commands,response});if(out.length>LIMITS.json)throw Error('Output JSON budget exceeded');return out;
};

}`;
