export async function api<T=any>(path:string,options:RequestInit={}):Promise<T>{
 const headers:Record<string,string>={};if(options.body&&!(options.body instanceof FormData))headers['Content-Type']='application/json';
 const r=await fetch('/api'+path,{...options,headers:{...headers,...options.headers}});
 if(!r.ok){let body;try{body=await r.json()}catch{body={detail:r.statusText}};const e=new Error(typeof body.detail==='string'?body.detail:JSON.stringify(body.detail));(e as any).status=r.status;throw e;}
 return r.json();
}
export const post=<T=any>(path:string,body:any={})=>api<T>(path,{method:'POST',body:JSON.stringify(body)});
