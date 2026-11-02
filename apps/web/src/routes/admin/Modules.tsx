import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { Badge } from "../../components/core/Badge";
import { Card } from "../../components/core/Card";
import { adminModulesApi, adminModulesKey } from "../../api/adminModules";
import { ApiError } from "../../api/client";
import styles from "./Modules.module.css";

/**
 * design.md §6.3's entry point: every module, and where its content stands.
 *
 * **The platform's premise is admin-defined content**, and until this existed
 * that meant editing `supabase/seed/` and re-running a script. This is the first
 * screen that makes "an admin defined it" literally true.
 *
 * Each row answers one question: is there a draft in progress, and what are
 * learners reading right now. §6.3's header asks exactly that — "Version 3
 * (draft) · Published: version 2" — because those are different things and a
 * module can have both.
 */

const KIND_LABEL: Record<string, string> = {
  core: "Core",
  concept: "Concept",
  technology: "Technology",
  reinforcement: "Extra practice",
  challenge: "Challenge",
};

export function Modules() {
  const [search, setSearch] = useState("");

  const { data, isPending, error } = useQuery({
    queryKey: adminModulesKey(search),
    queryFn: ({ signal }) => adminModulesApi.list(search, signal),
  });

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Modules</h1>
        <p className={styles.lede}>
          What learners read. A draft is yours until you publish it; what is published is what
          they see.
        </p>
      </header>

      <div className={styles.search}>
        <label className={styles.label} htmlFor="module-search">
          Search by title or slug
        </label>
        <input
          id="module-search"
          type="search"
          className={styles.input}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Components, js-basics…"
        />
      </div>

      {isPending ? (
        <p role="status" aria-live="polite" className={styles.hint}>
          Loading modules…
        </p>
      ) : error || !data ? (
        <p role="alert" className={styles.error}>
          {error instanceof ApiError ? error.message : "That did not load. Try again in a moment."}
        </p>
      ) : data.modules.length === 0 ? (
        <Card className={styles.empty}>
          <p className={styles.emptyText}>
            {search ? "Nothing matches that search." : "No modules yet."}
          </p>
        </Card>
      ) : (
        <ul className={styles.list}>
          {data.modules.map((module) => (
            <li key={module.id}>
              <Card className={styles.row}>
                <div className={styles.rowText}>
                  <h2 className={styles.name}>
                    <Link to={`/admin/modules/${module.id}`} className={styles.link}>
                      {module.published?.title ?? module.draft?.title ?? module.slug}
                    </Link>
                  </h2>
                  <p className={styles.meta}>
                    <code className={styles.code}>{module.slug}</code>{" "}
                    <span className={styles.muted}>
                      {KIND_LABEL[module.kind] ?? module.kind}
                      {module.technologyName ? ` · ${module.technologyName}` : ""} ·{" "}
                      {module.skillName}
                    </span>
                  </p>
                </div>

                {/* §8: a status is text as well as colour. */}
                <div className={styles.rowSide}>
                  {module.published ? (
                    <Badge tone="verified">Published v{module.published.versionNo}</Badge>
                  ) : (
                    <Badge tone="neutral">Never published</Badge>
                  )}
                  {module.draft && <Badge tone="notice">Draft v{module.draft.versionNo}</Badge>}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
