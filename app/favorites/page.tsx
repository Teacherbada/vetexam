"use client";

import { useEffect, useState } from "react";
import { ReviewPage, ReviewEmptyState, SubjectBadge } from "@/components/review/ReviewUI";
import styles from "@/components/review/review.module.css";
import { getFavorites } from "@/data/favorites";


export default function FavoritesPage(){


  const [favorites,setFavorites] = useState<any[]>([]);



  useEffect(()=>{


    setFavorites(
      getFavorites()
    );


  },[]);




  return <ReviewPage title="收藏題" subtitle="集中查看你想再次複習的重要題目。" count={favorites.length}>
    {favorites.length === 0 ? <ReviewEmptyState favorite /> : <div className={styles.list}>
      {favorites.map((question, index) => <article key={question.id} className={styles.card}>
        <div className={styles.meta}><SubjectBadge subject={question.subject} /><span>已收藏</span></div>
        <h2 className={styles.question}>{index + 1}. {question.question}</h2>
        <div className={styles.options}>{question.options.map((option: string, i: number) => <p key={option} className={styles.option}><span>{String.fromCharCode(65 + i)}.</span>{option}</p>)}</div>
        <div className={styles.explanation}><p>答案：<strong className={styles.correct}>{question.answer}</strong></p><p>解析：{question.explanation}</p></div>
      </article>)}
    </div>}
  </ReviewPage>;
}
