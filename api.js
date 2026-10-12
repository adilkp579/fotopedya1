/* Fotopediya backend client. Load after Supabase JS v2 and before app code.
   It does not change the existing DOM, CSS, routes, or components. */
(() => {
  const cfg = window.FOTOPEDIYA_CONFIG || {};
  const API_BASE = (cfg.apiBaseUrl || 'http://localhost:4000').replace(/\/$/,'');
  const supabase = window.supabase?.createClient && cfg.supabaseUrl && cfg.supabaseAnonKey
    ? window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey,{auth:{persistSession:true,autoRefreshToken:true}})
    : null;
  async function accessToken(){
    if(!supabase) throw new Error('Supabase is not configured. Set FOTOPEDIYA_CONFIG first.');
    const {data,error}=await supabase.auth.getSession();
    if(error) throw error;
    if(!data.session?.access_token) throw new Error('Please sign in again.');
    return data.session.access_token;
  }
  async function request(path, options={}) {
    const token=await accessToken();
    const response=await fetch(`${API_BASE}${path}`,{
      ...options,headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`,...(options.headers||{})}
    });
    const body=await response.json().catch(()=>({}));
    if(!response.ok) { const e=new Error(body.error||`Request failed (${response.status})`); e.code=body.code; e.status=response.status; throw e; }
    return body;
  }
  async function register({email,password,fullName,role,businessName}) {
    const r=await fetch(`${API_BASE}/api/auth/register`,{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({email,password,fullName,role,businessName})});
    const data=await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(data.error||'Registration failed');
    // Signup confirmation is handled by Supabase email settings. User signs in after confirmation.
    return data;
  }
  async function login(email,password) {
    if(!supabase) throw new Error('Supabase is not configured.');
    const {data,error}=await supabase.auth.signInWithPassword({email,password});
    if(error) throw error;
    return request('/api/auth/me');
  }
  async function uploadFile({eventId=null,file,onProgress=()=>{}}) {
    if(!(file instanceof File)) throw new Error('Select a file first.');
    // Validate locally for fast feedback; server + database are authoritative.
    const isVideo=file.type.startsWith('video/');
    const max=(isVideo?2048:50)*1024*1024;
    if(!['image/jpeg','image/png','image/webp','image/heic','video/mp4','video/quicktime','video/webm'].includes(file.type))
      throw new Error('Unsupported file type.');
    if(file.size<=0||file.size>max) throw new Error(`File exceeds the ${isVideo?'2048 MB':'50 MB'} per-file limit.`);
    const reservation=await request('/api/uploads/presign',{method:'POST',body:JSON.stringify({
      ...(eventId?{eventId}:{}),fileName:file.name,mimeType:file.type,size:file.size
    })});
    // Multipart form POST sends bytes directly from browser to S3, not through Express.
    // The signed policy enforces exact content length and MIME type at S3.
    const form=new FormData();
    for(const [key,value] of Object.entries(reservation.fields)) form.append(key,value);
    form.append('file',file);
    const uploadResponse=await fetch(reservation.uploadUrl,{method:'POST',body:form});
    if(!uploadResponse.ok) throw new Error('S3 upload failed. The reserved quota remains held until cleanup.');
    onProgress(85);
    await request(`/api/uploads/${reservation.fileId}/complete`,{method:'POST',body:'{}'});
    onProgress(100);
    return {id:reservation.fileId,type:isVideo?'video':'photo',fileName:file.name,size:file.size};
  }
  async function getGallery(eventId,{cursor=null,limit=20}={}) {
    const params=new URLSearchParams({limit:String(Math.min(50,Math.max(1,limit)))});
    if(cursor) params.set('cursor',cursor);
    return request(`/api/gallery/${encodeURIComponent(eventId)}?${params}`);
  }
  async function getFileUrl(fileId,{download=false}={}) {
    return request(`/api/uploads/${encodeURIComponent(fileId)}/url${download?'?download=1':''}`);
  }
  window.FotopediyaAPI={supabase,request,register,login,uploadFile,getGallery,getFileUrl,
    getQuota:()=>request('/api/uploads/quota')};
})();
