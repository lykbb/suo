import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import { addCard, addTemplateCard, center, closeModal, startWith } from './actions';
import { request } from './bridge';
import './Toolbox.css';

type Resource = { path: string; content: string };
type Skill = { name: string; title: string; description: string; editable: boolean; revision: string; source: 'builtin' | 'custom' };
type SkillDetail = { skill: Skill; body: string; files: Resource[] };
type Template = { id: string; title: string; description: string; revision: string };
type TemplateDetail = { template: Template; body: string };
type Edit = { kind: 'skill' | 'template'; name: string; title: string; description: string; body: string; files: Resource[]; revision: string | null; readonly?: boolean };
// Each built-in skill has its own mark and tone; skills the user adds get a tone from their name.
const SKILL_LOOKS: Record<string, { icon: string; tone: string }> = {
  'ai-product-initiation': { icon: 'bulb', tone: 'orange' }, 'pm-ai-product-design': { icon: 'chip', tone: 'purple' },
  'pm-competitive-research': { icon: 'scale', tone: 'teal' }, 'pm-material-synthesis': { icon: 'layers', tone: 'blue' },
  'pm-metrics-experiments': { icon: 'chart', tone: 'green' }, 'pm-opportunity-assessment': { icon: 'target', tone: 'yellow' },
  'pm-prioritization-roadmap': { icon: 'flag', tone: 'orange' }, 'pm-requirements-prd': { icon: 'layers', tone: 'blue' },
  'pm-prd': { icon: 'prd', tone: 'blue' },
  'pm-user-research': { icon: 'users', tone: 'pink' }, 'product-manager': { icon: 'compass', tone: 'teal' },
  'pm-ai-evaluation': { icon: 'check', tone: 'purple' },
};
const TONES = ['blue', 'green', 'yellow', 'purple', 'pink', 'orange', 'teal'];
const skillLook = (name: string) => SKILL_LOOKS[name] ?? { icon: 'sparkle', tone: TONES[[...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % TONES.length] };
const errorText = (error: unknown) => error instanceof Error ? error.message : '暂时没有保存成功，请重试。';
const BUILTINS = [
  { icon: 'book', title: '产品立项', description: '八章工作底稿：问题、用户、取舍、体验与版本。', run: () => addCard('document', center(), true) },
  { icon: 'message', title: '用户访谈', description: '从最近一次真实经历开始，收集证据。', run: () => addTemplateCard('用户访谈 · 提纲', '访谈目标\n\n目标受访者\n\n最近一次经历\n\n具体困难与现有做法\n\n待验证假设\n\n证据与结论') },
  { icon: 'globe', title: '竞品研究', description: '按用户任务比较，记录来源与取舍。', run: () => addTemplateCard('竞品对比 · 底稿', '核心场景\n\n目标用户\n\n完成任务的步骤\n\n值得参考的取舍\n\n证据链接\n\n我们的机会') },
];

export default function Toolbox() {
  const [skills, setSkills] = useState<Skill[] | null>(null), [templates, setTemplates] = useState<Template[] | null>(null);
  const [edit, setEdit] = useState<Edit | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const fileInput = useRef<HTMLInputElement>(null), folderInput = useRef<HTMLInputElement>(null), generation = useRef(0), alive = useRef(true);
  useEffect(() => { alive.current = true; void refresh(); return () => { alive.current = false; generation.current++; }; }, []);
  async function refresh() {
    const current = ++generation.current;
    const [skillResult, templateResult] = await Promise.allSettled([request<Skill[]>('skills.list'), request<Template[]>('templates.list')]);
    if (!alive.current || generation.current !== current) return;
    if (skillResult.status === 'fulfilled') setSkills(skillResult.value);
    if (templateResult.status === 'fulfilled') setTemplates(templateResult.value);
    const failed = [skillResult, templateResult].find(result => result.status === 'rejected');
    if (failed?.status === 'rejected') setError(errorText(failed.reason));
  }
  function create(kind: Edit['kind']) {
    setError(''); setNotice('');
    setEdit({ kind, name: kind === 'template' ? crypto.randomUUID() : '', title: '', description: '', body: '', files: [], revision: null });
  }
  async function openSkill(skill: Skill) {
    setBusy(true); setError(''); setNotice('');
    try {
      const detail = await request<SkillDetail>('skills.get', { name: skill.name });
      if (alive.current) setEdit({ kind: 'skill', name: detail.skill.name, title: detail.skill.title, description: detail.skill.description, body: detail.body,
        files: detail.files, revision: detail.skill.revision, readonly: !detail.skill.editable });
    } catch (error) { if (alive.current) setError(errorText(error)); }
    finally { if (alive.current) setBusy(false); }
  }
  async function openTemplate(template: Template) {
    setBusy(true); setError(''); setNotice('');
    try {
      const detail = await request<TemplateDetail>('templates.get', { id: template.id });
      if (alive.current) setEdit({ kind: 'template', name: detail.template.id, title: detail.template.title, description: detail.template.description, body: detail.body, files: [], revision: detail.template.revision });
    } catch (error) { if (alive.current) setError(errorText(error)); }
    finally { if (alive.current) setBusy(false); }
  }
  async function insertTemplate(template: Template) {
    setBusy(true); setError('');
    try {
      const detail = await request<TemplateDetail>('templates.get', { id: template.id });
      if (alive.current) addTemplateCard(detail.template.title, detail.body);
    } catch (error) { if (alive.current) setError(errorText(error)); }
    finally { if (alive.current) setBusy(false); }
  }
  async function importFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const selection = Array.from(files).filter(file => !(file.webkitRelativePath || file.name).split('/').some(part => part.startsWith('.')));
      if (!selection.length) throw new Error('请选择包含 SKILL.md 的技能文件夹。');
      if (selection.length > 65 || selection.some(file => file.size > 400000) || selection.reduce((size, file) => size + file.size, 0) > 2000000) throw new Error('最多导入 65 个文件，单个 400 KB，合计 2 MB。');
      const folder = selection[0].webkitRelativePath ? selection[0].webkitRelativePath.split('/')[0] + '/' : '';
      if (folder && selection.some(file => !file.webkitRelativePath.startsWith(folder))) throw new Error('一次只能导入一个技能文件夹。');
      const resources = await Promise.all(selection.map(async file => ({ path: folder ? file.webkitRelativePath.slice(folder.length) : file.name, content: await file.text() })));
      const parsed = await request<Omit<Edit, 'kind' | 'revision'>>('skills.parse', { files: resources });
      if (alive.current) setEdit({ ...parsed, kind: 'skill', revision: null });
    } catch (error) { if (alive.current) setError(errorText(error)); }
    finally { if (alive.current) setBusy(false); if (fileInput.current) fileInput.current.value = ''; if (folderInput.current) folderInput.current.value = ''; }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!edit || edit.readonly || busy) return;
    setBusy(true); setError('');
    try {
      if (edit.kind === 'skill') await request<SkillDetail>('skills.save', { name: edit.name.trim(), title: edit.title.trim(), description: edit.description.trim(), body: edit.body, files: edit.files, expectedRevision: edit.revision });
      else await request<TemplateDetail>('templates.save', { id: edit.name, title: edit.title.trim(), description: edit.description.trim(), body: edit.body, expectedRevision: edit.revision });
      if (!alive.current) return;
      setEdit(null); setNotice(edit.kind === 'skill' ? '技能已保存，Suo 现在可以读取使用。' : '模板已保存，可以随时插入画布。');
      await refresh();
    } catch (error) { if (alive.current) setError(errorText(error)); }
    finally { if (alive.current) setBusy(false); }
  }
  function useSkill(skill: Pick<Skill, 'name' | 'title'>) {
    closeModal(); startWith(`用「${skill.title}」技能（${skill.name}）帮我：`);
  }
  const change = (key: 'name' | 'title' | 'description' | 'body', value: string) => setEdit(current => current ? { ...current, [key]: value } : current);
  if (edit) return <section className="toolbox-editor" aria-label={edit.kind === 'skill' ? '技能编辑' : '模板编辑'}>
    <header className="library-editor-head"><button type="button" className="chip" disabled={busy} onClick={() => { setEdit(null); setError(''); }}><Icon name="back" size={16} />返回工具箱</button>
      <strong>{edit.readonly ? '查看技能' : edit.revision ? '修改' : '添加'}{edit.readonly ? '' : edit.kind === 'skill' ? '技能' : '模板'}</strong></header>
    <form onSubmit={event => void save(event)}>
      <div className="library-fields"><label>名称<input autoFocus value={edit.title} maxLength={100} required readOnly={edit.readonly} disabled={busy} placeholder="例如：需求评审" onChange={event => change('title', event.target.value)} /></label>
      {edit.kind === 'skill' && <label>技能标识<input value={edit.name} maxLength={64} pattern="[a-z0-9]+(-[a-z0-9]+)*" required readOnly={!!edit.revision || edit.readonly} disabled={busy} placeholder="例如：requirement-review" onChange={event => change('name', event.target.value)} /></label>}</div>
      <label>简短说明<textarea className="library-description" value={edit.description} maxLength={1000} required readOnly={edit.readonly} disabled={busy} placeholder="什么情况下使用，能帮用户完成什么" onChange={event => change('description', event.target.value)} /></label>
      <label>{edit.kind === 'skill' ? '技能说明与流程' : '模板内容'}<textarea className="library-body" value={edit.body} maxLength={350000} required readOnly={edit.readonly} disabled={busy} placeholder={edit.kind === 'skill' ? '写清目标、操作步骤和完成标准，支持 Markdown。' : '填写标题、问题或章节；插入画布后可以自由修改。'} onChange={event => change('body', event.target.value)} /></label>
      {!!edit.files.length && <details className="library-resources"><summary>随附文件 · {edit.files.length} 个</summary><ul>{edit.files.map(file => <li key={file.path}>{file.path}</li>)}</ul></details>}
      {error && <p className="library-error" role="alert">{error}</p>}
      <footer className="modal-foot"><button type="button" className="chip" disabled={busy} onClick={() => { setEdit(null); setError(''); }}>返回</button>
        {edit.readonly ? <button type="button" className="accent-button" onClick={() => useSkill(edit)}>使用技能</button> : <button type="submit" className="accent-button" disabled={busy}>{busy ? '正在保存…' : edit.revision ? '保存修改' : edit.kind === 'skill' ? '保存技能' : '保存模板'}</button>}</footer>
    </form>
  </section>;
  return <section className="skill-library" aria-label="技能与模板">
    <input ref={fileInput} type="file" accept=".md" aria-label="选择 SKILL.md" hidden onChange={event => void importFiles(event.target.files)} />
    <input ref={folderInput} type="file" multiple {...{ webkitdirectory: '' }} aria-label="选择技能文件夹" hidden onChange={event => void importFiles(event.target.files)} />
    <div className="library-section-head"><div><h2>技能</h2></div><div className="library-actions">
      <button type="button" className="chip" disabled={busy} onClick={() => fileInput.current?.click()}><Icon name="import" size={15} />导入 SKILL.md</button>
      <button type="button" className="chip" disabled={busy} onClick={() => folderInput.current?.click()}>导入文件夹</button>
      <button type="button" className="chip" disabled={busy} onClick={() => create('skill')}><Icon name="plus" size={15} />添加技能</button>
    </div></div>
    {error && <p className="library-error" role="alert">{error}<button type="button" className="chip" disabled={busy} onClick={() => { setError(''); void refresh(); }}>重新读取</button></p>}
    {notice && <p className="library-notice" role="status">{notice}</p>}
    {!skills ? <p className="library-empty" role="status">正在读取技能…</p> : !skills.length ? <p className="library-empty">还没有技能，添加一个自己的工作流程。</p> : <div className="toolbox skills">
      {skills.map(skill => <article className="skill-card" key={skill.name}>
        <button type="button" className="library-card-main" onClick={() => useSkill(skill)}><span className="skill-icon" data-tone={skillLook(skill.name).tone}><Icon name={skillLook(skill.name).icon} size={19} /></span><strong>{skill.title}</strong><p>{skill.description}</p><span className="skill-start">使用技能<Icon name="chevron" size={15} /></span></button>
        <button type="button" className="library-card-edit icon-button" aria-label={`${skill.editable ? '编辑' : '查看'}技能：${skill.title}`} title={skill.editable ? '编辑技能' : '查看完整说明'} disabled={busy} onClick={() => void openSkill(skill)}><Icon name={skill.editable ? 'pencil' : 'book'} size={15} /></button>
      </article>)}
    </div>}
    <div className="library-section-head template-section-head"><div><h2>模板</h2></div><button type="button" className="chip" disabled={busy} onClick={() => create('template')}><Icon name="plus" size={15} />添加模板</button></div>
    <div className="toolbox templates">
      {BUILTINS.map(tool => <article className="skill-card" key={tool.title}><button type="button" className="library-card-main" onClick={tool.run}><span className="skill-icon"><Icon name={tool.icon} /></span><strong>{tool.title}</strong><p>{tool.description}</p><span className="skill-start">插入模板<Icon name="plus" size={15} /></span></button></article>)}
      {templates?.map(template => <article className="skill-card" key={template.id}><button type="button" className="library-card-main" disabled={busy} onClick={() => void insertTemplate(template)}><span className="skill-icon"><Icon name="file" /></span><strong>{template.title}</strong><p>{template.description}</p><span className="skill-start">插入模板<Icon name="plus" size={15} /></span></button>
        <button type="button" className="library-card-edit icon-button" aria-label={`编辑模板：${template.title}`} title="编辑模板" disabled={busy} onClick={() => void openTemplate(template)}><Icon name="pencil" size={15} /></button></article>)}
    </div>
  </section>;
}
