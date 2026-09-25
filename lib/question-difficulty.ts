export function questionDifficulty(total: number, correct: number) {
  const rate = total ? correct / total * 100 : null;
  return { total, rate: total >= 10 ? rate : null,
    label: total < 10 || rate === null ? '樣本累積中' : rate >= 80 ? '簡單' : rate >= 60 ? '普通' : rate >= 40 ? '困難' : '魔王題' };
}
