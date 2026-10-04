import Link from "next/link";
import { homeEntries } from "@/fixtures/home-entries";
import styles from "./home-entry-links.module.css";

/**
 * Navigation entry cards.
 *
 * `HomeEntry` is derived from the frozen fixture so the entries keep a single
 * source of truth; no shared type is modified. The element type is used rather
 * than the tuple type so an empty array stays assignable for the empty state.
 */
export type HomeEntry = (typeof homeEntries)[number];

/**
 * Badge tone follows the frozen badge wording. Anything unfamiliar still renders
 * with the base badge style, so a future entry cannot end up unstyled.
 */
function badgeClass(badge: string) {
  if (badge === "演示") return `${styles.badge} ${styles.badgeDemo}`;
  if (badge === "测试账号") return `${styles.badge} ${styles.badgeTest}`;
  return styles.badge;
}

export function HomeEntryLinks({ entries }: { entries: readonly HomeEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className={styles.empty}>
        <h3 className={styles.emptyTitle}>暂无可用入口</h3>
        <p className={styles.emptyText}>当前没有可展示的功能入口，请稍后再试。</p>
      </div>
    );
  }

  return (
    <ul className={styles.list}>
      {entries.map((entry) => (
        <li key={entry.href} className={styles.item}>
          {/* The whole card is the target so the hit area matches what looks clickable. */}
          <Link href={entry.href} className={styles.card}>
            <span className={badgeClass(entry.badge)}>{entry.badge}</span>
            <h3 className={styles.cardTitle}>{entry.title}</h3>
            <p className={styles.cardDescription}>{entry.description}</p>
            <span className={styles.arrow} aria-hidden="true">
              →
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
