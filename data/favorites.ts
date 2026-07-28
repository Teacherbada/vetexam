export function getFavorites() {

  return JSON.parse(
    localStorage.getItem("favorites") || "[]"
  );

}



export function toggleFavorite(question:any) {


  const favorites = getFavorites();


  const exist =
    favorites.find(
      (item:any)=>item.id === question.id
    );



  let updated;



  if(exist){


    updated =
      favorites.filter(
        (item:any)=>item.id !== question.id
      );


  }else{


    updated = [
      ...favorites,
      question
    ];


  }



  localStorage.setItem(
    "favorites",
    JSON.stringify(updated)
  );



  return updated;

}