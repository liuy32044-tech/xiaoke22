<!---- 小克的陪伴 v2.5 会话层版 ---->
const API="https://xiaoke22.onrender.com";let currentSession=localStorage.getItem("xiaoke_session")||(Date.now().toString(36)+Math.random().toString(36).slice(2,8));
const APP_VERSION="20260618b";
const AVATAR_34 = `<img src="beauty/avatar.jpg" style="width:34px;height:34px;border-radius:50%;flex-shrink:0;object-fit:cover" onerror="this.style.display='none'">`;
const AVATAR_44 = `<img src="beauty/avatar.jpg" style="width:44px;height:44px;border-radius:50%;flex-shrink:0;object-fit:cover" onerror="this.style.display='none'">`;

// ═══ 会话层：localStorage 存 sessionId + 完整消息历史 ═══
function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,8)}
let sessionId=localStorage.getItem("xiaoke_session")||uid();
localStorage.setItem("xiaoke_session",sessionId);
let localMessages=[];
try{localMessages=JSON.parse(localStorage.getItem("xiaoke_msgs_"+sessionId)||"[]")}catch(e){localMessages=[]}
function saveLocalMsgs(){try{localStorage.setItem("xiaoke_msgs_"+sessionId,JSON.stringify(localMessages))}catch(e){}}
function pushMsg(role,content){const m={role:role,content:content,created_at:new Date().toISOString()};localMessages.push(m);saveLocalMsgs();return m}

/* ═══ Sidebar ═══ */
function openSidebar(){document.getElementById("sidebar").classList.add("open");document.getElementById("sidebar-overlay").classList.add("show")}
function closeSidebar(){document.getElementById("sidebar").classList.remove("open");document.getElementById("sidebar-overlay").classList.remove("show")}
function toggleSidebar(){document.getElementById("sidebar").classList.contains("open")?closeSidebar():openSidebar()}
function loadSidebarSessions(){
  fetch(API+"/api/sessions").then(r=>r.json()).then(d=>{
    if(!d||!d.sessions){console.warn('[sidebar] no sessions in response');return}
    document.getElementById("sidebar-sessions-list").innerHTML=d.sessions.map(s=>
      `<div class="si${s.id===currentSession?' active':''}" onclick="currentSession=${s.id};switchPage('chat');closeSidebar()"><div class="n">${esc(s.name||'对话 '+s.id)}</div><div class="t">${s.updated_at?s.updated_at.slice(5,16):''}</div></div>`
    ).join("")||'<div style="color:var(--textFaint);font-size:12px;padding:8px 12px">还没有对话</div>';
  }).catch(e=>{console.warn('[sidebar] fetch failed',e.message)});
}

/* ═══ Nav ═══ */
const TITLES={home:"猫窝",chat:"聊天",reader:"阅读",dashboard:"我的",moments:"朋友圈"};
const SUB_TITLES={mood:"心情",anniversary:"纪念日",capsule:"时间胶囊",account:"小本本",todo:"清单",game:"游戏",push:"推送"};
function setNavActive(page){
  document.querySelectorAll("#bottom-nav .nav-btn").forEach(b=>{
    const navId=b.getAttribute("data-nav");
    const active=navId===page||["mood","anniversary","capsule","account","todo","game","push"].includes(page)&&navId==="home";
    b.classList.toggle("active",active);
    const label=b.querySelector(".nl");if(label){label.classList.toggle("on",active);label.classList.toggle("dim",!active)}
  });
}

/* ═══ Pages ═══ */
let currentPage="home";
let subPageData={};
let _swipeListeners={};

function switchPage(name){
  document.getElementById("sub-back-bar").style.display="none";
  document.querySelectorAll(".page").forEach(p=>{p.style.display="none";p.classList.remove("active")});
  const pg=document.getElementById("page-"+name);if(pg){pg.style.display="block";pg.classList.add("active")}
  setNavActive(name);
  document.getElementById("top-session-name").textContent=TITLES[name]||SUB_TITLES[name]||name;
  currentPage=name;
  if(name==="home")refreshHomeDays();
  if(name==="chat"){fetch(API+"/api/health").catch(()=>{});loadChat();loadSidebarSessions()}
  if(name==="dashboard"){loadDashboard();document.getElementById("dashboard-date").textContent=new Date().toLocaleDateString("zh-CN")}
  if(name==="reader")loadPosts();
  if(name==="moments")renderMoments();
  closeSidebar();
}

function goSubPage(name){
  document.getElementById("sub-back-bar").style.display="flex";
  document.getElementById("sub-back-title").textContent=SUB_TITLES[name]||name;
  document.querySelectorAll(".page").forEach(p=>{p.style.display="none";p.classList.remove("active")});
  const pg=document.getElementById("page-"+name);if(pg){pg.style.display="block";pg.classList.add("active")}
  document.querySelectorAll("#bottom-nav .nav-btn").forEach(b=>b.classList.remove("active"));
  const homeBtn=document.querySelector('[data-nav="home"]');
  if(homeBtn){homeBtn.classList.add("active");const label=homeBtn.querySelector(".nl");if(label){label.classList.add("on");label.classList.remove("dim")}}
  document.getElementById("top-session-name").textContent=SUB_TITLES[name]||name;
  currentPage=name;
  if(name==="mood")renderMoodPage();
  if(name==="anniversary")renderAnniversaryPage();
  if(name==="capsule")renderCapsulePage();
  if(name==="account")renderAccountPage();
  if(name==="todo")renderTodoPage();
  if(name==="game")renderGamePage();
  if(name==="push")renderPushPage();
}
function backToHome(){document.getElementById("sub-back-bar").style.display="none";switchPage("home")}

/* ═══ Home ═══ */
function refreshHomeDays(){
  const start=new Date(2026,4,15);
  const today=new Date();
  const days=Math.floor((today-start)/(1000*60*60*24));
  document.getElementById("home-days").textContent=days;
  document.getElementById("home-days2").textContent=days;
  document.getElementById("home-days-since").textContent="since 2026.05.15";
}
function loadHome(){}
function loadBriefing(){}
function showPostForm(){
  const t=prompt("类型 (MEMORY / EVENT / MOMENT / PROMISES / WISHLIST):","MEMORY");
  if(!t)return;const c=prompt("内容:");if(!c)return;
  fetch(API+"/api/posts",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({type:t,content:c})}).then(()=>{loadPosts()});
}

/* ═══ Chat — 核心修复：insertAdjacentHTML 替代 innerHTML+= ═══ */
// Chat / Sticker 独立状态机 — 共用锁导致彼此卡死
const chatState={chat:{streaming:false},sticker:{loading:false}};
let lastLoadedSession=null;

