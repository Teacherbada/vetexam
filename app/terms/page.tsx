import Link from "next/link";
import PolicyPage, { PolicySection } from "@/components/policies/PolicyPage";

const title = "使用條款";
const subtitle = "使用 VetExam 前，請了解服務的基本使用規則。";
export const metadata = { title: `VetExam｜${title}`, description: subtitle };

export default function TermsPage() {
  return <PolicyPage title={title} subtitle={subtitle}>
    <PolicySection title="服務性質"><p>VetExam 為獸醫國家考試相關的線上學習與刷題平台。平台提供題目練習、錯題整理、收藏、學習統計與弱點分析等學習工具。</p></PolicySection>
    <PolicySection title="學習輔助與考試結果"><p>VetExam 所提供的內容與工具主要用於輔助學習。使用 VetExam 並不代表或保證使用者一定能通過任何考試、取得特定成績或資格。</p></PolicySection>
    <PolicySection title="帳號責任"><p>使用者應妥善保管自己的帳號與登入資訊，並對帳號下的合理使用行為負責。</p></PolicySection>
    <PolicySection title="禁止濫用"><p>使用者不得利用 VetExam：</p><ul>{["未經授權大量擷取網站資料", "惡意攻擊網站", "嘗試繞過權限限制", "非法取得 PRO 功能", "操縱推薦獎勵", "建立大量帳號濫用免費試用", "破壞或干擾平台正常運作"].map(item => <li key={item}>{item}</li>)}</ul></PolicySection>
    <PolicySection title="題庫與平台內容"><p>VetExam 的題目整理、解析、排版與平台內容，可能來自公開資料、合法取得之資料、自行整理內容或其他依法可使用之來源。</p></PolicySection>
    <PolicySection title="PRO 使用權"><p>PRO 為一定期間內使用 VetExam 進階功能的服務權限。除另有明確說明外，訂閱並不代表使用者取得 VetExam 程式、題庫資料庫或平台內容的所有權。</p><p>方案、試用與續訂方式請參閱<Link href="/subscription-info">訂閱與付款說明</Link>；取消及退款處理請參閱<Link href="/refund-policy">取消與退款政策</Link>。</p></PolicySection>
    <PolicySection title="服務調整"><p>VetExam 可能依產品發展、維護、安全性或法令需求，調整部分功能、介面或服務內容。</p><p>如涉及重大訂閱權益變更，將盡可能以合理方式通知使用者。</p></PolicySection>
  </PolicyPage>;
}
