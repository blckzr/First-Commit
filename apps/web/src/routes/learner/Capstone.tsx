import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "../../components/core/Button";
import { Card } from "../../components/core/Card";
import { Icon } from "../../components/core/Icon";
import { StepIndicator } from "../../components/navigation/StepIndicator";
import { LinkButton } from "../../components/core/LinkButton";
import {
  capstoneApi,
  capstoneKey,
  type CapstoneBrief,
  type CapstoneState,
} from "../../api/capstone";
import { githubApi, githubKey } from "../../api/github";
import { MilestoneTracker } from "../../features/capstone/MilestoneTracker";
import { ApiError } from "../../api/client";
import styles from "./Capstone.module.css";

/**
 * design.md §5.14 — the capstone project.
 *
 * **Stage 1 only.** Choosing a brief needs nothing outside the platform, so it
 * is built; connecting a repository needs a registered GitHub App and starter
 * repositories that do not exist yet, so the screen says where the learner has
 * got to and stops there rather than drawing a button that cannot work.
 *
 * **The stage comes from the API**, never worked out here from the other
 * fields. The same rows decide it that decide whether `POST` is allowed, so the
 * screen cannot offer something the endpoint would refuse.
 *
 * §5.14's "Recommended" badge is absent: there is no `brief_recommendation` job
 * type, so nothing writes one, and a badge chosen by the interface would be an
 * unlabelled recommendation with no reason and nothing to flag (§7).
 */

const STAGES = ["Choose brief", "Connect repo", "Build"];

