import { useEffect, useRef } from "react";
import { Badge } from "../core/Badge";
import { Button } from "../core/Button";
import { IconButton } from "../core/IconButton";
import { LinkButton } from "../core/LinkButton";
import { ProgressBar } from "../learning/ProgressBar";
import { skillProgress } from "../../features/roadmap/labels";
import { lockedReason, milestoneStatus, moduleStatus } from "../../features/roadmap/status";
import {
  allModules,
  assertNever,
  isDone,
  type DecisionStep,
  type MilestoneStep,
  type Roadmap,
  type RoadmapModuleNode,
  type RoadmapSelection,
  type SkillStep,
} from "../../features/roadmap/types";
import styles from "./RoadmapPanel.module.css";

/**
 * The side panel (design.md §5.7), which is a bottom sheet on `sm` (§11.3) —
 * same content, different edge, one component and a CSS swap.
 *
 * §12: "focus moves into side panels and dialogs and returns to the triggering
 * node when closed." The heading takes focus on open; closing hands focus back
 * to the roadmap node, which the caller re-focuses.
 *
 * §5.7 ends with the rule this panel exists under: **learners cannot mark
 * modules as done manually.** Nothing here writes progress. Every action is a
 * link to where the work actually happens.
 */
export interface RoadmapPanelProps {
  roadmap: Roadmap;
  selection: RoadmapSelection;
  onClose: () => void;
}

export function RoadmapPanel({ roadmap, selection, onClose }: RoadmapPanelProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  const id = selection.kind === "module" ? selection.module.id : selection.step.id;

  useEffect(() => {
    heading.current?.focus();
  }, [id]);

  /**
   * Escape closes the panel from anywhere on the screen, not only from inside
   * it — a learner who pressed Enter on a node and then moved on should not
   * have to find the Close button.
   */
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <aside className={styles.panel} aria-label="Node details">
      <div className={styles.head}>
        <h2 className={styles.heading} tabIndex={-1} ref={heading}>
          {selection.kind === "module" ? selection.module.title : selection.step.title}
        </h2>
        <IconButton icon="x" label="Close details" onClick={onClose} />
      </div>

      <div className={styles.body}>
        <Details roadmap={roadmap} selection={selection} />
      </div>
    </aside>
  );
}

function Details({ roadmap, selection }: { roadmap: Roadmap; selection: RoadmapSelection }) {
  if (selection.kind === "module") {
    return <ModuleDetails roadmap={roadmap} module={selection.module} skill={selection.skill} />;
  }

  const step = selection.step;
  switch (step.type) {
    case "skill":
      return <SkillDetails step={step} />;
    case "decision":
      return <DecisionDetails step={step} roadmapId={roadmap.id} />;
    case "certificate":
    case "capstone":
    case "project_certificate":
      return <MilestoneDetails roadmap={roadmap} step={step} />;
    default:
      return assertNever(step);
  }
}

/** Titles of the modules this one needs, so "Locked" can say what to do (§9). */
function prerequisiteTitles(roadmap: Roadmap, module: RoadmapModuleNode): string[] {
  const byModuleId = new Map(allModules(roadmap).map((m) => [m.moduleId, m]));
  return module.requires.map((id) => byModuleId.get(id)?.title ?? "an earlier module");
}

/** What passing this module opens up. */
function unlocks(roadmap: Roadmap, module: RoadmapModuleNode): RoadmapModuleNode[] {
  return allModules(roadmap).filter((m) => m.requires.includes(module.moduleId));
}

