// 本机浏览器回归：模拟业务接口，不修改真实教材/草稿/密钥，不调用模型。
// 通过 PLAYWRIGHT_MODULE 与 CHROMIUM_PATH 指向本机已有安装。
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const base = 'http://127.0.0.1:3101';
const initialInput = {title:'测试课程',textbookId:null,sources:[],goal:'学习变量',teachingPrompt:'用例子讲解',priorKnowledgeText:'',includedTopics:[],excludedTopics:[],allowSupplementalSources:true,assessment:{pointQuestionCount:3,chapterQuestionCount:10,finalQuestionCount:10,difficulty:'easy',progressionPolicy:'completed'},mode:'practice',subjectType:'general',programmingLanguage:null,templateId:null};
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 try {
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  let draft={draftId:'test-draft',revision:0,input:structuredClone(initialInput),state:'editing',generationJobId:null,review:null,confirmed:null};
  let saves=0,generates=0,failSave=false,failModels=false,failGeneration=false;const keys=[];
  const book={bookId:'book',title:'测试教材',status:'ready',format:'md',archived:false,revision:0,sourceRevision:'r1',chapters:[{id:'chapter',title:'第一章',characterCount:20}]};
  await page.route('**/api/verified-learning/v1/**',async route=>{
   const req=route.request(),url=new URL(req.url()),p=url.pathname.split('/v1')[1],method=req.method();const body=method==='GET'?null:req.postDataJSON();
   const ok=data=>route.fulfill({json:{contractVersion:1,requestId:'browser-test',data}});
   if(p==='/access')return ok({authenticated:true});
   if(p==='/textbooks')return ok([book]);
   if(p==='/textbooks/book/source')return ok({sourceId:'book',sourceRevision:'r1',title:'测试教材',chapters:[{chapterId:'chapter',title:'第一章',paragraphs:[{paragraphIndex:0,text:'变量保存数据'}]}]});
   if(p==='/templates')return ok({builtins:['general','computer','math'].map(subject=>({templateId:'builtin:'+subject,name:subject,subjectType:subject,content:'模板正文'})),custom:[]});
   if(p==='/drafts')return ok([draft]);
   if(p==='/drafts/test-draft'&&method==='GET')return ok(draft);
   if(p==='/drafts/test-draft'&&method==='PATCH'){
    saves++;keys.push(req.headers()['idempotency-key']);await new Promise(r=>setTimeout(r,600));
    if(failSave)return route.fulfill({status:503,json:{error:{code:'NETWORK',message:'模拟保存失败'}}});
    assert.equal(body.expectedRevision,draft.revision);draft={...draft,state:'editing',input:{...draft.input,...body.input},revision:draft.revision+1};return ok(draft);
   }
   if(p==='/drafts/test-draft/generate'){
    generates++;assert.equal(body.expectedRevision,draft.revision);assert.equal(draft.input.programmingLanguage,'python');assert.equal(draft.input.templateId,'builtin:computer');assert.equal(draft.input.sources[0].chapterIds[0],'chapter');
    draft={...draft,state:'generating',generationJobId:'job'};return ok({jobId:'job'});
   }
   if(p==='/jobs/job/events')return ok([{cursor:1,message:'Agent：读取原文'},{cursor:2,message:'校验发现问题，Agent正在自动修正'}]);
   if(p==='/jobs/job'){
    if(failGeneration)return ok({jobId:'job',kind:'curriculum',status:'failed',attempts:1,stage:'failed',error:{message:'模拟生成失败'}});
    draft={...draft,state:'review',review:{proposal:{points:[{id:'point',title:'变量',prerequisiteIds:[],relatedIds:[],citations:[]}],targetIds:['point'],declaredIds:[]},choices:{targetIds:['point'],excludedIds:[],declaredIds:[],order:null,prerequisiteEdits:[],supplementalSourceIds:[]},report:{issues:[],includedIds:['point'],input:draft.input},stale:false}};
    return ok({jobId:'job',kind:'curriculum',status:'waiting_user',attempts:1,stage:'review',error:null});
   }
   if(p==='/drafts/test-draft/confirm')return ok({courseId:'course',versionId:'version',sessionId:'session'});
   if(p==='/sessions/session')return ok({session:{sessionId:'session',revision:0,mode:'practice',completedActivityIds:[]},version:{courseId:'course',courseVersionId:'version',goal:'测试课程',outline:[]},next:{kind:'done'},currentRun:null,cursor:null});
   if(p==='/courses')return ok([]);
   if(p==='/jobs')return ok([]);
   if(p==='/settings/models'&&failModels)return route.fulfill({status:502,json:{error:{code:'PROVIDER_ERROR',message:'供应商鉴权失败，请核对 API 密钥'}}});
   if(p==='/settings/models')return ok({models:[{id:'model-a',name:'测试模型 A'},{id:'model-b',name:'测试模型 B'}],truncated:false});
   if(p==='/settings')return ok({llm_provider:'openai-compatible',llm_base_url:'https://example.test/v1',llm_api_key_configured:true,llm_model:body?.llm_model||'model-a'});
   return route.fulfill({status:404,json:{error:{message:'未模拟接口 '+p}}});
  });
  await page.goto(base+'/verified-learning/drafts/test-draft');
  await page.locator('#draft-title').waitFor();
  assert.equal(await page.locator('#draft-subject').count(),0);
  await page.getByLabel('教学方案',{exact:true}).selectOption('builtin:computer');
  assert.equal(await page.locator('#draft-language').inputValue(),'python');
  await page.getByLabel('选择要添加的教材').selectOption('book');
  await page.getByRole('button',{name:'全选章节'}).click();
  const generate=page.getByRole('button',{name:'生成课程方案',exact:true});await generate.waitFor();assert(await generate.isEnabled());
  await page.waitForTimeout(850);await page.locator('#draft-title').fill('保存期间修改');
  await generate.click();await page.getByRole('button',{name:'确认并创建课程'}).waitFor({timeout:12000});
  assert.equal(generates,1);assert.equal(draft.input.title,'保存期间修改');assert.equal(draft.input.teachingPrompt,'用例子讲解');
  await page.getByLabel('我已核对来源覆盖与先修关系').check();await page.getByRole('button',{name:'确认并创建课程'}).click();await page.waitForURL('**/learn/session');
  console.log('通过：教材直接加入、单选教学方案、保存期间生成、等待审核、确认进入学习');
  draft={draftId:'test-draft',revision:0,input:structuredClone(initialInput),state:'editing',review:null};failSave=true;saves=0;keys.length=0;
  await page.goto(base+'/verified-learning/drafts/test-draft');await page.locator('#draft-title').fill('断网保留');await page.getByText('模拟保存失败',{exact:true}).waitFor();await page.waitForTimeout(1800);assert.equal(saves,1);assert.equal(await page.locator('#draft-title').inputValue(),'断网保留');failSave=false;await page.getByRole('button',{name:'重试',exact:true}).click();await page.getByText('已保存',{exact:true}).waitFor();assert.equal(keys[0],keys[1]);
  console.log('通过：保存失败停止请求，重试复用幂等键，文字保留');
  draft={...draft,state:'generating',generationJobId:'job'};failGeneration=true;
  await page.reload();await page.getByRole('button',{name:'返回编辑并重新生成'}).click();await page.locator('#draft-title').waitFor();assert.equal(await page.locator('#draft-title').inputValue(),'断网保留');failGeneration=false;
  console.log('通过：生成失败可回到编辑，已有内容保留');
  await page.goto(base+'/');await page.locator('nav[aria-label="主导航"]').waitFor();assert.equal(await page.locator('nav[aria-label="主导航"]').count(),1);const links=await page.locator('nav[aria-label="主导航"] a').evaluateAll(nodes=>nodes.map(n=>new URL(n.href).pathname));assert.equal(links.length,5);
  await page.getByRole('link',{name:'设置',exact:true}).click();failModels=true;await page.getByRole('button',{name:'拉取模型列表'}).click();await page.getByText('供应商鉴权失败，请核对 API 密钥',{exact:true}).waitFor();assert(await page.getByLabel('模型名称（可手动填写）',{exact:true}).isEnabled());failModels=false;await page.getByRole('button',{name:'拉取模型列表'}).click();await page.getByLabel('选择模型',{exact:true}).selectOption('model-b');assert.equal(await page.getByLabel('模型名称（可手动填写）',{exact:true}).inputValue(),'model-b');await page.getByRole('button',{name:'保存供应商配置'}).click();await page.getByText('已保存，后续模型请求立即使用新配置。').waitFor();
  await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.equal(errors.length,0,JSON.stringify(errors));
  console.log('通过：五项统一导航、模型失败可恢复、拉取选择保存、390px无溢出、无页面异常');
  await page.setViewportSize({width:1280,height:900});await page.goto(base+'/');await page.getByRole('heading',{name:'开始今天的学习'}).waitFor();await page.screenshot({path:process.env.TEMP+'/vl-unified-home.png',fullPage:true});
 } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1});
