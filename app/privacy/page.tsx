import PolicyPage, { PolicySection } from "@/components/policies/PolicyPage";

const title = "隱私權政策";
const subtitle = "了解 VetExam 如何處理與保護使用者資訊。";
export const metadata = { title: `VetExam｜${title}`, description: subtitle };

export default function PrivacyPage() {
  return <PolicyPage title={title} subtitle={subtitle}>
    <PolicySection title="關於本政策"><p>VetExam 重視使用者的隱私與個人資料保護。本政策說明使用者使用 VetExam 時，網站可能蒐集、使用與處理哪些資訊，以及這些資訊的主要用途。</p></PolicySection>
    <PolicySection title="可能蒐集與處理的資訊"><h3>帳號資訊</h3><ul><li>電子郵件地址與使用者名稱</li><li>帳號識別資訊</li><li>登入與帳號狀態</li></ul><h3>學習紀錄</h3><ul><li>答題紀錄與答題結果</li><li>錯題與收藏題</li><li>學習進度</li><li>弱點分析所需的統計資訊</li></ul><p>部分學習紀錄儲存在使用者的瀏覽器中，清除瀏覽器資料或更換裝置可能影響這些紀錄的保留與存取。</p><h3>訂閱資訊</h3><ul><li>方案類型與訂閱狀態</li><li>付款是否成功</li><li>訂閱有效期限</li></ul><h3>客服與維運資訊</h3><p>使用者主動提供的問題回報、聯絡內容，以及為排除錯誤與維護服務所需的系統紀錄。</p></PolicySection>
    <PolicySection title="個人資料用途"><p>蒐集的資訊主要可能用於：</p><ul>{["提供與維護 VetExam 服務", "保存學習進度，提供錯題與收藏功能", "計算學習統計與弱點分析", "管理帳號與訂閱，處理付款狀態", "防止濫用與維護網站安全", "提供客服服務", "改善產品體驗"].map(item => <li key={item}>{item}</li>)}</ul></PolicySection>
    <PolicySection title="付款資訊與第三方服務"><p>付款相關交易可能由第三方金流服務提供者處理。VetExam 不在自身一般資料庫中儲存完整信用卡卡號、信用卡安全碼等不必要的敏感付款資訊。</p><p>VetExam 可能使用第三方服務提供帳號與登入、雲端資料庫、網站託管、金流付款，以及系統監控與維運功能。</p></PolicySection>
    <PolicySection title="Cookie 與瀏覽器儲存"><p>VetExam 可能使用 Cookie 或瀏覽器儲存技術，以維持登入狀態、保存必要設定及提供網站功能。</p></PolicySection>
    <PolicySection title="資料安全"><p>VetExam 會採取合理的技術與管理措施，降低未經授權存取、洩漏、竄改或遺失資料的風險。</p></PolicySection>
    <PolicySection title="隱私問題與聯絡方式"><p>如對隱私權或個人資料處理有疑問，可透過本頁下方的客服信箱或電話聯絡 VetExam。</p></PolicySection>
  </PolicyPage>;
}
