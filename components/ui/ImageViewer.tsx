'use client';

import { useRef, useState } from 'react';
import styles from './image-viewer.module.css';

/** Native modal handles focus containment, Escape and focus restoration. */
export default function ImageViewer({ src, alt }: { src: string; alt: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [opened, setOpened] = useState(false);
  return <div className={styles.viewer}>
    <button type="button" className={styles.preview} aria-label={`放大查看：${alt}`} aria-haspopup="dialog" onClick={() => { setOpened(true); dialog.current?.showModal(); }}><img src={src} alt={alt} loading="lazy" /><span>放大查看 ↗</span></button>
    <dialog ref={dialog} className={styles.dialog} aria-label={alt} onClose={() => setOpened(false)} onKeyDown={event => { if (event.key === 'Tab') { event.preventDefault(); dialog.current?.querySelector('button')?.focus(); } }}>
      <div className={styles.heading}><p>{alt}</p><button type="button" autoFocus onClick={() => dialog.current?.close()}>關閉圖片 ×</button></div>
      {opened && <img src={src} alt={alt} />}
    </dialog>
  </div>;
}
