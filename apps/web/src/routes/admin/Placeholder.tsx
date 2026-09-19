import { Card } from "../../components/core/Card";

/**
 * A named stand-in for an admin screen that is specified but not built, so the
 * sidebar is walkable while the shell is being reviewed.
 */
export function Placeholder({ title, section }: { title: string; section: string }) {
  return (
    <div>
      <h1 style={{ fontSize: "var(--text-h1)", marginBottom: "var(--space-5)" }}>{title}</h1>
      <Card surface="inset" padding="lg">
        <p>
          Not built yet. This screen is specified in <code>design.md</code> {section} and
          tracked in <code>docs/task-tracker.md</code>.
        </p>
      </Card>
    </div>
  );
}
