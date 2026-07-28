export function getTodayProgress() {

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