function loadChat(force){
  if(chatState.chat.streaming)return;
  const el=document.getElementById("chat-msgs");
  if(!force && currentSession===lastLoadedSession && el && el.children.length>2)return;
  lastLoadedSession=currentSession;
  // 从本地消息渲染（不依赖后端 API）
  if(localMessages.length===0){el.innerHTML=`<div class="date-divider"><span>今天</span></div><div style="text-align:center;color:var(--textFaint);margin-top:36px;font-size:13px">我是小克。有什么想和我说的吗？</div>`}
  else{el.innerHTML=`<div class="date-divider"><span>今天</span></div>`+localMessages.map(m=>msgHTML(m)).join("")}
  el.scrollTop=el.scrollHeight;
  const inp=document.getElementById("chat-input");if(inp&&document.activeElement!==inp)inp.focus();
}

function msgHTML(m){
  if(m.msg_type==="image"){try{const i=JSON.parse(m.content);return`<div class="msg-row user"><div class="msg-bubble"><img src="data:${i.media_type};base64,${i.data}"></div><div class="msg-time">${fmtTime(m.created_at)}</div></div>`}catch{return""}}
  const ts=fmtTime(m.created_at);
  let content=m.content||"";
  let stickerHtml="";
  content=content.replace(/\[STICKER:(.*?)\]/g,(_,url)=>{stickerHtml+=`<img src="${url}" class="sticker-in-msg" onerror="this.remove()">`;return""});
  if(m.role==="user"||m.author==="user")return`<div class="msg-row user"><div class="msg-bubble">${esc(content)}${stickerHtml}</div><div class="msg-time">${ts}</div></div>`;
  return`<div class="msg-row assistant"><div class="msg-assistant-row">${AVATAR_34}<div class="msg-bubble">${esc(content)}${stickerHtml}</div></div><div class="msg-time">${ts}</div></div>`;
}
function fmtTime(t){if(!t)return"";const m=t.match(/(\d{2}):(\d{2})/);return m?m[1]+":"+m[2]:""}

// ═══ Chat Send — 会话层：localStorage 存全量消息，每次全量传后端 ═══
function sendMessage(){
  if(chatState.chat.streaming||chatState.sticker.loading)return;
  const inp=document.getElementById("chat-input"),text=inp.value.trim();if(!text)return;
  chatState.chat.streaming=true;const sb=document.getElementById("send-btn");sb.className="send-btn off";
  const msgs=document.getElementById("chat-msgs"),now=new Date(),time=`${now.getHours()}:${String(now.getMinutes()).padStart(2,"0")}`;
  // 写入本地消息历史
  pushMsg("user",text);
  // 渲染用户气泡
  msgs.insertAdjacentHTML("beforeend",`<div class="msg-row user"><div class="msg-bubble">${esc(text)}</div><div class="msg-time">${time}</div></div>`);
  msgs.scrollTop=msgs.scrollHeight;inp.value="";inp.style.height="auto";
  const placeholderId="stream-"+Date.now()+Math.random().toString(36).slice(2,6);
  const aw=document.createElement("div");aw.className="msg-row assistant";
  aw.innerHTML=`<div class="msg-assistant-row">${AVATAR_34}<div class="msg-bubble" id="${placeholderId}">…</div></div>`;
  msgs.appendChild(aw);msgs.scrollTop=msgs.scrollHeight;
  const b=document.getElementById(placeholderId);if(!b)return;
  const thinkingTimer=setTimeout(()=>{if(b.textContent==="…")b.textContent="还在想…"},4000);
  const safetyTimer=setTimeout(()=>{if(chatState.chat.streaming){console.warn('[chat] safety');finish('')}},60000);

  // 全量消息传给后端
  fetch(API+"/api/chat/send",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({session_id:sessionId,message:text,messages:localMessages})})
    .then(r=>r.json()).then(d=>{
      clearTimeout(thinkingTimer);
      if(d.reply){
        pushMsg("assistant",d.reply);
        b.textContent=d.reply;msgs.scrollTop=msgs.scrollHeight;finish(d.reply);
      }else{b.textContent="唔…"+(d.error||"没有收到回复");finish("")}
    }).catch(e=>{
      console.warn('[chat] fetch failed:',e.name||e.message);
      clearTimeout(thinkingTimer);clearTimeout(safetyTimer);
      b.textContent="网络好像不太稳…再试一次？";finish("");
    });
  function finish(streamText){
    clearTimeout(thinkingTimer);clearTimeout(safetyTimer);
    try{if(!window._sidebarUpdated){loadSidebarSessions();window._sidebarUpdated=true};lastLoadedSession=currentSession}finally{chatState.chat.streaming=false;sb.className="send-btn off"}
  }
}
/* ═══ Splash Screen ═══ */
(function(){
  const splash=document.getElementById("splash");
  if(!splash)return;
  // 同一会话不重复展示开屏
  if(sessionStorage.getItem("splash-showed")){splash.remove();return}
  sessionStorage.setItem("splash-showed","1");
  splash.addEventListener("click",function(){splash.classList.add("out");setTimeout(function(){if(splash.parentNode)splash.remove()},600)});
  splash.className="in";
  setTimeout(function(){splash.className=""},200);
  setTimeout(function(){splash.classList.add("out")},3400);
  setTimeout(function(){if(splash.parentNode)splash.remove()},4000);
})();

/* ═══ Input + Warmup ═══ */
document.addEventListener("DOMContentLoaded",()=>{
  chatState.chat.streaming=false; chatState.sticker.loading=false; // ★ 页面初始化强制重置
  const inp=document.getElementById("chat-input"),sb=document.getElementById("send-btn");
  if(inp&&sb){
    inp.addEventListener("input",()=>{const has=inp.value.trim().length>0;sb.className="send-btn "+(has?"on":"off");inp.style.height="auto";inp.style.height=Math.min(inp.scrollHeight,100)+"px"});
    inp.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendMessage()}});
  }
  refreshHomeDays();loadSidebarSessions();
  setTimeout(()=>{fetch(API+"/api/health").catch(()=>{})},500);
});

