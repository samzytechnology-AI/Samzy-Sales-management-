"use client";

import { FormEvent, useEffect, useState } from "react";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

type Health = { aiReady?: boolean; providers?: Array<{slot:string;provider:string|null;model:string|null;configured:boolean}>; supabaseConfigured?: boolean; outboundEnabled?: boolean };
type ChatMessage = { role: "user" | "assistant"; content: string; id: number };\ntype WorkspaceData = { summary?: { prospects:number; clients:number; activeProjects:number; pendingApprovals:number; incomeNgn:number; expensesNgn:number; netNgn:number }; prospects?: any[]; clients?: any[]; projects?: any[]; products?: any[]; approvals?: any[]; finance?: any[]; outreach?: any[] };

function getBrowserSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && key ? createClient(url, key) : null;
}

const nav = [
  ["⌂","Overview"],["✳","AI General Manager"],["◎","Leads & CRM"],["♙","Clients"],
  ["▣","Projects"],["⌘","Product Registry"],["↗","Sales & Outreach"],["✓","Approvals"],
  ["₦","Finance"],["⚙","Settings"],
];

const starters = [
  "Give me a complete briefing on the company.",
  "What should the company prioritise today?",
  "Review our sales opportunities and identify gaps.",
  "Prepare a human, personalised outreach draft. Do not send it.",
];

