import { Button } from "../../components/core/Button";
import { LinkButton } from "../../components/core/LinkButton";
import { Icon } from "../../components/core/Icon";
import { Input } from "../../components/forms/Input";
import styles from "./Landing.module.css";

/**
 * design.md §5.1 — the hero shows the product's most characteristic element:
 * a roadmap running from the first skill down to "Project Certificate", so a
 * visitor sees the whole journey at once.
 *
 * The numbered "How it works" row is a real sequence, which is why numbering
 * is used here and nowhere else on the page.
 */

const STEPS = [
  { title: "Tell us your goal", body: "Answer a few questions about where you are and the job you want." },
  { title: "Learn and practice", body: "Work through a roadmap built for you, with feedback on every exercise." },
  { title: "Build your project", body: "Build a real project from an empty folder, on your own GitHub." },
  { title: "Get a verified resume", body: "A resume made only from skills you proved and work you shipped." },
];

const CHART = ["HTML", "CSS", "JavaScript", "Git"];

export function Landing() {
  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <header className={styles.topbar}>
          <span className={styles.wordmark}>
            <span className={styles.mark}><Icon name="code-xml" size={15} /></span>
            First <span className={styles.wordmarkAccent}>Commit</span>
          </span>
          <div className={styles.topbarActions}>
            <LinkButton to="/login" variant="ghost" size="sm">Log in</LinkButton>
            <LinkButton to="/signup" variant="primary" size="sm" icon="arrow-right">
              Sign up
            </LinkButton>
          </div>
        </header>

        <section className={styles.hero}>
          <div>
            <h1 className={styles.heroTitle}>
              From your first line of code to your{" "}
              <span className={styles.accent}>first real project.</span>
            </h1>
            <p className={styles.heroBody}>
              A roadmap built for you, feedback on every exercise, and a project
              on your own GitHub.
            </p>
            <div className={styles.heroActions}>
              <LinkButton to="/signup" variant="primary" size="lg" icon="arrow-right">
                Build my roadmap
              </LinkButton>
              <Button variant="outline" size="lg">See how it works</Button>
            </div>
          </div>

          <div className={styles.chart} aria-hidden="true">
            {CHART.map((skill) => (
              <div key={skill} style={{ display: "contents" }}>
                <div className={styles.node}>{skill}</div>
                <div className={styles.connector} />
              </div>
            ))}
            <div className={`${styles.node} ${styles.nodeEnd}`}>Capstone project</div>
            <div className={styles.connector} />
            <div className={`${styles.node} ${styles.nodeEnd}`}>Project Certificate</div>
          </div>
        </section>

        <section className={styles.steps}>
          <h2 className={styles.sectionTitle}>How it works</h2>
          <ol className={styles.stepGrid}>
            {STEPS.map((step, i) => (
              <li key={step.title} className={styles.step}>
                <span className={styles.stepNumber}>{i + 1}</span>
                <h3 className={styles.stepTitle}>{step.title}</h3>
                <p className={styles.stepBody}>{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className={styles.verify}>
          <div>
            <h2 className={styles.verifyTitle}>Verify a certificate</h2>
            <p>
              Every certificate has an ID you can check here. No account needed.
            </p>
          </div>
          <form className={styles.verifyForm}>
            <Input
              label="Certificate ID"
              name="code"
              placeholder="FC-0000-0000"
              style={{ flex: 1, minWidth: 180 }}
            />
            <Button variant="primary" icon="arrow-right">Verify</Button>
          </form>
        </section>
      </div>
    </div>
  );
}
