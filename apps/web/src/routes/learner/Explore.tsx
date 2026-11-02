import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "../../components/core/Badge";
import { Button } from "../../components/core/Button";
import { Card } from "../../components/core/Card";
import { Select } from "../../components/forms/Select";
import { SearchField } from "../../components/forms/SearchField";
import { ApiError } from "../../api/client";
import { exploreApi, exploreFiltersKey, exploreKey, type ExploreModule } from "../../api/explore";
import { roadmapsApi } from "../../api/roadmaps";
import styles from "./Explore.module.css";

/**
 * design.md §5.13 — Explore modules.
 *
 * "Find and take any published module, including ones outside the roadmap."
 *
 * **The filters live in the URL**, not in component state. §8 requires state to
 * survive a breakpoint change, and a filtered catalogue is the one screen here
 * a learner would want to send to themselves or come back to. It also means
 * the back button does what it looks like it does.
 *
 * **A locked module is still offered.** §5.13 says any published module, and
 * §5.9's module page is where the lock is enforced — so the row says what to
 * pass first (§9: "Pass JavaScript basics to unlock this module.") and lets the
 * learner plan it anyway. Hiding it would mean a learner cannot see what is
 * ahead of them.
 */
export function Explore() {
  const [params, setParams] = useSearchParams();

  const query = {
    q: params.get("q") ?? "",
    skillId: params.get("skillId") ?? "",
    technologyId: params.get("technologyId") ?? "",
    careerPathId: params.get("careerPathId") ?? "",
    status: params.get("status") ?? "",
    page: Number(params.get("page") ?? 1) || 1,
  };

  /** Writes one filter and resets the page — page 4 of a new filter is nothing. */
  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page");
    setParams(next, { replace: true });
  }

  function setPage(page: number) {
    const next = new URLSearchParams(params);
    if (page > 1) next.set("page", String(page));
    else next.delete("page");
    setParams(next, { replace: true });
  }

  const filters = useQuery({
    queryKey: exploreFiltersKey,
    queryFn: ({ signal }) => exploreApi.filters(signal),
  });

  const page = useQuery({
    queryKey: exploreKey(query),
    queryFn: ({ signal }) => exploreApi.list(query, signal),
  });

  /** Only active roadmaps can take a module, so only those are offered. */
  const roadmaps = useQuery({
    queryKey: ["roadmaps"],
    queryFn: ({ signal }) => roadmapsApi.list(signal),
  });
  const active = (roadmaps.data ?? []).filter((r) => r.status === "active");

  const anyFilter =
    query.q !== "" ||
    query.skillId !== "" ||
    query.technologyId !== "" ||
    query.careerPathId !== "" ||
    query.status !== "";

  const options = (list: { id: string; name: string }[], all: string) => [
    { value: "", label: all },
    ...list.map((item) => ({ value: item.id, label: item.name })),
  ];

  return (
    <div className={styles.page}>
      <Card surface="white" radius="panel" padding="lg" className={styles.header}>
        <h1 className={styles.title}>Explore modules</h1>
        <p className={styles.lede}>
          Everything published, including modules that are not on your roadmap. Passing one counts
          wherever it appears.
        </p>
      </Card>

      <Card surface="white" radius="panel" padding="lg" className={styles.controls}>
        <SearchField
          label="Search modules"
          placeholder="Search modules"
          defaultValue={query.q}
          className={styles.search}
          onChange={(event) => setFilter("q", event.target.value)}
        />

        <div className={styles.filters}>
          <Select
            label="Skill area"
            value={query.skillId}
            options={options(filters.data?.skills ?? [], "All skills")}
            onChange={(event) => setFilter("skillId", event.target.value)}
          />
          <Select
            label="Technology"
            value={query.technologyId}
            options={options(filters.data?.technologies ?? [], "Any technology")}
            onChange={(event) => setFilter("technologyId", event.target.value)}
          />
          <Select
            label="Career path"
            value={query.careerPathId}
            options={options(filters.data?.careerPaths ?? [], "All paths")}
            onChange={(event) => setFilter("careerPathId", event.target.value)}
          />
          <Select
            label="Status"
            value={query.status}
            options={[
              { value: "", label: "Any status" },
              { value: "not_started", label: "Not started" },
              { value: "in_progress", label: "In progress" },
              { value: "passed", label: "Passed" },
            ]}
            onChange={(event) => setFilter("status", event.target.value)}
          />
        </div>

        {anyFilter && (
          <Button variant="ghost" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
            Clear filters
          </Button>
        )}
      </Card>

      {page.isPending ? (
        <p role="status" aria-live="polite" className={styles.loading}>
          Loading modules…
        </p>
      ) : page.error || !page.data ? (
        <Card surface="white" radius="panel" padding="lg">
          <h2 className={styles.emptyTitle}>The catalogue isn&apos;t available right now</h2>
          <p className={styles.lede}>
            {page.error instanceof ApiError
              ? page.error.message
              : "This is usually temporary. Try again in a moment."}
          </p>
        </Card>
      ) : page.data.modules.length === 0 ? (
        <Card surface="white" radius="panel" padding="lg" className={styles.empty}>
          {/* §9: an empty state says what to do, not that there is nothing. */}
          <h2 className={styles.emptyTitle}>
            {anyFilter
              ? "No modules match those filters."
              : "There are no published modules yet."}
          </h2>
          {anyFilter && (
            <Button
              variant="secondary"
              onClick={() => setParams(new URLSearchParams(), { replace: true })}
            >
              Clear filters
            </Button>
          )}
        </Card>
      ) : (
        <>
          {/*
            The count is announced, because changing a filter changes the list
            without moving focus — a screen reader user would otherwise have no
            signal that anything happened.
          */}
          <p role="status" aria-live="polite" className={styles.count}>
            {page.data.total} {page.data.total === 1 ? "module" : "modules"}
            {anyFilter ? " match your filters" : ""}
          </p>

          <ul className={styles.list}>
            {page.data.modules.map((module) => (
              <li key={module.id}>
                <ModuleRow module={module} roadmaps={active} />
              </li>
            ))}
          </ul>

          <Paging
            page={page.data.page}
            total={page.data.total}
            pageSize={page.data.pageSize}
            onPage={setPage}
          />
        </>
      )}
    </div>
  );
}