function ModuleDetails({
  roadmap,
  module,
  skill,
}: {
  roadmap: Roadmap;
  module: RoadmapModuleNode;
  skill: SkillStep;
}) {
  const status = moduleStatus(module);
  const opens = unlocks(roadmap, module);
  const required = prerequisiteTitles(roadmap, module);
  const blocking = required.filter((_, i) => {
    const req = allModules(roadmap).find((m) => m.moduleId === module.requires[i]);
    return req ? !isDone(req.status) : true;
  });

  return (
    <>
      <p className={styles.line}>
        <Badge tone={status.tone} icon={status.icon}>{status.text}</Badge>
        <span className={styles.muted}>in {skill.title}</span>
      </p>

      {module.addedReason && (
        <p className={styles.reason}>
          <Badge tone="ai">Added by AI</Badge> {module.addedReason}
        </p>
      )}

      {module.status === "locked" && <p className={styles.line}>{lockedReason(blocking)}</p>}

      {module.status === "archived" && (
        <p className={styles.line}>
          This module is no longer offered. Anything you already passed still counts.
        </p>
      )}

      <dl className={styles.facts}>
        <div>
          <dt>Time</dt>
          <dd>About {module.estimatedHours} hours</dd>
        </div>
        <div>
          <dt>Version</dt>
          <dd>Version {module.versionNo}</dd>
        </div>
        {module.sharedWithPaths.length > 0 && (
          <div>
            <dt>Also in</dt>
            <dd>
              {module.sharedWithPaths.length} other career path
              {module.sharedWithPaths.length > 1 ? "s" : ""} — passing it counts on all of them
            </dd>
          </div>
        )}
      </dl>

      {module.hasUpdate && (
        <p className={styles.line}>
          A newer version exists. You keep the version you started, and your credit stays.
        </p>
      )}

      {opens.length > 0 && (
        <p className={styles.line}>
          <span className={styles.muted}>Unlocks:</span> {opens.map((m) => m.title).join(", ")}
        </p>
      )}

      <div className={styles.actions}>
        {module.status === "locked" ? (
          <LinkButton
            variant="outline"
            to={`/app/module/${module.requires[0] ?? module.moduleId}`}
            icon="arrow-right"
          >
            Go to the module that unlocks it
          </LinkButton>
        ) : (
          <>
            <LinkButton to={`/app/module/${module.moduleId}`} icon="arrow-right">
              {module.status === "current" ? "Continue module" : isDone(module.status) ? "Review module" : "Start module"}
            </LinkButton>
            {!isDone(module.status) && module.kind !== "reinforcement" && (
              <LinkButton variant="outline" to={`/app/module/${module.moduleId}?testout=1`}>
                Test out
              </LinkButton>
            )}
            {/*
              §5.7 gives reinforcement a Remove and challenge a Skip. Both change
              the roadmap, which is a server decision, so they are disabled until
              the endpoint exists rather than pretending to work.
            */}
            {module.kind === "reinforcement" && (
              <Button variant="ghost" disabled title="Not built yet">Remove</Button>
            )}
            {module.kind === "challenge" && (
              <Button variant="ghost" disabled title="Not built yet">Skip</Button>
            )}
          </>
        )}
      </div>
    </>
  );
}

function SkillDetails({ step }: { step: SkillStep }) {
  const { done, total } = skillProgress(step);
  return (
    <>
      <ProgressBar
        value={total === 0 ? 0 : (done / total) * 100}
        label={`${done} of ${total} modules passed`}
      />
      <ul className={styles.moduleList}>
        {step.modules.map((module) => {
          const status = moduleStatus(module);
          return (
            <li key={module.id}>
              <LinkButton variant="ghost" size="sm" to={`/app/module/${module.moduleId}`}>
                {module.title}
              </LinkButton>
              <Badge tone={status.tone} icon={status.icon}>{status.text}</Badge>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function DecisionDetails({ step, roadmapId }: { step: DecisionStep; roadmapId: string }) {
  const chosen = step.options.find((o) => o.id === step.chosenOptionId);
  return (
    <>
      <p className={styles.line}>
        {chosen
          ? `You chose ${chosen.name}. Everything after this step follows it.`
          : "Nothing after this step opens until you choose. You can compare the options first."}
      </p>
      <ul className={styles.optionList}>
        {step.options.map((option) => (
          <li key={option.id}>
            <span className={styles.optionName}>{option.name}</span>
            {/* §12: the recommendation is announced as text, not only a colour. */}
            {option.id === step.recommendedOptionId && (
              <Badge tone="ai">Recommended for you</Badge>
            )}
            {option.id === step.chosenOptionId && (
              <Badge tone="verified" icon="check">Chosen</Badge>
            )}
          </li>
        ))}
      </ul>
      <div className={styles.actions}>
        <LinkButton to={`/app/roadmap/${roadmapId}/technology/${step.id}`} icon="arrow-right">
          {chosen ? "Review your choice" : "Choose your technology"}
        </LinkButton>
      </div>
    </>
  );
}

function MilestoneDetails({ roadmap, step }: { roadmap: Roadmap; step: MilestoneStep }) {
  const status = milestoneStatus(step);
  const remaining = allModules(roadmap).filter(
    (m) => !isDone(m.status) && m.status !== "archived",
  );

  return (
    <>
      <p className={styles.line}>
        <Badge tone={status.tone} icon={status.icon}>{status.text}</Badge>
      </p>

      {step.type === "capstone" ? (
        <p className={styles.line}>
          {step.status === "locked"
            ? `Pass the remaining ${remaining.length} modules to open the capstone.`
            : `Milestone ${(step.completedMilestones ?? 0) + 1} of ${step.totalMilestones ?? 0}.`}
        </p>
      ) : (
        <p className={styles.line}>
          {step.status === "earned"
            ? "Earned. Your certificate has a public verification page."
            : `${remaining.length} modules left before this certificate is issued.`}
        </p>
      )}

      <div className={styles.actions}>
        {step.type === "capstone" ? (
          <LinkButton
            variant={step.status === "locked" ? "outline" : "primary"}
            to="/app/capstone"
            icon="arrow-right"
          >
            {step.status === "locked" ? "Preview the briefs" : "Open capstone"}
          </LinkButton>
        ) : (
          <LinkButton
            variant={step.status === "earned" ? "primary" : "outline"}
            to="/app/certificates"
            icon="arrow-right"
          >
            {step.status === "earned" ? "View certificate" : "See what's required"}
          </LinkButton>
        )}
      </div>
    </>
  );
}
