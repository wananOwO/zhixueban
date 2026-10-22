import { describe, expect, it } from 'vitest';
import { DraftSaveQueue, generationProblems, teachingSelection } from '@/lib/verified-learning/draft-editor';

describe('草稿编辑与生成前置', () => {
  it('教学选择一次同步模板、学科和默认语言', () => {
    expect(teachingSelection({ templateId: 'builtin:computer', subjectType: 'computer' }, null)).toEqual({ templateId: 'builtin:computer', subjectType: 'computer', programmingLanguage: 'python' });
    expect(teachingSelection({ templateId: 'builtin:math', subjectType: 'math' }, 'c').programmingLanguage).toBe(null);
  });
  it('逐项列出未选教材与章节，不以笼统禁用替代反馈', () => {
    expect(generationProblems({goal:'目标',textbookId:null,sources:[]})).toContain('请选择主教材');
    expect(generationProblems({goal:'目标',textbookId:'b',sources:[{sourceId:'b',chapterIds:[]}]})).toContain('请为第 1 本教材选择章节');
    expect(generationProblems({goal:'目标',textbookId:'b',sources:[{sourceId:'b',chapterIds:['c']}]})).toEqual([]);
  });
  it('生成前等待正在保存的请求，再保存最新输入', async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const calls: number[] = [];
    const queue = new DraftSaveQueue<number>(async (input, revision) => { calls.push(input); if(input===1)await gate; return revision+1; },0);
    queue.update(1);const first=queue.flush();queue.update(2);const second=queue.flush();
    expect(calls).toEqual([1]);release();await Promise.all([first,second]);
    expect(calls).toEqual([1,2]);expect(queue.revision).toBe(2);expect(queue.dirty).toBe(false);
  });
  it('失败不无限重试，显式重试保留同一幂等键', async () => {
    const keys:string[]=[];let fail=true;
    const queue=new DraftSaveQueue<number>(async (_,revision,key)=>{keys.push(key);if(fail)throw new Error('断网');return revision+1;},0);
    queue.update(1);await expect(queue.flush()).rejects.toThrow('断网');expect(keys).toHaveLength(1);expect(queue.dirty).toBe(true);
    fail=false;await queue.flush();expect(keys[1]).toBe(keys[0]);expect(queue.dirty).toBe(false);
  });
});
