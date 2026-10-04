/** Frozen navigation content. These are feature entries, never user activity metrics. */
export const homeEntries = [
  { href: "/login", title: "登录与会话", badge: "测试账号", description: "使用测试账号登录。需先配置测试环境，暂未开放注册。" },
  { href: "/my-profile", title: "我的求职画像", badge: "测试账号", description: "登录后读取和保存画像。开发验收阶段请使用脱敏测试内容。" },
  { href: "/jd-review", title: "JD 核对", badge: "测试账号", description: "粘贴岗位描述，完成免费分段、人工分类和确认。" },
  { href: "/analyses", title: "岗位分析报告", badge: "演示", description: "查看固定报告样例，了解资格判断、证据关联和岗位核验项。" },
  { href: "/applications", title: "投递记录", badge: "演示", description: "查看虚构投递记录的正常、空白与错误状态。" },
] as const;
