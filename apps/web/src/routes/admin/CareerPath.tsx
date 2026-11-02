import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "../../components/core/Badge";
import { Button } from "../../components/core/Button";
import { Card } from "../../components/core/Card";
import { adminPathsApi, pathKey, pathsKey, type Module, type Skill } from "../../api/adminPaths";
import { ApiError } from "../../api/client";
import styles from "./CareerPath.module.css";

/**
 * design.md §6.2 — the career path editor.
 *
 * **This is the structure the Roadmap AI selects from**, which is why the two
 * things §6.2 validates are shown first:
 *
 * - A **circular prerequisite** makes a module unreachable. The API refuses one
 *   and names the loop; this shows the sentence it gives back.
 * - A **technology option with no module for a concept skill** leaves a learner
 *   who picked Vue with a gap where the React learner has a lesson. Nothing else
 *   in the platform notices, so it is a banner here.
 *
 * §6.2's drag-and-drop placement is **not built**: skills and modules are
 * arranged in `supabase/seed/`. What is here is the part that silently breaks a
 * roadmap, plus the certificate rules tab — recorded in docs/task-tracker.md.
 */

export function CareerPaths() {
  const { data, isPending, error } = useQuery({
    queryKey: pathsKey,
    queryFn: ({ signal }) => adminPathsApi.list(signal),
  });

  if (isPending) {
    return (
      <p role="status" aria-live="polite" className={styles.hint}>
        Loading career paths…
      </p>
    );
  }

  if (error || !data) {
    return (
      <p role="alert" className={styles.error}>
        {error instanceof ApiError ? error.message : "That did not load. Try again in a moment."}
      </p>
    );
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Career paths</h1>
      {data.paths.map((path) => (
        <PathDetail key={path.id} pathId={path.id} />
      ))}
    </div>
  );
}

function PathDetail({ pathId }: { pathId: string }) {
  const client = useQueryClient();

  const { data, isPending, error } = useQuery({
    queryKey: pathKey(pathId),
    queryFn: ({ signal }) => adminPathsApi.detail(pathId, signal),
  });

  const refresh = () => client.invalidateQueries({ queryKey: pathKey(pathId) });

  const setRequired = useMutation({
    mutationFn: (input: { pathSkillId: string; moduleId: string; required: boolean }) =>
      adminPathsApi.setRequired(pathId, input.pathSkillId, input.moduleId, input.required),
    onSuccess: refresh,
  });

  const setPrerequisites = useMutation({
    mutationFn: (input: { moduleId: string; requires: string[] }) =>
      adminPathsApi.setPrerequisites(pathId, input.moduleId, input.requires),
    onSuccess: refresh,
  });

  if (isPending) {
    return (
      <p role="status" aria-live="polite" className={styles.hint}>
        Loading the path…
      </p>
    );
  }

  if (error || !data) {
    return (
      <p role="alert" className={styles.error}>
        {error instanceof ApiError ? error.message : "That did not load."}
      </p>
    );
  }

  const core = data.skills.filter((s) => s.layer === "core");
  const byTrack = (trackId: string) =>
    data.skills.filter((s) => s.layer === "concept" && s.trackId === trackId);

  /** Every module on the path, so a prerequisite can name one. */
  const allModules = data.skills.flatMap((s) => s.modules);

  return (
    <section className={styles.path} aria-labelledby={`path-${pathId}`}>
      <header className={styles.header}>
        <h2 id={`path-${pathId}`} className={styles.pathTitle}>
          {data.path.title}
        </h2>
        <Badge tone={data.path.status === "published" ? "verified" : "neutral"}>
          {data.path.status}
        </Badge>
      </header>

      {/*
        §6.2: "Vue has no module for State." Nothing else in the platform
        notices this, so it is a banner rather than a line in a list.
      */}
      {data.warnings.length > 0 && (
        <Card className={styles.warnings}>
          <h3 className={styles.sectionTitle}>Gaps a learner would hit</h3>
          <ul className={styles.warningList}>
            {data.warnings.map((warning, i) => (
              <li key={i}>
                <strong>{warning.technology}</strong> has no module for{" "}
                <strong>{warning.skill}</strong>.
              </li>
            ))}
          </ul>
        </Card>
      )}

      {setPrerequisites.error && (
        <p role="alert" className={styles.error}>
          {setPrerequisites.error instanceof ApiError
            ? setPrerequisites.error.message
            : "That did not save."}
        </p>
      )}

      <h3 className={styles.sectionTitle}>Core</h3>
      <SkillList
        skills={core}
        allModules={allModules}
        onToggleRequired={(pathSkillId, moduleId, required) =>
          setRequired.mutate({ pathSkillId, moduleId, required })
        }
        onSetPrerequisites={(moduleId, requires) =>
          setPrerequisites.mutate({ moduleId, requires })
        }
      />

      {data.tracks.map((track) => (
        <div key={track.id}>
          <h3 className={styles.sectionTitle}>
            {track.title} <span className={styles.muted}>{track.audience}</span>
          </h3>
          <SkillList
            skills={byTrack(track.id)}
            allModules={allModules}
            onToggleRequired={(pathSkillId, moduleId, required) =>
              setRequired.mutate({ pathSkillId, moduleId, required })
            }
            onSetPrerequisites={(moduleId, requires) =>
              setPrerequisites.mutate({ moduleId, requires })
            }
          />
        </div>
      ))}

      <Card className={styles.notBuilt}>
        <h3 className={styles.sectionTitle}>Not built yet</h3>
        <p className={styles.hint}>
          Section 6.2 also places skills and modules by dragging them from a library. That
          arrangement still lives in the seed files; what is here is the part that silently breaks
          a roadmap.
        </p>
      </Card>
    </section>
  );
}

