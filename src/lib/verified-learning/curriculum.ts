import { LearningError,parseCourseInput,type CourseInput,type CourseModuleView } from './contracts';
import { checkCitation,type SourceSnapshot } from './sources';
import { parse,proposalSchema,choicesSchema,type DraftInput,type CurriculumProposal,type DesignChoices } from './backend-contracts';
export interface CurriculumIssue {code:string;knowledgePointIds:string[];message:string}
export interface CurriculumReport {input:CourseInput;issues:CurriculumIssue[];includedIds:string[];skippedIds:string[];decisions:{knowledgePointId:string;action:string;reason:string}[]}
export function compileCurriculum(input:DraftInput,raw:CurriculumProposal,sources:readonly SourceSnapshot[],rawChoices:DesignChoices):CurriculumReport {
 const proposal=parse(proposalSchema,raw),choices=parse(choicesSchema,rawChoices);const issues:CurriculumIssue[]=[];
 const issue=(code:string,ids:string[],message:string)=>issues.push({code,knowledgePointIds:ids,message});
 const points=new Map(proposal.points.map(p=>[p.id,structuredClone(p)]));
 if(points.size!==proposal.points.length)throw new LearningError('INVALID_INPUT','知识点编号重复');
 for(const edit of choices.prerequisiteEdits){const point=points.get(edit.pointId);if(!point)throw new LearningError('INVALID_INPUT','修改了不存在的知识点');point.prerequisiteIds=edit.prerequisiteIds;}
 for(const ids of [choices.targetIds,choices.excludedIds,choices.declaredIds,choices.order??[]])if(new Set(ids).size!==ids.length)throw new LearningError('INVALID_INPUT','知识点重复');
 if(!choices.targetIds.length)issue('EMPTY_TARGET',[],'请至少选择一个目标知识点');
 const visited=new Set<string>(),active=new Set<string>();
 const check=(id:string)=>{if(active.has(id)){issue('PREREQUISITE_CYCLE',[id],'先修关系存在循环');return;}if(visited.has(id))return;active.add(id);for(const dep of points.get(id)?.prerequisiteIds??[])if(points.has(dep))check(dep);active.delete(id);visited.add(id);};
 for(const id of points.keys())check(id);
 const prior=new Set(choices.declaredIds),included=new Set<string>();
 const include=(id:string)=>{if(included.has(id))return;const point=points.get(id);if(!point){if(!prior.has(id))issue('UNKNOWN_KNOWLEDGE',[id],'缺少必要先修知识');return;}included.add(id);for(const dep of point.prerequisiteIds)if(!prior.has(dep))include(dep);};
 for(const id of choices.targetIds)include(id);
 for(const id of choices.excludedIds)if(included.has(id)&&!prior.has(id))issue('EXCLUDED_PREREQUISITE',[id],'排除项仍是目标或必要先修');
 const pending=[...points.keys()].filter(id=>included.has(id));const ordered:string[]=[];const available=new Set(prior);
 while(pending.length){const index=pending.findIndex(id=>points.get(id)!.prerequisiteIds.every(dep=>available.has(dep)));if(index<0){ordered.push(...pending);break;}const [id]=pending.splice(index,1);ordered.push(id);available.add(id);}
 if(choices.order){if(choices.order.length!==included.size||choices.order.some(id=>!included.has(id)))issue('INVALID_ORDER',choices.order,'顺序必须包含全部课程知识点');else{ordered.splice(0,ordered.length,...choices.order);const seen=new Set(prior);for(const id of ordered){if(points.get(id)!.prerequisiteIds.some(dep=>!seen.has(dep)))issue('INVALID_ORDER',[id],'必要基础必须排在当前知识点之前');seen.add(id);}}}
 const outline:CourseModuleView[]=[];const revisions=new Map<string,string>();const decisions:CurriculumReport['decisions']=[];let last='';
 for(const id of ordered){const point=points.get(id)!;const valid=point.citations.filter(citation=>{const result=checkCitation(sources,citation);if(!result.ok)issue('INVALID_CITATION',[id],'来源引用无法回查');return result.ok;});
 const sourceIds=[...new Set(valid.map(c=>c.sourceId))];const covered=sourceIds.includes(input.textbookId!);const coverage=sourceIds.length?(covered?'covered':'supplemented'):'missing';
 if(!sourceIds.length)issue('SOURCE_GAP',[id],'教材缺少该知识点的可核对来源');
 for(const source of sourceIds)if(source!==input.textbookId&&(!input.allowSupplementalSources||!choices.supplementalSourceIds.includes(source)))issue('SUPPLEMENT_NOT_APPROVED',[id],'补充资料需要明确确认');
 for(const citation of valid)revisions.set(citation.sourceId,citation.sourceRevision);
 const first=valid[0];const group=JSON.stringify([first?.sourceId??'gap',first?.chapterId??'gap']);
 if(group!==last){outline.push({moduleId:JSON.stringify([group,outline.length]),title:first?sources.find(s=>s.sourceId===first.sourceId)?.chapters.find(c=>c.chapterId===first.chapterId)?.title??'学习单元':'教材缺口',points:[]});last=group;}
 const target=choices.targetIds.includes(id);const reason=target?'目标知识点':'为目标保留的必要先修';
 outline.at(-1)!.points.push({knowledgePointId:id,title:point.title,prerequisiteIds:point.prerequisiteIds,sourceIds,role:target?'target':'prerequisite',coverage,reason});decisions.push({knowledgePointId:id,action:coverage==='supplemented'?'supplement':'keep',reason});
 }
 const skippedIds=[...points.keys()].filter(id=>!included.has(id));for(const id of skippedIds)decisions.push({knowledgePointId:id,action:'skip',reason:'不在本次目标及其先修范围'});
 const course=parseCourseInput({textbookId:input.textbookId,goal:input.goal,teachingPrompt:input.teachingPrompt,
 priorKnowledge:[...prior].map(knowledgePointId=>({knowledgePointId,source:'declared'})),includedTopics:input.includedTopics,excludedTopics:input.excludedTopics,
 allowSupplementalSources:input.allowSupplementalSources,assessment:input.assessment,outline,sourceRevisions:[...revisions].map(([sourceId,sourceRevision])=>({sourceId,sourceRevision}))});
 return {input:course,issues,includedIds:ordered,skippedIds,decisions};
}
