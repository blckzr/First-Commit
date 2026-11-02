import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "../../components/core/Card";
import { adminAnalyticsApi, adminAnalyticsKeys } from "../../api/adminAnalytics";
import { ApiError } from "../../api/client";
import styles from "./Analytics.module.css";

/**
 * design.md §6.9 — Analytics.
 *
 * **"Show where learners succeed and where they get stuck"**, which makes every
 * number here one an admin is meant to act on. Three things follow, and they
 * are what this screen is actually about:
 *
 * 1. **A missing rate is shown as missing.** The API returns `null` rather than
 *    `0` below its threshold, because one learner is not a trend — and "0%
 *    passed" at the top of a page would send an author to rewrite a module that
 *    two people have tried. `rate()` prints "too few to say" and the counts.
 * 2. **An unanswerable question says so.** §6.9 asks for "switches between
 *    options", and a technology choice is stored once per roadmap and decision
 *    — switching overwrites the previous answer and leaves nothing behind. The
 *    screen prints that sentence instead of a zero.
 * 3. **The bars are CSS over real markup, not a canvas.** The same decision the
 *    roadmap chart reached (§12, and AGENT.md's note on React Flow): a figure
 *    an admin has to read exactly is a table, and a bar is a width on a row
 *    they can already read. Nothing here is behind an `aria-hidden` copy.
 */

/** A rate as a percentage, or the honest absence of one. */
function rate(value: number | null): string {
  return value === null ? "too few to say" : `${Math.round(value * 100)}%`;
}

const MONTH = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric" });

const SOURCES: Record<string, string> = {
  code_feedback: "Code feedback",
  milestone_review: "Milestone review",
  roadmap_generation: "Roadmap generation",
  resume_generation: "Resume generation",
  technology_recommendation: "Technology recommendation",
  roadmap_adaptation: "Roadmap adaptation",
};

export function Analytics() {
  return (
    <div className={styles.page}>
      <header>
        <h1 className={styles.title}>Analytics</h1>
        <p className={styles.lede}>
          Where learners succeed and where they get stuck. Every figure is counted per learner, and
          a rate is withheld rather than guessed where too few people have tried.
        </p>
      </header>

      <JourneyFunnel />
      <Modules />
      <Milestones />
      <TechnologyChoices />
      <AiQuality />
      <Certificates />
    </div>
  );
}

/**
 * §6.9's journey funnel.
 *
 * **Each stage counts the learners who *reached* it**, so a stage never shrinks
 * because somebody moved past it. The drop between neighbours is shown as a
 * figure rather than only as a bar, because "47 of 112" is what an admin needs
 * and "a shorter bar" is not.
 */