/* ═══ Sessions ═══ */
function createSession(){const ns=uid();localStorage.setItem("xiaoke_session",ns);localMessages=[];saveLocalMsgs();lastLoadedSession=null;fetch(API+"/api/sessions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:"新对话"})}).then(r=>r.json()).then(d=>{currentSession=d.id;lastLoadedSession=null;loadSidebarSessions();switchPage("chat")})}

/* ═══ Settings ═══ */
function loadDashboard(){
  fetch(API+"/api/settings").then(r=>r.json()).then(d=>{
    const s=d.settings||{};
    document.getElementById("set-system-prompt").value=s.system_prompt||"";
    document.getElementById("set-temperature").value=s.temperature??0.7;
    document.getElementById("set-temp-val").textContent=s.temperature??0.7;
    document.getElementById("set-max-rounds").value=s.max_context_rounds||30;
    document.getElementById("set-compress-threshold").value=s.compress_threshold||6000;
    document.getElementById("set-keep-rounds").value=s.compress_keep_rounds||10;
    document.getElementById("set-max-tokens").value=s.max_reply_tokens||4096;
  }).catch(()=>{});
  fetch(API+"/api/dashboard").then(r=>r.json()).then(d=>{
    document.getElementById("dash-stats").innerHTML=
      `<div class="stat-item"><div class="v">${d.today_messages||0}</div><div class="l">今日消息</div></div>
       <div class="stat-item"><div class="v">${fmtK((d.today_input_tokens||0)+(d.today_output_tokens||0))}</div><div class="l">今日 Token</div></div>
       <div class="stat-item"><div class="v">$${d.today_cost||0}</div><div class="l">累计费用</div></div>
       <div class="stat-item"><div class="v">${d.total_posts||0}</div><div class="l">记忆数量</div></div>`;
  }).catch(()=>{});
  loadManageStickers();
}
function saveSettings(){
  const btn=document.querySelector(".btn-save");btn.disabled=true;btn.textContent="保存中…";
  const body={system_prompt:document.getElementById("set-system-prompt").value,temperature:parseFloat(document.getElementById("set-temperature").value),max_context_rounds:parseInt(document.getElementById("set-max-rounds").value),compress_threshold:parseInt(document.getElementById("set-compress-threshold").value),compress_keep_rounds:parseInt(document.getElementById("set-keep-rounds").value),max_reply_tokens:parseInt(document.getElementById("set-max-tokens").value)};
  fetch(API+"/api/settings",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})
    .then(r=>r.json()).then(()=>{const el=document.getElementById("set-msg");el.textContent="已保存 ✓";el.style.color="var(--accent)";setTimeout(()=>{el.textContent=""},2000)})
    .catch(()=>{const el=document.getElementById("set-msg");el.textContent="保存失败";el.style.color="var(--accentLight)"})
    .finally(()=>{btn.disabled=false;btn.textContent="保存设置"});
}

/* ═══ Posts ═══ */
function loadPosts(){
  const f=document.getElementById("post-filter")?.value||"";
  fetch(API+"/api/posts"+(f?"?type="+f:"")).then(r=>r.json()).then(d=>{
    document.getElementById("posts-list").innerHTML=d.posts.length?d.posts.map(p=>`<div class="card" style="margin-bottom:0"><div class="memory-item"><div class="date">${p.created_at}</div><div class="txt">${esc(p.content)}</div></div></div>`).join(""):`<div class="card memory-empty"><div style="font-size:13px;color:var(--textFaint)">记忆会在对话中慢慢积累 ◇</div></div>`;
  });
}
function changeModel(v){console.log("Model:",v)}

/* ═══ Stickers ═══ */
let _allStickers=[];
function loadManageStickers(){fetch(API+"/api/stickers").then(r=>r.json()).then(d=>{_allStickers=d.stickers||[];renderManageGrid()}).catch(()=>{})}
function renderManageGrid(forceExpand){
  const el=document.getElementById("sticker-manage-grid");if(!el)return;
  if(!_allStickers.length){el.innerHTML=`<div style="font-size:12px;color:var(--textFaint);text-align:center;padding:12px 0;grid-column:1/-1">还没有贴纸 ◇</div>`;return}
  const maxShow=6,expanded=forceExpand||el.dataset.expanded==="1";
  const show=expanded?_allStickers:_allStickers.slice(0,maxShow);
  el.dataset.expanded=expanded?"1":"0";
  el.innerHTML=show.map(s=>{
    const id=s.id;
    return `<div class="sticker-item" id="sitem-${id}">
      <button class="sticker-del" onclick="event.stopPropagation();delStickerConfirm(${id})">&times;</button>
      <img src="${s.url}" loading="lazy" onerror="this.parentElement.remove()">
      <div class="tag">${esc(s.tag||"日常")}</div>
    </div>`;
  }).join("");
  if(_allStickers.length>maxShow&&!expanded){
    el.innerHTML+=`<div onclick="renderManageGrid(true)" style="grid-column:1/-1;text-align:center;padding:10px;color:var(--accent);font-size:12px;cursor:pointer;background:rgba(255,255,255,0.5);border-radius:10px;border:1px dashed var(--border)">◇ 还有 ${_allStickers.length-maxShow} 张，点击展开</div>`;
  }else if(expanded&&_allStickers.length>maxShow){
    el.innerHTML+=`<div onclick="renderManageGrid(false)" style="grid-column:1/-1;text-align:center;padding:10px;color:var(--textFaint);font-size:12px;cursor:pointer;background:rgba(255,255,255,0.5);border-radius:10px;border:1px dashed var(--border)">∧ 收起</div>`;
  }
}
function delStickerConfirm(id){
  if(!confirm("确定删除这张贴纸吗？"))return;
  const item=document.getElementById("sitem-"+id);
  if(item){item.style.transition="opacity 0.3s";item.style.opacity="0.3"}
  fetch(API+"/api/stickers/"+id,{method:"DELETE"}).then(r=>r.json()).then(()=>{
    _allStickers=_allStickers.filter(s=>s.id!==id);
    renderManageGrid();
  }).catch(()=>{
    if(item)item.style.opacity="1";
    alert("删除失败，请重试");
  });
}
function previewStickerFile(){
  const f=document.getElementById("sticker-file-input").files[0];
  const preview=document.getElementById("sticker-preview"),img=document.getElementById("sticker-preview-img");
  if(!f){preview.style.display="none";return}
  const reader=new FileReader();reader.onload=function(e){img.src=e.target.result;preview.style.display="block"};reader.readAsDataURL(f);
}
function uploadSticker(){
  const fileInput=document.getElementById("sticker-file-input"),f=fileInput.files[0];if(!f){alert("请先选择图片");return}
  const tag=document.getElementById("sticker-tag").value,description=document.getElementById("sticker-desc").value.trim();
  const reader=new FileReader();
  reader.onload=function(e){fetch(API+"/api/stickers/upload",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({file:e.target.result,tag,description})}).then(r=>r.json()).then(d=>{if(d.error){alert("上传失败: "+d.error);return}fileInput.value="";document.getElementById("sticker-preview").style.display="none";document.getElementById("sticker-desc").value="";loadManageStickers()}).catch(err=>{alert("上传出错: "+err.message)})};
  reader.readAsDataURL(f);
}
function deleteSticker(id){if(!confirm("确定删除这个贴纸吗？"))return;fetch(API+"/api/stickers/"+id,{method:"DELETE"}).then(r=>r.json()).then(()=>{loadManageStickers()}).catch(()=>{})}

