import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Badge } from "../../components/core/Badge";
import { Button } from "../../components/core/Button";
import { Card } from "../../components/core/Card";
import { LinkButton } from "../../components/core/LinkButton";
import { AiPanel } from "../../components/learning/AiPanel";
import { ApiError } from "../../api/client";
import type { DecisionOption, DecisionPage } from "../../api/decisions";
import { useChooseTechnology, useDecision } from "../../features/decision/useDecision";
import styles from "./TechnologyChoice.module.css";

/**
 * design.md §5.8 — the technology decision.
 *
 * "Opens from the decision node, as a full page on all widths." Nothing here
 * decides what the choice does to the roadmap: the browser sends which option
 * was picked, and the API rebuilds the plan around it.
 */
export function TechnologyChoice() {
  const { id, decisionId } = useParams();
  const { data, isPending, error } = useDecision(id, decisionId);

  if (isPending) {
    return (
      <p role="status" aria-live="polite" className={styles.loading}>
        Loading your options…
      </p>
    );
  }

  if (error || !data) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <Card surface="white" radius="panel" padding="lg" className={styles.empty}>
        <h1 className={styles.title}>
          {notFound ? "We couldn't find that choice" : "This isn't available right now"}
        </h1>
        <p className={styles.lede}>
          {notFound
            ? "It may belong to another roadmap, or the link may be wrong."
            : "This is usually temporary, and nothing on your roadmap has changed."}
        </p>
        <LinkButton to="/app" icon="arrow-right">Back to home</LinkButton>
      </Card>
    );
  }

  return <ChoiceView decision={data} />;
}