/** §8: a status is icon and text and colour, never colour alone. */
function Status({ module }: { module: ExploreModule }) {
  if (module.progress === "passed") {
    return (
      <Badge tone="verified" icon="check">
        {module.method === "tested_out" ? "Tested out" : "Passed"}
        {module.score !== null ? `, ${module.score}%` : ""}
      </Badge>
    );
  }

  if (module.progress === "in_progress") {
    return (
      <Badge tone="here" icon="circle-dot">
        In progress
      </Badge>
    );
  }

  if (module.locked.length > 0) {
    /*
      §9's own example: "Pass JavaScript basics to unlock this module." The
      badge names the first one and the row's text lists the rest, so the badge
      stays short without hiding anything.
    */
    return (
      <Badge tone="notice" icon="lock">
        Needs {module.locked[0]}
      </Badge>
    );
  }

  return (
    <Badge tone="neutral" icon="circle">
      Not started
    </Badge>
  );
}

function ModuleRow({
  module,
  roadmaps,
}: {
  module: ExploreModule;
  roadmaps: { id: string; careerPathTitle: string; trackTitle: string | null }[];
}) {
  const client = useQueryClient();
  const [result, setResult] = useState<string | null>(null);

  const add = useMutation({
    mutationFn: (roadmapId: string) => exploreApi.addToRoadmap(roadmapId, module.id),
    onSuccess: async (answer) => {
      setResult(
        answer.added
          ? `Added ${answer.title} to your roadmap.`
          : `${answer.title} is already on that roadmap.`,
      );
      await client.invalidateQueries({ queryKey: ["explore"] });
      await client.invalidateQueries({ queryKey: ["roadmaps"] });
    },
  });

  return (
    <Card surface="white" className={styles.row}>
      <div className={styles.rowMain}>
        <div className={styles.rowHead}>
          <h3 className={styles.rowTitle}>
            <Link to={`/app/module/${module.id}`} className={styles.rowLink}>
              {module.title}
            </Link>
          </h3>
          <Status module={module} />
        </div>

        {module.description && <p className={styles.rowText}>{module.description}</p>}

        <div className={styles.meta}>
          {/*
            `Badge`, not `Tag`: Tag is a filter chip and renders a <button>, so
            using it to label a skill would put a control on the page that does
            nothing. §5.13 asks for a badge here, and a badge is what this is.
          */}
          <Badge tone="neutral">{module.skill.name}</Badge>
          {module.technology && <Badge tone="violet">{module.technology.name}</Badge>}
          <span className={styles.hours}>
            {module.estimatedHours} {module.estimatedHours === 1 ? "hour" : "hours"}
          </span>
          {/* §2.1's "Also in: Data". */}
          {module.paths.length > 0 && (
            <span className={styles.paths}>Also in: {module.paths.join(", ")}</span>
          )}
        </div>

        {module.locked.length > 1 && (
          <p className={styles.locked}>
            Pass {module.locked.join(" and ")} to unlock this module.
          </p>
        )}
      </div>

      <div className={styles.rowActions}>
        {module.onRoadmap ? (
          <span className={styles.onRoadmap}>
            <Badge tone="lime" icon="check">
              On your roadmap
            </Badge>
          </span>
        ) : roadmaps.length === 0 ? null : roadmaps.length === 1 ? (
          <Button
            variant="outline"
            icon="plus"
            disabled={add.isPending}
            onClick={() => add.mutate(roadmaps[0].id)}
          >
            {add.isPending ? "Adding…" : "Add to roadmap"}
          </Button>
        ) : (
          /*
            §5.12 draws two active roadmaps, so "your roadmap" is not always a
            single thing. With more than one the learner picks, rather than the
            screen quietly choosing the newest — which is open question 16's
            complaint about Home and Capstone, and not worth repeating here.
          */
          <Select
            label={`Add ${module.title} to`}
            className={styles.pick}
            value=""
            disabled={add.isPending}
            options={[
              { value: "", label: "Add to roadmap…" },
              ...roadmaps.map((roadmap) => ({
                value: roadmap.id,
                label: roadmap.trackTitle
                  ? `${roadmap.careerPathTitle} · ${roadmap.trackTitle}`
                  : roadmap.careerPathTitle,
              })),
            ]}
            onChange={(event) => {
              if (event.target.value) add.mutate(event.target.value);
            }}
          />
        )}

        {result && (
          <p role="status" aria-live="polite" className={styles.added}>
            {result}
          </p>
        )}
        {add.error && (
          <p role="alert" className={styles.error}>
            {add.error instanceof ApiError
              ? add.error.message
              : "That didn't get added. Try again in a moment."}
          </p>
        )}
      </div>
    </Card>
  );
}

function Paging({
  page,
  total,
  pageSize,
  onPage,
}: {
  page: number;
  total: number;
  pageSize: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;

  return (
    <nav className={styles.paging} aria-label="Pages of modules">
      <Button variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </Button>
      <span className={styles.pageOf}>
        Page {page} of {pages}
      </span>
      <Button variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Next
      </Button>
    </nav>
  );
}