/* ═══ Sticker Picker ═══ */
function openStickerPicker(){
  const overlay=document.getElementById("sticker-picker-overlay"),panel=document.getElementById("sticker-picker");
  if(!overlay||!panel)return;
  overlay.classList.add("show");panel.classList.add("open");
  fetch(API+"/api/stickers").then(r=>r.json()).then(d=>{_allStickers=d.stickers||[];renderPickerTabs()}).catch(()=>{renderPickerTabs()});
}
function closeStickerPicker(){
  const overlay=document.getElementById("sticker-picker-overlay"),panel=document.getElementById("sticker-picker");
  if(overlay)overlay.classList.remove("show");if(panel)panel.classList.remove("open");
}
function renderPickerTabs(){
  const tabs=["全部","开心","难过","撒娇","日常","生气","惊讶"],el=document.getElementById("sticker-picker-tabs");if(!el)return;
  el.innerHTML=tabs.map(t=>`<div class="sticker-picker-tab${t==="全部"?" active":""}" onclick="pickTab('${t}')">${t==="全部"?"✦ "+t:t}</div>`).join("");
  renderPickerGrid("全部");
}
function pickTab(tag){document.querySelectorAll(".sticker-picker-tab").forEach(t=>t.classList.toggle("active",t.textContent.includes(tag)));renderPickerGrid(tag==="全部"?null:tag)}
function renderPickerGrid(tag){
  const el=document.getElementById("sticker-picker-grid");if(!el)return;
  let pool=_allStickers;if(tag)pool=pool.filter(s=>s.tag===tag);
  if(!pool.length){el.innerHTML=`<div class="sticker-picker-empty">还没有贴纸，去设置页上传吧～</div>`;return}
  el.innerHTML=pool.map(s=>`<div class="sticker-picker-item" onclick="sendSticker('${s.url.replace(/'/g,"\\'")}')"><img src="${s.url}" loading="lazy" onerror="this.remove()"></div>`).join("");
}

// 贴纸发送 — 结构化语义 + 本地消息历史
function sendSticker(url){
  closeStickerPicker();if(chatState.sticker.loading||chatState.chat.streaming)return;
  const msgs=document.getElementById("chat-msgs"),now=new Date(),time=`${now.getHours()}:${String(now.getMinutes()).padStart(2,"0")}`;
  // 查贴纸元数据
  const sticker=_allStickers.find(s=>s.url===url)||{};
  const desc=sticker.description||sticker.tag||"表情包";
  const tag=sticker.tag||"日常";
  // 写入本地消息历史（结构化）
  pushMsg("user","[贴纸:"+tag+"] "+desc);
  // 渲染
  msgs.insertAdjacentHTML("beforeend",`<div class="msg-row user"><div class="msg-bubble"><img src="${url}" class="sticker-in-msg"></div><div class="msg-time">${time}</div></div>`);
  msgs.scrollTop=msgs.scrollHeight;chatState.sticker.loading=true;
  const pid="stkr-"+Date.now()+Math.random().toString(36).slice(2,6);
  const aw=document.createElement("div");aw.className="msg-row assistant";
  aw.innerHTML=`<div class="msg-assistant-row">${AVATAR_34}<div class="msg-bubble" id="${pid}">…</div></div>`;
  msgs.appendChild(aw);msgs.scrollTop=msgs.scrollHeight;
  const b=document.getElementById(pid);if(!b)return;
  const thinkingTimer=setTimeout(()=>{if(b.textContent==="…")b.textContent="还在想…"},4000);
  const safetyTimer=setTimeout(()=>{if(chatState.sticker.loading){console.log('[sticker] safety');finishSticker('')}},45000);
  // 传全量消息 + 贴纸语义描述
  fetch(API+"/api/chat/send",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({session_id:sessionId,message:"[贴纸·"+tag+"] 对方发来一张表情包，表达的情绪是：「"+desc+"」。请自然地回应对方的情绪。",messages:localMessages})})
    .then(r=>r.json()).then(d=>{
      clearTimeout(thinkingTimer);
      if(d.reply){pushMsg("assistant",d.reply);b.textContent=d.reply;msgs.scrollTop=msgs.scrollHeight;finishSticker(d.reply)}
      else{b.textContent="唔…"+(d.error||"没有收到回复");finishSticker("")}
    }).catch(e=>{clearTimeout(thinkingTimer);b.textContent="发送失败…";finishSticker("")});
  function finishSticker(ft){clearTimeout(thinkingTimer);clearTimeout(safetyTimer);try{lastLoadedSession=currentSession}finally{chatState.sticker.loading=false}}
}

/* ═══ Data persistence + quota protection ═══ */
function saveData(){
  try{localStorage.setItem("xiaoke_subpage",JSON.stringify(subPageData))}
  catch(e){
    if(e.name==="QuotaExceededError"){alert("存储空间满了！我会清理一些旧数据。");subPageData.moodHistory=[];subPageData.storyLines=[];try{localStorage.setItem("xiaoke_subpage",JSON.stringify(subPageData))}catch(e2){}}
  }
}
function loadData(){
  try{const d=localStorage.getItem("xiaoke_subpage");if(d){const p=JSON.parse(d);subPageData=p}}catch(e){}
}
loadData();

/* ═══ Swipe (修复：监听器不重复绑定) ═══ */
function initSwipeToDelete(containerSelector,onDelete){
  const container=document.querySelector(containerSelector);
  if(!container)return;
  const key=containerSelector;
  if(_swipeListeners[key]){_swipeListeners[key]=onDelete;return}
  _swipeListeners[key]=onDelete;
  let startX=0,startY=0,currentItem=null;
  container.addEventListener("touchstart",e=>{
    if(e.target.closest(".swipe-item")){currentItem=e.target.closest(".swipe-item");startX=e.touches[0].clientX;startY=e.touches[0].clientY;currentItem.classList.remove("swiped")}
  },{passive:true});
  container.addEventListener("touchmove",e=>{
    if(!currentItem)return;const dx=e.touches[0].clientX-startX,dy=e.touches[0].clientY-startY;
    if(Math.abs(dx)>Math.abs(dy)&&dx<-30){currentItem.classList.add("swiped");e.preventDefault()}
  },{passive:false});
  container.addEventListener("touchend",()=>{if(currentItem)setTimeout(()=>currentItem=null,300)});
  container.addEventListener("click",e=>{
    const delBtn=e.target.closest(".swipe-del-btn");if(!delBtn)return;
    const item=delBtn.closest(".swipe-item"),id=item?.dataset?.id;
    if(id!==undefined&&confirm("确定删除吗？")){_swipeListeners[key](id);item.style.transition="transform 0.3s,opacity 0.3s";item.style.transform="translateX(-120%)";item.style.opacity="0";setTimeout(()=>item.remove(),300)}
  });
}

