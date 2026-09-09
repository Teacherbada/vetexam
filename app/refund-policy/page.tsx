import PolicyPage, { PolicySection } from "@/components/policies/PolicyPage";

const title = "取消與退款政策";
const subtitle = "了解如何取消 VetExam PRO，以及付款後的退款處理方式。";
export const metadata = { title: `VetExam｜${title}`, description: subtitle };

export default function RefundPolicyPage() {
  return <PolicyPage title={title} subtitle={subtitle}>
    <PolicySection title="取消自動續訂"><p>使用者可以在下一個計費週期開始前取消 VetExam PRO 自動續訂。完成取消後，VetExam 將不再於下一個計費週期收取新的訂閱費用。</p><p>正式取消方式將依網站當時提供的訂閱管理功能辦理。如需協助，也可以聯絡 VetExam 客服。</p><p>目前已取得的 PRO 使用權，原則上仍可使用至目前有效期間結束。</p></PolicySection>
    <PolicySection title="免費體驗到期"><p>新會員註冊即享 30 天 PRO 免費體驗，無需綁卡或取消。體驗結束後回到 Free，不會自動扣款；如需繼續使用 PRO，請自行選擇方案並完成付款。</p></PolicySection>
    <PolicySection title="付款後的退款處理"><p>已完成扣款之訂閱，如有退款需求，將依實際交易情形、服務使用狀況、適用法律及 VetExam 當時公告之退款規則進行處理。</p><p>如發生重複扣款、異常扣款、系統錯誤或其他特殊情形，請聯絡 VetExam 客服協助確認。</p><p><strong>本政策不影響消費者依中華民國相關法令依法享有之權利。</strong></p></PolicySection>
    <PolicySection title="聯絡客服"><p>如需取消或退款協助，請透過本頁下方的客服信箱或電話聯絡 VetExam。我們將協助確認實際交易情形與後續處理方式。</p></PolicySection>
  </PolicyPage>;
}
