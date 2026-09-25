"use client";

import { useEffect, useState, type ReactNode } from "react";

const widgets = {
  countdown: "國考倒數", features: "VetExam 功能介紹", "weekly-most-missed": "本週最多人答錯",
  progress: "我的學習進度", subjects: "選擇題庫開始練習", "chapter-stats": "各章節歷屆題量",
  "daily-goal": "今日目標", achievement: "學習小成就",
};
type Id = keyof typeof widgets;
const ids = Object.keys(widgets) as Id[];
const storageKey = "vetexam.home.layout.v1";
type Layout = { order: Id[]; hidden: Id[] };
const defaults: Layout = { order: ids, hidden: [] };
function readLayout(): Layout {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) || "null");
    if (!value || !Array.isArray(value.order) || !Array.isArray(value.hidden)) return defaults;
    const valid = (id: unknown): id is Id => typeof id === "string" && ids.includes(id as Id);
    return { order: [...new Set<Id>([...value.order.filter(valid), ...ids])], hidden: [...new Set<Id>(value.hidden.filter(valid))] };
  } catch { return defaults; }
}

export default function HomeLayout({ hero, visual, children }: {
  hero: ReactNode; visual: ReactNode; children: Record<Id, ReactNode>;
}) {
  const [layout, setLayout] = useState(defaults);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<Id | null>(null);
  const [dragging, setDragging] = useState<Id | null>(null);
  useEffect(() => {
    // Read browser preferences only after hydration; never overwrite them on initial render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLayout(readLayout());
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 8000);
    return () => clearTimeout(timer);
  }, [notice]);
  function save(next: Layout) {
    setLayout(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Preferences still work for this visit. */ }
  }
  function restore(id: Id) { save({ ...layout, hidden: layout.hidden.filter(item => item !== id) }); setNotice(null); }
  const visible = layout.order.filter(id => !layout.hidden.includes(id));
  function move(id: Id, target: Id) {
    const focusedLabel = document.activeElement?.getAttribute("aria-label");
    const order = [...layout.order];
    order.splice(order.indexOf(id), 1);
    order.splice(layout.order.indexOf(target), 0, id);
    save({ ...layout, order });
    // Repacking can move a card into a different row. Keep keyboard focus on its controls.
    requestAnimationFrame(() => {
      const controls = document.querySelector(`[data-widget="${id}"] .study-widget-controls`);
      const buttons = Array.from(controls?.querySelectorAll<HTMLButtonElement>("button") ?? []);
      (buttons.find(button => button.getAttribute("aria-label") === focusedLabel && !button.disabled) ?? buttons[0])?.focus({ preventScroll: true });
    });
  }
  function widget(id: Id) {
    if (layout.hidden.includes(id)) return null;
    const index = visible.indexOf(id);
    return <div key={id} data-widget={id} className={`study-widget ${editing ? "study-widget-editing" : ""} ${id === "countdown" ? "study-countdown-slot" : ""}`}
      onDragOver={event => { if (editing && dragging) event.preventDefault(); }}
      onDrop={event => { event.preventDefault(); if (dragging && dragging !== id) move(dragging, id); setDragging(null); }}>
      <div className="study-widget-controls">
        {editing && <>
          <button type="button" draggable aria-label={`拖曳「${widgets[id]}」排序`} title="拖曳排序，也可使用上移／下移"
            onDragStart={event => { setDragging(id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", id); }} onDragEnd={() => setDragging(null)}>⠿</button>
          <button type="button" disabled={index === 0} aria-label={`上移「${widgets[id]}」`} onClick={() => move(id, visible[index - 1])}>上移</button>
          <button type="button" disabled={index === visible.length - 1} aria-label={`下移「${widgets[id]}」`} onClick={() => move(id, visible[index + 1])}>下移</button>
        </>}
        <button type="button" className="study-widget-close" aria-label={`隱藏「${widgets[id]}」`} onClick={() => { save({ ...layout, hidden: [...layout.hidden, id] }); setNotice(id); }}>×</button>
      </div>
      {children[id]}
    </div>;
  }
  const original = layout.order.every((id, i) => id === ids[i]) && !layout.hidden.length;
  const anchoredCountdown = visible[0] === "countdown";
  const rest = visible.filter(id => !(anchoredCountdown && id === "countdown"));
  // Pack consecutive cards into rows; full-width sections always retain their own row.
  const rows: Id[][] = [];
  for (const id of rest) {
    const full = id === "features" || id === "subjects";
    const previous = rows.at(-1);
    if (!full && previous?.length === 1 && !["features", "subjects"].includes(previous[0])) previous.push(id);
    else rows.push([id]);
  }
  return <>
    <div className="study-layout-toolbar"><button className="study-text-link" type="button" aria-expanded={editing} aria-controls="home-layout-settings" onClick={() => setEditing(!editing)}>{editing ? "完成自訂" : "自訂首頁"}</button></div>
    {editing && <section id="home-layout-settings" className="study-card study-layout-settings" aria-label="首頁版面設定">
      <p>拖曳卡片，或使用上移／下移調整順序。</p>
      <div><strong>已隱藏項目</strong>{layout.hidden.length ? layout.hidden.map(id => <button type="button" className="study-button" key={id} onClick={() => restore(id)}>顯示「{widgets[id]}」</button>) : <span className="study-muted">目前沒有隱藏卡片</span>}</div>
      <button className="study-text-link" type="button" onClick={() => { save(defaults); setNotice(null); }}>恢復預設版面</button>
    </section>}
    {notice && <div className="study-layout-notice" role="status">已隱藏「{widgets[notice]}」<button className="study-text-link" type="button" onClick={() => restore(notice)}>復原</button></div>}
    <div className={`study-welcome ${anchoredCountdown ? "" : "study-welcome-without-countdown"}`}>{hero}{visual}{anchoredCountdown && widget("countdown")}</div>
    {original ? <>
      {widget("features")}
      <div className="study-insights-grid">{widget("weekly-most-missed")}{widget("progress")}</div>
      {widget("subjects")}
      <div className="study-planning-grid">{widget("chapter-stats")}<div className="study-side-cards">{widget("daily-goal")}{widget("achievement")}</div></div>
    </> : rows.map(row => <div className={`study-widget-row ${row.length === 1 ? "study-widget-row-single" : ""}`} key={row.join(":")}>{row.map(widget)}</div>)}
  </>;
}