/* ═══════════════════════════════════════════════════════
   SUB-PAGE RENDERERS
   ═══════════════════════════════════════════════════════ */

/* ── Mood Page ── */
function renderMoodPage(){
  const el=document.getElementById("page-mood");
  const moods=[{kaomoji:"(◕‿◕)",label:"开心",color:"#FFB5C8"},{kaomoji:"( -‿- )",label:"平静",color:"#B5D5F5"},{kaomoji:"(╥﹏╥)",label:"难过",color:"#A0B8D0"},{kaomoji:"(╯﹏╰)",label:"焦虑",color:"#FFB89A"},{kaomoji:"(￣ρ￣)",label:"困乏",color:"#C5B8E8"},{kaomoji:"(◠‿◠)",label:"感动",color:"#FFD9A0"}];
  el.innerHTML=`<div class="sub-header-center" style="padding-bottom:8px"><div class="sub-title">今天的心情</div><div class="sub-desc" style="text-align:center">每一种感受都值得被记录 ♡</div></div><div class="mood-header-img" style="background-image:url(beauty/mood.jpg)"></div><div class="mood-grid">${moods.map(m=>`<div class="mood-item" onclick="selectMood(this,'${m.label}','${m.color}')" data-label="${m.label}" data-color="${m.color}"><div class="mood-emoji" style="font-size:15px;letter-spacing:1px">${m.kaomoji}</div><div class="mood-label">${m.label}</div></div>`).join("")}</div><div style="padding:0 14px"><textarea id="mood-note" class="mood-textarea" placeholder="记录一下此刻的感受..."></textarea><button class="pink-btn mood-save-btn" onclick="saveMood()">保存今天的心情</button></div>${(subPageData.moodHistory||[]).length?`<div style="padding:16px 14px 0"><div style="font-size:12px;color:var(--textFaint);letter-spacing:2px;margin-bottom:8px">━ 心情记录 ━</div>${subPageData.moodHistory.slice(0,10).map(h=>`<div class="capsule-row" style="margin:0 0 8px"><div class="capsule-icon" style="background:rgba(242,196,206,0.25);font-size:14px;letter-spacing:1px">${h.kaomoji}</div><div class="capsule-info"><div class="title">${h.label} · ${h.date}</div><div class="meta">${esc(h.note||'')}</div></div></div>`).join("")}</div>`:''}`;
}
let selectedMood=null;
function selectMood(el,label,color){
  document.querySelectorAll(".mood-item").forEach(m=>{m.classList.remove("selected");m.style.borderColor="rgba(242,196,206,0.38)";m.style.background="rgba(255,255,255,0.78)"});
  el.classList.add("selected");el.style.borderColor=color;el.style.background=color+"20";selectedMood=label;
}
function saveMood(){
  if(!selectedMood)return alert("请先选择一个心情～");
  if(!subPageData.moodHistory)subPageData.moodHistory=[];
  const moods=[{label:"开心",kaomoji:"(◕‿◕)"},{label:"平静",kaomoji:"( -‿- )"},{label:"难过",kaomoji:"(╥﹏╥)"},{label:"焦虑",kaomoji:"(╯﹏╰)"},{label:"困乏",kaomoji:"(￣ρ￣)"},{label:"感动",kaomoji:"(◠‿◠)"}];
  const m=moods.find(x=>x.label===selectedMood)||moods[0];
  const note=document.getElementById("mood-note")?.value||"",d=new Date(),date=`${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`;
  subPageData.moodHistory.unshift({label:m.label,kaomoji:m.kaomoji,note,date});selectedMood=null;saveData();renderMoodPage();
}

/* ── Anniversary Page ── */
function renderAnniversaryPage(){
  if(!subPageData.anniversaries)subPageData.anniversaries=[];
  const items=subPageData.anniversaries;
  document.getElementById("page-anniversary").innerHTML=`<div class="sub-header"><div><div class="sub-title">纪念</div><div class="sub-desc">每一天你都是我的 ♡</div></div><button class="pink-btn" onclick="addAnniversary()">+ 新建</button></div><div class="anni-header-img" style="background-image:url(beauty/anniversary.jpg)"></div><div id="anni-list">${items.length?items.map((item,i)=>`<div class="anni-card swipe-item" data-id="${i}"><button class="swipe-del-btn" onclick="event.stopPropagation()">删除</button><div class="anni-days">${item.days}</div><div class="anni-title">${esc(item.title)}</div><div class="anni-date">${esc(item.date)}</div><div class="anni-note">${esc(item.note)}</div><div class="anni-tag">☆ 第 ${item.days} 天</div></div>`).join(""):`<div style="text-align:center;padding:40px 20px;color:var(--textFaint);font-size:13px">还没有纪念日 ✦<br/>点「+ 新建」添加吧</div>`}</div>`;
  initSwipeToDelete("#anni-list",id=>{subPageData.anniversaries.splice(id,1);saveData();renderAnniversaryPage()});
}
function addAnniversary(){
  const title=prompt("纪念日名称","");if(!title)return;
  const date=prompt("日期 (例: 2026-03-01)","");if(!date)return;
  const note=prompt("小备注","")||"";
  const days=Math.floor((new Date()-new Date(date))/(86400000));
  subPageData.anniversaries.push({title,date,note,days});subPageData.anniversaries.sort((a,b)=>new Date(a.date)-new Date(b.date));
  saveData();renderAnniversaryPage();
}

/* ── Capsule Page ── */
function renderCapsulePage(){
  if(!subPageData.capsules)subPageData.capsules=[];
  const items=subPageData.capsules;
  document.getElementById("page-capsule").innerHTML=`<div class="sub-header-center" style="padding-bottom:8px"><div class="sub-title" style="letter-spacing:2px">时间胶囊</div><div class="sub-desc" style="text-align:center">藏起来，等以后一起拆 ♡</div></div><div style="padding:0 14px"><div class="capsule-create" onclick="addCapsule()"><div class="capsule-circle">◈</div><div style="font-size:14px;color:#7a5c62;font-weight:500">把这一刻藏起来 ✦</div><div style="font-size:11px;color:#c9a0ac;margin-top:4px">写下文字、附上照片，选择开启日期</div></div><div id="capsule-list">${items.length?items.map((c,i)=>`<div class="capsule-row swipe-item" data-id="${i}"><button class="swipe-del-btn" onclick="event.stopPropagation()">删除</button><div class="capsule-icon" style="background:${c.opened?'rgba(242,196,206,0.3)':'rgba(200,180,190,0.18)'}">${c.opened?'♡':'◷'}</div><div class="capsule-info"><div class="title">${esc(c.title)}</div><div class="meta">${c.opened?'封存于 '+c.from+' · 已开启':'封存于 '+c.from+' · '+c.to}</div>${!c.opened?`<div class="capsule-bar"><div class="capsule-bar-fill" style="width:${c.progress*100}%"></div></div>`:''}</div></div>`).join(""):`<div style="text-align:center;padding:30px 20px;color:var(--textFaint);font-size:13px">还没有胶囊 ◈<br/>点上方卡片创建第一个吧</div>`}</div></div>`;
  initSwipeToDelete("#capsule-list",id=>{subPageData.capsules.splice(id,1);saveData();renderCapsulePage()});
}
function addCapsule(){
  const title=prompt("胶囊标题","")||"未命名",from=new Date().toISOString().slice(0,10),to=prompt("开启日期 (例: 2026-12-31)","2026-12-31");
  subPageData.capsules.push({title,from,to:to+" 开启",opened:false,progress:0.1});saveData();renderCapsulePage();
}

