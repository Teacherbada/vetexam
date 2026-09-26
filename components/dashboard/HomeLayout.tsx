"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";

type WidgetMetadata = { label: string; size: 'full' | 'half' | 'third'; hideable: boolean; pairGroup: string | null };
const widgets = {
  'daily-goal': { label: '今日目標', size: 'third', hideable: true, pairGroup: null },
  'due-review': { label: '到期複習', size: 'third', hideable: true, pairGroup: null },
  countdown: { label: '國考倒數', size: 'third', hideable: true, pairGroup: null },
  subjects: { label: '選擇題庫開始練習', size: 'full', hideable: true, pairGroup: null },
  progress: { label: '我的學習進度', size: 'half', hideable: true, pairGroup: 'learning' },
  'chapter-stats': { label: '各章節歷屆題量', size: 'half', hideable: true, pairGroup: 'learning' },
  'weekly-most-missed': { label: '本週最多人答錯', size: 'full', hideable: true, pairGroup: null },
  features: { label: 'VetExam 功能介紹', size: 'full', hideable: true, pairGroup: null },
  achievement: { label: '學習小成就', size: 'half', hideable: true, pairGroup: null },
} satisfies Record<string, WidgetMetadata>;
type Id = keyof typeof widgets;
const defaultOrder = Object.keys(widgets) as Id[];
const storageKey = "vetexam.home.layout.v1";
type Layout = { order: Id[]; hidden: Id[] };
const defaults: Layout = { order: defaultOrder, hidden: [] };
function readLayout(): Layout {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) || "null");
    if (!value || !Array.isArray(value.order) || !Array.isArray(value.hidden)) return defaults;
    const valid = (id: unknown): id is Id => typeof id === "string" && defaultOrder.includes(id as Id);
    return {
      order: [...new Set<Id>([...value.order.filter(valid), ...defaultOrder])],
      hidden: [...new Set<Id>(value.hidden.filter(valid))].filter(id => widgets[id].hideable),
    };
  } catch { return defaults; }
}

