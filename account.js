import {ProgressSync} from './sync-engine.js';
const byId=id=>document.getElementById(id),app=window.IRON;
let client,user=null,debounce,initialized=false,authSerial=Promise.resolve(),offline=false,recovery=false;
const config=window.IRON_CONFIG||{};
const key=id=>'iron-cloud-v1:'+id;
const load=id=>{try{return JSON.parse(localStorage.getItem(key(id)))}catch{return null}};
const store=(id,value)=>localStorage.setItem(key(id),JSON.stringify(value));
const status=(type,error)=>{
 const labels={loading:'Loading your saved progress…',synced:'All progress saved to your account',pending:'Changes saved on this device · waiting to sync',saving:'Saving progress…',offline:'Saved on this device · sync needs connection',conflict:'Another device has newer progress. Resolve before syncing.'};
 byId('accountStatus').textContent=labels[type]||type;
 if(error)byId('accountDetail').textContent=error.message||'Please retry.';
 if(type==='synced')byId('accountDetail').textContent='';
 offline=type==='offline';
 byId('cloudConflict').hidden=type!=='conflict';
 if(user)byId('status').textContent=type==='synced'?'● SAVED TO YOUR ACCOUNT':type==='conflict'?'● SYNC CONFLICT':'● SAVED ON THIS DEVICE';
};
const engine=new ProgressSync({
 adapter:{
  async read(id){const {data,error}=await client.from('training_progress').select('state,revision').eq('user_id',id).maybeSingle();if(error)throw error;return data;},
  async write(id,state,revision){const {data,error}=await client.rpc('save_training_progress',{p_state:state,p_expected_revision:revision});if(error)throw error;return data;}
 },load,store,onStatus:status,onRemote:state=>app.replace(state),onConflict:()=>{}
});
function message(text){byId('authMessage').textContent=text;}
function accountView(){
 byId('authForm').hidden=!!user;byId('signedIn').hidden=!user;
 byId('signedInEmail').textContent=user?.email||'';
 byId('accountNav').textContent=user?'My account':'Sign in';
 byId('importGuest').hidden=!user||!app.hasGuestProgress();
}
async function changeUser(next){
 if(initialized&&next?.id===user?.id)return;
 initialized=true;
 engine.disconnect();clearTimeout(debounce);user=next;
 byId('appContent').inert=true;
 app.setUser(next?.id||null);accountView();
 if(next){
   await engine.connect(next.id);
   if(!load(next.id)&&!offline){engine.changed(app.snapshot());await engine.flush();}
 }else{byId('accountStatus').textContent='Guest mode · saved only in this browser';byId('accountDetail').textContent='';byId('cloudConflict').hidden=true;}
 byId('appContent').inert=false;
}
function serializeUser(next){authSerial=authSerial.then(()=>changeUser(next)).catch(e=>{byId('appContent').inert=false;message('Could not load the account. '+e.message)});}
window.addEventListener('iron:save',()=>{
 if(!user)return;
 engine.changed(app.snapshot());clearTimeout(debounce);debounce=setTimeout(()=>engine.flush(),800);
});
window.addEventListener('online',()=>engine.flush());
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&user&&!engine.pending&&!engine.conflict)engine.connect(user.id)});
byId('syncNow').onclick=async()=>{if(!user)return;if(engine.pending)await engine.flush();else await engine.connect(user.id)};
byId('useCloud').onclick=async()=>{if(confirm('Load the account’s newer progress? This device’s unsynced version will be kept as a local backup.'))await engine.useRemote()};
byId('exportConflict').onclick=()=>app.export();
byId('importGuest').onclick=async()=>{
 if(!user||!confirm('Copy this browser’s guest log into your signed-in account? Export your account log first if you want to keep both.'))return;
 const guest=app.guestProgress();if(!guest)return;
 app.replace(guest);app.save();await engine.flush();byId('importGuest').hidden=true;
};
byId('signOut').onclick=async()=>{
 if(engine.pending||engine.conflict){message('Save or export unsynced changes before signing out.');if(!confirm('Sign out with unsynced changes? They will remain in this account’s local cache on this device.'))return;}
 const {error}=await client.auth.signOut({scope:'local'});if(error){message(error.message);return;}await changeUser(null);
};
function credentials(){const email=byId('authEmail').value.trim(),password=byId('authPassword').value;if(!byId('authEmail').reportValidity())return null;return {email,password};}
function busy(value){document.querySelectorAll('#authForm button').forEach(b=>b.disabled=value)}
byId('authForm').onsubmit=async e=>{
 e.preventDefault();const c=credentials();if(!c)return;if(!byId('authPassword').reportValidity())return;busy(true);message('Signing in…');
 try{const {data,error}=await client.auth.signInWithPassword(c);if(error)throw error;serializeUser(data.user);message('Signed in.');byId('authPassword').value='';}catch(error){message(error.message)}finally{busy(false)}
};
byId('createAccount').onclick=async()=>{
 const c=credentials();if(!c)return;if(!byId('authPassword').reportValidity())return;busy(true);message('Creating your account…');
 try{const {data,error}=await client.auth.signUp({...c,options:{emailRedirectTo:new URL('./',location.href).href}});if(error)throw error;
  message(data.session?'Account created.':'Check your email to confirm your account, then sign in here.');if(data.session)serializeUser(data.user);byId('authPassword').value='';
 }catch(error){message(error.message)}finally{busy(false)}
};
byId('forgotPassword').onclick=async()=>{
 const c=credentials();if(!c)return;busy(true);
 try{const {error}=await client.auth.resetPasswordForEmail(c.email,{redirectTo:new URL('./',location.href).href});if(error)throw error;message('If the email is registered, a password-reset link will arrive.');}catch(error){message(error.message)}finally{busy(false)}
};
byId('passwordForm').onsubmit=async e=>{
 e.preventDefault();if(!recovery)return;
 const password=byId('newPassword').value;if(!byId('newPassword').reportValidity())return;
 byId('updatePassword').disabled=true;
 try{const {error}=await client.auth.updateUser({password});if(error)throw error;recovery=false;byId('passwordForm').hidden=true;byId('newPassword').value='';message('Password updated.');}catch(error){message(error.message)}finally{byId('updatePassword').disabled=false}
};
async function boot(){
 if(!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(config.supabaseUrl)||!config.supabasePublishableKey){
  message('Account setup is not connected yet. Continue in guest mode; export your log to keep a backup.');
  document.querySelectorAll('#authForm button').forEach(b=>b.disabled=true);byId('appContent').inert=false;return;
 }
 byId('appContent').inert=true;
 try{
  const {createClient}=await Promise.race([import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm'),new Promise((_,reject)=>setTimeout(()=>reject(Error('Connection timed out')),12000))]);
  client=createClient(config.supabaseUrl,config.supabasePublishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  client.auth.onAuthStateChange((event,session)=>{
   if(event==='PASSWORD_RECOVERY'){recovery=true;byId('passwordForm').hidden=false;app.showTab('account');}
   setTimeout(()=>serializeUser(session?.user||null),0);
  });
  const {data,error}=await client.auth.getSession();if(error)throw error;serializeUser(data.session?.user||null);
 }catch(error){byId('appContent').inert=false;document.querySelectorAll('#authForm button').forEach(b=>b.disabled=true);message('Sign-in needs a connection. Continue in guest mode and reload when online.');}
}
boot();
