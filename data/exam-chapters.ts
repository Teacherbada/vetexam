// VetExam 固定國考章節。不得從題庫或 AI 產生章節；順序即顯示順序。
// 群組僅供呈現，chapter 儲存章節名稱；未來子章節／topic 可另加欄位。
export type ExamChapterGroup = { label?: string; chapters: readonly string[] };
export const EXAM_CHAPTERS: Record<string, readonly ExamChapterGroup[]> = {
  獸醫病理學: [
    { label: '通論', chapters: [
      '細胞與組織的變性及死亡', '細胞內及細胞外色素及礦物質沈積', '發育異常',
      '循環障礙', '炎症反應、癒合及免疫病理', '腫瘤',
    ] },
    { label: '各論', chapters: [
      '心臟血管系統', '呼吸系統', '消化系統', '泌尿系統', '神經及感官系統',
      '皮膚及皮下', '骨骼肌肉系統', '生殖系統', '內分泌系統', '造血及淋巴系統',
    ] },
  ],
  獸醫藥理學: [{ chapters: [
    '藥理學總論', '中樞神經作用藥', '周邊神經作用藥', '影響循環系統之藥物',
    '影響尿液量或體液酸鹼性之藥物', '影響消化系統之藥物', '影響呼吸系統之藥物',
    '影響自泌素之藥物', '內分泌藥理學', '營養藥理學', '化學療法劑',
    '抗寄生蟲藥物', '獸醫毒理學與藥物殘留',
  ] }],
  獸醫實驗診斷學: [{ chapters: [
    '檢體採集、防腐、輸送及總論', '血液學', '蛋白質、脂質及碳水化合物',
    '肝膽道系統及臨床酵素學', '消化系統', '肌肉系統', '泌尿系統', '內分泌系統',
    '體液、電解質及酸鹼平衡', '臨床細胞學',
  ] }],
  獸醫普通疾病學: [{ chapters: [
    '大動物內、外科（馬、牛、羊、豬）', '小動物內、外科（犬、貓、特殊寵物）',
    '產科與繁殖障礙（大、小動物）',
  ] }],
  獸醫傳染病學: [{ chapters: ['傳染病學'] }],
  獸醫公共衛生學: [{ chapters: [
    '獸醫流行病學', '獸醫公共衛生行政', '畜產品衛生（含乳、肉、蛋、水產品衛生及屠宰衛生）',
    '人畜共通傳染病', '環境衛生（含畜產公害防治）',
  ] }],
};

export const EXAM_SUBJECTS = Object.keys(EXAM_CHAPTERS);
export function chapterGroups(subject: string): readonly ExamChapterGroup[] {
  return Object.hasOwn(EXAM_CHAPTERS, subject) ? EXAM_CHAPTERS[subject] : [];
}
export function validChapter(subject: string, chapter: unknown): boolean {
  return chapter === undefined || chapter === null || chapter === '' ||
    (typeof chapter === 'string' && chapterGroups(subject).some(group => group.chapters.includes(chapter)));
}
