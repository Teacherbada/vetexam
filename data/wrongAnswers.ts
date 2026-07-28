export function saveWrongQuestion(
  question:any,
  userAnswer:string
) {


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