function ChoiceView({ decision }: { decision: DecisionPage }) {
  const navigate = useNavigate();
  const choose = useChooseTechnology(decision.roadmapId, decision.id);
  const [confirming, setConfirming] = useState<DecisionOption | null>(null);

  const chosen = decision.options.find((o) => o.technologyId === decision.chosenTechnologyId);
  const error = choose.error instanceof ApiError ? choose.error : null;

  return (
    <>
      <Card surface="white" radius="panel" padding="lg" className={styles.header}>
        <LinkButton
          variant="ghost"
          size="sm"
          to={`/app/roadmap/${decision.roadmapId}`}
          icon="arrow-left"
          iconPosition="left"
        >
          Back to roadmap
        </LinkButton>

        <h1 className={styles.title}>{decision.title}</h1>
        <p className={styles.lede}>
          {chosen
            ? `Your roadmap uses ${chosen.name}. You can switch, and you keep your progress on shared modules.`
            : `You've finished the core skills. Pick the framework your ${decision.trackTitle} modules and capstone will use. You can switch later and keep your progress on shared modules.`}
        </p>
      </Card>

      {/*
        * §7: AI output is labelled, carries a reason, and is flaggable.
        *
        * `aiOutputId` is null here because nothing writes
        * `roadmap_technology_choices.recommendation_reason` yet — the Roadmap
        * AI picks a track, not a framework, so this panel has no output row to
        * point a flag at and does not render at all today. The control comes
        * with the recommendation when one is generated; recorded in
        * docs/task-tracker.md.
        */}
      {decision.recommendation && (
        <AiPanel aiOutputId={null} className={styles.aiPanel}>
          <p>{decision.recommendation.reason}</p>
        </AiPanel>
      )}

      {error && <p role="alert" className={styles.error}>{error.message}</p>}

      <ul className={styles.options}>
        {decision.options.map((option) => {
          const isChosen = option.technologyId === decision.chosenTechnologyId;
          const isRecommended = option.technologyId === decision.recommendation?.technologyId;
          const hasRecommendation = decision.recommendation !== null;

          return (
            <Card
              as="li"
              key={option.technologyId}
              surface="white"
              radius="panel"
              padding="lg"
              className={styles.card}
            >
              <div className={styles.cardHead}>
                <h2 className={styles.cardTitle}>{option.name}</h2>
                <div className={styles.cardBadges}>
                  {/* §12: the recommendation is announced as text, not a colour. */}
                  {isRecommended && <Badge tone="lime">Recommended</Badge>}
                  {isChosen && <Badge tone="verified" icon="check">Your choice</Badge>}
                </div>
              </div>

              <p className={styles.cardBody}>{option.description}</p>

              <dl className={styles.comparison}>
                {Object.entries(option.comparison).map(([key, value]) => (
                  <div key={key}>
                    <dt>{label(key)}:</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
                <div>
                  <dt>On your roadmap:</dt>
                  <dd>
                    {option.moduleCount} module{option.moduleCount === 1 ? "" : "s"}
                    {option.passedCount > 0 ? `, ${option.passedCount} already passed` : ""}
                  </dd>
                </div>
              </dl>

              <div className={styles.cardActions}>
                {/*
                  §5.8 weights the recommended option: it takes the lime
                  button and the others take violet. Both are still choose
                  actions, and the reason for the weighting is written above
                  them in words rather than left to the colour (§12).
                */}
                <Button
                  variant={
                    isChosen ? "outline" : !hasRecommendation || isRecommended ? "primary" : "secondary"
                  }
                  fullWidth
                  disabled={isChosen}
                  onClick={() => setConfirming(option)}
                >
                  {isChosen ? `Using ${option.name}` : `Choose ${option.name}`}
                </Button>
              </div>
            </Card>
          );
        })}
      </ul>

      {confirming && (
        <Confirm
          decision={decision}
          option={confirming}
          previous={chosen ?? null}
          busy={choose.isPending}
          onCancel={() => setConfirming(null)}
          onConfirm={() =>
            choose.mutate(confirming.technologyId, {
              onSuccess: () => {
                setConfirming(null);
                void navigate(`/app/roadmap/${decision.roadmapId}`);
              },
            })
          }
        />
      )}
    </>
  );
}

/**
 * §5.8's two confirmations.
 *
 * Choosing: "Your roadmap will use React. You can switch later from the roadmap
 * menu." Switching says what happens to what they already passed, because that
 * is the only thing worth worrying about — and the answer is "nothing".
 */
function Confirm({
  decision,
  option,
  previous,
  busy,
  onCancel,
  onConfirm,
}: {
  decision: DecisionPage;
  option: DecisionOption;
  previous: DecisionOption | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const switching = previous !== null && previous.technologyId !== option.technologyId;
  const heading = useRef<HTMLHeadingElement>(null);

  // §12: focus moves into a panel when it opens, so a keyboard user is not left
  // behind on the card they just activated.
  useEffect(() => {
    heading.current?.focus();
  }, []);

  return (
    <Card
      surface="white"
      radius="panel"
      padding="lg"
      className={styles.confirm}
      role="region"
      aria-labelledby="confirm-heading"
    >
      <h2 id="confirm-heading" className={styles.confirmTitle} tabIndex={-1} ref={heading}>
        {switching ? `Switch to ${option.name}?` : `Your roadmap will use ${option.name}`}
      </h2>

      {switching ? (
        <>
          <p className={styles.confirmLine}>
            Your core and {decision.trackTitle.toLowerCase()} modules stay passed.
          </p>
          {previous.passedCount > 0 && (
            <p className={styles.confirmLine}>
              Your {previous.passedCount} passed {previous.name} module
              {previous.passedCount === 1 ? "" : "s"} stay on your resume.
            </p>
          )}
          <p className={styles.confirmLine}>
            {option.name} modules replace {previous.name} modules on your roadmap.
          </p>
        </>
      ) : (
        <p className={styles.confirmLine}>
          You can switch later from the roadmap menu, and you keep your progress on shared
          modules.
        </p>
      )}

      <div className={styles.confirmActions}>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="primary"
          icon="arrow-right"
          onClick={onConfirm}
          loading={busy}
          loadingLabel="Saving…"
        >
          {switching ? `Switch to ${option.name}` : `Choose ${option.name}`}
        </Button>
      </div>
    </Card>
  );
}

/**
 * `decision_options.comparison` is free-form, so its keys become the labels.
 *
 * Sentence case, not title case — §9: "Sentence case for headings, buttons,
 * and labels." `learningCurve` reads as "Learning curve".
 */
function label(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
