"use client";

import { FormEvent, useEffect, useRef, useState, type ReactNode } from "react";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

type Health = { aiReady?: boolean; providers?: Array<{slot:string;provider:string|null;model:string|null;configured:boolean}>; supabaseConfigured?: boolean; researchReady?: boolean; emailOutreachReady?: boolean; gmailOAuthReady?: boolean; whatsappOutreachReady?: boolean; outboundEnabled?: boolean };
type GmailMessage = { id:string; threadId:string; from:string; subject:string; date:string; snippet:string; body:string };
type ChatMessage = { role: "user" | "assistant"; content: string; id: number; persistedId?: string; actorUserId?: string | null };
type WorkspaceData = { summary?: { prospects:number; clients:number; activeProjects:number; pendingApprovals:number; incomeNgn:number; expensesNgn:number; netNgn:number }; canSendOutreach?:boolean; prospects?: any[]; prospectsHasMore?:boolean; prospectsNextOffset?:number; clients?: any[]; projects?: any[]; products?: any[]; approvals?: any[]; finance?: any[]; outreach?: any[]; contactPoints?: any[]; tasks?: any[] };
type AIAction = { id:string; action_type:string; summary:string; payload:Record<string,unknown>; status:string; requested_by:string; created_at:string; expires_at:string; execution_result?:Record<string,unknown>|null; failure_reason?:string|null };

function getBrowserSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && key ? createClient(url, key) : null;
}

const nav = [
  ["⌂","Overview"],["✳","AI General Manager"],["◎","Leads & CRM"],["♙","Clients"],
  ["▣","Projects"],["☑","Tasks"],["⌘","Product Registry"],["↗","Sales & Outreach"],["✓","Approvals"],
  ["₦","Finance"],["⚙","Settings"],
];

const starters = [
  "Give me a complete briefing on the company.",
  "What should the company prioritise today?",
  "Review our sales opportunities and identify gaps.",
  "Prepare a human, personalised outreach draft. Do not send it.",
  "Find Nigerian businesses that may need Samzy's website, app or automation services, then rank the strongest prospects.",
];


function renderInlineMessage(text: string, prefix: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\x60[^\x60]+\x60)/g).filter(Boolean).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={prefix + index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("\x60") && part.endsWith("\x60")) return <code className="chat-inline-code" key={prefix + index}>{part.slice(1, -1)}</code>;
    return <span key={prefix + index}>{part}</span>;
  });
}

function renderMessageContent(content: string): ReactNode {
  const lines = content.split("\n");
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let bullets: string[] = [];
  let numbered: string[] = [];
  let codeLines: string[] | null = null;
  let blockIndex = 0;
  const flushParagraph = () => {
    if (!paragraph.length) return;
    const key = "p" + blockIndex++;
    blocks.push(<p key={key}>{paragraph.map((line, index) => <span key={index}>{index ? <br /> : null}{renderInlineMessage(line, key + "-" + index)}</span>)}</p>);
    paragraph = [];
  };
  const flushLists = () => {
    if (bullets.length) { const key = "ul" + blockIndex++; blocks.push(<ul key={key}>{bullets.map((line, index) => <li key={index}>{renderInlineMessage(line, key + "-" + index)}</li>)}</ul>); bullets = []; }
    if (numbered.length) { const key = "ol" + blockIndex++; blocks.push(<ol key={key}>{numbered.map((line, index) => <li key={index}>{renderInlineMessage(line, key + "-" + index)}</li>)}</ol>); numbered = []; }
  };
  for (const line of lines) {
    if (line.trim().startsWith("\x60\x60\x60")) {
      flushParagraph(); flushLists();
      if (codeLines === null) codeLines = [];
      else { blocks.push(<pre className="chat-code-block" key={"code" + blockIndex++}><code>{codeLines.join("\n")}</code></pre>); codeLines = null; }
      continue;
    }
    if (codeLines !== null) { codeLines.push(line); continue; }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph(); flushLists();
      const key = "h" + blockIndex++;
      const children = renderInlineMessage(heading[2], key);
      blocks.push(heading[1].length === 1 ? <h3 key={key}>{children}</h3> : heading[1].length === 2 ? <h4 key={key}>{children}</h4> : <h5 key={key}>{children}</h5>);
      continue;
    }
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (bullet) { flushParagraph(); if (numbered.length) flushLists(); bullets.push(bullet[1]); continue; }
    if (ordered) { flushParagraph(); if (bullets.length) flushLists(); numbered.push(ordered[1]); continue; }
    if (!line.trim()) { flushParagraph(); flushLists(); continue; }
    if (bullets.length || numbered.length) flushLists();
    paragraph.push(line);
  }
  flushParagraph(); flushLists();
  if (codeLines !== null) blocks.push(<pre className="chat-code-block" key={"code" + blockIndex++}><code>{codeLines.join("\n")}</code></pre>);
  return <div className="message-rich-content">{blocks}</div>;
}

