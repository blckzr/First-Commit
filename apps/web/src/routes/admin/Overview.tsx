import { Badge } from "../../components/core/Badge";
import { Card } from "../../components/core/Card";
import { Icon } from "../../components/core/Icon";
import type { IconName } from "../../components/core/Icon";
import { LinkButton } from "../../components/core/LinkButton";
import styles from "./Overview.module.css";

/**
 * design.md §6.1 — the admin overview shows drafts, flagged AI feedback,
 * flagged projects, and struggling modules, each with a link to handle it.
 *
 * Mock data. Every count here will come from the API, and the things it links
 * to are admin-only reads (docs/database-schema.md §6.2).
 */

interface Item {
  title: string;
  meta: string;
}

const DRAFTS: Item[] = [
  { title: "Arrays and objects", meta: "Module · edited 2 days ago" },
  { title: "Components in Vue", meta: "Module · edited 5 days ago" },
];

const FLAGS: Item[] = [
  { title: "Sum of even numbers", meta: "Code feedback · flagged by 2 learners" },
  { title: "Task tracker, milestone 3", meta: "Milestone review · flagged by 1 learner" },
];

const STRUGGLING: Item[] = [
  { title: "Arrays and objects", meta: "41% pass rate · 18 learners" },
  { title: "DOM manipulation", meta: "56% pass rate · 12 learners" },
];

interface PanelProps {
  label: string;
  icon: IconName;
  count: number;
  caption: string;
  href: string;
  action: string;
  items?: Item[];
  wide?: boolean;
}

function Panel({ label, icon, count, caption, href, action, items, wide }: PanelProps) {
  return (
    <Card surface="white" padding="lg" className={wide ? styles.wide : undefined}>
      <span className={styles.panelLabel}>
        <Icon name={icon} size={14} />
        {label}
      </span>
      <strong className={styles.count}>{count}</strong>
      <p className={styles.caption}>{caption}</p>
      {items && (
        <ul className={styles.list}>
          {items.map((item) => (
            <li key={item.title} className={styles.row}>
              <span className={styles.rowTitle}>{item.title}</span>
              <span className={styles.rowMeta}>{item.meta}</span>
            </li>
          ))}
        </ul>
      )}
      <LinkButton to={href} variant="outline" size="sm" icon="arrow-right">
        {action}
      </LinkButton>
    </Card>
  );
}

export function Overview() {
  return (
    <div>
      <h1 className={styles.title}>Overview</h1>
      <p className={styles.lede}>What needs your attention today.</p>

      <div className={styles.grid}>
        <Panel
          label="Drafts"
          icon="wrench"
          count={2}
          caption="Unpublished content."
          href="/admin/modules"
          action="Open modules"
          items={DRAFTS}
          wide
        />
        <Panel
          label="Flagged AI feedback"
          icon="flag"
          count={3}
          caption="Learners reported these as wrong."
          href="/admin/flags"
          action="Review flags"
          items={FLAGS}
          wide
        />
        <Panel
          label="Struggling modules"
          icon="info"
          count={2}
          caption="Pass rates below 60%."
          href="/admin/analytics"
          action="Open analytics"
          items={STRUGGLING}
          wide
        />
        <Panel
          label="Flagged projects"
          icon="check"
          count={1}
          caption="Integrity signals awaiting a decision."
          href="/admin/reviews"
          action="Open reviews"
        />
        <Card surface="soft" padding="lg">
          <span className={styles.panelLabel}>
            <Icon name="award" size={14} />
            Certificates
          </span>
          <strong className={styles.count}>14</strong>
          <p className={styles.caption}>Issued this month, none revoked.</p>
          <Badge tone="verified" icon="check">All valid</Badge>
        </Card>
      </div>
    </div>
  );
}