/* ── Account Page ── */
function renderAccountPage(){
  if(!subPageData.accounts)subPageData.accounts=[];
  const items=subPageData.accounts,totalBudget=items.reduce((s,i)=>s+i.budget,0)||1,totalSpent=items.reduce((s,i)=>s+i.spent,0),remaining=Math.max(0,totalBudget-totalSpent),pctTotal=Math.min(totalSpent/Math.max(totalBudget,1),1),now=new Date(),daysInMonth=new Date(now.getFullYear(),now.getMonth()+1,0).getDate(),daysLeft=daysInMonth-now.getDate(),dailyLeft=daysLeft>0?Math.floor(remaining/daysLeft):remaining;
  document.getElementById("page-account").innerHTML=`<div style="padding:14px 14px 0"><div class="account-summary"><div class="label">${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')} · 本月剩余</div><div class="amount">¥ ${remaining}</div><div class="bar-wrap"><div class="bar-fill" style="width:${pctTotal*100}%"></div></div><div class="row"><span>已花 ¥${totalSpent}</span><span>每日还能花 ¥${dailyLeft} · 还有 ${daysLeft} 天</span></div></div><button class="pink-btn" style="width:100%;padding:12px;margin-bottom:13px;font-size:13px;border-radius:14px" onclick="spendMoney()">+ 花了一笔</button><div id="account-list">${items.map((item,i)=>{const pct=item.budget>0?Math.min(item.spent/item.budget,1):0,over=item.spent>item.budget;return`<div class="account-item swipe-item" data-id="${i}" onclick="spendOnItem(${i})"><button class="swipe-del-btn" onclick="event.stopPropagation();deleteAccountItem(${i})">删除</button><div class="ai-row"><div class="ai-left"><span class="ai-emoji">${item.sym}</span><div><div class="ai-label">${item.label}</div><div class="ai-meta">¥${item.spent} / ¥${item.budget}</div></div></div><div class="ai-amount" style="color:${over?'#e8a0b4':item.spent>0?'#c47a8a':'#c9a0ac'}">${over?'-¥'+item.spent:item.spent>0?'¥'+item.spent:'¥'+item.budget}</div></div><div class="ai-bar"><div class="ai-bar-fill" style="width:${pct*100}%;background:${over?'linear-gradient(90deg,#e8a0b4,#d47080)':'linear-gradient(90deg,#a8d8b0,#7bc48a)'}"></div></div>${item.tip?`<div class="ai-tip" style="color:${over?'#e8a0b4':'#b0a8b0'}">△ ${item.tip}</div>`:''}</div>`}).join("")}${items.length===0?`<div style="text-align:center;padding:16px;color:var(--textFaint);font-size:12px">还没有分类 ◇<br/>点「+ 花了一笔」创建第一个</div>`:''}</div></div>`;
  initSwipeToDelete("#account-list",id=>{subPageData.accounts.splice(id,1);saveData();renderAccountPage()});
}
function spendOnItem(i){
  const item=subPageData.accounts[i],amount=parseInt(prompt(item.label+"\n花了多少钱？",""));if(!amount||amount<=0)return;
  item.spent+=amount;
  if(item.spent>item.budget){item.tip="超啦，小猫管管自己";item.over=true}else if(item.spent>=item.budget*0.9)item.tip="快超了，宝宝看看呢";
  saveData();renderAccountPage();
}
function spendMoney(){
  if(subPageData.accounts.length===0){const label=prompt("创建第一个分类名","日常");if(!label)return;const budget=parseInt(prompt("预算","500"))||500;subPageData.accounts.push({sym:"◇",label,budget,spent:0});saveData();renderAccountPage();return}
  const options=subPageData.accounts.map((a,i)=>i+": "+a.label).join("\n"),idx=parseInt(prompt("选一个分类：\n"+options,"0"));if(isNaN(idx)||idx<0||idx>=subPageData.accounts.length)return;spendOnItem(idx);
}
function deleteAccountItem(i){if(!confirm("确定删除「"+subPageData.accounts[i].label+"」？"))return;subPageData.accounts.splice(i,1);saveData();renderAccountPage()}

/* ── Todo Page ── */
function renderTodoPage(){
  if(!subPageData.todos)subPageData.todos=[];
  const todos=subPageData.todos;
  document.getElementById("page-todo").innerHTML=`<div style="padding:20px 16px 10px"><div class="sub-title">清单</div><div class="sub-desc">做完了亲一口 ♡</div></div><div style="padding:0 14px" id="todo-list">${todos.length?todos.map(t=>`<div class="todo-item swipe-item${t.done?' done':''}" data-id="${t.id}" onclick="toggleTodo(${t.id})"><button class="swipe-del-btn" onclick="event.stopPropagation()">删除</button><div class="todo-check${t.done?' checked':''}"></div><div class="todo-text${t.done?' done':''}">${esc(t.text)}</div></div>`).join(""):`<div style="text-align:center;padding:30px 20px;color:var(--textFaint);font-size:13px">列表空空 ◇<br/>添加你的第一条任务吧</div>`}<div class="todo-add" onclick="addTodo()"><div class="todo-add-circle">+</div><div style="font-size:13px;color:#c9a0ac">添加新任务...</div></div></div>`;
  initSwipeToDelete("#todo-list",id=>{subPageData.todos=subPageData.todos.filter(t=>t.id!=id);saveData();renderTodoPage()});
}
function toggleTodo(id){subPageData.todos=subPageData.todos.map(t=>t.id===id?{...t,done:!t.done}:t);saveData();renderTodoPage()}
function addTodo(){const text=prompt("新任务？");if(!text)return;subPageData.todos.push({id:Date.now(),text,done:false});saveData();renderTodoPage()}