function JourneyFunnel() {
  const paths = useQuery({
    queryKey: adminAnalyticsKeys.paths,
    queryFn: ({ signal }) => adminAnalyticsApi.paths(signal),
  });
  const [pathId, setPathId] = useState<string>();
  const selected = pathId ?? paths.data?.paths[0]?.id;

  const funnel = useQuery({
    queryKey: adminAnalyticsKeys.funnel(selected ?? ""),
    queryFn: ({ signal }) => adminAnalyticsApi.funnel(selected!, signal),
    enabled: Boolean(selected),
  });

  const top = funnel.data?.stages[0]?.learners ?? 0;

  return (
    <section>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>Journey funnel</h2>
        {paths.data && paths.data.paths.length > 0 && (
          <div className={styles.field}>
            <label className={styles.label} htmlFor="funnel-path">
              Career path
            </label>
            <select
              id="funnel-path"
              className={styles.select}
              value={selected ?? ""}
              onChange={(event) => setPathId(event.target.value)}
            >
              {paths.data.paths.map((path) => (
                <option key={path.id} value={path.id}>
                  {path.title}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {paths.isPending ? (
        <p role="status" aria-live="polite" className={styles.hint}>
          Loading career paths…
        </p>
      ) : paths.data?.paths.length === 0 ? (
        <Card className={styles.empty}>
          <p className={styles.hint}>
            No career path is published yet, so there is no journey to measure.
          </p>
        </Card>
      ) : funnel.isPending ? (
        <p role="status" aria-live="polite" className={styles.hint}>
          Counting the funnel…
        </p>
      ) : funnel.error || !funnel.data ? (
        <p role="alert" className={styles.error}>
          {funnel.error instanceof ApiError
            ? funnel.error.message
            : "The funnel did not load. Try again in a moment."}
        </p>
      ) : (
        <Card className={styles.panel}>
          <ol className={styles.funnel}>
            {funnel.data.stages.map((stage, index) => {
              const previous = funnel.data.stages[index - 1];
              return (
                <li key={stage.key} className={styles.stage}>
                  <div className={styles.stageHead}>
                    <span className={styles.stageLabel}>{stage.label}</span>
                    <span className={styles.stageCount}>{stage.learners}</span>
                  </div>
                  {/*
                    The bar is a presentational width beside a number that is
                    already in the DOM, so there is nothing here a screen
                    reader cannot reach — which is why it needs no ARIA at all.
                  */}
                  <div className={styles.bar} aria-hidden="true">
                    <div
                      className={styles.barFill}
                      style={{ width: `${top === 0 ? 0 : (stage.learners / top) * 100}%` }}
                    />
                  </div>
                  {previous && (
                    <p className={styles.stageDrop}>
                      {previous.learners === 0
                        ? "Nobody reached the stage before this one."
                        : `${previous.learners - stage.learners} of ${previous.learners} stopped here.`}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
          <p className={styles.hint}>
            Finishing core means passing all {funnel.data.requiredCoreModules} modules this path
            requires for its certificate. A learner stays counted in every stage they reached.
          </p>
        </Card>
      )}
    </section>
  );
}

/**
 * §6.9's modules view.
 *
 * **Pass rate and drop-off are different questions, side by side.** Pass rate
 * is of the learners who attempted an assessment; drop-off is of the learners
 * who started the module and never finished. A module can look fine on one and
 * terrible on the other, which is the case an author most needs to see: the
 * people it defeated never reached the quiz.
 */
function Modules() {
  const [technology, setTechnology] = useState("");
  const [sort, setSort] = useState<"started" | "passRate" | "dropOffRate">("started");

  const { data, isPending, error } = useQuery({
    queryKey: adminAnalyticsKeys.modules(technology),
    queryFn: ({ signal }) => adminAnalyticsApi.modules(technology, signal),
  });

  /**
   * Sorting puts rows with no rate last whichever direction is chosen. They are
   * not "0%", so ranking them as if they were would put the module two people
   * tried above the one fifteen are stuck on.
   */
  const rows = [...(data?.modules ?? [])].sort((a, b) => {
    if (sort === "started") return b.started - a.started;
    const key = sort;
    const left = a[key];
    const right = b[key];
    if (left === null && right === null) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    return sort === "passRate" ? left - right : right - left;
  });

  return (
    <section>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>Modules</h2>
        <div className={styles.filters}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="modules-technology">
              Technology
            </label>
            <select
              id="modules-technology"
              className={styles.select}
              value={technology}
              onChange={(event) => setTechnology(event.target.value)}
            >
              <option value="">All modules</option>
              {(data?.technologies ?? []).map((tech) => (
                <option key={tech.id} value={tech.id}>
                  {tech.name}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="modules-sort">
              Sort by
            </label>
            <select
              id="modules-sort"
              className={styles.select}
              value={sort}
              onChange={(event) => setSort(event.target.value as typeof sort)}
            >
              <option value="started">Most started</option>
              <option value="passRate">Lowest pass rate</option>
              <option value="dropOffRate">Highest drop-off</option>
            </select>
          </div>
        </div>
      </div>

      {isPending ? (
        <p role="status" aria-live="polite" className={styles.hint}>
          Counting modules…
        </p>
      ) : error ? (
        <p role="alert" className={styles.error}>
          {error instanceof ApiError
            ? error.message
            : "Module figures did not load. Try again in a moment."}
        </p>
      ) : rows.length === 0 ? (
        <Card className={styles.empty}>
          <p className={styles.hint}>No module matches that filter.</p>
        </Card>
      ) : (
        <div className={styles.tableWrap} role="region" aria-label="Modules" tabIndex={0}>
          <table className={styles.table}>
            <caption className={styles.caption}>
              A rate is withheld below {data.enoughLearners} learners, because one attempt is not
              a trend.
            </caption>
            <thead>
              <tr>
                <th scope="col">Module</th>
                <th scope="col">Attempted</th>
                <th scope="col">Pass rate</th>
                <th scope="col">Started</th>
                <th scope="col">Drop-off</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((module) => (
                <tr key={module.id}>
                  <th scope="row" className={styles.rowHeader}>
                    {module.title}
                    {module.technology && (
                      <span className={styles.rowMeta}> · {module.technology}</span>
                    )}
                  </th>
                  <td className={styles.num}>
                    {module.passed} of {module.attempted}
                  </td>
                  <td className={module.passRate === null ? styles.unknown : styles.num}>
                    {rate(module.passRate)}
                  </td>
                  <td className={styles.num}>{module.started}</td>
                  <td className={module.dropOffRate === null ? styles.unknown : styles.num}>
                    {rate(module.dropOffRate)}
                    {module.dropOffRate !== null && (
                      <span className={styles.rowMeta}> ({module.droppedOff})</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** §6.9: "Where learners stop progressing in each brief." */
function Milestones() {
  const { data, isPending, error } = useQuery({
    queryKey: adminAnalyticsKeys.milestones,
    queryFn: ({ signal }) => adminAnalyticsApi.milestones(signal),
  });

  return (
    <section>
      <h2 className={styles.sectionTitle}>Milestones</h2>

      {isPending ? (
        <p role="status" aria-live="polite" className={styles.hint}>
          Counting milestones…
        </p>
      ) : error ? (
        <p role="alert" className={styles.error}>
          {error instanceof ApiError
            ? error.message
            : "Milestone figures did not load. Try again in a moment."}
        </p>
      ) : data.milestones.length === 0 ? (
        <Card className={styles.empty}>
          <p className={styles.hint}>No capstone brief has milestones yet.</p>
        </Card>
      ) : (
        <div className={styles.tableWrap} role="region" aria-label="Milestones" tabIndex={0}>
          <table className={styles.table}>
            <caption className={styles.caption}>
              Only projects that reached a milestone count against it — a project that has not got
              there is not stuck on it.
            </caption>
            <thead>
              <tr>
                <th scope="col">Milestone</th>
                <th scope="col">Brief</th>
                <th scope="col">Reached</th>
                <th scope="col">Finished</th>
                <th scope="col">Stuck</th>
                <th scope="col">Failed attempts</th>
              </tr>
            </thead>
            <tbody>
              {data.milestones.map((milestone) => (
                <tr key={milestone.id}>
                  <th scope="row" className={styles.rowHeader}>
                    {milestone.title}
                  </th>
                  <td>{milestone.briefTitle}</td>
                  <td className={styles.num}>{milestone.attempted}</td>
                  <td className={styles.num}>{milestone.complete}</td>
                  <td className={milestone.stuckRate === null ? styles.unknown : styles.num}>
                    {rate(milestone.stuckRate)}
                    {milestone.stuckRate !== null && (
                      <span className={styles.rowMeta}> ({milestone.stuck})</span>
                    )}
                  </td>
                  <td className={styles.num}>{milestone.failedAttempts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** §6.9's technology choices, and the half of it the schema cannot answer. */
function TechnologyChoices() {
  const { data, isPending, error } = useQuery({
    queryKey: adminAnalyticsKeys.technologies,
    queryFn: ({ signal }) => adminAnalyticsApi.technologies(signal),
  });

  return (
    <section>
      <h2 className={styles.sectionTitle}>Technology choices</h2>

      {isPending ? (
        <p role="status" aria-live="polite" className={styles.hint}>
          Counting choices…
        </p>
      ) : error ? (
        <p role="alert" className={styles.error}>
          {error instanceof ApiError
            ? error.message
            : "Technology figures did not load. Try again in a moment."}
        </p>
      ) : (
        <>
          {data.decisions.length === 0 ? (
            <Card className={styles.empty}>
              <p className={styles.hint}>No learner has reached a technology choice yet.</p>
            </Card>
          ) : (
            <ul className={styles.decisionList}>
              {data.decisions.map((decision) => {
                const total =
                  decision.options.reduce((sum, option) => sum + option.learners, 0) +
                  decision.undecided;
                return (
                  <li key={decision.id}>
                    <Card className={styles.panel}>
                      <h3 className={styles.panelTitle}>
                        {decision.title}
                        <span className={styles.rowMeta}> · {decision.trackTitle} track</span>
                      </h3>
                      <ul className={styles.shareList}>
                        {decision.options.map((option) => (
                          <li key={option.technology} className={styles.share}>
                            <div className={styles.stageHead}>
                              <span className={styles.stageLabel}>{option.technology}</span>
                              <span className={styles.stageCount}>
                                {option.learners}
                                {total > 0 && (
                                  <span className={styles.rowMeta}>
                                    {` (${Math.round((option.learners / total) * 100)}%)`}
                                  </span>
                                )}
                              </span>
                            </div>
                            <div className={styles.bar} aria-hidden="true">
                              <div
                                className={styles.barFill}
                                style={{
                                  width: `${total === 0 ? 0 : (option.learners / total) * 100}%`,
                                }}
                              />
                            </div>
                            <p className={styles.stageDrop}>
                              {option.recommendedTo === option.learners
                                ? "Every learner who chose this was recommended it."
                                : `${option.recommendedTo} of these were recommended it.`}
                            </p>
                          </li>
                        ))}
                      </ul>
                      {decision.undecided > 0 && (
                        <p className={styles.hint}>
                          {decision.undecided}{" "}
                          {decision.undecided === 1 ? "learner has" : "learners have"} reached this
                          decision and not answered it.
                        </p>
                      )}
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}

          {/*
            §6.9 asks for switches between options. The schema cannot answer it,
            and "0 switches" would read as "nobody switches" — a claim this
            platform cannot make. Say which it is.
          */}
          {!data.switchesRecorded && (
            <Card className={styles.notBuilt}>
              <h3 className={styles.notBuiltTitle}>Switches are not recorded</h3>
              <p className={styles.hint}>{data.switchesReason}</p>
            </Card>
          )}
        </>
      )}
    </section>
  );
}

/**
 * §6.9's AI quality.
 *
 * **Flag rate is against the output that could be flagged**, and **the share
 * ruled wrong is of the flags an admin has actually ruled on.** An open flag is
 * a question nobody has answered; counting it as "not wrong" would make the
 * model look better the further behind an admin fell.
 */
function AiQuality() {
  const { data, isPending, error } = useQuery({
    queryKey: adminAnalyticsKeys.ai,
    queryFn: ({ signal }) => adminAnalyticsApi.ai(signal),
  });

  return (
    <section>
      <h2 className={styles.sectionTitle}>AI quality</h2>

      {isPending ? (
        <p role="status" aria-live="polite" className={styles.hint}>
          Counting flags…
        </p>
      ) : error ? (
        <p role="alert" className={styles.error}>
          {error instanceof ApiError
            ? error.message
            : "AI figures did not load. Try again in a moment."}
        </p>
      ) : data.sources.length === 0 ? (
        <Card className={styles.empty}>
          <p className={styles.hint}>The model has not produced anything yet.</p>
        </Card>
      ) : (
        <div className={styles.tableWrap} role="region" aria-label="AI quality" tabIndex={0}>
          <table className={styles.table}>
            <caption className={styles.caption}>
              The share ruled wrong is of the flags an admin has decided, not of all of them.
            </caption>
            <thead>
              <tr>
                <th scope="col">Source</th>
                <th scope="col">Output</th>
                <th scope="col">Flagged</th>
                <th scope="col">Flag rate</th>
                <th scope="col">Awaiting a decision</th>
                <th scope="col">Ruled wrong</th>
              </tr>
            </thead>
            <tbody>
              {data.sources.map((source) => (
                <tr key={source.source}>
                  <th scope="row" className={styles.rowHeader}>
                    {SOURCES[source.source] ?? source.source}
                  </th>
                  <td className={styles.num}>{source.outputs}</td>
                  <td className={styles.num}>{source.flags}</td>
                  <td className={source.flagRate === null ? styles.unknown : styles.num}>
                    {rate(source.flagRate)}
                  </td>
                  <td className={styles.num}>{source.open}</td>
                  <td className={source.wrongShare === null ? styles.unknown : styles.num}>
                    {source.wrongShare === null
                      ? "nothing ruled on yet"
                      : `${rate(source.wrongShare)} (${source.confirmedWrong} of ${
                          source.confirmedWrong + source.confirmedCorrect
                        })`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** §6.9: "Issued and revoked over time." */
function Certificates() {
  const { data, isPending, error } = useQuery({
    queryKey: adminAnalyticsKeys.certificates,
    queryFn: ({ signal }) => adminAnalyticsApi.certificates(signal),
  });

  const peak = Math.max(1, ...(data?.months ?? []).map((month) => month.issued));

  return (
    <section>
      <h2 className={styles.sectionTitle}>Certificates</h2>

      {isPending ? (
        <p role="status" aria-live="polite" className={styles.hint}>
          Counting certificates…
        </p>
      ) : error ? (
        <p role="alert" className={styles.error}>
          {error instanceof ApiError
            ? error.message
            : "Certificate figures did not load. Try again in a moment."}
        </p>
      ) : data.months.length === 0 ? (
        <Card className={styles.empty}>
          <p className={styles.hint}>
            No certificate has been issued yet. They appear here as learners finish.
          </p>
        </Card>
      ) : (
        <Card className={styles.panel}>
          <ul className={styles.monthList}>
            {data.months.map((month) => (
              <li key={`${month.month}-${month.type}`} className={styles.share}>
                <div className={styles.stageHead}>
                  <span className={styles.stageLabel}>
                    {MONTH.format(new Date(month.month))}
                    <span className={styles.rowMeta}>
                      {month.type === "completion" ? " · Completion" : " · Project"}
                    </span>
                  </span>
                  <span className={styles.stageCount}>{month.issued}</span>
                </div>
                <div className={styles.bar} aria-hidden="true">
                  <div
                    className={styles.barFill}
                    style={{ width: `${(month.issued / peak) * 100}%` }}
                  />
                </div>
                {month.revoked > 0 && (
                  <p className={styles.stageDrop}>
                    {month.revoked} of these {month.revoked === 1 ? "was" : "were"} later
                    withdrawn.
                  </p>
                )}
              </li>
            ))}
          </ul>
          <p className={styles.hint}>
            A withdrawal is counted in the month the certificate was issued, so the pair reads as
            "of the ones issued then, this many did not hold up".
          </p>
        </Card>
      )}
    </section>
  );
}
