export const POLICY_LINKS = [
  { href: "/subscription-info", title: "訂閱與付款說明" },
  { href: "/refund-policy", title: "取消與退款政策" },
  { href: "/privacy", title: "隱私權政策" },
  { href: "/terms", title: "使用條款" },
] as const;

// Update this editorial date whenever the published policy content changes.
// Do not use the render/build date: it would imply a policy revision on every deployment.
export const POLICY_UPDATED = { iso: "2026-09-07", label: "2026 年 09 月 07 日" };