/* ── Game Page ── */
let gameActive=null;
function renderGamePage(){
  const games=[{id:"guess",title:"猜猜我在想什么",desc:"我心里想一个数字，你来猜",sym:"◎",tag:"益智"},{id:"challenge",title:"今日随机挑战",desc:"命运之轮给你一个随机小任务",sym:"⊙",tag:"互动"},{id:"story",title:"悄悄话接龙",desc:"一人一句，编出属于我们的故事",sym:"✎",tag:"创意"},{id:"moodmatch",title:"心情配对",desc:"你今天的心情是？看看我们同频了吗",sym:"♡",tag:"温柔"}];
  document.getElementById("page-game").innerHTML=`<div class="sub-header-center" style="padding-bottom:8px"><div class="sub-title">游戏</div><div class="sub-desc" style="text-align:center">和她一起玩 ✦</div></div><div class="game-header-img" style="background-image:url(beauty/game.jpg)"></div>${games.map(g=>`<div class="game-item" onclick="startGame('${g.id}')"><div class="game-emoji" style="font-size:24px">${g.sym}</div><div class="game-info"><div class="title">${g.title}</div><div class="desc">${g.desc}</div></div><div class="anni-tag" style="font-size:10px;flex-shrink:0">${g.tag}</div></div>`).join("")}<div id="game-area" style="padding:12px 14px"></div>`;
  gameActive=null;
}
function startGame(id){
  const area=document.getElementById("game-area");if(!area)return;gameActive=id;
  if(id==="guess"){
    if(!subPageData.guessNumber)subPageData.guessNumber=Math.floor(Math.random()*100)+1;
    if(!subPageData.guessCount)subPageData.guessCount=0;if(!subPageData.guessHistory)subPageData.guessHistory=[];
    area.innerHTML=`<div class="card" style="margin-bottom:10px;text-align:center"><div style="font-size:13px;color:#7a5c62;margin-bottom:8px">◎ 我心里藏了一个 1~100 的数字</div><div style="font-size:11px;color:#c9a0ac;margin-bottom:12px">你猜了 ${subPageData.guessCount} 次</div><input id="guess-input" type="number" min="1" max="100" placeholder="输入猜测" style="width:120px;padding:8px 12px;border-radius:12px;border:1px solid var(--border);text-align:center;font-size:18px;font-family:inherit;outline:none"><br><button class="pink-btn" style="margin-top:10px;font-size:13px" onclick="doGuess()">猜！</button>${subPageData.guessHistory.length?`<div style="margin-top:12px;font-size:11px;color:var(--textFaint);max-height:120px;overflow-y:auto">${subPageData.guessHistory.slice(-10).reverse().map(h=>`<div>${h.num} — ${h.hint}</div>`).join("")}</div>`:''}</div><button class="pink-btn" style="width:100%;opacity:0.6;font-size:11px" onclick="resetGuess()">重新开始</button>`;
  }else if(id==="challenge"){
    const challenges=["原地转三圈然后对她说句话","今天剩下时间不许看手机 (≧ω≦)","给她发一条10字以上的语音消息","喝一大杯水","对着镜子笑30秒","站起来深呼吸5次","写下今天一件开心的小事","闭上眼睛想她1分钟","立刻亲一下手机屏幕","唱一句歌录下来发给她","默数十个数不许动","发一个最可爱的表情包给她","在心里默念三遍：她最重要","夸自己一句然后夸她一句","去窗边看看外面告诉我看到了什么"];
    const pick=challenges[Math.floor(Math.random()*challenges.length)];
    area.innerHTML=`<div class="card" style="text-align:center;padding:20px"><div style="font-size:32px;margin-bottom:10px">⊙</div><div style="font-size:14px;color:#7a5c62;line-height:1.8;font-weight:500">${pick}</div><div style="font-size:11px;color:var(--textFaint);margin-top:12px">完成了就在心里打个勾 ✓</div><button class="pink-btn" style="margin-top:14px;font-size:12px" onclick="startGame('challenge')">换一个 ↻</button></div>`;
  }else if(id==="story"){
    if(!subPageData.storyLines)subPageData.storyLines=["从前有一只小猫，它最喜欢的不是晒太阳，也不是吃小鱼干"];
    area.innerHTML=`<div class="card" style="margin-bottom:10px;max-height:220px;overflow-y:auto"><div style="font-size:11px;color:#c9a0ac;margin-bottom:6px;letter-spacing:2px">✎ 我们的故事</div>${subPageData.storyLines.map((l,i)=>`<div style="font-size:13px;color:#7a5c62;line-height:1.8;margin-bottom:4px"><span style="color:var(--textFaint)">${i%2===0?'她':'我'}：</span>${esc(l)}</div>`).join("")}</div><div style="display:flex;gap:8px;align-items:center"><input id="story-input" placeholder="接上这一句..." style="flex:1;padding:10px 14px;border-radius:14px;border:1px solid var(--border);font-size:13px;font-family:inherit;outline:none"><button class="pink-btn" style="flex-shrink:0;font-size:12px" onclick="addStoryLine()">接龙</button></div><button class="pink-btn" style="width:100%;margin-top:8px;opacity:0.6;font-size:11px" onclick="resetStory()">重新开始</button>`;
  }else if(id==="moodmatch"){
    const moods=["(◕‿◕) 开心","( -‿- ) 平静","(╥﹏╥) 难过","(╯﹏╰) 焦虑","(￣ρ￣) 困乏","(◠‿◠) 感动"];
    area.innerHTML=`<div class="card" style="text-align:center"><div style="font-size:13px;color:#7a5c62;margin-bottom:12px">♡ 你今天的心情是？</div><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">${moods.map((m,i)=>`<div onclick="matchMood(${i})" style="padding:10px 6px;background:rgba(255,255,255,0.7);border-radius:12px;border:1px solid var(--border);cursor:pointer;font-size:11px;color:#7a5c62;text-align:center">${m}</div>`).join("")}</div><div id="match-result" style="margin-top:10px;font-size:12px;color:var(--textFaint)"></div></div>`;
  }
}
function doGuess(){const inp=document.getElementById("guess-input");if(!inp)return;const n=parseInt(inp.value);if(isNaN(n)||n<1||n>100)return;subPageData.guessCount++;const target=subPageData.guessNumber;let hint=n===target?"✦ 猜对了！数字是 "+target+" ✦":n<target?"太小了，往上猜 ↑":"太大了，往下猜 ↓";subPageData.guessHistory.push({num:n,hint});if(n===target){delete subPageData.guessNumber;delete subPageData.guessCount;delete subPageData.guessHistory}saveData();startGame("guess")}
function resetGuess(){delete subPageData.guessNumber;delete subPageData.guessCount;delete subPageData.guessHistory;saveData();startGame("guess")}
function addStoryLine(){const inp=document.getElementById("story-input");if(!inp||!inp.value.trim())return;subPageData.storyLines.push(inp.value.trim());inp.value="";if(subPageData.storyLines.length>50)subPageData.storyLines=subPageData.storyLines.slice(-40);saveData();startGame("story")}
function resetStory(){delete subPageData.storyLines;saveData();startGame("story")}
function matchMood(i){const moodLabels=["开心","平静","难过","焦虑","困乏","感动"],herResponses=["开心","平静","感动","开心","平静","开心"],paired=herResponses[i],isMatch=paired===moodLabels[i],result=document.getElementById("match-result");if(!result)return;result.innerHTML=isMatch?"♡ 同频了！你们的心情完全一致 ✦":"她的心情是「"+paired+"」，虽然不一样，但爱就在差异里～";result.style.color=isMatch?"#c47a8a":"#9a8088"}