export default function Home() {
  const [active,setActive] = useState("Overview");
  const [sidebarOpen,setSidebarOpen] = useState(true);
  const [openForm,setOpenForm] = useState<string|null>(null);
  const [health,setHealth] = useState<Health|null>(null);
  const [workspace,setWorkspace] = useState<WorkspaceData|null>(null);
  const [workspaceBusy,setWorkspaceBusy] = useState(false);
  const [workspaceError,setWorkspaceError] = useState("");
  const [saveBusy,setSaveBusy] = useState(false);
  const [discoverBusy,setDiscoverBusy] = useState(false);
  const [prospectsLoadingMore,setProspectsLoadingMore] = useState(false);
  const [discoveryNotice,setDiscoveryNotice] = useState("");
  const [statusDrafts,setStatusDrafts] = useState<Record<string,string>>({});
  const [verificationNotes,setVerificationNotes] = useState<Record<string,string>>({});
  const [aiActions,setAiActions] = useState<AIAction[]>([]);
  const [actionsBusy,setActionsBusy] = useState(false);
  const [canReviewAI,setCanReviewAI] = useState(false);
  const [actionDraft,setActionDraft] = useState({company_name:"",website_url:"",industry:"",country:"Nigeria",fit_score:"70",research_summary:""});
  const [email,setEmail] = useState("SAMZYTECHNOLOGY");
  const [password,setPassword] = useState("");
  const [orgId,setOrgId] = useState("fde00435-b72a-4650-8a85-eb9baec33d33");
  const [conversationId,setConversationId] = useState<string|null>(null);
  const [token,setToken] = useState("");
  const [currentUserId,setCurrentUserId] = useState("");
  const [gmailMessages,setGmailMessages] = useState<GmailMessage[]>([]);
  const [gmailReplyDrafts,setGmailReplyDrafts] = useState<Record<string,string>>({});
  const [gmailMailbox,setGmailMailbox] = useState("");
  const [gmailBusy,setGmailBusy] = useState(false);
  const [gmailError,setGmailError] = useState("");
  const [authText,setAuthText] = useState("");
  const [draft,setDraft] = useState("");
  const [busy,setBusy] = useState(false);
  const [editingMessageId,setEditingMessageId] = useState<number|null>(null);
  const [copiedMessageId,setCopiedMessageId] = useState<number|null>(null);
  const composerRef = useRef<HTMLTextAreaElement|null>(null);
  const messagesEndRef = useRef<HTMLDivElement|null>(null);
  const messagesContainerRef = useRef<HTMLDivElement|null>(null);
  const [messages,setMessages] = useState<ChatMessage[]>([
    {id:1,role:"assistant",content:"Welcome to the Samzy Technology command centre. I am your AI General Manager interface. Connect the secure company workspace to begin. I can help analyse operations, prepare plans, research opportunities and draft client communications. I will clearly distinguish verified company information from anything that is not yet connected."}
  ]);

  useEffect(()=>{
    const container=messagesContainerRef.current;
    if(container) container.scrollTo({top:container.scrollHeight,behavior:"smooth"});
  },[messages,busy]);

  useEffect(()=>{
    fetch("/api/health",{cache:"no-store"}).then(r=>r.json()).then(setHealth).catch(()=>setHealth(null));
    const client=getBrowserSupabase();
    if(client) client.auth.getSession().then(({data})=>{if(data.session?.access_token)setToken(data.session.access_token);if(data.session?.user?.id)setCurrentUserId(data.session.user.id);});
  },[]);

  useEffect(()=>{
    if(!token||!orgId.trim())return;
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orgId.trim()))return;
    let cancelled=false;
    fetch("/api/ai/run",{method:"GET",headers:{Authorization:`Bearer ${token}`,"x-organization-id":orgId.trim()},cache:"no-store"})
      .then(async response=>{const data=await response.json();if(!response.ok)throw new Error(data.error??"Could not restore chat history.");return data;})
      .then(data=>{if(cancelled)return;setConversationId(data.conversationId??null);if(Array.isArray(data.messages)&&data.messages.length){setMessages(data.messages.map((m:{id:string;role:"user"|"assistant";content:string;actor_user_id?:string|null},index:number)=>({id:Date.now()+index,role:m.role==="user"?"user":"assistant",content:m.content,persistedId:m.id,actorUserId:m.actor_user_id??null})));}})
      .catch(()=>{if(!cancelled)setAuthText("Workspace connected, but previous chat history could not be restored.");});
    return ()=>{cancelled=true;};
  },[token,orgId]);

  useEffect(()=>{
    if(!token||!orgId.trim()||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orgId.trim())){setWorkspace(null);setWorkspaceBusy(false);setWorkspaceError("");return;}
    let cancelled=false;
    const moduleKey:Record<string,string>={"Leads & CRM":"prospects","Clients":"clients","Projects":"projects","Tasks":"tasks","Product Registry":"products","Approvals":"approvals","Finance":"finance","Sales & Outreach":"outreach"};
    setWorkspaceBusy(true);setWorkspaceError("");
    fetch(`/api/workspace?module=${moduleKey[active]??"overview"}`,{headers:{Authorization:`Bearer ${token}`,"x-organization-id":orgId.trim()},cache:"no-store"})
      .then(async response=>{const data=await response.json();if(!response.ok)throw new Error(data.error??"Company data could not be loaded.");return data;})
      .then(data=>{if(!cancelled)setWorkspace(data);})
      .catch(err=>{if(!cancelled)setWorkspaceError(err instanceof Error?err.message:"Company data could not be loaded.");})
      .finally(()=>{if(!cancelled)setWorkspaceBusy(false);});
    return ()=>{cancelled=true;};
  },[token,orgId,active]);

  useEffect(()=>{
    if(active!=="Leads & CRM"||!token||!orgId.trim())return;
    const refresh=async()=>{
      try{
        const response=await fetch("/api/workspace?module=prospects",{headers:{Authorization:"Bearer "+token,"x-organization-id":orgId.trim()},cache:"no-store"});
        if(!response.ok)return;
        const data=await response.json();
        setWorkspace(previous=>{
          if(!previous)return data;
          const fresh=data.prospects??[];
          const freshIds=new Set(fresh.map((item:any)=>item.id));
          const older=(previous.prospects??[]).filter((item:any)=>!freshIds.has(item.id));
          return {...data,prospects:[...fresh,...older],prospectsHasMore:Boolean(data.prospectsHasMore||older.length)};
        });
      }catch{/* background refresh is best-effort; the next interval retries */}
    };
    const timer=window.setInterval(()=>void refresh(),60_000);
    return ()=>window.clearInterval(timer);
  },[active,token,orgId]);

  useEffect(()=>{
    if(active!=="Approvals"||!token||!orgId.trim())return;
    let cancelled=false;
    setActionsBusy(true);
    fetch("/api/actions",{headers:{Authorization:"Bearer "+token,"x-organization-id":orgId.trim()},cache:"no-store"})
      .then(async response=>{const data=await response.json();if(!response.ok)throw new Error(data.error??"AI action requests could not be loaded.");return data;})
      .then(data=>{if(!cancelled){setAiActions(data.actions??[]);setCanReviewAI(data.canReview===true);}})
      .catch(err=>{if(!cancelled)setWorkspaceError(err instanceof Error?err.message:"AI action requests could not be loaded.");})
      .finally(()=>{if(!cancelled)setActionsBusy(false);});
    return ()=>{cancelled=true;};
  },[active,token,orgId]);
  async function discoverProspects(){
    if(!token||!orgId.trim()||discoverBusy)return;
    setDiscoverBusy(true);setDiscoveryNotice("");setWorkspaceError("");
    try{
      const response=await fetch("/api/prospects/discover",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token,"x-organization-id":orgId.trim()},body:JSON.stringify({})});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error??"Prospect discovery could not complete.");
      const refreshed=await fetch("/api/workspace?module=prospects",{headers:{Authorization:"Bearer "+token,"x-organization-id":orgId.trim()},cache:"no-store"});
      const data=await refreshed.json();if(!refreshed.ok)throw new Error(data.error??"Prospects were saved, but the CRM list could not refresh.");
      setWorkspace(data);
      const savedCount=Number(result.savedCount??0);const candidateCount=Number(result.candidateCount??0);const searches=Number(result.searchCount??0);const duplicateCount=Number(result.duplicateCount??0);const weakCount=Number(result.weakCount??0);setDiscoveryNotice(savedCount>0?`Batch ${result.batchNumber}: saved ${savedCount} new prospects. Reviewed ${candidateCount} candidates from ${searches} web searches. ${duplicateCount} duplicates and ${weakCount} weak matches skipped. ${result.totalSaved} prospects saved in total. The next batch is ready.`:`Batch ${result.batchNumber}: no new prospects qualified. Reviewed ${candidateCount} candidates from ${searches} web searches; ${duplicateCount} duplicates and ${weakCount} weak matches skipped. Search has advanced to the next batch—run it again to continue.`);
    }catch(err){setWorkspaceError(err instanceof Error?err.message:"Prospect discovery failed.");}
    finally{setDiscoverBusy(false);}
  }

  async function loadMoreProspects(){
    if(!token||!orgId.trim()||prospectsLoadingMore||!workspace?.prospectsHasMore)return;
    setProspectsLoadingMore(true);setWorkspaceError("");
    try{
      const offset=workspace.prospects?.length??0;
      const response=await fetch(`/api/workspace?module=prospects&prospect_offset=${offset}`,{headers:{Authorization:"Bearer "+token,"x-organization-id":orgId.trim()},cache:"no-store"});
      const data=await response.json();if(!response.ok)throw new Error(data.error??"More prospects could not be loaded.");
      setWorkspace(previous=>previous?({...data,prospects:[...(previous.prospects??[]),...(data.prospects??[])]}):data);
    }catch(err){setWorkspaceError(err instanceof Error?err.message:"More prospects could not be loaded.");}
    finally{setProspectsLoadingMore(false);}
  }

  async function submitModuleForm(event:FormEvent<HTMLFormElement>, type:"client"|"project"|"prospect"|"contact_point"|"finance"|"approval"|"product"|"task"|"outreach_draft"){
    event.preventDefault();if(!token||!orgId.trim()||saveBusy)return;
    const form=event.currentTarget;
    const fields=Object.fromEntries(new FormData(form).entries()) as Record<string,string>;
    const payload:Record<string,unknown>={type,...fields};
    if(type==="finance")payload.amount_ngn=Number(fields.amount_ngn);
    if(type==="prospect"&&fields.fit_score)payload.fit_score=Number(fields.fit_score);
    if(type==="product")payload.capabilities=(fields.capabilities??"").split(",").map(x=>x.trim()).filter(Boolean);
    if(type==="project"&&fields.quoted_amount_ngn)payload.quoted_amount_ngn=Number(fields.quoted_amount_ngn);
    if((type==="project"||type==="task")&&fields.due_at)payload.due_at=new Date(fields.due_at).toISOString();
    for(const key of ["email","website_url","dashboard_url","due_at","occurred_at","quoted_amount_ngn","fit_score","capabilities","client_id","prospect_id","product_id"])if(payload[key]==="")delete payload[key];
    setSaveBusy(true);setWorkspaceError("");
    try{
      const response=await fetch("/api/workspace",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`,"x-organization-id":orgId.trim()},body:JSON.stringify(payload)});
      const result=await response.json();if(!response.ok)throw new Error(result.error??"Record could not be saved.");
      form.reset();
      const moduleKey:Record<string,string>={client:"clients",project:"projects",prospect:"prospects",contact_point:"prospects",finance:"finance",approval:"approvals",product:"products",task:"tasks",outreach_draft:"outreach"};
      const refreshed=await fetch(`/api/workspace?module=${moduleKey[type]}`,{headers:{Authorization:`Bearer ${token}`,"x-organization-id":orgId.trim()},cache:"no-store"});
      const data=await refreshed.json();if(!refreshed.ok)throw new Error(data.error??"Record saved, but refresh failed.");
      setWorkspace(data);
      setOpenForm(null);
    }catch(err){setWorkspaceError(err instanceof Error?err.message:"Record could not be saved.");}
    finally{setSaveBusy(false);}
  }

  async function decideApproval(id:string,decision:"approved"|"rejected"){
    if(!token||!orgId.trim())return;
    setSaveBusy(true);setWorkspaceError("");
    try{
      const response=await fetch("/api/workspace",{method:"PATCH",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`,"x-organization-id":orgId.trim()},body:JSON.stringify({type:"approval",id,decision})});
      const result=await response.json();if(!response.ok)throw new Error(result.error??"Approval decision failed.");
      const refreshed=await fetch("/api/workspace?module=approvals",{headers:{Authorization:`Bearer ${token}`,"x-organization-id":orgId.trim()},cache:"no-store"});
      const data=await refreshed.json();if(!refreshed.ok)throw new Error(data.error??"Approval updated but list refresh failed.");
      setWorkspace(data);
    }catch(err){setWorkspaceError(err instanceof Error?err.message:"Approval decision failed.");}
    finally{setSaveBusy(false);}
  }

  async function convertProspectToClient(prospectId:string){
    if(!token||!orgId.trim()||saveBusy)return;
    setSaveBusy(true);setWorkspaceError("");
    try{
      const response=await fetch("/api/workspace",{method:"PATCH",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`,"x-organization-id":orgId.trim()},body:JSON.stringify({type:"convert_prospect",prospect_id:prospectId})});
      const result=await response.json();if(!response.ok)throw new Error(result.error??"Prospect conversion failed.");
      const refreshed=await fetch("/api/workspace?module=overview",{headers:{Authorization:`Bearer ${token}`,"x-organization-id":orgId.trim()},cache:"no-store"});
      const data=await refreshed.json();if(!refreshed.ok)throw new Error(data.error??"Client created, but workspace refresh failed.");
      setWorkspace(data);
    }catch(err){setWorkspaceError(err instanceof Error?err.message:"Prospect conversion failed.");}
    finally{setSaveBusy(false);}
  }

  async function updateRecordStatus(type:"prospect"|"project"|"client"|"task",id:string,status:string){
    if(!token||!orgId.trim()||saveBusy)return;
    setSaveBusy(true);setWorkspaceError("");
    try{
      const response=await fetch("/api/workspace",{method:"PATCH",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`,"x-organization-id":orgId.trim()},body:JSON.stringify({type,id,status})});
      const result=await response.json();if(!response.ok)throw new Error(result.error??"Status update failed.");
      const moduleKey={prospect:"prospects",project:"projects",client:"clients",task:"tasks"} as const;
      const refreshed=await fetch(`/api/workspace?module=${moduleKey[type]}`,{headers:{Authorization:`Bearer ${token}`,"x-organization-id":orgId.trim()},cache:"no-store"});
      const data=await refreshed.json();if(!refreshed.ok)throw new Error(data.error??"Status saved, but refresh failed.");
      setWorkspace(data);
      setStatusDrafts(old=>{const next={...old};delete next[id];return next;});
    }catch(err){setWorkspaceError(err instanceof Error?err.message:"Status update failed.");}
    finally{setSaveBusy(false);}
  }

  async function verifyContactPoint(id:string){
    if(!token||!orgId.trim()||saveBusy)return;
    const verification_note=(verificationNotes[id]??"").trim();
    if(verification_note.length<5){setWorkspaceError("Enter how the contact was verified before continuing.");return;}
    setSaveBusy(true);setWorkspaceError("");
    try{
      const response=await fetch("/api/workspace",{method:"PATCH",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token,"x-organization-id":orgId.trim()},body:JSON.stringify({type:"contact_point_verify",id,verification_note})});
      const result=await response.json();if(!response.ok)throw new Error(result.error??"Contact verification failed.");
      const refreshed=await fetch("/api/workspace?module=prospects",{headers:{Authorization:"Bearer "+token,"x-organization-id":orgId.trim()},cache:"no-store"});
      const data=await refreshed.json();if(!refreshed.ok)throw new Error(data.error??"Contact verified but CRM refresh failed.");
      setWorkspace(data);setVerificationNotes(old=>{const next={...old};delete next[id];return next;});
    }catch(err){setWorkspaceError(err instanceof Error?err.message:"Contact verification failed.");}
    finally{setSaveBusy(false);}
  }
  async function proposeProspectAction(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(!token||!orgId.trim()||saveBusy)return;
    setSaveBusy(true);setWorkspaceError("");
    try{
      const payload:Record<string,unknown>={company_name:actionDraft.company_name,country:actionDraft.country};
      if(actionDraft.website_url)payload.website_url=actionDraft.website_url;
      if(actionDraft.industry)payload.industry=actionDraft.industry;
      if(actionDraft.fit_score)payload.fit_score=Number(actionDraft.fit_score);
      if(actionDraft.research_summary)payload.research_summary=actionDraft.research_summary;
      const response=await fetch("/api/actions",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token,"x-organization-id":orgId.trim()},body:JSON.stringify({actionType:"create_prospect",summary:"Add prospect: "+actionDraft.company_name,payload,idempotencyKey:crypto.randomUUID()})});
      const result=await response.json();if(!response.ok)throw new Error(result.error??"Action proposal could not be saved.");
      setActionDraft({company_name:"",website_url:"",industry:"",country:"Nigeria",fit_score:"70",research_summary:""});
      const refreshed=await fetch("/api/actions",{headers:{Authorization:"Bearer "+token,"x-organization-id":orgId.trim()},cache:"no-store"});
      const data=await refreshed.json();if(!refreshed.ok)throw new Error(data.error??"Proposal saved but action list refresh failed.");
      setAiActions(data.actions??[]);
      setOpenForm(null);
    }catch(err){setWorkspaceError(err instanceof Error?err.message:"Action proposal failed.");}
    finally{setSaveBusy(false);}
  }

  async function reviewAIAction(id:string,decision:"approved"|"rejected"){
    if(!token||!orgId.trim()||saveBusy)return;
    setSaveBusy(true);setWorkspaceError("");
    try{
      const response=await fetch("/api/actions",{method:"PATCH",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token,"x-organization-id":orgId.trim()},body:JSON.stringify({id,decision})});
      const result=await response.json();if(!response.ok)throw new Error(result.error??"AI action could not be reviewed.");
      const refreshed=await fetch("/api/actions",{headers:{Authorization:"Bearer "+token,"x-organization-id":orgId.trim()},cache:"no-store"});
      const data=await refreshed.json();if(!refreshed.ok)throw new Error(data.error??"Decision saved but action list refresh failed.");
      setAiActions(data.actions??[]);
      if(decision==="approved"&&result.result?.status==="executed"){
        const workspaceResponse=await fetch("/api/workspace?module=overview",{headers:{Authorization:"Bearer "+token,"x-organization-id":orgId.trim()},cache:"no-store"});
        const workspaceData=await workspaceResponse.json();if(workspaceResponse.ok)setWorkspace(workspaceData);
      }
    }catch(err){setWorkspaceError(err instanceof Error?err.message:"AI action review failed.");}
    finally{setSaveBusy(false);}
  }
  async function sendOutreach(id:string){
    if(!token||!orgId.trim()||saveBusy)return;
    setSaveBusy(true);setWorkspaceError("");
    try{
      const response=await fetch("/api/outreach/send",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token,"x-organization-id":orgId.trim()},body:JSON.stringify({outreachId:id})});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error??"The outreach message could not be sent.");
      if(result.warning)setWorkspaceError(result.warning);
      const refreshed=await fetch("/api/workspace?module=outreach",{headers:{Authorization:"Bearer "+token,"x-organization-id":orgId.trim()},cache:"no-store"});
      const data=await refreshed.json();if(!refreshed.ok)throw new Error(data.error??"Message processed, but outreach history could not be refreshed.");
      setWorkspace(data);
    }catch(err){setWorkspaceError(err instanceof Error?err.message:"The outreach message could not be sent.");}
    finally{setSaveBusy(false);}
  }
  async function sendWhatsAppOutreach(id:string){
    if(!token||!orgId.trim()||saveBusy)return;
    setSaveBusy(true);setWorkspaceError("");
    try{
      const response=await fetch("/api/outreach/whatsapp/send",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token,"x-organization-id":orgId.trim()},body:JSON.stringify({outreachId:id})});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error??"The WhatsApp message could not be sent.");
      if(result.warning)setWorkspaceError(result.warning);
      const refreshed=await fetch("/api/workspace?module=outreach",{headers:{Authorization:"Bearer "+token,"x-organization-id":orgId.trim()},cache:"no-store"});
      const data=await refreshed.json();if(!refreshed.ok)throw new Error(data.error??"Message processed, but outreach history could not be refreshed.");
      setWorkspace(data);
    }catch(err){setWorkspaceError(err instanceof Error?err.message:"The WhatsApp message could not be sent.");}
    finally{setSaveBusy(false);}
  }
  async function connectGmail(){
    if(!token||!orgId.trim()){setGmailError("Connect the secure company workspace first.");return;}
    setGmailBusy(true);setGmailError("");
    try{
      const response=await fetch("/api/integrations/gmail/connect",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({organizationId:orgId.trim()})});
      const result=await response.json();if(!response.ok||!result.authorizationUrl)throw new Error(result.error??"Could not start Gmail connection.");
      window.location.assign(result.authorizationUrl);
    }catch(error){setGmailError(error instanceof Error?error.message:"Gmail connection could not be started.");setGmailBusy(false);}
  }
  async function syncGmail(){
    if(!token||!orgId.trim())return;
    setGmailBusy(true);setGmailError("");
    try{
      const response=await fetch("/api/integrations/gmail/inbox",{headers:{Authorization:`Bearer ${token}`,"x-organization-id":orgId.trim()},cache:"no-store"});
      const result=await response.json();if(!response.ok)throw new Error(result.error??"Inbox sync failed.");
      setGmailMessages(result.messages??[]);setGmailMailbox(result.mailbox??"");
    }catch(error){setGmailError(error instanceof Error?error.message:"Inbox sync failed.");}
    finally{setGmailBusy(false);}
  }
  async function sendGmailReply(message:GmailMessage){
    const body=(gmailReplyDrafts[message.id]??"").trim();
    if(!body||!token||!orgId.trim())return;
    if(!window.confirm(`Send this reply to the sender of "${message.subject||"this email"}" from the connected Samzy Gmail mailbox?`))return;
    setGmailBusy(true);setGmailError("");
    try{
      const response=await fetch("/api/integrations/gmail/reply",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`,"x-organization-id":orgId.trim()},body:JSON.stringify({messageId:message.id,threadId:message.threadId,body,approved:true})});
      const result=await response.json();if(!response.ok||!result.sent)throw new Error(result.error??"Gmail reply was not sent.");
      setGmailReplyDrafts(old=>({...old,[message.id]:""}));
      setGmailError(`Reply sent to ${result.recipient}.`);
      await syncGmail();
    }catch(error){setGmailError(error instanceof Error?error.message:"Gmail reply could not be sent.");}
    finally{setGmailBusy(false);}
  }
  function analyseGmailMessage(message:GmailMessage){
    void send([
      "Analyse this incoming Gmail message and prepare a human, context-aware reply. Do not send anything.",
      `From: ${message.from}`,`Subject: ${message.subject}`,`Received: ${message.date}`,
      `Full message: ${message.body || message.snippet}`,
      "Identify the sender's intent, questions, sentiment, risks, facts to verify, and recommended next step. Then draft a concise reply. Clearly state if the preview is insufficient and request the full message rather than inventing details.",
    ].join("\n"),"reply_analysis");
    setActive("AI General Manager");
  }
  function naira(value:number){return new Intl.NumberFormat("en-NG",{style:"currency",currency:"NGN",maximumFractionDigits:0}).format(value??0);}

  async function signIn(e:FormEvent){
    e.preventDefault(); setAuthText("");
    const client=getBrowserSupabase();
    if(!client){setAuthText("Supabase browser authentication is not configured. Add the public Supabase URL and anon key to the environment.");return;}
    if(!orgId.trim()){setAuthText("Enter the Business Command Centre organisation UUID.");return;}
    const response=await fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:email,password})});
    const result=await response.json();
    if(!response.ok||!result.session){setAuthText(result.error??"Sign-in failed.");return;}
    const {data,error}=await client.auth.setSession({access_token:result.session.access_token,refresh_token:result.session.refresh_token});
    if(error||!data.session||!data.user){setAuthText("The secure session could not be established. Please try again.");return;}
    setToken(data.session.access_token); setCurrentUserId(data.user.id); setAuthText("Secure session connected.");
  }

  async function send(text?:string, task: "business_advice" | "prospect_discovery" | "company_research" | "lead_qualification" | "outreach_draft" | "reply_analysis" = "business_advice"){
    const question=(text??draft).trim();
    if(!question||busy)return;
    const editingMessage=editingMessageId===null?undefined:messages.find(message=>message.id===editingMessageId);
    const previousMessages=messages;
    const messageId=Date.now();
    if(editingMessage){
      const editIndex=messages.findIndex(message=>message.id===editingMessage.id);
      setMessages([...messages.slice(0,editIndex),{...editingMessage,id:messageId,content:question}]);
    }else{
      setMessages(old=>[...old,{id:messageId,role:"user",content:question,actorUserId:currentUserId}]);
    }
    setDraft("");
    if(composerRef.current)composerRef.current.style.height="auto";
    setBusy(true);
    if(!token||!orgId.trim()||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orgId.trim())){
      if(editingMessage){setMessages(previousMessages);setDraft(question);}
      else setMessages(old=>[...old,{id:Date.now()+1,role:"assistant",content:"I have received your instruction, but the secure company workspace is not connected. Sign in and enter the organisation UUID first. I will not invent company records or pretend an action has been completed."}]);
      setBusy(false);return;
    }
    try{
      let evidence:Array<{url:string;title?:string;excerpt?:string}> = [];
      let researchWarning = "";
      const needsResearch = ["prospect_discovery","company_research","lead_qualification","outreach_draft"].includes(task)
        || /\b(research|look up|look at (?:this|the) company|analyse (?:this|the) business|analyze (?:this|the) business|prospect|find businesses|find companies|prospect website)\b/i.test(question);
      if(needsResearch){
        try{
          const countryMatch = [
            [/\b(nigeria|nigerian)\b/i,"NG"],[/\b(united kingdom|uk|british)\b/i,"GB"],
            [/\b(united states|usa|us|american)\b/i,"US"],[/\b(canada|canadian)\b/i,"CA"],
            [/\b(australia|australian)\b/i,"AU"],[/\b(uae|united arab emirates|dubai)\b/i,"AE"],
            [/\b(south africa|south african)\b/i,"ZA"],
          ] as Array<[RegExp,string]>;
          const country = countryMatch.find(([pattern])=>pattern.test(question))?.[1];
          const researchResponse=await fetch("/api/research/web",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token,"x-organization-id":orgId.trim()},body:JSON.stringify({query:question,...(country?{country}:{})})});
          const researchResult=await researchResponse.json();
          if(researchResponse.ok&&Array.isArray(researchResult.evidence))evidence=researchResult.evidence;
          else researchWarning=researchResult.error??"Live web research was unavailable; the AI will use only connected company records.";
        }catch{researchWarning="Live web research was unavailable; the AI will use only connected company records.";}
      }
      const safeEvidence=evidence.slice(0,12).flatMap(item=>{
        try{
          const parsedUrl=new URL(item.url);
          if(parsedUrl.protocol!=="https:"&&parsedUrl.protocol!=="http:")return [];
          return [{url:parsedUrl.toString(),...(item.title?{title:item.title.slice(0,200)}:{}),...(item.excerpt?{excerpt:item.excerpt.slice(0,1200)}:{})}];
        }catch{return [];}
      });
      const response=await fetch("/api/ai/run",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token,"x-organization-id":orgId.trim()},body:JSON.stringify({
        task,objective:question,
        ...(safeEvidence.length?{evidence:safeEvidence}:{}),
        ...(conversationId?{conversationId}:{}),
        ...(editingMessage?.persistedId?{editMessageId:editingMessage.persistedId}:{}),
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
      if(!response.ok){
        const detail=Array.isArray(result.issues)?result.issues.map((issue:{field?:string;message?:string})=>(issue.field?issue.field+": ":"")+(issue.message??"Invalid value")).join("; "):"";
        throw new Error([result.error??"The AI service could not complete the request.",detail].filter(Boolean).join(" "));
      }
      if(result.conversationId)setConversationId(result.conversationId);
      const providerWarnings=(result.warnings??[]) as string[];
      const notes:string[]=[];
      const modelCount=Array.isArray(result.contributions)?result.contributions.length:0;
      if(modelCount>0&&providerWarnings.some((warning:string)=>warning.startsWith("Single-provider mode"))){
        const activeProvider=String(result.contributions?.[0]?.provider??"available provider");
        notes.push(`AI is active using ${activeProvider}. Multi-model cross-checking is paused to conserve quota; you can continue using the assistant.`);
      }
      if(researchWarning)notes.push("Live web research was unavailable.");
      const answer=[result.synthesis,notes.length?"\n\n*AI status:* "+notes.join(" "):""].join("");
      setMessages(old=>[...old.map(message=>message.id===messageId?{...message,persistedId:result.userMessageId??message.persistedId}:message),{id:Date.now()+2,role:"assistant",content:answer||"The AI service returned no synthesis."}]);
      setEditingMessageId(null);
    }catch(err){
      if(editingMessage){setMessages([...previousMessages,{id:Date.now()+3,role:"assistant",content:err instanceof Error?err.message:"Unable to reach the AI service."}]);setDraft(question);}
      else setMessages(old=>[...old,{id:Date.now()+3,role:"assistant",content:err instanceof Error?err.message:"Unable to reach the AI service."}]);
    }finally{setBusy(false);}
  }

  async function copyMessage(id:number,content:string){
    try{await navigator.clipboard.writeText(content);setCopiedMessageId(id);}
    catch{setWorkspaceError("Clipboard access is unavailable in this browser. Select the message text and copy it manually.");}
  }

  function editMessage(message:ChatMessage){
    if(busy||message.role!=="user")return;
    setEditingMessageId(message.id);
    setDraft(message.content);
    setWorkspaceError("");
    composerRef.current?.focus();
  }

  function cancelMessageEdit(){
    setEditingMessageId(null);
    setDraft("");
    if(composerRef.current)composerRef.current.style.height="auto";
  }

  async function signOut(){
    const client=getBrowserSupabase();
    if(client) await client.auth.signOut();
    setToken("");
    setCurrentUserId("");
    setConversationId(null);
    setMessages([{id:Date.now(),role:"assistant",content:"You have signed out of the company workspace. Sign in again to continue."}]);
    setAuthText("Signed out securely.");
  }

  async function startNewChat(){
    if(busy)return;
    setDraft("");setEditingMessageId(null);setWorkspaceError("");
    if(!token||!orgId.trim()){
      setConversationId(null);
      setMessages([{id:Date.now(),role:"assistant",content:"New chat ready. Sign in to the secure company workspace before sending a message."}]);
      return;
    }
    setBusy(true);
    try{
      const response=await fetch("/api/ai/run?new=1",{headers:{Authorization:"Bearer "+token,"x-organization-id":orgId.trim()},cache:"no-store"});
      const result=await response.json();
      if(!response.ok||!result.conversationId)throw new Error(result.error??"A new chat could not be created.");
      setConversationId(result.conversationId);
      setMessages([{id:Date.now(),role:"assistant",content:"New chat started. I'm ready to help with Samzy Technology's operations, sales, prospects and automation."}]);
      composerRef.current?.focus();
    }catch(error){
      setMessages(old=>[...old,{id:Date.now()+1,role:"assistant",content:error instanceof Error?error.message:"A new chat could not be created."}]);
    }finally{setBusy(false);}
  }

  const providers=health?.providers??[];
  const ready=health?.aiReady===true;
  const isChat=active==="AI General Manager";

  return <main className={`app-shell ${isChat?"chat-mode":""} ${sidebarOpen?"":"sidebar-collapsed"}`}>
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">S</div><div><b>samzy<span>technology</span></b><small>BUSINESS COMMAND CENTRE</small></div></div>
      <div className="nav-label">COMPANY WORKSPACE</div>
      <nav>{nav.map(([icon,label])=><button key={label} onClick={()=>setActive(label)} className={active===label?"nav-link selected":"nav-link"}><span>{icon}</span>{label}{label==="Approvals"?<i className="nav-indicator"/>:null}</button>)}</nav>
      <div className="sidebar-bottom"><div className="secure-note"><span>⌑</span><div><b>Company-first security</b><small>Private workspace · Approval-led</small></div></div><div className="company-user"><div className="avatar">ST</div><div><b>Samzy Technology Limited</b><small>Company workspace</small></div></div></div>
    </aside>
    <section className="main">
      <header className="topbar"><button className="menu-toggle" type="button" aria-label={sidebarOpen?"Hide navigation":"Show navigation"} onClick={()=>setSidebarOpen(value=>!value)}>☰</button><div className="crumb">Samzy Technology Limited <span>/</span> <b>{active}</b></div><div className="top-actions"><span className={ready?"health good":"health"}><i/>{ready?"AI SYSTEM READY":"SETUP IN PROGRESS"}</span>{token?<button className="signout-button" onClick={()=>void signOut()}>Sign out</button>:null}<span className="avatar small">ST</span></div></header>
      <div className="content">
        {!isChat?<section className="welcome"><div><div className="eyebrow">COMPANY OPERATIONS · COMMAND CENTRE</div><h1>{isChat?"Your AI General Manager.":"Good morning. Let's build."}</h1><p>{isChat?"Analyses live CRM, client, project, finance, approval and recorded outreach data alongside approved company memory. External actions remain approval-gated.":"Your business at a glance. Intelligence, operations and execution in one place."}</p></div><button className="primary" onClick={()=>setActive("AI General Manager")}>✳ &nbsp;Talk to AI Manager</button></section>:null}
        {active==="Overview"?<>
          <section className="metrics">
            {[
              ["Pipeline prospects",workspace?.summary?String(workspace.summary.prospects):"—","Live CRM prospect records","◎","blue"],
              ["Active clients",workspace?.summary?String(workspace.summary.clients):"—","Registered company clients","♙","violet"],
              ["Projects in progress",workspace?.summary?String(workspace.summary.activeProjects):"—","In progress, blocked or in review","▣","cyan"],
              ["Revenue tracked",workspace?.summary?naira(workspace.summary.incomeNgn):"—","Recorded company income","₦","green"]
            ].map(([label,value,sub,icon,color])=><article className="metric" key={label}><div className="metric-head"><span>{label}</span><i className={`metric-icon ${color}`}>{icon}</i></div><strong>{value}</strong><small>{sub}</small></article>)}
          </section>
          <section className="dashboard-grid">
            <article className="panel intelligence"><div className="panel-head"><div><div className="eyebrow">CENTRAL INTELLIGENCE</div><h2>AI collaboration layer</h2></div><span className={ready?"chip good":"chip"}>{providers.filter(p=>p.configured).length}/5 models connected</span></div><p className="muted">Five coordinated AI providers working toward one company objective, with shared approved memory and a single synthesis.</p><div className="provider-list">{["A","B","C","D","E"].map(slot=>{const p=providers.find(x=>x.slot===slot);return <div className="provider" key={slot}><span className="provider-letter">{slot}</span><div><b>Model {slot} · {p?.provider??"Provider pending"}</b><small>{p?.model??"Configure provider and model credentials"}</small></div><em className={p?.configured?"connected":""}>{p?.configured?"Connected":"Not connected"}</em></div>})}</div><button className="inline-action" onClick={()=>setActive("AI General Manager")}>Open AI General Manager ↗</button></article>
            <article className="panel quick"><div className="eyebrow">MOVE THE BUSINESS FORWARD</div><h2>Quick commands</h2>{[
              ["⌕","Research new prospects","Find and qualify Nigerian businesses","Research new Nigerian businesses that could need our services. Do not contact anyone.","prospect_discovery"],
              ["▣","Review company projects","Progress, blockers and next steps","Give me a summary of active projects, blockers and next steps.","business_advice"],
              ["✉","Draft client outreach","Human, company-branded and approval-first","Prepare a personalised, human outreach draft for a researched prospect. Do not send it.","outreach_draft"],
              ["✓","Review pending approvals","Decisions that need company approval","Show me pending company decisions and approvals.","business_advice"]
            ].map(([ico,title,desc,command,task])=><button className="quick-row" key={title} onClick={()=>{setActive("AI General Manager");void send(command,task as "business_advice"|"prospect_discovery"|"outreach_draft");}}><i>{ico}</i><span><b>{title}</b><small>{desc}</small></span><em>↗</em></button>)}</article>
          </section>
          <section className="lower-grid"><article className="panel"><div className="eyebrow">COMPANY PULSE</div><h2>Operations overview</h2>{workspace?<><div className="pulse-stat"><span>Pending approvals</span><b>{workspace.summary?.pendingApprovals??0}</b><button onClick={()=>setActive("Approvals")}>Review ↗</button></div><div className="pulse-stat"><span>Net recorded finance</span><b>{naira(workspace.summary?.netNgn??0)}</b><button onClick={()=>setActive("Finance")}>Open ledger ↗</button></div><div className="pulse-stat"><span>Active projects</span><b>{workspace.summary?.activeProjects??0}</b><button onClick={()=>setActive("Projects")}>View projects ↗</button></div></>:<div className="empty"><span>⌁</span><b>Connect the company workspace</b><p>Verified company activity and financial totals will appear here after secure sign-in.</p></div>}</article><article className="panel"><div className="eyebrow">CONNECTED ECOSYSTEM</div><h2>Registered products</h2>{(workspace?.products??[]).slice(0,4).map(item=><div className="product" key={item.id}><span>{item.product_name.slice(0,2).toUpperCase()}</span><div><b>{item.product_name}</b><small>{item.integration_mode} · {item.dashboard_url??"No dashboard URL"}</small></div><em>{item.health_status}</em></div>)}{!workspace?.products?.length?<div className="empty"><b>No registered products yet</b><p>Register independent Samzy products in Product Registry.</p></div>:null}<button className="inline-action" onClick={()=>setActive("Product Registry")}>Open Product Registry ↗</button></article></section>
        </>:active==="AI General Manager"?<section className="chat-panel">
          <div className="chat-title"><div className="chat-title-copy"><div className="eyebrow">THE COMPANY'S INTELLIGENCE PARTNER</div><h2>AI General Manager</h2><p>Samzy Technology · Private company workspace</p></div><div className="chat-title-actions"><button className="chat-menu-button" type="button" onClick={()=>setSidebarOpen(value=>!value)} aria-label="Toggle navigation">☰ Menu</button><button className="new-chat-button" type="button" onClick={()=>void startNewChat()} disabled={busy}>＋ New chat</button></div></div>
          <div className="chat-body"><div className="messages" ref={messagesContainerRef}>{messages.map(m=><article className={m.role==="user"?"message mine":"message"} key={m.id}><span className="message-avatar">{m.role==="user"?"ST":"✳"}</span><div className="message-main"><div className="message-author">{m.role==="user"?(m.actorUserId&&currentUserId&&m.actorUserId===currentUserId?"You · Samzy Technology Limited":"Company team"):"AI General Manager"}</div><div className="message-bubble">{renderMessageContent(m.content)}</div><div className="message-actions"><button type="button" aria-label="Copy message" onClick={()=>void copyMessage(m.id,m.content)}>{copiedMessageId===m.id?"✓ Copied":"▢ Copy"}</button>{m.role==="user"?<button type="button" aria-label="Edit your message" onClick={()=>editMessage(m)}>✎ Edit</button>:null}</div></div></article>)}<div ref={messagesEndRef}/>{busy?<div className="working">The company intelligence team is working…</div>:null}</div><form className="composer" onSubmit={e=>{e.preventDefault();void send();}}>{editingMessageId!==null?<div className="editing-banner"><span>Editing your message · Sending will replace it and its later replies</span><button type="button" onClick={cancelMessageEdit}>Cancel</button></div>:null}<div className="composer-input-wrap"><textarea ref={composerRef} value={draft} onChange={e=>{setDraft(e.target.value);e.currentTarget.style.height="auto";e.currentTarget.style.height=Math.min(e.currentTarget.scrollHeight,220)+"px";}} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();void send();}}} placeholder="Message your AI General Manager…" rows={1} aria-label="Message your AI General Manager"/></div><div className="composer-footer"><small>{busy?"AI team is analysing your request…":"Enter to send · Shift + Enter for a new line"}</small><button className="primary" disabled={busy||!draft.trim()}>{busy?<><span className="send-spinner"/> Working…</>:editingMessageId!==null?"Update & send":"Send"} <span aria-hidden="true">↑</span></button></div></form></div>
        </section>:<section className="panel module-workspace">
          <div className="module-heading"><div><div className="eyebrow">LIVE COMPANY WORKSPACE</div><h2>{active}</h2><p>Company records are loaded from your authenticated, organisation-scoped workspace.</p></div><div className="module-heading-actions">{active==="Leads & CRM"?<button className="primary" type="button" disabled={discoverBusy||!token||!orgId.trim()} onClick={()=>void discoverProspects()}>{discoverBusy?"Searching and saving prospects…":(workspace?.summary?.prospects??0)>0?"✦ Find more prospects":"✦ Find clients everywhere"}</button>:null}{active!=="Settings"?<button className="primary" type="button" onClick={()=>setOpenForm(openForm===active?null:active)}>＋ Add {active==="Leads & CRM"?"prospect":active==="Clients"?"client":active==="Projects"?"project":active==="Tasks"?"task":active==="Product Registry"?"product":active==="Sales & Outreach"?"outreach draft":active==="Approvals"?"approval / CRM action":"ledger entry"}</button>:null}<button className="inline-action" onClick={()=>setActive("AI General Manager")}>Discuss with AI Manager ↗</button></div></div>
          {workspaceError?<div className="module-alert">{workspaceError}</div>:null}{discoveryNotice?<div className="module-alert">{discoveryNotice}</div>:null}
          {workspaceBusy?<div className="empty"><b>Loading verified company records…</b></div>:null}
          {!token||!orgId.trim()?<div className="empty"><b>Connect your company workspace to view live records.</b><p>Open AI General Manager and sign in with an authorised company account.</p><button className="primary" onClick={()=>setActive("AI General Manager")}>Connect workspace ↗</button></div>:null}
          {token&&orgId.trim()&&!workspaceBusy?<>
            {active==="Leads & CRM"?<>
              {openForm===active && (<><form className="record-form" onSubmit={e=>void submitModuleForm(e,"prospect")}><h3>Add a prospect</h3><input name="company_name" placeholder="Company name" required/><input name="website_url" type="url" placeholder="Website URL (optional)"/><input name="industry" placeholder="Industry"/><input name="country" placeholder="Country"/><input name="fit_score" type="number" min="0" max="100" step="1" placeholder="Fit score (0–100)"/><textarea name="research_summary" placeholder="Research notes / evidence summary"/><button className="primary" disabled={saveBusy}>Save prospect</button><button type="button" className="inline-action" onClick={()=>setOpenForm(null)}>Cancel</button></form></>)}
              <div className="prospect-list">{(workspace?.prospects??[]).map(item=>{
                const profileUrl=(item.evidence??[]).find((source:any)=>typeof source?.url==="string")?.url as string|undefined;
                const phoneContact=(workspace?.contactPoints??[]).find(contact=>contact.prospect_id===item.id&&(contact.channel==="whatsapp"||contact.channel==="voice"));
                const prefixes:Record<string,string>={"Nigeria":"234","UK":"44","United Kingdom":"44","US":"1","USA":"1","United States":"1","Canada":"1","Australia":"61","UAE":"971","United Arab Emirates":"971","South Africa":"27"};
                const rawPhone=String(phoneContact?.address??"").replace(/\D/g,"").replace(/^00/,"");
                const prefix=prefixes[String(item.country??"")]??"";
                const whatsappNumber=rawPhone?(rawPhone.startsWith(prefix)&&prefix?rawPhone:rawPhone.startsWith("0")&&prefix?prefix+rawPhone.slice(1):prefix&&rawPhone.length<=10?prefix+rawPhone:rawPhone):"";
                const description=String(item.research_summary??item.industry??"").split("\n")[0].trim().slice(0,170);
                const thumbnailUrl=(item.evidence??[]).find((source:any)=>typeof source?.thumbnailUrl==="string")?.thumbnailUrl as string|undefined;
                return <article className="prospect-card" key={item.id}>
                  <div className="prospect-thumbnail" aria-hidden="true"><span>{String(item.company_name??"B").trim().charAt(0).toUpperCase()}</span>{thumbnailUrl?<img src={thumbnailUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={e=>{e.currentTarget.style.display="none";}}/>:null}</div>
                  <div className="prospect-card-content">
                    <b>{item.company_name}</b>
                    <p>{description||"Business prospect"}</p>
                    <div className="prospect-actions">
                      {profileUrl?<a href={profileUrl} target="_blank" rel="noreferrer">View Profile ↗</a>:null}
                      {whatsappNumber.length>=10?<a className="prospect-whatsapp" href={`https://wa.me/${whatsappNumber}`} target="_blank" rel="noreferrer">WhatsApp ↗</a>:null}
                    </div>
                  </div>
                </article>;
              })}{!workspace?.prospects?.length?<p className="empty">No qualified business prospects yet. Background discovery is running.</p>:null}{workspace?.prospectsHasMore?<button className="inline-action" type="button" disabled={prospectsLoadingMore} onClick={()=>void loadMoreProspects()}>{prospectsLoadingMore?"Loading more prospects…":"Load more prospects"}</button>:null}</div>
            </>:null}
            {active==="Clients"?<>
              {openForm===active && (<><form className="record-form" onSubmit={e=>void submitModuleForm(e,"client")}><h3>Add a client</h3><input name="company_name" placeholder="Company / client name" required/><input name="primary_contact_name" placeholder="Primary contact (optional)"/><input name="email" type="email" placeholder="Business email"/><input name="phone" placeholder="Phone"/><input name="website_url" type="url" placeholder="Website URL"/><input name="industry" placeholder="Industry"/><textarea name="notes" placeholder="Client notes"/><button className="primary" disabled={saveBusy}>Save client</button><button type="button" className="inline-action" onClick={()=>setOpenForm(null)}>Cancel</button></form></>)}
              <div className="record-list">{(workspace?.clients??[]).map(item=><div className="record-row" key={item.id}><div><b>{item.company_name}</b><small>{item.primary_contact_name??"No contact"} · {item.email??item.phone??"No contact details"} · {item.source_prospect_id?"Converted from CRM prospect":"Manually added"}</small></div><div className="status-editor"><span className="record-status">{item.status}</span><select aria-label={`Status for ${item.company_name}`} value={statusDrafts[item.id]??item.status} onChange={e=>setStatusDrafts(old=>({...old,[item.id]:e.target.value}))}><option value="active">Active</option><option value="inactive">Inactive</option><option value="on_hold">On hold</option></select><button disabled={saveBusy||!statusDrafts[item.id]||statusDrafts[item.id]===item.status} onClick={()=>void updateRecordStatus("client",item.id,statusDrafts[item.id])}>Save status</button></div></div>)}{!workspace?.clients?.length?<p className="empty">No client records yet.</p>:null}</div>
            </>:null}
            {active==="Projects"?<>
              {openForm===active && (<><form className="record-form" onSubmit={e=>void submitModuleForm(e,"project")}><h3>Create a project</h3><input name="project_name" placeholder="Project name" required/><select name="status" defaultValue="planned"><option value="planned">Planned</option><option value="in_progress">In progress</option><option value="blocked">Blocked</option><option value="review">Review</option></select><input name="quoted_amount_ngn" type="number" min="0" placeholder="Quoted amount (₦)"/><select name="client_id" defaultValue=""><option value="">No linked client</option>{(workspace?.clients??[]).map(client=><option key={client.id} value={client.id}>{client.company_name}</option>)}</select><select name="prospect_id" defaultValue=""><option value="">No linked prospect</option>{(workspace?.prospects??[]).map(prospect=><option key={prospect.id} value={prospect.id}>{prospect.company_name}</option>)}</select><select name="product_id" defaultValue=""><option value="">No assigned Samzy product</option>{(workspace?.products??[]).map(product=><option key={product.id} value={product.id}>{product.product_name}</option>)}</select><input name="due_at" type="datetime-local" aria-label="Project due date"/><button className="primary" disabled={saveBusy}>Create project</button><button type="button" className="inline-action" onClick={()=>setOpenForm(null)}>Cancel</button></form></>)}
              <div className="record-list">{(workspace?.projects??[]).map(item=><div className="record-row" key={item.id}><div><b>{item.project_name}</b><small>{item.quoted_amount_ngn?naira(Number(item.quoted_amount_ngn)):"No quote"} · {item.client_id?workspace?.clients?.find(client=>client.id===item.client_id)?.company_name??"Linked client":item.prospect_id?workspace?.prospects?.find(prospect=>prospect.id===item.prospect_id)?.company_name??"Linked prospect":"No linked client or prospect"} · {item.product_id?workspace?.products?.find(product=>product.id===item.product_id)?.product_name??"Assigned product":"No product assigned"} · {item.due_at?new Date(item.due_at).toLocaleDateString():"No due date"}</small></div><div className="status-editor"><span className="record-status">{item.status.replace("_"," ")}</span><select aria-label={`Status for ${item.project_name}`} value={statusDrafts[item.id]??item.status} onChange={e=>setStatusDrafts(old=>({...old,[item.id]:e.target.value}))}><option value="planned">Planned</option><option value="in_progress">In progress</option><option value="blocked">Blocked</option><option value="review">Review</option><option value="delivered">Delivered</option><option value="cancelled">Cancelled</option></select><button disabled={saveBusy||!statusDrafts[item.id]||statusDrafts[item.id]===item.status} onClick={()=>void updateRecordStatus("project",item.id,statusDrafts[item.id])}>Save status</button></div></div>)}{!workspace?.projects?.length?<p className="empty">No project records yet.</p>:null}</div>
            </>:null}
            {active==="Tasks"?<>
              {openForm===active && (<><form className="record-form" onSubmit={e=>void submitModuleForm(e,"task")}><h3>Create a company task</h3><input name="title" placeholder="Task title" required/><textarea name="description" placeholder="Task details / expected outcome"/><select name="priority" defaultValue="normal"><option value="low">Low priority</option><option value="normal">Normal priority</option><option value="high">High priority</option><option value="urgent">Urgent</option></select><select name="project_id" defaultValue=""><option value="">No linked project</option>{(workspace?.projects??[]).map(item=><option key={item.id} value={item.id}>{item.project_name}</option>)}</select><select name="client_id" defaultValue=""><option value="">No linked client</option>{(workspace?.clients??[]).map(item=><option key={item.id} value={item.id}>{item.company_name}</option>)}</select><select name="prospect_id" defaultValue=""><option value="">No linked prospect</option>{(workspace?.prospects??[]).map(item=><option key={item.id} value={item.id}>{item.company_name}</option>)}</select><input name="due_at" type="datetime-local" aria-label="Task due date"/><button className="primary" disabled={saveBusy}>Create task</button><button type="button" className="inline-action" onClick={()=>setOpenForm(null)}>Cancel</button></form></>)}
              <div className="record-list">{(workspace?.tasks??[]).map(item=><div className="record-row" key={item.id}><div><b>{item.title}</b><small>{item.description??"No task details"} · {item.priority} priority · {item.due_at?"Due "+new Date(item.due_at).toLocaleString():"No due date"} · {item.project_id?"Linked project":item.client_id?"Linked client":item.prospect_id?"Linked prospect":"No linked record"}</small></div><div className="status-editor"><span className="record-status">{item.status.replaceAll("_"," ")}</span><select aria-label={"Status for "+item.title} value={statusDrafts[item.id]??item.status} onChange={e=>setStatusDrafts(old=>({...old,[item.id]:e.target.value}))}><option value="open">Open</option><option value="in_progress">In progress</option><option value="blocked">Blocked</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select><button disabled={saveBusy||!statusDrafts[item.id]||statusDrafts[item.id]===item.status} onClick={()=>void updateRecordStatus("task",item.id,statusDrafts[item.id])}>Save status</button></div></div>)}{!workspace?.tasks?.length?<p className="empty">No tasks recorded yet.</p>:null}</div>
            </>:null}
            {active==="Product Registry"?<>{openForm===active && (<><form className="record-form" onSubmit={e=>void submitModuleForm(e,"product")}><h3>Register a Samzy product</h3><input name="product_name" placeholder="Product name" required/><input name="product_key" placeholder="Unique key (lowercase, hyphens)" pattern="[a-z0-9-]+" required/><input name="dashboard_url" type="url" placeholder="Dashboard URL (optional)"/><select name="integration_mode" defaultValue="manual"><option value="manual">Manual</option><option value="api">API</option><option value="webhook">Webhook</option><option value="oauth">OAuth</option></select><input name="capabilities" placeholder="Capabilities, comma-separated"/><button className="primary" disabled={saveBusy}>Register product</button><button type="button" className="inline-action" onClick={()=>setOpenForm(null)}>Cancel</button></form></>)}<div className="record-list">{(workspace?.products??[]).map(item=><div className="record-row" key={item.id}><div><b>{item.product_name}</b><small>{item.product_key} · {item.integration_mode} · {item.dashboard_url??"No dashboard URL"}</small></div><span className="record-status">{item.health_status}</span></div>)}{!workspace?.products?.length?<p className="empty">No registered products yet.</p>:null}</div></>:null}
            {active==="Sales & Outreach"?<><div className="module-note">Email drafts can be sent by an organisation owner or administrator after contact verification, consent/source checks, suppression checks and frequency limits. WhatsApp first-contact sending requires an approved Meta message template.</div>{openForm===active && (<><form className="record-form" onSubmit={e=>void submitModuleForm(e,"outreach_draft")}><h3>Prepare an outreach draft</h3><select name="contact_point_id" required defaultValue=""><option value="">Select a verified contact</option>{(workspace?.contactPoints??[]).map(contact=><option key={contact.id} value={contact.id} disabled={!contact.is_verified||!contact.consent_basis}>{contact.channel} · {contact.address} · {contact.is_verified&&contact.consent_basis?"Eligible for review":"Needs verification / consent"}</option>)}</select><textarea name="body" minLength={10} maxLength={4000} placeholder="Write a specific, personalised message for this prospect…" required/><button className="primary" disabled={saveBusy}>Save outreach draft</button><button type="button" className="inline-action" onClick={()=>setOpenForm(null)}>Cancel</button></form></>)}<div className="record-list">{(workspace?.outreach??[]).map(item=><div className="record-row" key={item.id}><div><b>{item.direction} · {item.channel} · {item.recipient}</b><small>{item.body??"No message preview"} · {item.created_at?new Date(item.created_at).toLocaleString():""}</small></div><div className="approval-actions"><span className="record-status">{item.status}</span>{item.status==="draft"&&item.channel==="email"&&workspace?.canSendOutreach?<button disabled={saveBusy} onClick={()=>void sendOutreach(item.id)}>Send email now</button>:null}{item.status==="draft"&&item.channel==="whatsapp"&&workspace?.canSendOutreach?<button disabled={saveBusy} onClick={()=>void sendWhatsAppOutreach(item.id)}>Send WhatsApp</button>:null}</div></div>)}{!workspace?.outreach?.length?<p className="empty">No outreach events recorded.</p>:null}</div></>:null}
            {active==="Approvals"?<>{openForm===active && (<><form className="record-form" onSubmit={e=>void submitModuleForm(e,"approval")}><h3>Request an approval</h3><input name="title" placeholder="Approval title" required/><select name="category" defaultValue="other"><option value="outreach">Outreach</option><option value="pricing">Pricing</option><option value="contract">Contract</option><option value="payment">Payment</option><option value="delivery">Delivery</option><option value="other">Other</option></select><textarea name="description" placeholder="What needs approval and why?" required/><button type="submit" className="primary" disabled={saveBusy}>Submit for approval</button><button type="button" className="inline-action" onClick={()=>setOpenForm(null)}>Cancel</button></form></>)}<div className="record-list">{(workspace?.approvals??[]).map(item=><div className="record-row approval-row" key={item.id}><div><b>{item.title}</b><small>{item.category} · {item.description}</small></div><div className="approval-actions"><span className="record-status">{item.status}</span>{item.status==="pending"?<><button disabled={saveBusy} onClick={()=>void decideApproval(item.id,"approved")}>Approve</button><button disabled={saveBusy} onClick={()=>void decideApproval(item.id,"rejected")}>Reject</button></>:null}</div></div>)}{!workspace?.approvals?.length?<p className="empty">No approval requests are waiting.</p>:null}</div>{openForm===active && (<><form className="record-form" onSubmit={e=>void proposeProspectAction(e)}><h3>Submit a CRM action for approval</h3><p className="muted">This creates a pending proposal. It will not change the CRM until an owner or administrator approves it.</p><input value={actionDraft.company_name} onChange={e=>setActionDraft(old=>({...old,company_name:e.target.value}))} placeholder="Prospect company name" required/><input type="url" value={actionDraft.website_url} onChange={e=>setActionDraft(old=>({...old,website_url:e.target.value}))} placeholder="Website URL (optional)"/><input value={actionDraft.industry} onChange={e=>setActionDraft(old=>({...old,industry:e.target.value}))} placeholder="Industry"/><input value={actionDraft.country} onChange={e=>setActionDraft(old=>({...old,country:e.target.value}))} placeholder="Country"/><input type="number" min="0" max="100" value={actionDraft.fit_score} onChange={e=>setActionDraft(old=>({...old,fit_score:e.target.value}))} aria-label="Prospect fit score"/><textarea value={actionDraft.research_summary} onChange={e=>setActionDraft(old=>({...old,research_summary:e.target.value}))} placeholder="Research notes (optional)"/><button className="primary" disabled={saveBusy||!actionDraft.company_name.trim()}>Submit action for approval</button><button type="button" className="inline-action" onClick={()=>setOpenForm(null)}>Cancel</button></form></>)}<div className="record-list"><h3>AI action requests</h3>{actionsBusy?<p className="empty">Loading action requests…</p>:null}{aiActions.map(action=><div className="record-row approval-row" key={action.id}><div><b>{action.summary}</b><small>{action.action_type.replaceAll("_"," ")} · Requested {new Date(action.created_at).toLocaleString()} · Expires {new Date(action.expires_at).toLocaleString()}{action.failure_reason?" · "+action.failure_reason:""}{action.execution_result?.record_id?" · Record "+String(action.execution_result.record_id):""}</small></div><div className="approval-actions"><span className="record-status">{action.status.replaceAll("_"," ")}</span>{action.status==="pending_approval"&&canReviewAI?<><button disabled={saveBusy} onClick={()=>void reviewAIAction(action.id,"approved")}>Approve & execute</button><button disabled={saveBusy} onClick={()=>void reviewAIAction(action.id,"rejected")}>Reject</button></>:null}</div></div>)}{!actionsBusy&&!aiActions.length?<p className="empty">No AI action proposals yet.</p>:null}</div></>:null}
            {active==="Finance"?<>
              <div className="finance-summary"><div><small>Income recorded</small><b>{naira(workspace?.summary?.incomeNgn??0)}</b></div><div><small>Expenses recorded</small><b>{naira(workspace?.summary?.expensesNgn??0)}</b></div><div><small>Net recorded</small><b>{naira(workspace?.summary?.netNgn??0)}</b></div></div>
              {openForm===active && (<><form className="record-form" onSubmit={e=>void submitModuleForm(e,"finance")}><h3>Record a transaction</h3><select name="direction" defaultValue="income"><option value="income">Income</option><option value="expense">Expense</option></select><input name="category" placeholder="Category" required/><input name="description" placeholder="Description" required/><input name="amount_ngn" type="number" min="1" step="1" placeholder="Amount in NGN" required/><select name="status" defaultValue="recorded"><option value="recorded">Recorded</option><option value="pending">Pending</option></select><input name="occurred_at" type="date" aria-label="Transaction date"/><button className="primary" disabled={saveBusy}>Save transaction</button><button type="button" className="inline-action" onClick={()=>setOpenForm(null)}>Cancel</button></form></>)}
              <div className="record-list">{(workspace?.finance??[]).map(item=><div className="record-row" key={item.id}><div><b>{item.description}</b><small>{item.category} · {item.occurred_at} · {item.status}</small></div><strong>{item.direction==="expense"?"−":"+"}{naira(Number(item.amount_ngn))}</strong></div>)}{!workspace?.finance?.length?<p className="empty">No financial transactions recorded.</p>:null}</div>
            </>:null}
            {active==="Settings"?<>
              <div className="settings-grid">
                <div><small>Workspace connection</small><b>Authenticated session</b></div>
                <div><small>Organisation ID</small><b>{orgId}</b></div>
                <div><small>AI providers configured</small><b>{providers.filter(p=>p.configured).length} of 5</b></div>
                <div><small>Live web research</small><b>{health?.researchReady?"Tavily configured":"Needs TAVILY_API_KEY"}</b></div>
                <div><small>Gmail OAuth</small><b>{health?.gmailOAuthReady?"OAuth credentials configured":"Needs Google OAuth credentials"}</b></div>
                <div><small>Gmail mailbox storage</small><b>{health?.emailOutreachReady?"Encrypted token storage configured":"Needs Supabase service key and token encryption"}</b></div>
                <div><small>WhatsApp outreach</small><b>Approved template + credentials required</b></div>
                <div><small>Outbound control</small><b>Owner/admin explicit send only</b></div>
              </div>
              <div className="record-form">
                <h3>Company Gmail</h3>
                <p>Connect the Samzy mailbox using Google's secure authorization. Incoming messages can then be reviewed and analysed by the AI Manager. Replies are never sent automatically.</p>
                <div className="form-actions">
                  <button className="primary" type="button" disabled={gmailBusy||!token} onClick={()=>void connectGmail()}>Connect Gmail ↗</button>
                  <button className="inline-action" type="button" disabled={gmailBusy||!token} onClick={()=>void syncGmail()}>{gmailBusy?"Working…":"Sync inbox"}</button>
                </div>
                {gmailMailbox?<p><b>Connected mailbox:</b> {gmailMailbox}</p>:null}
                {gmailError?<p className="module-alert">{gmailError}</p>:null}
                <div className="record-list">
                  {gmailMessages.map(message=><div className="record-row" key={message.id}><div><b>{message.subject||"(No subject)"}</b><small>{message.from} · {message.date}</small><p>{message.snippet}</p><textarea aria-label={`Reply draft for ${message.subject}`} rows={3} value={gmailReplyDrafts[message.id]??""} onChange={e=>setGmailReplyDrafts(old=>({...old,[message.id]:e.target.value}))} placeholder="Paste or write your approved reply here…"/></div><div className="form-actions"><button className="inline-action" type="button" onClick={()=>analyseGmailMessage(message)}>Analyse with AI ↗</button><button className="primary" type="button" disabled={gmailBusy||!(gmailReplyDrafts[message.id]??"").trim()} onClick={()=>void sendGmailReply(message)}>Send reply</button></div></div>)}
                  {!gmailMessages.length?<p className="empty">Connect Gmail and sync the inbox to review incoming messages.</p>:null}
                </div>
              </div>
            </>:null}
          </>:null}
        </section>}
        <footer><span>© Samzy Technology Limited</span><span>INTERNAL COMPANY PLATFORM · BUILD 0.2.0</span><span>⌑ Company-first workspace</span></footer>
      </div>
    </section>
  </main>;
}
