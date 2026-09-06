"use client";

import { ReviewPage, ReviewEmptyState, SubjectBadge } from "@/components/review/ReviewUI";
import styles from "@/components/review/review.module.css";
import { useEffect, useState } from "react";


export default function WrongPage(){


  const [wrongQuestions,setWrongQuestions] =
    useState<any[]>([]);



  useEffect(()=>{


    const data =
      JSON.parse(
        localStorage.getItem("wrongQuestions") || "[]"
      );


    setWrongQuestions(data);


  },[]);





  function saveNote(
    id:number,
    note:string
  ){


    const updated =
      wrongQuestions.map((question)=>{


        if(question.id === id){

          return {
            ...question,
            note
          };

        }


        return question;


      });



    setWrongQuestions(updated);



    localStorage.setItem(
      "wrongQuestions",
      JSON.stringify(updated)
    );


  }






  function removeWrong(id:number){


    const updated =
      wrongQuestions.filter(
        (question)=>question.id !== id
      );


    setWrongQuestions(updated);



    localStorage.setItem(
      "wrongQuestions",
      JSON.stringify(updated)
    );


  }






  return <ReviewPage title="錯題本" subtitle="整理曾經答錯的題目，重新練習容易出錯的地方。" count={wrongQuestions.length} action={<a href="/wrong-test" className={styles.primary}>開始錯題複習 →</a>}>
    {wrongQuestions.length === 0 ? <ReviewEmptyState /> : <div className={styles.list}>
      {wrongQuestions.map((question, index) => <article key={question.id} className={styles.card}>
        <div className={styles.meta}><SubjectBadge subject={question.subject} /></div>
        <h2 className={styles.question}>{index + 1}. {question.question}</h2>
        <div className={styles.answers}><p>你的答案 <strong className={styles.incorrect}>{question.userAnswer || "未紀錄"}</strong></p><p>正確答案 <strong className={styles.correct}>{question.answer}</strong></p></div>
        <div className={styles.explanation}><p>解析</p><p>{question.explanation}</p></div>
        <label className={styles.note}>我的筆記<textarea defaultValue={question.note || ""} onBlur={(e) => saveNote(question.id, e.target.value)} placeholder="整理自己的理解、記憶技巧、臨床重點..." aria-label={"第 " + (index + 1) + " 題的筆記"} /></label>
        <div className={styles.footer}><button type="button" onClick={() => removeWrong(question.id)} className={styles.secondary} aria-label={"已掌握，移除第 " + (index + 1) + " 題"}>已掌握，移除錯題</button></div>
      </article>)}
    </div>}
  </ReviewPage>;
}
