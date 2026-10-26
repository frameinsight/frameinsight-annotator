type DecodedImage={naturalWidth:number;naturalHeight:number};
type Entry<T>={promise:Promise<T>;image?:T;bytes:number};
type Limits={maxBytes?:number;maxEntries?:number};

/** Bounds retained decoded pixels; callers may still hold their displayed image. */
export class FrameImageCache<T extends DecodedImage>{
 private readonly entries=new Map<string,Entry<T>>();
 private readonly pending=new Map<string,Entry<T>>();
 private retainedBytes=0;
 private readonly maxBytes:number;
 private readonly maxEntries:number;

 constructor(private readonly loadImage:(url:string)=>Promise<T>,{maxBytes=32*1024*1024,maxEntries=8}:Limits={}){
  this.maxBytes=Math.max(0,maxBytes);
  this.maxEntries=Math.max(0,Math.floor(maxEntries));
 }

 get size(){return this.entries.size;}
 get decodedBytes(){return this.retainedBytes;}

 peek(key:string):T|undefined{
  const entry=this.entries.get(key);
  if(!entry?.image)return;
  this.entries.delete(key);this.entries.set(key,entry);
  return entry.image;
 }

 load(key:string,url:string):Promise<T>{
  const existing=this.entries.get(key)||this.pending.get(key);
  if(existing){
   this.entries.delete(key);this.entries.set(key,existing);this.trim();
   return existing.promise;
  }
  const entry:Entry<T>={bytes:0,promise:undefined!};
  // Register before invoking the loader, including when it throws synchronously.
  entry.promise=Promise.resolve().then(()=>this.loadImage(url)).then(image=>{
   this.pending.delete(key);
   if(this.entries.get(key)===entry){
    const bytes=image.naturalWidth*image.naturalHeight*4;
    if(Number.isFinite(bytes)&&bytes>0&&bytes<=this.maxBytes){
     entry.image=image;entry.bytes=bytes;this.retainedBytes+=bytes;this.trim();
    }else this.remove(key);
   }
   return image;
  },error=>{
   this.pending.delete(key);
   if(this.entries.get(key)===entry)this.remove(key);
   throw error;
  });
  this.pending.set(key,entry);this.entries.set(key,entry);this.trim();
  return entry.promise;
 }

 private remove(key:string){
  const entry=this.entries.get(key);
  if(entry){this.retainedBytes-=entry.bytes;this.entries.delete(key);}
 }

 private trim(){
  while(this.entries.size>this.maxEntries||this.retainedBytes>this.maxBytes)this.remove(this.entries.keys().next().value!);
 }
}

export const frameImageCache=new FrameImageCache<HTMLImageElement>(url=>new Promise((resolve,reject)=>{
 const image=new Image();
 image.decoding='async';
 const clear=()=>{image.onload=null;image.onerror=null;};
 image.onload=()=>{clear();resolve(image);};
 image.onerror=()=>{clear();reject(new Error('Exact frame unavailable. Retry this frame.'));};
 image.src=url;
}));