export default function Home() {
  const [active,setActive] = useState("Overview");
  const [health,setHealth] = useState<Health|null>(null);\n  const [workspace,setWorkspace] = useState<WorkspaceData|null>(null);\n  const [workspaceBusy,setWorkspaceBusy] = useState(false);\n  const [workspaceError,setWorkspaceError] = useState("");\n  const [saveBusy,setSaveBusy] = useState(false);
  const [email,setEmail] = useState("");
  const [password,setPassword] = useState("");
  const [orgId,setOrgId] = useState("");
  const [conversationId,setConversationId] = useState<string|null>(null);
  const [token,setToken] = useState("");
  const [authText,setAuthText] = useState("");
  const [draft,setDraft] = useState("");
  const [busy,setBusy] = useState(false);
  const [messages,setMessages] = useState<ChatMessage[]>([
    {id:1,role:"assistant",content:"Welcome to the Samzy Technology command centre. I am your AI General Manager interface. Connect the secure company workspace to begin. I can help analyse operations, prepare plans, research opportunities and draft client communications. I will clearly distinguish verified company information from anything that is not yet connected."}
  ]);

  useEffect(()=>{
    fetch("/api/health",{cache:"no-store"}).then(r=>r.json()).then(setHealth).catch(()=>setHealth(null));
    const client=getBrowserSupabase();
    if(client) client.auth.getSession().then(({data})=>{if(data.session?.access_token)setToken(data.session.access_token);});
  },[]);

  useEffect(()=>{
    if(!token||!orgId.trim())return;
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orgId.trim()))return;
    let cancelled=false;
    fetch("/api/ai/run",{method:"GET",headers:{Authorization:`Bearer ${token}`,"x-organization-id":orgId.trim()},cache:"no-store"})
      .then(async response=>{const data=await response.json();if(!response.ok)throw new Error(data.error??"Could not restore chat history.");return data;})
      .then(data=>{if(cancelled)return;setConversationId(data.conversationId??null);if(Array.isArray(data.messages)&&data.messages.length){setMessages(data.messages.map((m:{id:string;role:"user"|"assistant";content:string},index:number)=>({id:Date.now()+index,role:m.role==="user"?"user":"assistant",content:m.content})));}})
      .catch(()=>{if(!cancelled)setAuthText("Workspace connected, but previous chat history could not be restored.");});
    return ()=>{cancelled=true;};
  },[token,orgId]);

  useEffect(()=>{
    if(!token||!orgId.trim()||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orgId.trim())){setWorkspace(null);return;}
    let cancelled=false;
    const moduleKey:Record<string,string>={"Leads & CRM":"prospects","Clients":"clients","Projects":"projects","Product Registry":"products","Approvals":"approvals","Finance":"finance","Sales & Outreach":"outreach"};
    setWorkspaceBusy(true);setWorkspaceError("");
    fetch(`/api/workspace?module=${moduleKey[active]??"overview"}`,{headers:{Authorization:`Bearer ${token}`,"x-organization-id":orgId.trim()},cache:"no-store"})
      .then(async response=>{const data=await response.json();if(!response.ok)throw new Error(data.error??"Company data could not be loaded.");return data;})
      .then(data=>{if(!cancelled)setWorkspace(data);})
      .catch(err=>{if(!cancelled)setWorkspaceError(err instanceof Error?err.message:"Company data could not be loaded.");})
      .finally(()=>{if(!cancelled)setWorkspaceBusy(false);});
    return ()=>{cancelled=true;};
  },[token,orgId,active]);

  async function submitModuleForm(event:FormEvent<HTMLFormElement>, type:"client"|"project"|"prospect"|"finance"|"approval"){
    event.preventDefault();if(!token||!orgId.trim()||saveBusy)return;
    const form=event.currentTarget;
    const fields=Object.fromEntries(new FormData(form).entries()) as Record<string,string>;
    const payload:Record<string,unknown>={type,...fields};
    if(type==="finance")payload.amount_ngn=Number(fields.amount_ngn);
    if(type==="project"&&fields.quoted_amount_ngn)payload.quoted_amount_ngn=Number(fields.quoted_amount_ngn);
    for(const key of ["email","website_url","due_at","occurred_at","quoted_amount_ngn"])if(payload[key]==="")delete payload[key];
    setSaveBusy(true);setWorkspaceError("");
    try{
      const response=await fetch("/api/workspace",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`,"x-organization-id":orgId.trim()},body:JSON.stringify(payload)});
      const result=await response.json();if(!response.ok)throw new Error(result.error??"Record could not be saved.");
      form.reset();
      const moduleKey:Record<string,string>={client:"clients",project:"projects",prospect:"prospects",finance:"finance",approval:"approvals"};
      const refreshed=await fetch(`/api/workspace?module=${moduleKey[type]}`,{headers:{Authorization:`Bearer ${token}`,"x-organization-id":orgId.trim()},cache:"no-store"});
      const data=await refreshed.json();if(!refreshed.ok)throw new Error(data.error??"Record saved, but refresh failed.");
      setWorkspace(data);
    }catch(err){setWorkspaceError(err instanceof Error?err.message:"Record could not be saved.");}
    finally{setSaveBusy(false);}
  }

  async function decideApproval(id:string,decision:"approved"|"rejected"){
    if(!token||!orgId.trim())return;
    setSaveBusy(true);setWorkspaceError("");
    try{
      const response=await fetch("/api/workspace",{method:"PATCH",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`,"x-organization-id":orgId.trim()},body:JSON.stringify({id,decision})});
      const result=await response.json();if(!response.ok)throw new Error(result.error??"Approval decision failed.");
      const refreshed=await fetch("/api/workspace?module=approvals",{headers:{Authorization:`Bearer ${token}`,"x-organization-id":orgId.trim()},cache:"no-store"});
      const data=await refreshed.json();if(!refreshed.ok)throw new Error(data.error??"Approval updated but list refresh failed.");
      setWorkspace(data);
    }catch(err){setWorkspaceError(err instanceof Error?err.message:"Approval decision failed.");}
    finally{setSaveBusy(false);}
  }

  function naira(value:number){return new Intl.NumberFormat("en-NG",{style:"currency",currency:"NGN",maximumFractionDigits:0}).format(value??0);}

  async function signIn(e:FormEvent){
    e.preventDefault(); setAuthText("");
    const client=getBrowserSupabase();
    if(!client){setAuthText("Supabase browser authentication is not configured. Add the public Supabase URL and anon key to the environment.");return;}
    if(!orgId.trim()){setAuthText("Enter the Business Command Centre organisation UUID.");return;}
    const {data,error}=await client.auth.signInWithPassword({email,password});
    if(error||!data.session){setAuthText(error?.message??"Sign-in failed.");return;}
    setToken(data.session.access_token); setAuthText("Secure session connected.");
  }

  async function send(text?:string, task: "business_advice" | "prospect_discovery" | "company_research" | "lead_qualification" | "outreach_draft" | "reply_analysis" = "business_advice"){
    const question=(text??draft).trim();
    if(!question||busy)return;
    setMessages(old=>[...old,{id:Date.now(),role:"user",content:question}]);
    setDraft(""); setBusy(true);
    if(!token||!orgId.trim()||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orgId.trim())){
      setMessages(old=>[...old,{id:Date.now()+1,role:"assistant",content:"I have received your instruction, but the secure company workspace is not connected. Sign in and enter the organisation UUID first. I will not invent company records or pretend an action has been completed."}]);
      setBusy(false);return;
    }
    try{
      const response=await fetch("/api/ai/run",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`,"x-organization-id":orgId.trim()},body:JSON.stringify({
        task,objective:question,
        ...(conversationId?{conversationId}:{}),
        context:{
          product:"Samzy Business Command Centre",
          company:"Samzy Technology Limited",
          conversationHistory:messages.slice(-12).map(m=>({role:m.role,content:m.content})),
          mandatoryRules:[
            "Act as the company's internal AI General Manager.",
            "Use approved company memory and verified evidence; state when requested data is unavailable.",
            "For all client-facing communication, speak only as Samzy Technology Limited. Never reveal or insert the founder's personal name.",
            "Humanize all client-facing writing: natural, warm, specific, thoughtful, concise and professionally conversational. Avoid robotic or generic AI language.",
            "Do not claim CAC registration, incorporation or legal status without verified approved company records.",
            "Classify instructions as information, analysis, draft or action. Never claim an action was executed unless a permitted tool confirms it.",
            "Require explicit human approval before external messages, final pricing, contracts, payments, deletions or irreversible actions."
          ]
        }
      })});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error??"The AI service could not complete the request.");
      if(result.conversationId)setConversationId(result.conversationId);
      const answer=[result.synthesis,result.warnings?.length?"\n\nWarnings: "+result.warnings.join("; "):""].join("");
      setMessages(old=>[...old,{id:Date.now()+2,role:"assistant",content:answer||"The AI service returned no synthesis."}]);
    }catch(err){
      setMessages(old=>[...old,{id:Date.now()+3,role:"assistant",content:err instanceof Error?err.message:"Unable to reach the AI service."}]);
    }finally{setBusy(false);}
  }

  async function signOut(){
    const client=getBrowserSupabase();
    if(client) await client.auth.signOut();
    setToken("");
    setConversationId(null);
    setMessages([{id:Date.now(),role:"assistant",content:"You have signed out of the company workspace. Sign in again to continue."}]);
    setAuthText("Signed out securely.");
  }

  const providers=health?.providers??[];
  const ready=health?.aiReady===true;
  const isChat=active==="AI General Manager";

  return <main className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">S</div><div><b>samzy<span>technology</span></b><small>BUSINESS COMMAND CENTRE</small></div></div>
      <div className="nav-label">COMPANY WORKSPACE</div>
      <nav>{nav.map(([icon,label])=><button key={label} onClick={()=>setActive(label)} className={active===label?"nav-link selected":"nav-link"}><span>{icon}</span>{label}{label==="Approvals"?<i className="nav-indicator"/>:null}</button>)}</nav>
      <div className="sidebar-bottom"><div className="secure-note"><span>⌑</span><div><b>Company-first security</b><small>Private workspace · Approval-led</small></div></div><div className="company-user"><div className="avatar">ST</div><div><b>Samzy Technology Limited</b><small>Company workspace</small></div></div></div>
    </aside>
    <section className="main">
      <header className="topbar"><div className="crumb">Samzy Technology Limited <span>/</span> <b>{active}</b></div><div className="top-actions"><span className={ready?"health good":"health"}><i/>{ready?"AI SYSTEM READY":"SETUP IN PROGRESS"}</span>{token?<button className="signout-button" onClick={()=>void signOut()}>Sign out</button>:null}<span className="avatar small">ST</span></div></header>
      <div className="content">
        <section className="welcome"><div><div className="eyebrow">COMPANY OPERATIONS · COMMAND CENTRE</div><h1>{isChat?"Your AI General Manager.":"Good morning. Let's build."}</h1><p>{isChat?"One conversation for company intelligence, planning and controlled execution.":"Your business at a glance. Intelligence, operations and execution in one place."}</p></div><button className="primary" onClick={()=>setActive("AI General Manager")}>✳ &nbsp;Talk to AI Manager</button></section>
        {active==="Overview"?<>
          <section className="metrics">
            {[
              ["Pipeline prospects","—","CRM integration pending","◎","blue"],
              ["Active clients","—","Verified client records","♙","violet"],
              ["Projects in progress","—","Across connected products","▣","cyan"],
              ["Revenue tracked","—","Recorded company income","₦","green"]
            ].map(([label,value,sub,icon,color])=><article className="metric" key={label}><div className="metric-head"><span>{label}</span><i className={`metric-icon ${color}`}>{icon}</i></div><strong>{value}</strong><small>{sub}</small></article>)}
          </section>
          <section className="dashboard-grid">
            <article className="panel intelligence"><div className="panel-head"><div><div className="eyebrow">CENTRAL INTELLIGENCE</div><h2>AI collaboration layer</h2></div><span className={ready?"chip good":"chip"}>{providers.filter(p=>p.configured).length}/3 models connected</span></div><p className="muted">Three coordinated AI providers working toward one company objective, with shared approved memory and a single synthesis.</p><div className="provider-list">{["A","B","C"].map(slot=>{const p=providers.find(x=>x.slot===slot);return <div className="provider" key={slot}><span className="provider-letter">{slot}</span><div><b>Model {slot} · {p?.provider??"Provider pending"}</b><small>{p?.model??"Configure provider and model credentials"}</small></div><em className={p?.configured?"connected":""}>{p?.configured?"Connected":"Not connected"}</em></div>})}</div><button className="inline-action" onClick={()=>setActive("AI General Manager")}>Open AI General Manager ↗</button></article>
            <article className="panel quick"><div className="eyebrow">MOVE THE BUSINESS FORWARD</div><h2>Quick commands</h2>{[
              ["⌕","Research new prospects","Find and qualify Nigerian businesses","Research new Nigerian businesses that could need our services. Do not contact anyone.","prospect_discovery"],
              ["▣","Review company projects","Progress, blockers and next steps","Give me a summary of active projects, blockers and next steps.","business_advice"],
              ["✉","Draft client outreach","Human, company-branded and approval-first","Prepare a personalised, human outreach draft for a researched prospect. Do not send it.","outreach_draft"],
              ["✓","Review pending approvals","Decisions that need company approval","Show me pending company decisions and approvals.","business_advice"]
            ].map(([ico,title,desc,command,task])=><button className="quick-row" key={title} onClick={()=>{setActive("AI General Manager");void send(command,task as "business_advice"|"prospect_discovery"|"outreach_draft");}}><i>{ico}</i><span><b>{title}</b><small>{desc}</small></span><em>↗</em></button>)}</article>
          </section>
          <section className="lower-grid"><article className="panel"><div className="eyebrow">COMPANY PULSE</div><h2>Operations overview</h2><div className="empty"><span>⌁</span><b>Your verified company activity will appear here</b><p>CRM, projects, finance and product integrations will populate this area with actual company records.</p></div></article><article className="panel"><div className="eyebrow">CONNECTED ECOSYSTEM</div><h2>Product registry</h2>{[["SC","Samzy School Cloud","Independent product · Integration pending"],["WS","Samzy Website Studio","Product registry slot"],["AS","Samzy App Studio","Product registry slot"]].map(([code,name,desc])=><div className="product" key={code}><span>{code}</span><div><b>{name}</b><small>{desc}</small></div><em>Pending</em></div>)}</article></section>
        </>:active==="AI General Manager"?<section className="chat-panel">
          <div className="chat-title"><div><div className="eyebrow">THE COMPANY'S INTELLIGENCE PARTNER</div><h2>Talk to your AI General Manager</h2><p>Ask questions, give instructions, plan and analyse company operations.</p></div><span className="chip">⌑ Private company workspace</span></div>
          <div className="chat-body"><div className="messages">{messages.map(m=><div className={m.role==="user"?"message mine":"message"} key={m.id}><span className="message-avatar">{m.role==="user"?"ST":"✳"}</span><div><b>{m.role==="user"?"Samzy Technology Limited":"AI General Manager"}</b><p>{m.content}</p></div></div>)}{busy?<div className="working">The company intelligence team is working…</div>:null}</div><form className="composer" onSubmit={e=>{e.preventDefault();void send();}}><textarea value={draft} onChange={e=>setDraft(e.target.value)} placeholder="Ask your AI General Manager anything, or give it a command…" rows={2}/><div><small>Enter to send · Shift + Enter for a new line</small><button className="primary" disabled={busy||!draft.trim()}>Send command ↗</button></div></form></div>
          <aside className="chat-side"><article className="connect"><h3>Connect company workspace</h3><p>Secure administrator sign-in</p><form onSubmit={signIn}><label htmlFor="workspace-email">Company email</label><input id="workspace-email" type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="admin@company.com" required/><label htmlFor="workspace-password">Password</label><input id="workspace-password" type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Workspace password" required/><label htmlFor="workspace-org-id">Organisation UUID</label><input id="workspace-org-id" value={orgId} onChange={e=>setOrgId(e.target.value)} placeholder="Business workspace ID" required/><button className="connect-button">{token?"Refresh session":"Connect workspace"}</button></form>{authText?<p className="auth-text">{authText}</p>:null}<small>Password authentication is handled by Supabase Auth. The dashboard does not store your password.</small></article><article className="suggest"><h3>Try asking</h3>{starters.map(s=><button key={s} onClick={()=>void send(s)}>{s}<span>↗</span></button>)}</article></aside>
        </section>:<section className="panel module-workspace">
          <div className="module-heading"><div><div className="eyebrow">LIVE COMPANY WORKSPACE</div><h2>{active}</h2><p>Company records are loaded from your authenticated, organisation-scoped workspace.</p></div><button className="inline-action" onClick={()=>setActive("AI General Manager")}>Discuss with AI Manager ↗</button></div>
          {workspaceError?<div className="module-alert">{workspaceError}</div>:null}
          {workspaceBusy?<div className="empty"><b>Loading verified company records…</b></div>:null}
          {!token||!orgId.trim()?<div className="empty"><b>Connect your company workspace to view live records.</b><p>Open AI General Manager and sign in with an authorised company account.</p><button className="primary" onClick={()=>setActive("AI General Manager")}>Connect workspace ↗</button></div>:null}
          {token&&orgId.trim()&&!workspaceBusy?<>
            {active==="Leads & CRM"?<>
              <form className="record-form" onSubmit={e=>void submitModuleForm(e,"prospect")}><h3>Add a prospect</h3><input name="company_name" placeholder="Company name" required/><input name="website_url" type="url" placeholder="Website URL (optional)"/><input name="industry" placeholder="Industry"/><input name="country" placeholder="Country"/><textarea name="research_summary" placeholder="Research notes / evidence summary"/><button className="primary" disabled={saveBusy}>Save prospect</button></form>
              <div className="record-list">{(workspace?.prospects??[]).map(item=><div className="record-row" key={item.id}><div><b>{item.company_name}</b><small>{item.industry??"Industry not recorded"} · {item.country??"Country unknown"} · {item.website_url??"No website"}</small></div><span className="record-status">{item.status}</span></div>)}{!workspace?.prospects?.length?<p className="empty">No prospect records yet.</p>:null}</div>
            </>:null}
            {active==="Clients"?<>
              <form className="record-form" onSubmit={e=>void submitModuleForm(e,"client")}><h3>Add a client</h3><input name="company_name" placeholder="Company / client name" required/><input name="primary_contact_name" placeholder="Primary contact (optional)"/><input name="email" type="email" placeholder="Business email"/><input name="phone" placeholder="Phone"/><input name="website_url" type="url" placeholder="Website URL"/><input name="industry" placeholder="Industry"/><textarea name="notes" placeholder="Client notes"/><button className="primary" disabled={saveBusy}>Save client</button></form>
              <div className="record-list">{(workspace?.clients??[]).map(item=><div className="record-row" key={item.id}><div><b>{item.company_name}</b><small>{item.primary_contact_name??"No contact"} · {item.email??item.phone??"No contact details"}</small></div><span className="record-status">{item.status}</span></div>)}{!workspace?.clients?.length?<p className="empty">No client records yet.</p>:null}</div>
            </>:null}
            {active==="Projects"?<>
              <form className="record-form" onSubmit={e=>void submitModuleForm(e,"project")}><h3>Create a project</h3><input name="project_name" placeholder="Project name" required/><select name="status" defaultValue="planned"><option value="planned">Planned</option><option value="in_progress">In progress</option><option value="blocked">Blocked</option><option value="review">Review</option></select><input name="quoted_amount_ngn" type="number" min="0" placeholder="Quoted amount (₦)"/><input name="due_at" type="datetime-local" aria-label="Project due date"/><button className="primary" disabled={saveBusy}>Create project</button></form>
              <div className="record-list">{(workspace?.projects??[]).map(item=><div className="record-row" key={item.id}><div><b>{item.project_name}</b><small>{item.quoted_amount_ngn?naira(Number(item.quoted_amount_ngn)):"No quote"} · {item.due_at?new Date(item.due_at).toLocaleDateString():"No due date"}</small></div><span className="record-status">{item.status.replace("_"," ")}</span></div>)}{!workspace?.projects?.length?<p className="empty">No project records yet.</p>:null}</div>
            </>:null}
            {active==="Product Registry"?<div className="record-list">{(workspace?.products??[]).map(item=><div className="record-row" key={item.id}><div><b>{item.product_name}</b><small>{item.product_key} · {item.integration_mode} · {item.dashboard_url??"No dashboard URL"}</small></div><span className="record-status">{item.health_status}</span></div>)}{!workspace?.products?.length?<p className="empty">No registered products yet. Product records will appear here once registered in the company workspace.</p>:null}</div>:null}
            {active==="Sales & Outreach"?<><div className="module-note">External messaging is disabled until approved channel integrations, consent checks and communication controls are configured. This view is read-only.</div><div className="record-list">{(workspace?.outreach??[]).map(item=><div className="record-row" key={item.id}><div><b>{item.direction} · {item.channel} · {item.recipient}</b><small>{item.body??"No message preview"} · {item.created_at?new Date(item.created_at).toLocaleString():""}</small></div><span className="record-status">{item.status}</span></div>)}{!workspace?.outreach?.length?<p className="empty">No outreach events recorded.</p>:null}</div></>:null}
            {active==="Approvals"?<div className="record-list">{(workspace?.approvals??[]).map(item=><div className="record-row approval-row" key={item.id}><div><b>{item.title}</b><small>{item.category} · {item.description}</small></div><div className="approval-actions"><span className="record-status">{item.status}</span>{item.status==="pending"?<><button disabled={saveBusy} onClick={()=>void decideApproval(item.id,"approved")}>Approve</button><button disabled={saveBusy} onClick={()=>void decideApproval(item.id,"rejected")}>Reject</button></>:null}</div></div>)}{!workspace?.approvals?.length?<p className="empty">No approval requests are waiting.</p>:null}</div>:null}
            {active==="Finance"?<>
              <div className="finance-summary"><div><small>Income recorded</small><b>{naira(workspace?.summary?.incomeNgn??0)}</b></div><div><small>Expenses recorded</small><b>{naira(workspace?.summary?.expensesNgn??0)}</b></div><div><small>Net recorded</small><b>{naira(workspace?.summary?.netNgn??0)}</b></div></div>
              <form className="record-form" onSubmit={e=>void submitModuleForm(e,"finance")}><h3>Record a transaction</h3><select name="direction" defaultValue="income"><option value="income">Income</option><option value="expense">Expense</option></select><input name="category" placeholder="Category" required/><input name="description" placeholder="Description" required/><input name="amount_ngn" type="number" min="1" step="1" placeholder="Amount in NGN" required/><select name="status" defaultValue="recorded"><option value="recorded">Recorded</option><option value="pending">Pending</option></select><input name="occurred_at" type="date" aria-label="Transaction date"/><button className="primary" disabled={saveBusy}>Save transaction</button></form>
              <div className="record-list">{(workspace?.finance??[]).map(item=><div className="record-row" key={item.id}><div><b>{item.description}</b><small>{item.category} · {item.occurred_at} · {item.status}</small></div><strong>{item.direction==="expense"?"−":"+"}{naira(Number(item.amount_ngn))}</strong></div>)}{!workspace?.finance?.length?<p className="empty">No financial transactions recorded.</p>:null}</div>
            </>:null}
            {active==="Settings"?<div className="settings-grid"><div><small>Workspace connection</small><b>Authenticated session</b></div><div><small>Organisation ID</small><b>{orgId}</b></div><div><small>AI providers configured</small><b>{providers.filter(p=>p.configured).length} of 3</b></div><div><small>Outbound messaging</small><b>Approval-gated / disabled by default</b></div></div>:null}
          </>:null}
        </section>}
        <footer><span>© Samzy Technology Limited</span><span>INTERNAL COMPANY PLATFORM · BUILD 0.2.0</span><span>⌑ Company-first workspace</span></footer>
      </div>
    </section>
  </main>;
}
