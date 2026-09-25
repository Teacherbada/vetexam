import { getLearning, learningOwner } from '../lib/learning-client';
export function getTodayProgress() {
  if (learningOwner()) {
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' });
    const today = date.format(new Date());
    return { completed: getLearning()?.history.filter(row => date.format(new Date(row.answered_at)) === today).length ?? 0 };
  }

  const data =
    JSON.parse(
      localStorage.getItem("dailyProgress") || "{}"
    );


  const today =
    new Date().toISOString().split("T")[0];


  if (!data[today]) {

    data[today] = {
      completed: 0,
    };

    localStorage.setItem(
      "dailyProgress",
      JSON.stringify(data)
    );

  }


  return data[today];

}




export function addDailyProgress() {
  if (learningOwner()) return;



  const data =
    JSON.parse(
      localStorage.getItem("dailyProgress") || "{}"
    );


  const today =
    new Date().toISOString().split("T")[0];


  if (!data[today]) {

    data[today] = {
      completed: 0,
    };

  }



  data[today].completed += 1;



  localStorage.setItem(
    "dailyProgress",
    JSON.stringify(data)
  );


}
