import { homeEntries } from "@/fixtures/home-entries";
import { HomeEntryLinks } from "@/components/home/home-entry-links";
import styles from "@/components/home/home-page.module.css";

/**
 * Welcome and navigation entry point.
 *
 * This page is static: it reads no profile, session or application data, shows no
 * counts or activity metrics, and makes no request. The entries below only link to
 * pages that already exist.
 */
export default function Home() {
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.hero}>
          <p className={styles.eyebrow}>JOB COPILOT</p>
          <h1 className={styles.title}>个人求职决策与管理</h1>
          <p className={styles.intro}>
            在一处完成求职决策：记录真实画像，逐条核对岗位要求与已有证据，得到可追溯的分析与简历建议，
            再把投递进度收拢到同一个地方。以下入口对应目前已经存在的页面。
          </p>
        </header>

        <h2 className={styles.sectionTitle}>功能入口</h2>
        <HomeEntryLinks entries={homeEntries} />

        <p className={styles.note}>
          本页只做导航：不显示你的投递数量，也不代表任何分析结论。
        </p>
      </div>
    </main>
  );
}