function SkillList({
  skills,
  allModules,
  onToggleRequired,
  onSetPrerequisites,
}: {
  skills: Skill[];
  allModules: Module[];
  onToggleRequired: (pathSkillId: string, moduleId: string, required: boolean) => void;
  onSetPrerequisites: (moduleId: string, requires: string[]) => void;
}) {
  if (skills.length === 0) return <p className={styles.hint}>No skills placed here.</p>;

  return (
    <ul className={styles.skills}>
      {skills.map((skill) => (
        <li key={skill.pathSkillId}>
          <Card className={styles.skill}>
            <h4 className={styles.skillName}>{skill.name}</h4>

            {skill.modules.length === 0 ? (
              <p className={styles.hint}>No modules attached.</p>
            ) : (
              <ul className={styles.modules}>
                {skill.modules.map((module) => (
                  <li key={module.id} className={styles.module}>
                    <div className={styles.moduleHead}>
                      <span className={styles.moduleTitle}>{module.title}</span>
                      <code className={styles.code}>{module.slug}</code>
                      {module.technologyName && (
                        <Badge tone="neutral">{module.technologyName}</Badge>
                      )}
                    </div>

                    {/*
                      §6.2's Certificate rules tab. This decides what a learner
                      has to finish, including learners already part-way
                      through, so the API logs every change.
                    */}
                    <div className={styles.required}>
                      <input
                        type="checkbox"
                        id={`required-${module.id}`}
                        checked={module.requiredForCertificate}
                        onChange={(event) =>
                          onToggleRequired(
                            skill.pathSkillId,
                            module.id,
                            event.target.checked,
                          )
                        }
                      />
                      <label htmlFor={`required-${module.id}`}>
                        Required for the Certificate of Completion
                      </label>
                    </div>

                    <Prerequisites
                      module={module}
                      allModules={allModules}
                      onChange={(requires) => onSetPrerequisites(module.id, requires)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </li>
      ))}
    </ul>
  );
}

function Prerequisites({
  module,
  allModules,
  onChange,
}: {
  module: Module;
  allModules: Module[];
  onChange: (requires: string[]) => void;
}) {
  const others = allModules.filter((m) => m.id !== module.id);
  const listId = `requires-${module.id}`;

  return (
    <div className={styles.prerequisites}>
      <span id={listId} className={styles.label}>
        Needs first
      </span>

      <ul aria-labelledby={listId} className={styles.requiresList}>
        {module.requires.length === 0 && <li className={styles.muted}>Nothing</li>}
        {module.requires.map((requiredId) => {
          const other = allModules.find((m) => m.id === requiredId);
          return (
            <li key={requiredId} className={styles.requires}>
              <span>{other?.title ?? other?.slug ?? requiredId}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onChange(module.requires.filter((r) => r !== requiredId))}
              >
                Remove
              </Button>
            </li>
          );
        })}
      </ul>

      <label className={styles.visuallyHidden} htmlFor={`add-${module.id}`}>
        Add a prerequisite to {module.title}
      </label>
      <select
        id={`add-${module.id}`}
        className={styles.select}
        value=""
        onChange={(event) => {
          if (!event.target.value) return;
          onChange([...module.requires, event.target.value]);
        }}
      >
        <option value="">Add a prerequisite…</option>
        {others
          .filter((other) => !module.requires.includes(other.id))
          .map((other) => (
            <option key={other.id} value={other.id}>
              {other.title}
            </option>
          ))}
      </select>
    </div>
  );
}
