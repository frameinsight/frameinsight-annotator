import {afterEach,describe,expect,it,vi} from 'vitest';
import {FrameImageCache,loadDecodedImage} from './frame-image-cache';

type TestImage={naturalWidth:number;naturalHeight:number;id:string};
const image=(id:string,width=10,height=10):TestImage=>({id,naturalWidth:width,naturalHeight:height});
function deferred<T>(){
 let resolve!:(value:T)=>void,reject!:(reason:unknown)=>void;
 const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});
 return {promise,resolve,reject};
}

describe('decoded frame image cache',()=>{
 it('enforces the decoded pixel budget and keeps recently accessed frames',async()=>{
  const cache=new FrameImageCache(async url=>image(url),{maxBytes:800,maxEntries:8});
  await cache.load('a','/a');await cache.load('b','/b');
  expect(cache.decodedBytes).toBe(800);
  expect(cache.peek('a')?.id).toBe('/a');
  await cache.load('c','/c');
  expect(cache.peek('a')?.id).toBe('/a');expect(cache.peek('b')).toBeUndefined();expect(cache.peek('c')?.id).toBe('/c');
  expect(cache.size).toBe(2);expect(cache.decodedBytes).toBe(800);
 });

 it('also caps tiny frames by entry count and load hits update recency',async()=>{
  const load=vi.fn(async url=>image(url,1,1));
  const cache=new FrameImageCache(load,{maxBytes:32*1024*1024,maxEntries:2});
  await cache.load('a','/a');await cache.load('b','/b');await cache.load('a','/a');await cache.load('c','/c');
  expect(load).toHaveBeenCalledTimes(3);expect(cache.size).toBe(2);expect(cache.decodedBytes).toBe(8);
  expect(cache.peek('b')).toBeUndefined();expect(cache.peek('a')?.id).toBe('/a');
 });

 it('deduplicates simultaneous display and prefetch requests',async()=>{
  const pending=deferred<TestImage>();const load=vi.fn(()=>pending.promise);
  const cache=new FrameImageCache(load);
  const first=cache.load('frame','/frame'),second=cache.load('frame','/frame');
  expect(first).toBe(second);await Promise.resolve();expect(load).toHaveBeenCalledTimes(1);
  const decoded=image('frame');pending.resolve(decoded);
  expect(await first).toBe(decoded);expect(await second).toBe(decoded);
  expect(cache.peek('frame')).toBe(decoded);expect(cache.decodedBytes).toBe(400);
 });

 it('does not let late callbacks repopulate evicted entries',async()=>{
  const pending=Array.from({length:12},()=>deferred<TestImage>());
  const cache=new FrameImageCache(url=>pending[Number(url)].promise,{maxEntries:2,maxBytes:800});
  const requests=pending.map((_,index)=>cache.load(String(index),String(index)));
  expect(cache.size).toBe(2);
  // The retained newest frames finish first; older abandoned loads arrive later.
  pending[10].resolve(image('10'));pending[11].resolve(image('11'));await Promise.all(requests.slice(10));
  for(let i=0;i<10;i++){pending[i].resolve(image(String(i)));await requests[i];}
  expect(cache.size).toBe(2);expect(cache.decodedBytes).toBe(800);
  expect(cache.peek('0')).toBeUndefined();expect(cache.peek('10')?.id).toBe('10');expect(cache.peek('11')?.id).toBe('11');
 });

 it('shares an evicted but still pending request when that frame is needed again',async()=>{
  const pending=deferred<TestImage>();const load=vi.fn((url:string)=>url==='/a'?pending.promise:Promise.resolve(image(url)));
  const cache=new FrameImageCache(load,{maxEntries:1});
  const original=cache.load('a','/a');await cache.load('b','/b');
  expect(cache.peek('a')).toBeUndefined();
  const reused=cache.load('a','/a');expect(reused).toBe(original);pending.resolve(image('/a'));
  await reused;expect(load).toHaveBeenCalledTimes(2);expect(cache.size).toBe(1);expect(cache.decodedBytes).toBe(400);expect(cache.peek('a')?.id).toBe('/a');
 });

 it('returns an oversized image to its caller without retaining it or evicting useful smaller images',async()=>{
  const cache=new FrameImageCache(async url=>url==='/large'?image(url,100,100):image(url),{maxBytes:800});
  await cache.load('small','/small');const large=await cache.load('large','/large');
  expect(large.naturalWidth).toBe(100);expect(cache.peek('large')).toBeUndefined();expect(cache.peek('small')?.id).toBe('/small');
  expect(cache.size).toBe(1);expect(cache.decodedBytes).toBe(400);
 });

 it('drops failed loads so retry makes a fresh request and can recover',async()=>{
  const pending=deferred<TestImage>();const load=vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce(image('recovered'));
  const cache=new FrameImageCache<TestImage>(load);
  const first=cache.load('frame','/frame'),duplicate=cache.load('frame','/frame');
  const rejected=expect(first).rejects.toThrow('network');pending.reject(new Error('network'));await rejected;
  expect(duplicate).toBe(first);expect(cache.size).toBe(0);expect(cache.decodedBytes).toBe(0);expect(cache.peek('frame')).toBeUndefined();
  expect((await cache.load('frame','/frame')).id).toBe('recovered');expect(load).toHaveBeenCalledTimes(2);expect(cache.peek('frame')?.id).toBe('recovered');
 });

 it('invalidates one video and ignores its old in-flight results without disturbing a fresh request',async()=>{
  const old=deferred<TestImage>(),fresh=deferred<TestImage>();
  const load=vi.fn().mockResolvedValueOnce(image('other')).mockResolvedValueOnce(image('old ready')).mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  const cache=new FrameImageCache<TestImage>(load);
  await cache.load('other:0','/other');await cache.load('video:0','/old-ready');
  const first=cache.load('video:1','/old-pending');await Promise.resolve();
  cache.invalidatePrefix('video:');expect(cache.peek('video:0')).toBeUndefined();expect(cache.peek('other:0')?.id).toBe('other');
  const second=cache.load('video:1','/new-pending');await Promise.resolve();
  old.resolve(image('obsolete'));await first;
  expect(cache.peek('video:1')).toBeUndefined();expect(cache.load('video:1','/new-pending')).toBe(second);
  fresh.resolve(image('fresh'));await second;expect(cache.peek('video:1')?.id).toBe('fresh');expect(load).toHaveBeenCalledTimes(4);
 });

 it('cleans up synchronous loader failures and can retry them',async()=>{
  let attempts=0;const cache=new FrameImageCache<TestImage>(()=>{if(!attempts++)throw new Error('loader unavailable');return Promise.resolve(image('ok'));});
  await expect(cache.load('frame','/frame')).rejects.toThrow('loader unavailable');expect(cache.size).toBe(0);
  expect((await cache.load('frame','/frame')).id).toBe('ok');
 });
});