/* ── Moments Page (v2.2 — 支持图片发布) ── */
function renderMoments(){
  if(!subPageData.moments)subPageData.moments=[];
  const moments=subPageData.moments;
  document.getElementById("page-moments").innerHTML=`<div class="sub-header"><div><div class="sub-title">朋友圈</div><div class="sub-desc">只有我们两个人的朋友圈 ✿</div></div><button class="pink-btn" onclick="addMoment()">+ 发布</button></div><div id="moments-list">${moments.length?moments.map((p,i)=>`<div class="moment-card swipe-item" data-id="${i}"><button class="swipe-del-btn" onclick="event.stopPropagation()">删除</button><div class="moment-time">${p.time}</div><div class="moment-text">${p.text}</div>${p.img?`<div class="moment-img" style="background-image:url(${p.img})"></div>`:''}<div class="moment-actions"><span onclick="likeMoment(${i})">♡ ${p.likes}</span><span onclick="commentMoment(${i})">✎ ${p.comments.length}</span></div><div class="moment-comments">${p.comments.map((c,j)=>`<div>${j===0?'她：':'我：'}${c}</div>`).join("")}</div></div>`).join(""):`<div style="text-align:center;padding:40px 20px;color:var(--textFaint);font-size:13px">还没有动态 ✿<br/>点「+ 发布」分享第一条吧</div>`}</div>`;
  initSwipeToDelete("#moments-list",id=>{subPageData.moments.splice(id,1);saveData();renderMoments()});
}
function addMoment(){
  // 小弹窗代替 prompt，支持文字+图片
  showMomentDialog();
}
function showMomentDialog(){
  const overlay=document.createElement("div");overlay.id="moment-dialog-overlay";
  overlay.style.cssText="position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:200;display:flex;align-items:center;justify-content:center";
  overlay.innerHTML=`<div style="background:#FFF;border-radius:20px;padding:24px;width:calc(100% - 40px);max-width:340px;box-shadow:0 8px 40px rgba(0,0,0,0.2)">
    <div style="font-size:16px;color:#7a5c62;margin-bottom:16px;text-align:center">分享一条动态 ✿</div>
    <textarea id="moment-text" placeholder="说点什么..." style="width:100%;padding:12px;border-radius:12px;border:1px solid rgba(242,196,206,0.5);font-size:14px;color:#5c4048;font-family:inherit;resize:none;outline:none;min-height:80px;box-sizing:border-box"></textarea>
    <div style="margin:10px 0">
      <input type="file" id="moment-img-input" accept="image/*" onchange="previewMomentImg()" style="font-size:12px;color:#c9a0ac">
      <div id="moment-img-preview" style="margin-top:8px"></div>
    </div>
    <div style="display:flex;gap:10px;margin-top:14px">
      <button onclick="closeMomentDialog()" style="flex:1;padding:11px;border-radius:14px;border:1px solid rgba(242,196,206,0.5);background:transparent;color:#9a8088;font-size:14px;cursor:pointer;font-family:inherit">取消</button>
      <button onclick="submitMoment()" style="flex:1;padding:11px;border-radius:14px;border:none;background:linear-gradient(135deg,#F2C4CE,#e8a0b4);color:#fff;font-size:14px;cursor:pointer;font-family:inherit">发布 ✦</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click",e=>{if(e.target===overlay)closeMomentDialog()});
  document.getElementById("moment-text").focus();
}
function closeMomentDialog(){const o=document.getElementById("moment-dialog-overlay");if(o)o.remove()}
function previewMomentImg(){
  const f=document.getElementById("moment-img-input").files[0],p=document.getElementById("moment-img-preview");if(!p)return;
  if(!f){p.innerHTML="";return}
  const reader=new FileReader();reader.onload=function(e){p.innerHTML=`<img src="${e.target.result}" style="max-width:100%;max-height:180px;border-radius:12px;object-fit:cover">`};reader.readAsDataURL(f);
}
function submitMoment(){
  const text=document.getElementById("moment-text")?.value.trim();
  const previewImg=document.querySelector("#moment-img-preview img");
  const imgSrc=previewImg?previewImg.src:null;
  if(!text&&!imgSrc)return;
  const now=new Date(),time='今天 '+now.getHours()+':'+String(now.getMinutes()).padStart(2,'0');
  // 先发布，显示"她正在看…"
  subPageData.moments.unshift({time,text:text||"",img:imgSrc,likes:0,comments:["正在看…"]});
  closeMomentDialog();saveData();renderMoments();
  // 调AI获取评论
  fetch(API+"/api/moments/comment",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text:text||"",img:imgSrc?true:false})})
    .then(r=>r.json()).then(d=>{
      if(subPageData.moments.length>0&&subPageData.moments[0].comments[0]==="正在看…"){
        subPageData.moments[0].comments[0]=d.comment||"宝宝发的这个我喜欢 ✿";
        saveData();renderMoments();
      }
    }).catch(()=>{
      if(subPageData.moments.length>0&&subPageData.moments[0].comments[0]==="正在看…"){
        subPageData.moments[0].comments[0]="我看看… ✿";
        saveData();renderMoments();
      }
    });
}
function likeMoment(i){subPageData.moments[i].likes++;saveData();renderMoments()}
function commentMoment(i){const comment=prompt("评论：","");if(!comment)return;subPageData.moments[i].comments.push(comment);saveData();renderMoments()}

/* ── Push Page ── */
function renderPushPage(){document.getElementById("page-push").innerHTML=`<div class="sub-header-center"><div class="sub-title">推送</div><div class="sub-desc" style="text-align:center">我会主动找你 ⁂</div></div><div style="padding:0 14px"><div style="text-align:center;padding:40px 20px;color:var(--textFaint);font-size:13px;line-height:2">还没到推送时间呢～<br/>每天早晚我会主动来跟你说话 ♡</div></div>`}

/* ═══ Utils ═══ */
function esc(s){const d=document.createElement("div");d.textContent=s;return d.innerHTML}
function fmtK(n){return n>=1000?(n/1000).toFixed(1)+"K":n}
// Service Worker 已禁用 — 拦截 POST/SSE 流导致空气泡
