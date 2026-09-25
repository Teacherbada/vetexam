import { learningOwner } from '../lib/learning-client';
export function saveWrongQuestion(
  question:any,
  userAnswer:string
) {
  if (learningOwner()) return;



  const oldWrong =
    JSON.parse(
      localStorage.getItem("wrongQuestions") || "[]"
    );



  const exists = oldWrong.find(
    (item:any)=>item.id === question.id
  );



  if (!exists) {


    oldWrong.push({

      ...question,

      userAnswer:userAnswer,

      note:""

    });


  }



  localStorage.setItem(
    "wrongQuestions",
    JSON.stringify(oldWrong)
  );


}