export default function HomeLayout({ hero, visual, illustration, introduction, children }: {
  hero: ReactNode; visual: ReactNode; illustration: ReactNode; introduction: ReactNode; children: Record<Id, ReactNode>;
}) {
  const [layout, setLayout] = useState(defaults);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<Id | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [dragging, setDragging] = useState<Id | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // Hydrate existing v1 preferences without overwriting them on first render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLayout(readLayout());
  }, []);
  function save(next: Layout) {
    setLayout(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Preferences still work for this visit. */ }
  }
  function focusControls(id?: Id, label?: string | null) {
    requestAnimationFrame(() => {
      const buttons = Array.from(grid.current?.querySelectorAll<HTMLButtonElement>(`[data-widget="${id}"] .study-widget-controls button`) ?? []);
      (buttons.find(button => button.getAttribute('aria-label') === label && !button.disabled) ?? buttons[0] ?? toggle.current)?.focus();
    });
  }
  function restore(id: Id) {
    save({ ...layout, hidden: layout.hidden.filter(item => item !== id) });
    setNotice(null); setAnnouncement(`已顯示「${widgets[id].label}」`); focusControls(id);
  }
  const visible = layout.order.filter(id => !layout.hidden.includes(id));
  function move(id: Id, target: Id) {
    if (!editing || id === target || !visible.includes(id) || !visible.includes(target)) return;
    const focusedLabel = document.activeElement?.getAttribute('aria-label');
    const order = [...layout.order];
    order.splice(order.indexOf(id), 1);
    order.splice(layout.order.indexOf(target), 0, id);
    save({ ...layout, order });
    setAnnouncement(`已移動「${widgets[id].label}」`); focusControls(id, focusedLabel);
  }
  function hide(id: Id) {
    if (!editing || !widgets[id].hideable) return;
    const index = visible.indexOf(id);
    save({ ...layout, hidden: [...layout.hidden, id] }); setNotice(id);
    focusControls(visible[index + 1] ?? visible[index - 1]);
  }
  // Only compatible adjacent half widgets share a row. No dense packing or
  // separate default tree: DOM order, saved order and keyboard order agree.
  const paired = new Set<Id>();
  for (let index = 0; index < visible.length - 1; index++) {
    const first = widgets[visible[index]], next = widgets[visible[index + 1]];
    if (first.size === 'half' && next.size === 'half' && first.pairGroup && first.pairGroup === next.pairGroup) {
      paired.add(visible[index]); paired.add(visible[index + 1]); index++;
    }
  }
  // Section boundaries follow the saved DOM order; customization never uses CSS reordering.
  const introductionIndex = visible.findIndex(id => widgets[id].size !== 'third');
  return <>
    <div className="study-layout-toolbar"><button ref={toggle} className="study-text-link" type="button" aria-expanded={editing} aria-controls={editing ? 'home-layout-settings' : undefined}
      onClick={() => { setEditing(!editing); setDragging(null); setNotice(null); }}>{editing ? '完成自訂' : '自訂首頁'}</button></div>
    {editing && <section id="home-layout-settings" className="study-card study-layout-settings" aria-labelledby="home-layout-title">
      <h2 id="home-layout-title">正在自訂首頁</h2>
      <p>拖曳或使用上下移調整版面，完成後按「完成自訂」。首頁介紹與今日學習狀態會固定保留。</p>
      <div><strong>已隱藏項目</strong>{layout.hidden.length ? layout.hidden.map(id => <button type="button" className="study-button" key={id} onClick={() => restore(id)}>顯示「{widgets[id].label}」</button>) : <span className="study-muted">目前沒有隱藏卡片</span>}</div>
      <button className="study-text-link" type="button" onClick={() => { save(defaults); setNotice(null); setAnnouncement('已恢復預設版面'); }}>恢復預設版面</button>
    </section>}
    {editing && notice && <div className="study-layout-notice" role="status">已隱藏「{widgets[notice].label}」<button className="study-text-link" type="button" onClick={() => restore(notice)}>復原</button></div>}
    <span className="study-layout-announcement" role="status">{announcement}</span>
    <div className="study-welcome">{hero}{illustration}</div>
    <div className="study-hero-status-group">{visual}</div>
    {visible.some(id => widgets[id].size === 'third') && <div className="study-today-heading"><p>照自己的步調，完成今天的一小步</p><h2>今天的學習</h2></div>}
    <div ref={grid} className="study-widget-grid">
      {visible.map((id, index) => <Fragment key={id}>
        {index === introductionIndex && <div className="study-journey-slot">{introduction}</div>}
        <div data-home-reveal data-widget={id} data-size={widgets[id].size} data-span={widgets[id].size === 'third' ? 'third' : paired.has(id) ? 'half' : 'full'}
        className={`study-widget${editing ? ' study-widget-editing' : ''}${dragging === id ? ' study-widget-dragging' : ''}`}
        onDragOver={event => { if (editing && dragging) event.preventDefault(); }}
        onDrop={event => { if (editing && dragging) { event.preventDefault(); move(dragging, id); } setDragging(null); }}>
        {editing && <div className="study-widget-controls" role="group" aria-label={`${widgets[id].label}版面操作`}>
          <span className="study-widget-label">{widgets[id].label}</span>
          <div className="study-widget-actions">
            <button type="button" draggable aria-label={`拖曳「${widgets[id].label}」排序`} title="拖曳排序，也可使用上移／下移"
              onDragStart={event => { setDragging(id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', id); }} onDragEnd={() => setDragging(null)}><span aria-hidden="true">⠿</span></button>
            <button type="button" disabled={index === 0} aria-label={`上移「${widgets[id].label}」`} onClick={() => move(id, visible[index - 1])}>上移</button>
            <button type="button" disabled={index === visible.length - 1} aria-label={`下移「${widgets[id].label}」`} onClick={() => move(id, visible[index + 1])}>下移</button>
            {widgets[id].hideable && <button type="button" aria-label={`隱藏「${widgets[id].label}」`} onClick={() => hide(id)}>隱藏</button>}
          </div>
        </div>}
        <div className="study-widget-content">{children[id]}</div>
      </div></Fragment>)}
      {introductionIndex === -1 && <div className="study-journey-slot">{introduction}</div>}
    </div>
  </>;
}
