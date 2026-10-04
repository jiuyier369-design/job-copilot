<div align="center">

# Job Copilot

### AI 求职决策与简历优化

**有依据的分析 · 可核对的经历 · 用户保留最终判断**

[产品思考](docs/PRODUCT.md) · [技术架构](docs/ARCHITECTURE.md) · [当前进度](docs/STATUS.md) · [个人主页](https://github.com/jiuyier369-design)

</div>

![Job Copilot 概念封面](docs/images/job-copilot-concept-cover.png)

<sub>AI 生成概念封面，仅表达产品主题；不是实际页面截图或已上线能力证明。</sub>

> **持续完善中的工程项目｜已有可审查成果｜尚未正式上线**
> 本仓库用于展示需求取舍、证据约束、Agent 协作开发与工程验收。真实生成按钮仍关闭，完整 v2 流程及报告质量尚未验收。

Job Copilot 从求职中的实际问题出发：背景资料重复提供、JD 要求与经历证据混在一起、分析与投递进度相互分离。目标是保存真实画像，核对岗位要求，产生可追溯的匹配和简历建议，再管理投递行动。

**状态更新：2026-10-04。** 当前公开工程成果用于求职与作品集展示，后续根据求职反馈持续迭代。代码可浏览，本仓库不提供可直接使用的在线求职分析服务。

## 项目介绍

面向求职者的个人 AI 求职决策与管理工具。核心流程为：**建立真实画像 → 拆解并核对 JD → 对照来源与能力边界 → 生成带引用的分析报告 → 跟踪投递行动**。

项目重点是让用户检查“结论来自哪条岗位要求和哪项经历”，区分个人实践、可迁移经验与正式企业经历。自动校验不能证明自由文本真实，最终报告仍需用户审阅。

**给招聘者：** 本项目体现真实问题识别、AI 功能边界设计、Agent 任务拆解与协作、用户试用反馈及验收决策。本人负责产品与流程决策，代码由 AI Agent 辅助实现；详见[个人职责](docs/COLLABORATION.md)。

**快速阅读：** [当前进度](docs/STATUS.md) · [架构](docs/ARCHITECTURE.md) · [产品决策](docs/PRODUCT.md) · [验证与限制](docs/VERIFICATION.md) · [协作过程](docs/COLLABORATION.md) · [公开范围](docs/PUBLICATION.md)

## 产品方向

![经历与岗位要求的证据核对概念](docs/images/job-copilot-evidence-concept.png)

<sub>AI 概念配图，用于解释设计目标；实际实现与验收边界以以下进度表及文档为准。</sub>

## 值得查看的工程设计

- **证据约束：** 分开表达岗位事实、画像证据、模型推断与待核验条件；校验覆盖范围、引用和资历边界。
- **受控生成：** requestId 幂等、版本复核、不可变报告快照；响应不明通过读取状态恢复，不自动再次调用模型。
- **异步执行：** 数据库队列、私有 Worker 和状态查询，处理模型等待及中断场景。
- **访问隔离：** Supabase Auth、RLS、受控写入 RPC；区分本地测试与真实权限验收。
- **产品迭代：** 根据两次用户核对试用调整引导和确认流程；Codex 与 WorkBuddy 在明确任务边界内协作。

## 页面截图

下列截图取自虚构材料的本地展示，不能作为真实用户结果或模型质量通过的证据。

<details>
<summary><strong>查看实际本地页面：证据核对原型</strong></summary>

![证据核对原型](docs/images/evidence-plan.png)

</details>

<details>
<summary><strong>查看实际本地页面：虚构报告展示</strong></summary>

![虚构报告展示](docs/images/report-demo.png)

</details>

<details>
<summary><strong>查看手机端核对页面</strong></summary>

![手机证据核对](docs/images/evidence-plan-mobile.png)

</details>

## 技术栈

Next.js 16 / React 19 / TypeScript 5.9 / Tailwind CSS 4 / Supabase Auth 与 PostgreSQL / pgmq 队列 / Edge Worker / DeepSeek API 服务端适配器。模型密钥留在服务端。

## 当前能力与边界

| 模块 | 开发与验收状态 |
| --- | --- |
| 登录、画像、JD 草稿核对 | 已实现真实 HTTP 流程，并有历史测试环境验收记录 |
| 生成幂等、状态恢复、本人报告读取 | 已实现；固定样例链路及访问边界做过验收 |
| 异步队列、Worker、Cron 唤醒 | 固定样例自动消费曾通过；当前 Cron 停用、真实模型模式关闭 |
| DeepSeek 报告质量 | 做过真实调用；部分输出被校验拒绝，部分被人工拒绝，质量尚未最终通过 |
| 证据计划和完整报告 v2 | 领域逻辑、解析和虚构报告已实现；十份迁移已进入专用测试项目 |
| v2 数据库完整验收 | r8 创建计划通过，但 concurrent-replay 组合断言失败；后续矩阵未执行 |
| 投递记录与 Dashboard | 展示样例；真实 CRUD 和统计闭环尚未完成 |
| 公开生产部署 | 未完成 |

## 验证摘要

公开快照 **281/281 项本地测试通过**，typecheck、build 通过；桌面及 390px 手机展示检查无水平溢出。公开集合使用虚构材料和 mock，经过筛选，不代表原仓库全量测试或生产环境验收。

**当前主要阻塞：** v2 数据库并发重放断言尚未定位，完整事务与权限矩阵、真实生成质量、投递管理闭环和生产部署仍未完成。不使用百分比进度表示产品可用性。

## 本地查看

使用 Node.js 24，建议固定在已验证的 24.21.x：

```bash
npm ci
npm run dev
```

打开 `http://localhost:3000`，可以浏览 `/analyses`、`/jd-review-demo`、`/profile-fields-demo`、`/applications` 和 `/evidence-plan-trial` 的展示内容。它们的展示样例不需要模型 Key；试用页使用内存状态，刷新不代表服务器恢复。

```bash
npm test
npm run typecheck
npm run build
```

公开测试集合只含虚构材料和本地 mock，**不等于原开发仓库的完整测试集合，也不替代真实数据库或模型验收**。远程验收的历史结果见 [VERIFICATION](docs/VERIFICATION.md)。

## 目录

```text
src/app/               页面与现有 v1 API
src/lib/analysis/      模型适配、幂等、队列及 Worker 逻辑
src/lib/report/        v1 结构和证据规则
src/lib/report-v2/     完整 v2 manifest、组装、解析与校验
src/lib/evidence-plan/ 证据核对与计划领域逻辑
src/types/             数据与页面契约
src/fixtures/          公开版虚构样例
supabase/migrations/   十份开发迁移
supabase/functions/    Worker 入口
tests/                 公开的虚构回归集合
docs/                  作品集说明及截图
```

## 人与 Agent 的职责

用户负责场景选择、功能取舍、试用反馈和最终报告质量判断。Codex 负责核心架构、数据与权限、模型和证据规则、复杂调试与集成审查。WorkBuddy 参与边界明确的展示组件和 Mock 页面实现。[贡献说明](AUTHORS.md)

## 后续里程碑

| 顺序 | 后续工作 | 完成条件 |
| --- | --- | --- |
| 1 | 定位 v2 concurrent-replay 失败 | 明确失败断言并完成数据库验收矩阵 |
| 2 | 证据计划持久化与 v2 HTTP / Worker 接线 | 保存、确认、恢复与隔离端到端通过 |
| 3 | 三类 JD 的真实报告评测 | 自动校验与独立用户质量审阅通过 |
| 4 | 投递记录、Dashboard 和生产部署 | 核心求职闭环及部署环境验收通过 |

## 持续完善计划

项目采用阶段性迭代，当前成果用于求职展示。下一阶段首先定位 r8 并发重放的具体失败断言，再完成 v2 数据库矩阵、HTTP/Worker 接线、三类 JD 真实质量验收及生产部署。

这是从开发提交 `7fdac9309767e6360bad996dd596919ae605781f` 整理出的公开快照；私有 Git 历史、真实评测资料及原始审计没有上传。原开发仓库保留用于后续迭代。个人网站在 [portfolio-site](https://github.com/jiuyier369-design/portfolio-site) 独立维护，两者目前仅通过链接关联。

本仓库暂未授予开源许可证；公开展示与授权再利用是两件事。后续由项目所有者决定许可证。