describe('image decode publication',()=>{
 afterEach(()=>vi.unstubAllGlobals());
 it('keeps a loaded JPEG pending until its pixels finish decoding',async()=>{
  const decoding=deferred<void>();let instance!:FakeImage;
  class FakeImage {
   onload:(()=>void)|null=null;onerror:(()=>void)|null=null;decoding='';src='';
   decode=vi.fn(()=>decoding.promise);
   constructor(){instance=this;}
  }
  vi.stubGlobal('Image',FakeImage);
  let published=false;const result=loadDecodedImage('/frame').then(value=>{published=true;return value;});
  instance.onload!();await Promise.resolve();expect(published).toBe(false);
  expect(instance.decode).toHaveBeenCalledTimes(1);
  decoding.resolve();expect(await result).toBe(instance);expect(published).toBe(true);
 });
 it('rejects undecodable pixels so the frame is never cached as ready',async()=>{
  let instance!:FakeImage;
  class FakeImage {
   onload:(()=>void)|null=null;onerror:(()=>void)|null=null;decoding='';src='';
   decode=vi.fn(()=>Promise.reject(new Error('decode failure')));
   constructor(){instance=this;}
  }
  vi.stubGlobal('Image',FakeImage);
  const cache=new FrameImageCache(loadDecodedImage);
  const result=cache.load('frame','/frame');await Promise.resolve();instance.onload!();
  await expect(result).rejects.toThrow('Exact frame unavailable');
  expect(cache.peek('frame')).toBeUndefined();expect(cache.size).toBe(0);
 });
});
