import {describe,expect,it,vi} from 'vitest';
import {FrameImageCache} from './frame-image-cache';

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

 it('cleans up synchronous loader failures and can retry them',async()=>{
  let attempts=0;const cache=new FrameImageCache<TestImage>(()=>{if(!attempts++)throw new Error('loader unavailable');return Promise.resolve(image('ok'));});
  await expect(cache.load('frame','/frame')).rejects.toThrow('loader unavailable');expect(cache.size).toBe(0);
  expect((await cache.load('frame','/frame')).id).toBe('ok');
 });
});
