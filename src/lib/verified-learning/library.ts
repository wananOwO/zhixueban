import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseTextbook } from '../textbook/parse';
import type { ChapterTree } from '../textbook/types';
import { LearningError } from './contracts';
import { AppError } from './errors';
import { JobStore } from './jobs';
import { contentHash, createSourceSnapshot, type SourceSnapshot } from './sources';

interface BookRow { book_id: string; origin: 'owned'|'legacy'; legacy_id: string|null; file_relpath: string|null;
  status: string; archived_at: string|null; revision: number; created_at: string }
export interface BookView { bookId: string; title: string; format: string; status: string; archived: boolean;
  revision: number; sourceRevision: string|null; createdAt: string; chapters: { id: string; title: string; characterCount: number }[] }
const extensions = new Set(['.txt','.md','.markdown','.epub','.pdf','.docx','.mobi','.azw3']);
function required(value: string) { if (typeof value !== 'string' || !value.trim()) throw new LearningError('INVALID_INPUT','标识不能为空'); }
/** 上传限制：本地模式 50MiB 不限本数；线上模式由路由传入更严的上限 */
export interface UploadLimits { maxBytes: number; maxBooks: number | null }
const DEFAULT_LIMITS: UploadLimits = { maxBytes: 50 * 1024 * 1024, maxBooks: null };
export class LibraryService {
  constructor(private readonly db: Database.Database, private readonly root: string, private readonly limits: UploadLimits = DEFAULT_LIMITS) {}
  private row(scope: string, id: string): BookRow {
    required(scope); required(id);
    const row = this.db.prepare('SELECT * FROM vl_books WHERE scope_id=? AND book_id=?').get(scope,id) as BookRow|undefined;
    if (!row) throw new LearningError('NOT_FOUND','教材不存在');
    return row;
  }
  source(scope: string,id: string,revision?: string): SourceSnapshot {
    this.row(scope,id);
    const row = this.db.prepare(`SELECT snapshot_json FROM vl_source_revisions WHERE scope_id=? AND book_id=?
      AND revoked_at IS NULL ${revision ? 'AND source_revision=?' : ''} ORDER BY created_at DESC,source_revision DESC LIMIT 1`)
      .get(...(revision ? [scope,id,revision] : [scope,id])) as {snapshot_json:string}|undefined;
    if (!row) throw new LearningError('NOT_FOUND','教材来源版本不可用');
    return JSON.parse(row.snapshot_json);
  }
  get(scope: string,id: string): BookView {
    const row = this.row(scope,id);
    const saved = this.db.prepare('SELECT snapshot_json FROM vl_source_revisions WHERE scope_id=? AND book_id=? ORDER BY created_at DESC LIMIT 1')
      .get(scope,id) as {snapshot_json:string}|undefined;
    const source: SourceSnapshot|null = saved ? JSON.parse(saved.snapshot_json) : null;
    return { bookId:id,title:source?.title ?? '教材处理中',format:source?.format ?? '',status:row.status,
      archived:row.archived_at!==null,revision:row.revision,sourceRevision:source?.sourceRevision ?? null,createdAt:row.created_at,
      chapters:source?.chapters.map(chapter=>({id:chapter.chapterId,title:chapter.title,
        characterCount:chapter.paragraphs.reduce((sum,p)=>sum+p.text.length,0)})) ?? [] };
  }
  list(scope: string,query='',archived=false): BookView[] {
    required(scope);
    return (this.db.prepare('SELECT book_id FROM vl_books WHERE scope_id=? ORDER BY created_at DESC').all(scope) as {book_id:string}[])
      .map(row=>this.get(scope,row.book_id)).filter(book=>book.archived===archived && book.title.toLowerCase().includes(query.toLowerCase()));
  }
  readChapter(scope:string,id:string,revision:string,chapterId:string,offset=0) {
    if (!Number.isSafeInteger(offset)||offset<0) throw new LearningError('INVALID_INPUT','分页不合法');
    const chapter=this.source(scope,id,revision).chapters.find(item=>item.chapterId===chapterId);
    if(!chapter) throw new LearningError('NOT_FOUND','章节不存在');
    return {...chapter,paragraphs:chapter.paragraphs.slice(offset,offset+100),nextOffset:offset+100<chapter.paragraphs.length?offset+100:null};
  }
  private saveSource(scope:string,id:string,tree:ChapterTree) {
    const source=createSourceSnapshot(id,tree);
    this.db.prepare('INSERT OR IGNORE INTO vl_source_revisions(scope_id,book_id,source_revision,snapshot_json,created_at) VALUES (?,?,?,?,?)')
      .run(scope,id,source.sourceRevision,JSON.stringify(source),new Date().toISOString());
  }
  async importFile(scope:string,key:string,file:File):Promise<BookView> {
    if(file.size>this.limits.maxBytes) throw new AppError('PAYLOAD_TOO_LARGE',`教材超过${Math.round(this.limits.maxBytes/1024/1024)}MiB`);
    const ext=path.extname(file.name).toLowerCase();
    if(!extensions.has(ext)||file.size===0) throw new LearningError('INVALID_INPUT','教材格式或内容不合法');
    const bytes=Buffer.from(await file.arrayBuffer());
    const hash=contentHash(bytes);
    if(this.limits.maxBooks!==null){
      // 只统计用户上传的教材，Agent 联网补充的公开来源（web: 前缀）不计入
      const count=(this.db.prepare("SELECT count(*) AS n FROM vl_books WHERE scope_id=? AND file_hash IS NOT NULL AND file_hash<>?").get(scope,hash) as {n:number}).n;
      if(count>=this.limits.maxBooks) throw new AppError('LIMIT_EXCEEDED',`每个空间最多上传 ${this.limits.maxBooks} 本教材`);
    }
    const jobs=new JobStore(this.db);
    const job=jobs.create(scope,'import',key,{hash,format:ext});
    if(job.result) return this.get(scope,job.result.id);
    if(job.resumable)jobs.resume(scope,job.jobId);
    const lease=jobs.claim(scope,job.jobId);
    if(!lease) throw new AppError('IN_PROGRESS','教材导入正在进行，请查询任务');
    const existing=this.db.prepare('SELECT book_id FROM vl_books WHERE scope_id=? AND file_hash=?').get(scope,hash) as {book_id:string}|undefined;
    if(existing){
      const book=this.get(scope,existing.book_id);
      if(book.status!=='ready') { jobs.finish(scope,job.jobId,lease,'failed',null,{code:'IN_PROGRESS',message:'已有导入尚未完成',retryable:true});throw new AppError('IN_PROGRESS','教材尚未导入完成'); }
      jobs.finish(scope,job.jobId,lease,'succeeded',{kind:'book',id:book.bookId},null);return book;
    }
    const id=randomUUID();
    this.db.transaction(()=>{const other=this.db.prepare('SELECT book_id FROM vl_books WHERE scope_id=? AND file_hash=?').get(scope,hash);if(other)throw new AppError('IN_PROGRESS','相同教材正在导入');this.db.prepare("INSERT INTO vl_books(scope_id,book_id,origin,file_relpath,file_hash,status,created_at) VALUES (?,?,'owned',?,?,'processing',?)").run(scope,id,`${id}${ext}`,hash,new Date().toISOString());}).immediate();
    const filename=path.join(this.root,`${id}${ext}`);
    try {
      mkdirSync(this.root,{recursive:true});
      writeFileSync(filename,bytes,{flag:'wx'});
      const tree=await parseTextbook(filename);
      tree.title=path.basename(file.name,ext);
      let index=0;
      for(const chapter of tree.chapters)for(const paragraph of chapter.paragraphs)paragraph.anchor={chapterId:chapter.id,index:index++};
      this.db.transaction(()=>{
        this.db.prepare("UPDATE vl_books SET status='ready' WHERE scope_id=? AND book_id=? AND status='processing'").run(scope,id);
        this.saveSource(scope,id,tree);
        jobs.finish(scope,job.jobId,lease,'succeeded',{kind:'book',id},null);
      }).immediate();
      return this.get(scope,id);
    } catch(error) {
      if(existsSync(filename))unlinkSync(filename);
      this.db.prepare('DELETE FROM vl_books WHERE scope_id=? AND book_id=?').run(scope,id);
      jobs.finish(scope,job.jobId,lease,'failed',null,{code:'VALIDATION_FAILED',message:'教材解析失败，请检查格式后重新上传',retryable:true});
      if(error instanceof LearningError)throw error;
      throw new LearningError('VALIDATION_FAILED','教材解析失败');
    }
  }
  /** Agent联网补充的公开正文，以不可变快照持久化，供后续引用回查。 */
  savePublicSource(scope: string, source: SourceSnapshot): void {
    if (!source.sourceId.startsWith('web:')) throw new LearningError('INVALID_INPUT','补充来源标识不合法');
    this.db.transaction(() => {
      this.db.prepare("INSERT OR IGNORE INTO vl_books(scope_id,book_id,origin,status,created_at) VALUES (?,?,'owned','ready',?)").run(scope,source.sourceId,new Date().toISOString());
      this.db.prepare('INSERT OR IGNORE INTO vl_source_revisions(scope_id,book_id,source_revision,snapshot_json,created_at) VALUES (?,?,?,?,?)').run(scope,source.sourceId,source.sourceRevision,JSON.stringify(source),new Date().toISOString());
    })();
  }
  archive(scope:string,id:string,revision:number,value:boolean):BookView {
    return this.db.transaction(()=>{
      const row=this.row(scope,id);
      if(row.revision!==revision||row.status==='deleting')throw new LearningError('VERSION_CONFLICT','教材已变化');
      this.db.prepare('UPDATE vl_books SET archived_at=?,revision=revision+1 WHERE scope_id=? AND book_id=?')
        .run(value?new Date().toISOString():null,scope,id);return this.get(scope,id);
    }).immediate();
  }
  inspectDeletion(scope:string,id:string) {
    const row=this.row(scope,id);
    const blockers:{kind:string;id:string;courseId?:string;status?:string}[]=[];
    if(row.status==='processing')blockers.push({kind:'import',id});
    for(const version of this.db.prepare('SELECT version_id,course_id,status,snapshot_json FROM vl_course_versions WHERE scope_id=?').all(scope) as {version_id:string;course_id:string;status:string;snapshot_json:string}[]){
      const snapshot=JSON.parse(version.snapshot_json);
      if(snapshot.textbookId===id||snapshot.sourceRevisions?.some((s:{sourceId:string})=>s.sourceId===id))blockers.push({kind:'course',id:version.version_id,courseId:version.course_id,status:version.status});
    }
    if(this.db.prepare("SELECT 1 FROM sqlite_master WHERE name='vl_drafts'").get()) {
      for(const draft of this.db.prepare("SELECT draft_id,input_json FROM vl_drafts WHERE scope_id=? AND state<>'discarded'").all(scope) as {draft_id:string;input_json:string}[]){
        const input=JSON.parse(draft.input_json);if(input.textbookId===id||input.sources?.some((s:{sourceId:string})=>s.sourceId===id))blockers.push({kind:'draft',id:draft.draft_id});
      }
    }

    return {bookId:id,revision:row.revision,blocked:blockers.length>0,blockers};
  }
  async deleteBook(scope:string,id:string,revision:number,confirmName:string) {
    const row=this.row(scope,id);const book=this.get(scope,id);
    if(confirmName!==book.title)throw new LearningError('INVALID_INPUT','请明确确认教材名称');
    const impact=this.db.transaction(()=>{
      const current=this.row(scope,id);if(current.revision!==revision)throw new LearningError('VERSION_CONFLICT','教材已变化');
      const impact=this.inspectDeletion(scope,id);if(impact.blocked)throw new LearningError('VALIDATION_FAILED','教材仍被课程或草稿使用，请归档');
      this.db.prepare("UPDATE vl_books SET status='deleting' WHERE scope_id=? AND book_id=?").run(scope,id);return impact;
    }).immediate();
    let filename:string|null=null;
    let quarantine:string|null=null;
    if(row.origin==='owned'&&row.file_relpath){
      if(path.basename(row.file_relpath)!==row.file_relpath)throw new LearningError('VALIDATION_FAILED','教材文件路径不合法');
      filename=path.join(this.root,row.file_relpath);
      if(existsSync(filename)&&(lstatSync(filename).isSymbolicLink()||path.dirname(realpathSync(filename))!==realpathSync(this.root)))throw new LearningError('VALIDATION_FAILED','教材文件不在管理目录');
      quarantine=filename+'.deleting';
      if(existsSync(filename))renameSync(filename,quarantine);
    }
    try { this.db.transaction(()=>{
      if(this.inspectDeletion(scope,id).blocked)throw new LearningError('VALIDATION_FAILED','教材新增关联，停止删除');
      this.db.prepare('DELETE FROM vl_source_revisions WHERE scope_id=? AND book_id=?').run(scope,id);
      this.db.prepare('DELETE FROM vl_books WHERE scope_id=? AND book_id=?').run(scope,id);
    }).immediate();
    } catch(error) {if(filename&&quarantine&&existsSync(quarantine))renameSync(quarantine,filename);throw error;}
    if(quarantine&&existsSync(quarantine))unlinkSync(quarantine);
    return {deleted:true,...impact};
  }
}
