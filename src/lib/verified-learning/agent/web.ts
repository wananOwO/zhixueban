import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { XMLParser } from 'fast-xml-parser';

function publicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a,b]=address.split('.').map(Number);
    return ![0,10,127].includes(a) && a<224 && !(a===169&&b===254) && !(a===172&&b>=16&&b<=31) && !(a===192&&b===168) && !(a===100&&b>=64&&b<=127) && !(a===198&&(b===18||b===19));
  }
  // 公开IPv6全局单播；拒绝IPv4映射、环回、ULA、链路本地和组播。
  return isIP(address)===6 && /^[23]/i.test(address) && !address.toLowerCase().startsWith('2001:db8:');
}
export async function assertPublicUrl(raw: string) {
  const url=new URL(raw);const host=url.hostname.replace(/^\[|\]$/g,'');
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||!['','80','443'].includes(url.port)||host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local'))throw new Error('仅允许公开HTTP(S)资料地址');
  const addresses=isIP(host)?[{address:host,family:isIP(host)}]:await lookup(host,{all:true});
  if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))throw new Error('不允许访问本机、内网或保留地址');
  return {url,address:addresses[0]};
}

/** DNS校验后固定到已检查地址，重定向逐跳重新校验；不携带供应商凭据。 */
export async function fetchPublicText(raw: string, signal?: AbortSignal, redirects=0): Promise<{url:string;contentType:string;text:string}> {
  signal?.throwIfAborted();const {url,address}=await assertPublicUrl(raw);
  return new Promise((resolve,reject)=>{
    const request=(url.protocol==='https:'?https:http).request(url,{
      method:'GET',signal,headers:{'user-agent':'VerifiedLearning/1.0 (public learning sources)','accept':'text/html,application/xhtml+xml,application/xml,text/plain'},
      lookup:(_host,lookupOptions,callback)=>{
        // Node的自动双栈连接会传all:true，必须返回数组，且仍固定到已检查的地址。
        if (lookupOptions.all) (callback as unknown as (error:null,addresses:{address:string;family:number}[])=>void)(null,[address]);
        else callback(null,address.address,address.family);
      },
    },response=>{
      if(response.statusCode && response.statusCode>=300&&response.statusCode<400&&response.headers.location){response.resume();if(redirects>=3){reject(new Error('公开页面重定向过多'));return;}void fetchPublicText(new URL(response.headers.location,url).href,signal,redirects+1).then(resolve,reject);return;}
      if(response.statusCode!==200){response.resume();reject(new Error(`公开资料读取失败：HTTP ${response.statusCode}`));return;}
      const contentType=String(response.headers['content-type']??'');
      if(!/text\/|xml|json/.test(contentType)){response.resume();reject(new Error('资料不是可读取的文本页面'));return;}
      const chunks:Buffer[]=[];let size=0;
      response.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>4*1024*1024){request.destroy(new Error('单个网页响应过大，请选择更具体的公开页面'));return;}chunks.push(chunk);});
      response.on('end',()=>resolve({url:url.href,contentType,text:Buffer.concat(chunks).toString('utf8')}));response.on('error',reject);
    });
    request.setTimeout(30000,()=>request.destroy(new Error('公开资料读取超时，请换一个来源')));
    request.on('error',reject);request.end();
  });
}
function decode(text:string):string {return text.replace(/&(?:amp|lt|gt|quot|apos|nbsp);|&#(?:x[\da-f]+|\d+);/gi,s=>{const named:Record<string,string>={'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&nbsp;':' '};if(named[s])return named[s];const code=s.startsWith('&#x')?parseInt(s.slice(3),16):parseInt(s.slice(2),10);return code>0&&code<=0x10ffff?String.fromCodePoint(code):' ';});}
export function extractPage(text:string,html:boolean) {
  if(!html)return text.trim();
  // 这里只提取纯文本供工具读取，不把远程HTML注入页面或执行。
  return decode(text.replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<\/(?:p|div|h[1-6]|li|pre|section)>|<br\s*\/?\s*>/gi,'\n').replace(/<[^>]*>/g,' ')).split('\n').map(l=>l.replace(/[ \t]+/g,' ').trim()).filter(Boolean).join('\n');
}
export async function searchPublicWeb(query:string,signal?:AbortSignal) {
  const page=await fetchPublicText('https://www.bing.com/search?format=rss&q='+encodeURIComponent(query),signal);
  const parsed=new XMLParser({ignoreAttributes:true}).parse(page.text);
  const items=parsed?.rss?.channel?.item;return (Array.isArray(items)?items:items?[items]:[]).slice(0,8).map((item:{title?:string;link?:string;description?:string})=>({title:item.title,url:item.link,snippet:extractPage(item.description??'',true)}));
}
