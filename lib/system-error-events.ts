export const systemErrorEvents = {
  admin_dashboard_read: { source: "/api/admin/dashboard", method: "GET", label: "讀取管理統計失敗" },
  admin_users_read: { source: "/api/admin/users", method: "GET", label: "讀取會員列表失敗" },
  admin_reports_read: { source: "/api/admin/reports", method: "GET", label: "讀取回報列表失敗" },
  admin_reports_update: { source: "/api/admin/reports", method: "PATCH", label: "更新回報狀態失敗" },
} as const;

export type SystemErrorEvent = keyof typeof systemErrorEvents;
export type SystemErrorKind = "database" | "timeout" | "unexpected";