export function Capstone() {
  const client = useQueryClient();
  const [chosen, setChosen] = useState<string>();

  const { data, isPending, error } = useQuery({
    queryKey: capstoneKey,
    queryFn: ({ signal }) => capstoneApi.state(signal),
  });

  const start = useMutation({
    mutationFn: (briefId: string) => capstoneApi.start(data!.roadmapId!, briefId),
    async onSuccess() {
      await client.invalidateQueries({ queryKey: capstoneKey });
    },
  });

  if (isPending) {
    return (
      <p role="status" aria-live="polite" className={styles.loading}>
        Loading your capstone project…
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

  const stageIndex = data.stage === "build" ? 2 : data.stage === "connect" ? 1 : 0;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Capstone project</h1>
        <StepIndicator steps={STAGES} current={stageIndex} />
      </header>

      {data.stage === "locked" && (
        <Card className={styles.notice}>
          <Icon name="lock" aria-hidden />
          <p className={styles.noticeText}>{data.reason}</p>
        </Card>
      )}

      {data.stage === "choose" && (
        <section aria-labelledby="choose-heading">
          <h2 id="choose-heading" className={styles.heading}>
            Choose what you&rsquo;ll build with {data.technology?.name}.
          </h2>

          {data.briefs.length === 0 ? (
            <Card className={styles.notice}>
              <p className={styles.noticeText}>
                There is no project brief for {data.technology?.name} on this track yet.
              </p>
            </Card>
          ) : (
            <ul className={styles.briefs}>
              {data.briefs.map((brief) => (
                <li key={brief.id}>
                  <BriefCard
                    brief={brief}
                    busy={start.isPending && chosen === brief.id}
                    onChoose={() => {
                      setChosen(brief.id);
                      start.mutate(brief.id);
                    }}
                  />
                </li>
              ))}
            </ul>
          )}

          {start.error && (
            <p role="alert" className={styles.error}>
              {start.error instanceof ApiError
                ? start.error.message
                : "That did not start. Try again in a moment."}
            </p>
          )}
        </section>
      )}

      {data.stage === "connect" && data.project && data.roadmapId && (
        <ConnectRepository
          project={data.project}
          technology={data.technology?.name ?? "your framework"}
          roadmapId={data.roadmapId}
        />
      )}

      {data.stage === "build" && data.project && data.roadmapId && (
        <>
          <MilestoneTracker roadmapId={data.roadmapId} project={data.project} />

          <section aria-labelledby="pushes-heading">
            <h2 id="pushes-heading" className={styles.heading}>
              Push history
            </h2>

            {/*
              An unreachable GitHub is not an empty history. Saying which is
              which stops a learner assuming their pushes were lost.
            */}
            {!data.project.githubReachable && (
              <p role="alert" className={styles.error}>
                GitHub isn&rsquo;t answering right now, so this may be behind. Nothing is lost.
              </p>
            )}

            {data.project.commits.length === 0 ? (
              <p className={styles.noticeText}>
                Push your first commit when you are ready — it will show up here.
              </p>
            ) : (
              <ul className={styles.commits}>
                {data.project.commits.map((commit) => (
                  <li key={commit.sha} className={styles.commit}>
                    <code className={styles.repo}>{commit.sha.slice(0, 7)}</code>
                    <span className={styles.commitMessage}>{commit.message.split("\n")[0]}</span>
                    <time className={styles.hint} dateTime={commit.pushedAt}>
                      {new Date(commit.pushedAt).toLocaleDateString()}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

/**
 * §5.14 stage 2 — three numbered steps, then the repository.
 *
 * The steps are an ordered list because they are one, and the third is the only
 * one the platform can do anything about: the first two happen on GitHub and on
 * the learner's own machine, so they are instructions rather than controls.
 */
function ConnectRepository({
  project,
  technology,
  roadmapId,
}: {
  project: NonNullable<CapstoneState["project"]>;
  technology: string;
  roadmapId: string;
}) {
  const client = useQueryClient();
  const [selected, setSelected] = useState<number>();

  const { data: github, isPending } = useQuery({
    queryKey: githubKey,
    queryFn: ({ signal }) => githubApi.connection(signal),
  });

  const connect = useMutation({
    mutationFn: () => githubApi.connectUrl(),
    onSuccess(result) {
      // A full navigation, not a fetch: the learner has to see GitHub's own
      // consent screen and choose which repository to share.
      window.location.assign(result.url);
    },
  });

  const useRepository = useMutation({
    mutationFn: (repositoryId: number) => capstoneApi.setRepository(roadmapId, repositoryId),
    async onSuccess() {
      await client.invalidateQueries({ queryKey: capstoneKey });
    },
  });

  return (
    <section aria-labelledby="connect-heading" className={styles.connect}>
      <h2 id="connect-heading" className={styles.heading}>
        Connect your repository
      </h2>

      <ol className={styles.steps}>
        <li className={styles.step}>
          <p className={styles.stepText}>Create your repository from the starter template.</p>
          {/*
            `to` with an absolute URL: React Router renders a plain anchor for
            one, so the button styling is reused rather than duplicated. The
            `/generate` path is GitHub's "use this template" form — it creates
            the learner's own repository rather than sending them to ours.
          */}
          {project.starterRepo ? (
            <LinkButton
              to={`https://github.com/${project.starterRepo}/generate`}
              target="_blank"
              rel="noreferrer noopener"
            >
              Open the {technology} starter template
            </LinkButton>
          ) : (
            <p className={styles.noticeText}>
              The starter template for {technology} is unavailable. Tell an admin — you can still
              connect a repository you made yourself.
            </p>
          )}
        </li>

        <li className={styles.step}>
          <p className={styles.stepText}>Clone it to your computer and start building.</p>
        </li>

        <li className={styles.step}>
          <p className={styles.stepText}>Give First Commit access to that repository.</p>
          {isPending ? (
            <p className={styles.noticeText}>Checking your GitHub account…</p>
          ) : github?.connected ? (
            <p className={styles.connected}>
              <Icon name="check" aria-hidden /> Connected as{" "}
              <strong>{github.login}</strong>
            </p>
          ) : (
            <>
              <Button onClick={() => connect.mutate()} disabled={connect.isPending}>
                Connect with GitHub
              </Button>
              <p className={styles.hint}>Only the repository you select is shared.</p>
            </>
          )}
        </li>
      </ol>

      {/*
        A connected account the platform cannot reach right now is not a
        disconnected one, so it says that rather than offering to reconnect
        something that is already fine.
      */}
      {github?.connected && github.reachable === false && (
        <p role="alert" className={styles.error}>
          GitHub isn&rsquo;t answering right now, so your repositories can&rsquo;t be listed. Try
          again in a minute.
        </p>
      )}

      {github?.connected && github.repositories.length > 0 && (
        <div className={styles.picker}>
          <h3 className={styles.heading}>Which repository is this project?</h3>
          <ul className={styles.repos}>
            {github.repositories.map((repo) => (
              <li key={repo.id}>
                <label className={styles.repoChoice}>
                  <input
                    type="radio"
                    name="repository"
                    value={repo.id}
                    checked={selected === repo.id}
                    onChange={() => setSelected(repo.id)}
                  />
                  <code className={styles.repo}>{repo.fullName}</code>
                </label>
              </li>
            ))}
          </ul>

          <Button
            onClick={() => selected && useRepository.mutate(selected)}
            disabled={!selected || useRepository.isPending}
          >
            {useRepository.isPending ? "Connecting…" : "Start building"}
          </Button>
        </div>
      )}

      {github?.connected && github.reachable !== false && github.repositories.length === 0 && (
        <p className={styles.noticeText}>
          This installation doesn&rsquo;t include any repositories yet. Add one on GitHub, then
          reload this page.
        </p>
      )}

      {useRepository.error && (
        <p role="alert" className={styles.error}>
          {useRepository.error instanceof ApiError
            ? useRepository.error.message
            : "That did not connect. Try again in a moment."}
        </p>
      )}
    </section>
  );
}

function BriefCard({
  brief,
  busy,
  onChoose,
}: {
  brief: CapstoneBrief;
  busy: boolean;
  onChoose: () => void;
}) {
  return (
    <Card className={styles.brief}>
      <h3 className={styles.briefTitle}>{brief.title}</h3>
      <p className={styles.briefText}>{brief.description}</p>

      <dl className={styles.facts}>
        <div className={styles.fact}>
          <dt className={styles.factLabel}>Milestones</dt>
          <dd className={styles.factValue}>{brief.milestoneCount}</dd>
        </div>
        <div className={styles.fact}>
          <dt className={styles.factLabel}>Length</dt>
          <dd className={styles.factValue}>About {brief.estimatedWeeks} weeks</dd>
        </div>
        {brief.uses.length > 0 && (
          <div className={styles.fact}>
            <dt className={styles.factLabel}>Uses</dt>
            <dd className={styles.factValue}>{brief.uses.join(", ")}</dd>
          </div>
        )}
      </dl>

      <Button onClick={onChoose} disabled={busy}>
        {busy ? "Starting…" : `Build ${brief.title}`}
      </Button>
    </Card>
  );
}
