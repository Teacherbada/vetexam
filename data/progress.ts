export function saveProgress(
  questionId:number,
  correct:boolean,
  subject:string
) {


  const oldData =
    JSON.parse(
      localStorage.getItem("progress") || "{}"
    );



  if (!oldData[subject]) {

    oldData[subject] = {

      answered: [],
      correct: 0,
      wrong: 0

    };

  }




  if (
    !oldData[subject].answered.includes(questionId)
  ) {


    oldData[subject].answered.push(questionId);



    if(correct){

      oldData[subject].correct += 1;

    }else{

      oldData[subject].wrong += 1;

    }


  }




  localStorage.setItem(
    "progress",
    JSON.stringify(oldData)
  );


}