import type { EvaluationCase, PrivateEvaluationReport, Queue, RoutingOutput, Ticket } from './types';
type Blueprint = { subject: string; body: string; expected: RoutingOutput };
export const DEMO_SEED = 'evalvault-demo-v1';
const SUITE_VERSION = 'support-routing-v1';
const CANDIDATE_CONFIG: Record<string, string> = {
  'fast-keyword': 'keyword-v1',
  'contextual-rules': 'contextual-rules-v1',
};
const blueprints: Blueprint[] = [
 {subject:'Duplicate charge on invoice',body:'I was charged twice and need a refund.',expected:{queue:'billing',urgency:'high'}},
 {subject:'Invoice tax line',body:'Please explain the tax line on my monthly bill.',expected:{queue:'billing',urgency:'normal'}},
 {subject:'Charge term in a technical question',body:'This is not a billing issue; the API returns a server error after deploy.',expected:{queue:'technical',urgency:'high'}},
 {subject:'API export setting',body:'Where does the CSV export setting live?',expected:{queue:'technical',urgency:'normal'}},
 {subject:'API mention in an account question',body:'This is not a technical issue; my login is blocked after attempts.',expected:{queue:'account',urgency:'high'}},
 {subject:'Change profile email',body:'I would like to update the email on my account.',expected:{queue:'account',urgency:'normal'}},
 {subject:'Login mention in security incident',body:'This is not an account issue; we suspect unauthorized access and need immediate help.',expected:{queue:'escalate',urgency:'high'}},
 {subject:'Security wording in invoice question',body:'This is not a security incident; please reverse the duplicate charge.',expected:{queue:'billing',urgency:'normal'}},
];
function hash(seed:string):number { let n=2166136261; for(const c of seed)n=Math.imul(n^c.charCodeAt(0),16777619); return n>>>0; }
function blueprint(seed:string,i:number):Blueprint { return blueprints[hash(`${seed}:${i}`)%blueprints.length]; }
function makeCases(seed:string):Array<{input:Ticket;expected:RoutingOutput}> { return Array.from({length:32},(_,i)=>{const b=blueprint(seed,i);return {input:{id:`${seed}-${String(i+1).padStart(2,'0')}`,subject:b.subject,body:b.body},expected:b.expected};}); }
/** Deterministic baselines for the protocol demo, not production model claims. */
export function routeTicket(ticket:Ticket,candidateId:string):RoutingOutput {
 const text=`${ticket.subject} ${ticket.body}`.toLowerCase();
 if(candidateId==='fast-keyword'){let queue:Queue;text.includes('not a billing issue')?queue='technical':queue=text.includes('invoice')||text.includes('charge')||text.includes('bill')||text.includes('refund')?'billing':text.includes('api')||text.includes('export')||text.includes('server')?'technical':text.includes('login')||text.includes('email')||text.includes('profile')?'account':'escalate';return {queue,urgency:text.includes('immediate')||text.includes('error')||text.includes('blocked')||text.includes('duplicate charge')&&!text.includes('not a security incident')?'high':'normal'};}
 if(candidateId==='contextual-rules'){const neg=(term:string)=>text.includes(`not a ${term}`)||text.includes(`not an ${term}`);const security=(text.includes('unauthorized')||text.includes('security'))&&!neg('security incident');const outage=text.includes('server error')||text.includes('api returns')||text.includes('immediate');const queue:Queue=security?'escalate':text.includes('not a billing issue')?'technical':text.includes('not a technical issue')?'account':text.includes('refund')||text.includes('duplicate charge')?'billing':text.includes('login')||text.includes('blocked')||text.includes('email')||text.includes('profile')?'account':text.includes('invoice')||text.includes('bill')?'billing':text.includes('api')||text.includes('export')||outage?'technical':'escalate';return {queue,urgency:security||outage||text.includes('blocked')||text.includes('duplicate charge')&&!text.includes('not a security incident')?'high':'normal'};}
 throw new Error(`Unknown candidate: ${candidateId}`);
}
export function createEvaluation(seed:string,candidateId:string):PrivateEvaluationReport { const rows:EvaluationCase[]=makeCases(seed).map(({input,expected})=>{const started=typeof performance!=='undefined'?performance.now():Date.now();const actual=routeTicket(input,candidateId);const ended=typeof performance!=='undefined'?performance.now():Date.now();return {id:input.id,input,expected,actual,latencyMs:Math.max(0,ended-started),correct:actual.queue===expected.queue&&actual.urgency===expected.urgency};});const sorted=rows.map(x=>x.latencyMs).sort((a,b)=>a-b);const pct=(p:number)=>sorted[Math.min(sorted.length-1,Math.floor((sorted.length-1)*p))];return {evaluationSeed:seed,candidateId,candidateConfig:candidateId==='fast-keyword'?'keyword-v1':'contextual-rules-v1',suiteVersion:'support-routing-v1',observedAt:Date.now(),sampleCount:rows.length,cases:rows,metrics:{accuracy:rows.filter(x=>x.correct).length/rows.length,p50Ms:pct(.5),p95Ms:pct(.95)}}; }
export function validateReport(report:PrivateEvaluationReport, expectedSeed:string=DEMO_SEED):{valid:boolean;errors:string[];metrics:PrivateEvaluationReport['metrics']} {
 const errors:string[]=[];
 const rows=Array.isArray((report as any)?.cases)?report.cases:[];
 const expectedCases=makeCases(expectedSeed);
 if(report?.evaluationSeed!==expectedSeed) errors.push('evaluation seed mismatch');
 if(report?.suiteVersion!==SUITE_VERSION) errors.push('unsupported suite');
 if(!Object.prototype.hasOwnProperty.call(CANDIDATE_CONFIG,report?.candidateId??'')) errors.push('unsupported candidate');
 if(report?.candidateConfig!==CANDIDATE_CONFIG[report?.candidateId]) errors.push('candidate config mismatch');
 if(typeof report?.observedAt!=='number'||!Number.isFinite(report.observedAt)||report.observedAt<0) errors.push('observed timestamp invalid');
 if(report?.sampleCount!==32||rows.length!==32) errors.push('report must contain exactly 32 cases');
 const seen=new Set<string>();
 for(let i=0;i<32;i++) {
  const row:any=rows[i]; const fixture=expectedCases[i];
  if(!row) { errors.push(`missing case ${fixture.input.id}`); continue; }
  if(seen.has(row.id)) errors.push(`duplicate case ${row.id}`); seen.add(row.id);
  if(row.id!==fixture.input.id) errors.push(`unexpected case id ${String(row.id)}`);
  if(JSON.stringify(row.input)!==JSON.stringify(fixture.input)||JSON.stringify(row.expected)!==JSON.stringify(fixture.expected)) errors.push(`case ${row.id} input/expected mismatch`);
  let actual:RoutingOutput|undefined;
  try { actual=routeTicket(row.input,report.candidateId); } catch { errors.push(`case ${row.id} candidate mismatch`); }
  if(!actual||JSON.stringify(actual)!==JSON.stringify(row.actual)) errors.push(`case ${row.id} output mismatch`);
  const correct=!!actual&&actual.queue===fixture.expected.queue&&actual.urgency===fixture.expected.urgency;
  if(row.correct!==correct) errors.push(`case ${row.id} score mismatch`);
  if(typeof row.latencyMs!=='number'||!Number.isFinite(row.latencyMs)||row.latencyMs<0) errors.push(`case ${row.id} latency invalid`);
 }
 const validLatencies=rows.map((x:any)=>x?.latencyMs).filter((x:any)=>typeof x==='number'&&Number.isFinite(x)&&x>=0).sort((a:number,b:number)=>a-b);
 const pct=(p:number)=>validLatencies.length?validLatencies[Math.min(validLatencies.length-1,Math.floor((validLatencies.length-1)*p))]:0;
 const metrics={accuracy:rows.length===32?rows.filter((x:any)=>x.correct===true).length/32:0,p50Ms:pct(.5),p95Ms:pct(.95)};
 if(!report?.metrics||report.metrics.accuracy!==metrics.accuracy||report.metrics.p50Ms!==metrics.p50Ms||report.metrics.p95Ms!==metrics.p95Ms) errors.push('aggregate metrics mismatch');
 return {valid:errors.length===0,errors,metrics};
}
